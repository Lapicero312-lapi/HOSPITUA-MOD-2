# Especificación de Funcionalidad: Procesar Liquidación y Validación

**Creado**: 2026-09-08

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Procesar Liquidación y Validación (`Process Settlement and Validation`) es el servicio central de cálculo financiero y verificación tarifaria de la plataforma hotelera (integrado funcionalmente con el **Módulo 3**). Su objetivo es calcular, auditar y validar los montos de estadía, cargos adicionales por consumos, impuestos reglamentarios, descuentos promocionales y penalidades por cancelación, produciendo un desglose financiero transparente y validado (`Settlement` o `RateQuote`). Toda la interacción ocurre dentro de las interfaces operativas asociadas (pantalla de check-out, actualización de reserva o cancelación), por lo que las distintas etapas de cálculo, verificación de políticas y confirmación del desglose no se modelan como historias independientes sino como pasos e interacciones dentro de la misma especificación:

- Al solicitar una liquidación para una reserva (`Reservation`), el sistema analiza el rango de fechas de estadía (`startDate` a `endDate`), el tipo de habitación asignada (`assignedRoom`), los cargos adicionales por consumos o servicios (`ExtraCharge`), y los impuestos o descuentos vigentes.
- En casos de modificación de reservas existentes, el sistema procesa una re-cotización mediante `RateQuote`, determinando con precisión la diferencia financiera (`differenceAmount`) a favor o en contra del huésped.
- En solicitudes de cancelación, el sistema evalúa las reglas de políticas de cancelación (`CancellationPenalty`), determinando el monto de penalidad aplicable (`penaltyAmount`) y el saldo reembolsable resultante (`refundAmount`).
- Al resultar matemáticamente exacta y coherente con las reglas de negocio, el sistema establece el estado de la liquidación como `VALIDATED` en la entidad `Settlement`.
- Si se identifican importes inconsistentes, fechas incoherentes o datos incompletos, el sistema registra el estado como `REJECTED`, detalla los motivos en `missingFields` o notas de auditoría, y responde con una alerta controlada **HTTP 400 (Bad Request)**, impidiendo que el cobro o reembolso se aplique con errores.

