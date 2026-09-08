# Feature Specification: Procesar Liquidación y Validación

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

El dinero de una estadía pasa por tres momentos distintos y el Módulo 2 nunca debe calcularlo por
su cuenta: al hacer el Check-In hay que abrir una cuenta preliminar y fijar de forma inmutable el
IVA vigente; durante la estadía, cualquier cambio de fechas o categoría debe recotizarse contra la
tarifa dinámica; y al hacer el Check-Out hay que sumar los consumos registrados y cerrar la cuenta
con un monto definitivo. Si cada uno de esos tres momentos calculara el dinero con su propia
lógica, aparecerían descuadres entre lo que el huésped ve en pantalla y lo que finalmente se cobra.
El negocio necesita un único servicio centralizado del Módulo 3 —"Procesar liquidación y
validación"— que reciba los datos de la reserva y los consumos, valide que sean numéricos y
coherentes, y devuelva siempre un resultado matemáticamente exacto y auditable.

### Flujo de Usuario de Alto Nivel

1. Un proceso del Módulo 2 (Check-In, Check-Out o Actualizar Reservación) invoca "Procesar
   liquidación y validación" enviando la `reservationRef`, las fechas de estadía, la categoría o
   `Habitation` asignada y, si existen, los cargos adicionales (`ExtraCharge`) registrados.
2. Si la invocación proviene del Check-In, el sistema abre la cuenta en `Settlement` con estado
   `Preliminary`, fija de forma inmutable el porcentaje de IVA vigente, y genera la `Prefactura` en
   borrador (`Draft`, sin numeración oficial y aún mutable).
3. Si la invocación proviene de una actualización de reserva, el sistema recalcula la tarifa
   mediante "Calcular tarifa dinámica" y emite una `RateQuote` con el `previousGrossAmount`, el
   `grossAmount` recalculado y el `amountDifference` resultante.
4. Si la invocación proviene del Check-Out, el sistema suma la tarifa de las noches hospedadas, los
   `ExtraCharge` válidos y el IVA ya fijado, y cierra la cuenta cambiando el `Settlement` a estado
   `Final` con el `totalAmount` definitivo.
5. Si la invocación proviene de la cancelación tardía de una reserva de canal OTA dentro de la
   ventana de penalidad contractual de la agencia, el sistema calcula el `penaltyAmount`
   correspondiente y cierra la cuenta como `Settlement` en estado `Cancelled`. Las reservas de canal
   directo nunca disparan este flujo: su cancelación se resuelve de forma 100% local y gratuita en
   el Módulo 2, sin ningún llamado síncrono a este servicio.
