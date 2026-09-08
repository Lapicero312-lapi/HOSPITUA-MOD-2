# Feature Specification: Registro de Check-In

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

La llegada de un huésped al hotel es un momento sensible: el cliente quiere entrar a su habitación
cuanto antes y el hotel necesita, en ese mismo acto, dejar tres cosas resueltas. Primero, admitir
formalmente al huésped y, cuando es extranjero, verificar sus datos migratorios de forma local
para cumplir con la normativa sin frenar el ingreso. Segundo, disparar la ocupación física de la
habitación en el Módulo 1, para que el inventario refleje de inmediato que esa habitación ya no
está disponible y no se produzca una sobreventa física. Tercero, inicializar las cuentas
financieras de la estancia en el Módulo 3, de modo que todo consumo posterior tenga dónde
registrarse y no se pierdan cobros. Si el check-in se opera sin esas tres integraciones, aparecen
filas en recepción, habitaciones vendidas dos veces y consumos que nunca llegan a la factura. El
negocio necesita un ingreso ágil, en una sola pantalla, que deje la reserva en `CHECKED_IN`, la
habitación en `Occupied` y la liquidación preliminar abierta.

### Flujo de Usuario de Alto Nivel

1. El **Recepcionista** ubica la reserva del huésped mediante el caso de uso interno "Consultar /
   ver reserva" y el sistema valida que se encuentre en estado `ACTIVE` y que la estadía incluya
   la fecha de hoy.
2. Si el huésped es extranjero (`FOREIGN`), el sistema exige y valida de forma local los datos
   migratorios mínimos (`MigratoryValidation`) antes de permitir la confirmación.
3. El sistema presenta un resumen de confirmación en pantalla con el huésped, la habitación
   asignada, las fechas de estadía y la referencia de la reserva.
4. Tras la confirmación explícita del **Recepcionista**, el sistema cambia el estado de la reserva
   a `CHECKED_IN` de forma local y registra la hora real de llegada.
5. El sistema solicita de forma asíncrona al **Módulo 1**, mediante el caso de uso `Set Habitation
   State` ("Establecer el estado de la habitación"), transicionar la `Habitation` asignada a
   `Occupied`.
6. El sistema notifica de forma asíncrona al **Módulo 3** ("Procesar liquidación y validación")
   para: registrar la liquidación de la estancia en estado `Preliminary` (abierta, estimada y
   mutable), generar el documento en borrador de la `Prefactura` (sin numeración oficial), y fijar
   de manera inmutable el porcentaje de IVA vigente para el Valor de hospedaje bruto original.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registro de Check-In de un Huésped (Priority: P1)

El **Recepcionista** admite a un huésped cuya reserva está en estado `ACTIVE` y cuya estadía
incluye el día de hoy. En una sola pantalla ubica la reserva, confirma la identidad y los datos
del huésped, valida los datos migratorios si el huésped es extranjero, y confirma el ingreso. Por
tratarse de una única vista, tanto el camino feliz (huésped nacional o extranjero) como los
bloqueos lógicos (reserva en estado inválido, llegada anticipada, habitación no lista físicamente,
datos incompletos) se consolidan en esta misma historia de usuario y no se modelan como pantallas
ni historias separadas, para evitar la sobre-atomización. Al completarse con éxito, la reserva
queda en `CHECKED_IN`, la `Habitation` se solicita al Módulo 1 para pasar a `Occupied`, y el
Módulo 3 recibe la notificación para inicializar la liquidación `Preliminary`, fijar el IVA
vigente y generar la `Prefactura` en borrador.

**Why this priority**: Es el flujo principal y de mayor frecuencia del módulo. Admitir formalmente
al huésped es lo que da inicio a la estadía; asegurar la ocupación en el Módulo 1 en el mismo acto
evita sobreventas físicas, e inicializar de inmediato las cuentas preliminares en el Módulo 3
garantiza que ningún consumo posterior quede sin registrar. Sin este flujo, el hotel no puede
operar la recepción de llegadas de forma ordenada ni con trazabilidad financiera.

**Independent Test**: Se puede probar de forma aislada tomando una reserva en estado `ACTIVE` cuya
estadía incluya la fecha de hoy, ejecutando el check-in de un huésped nacional y de uno extranjero
con datos migratorios completos, y confirmando en ambos casos que la reserva pasa a `CHECKED_IN`,
que se emite la solicitud al Módulo 1 para poner la `Habitation` en `Occupied`, y que se notifica
al Módulo 3 para registrar la liquidación `Preliminary`, fijar el IVA y generar la `Prefactura`.
La prueba se completa intentando el check-in sobre una reserva inexistente, una `CANCELLED`, una
cuya fecha de llegada aún no ocurre y una asignada a una habitación que no está lista físicamente,
confirmando que cada intento se bloquea con una razón clara y sin efectos colaterales.

**Acceptance Scenarios**:

1. **Scenario**: Huésped nacional con reserva activa es admitido (Happy Path)
   - **Given** que existe una reserva en estado `ACTIVE` para un huésped nacional cuya estadía
     incluye la fecha de hoy, con una categoría o `Habitation` asignada
   - **When** el **Recepcionista** confirma la identidad del huésped y envía el check-in
   - **Then** el sistema presenta un resumen de confirmación en pantalla; al recibir la
     confirmación explícita, cambia el estado de la reserva a `CHECKED_IN`, solicita al Módulo 1
     cambiar el estado físico de la `Habitation` a `Occupied` mediante `Set Habitation State`, y
     notifica al Módulo 3 para registrar la liquidación `Preliminary`, fijar el IVA y generar la
     `Prefactura`

2. **Scenario**: Huésped extranjero con datos migratorios completos es admitido
   - **Given** que existe una reserva en estado `ACTIVE` para un huésped extranjero con todos los
     datos de `MigratoryValidation` válidos
   - **When** el **Recepcionista** procesa el check-in
   - **Then** el sistema valida localmente que los datos migratorios estén completos (nacionalidad,
     pasaporte o visa, fechas), permite confirmar la admisión, cambia el estado de la reserva a
     `CHECKED_IN`, solicita al Módulo 1 cambiar la `Habitation` a `Occupied`, y notifica al
     Módulo 3 para inicializar los registros de liquidación `Preliminary` y la `Prefactura`

3. **Scenario**: Bloqueo de admisión si la habitación asignada no está lista físicamente (Error)
   - **Given** que la `Habitation` asignada en el Módulo 1 se encuentra en estado `PendingCleaning`,
     `InCleaning` o `DisabledForRepairs`
   - **When** el Recepcionista intenta realizar el check-in
   - **Then** el sistema bloquea la admisión, informa la condición bloqueante de aseo o
     mantenimiento y permite al Recepcionista cambiar o reasignar una categoría equivalente
     disponible en el Módulo 2 antes de continuar

---

### User Story 2 - Check-In Parcial en Reservas Grupales (Priority: P3)

Cuando una reserva grupal incluye varios huéspedes y solo algunos llegan el día previsto, el
Recepcionista puede admitir únicamente a los huéspedes presentes, dejando a los demás pendientes
sobre la misma reserva. Mejora la operación de grupos que no llegan completos, pero no es
indispensable para que el negocio funcione.

**Acceptance Scenarios**:

1. **Scenario**: Admisión parcial de un grupo
   - **Given** una reserva grupal en estado `ACTIVE` con múltiples huéspedes y múltiples
     habitaciones asignadas
   - **When** el Recepcionista registra el check-in únicamente para los huéspedes presentes
   - **Then** el sistema marca a esos huéspedes individuales como hospedados, notifica al Módulo 1
     cambiar a `Occupied` solo sus habitaciones específicas, notifica al Módulo 3 para generar la
     liquidación `Preliminary` por el total consumido, y mantiene la reserva abierta para el resto
     de los acompañantes pendientes

---

### Casos Borde

- ¿Qué sucede si el Módulo 3 (Pricing) no responde o experimenta un timeout durante la
  notificación de Check-In? La admisión física en el Módulo 2 y la ocupación en el Módulo 1
  persisten y se completan con éxito, pero la solicitud de generación de `Prefactura` y de fijación
  del IVA queda encolada de forma local como `PENDING` para procesarse de forma asíncrona en
  cuanto el Módulo 3 se recupere, de modo que el huésped no espera en recepción.
- ¿Cómo maneja el sistema si la llamada de actualización de estado de la habitación (`Set
  Habitation State`) al Módulo 1 falla después de haber registrado el Check-In con éxito? El
  Check-In permanece válido y la reserva se mantiene en `CHECKED_IN`; la solicitud de cambio de
  estado de la `Habitation` a `Occupied` queda marcada de forma local como `PENDING` para
  reintentarse de forma asíncrona en segundo plano, sin obligar a repetir la admisión del huésped.
- ¿Qué sucede si el Recepcionista intenta realizar el check-in hoy, pero la fecha de llegada de la
  reserva es posterior (llegada anticipada)? El sistema bloquea la operación con un error
  controlado **HTTP 400** e indica que la reserva debe actualizarse primero en la pantalla
  "Actualizar Reservación" para extender las fechas; no crea ningún registro de check-in ni
  modifica el estado de la reserva o de la habitación.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe exigir que el recepcionista busque y valide la existencia de la
  reserva mediante el caso de uso interno "Consultar / ver reserva" de forma local antes de
  iniciar cualquier check-in.
- **FR-002**: El sistema debe validar que la reserva se encuentre estrictamente en estado `ACTIVE`
  y que sus fechas de estadía incluyan la fecha actual para autorizar el check-in.