**Estados de la entidad `Reservation`** (deben mantenerse en estricta concordancia en todo el sistema): `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `Settlement`**:
- `status`: `PENDING`, `VALIDATED`, `REJECTED`, `EXPIRED`, `APPLIED`.

**Estados de la entidad `RateQuote`**:
- `status`: `ACTIVE`, `EXPIRED`, `SUPERSEDED`.

**Estados de la entidad `Room`** (propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

---

### Historia de Usuario 1 - Liquidación y Validación Tarifaria Estándar para Reservas y Salidas (Prioridad: P1)

Una Recepcionista (o el Sistema de forma automatizada durante una salida o actualización) solicita la liquidación financiera final de una reserva. El sistema recopila los días de estadía, la tarifa base de la habitación, los impuestos locales aplicables y la lista de cargos adicionales registrados por consumos durante el hospedaje (`ExtraCharge`). El sistema valida que todas las cifras sean numéricas y no negativas, calcula el importe total y emite un desglose financiero en la entidad `Settlement` con estado `VALIDATED`, dejando la cuenta lista para su confirmación y cobro. Esta historia es el flujo maestro de la funcionalidad: en una sola interacción abarca el cálculo de la estadía base, la suma auditada de consumos y la validación impositiva.

**Por qué esta prioridad**: Es la funcionalidad crítica de liquidación (Happy Path). Sin este cálculo preciso y validado, el hotel no puede cerrar cuentas de huéspedes al hacer check-out, ni determinar importes exactos al crear o modificar reservas, afectando directamente el recaudo y la facturación del negocio.

**Prueba Independiente**: Se prueba de forma aislada suministrando los datos de una reserva `CHECKED_IN` con tres noches de estadía y dos `ExtraCharge` válidos (por ejemplo, servicio a la habitación y minibar). Se ejecuta la liquidación y se verifica que el sistema genere un `Settlement` en estado `VALIDATED` cuyo `totalAmount` coincida exactamente con la suma de la tarifa base, consumos e impuestos. La prueba se complementa enviando un cargo adicional con monto negativo, confirmando que la liquidación se rechaza con resultado `REJECTED` y una respuesta **HTTP 400 (Bad Request)**.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Liquidación exitosa de estadía con cargos adicionales para check-out
   - **Dado** una reserva en estado `CHECKED_IN` con tarifa diaria base y dos cargos adicionales (`ExtraCharge`) válidos registrados
   - **Cuando** la Recepcionista procesa la liquidación y validación final para la salida del huésped
   - **Entonces** el sistema calcula el valor total de las noches hospedadas, suma los cargos adicionales, aplica los impuestos correspondientes, y genera una entidad `Settlement` en estado `VALIDATED` con el desglose ítemizado y el `totalAmount` correcto para su cobro

2. **Escenario**: Re-cotización y liquidación con saldo diferencial por cambio de fechas o habitación
   - **Dado** una reserva en estado `ACTIVE` cuyo rango de fechas o tipo de habitación se actualiza
   - **Cuando** el solicitante invoca el procesamiento de liquidación y validación del cambio
   - **Entonces** el sistema genera una `RateQuote` en estado `ACTIVE` calculando la diferencia entre el `previousAmount` y el `newAmount`, presenta el `differenceAmount` resultante (saldo a favor o a pagar), y establece la liquidación en `VALIDATED` tras la verificación

*Escenarios de Error / Caminos Tristes*

3. **Escenario**: Rechazo controlado por monto de cargo adicional inválido o negativo
   - **Dado** una reserva en proceso de liquidación
   - **Cuando** se incluye un `ExtraCharge` con un valor numérico menor o igual a cero o con formato no numérico
   - **Entonces** el sistema detiene el procesamiento, marca el `Settlement` en estado `REJECTED`, y responde con un error de negocio controlado **HTTP 400 (Bad Request)** especificando que todos los cargos deben poseer montos positivos válidos

4. **Escenario**: Rechazo por fechas de estadía lógicamente incoherentes en el cálculo tarifario
   - **Dado** una reserva cuyas fechas ingresadas presentan una fecha de salida (`endDate`) igual o anterior a la fecha de llegada (`startDate`)
   - **Cuando** se solicita procesar la liquidación tarifaria
   - **Entonces** el sistema bloquea el cálculo, establece la liquidación en estado `REJECTED`, y retorna una alerta **HTTP 400 (Bad Request)** indicando la incoherencia del rango de fechas

---

### Historia de Usuario 2 - Liquidación de Penalidades por Cancelación o Anulación Tardía (Prioridad: P2)

Cuando una reserva en estado `PENDING` o `ACTIVE` es cancelada por la Recepcionista o por el Huésped, el sistema procesa la liquidación de cancelación. El sistema evalúa la fecha y hora de la solicitud frente a la fecha de inicio de la reserva (`startDate`), determina la regla de penalidad aplicable en `CancellationPenalty`, y calcula el valor de la sanción (`penaltyAmount`) y el saldo neto a reembolsar (`refundAmount`), emitiendo un `Settlement` en estado `VALIDATED`.

**Por qué esta prioridad**: Es un flujo alternativo importante para la gestión financiera. Asegura que las cancelaciones apliquen de manera transparente las políticas del hotel, evitando cobros indebidos o pérdidas por retención incorrecta de depósitos.

**Prueba Independiente**: Se puede probar solicitando la liquidación de cancelación sobre una reserva `ACTIVE` dentro del periodo de penalidad (por ejemplo, a menos de 24 horas del ingreso). Se verifica que el sistema consulte la regla de `CancellationPenalty`, calcule la penalidad correspondiente, defina el `refundAmount` neto, y marque el `Settlement` como `VALIDATED`. Se repite la prueba con una cancelación anticipada fuera del rango de sanción, confirmando que la penalidad se registre en cero y el reembolso sea del 100%.

**Escenarios de Aceptación**:

1. **Escenario**: Liquidación de cancelación con aplicación de penalidad por notificación tardía
   - **Dado** una reserva en estado `ACTIVE` cuya cancelación se solicita dentro de la ventana de tiempo sujeta a sanción
   - **Cuando** la Recepcionista procesa la liquidación de la cancelación
   - **Entonces** el sistema aplica la regla de `CancellationPenalty` correspondiente, calcula el `penaltyAmount`, determina el `refundAmount` neto a favor del huésped, y emite un `Settlement` en estado `VALIDATED` con el detalle claro de la retención

2. **Escenario**: Liquidación de cancelación con reembolso completo por anulación anticipada
   - **Dado** una reserva en estado `PENDING` o `ACTIVE` cuya anulación se solicita con suficiente anticipación según la política libre de penalidad
   - **Cuando** el solicitante procesa la liquidación de cancelación
   - **Entonces** el sistema registra un `penaltyAmount` de cero, establece el `refundAmount` igual al total de abonos realizados, y emite el `Settlement` en estado `VALIDATED` habilitando la devolución completa

---

### Historia de Usuario 3 - Recotización y Ajustes Tarifarios por Descuentos o Promociones (Prioridad: P3)

La Recepcionista ingresa un código de descuento promocional o beneficio comercial autorizado sobre el desglose de una liquidación en borrador para una reserva `ACTIVE`. El sistema valida la vigencia y condiciones del cupón, aplica la deducción al subtotal de la estadía y actualiza el `Settlement` en estado `VALIDATED`.

**Por qué esta prioridad**: Es una característica deseable que otorga flexibilidad comercial para fidelización de clientes y promociones especiales, pero no es indispensable para la operación básica diaria del sistema de cobros.

**Prueba Independiente**: Se prueba aplicando un código de descuento válido sobre una liquidación en borrador. Se verifica que el sistema valide las reglas del descuento, descuente el porcentaje o monto correspondiente en el desglose de `RateQuote`, y genere el `Settlement` final en estado `VALIDATED` con el total ajustado. Se envía un código vencido para comprobar que el sistema rechace el beneficio con un código **HTTP 400 (Bad Request)** y mantenga la tarifa base.

**Escenarios de Aceptación**:

1. **Escenario**: Aplicación exitosa de un descuento promocional en la liquidación
   - **Dado** una liquidación en borrador asociada a una reserva `ACTIVE`
   - **Cuando** la Recepcionista ingresa un código de descuento promocional válido y procesa la validación
   - **Entonces** el sistema calcula la deducción correspondiente, añade el ítem de descuento en el desglose, actualiza la `RateQuote` en estado `ACTIVE`, y genera el `Settlement` en estado `VALIDATED` con el valor final ajustado

2. **Escenario**: Rechazo de descuento por código promocional expirado o no aplicable
   - **Dado** una solicitud de liquidación tarifaria
   - **Cuando** el solicitante ingresa un código de descuento vencido o que no aplica a la categoría de habitación reservada
   - **Entonces** el sistema rechaza el descuento, responde con una alerta **HTTP 400 (Bad Request)** indicando la invalidez del beneficio, y mantiene el `Settlement` en su tarifa estándar sin modificaciones

---

### Casos Borde

- **Cargos adicionales con montos negativos, cero o no numéricos**: si se intenta incluir en la liquidación un `ExtraCharge` cuyo monto sea menor o igual a cero o contenga caracteres no numéricos, el sistema debe interceptar la entrada, rechazar el procesamiento con un código **HTTP 400 (Bad Request)** controlado y un mensaje amigable, prohibiendo que la inconsistencia se propague como una excepción de servidor **HTTP 500**.
- **Incoherencia o inversión en las fechas de estadía para el cálculo de noches**: si la fecha de llegada (`startDate`) es igual o posterior a la fecha de salida (`endDate`), el sistema debe detectar la incoherencia matemática, marcar el `Settlement` con resultado `REJECTED` y responder con **HTTP 400 (Bad Request)** sin efectuar cálculos ni alterar registros financieros.
- **Caracteres especiales o intentos de inyección en las descripciones de cargos**: si la descripción de un consumo o nota de liquidación contiene patrones sospechosos o caracteres no permitidos, el sistema debe sanitizar la entrada y rechazar la solicitud con **HTTP 400 (Bad Request)** para proteger la seguridad del servicio.
- **Indisponibilidad del motor de tarifas dinámicas (Módulo 3) durante el cálculo**: si el servicio externo de tarificación o cotización no responde o falla al ser consultado, el sistema no debe asumir valores por defecto ni completar la liquidación a cero; debe establecer la liquidación temporal en `REJECTED` o `PENDING`, e informar al usuario con un error controlado **HTTP 400** indicando que debe reintentarse la operación.
- **Concurrencia al confirmar simultáneamente la misma liquidación**: si dos usuarios intentan validar y confirmar la liquidación de la misma reserva de forma simultánea, el sistema utiliza control de concurrencia para que la primera solicitud pase a `VALIDATED` / `APPLIED`, mientras la segunda es informada de la actualización previa mediante un mensaje seguro **HTTP 400**.

---

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE permitir a la `Receptionist` o al `System` invocar el procesamiento de liquidación y validación financiera para reservas en estado `PENDING`, `ACTIVE` o `CHECKED_IN`.
- **FR-002**: El sistema DEBE calcular el costo base de la estadía multiplicando la tarifa diaria de la habitación por la cantidad exacta de noches entre `startDate` y `endDate`.
- **FR-003**: El sistema DEBE integrar en la liquidación todos los cargos adicionales (`ExtraCharge`) válidos vinculados a la reserva, sumando sus montos al subtotal correspondiente.
- **FR-004**: El sistema DEBE calcular e ítemizar explícitamente los impuestos aplicables y los descuentos autorizados sobre el subtotal de la estadía.
- **FR-005**: El sistema DEBE validar que todos los valores monetarios de tarifa base, cargos adicionales e impuestos sean numéricos mayores o iguales a cero antes de realizar cualquier operación matemática.
- **FR-006**: El sistema DEBE aplicar las reglas registradas en la entidad `CancellationPenalty` para calcular el `penaltyAmount` y el `refundAmount` neto en liquidaciones por cancelación de reserva.
- **FR-007**: El sistema DEBE registrar la entidad `Settlement` en estado `VALIDATED` únicamente cuando el total acumulado de la estadía, consumos, impuestos y penalidades sea matemáticamente exacto y consistente.
- **FR-008**: El sistema DEBE asignar el estado `REJECTED` a la entidad `Settlement` cuando se identifiquen inconsistencias en los importes, fechas inválidas o errores de cálculo.
- **FR-009**: El sistema DEBE generar una `RateQuote` que especifique el monto anterior (`previousAmount`), el nuevo monto (`newAmount`) y la diferencia resultante (`differenceAmount`) cuando la liquidación sea ocasionada por una modificación de reserva.
- **FR-010**: El sistema DEBE exigir la confirmación explícita de la `Receptionist` o del `Guest` antes de cambiar una liquidación en estado `VALIDATED` al estado `APPLIED`.
- **FR-011**: El sistema DEBE interceptar cualquier error de validación de entrada (montos negativos, fechas incoherentes, cupones vencidos) y responder estrictamente con códigos **HTTP 400 (Bad Request)** acompañados de mensajes claros; el sistema DEBE prohibir que estos errores se propaguen como fallas de infraestructura **HTTP 500**.
- **FR-012**: El sistema DEBE mantener un registro auditable e inmutable de cada `Settlement` procesado, almacenando la fecha de ejecución, el actor responsable, el desglose de ítems y el importe total resultante.

### Requisitos No Funcionales

- **NFR-001**: El tiempo total de procesamiento y respuesta de la liquidación y validación financiera en el servidor DEBE ser inferior a 1.5 segundos.
- **NFR-002**: Todos los cálculos monetarios DEBEN realizarse utilizando precisión decimal exacta para garantizar un 100% de consistencia contable en las operaciones.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Settlement**: Representa el resultado formal de la liquidación financiera. Atributos clave: `settlementId` (identificador único), `reservationRef` (referencia a la `Reservation`), `baseRate` (tarifa base de estadía), `taxesAmount` (monto total de impuestos), `discountsAmount` (monto total de descuentos), `extraChargesAmount` (suma de cargos adicionales), `penaltyAmount` (monto por penalidad si aplica), `refundAmount` (monto a reembolsar si aplica), `totalAmount` (importe total neto a pagar o cobrar), `currency` (moneda), `calculatedAt` (fecha y hora del procesamiento), `calculatedBy` (actor responsable: `Receptionist`, `Guest` o `System`), y `status` (`PENDING`, `VALIDATED`, `REJECTED`, `EXPIRED`, `APPLIED`).
- **RateQuote**: Representa la cotización o desglose tarifario dinámico. Atributos clave: `quoteId`, `reservationRef`, `previousAmount` (monto previo), `newAmount` (monto recalculado), `differenceAmount` (diferencia a favor o en contra), `breakdown` (detalle por concepto), `validUntil` (vigencia de la cotización), y `status` (`ACTIVE`, `EXPIRED`, `SUPERSEDED`).
- **ExtraCharge**: Representa un consumo o gasto adicional realizado durante la estadía. Atributos clave: `chargeId`, `reservationRef`, `description` (descripción del servicio), `amount` (monto del cargo), `category` (categoría), y `registeredAt` (fecha de registro).
- **CancellationPenalty**: Representa la regla de penalización por anulación de reserva. Atributos clave: `policyId`, `penaltyPercentage` (porcentaje de retención), `penaltyAmount` (monto resultante de sanción), y `refundableAmount` (monto saldo a devolver).
- **Reservation**: Representa la estadía sobre la cual se liquida. Atributos clave: `reservationRef`, `startDate`, `endDate`, `assignedRoom`, `source`, y `status` (`PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`).
- **Guest**: Representa al huésped asociado a la liquidación. Atributos clave: `fullName`, `documentId`, `nationality`, y `type` (`NATIONAL` | `FOREIGN`).

---

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de las liquidaciones registradas en estado `VALIDATED` presentan una exactitud matemática perfecta entre la tarifa base, los cargos adicionales, los impuestos, los descuentos y el `totalAmount` resultante.
- **SC-002**: El 100% de los intentos de liquidación con montos negativos, fechas inconsistentes o valores no numéricos se responden con errores controlados **HTTP 400 (Bad Request)**; cero errores de este tipo provocan fallos de infraestructura **HTTP 500**.
- **SC-003**: El 100% de las liquidaciones por cancelación aplican con exactitud las reglas de `CancellationPenalty` de acuerdo con el margen de anticipación de la solicitud.
- **SC-004**: Una Recepcionista puede visualizar el desglose completo de una liquidación y validar su importe final en menos de 20 segundos durante las operaciones de recepción.
- **SC-005**: Cero inconsistencias impositivas o descuadres monetarios son detectados durante las auditorías de cierre de facturación tras la implementación de esta funcionalidad.