6. Si los importes son inconsistentes, las fechas son incoherentes o el servicio no puede
   completarse, el sistema no asume montos ni cierra la cuenta: responde con un error de negocio
   controlado **HTTP 400 (Bad Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Liquidación Final de Estadía con Consumos para Check-Out (Priority: P1)

El Módulo 2 solicita la liquidación financiera final de una reserva en `CHECKED_IN`. El sistema
recopila los días de estadía, la tarifa base ya fijada, el IVA fijado en el Check-In y la lista de
`ExtraCharge` registrados durante la estancia. Valida que todas las cifras sean numéricas y no
negativas, calcula el importe total y cierra el `Settlement` en estado `Final`, dejando la cuenta
lista para el cobro. Esta historia es el flujo maestro de la funcionalidad (Happy Path).

**Why this priority**: Sin este cálculo preciso y validado, el hotel no puede cerrar la cuenta de
un huésped al hacer Check-Out, afectando directamente el recaudo y la facturación del negocio.

**Independent Test**: Se prueba suministrando los datos de una reserva `CHECKED_IN` con tres
noches de estadía y dos `ExtraCharge` válidos. Se ejecuta la liquidación y se verifica que el
sistema genere un `Settlement` en `Final` cuyo `totalAmount` coincida exactamente con la suma de la
tarifa base, los consumos y el IVA fijado. Se completa enviando un cargo con monto negativo,
confirmando que la liquidación se rechaza con **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Liquidación exitosa de estadía con cargos adicionales (Happy Path)
   - **Given** una reserva en `CHECKED_IN` con tarifa base fijada, IVA fijado en el Check-In, y dos
     `ExtraCharge` válidos registrados
   - **When** el Módulo 2 procesa la liquidación final para la salida del huésped
   - **Then** el sistema calcula el valor total de las noches hospedadas, suma los `ExtraCharge`,
     aplica el IVA ya fijado, y cierra el `Settlement` en estado `Final` con el `totalAmount`
     correcto listo para su cobro

2. **Scenario**: Rechazo controlado por monto de cargo adicional negativo (Error)
   - **Given** una reserva en proceso de liquidación de Check-Out
   - **When** se incluye un `ExtraCharge` con un valor menor o igual a cero
   - **Then** el sistema detiene el procesamiento, no cierra el `Settlement`, y responde con **HTTP
     400 (Bad Request)** especificando que todos los cargos deben poseer montos positivos válidos

---

### User Story 2 - Recotización Diferencial por Actualización de Reserva (Priority: P2)

Cuando un solicitante modifica el rango de fechas o la categoría de una reserva `PENDING` o
`ACTIVE`, el sistema ejecuta "Procesar liquidación y validación" para evaluar la nueva tarifa
mediante "Calcular tarifa dinámica" y compara el `grossAmount` previo contra el recalculado,
registrando la diferencia en `amountDifference` dentro de la `RateQuote`.

**Why this priority**: Es un flujo alternativo fundamental para la actualización de reservas.
Garantiza que el hotel cobre o acredite exactamente la diferencia correspondiente según el nuevo
rango o categoría elegida.

**Independent Test**: Se toma una reserva `ACTIVE` con un `grossAmount` previo de \$300 y se
extiende dos noches adicionales. Se ejecuta la liquidación, verificando que la `RateQuote`
resultante registre `previousGrossAmount` (\$300), `grossAmount` (\$500) y `amountDifference`
(\$200 a cobrar).

**Acceptance Scenarios**:

1. **Scenario**: Recálculo exitoso con saldo a cobrar por extensión de estadía
   - **Given** una reserva `ACTIVE` cuya fecha de salida se extiende dos días
   - **When** el solicitante invoca la actualización y el sistema procesa la liquidación
   - **Then** el sistema evalúa el nuevo rango mediante "Calcular tarifa dinámica", genera la
     `RateQuote` con el `grossAmount` actualizado, y refleja el `amountDifference` a pagar por el
     huésped

2. **Scenario**: Recálculo con saldo a favor por reducción de estadía
   - **Given** una reserva `ACTIVE` cuya cantidad de noches se reduce
   - **When** se procesa la liquidación para la modificación
   - **Then** el sistema recalcula la tarifa y genera la `RateQuote` registrando la diferencia a
     favor del huésped en `amountDifference`

---

### User Story 3 - Inicialización de la Liquidación Preliminar en el Check-In (Priority: P2)

Al confirmarse un Check-In, el sistema abre la cuenta de la estadía en `Settlement` con estado
`Preliminary`, fija de manera inmutable el porcentaje de IVA vigente para el `grossAmount`
original de la reserva, y genera la `Prefactura` mutable en borrador que acumulará los consumos
hasta el Check-Out.

**Why this priority**: Garantiza que ningún consumo registrado durante la estadía quede sin un
lugar donde asentarse, y que el IVA aplicado a la reserva no cambie a mitad de la estancia aunque
la normativa fiscal se actualice.

**Independent Test**: Se simula la notificación de un Check-In exitoso y se verifica que el
sistema abra un `Settlement` en `Preliminary`, fije el `ivaPercentage` vigente en ese instante, y
genere una `Prefactura` en `Draft` asociada a la reserva.

**Acceptance Scenarios**:

1. **Scenario**: Apertura exitosa de liquidación preliminar tras Check-In
   - **Given** un Check-In confirmado con éxito en el Módulo 2
   - **When** el Módulo 2 notifica al servicio de liquidación
   - **Then** el sistema abre el `Settlement` en estado `Preliminary`, fija de forma inmutable el
     `ivaPercentage` vigente, y genera la `Prefactura` en `Draft`

2. **Scenario**: El Módulo 3 no responde durante la notificación de Check-In (Error)
   - **Given** un Check-In confirmado con éxito en el Módulo 2
   - **When** el servicio de liquidación no responde o agota el tiempo de espera
   - **Then** la admisión del huésped en el Módulo 2 permanece válida; la apertura del `Settlement`
     y la generación de la `Prefactura` quedan encoladas como `PENDING` para procesarse de forma
     asíncrona en cuanto el servicio se recupere

---

### User Story 4 - Liquidación de Penalidad por Cancelación Tardía de Reserva OTA (Priority: P3)

Cuando una reserva de canal OTA (`source` `OTA`) se cancela dentro de la ventana de penalidad
definida en el contrato de esa agencia, el sistema calcula el monto de la sanción y cierra un
`Settlement` en estado `Cancelled` con el `penaltyAmount` resultante, conservando el histórico
contable pero inhabilitando cualquier facturación adicional sobre esa reserva. Las reservas de
canal directo (`source` `DIRECT`) nunca invocan este flujo: por no cobrarse garantías al reservar,
su cancelación se resuelve de forma 100% local y gratuita en el Módulo 2, sin ningún llamado
síncrono a este servicio.

**Why this priority**: Es un flujo alternativo acotado al canal OTA, necesario para respetar los
contratos de comisión y penalidad pactados con cada agencia, pero no interviene en la operación
diaria de cancelaciones del canal directo, que se resuelve íntegramente en el Módulo 2.

**Independent Test**: Se prueba cancelando una reserva `OTA` dentro de la ventana de penalidad
contractual y verificando que el sistema calcule el `penaltyAmount` y cierre el `Settlement` en
`Cancelled`. Se completa cancelando una reserva `DIRECT`, confirmando que este servicio nunca se
invoca y que no se genera ningún `Settlement`.

**Acceptance Scenarios**:

1. **Scenario**: Cierre de liquidación con penalidad por cancelación tardía de reserva OTA
   - **Given** una reserva `source` `OTA` cancelada dentro de la ventana de penalidad contractual de
     la agencia
   - **When** el Módulo 2 invoca "Procesar liquidación y validación" para la cancelación
   - **Then** el sistema calcula el `penaltyAmount` según el contrato de la `Ota`, cierra el
     `Settlement` en estado `Cancelled` con ese monto, y conserva el histórico contable
     inhabilitando cualquier facturación adicional

2. **Scenario**: Cancelación de reserva de canal directo sin invocar este servicio
   - **Given** una reserva `source` `DIRECT` en estado `ACTIVE`
   - **When** la reserva se cancela por cualquier canal interactivo
   - **Then** el sistema no invoca "Procesar liquidación y validación": la cancelación se resuelve
     de forma 100% local y gratuita en el Módulo 2, y no se genera ningún `Settlement`

### Casos Borde

- **Cargos adicionales con montos negativos, cero o no numéricos**: si se intenta incluir un
  `ExtraCharge` cuyo monto sea menor o igual a cero o contenga caracteres no numéricos, el sistema
  intercepta la entrada, rechaza el procesamiento con **HTTP 400 (Bad Request)** y no cierra ni
  modifica el `Settlement`, prohibiendo que la inconsistencia se propague como **HTTP 500**.
- **Incoherencia en las fechas de estadía para el cálculo de noches**: si `startDate` es igual o
  posterior a `endDate`, el sistema detecta la incoherencia, no calcula ni cierra el `Settlement`,
  y responde con **HTTP 400** sin alterar registros financieros.
- **Indisponibilidad del motor de tarifas dinámicas durante el cálculo**: si "Calcular tarifa
  dinámica" no responde o falla, el sistema no asume valores por defecto ni completa la liquidación
  a cero; mantiene el `Settlement` en su estado previo e informa con **HTTP 400** que debe
  reintentarse la operación.
- **Concurrencia al confirmar simultáneamente la misma liquidación**: si dos procesos intentan
  cerrar el `Settlement` de la misma reserva de forma simultánea, el sistema utiliza control de
  concurrencia para que la primera solicitud pase a `Final`, mientras la segunda es informada de la
  actualización previa mediante **HTTP 400**.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir que el Módulo 2 invoque "Procesar liquidación y validación"
  desde los eventos de Check-In, actualización de reserva y Check-Out.
- **FR-002**: El sistema debe calcular el costo base de la estadía multiplicando la tarifa diaria
  por la cantidad exacta de noches entre `startDate` y `endDate`.
- **FR-003**: El sistema debe abrir el `Settlement` en estado `Preliminary` y fijar de forma
  inmutable el `ivaPercentage` vigente al confirmarse un Check-In.
- **FR-004**: El sistema debe generar la `Prefactura` en estado `Draft`, mutable, al abrir el
  `Settlement` de una estadía.
- **FR-005**: El sistema debe integrar en la liquidación final todos los `ExtraCharge` válidos
  vinculados a la reserva, sumando sus montos al subtotal correspondiente.
- **FR-006**: El sistema debe validar que todos los valores monetarios sean numéricos mayores o
  iguales a cero antes de realizar cualquier operación matemática.
- **FR-007**: El sistema debe generar una `RateQuote` con `previousGrossAmount`, `grossAmount` y
  `amountDifference` cuando la liquidación sea ocasionada por una actualización de reserva.
- **FR-008**: El sistema debe cerrar el `Settlement` en estado `Final` únicamente cuando el total
  acumulado de la estadía, los consumos y el IVA fijado sea matemáticamente exacto.
- **FR-009**: El sistema debe interceptar cualquier error de validación de entrada (montos
  negativos, fechas incoherentes) y responder con **HTTP 400 (Bad Request)**, prohibiendo que se
  propaguen como fallas de infraestructura **HTTP 500**.
- **FR-010**: El sistema debe mantener un registro auditable e inmutable de cada `Settlement`
  procesado, almacenando la fecha de ejecución, el actor responsable y el desglose de ítems.
- **FR-011**: El sistema debe mantener válido el evento de origen (Check-In o Check-Out) en el
  Módulo 2 aunque la apertura o el cierre del `Settlement` falle, marcando la solicitud como
  `PENDING` para reintentarse sin bloquear la operación de recepción.
- **FR-012**: El sistema debe calcular la penalidad de cancelación tardía exclusivamente para
  reservas de canal OTA, conforme al contrato vigente de la agencia, cerrando el `Settlement` en
  estado `Cancelled` con el `penaltyAmount` resultante; las reservas de canal directo no deben
  invocar este servicio al cancelarse, ya que su cancelación se procesa de forma gratuita y local
  en el Módulo 2.

### Non-Functional Requirements

- **NFR-001**: El tiempo total de procesamiento y respuesta de la liquidación debe ser inferior a
  1.5 segundos.
- **NFR-002**: Todos los cálculos monetarios deben realizarse utilizando precisión decimal exacta
  para garantizar consistencia contable.

### Key Entities *(include if feature involves data)*

- **Settlement**: Representa la cuenta financiera de una estadía. Atributos: `reservationRef`,
  `ivaPercentage` (fijado de forma inmutable en el Check-In), `extraChargesAmount`, `baseAmount`,
  `penaltyAmount` (solo aplicable cuando el `status` es `Cancelled` en una reserva de canal OTA),
  `totalAmount`, `calculatedAt`, `calculatedBy`, y `status` con los tres estados oficiales del
  ciclo de vida: `Preliminary` (se inicializa de forma mutable en el Check-In, actúa como
  estimación de prefactura y puede recalcularse), `Final` (se consolida de forma inmutable en el
  Check-Out, es único por estancia y está ligado a la factura fiscal definitiva), y `Cancelled` (se
  genera si se anula la estancia antes de la salida, conservando el histórico contable pero
  inhabilitando facturaciones).
- **Prefactura**: Representa el documento de facturación en borrador asociado a un `Settlement`.
  Atributos: `id`, `reservationRef`, `items` (detalle de tarifa y consumos), y `status` (`Draft`,
  único valor mientras el `Settlement` está en `Preliminary`). No tiene numeración oficial.
- **RateQuote**: Representa la cotización o recálculo tarifario emitido por "Calcular tarifa
  dinámica". Atributos: `reservationRef`, `previousGrossAmount`, `grossAmount`,
  `amountDifference`, `currency`, y `calculatedAt`.
- **ExtraCharge**: Representa un consumo o gasto adicional registrado durante la estadía.
  Atributos: `chargeId`, `reservationRef`, `description`, `amount`, y `registeredAt`.
- **Reservation**: Representa la estadía sobre la cual se liquida. Atributos: `reservationRef`,
  `startDate`, `endDate`, categoría o habitación asignada, `source` (`DIRECT` | `OTA`), y `state`
  con estados permitidos: `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. El estado `PENDING`
  queda inhabilitado en los flujos estándar: toda reserva nace directamente en `ACTIVE`.
- **Guest**: Representa al huésped asociado a la liquidación. Atributos: `id`, `fullName`,
  `documentNumber`, `nationality`.
- **Ota**: Se referencia únicamente para obtener el contrato de penalidad por cancelación tardía.
  Atributos relevantes: `id`, `name`, `commissionPercentage`.
- **Habitation**: Se referencia únicamente por su categoría o de forma informativa; esta
  funcionalidad no interactúa con el Módulo 1. Atributos: `habitationId`, `categoryHabitation`, y
  `stateHabitation` con los siete estados oficiales del glosario: `Available`, `Occupied`,
  `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los `Settlement` cerrados en `Final` presentan exactitud matemática
  perfecta entre la tarifa base, los `ExtraCharge`, el IVA fijado y el `totalAmount`.
- **SC-002**: El 100% de los intentos de liquidación con montos negativos o fechas inconsistentes
  se responden con **HTTP 400 (Bad Request)**; cero errores de este tipo provocan **HTTP 500**.
- **SC-003**: El 100% de los Check-In exitosos generan un `Settlement` en `Preliminary` con IVA
  fijado y `Prefactura` en `Draft`.
- **SC-004**: Una Recepcionista puede visualizar el desglose completo de una liquidación y validar
  su importe final en menos de 20 segundos.
- **SC-005**: Cero inconsistencias impositivas o descuadres monetarios son detectados durante las
  auditorías de cierre de facturación tras la implementación de esta funcionalidad.
- **SC-006**: El 100% de las cancelaciones tardías de reservas OTA con penalidad contractual
  generan un `Settlement` en `Cancelled` con el `penaltyAmount` exacto; cero reservas de canal
  directo invocan este servicio al cancelarse.