- **FR-003**: Al registrar el check-in de un huésped extranjero (`FOREIGN`), el sistema debe
  exigir y validar localmente los datos migratorios mínimos (`MigratoryValidation`) de forma
  obligatoria antes de confirmar.
- **FR-004**: Al completarse exitosamente el check-in, el sistema debe cambiar el estado de la
  reserva a `CHECKED_IN` de forma local y registrar la hora real de llegada (`arrivalTime`) y el
  recepcionista responsable.
- **FR-005**: Al completarse exitosamente el check-in, el sistema debe solicitar de forma
  asíncrona al Módulo 1 cambiar el estado físico de la `Habitation` asignada a `Occupied` mediante
  el caso de uso `Set Habitation State`.
- **FR-006**: Al completarse exitosamente el check-in, el sistema debe notificar al Módulo 3
  ("Procesar liquidación y validación") para inicializar la liquidación en estado `Preliminary`,
  fijar de manera inmutable el porcentaje de IVA vigente de la estancia y generar la `Prefactura`
  mutable en borrador.
- **FR-007**: El sistema debe mantener válido el Check-In registrado a nivel del Módulo 2 aunque
  las solicitudes asíncronas de cambio de estado al Módulo 1 o de prefacturación al Módulo 3
  fallen, marcando dichos envíos como `PENDING` para reintentarse de forma automática sin bloquear
  la admisión del huésped.
- **FR-008**: El sistema debe rechazar con un error controlado **HTTP 400 (Bad Request)**
  cualquier intento de check-in cuya fecha actual sea anterior al inicio de la estadía reservada
  (llegada anticipada), informando que la reserva debe modificarse primero en la pantalla
  "Actualizar Reservación".
- **FR-009**: El sistema debe interceptar cualquier inconsistencia de datos o dato vacío para
  retornar errores estructurados **HTTP 400 (Bad Request)** amigables, prohibiendo que escalen a
  un error **HTTP 500 (Internal Server Error)**.

### Non-Functional Requirements

- **NFR-001**: El tiempo para validar los datos locales de la reserva y de la disponibilidad no
  debe superar los 200 milisegundos en el Módulo 2.

### Key Entities *(include if feature involves data)*

- **CheckIn**: Representa la admisión formal de un huésped en el hotel para una reserva específica.
  Atributos: `id`, `reservationRef`, `arrivalTime` (hora real de llegada), `receptionist`
  (identificador del recepcionista), `status` (`IN_HOUSE`, único valor que esta funcionalidad
  asigna), `habitationRequestStatus` (`PENDING` | `COMPLETED`, seguimiento del cambio de estado
  enviado al Módulo 1) y `billingRequestStatus` (`PENDING` | `COMPLETED`, seguimiento de la
  notificación enviada al Módulo 3).
- **Reservation**: Representa la estadía reservada sobre la que opera el check-in. Atributos:
  `reservationRef`, `guestList`, `assignedHabitation`, `startDate`, `endDate`, `source`
  (`DIRECT` | `OTA`) y `state` con estados permitidos: `PENDING`, `ACTIVE`, `CHECKED_IN`,
  `CHECKED_OUT`, `CANCELLED`. Solo puede pasar a `CHECKED_IN` desde el estado `ACTIVE`.
- **Habitation**: Representa la habitación física, cuya gestión de estado es propiedad del
  Módulo 1. Atributos: `habitationId`, `numberHabitation` y `stateHabitation` con los siete
  estados oficiales del glosario: `Available`, `Occupied`, `PendingCleaning`, `InCleaning`,
  `DisabledForRepairs`, `TechnicalBlock`, `Inactive`. El check-in solo puede finalizarse contra
  una `Habitation` en estado `Available`, y como resultado se solicita su transición a `Occupied`.
- **MigratoryValidation**: Representa la validación local de los datos migratorios de un `Guest`
  extranjero (`FOREIGN`). Atributos: `guestRef`, `submittedData` (nacionalidad, documento o visa,
  fechas de estadía), `result` (`PASSED` | `FAILED`) y `missingFields`. Los datos validados quedan
  almacenados localmente; su exportación hacia Migración mediante "Exportar archivo SIRE" es un
  caso de uso independiente y desacoplado de esta funcionalidad. Es obligatoria para cada `Guest`
  `FOREIGN` antes de que su `CheckIn` pueda completarse.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El Recepcionista puede completar el ingreso de un huésped nacional en menos de 1.5
  minutos, incluyendo el envío asíncrono de las notificaciones al Módulo 1 y al Módulo 3.
- **SC-002**: El 100% de los ingresos completados sobre huéspedes extranjeros cuentan con sus
  datos de `MigratoryValidation` validados y almacenados localmente de forma obligatoria.
- **SC-003**: Cero inconsistencias de infraestructura o caídas de integración con el Módulo 3 o el
  Módulo 1 propagan un error HTTP 500; todas se resuelven con fallbacks controlados o reintentos
  asíncronos marcados como `PENDING`.
