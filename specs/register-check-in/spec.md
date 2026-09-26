# Feature Specification: Registrar Check-In (Notificación)

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

El Check-In es un proceso presencial que ocurre en la recepción física del hotel: se entrega la
habitación y, si el huésped es extranjero, se capturan sus datos migratorios. Ese proceso pertenece
al Módulo 1, que es quien opera el hotel en persona y quien ya pasó la `Room` correspondiente a
`Occupied`. El Módulo 2, que gestiona el ciclo de vida de las reservas, no expone ninguna interfaz
de Check-In propia: solo necesita enterarse de que el huésped ya ingresó para actualizar el estado
de su reserva y conservar los datos migratorios que exige el reporte a Migración. Módulo 2 no altera
en ningún momento el estado físico de la `Room`, que ya fue actualizado por el Módulo 1. Si esa
notificación no se procesa, las reservas quedan desactualizadas y el reporte SIRE incompleto.

### Flujo de Usuario de Alto Nivel

1. El Módulo 1 ejecuta el Check-In físico de forma presencial en Recepción, cambiando la `Room`
   correspondiente a `Occupied`.
2. El Módulo 1 envía a la API del Módulo 2 una notificación con la `reservationRef` y, si el
   huésped es extranjero, sus datos migratorios (tipo de movimiento y fecha).
3. El sistema valida que la `Reservation` se encuentre en `Reservation.state` `ACTIVE`.
4. El sistema transiciona la `Reservation` a `Reservation.state` `IN_PROGRESS`.
5. Si la notificación incluye datos migratorios, el sistema los valida y los registra en un
   `MigratoryMovement` de esa reserva mediante "Procesar datos de huéspedes extranjeros", y responde
   **HTTP 200**.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Sincronización de Estado e Integración de Extranjeros (Priority: P2)

**Plain Language**: Recepción de la notificación de Check-In del Módulo 1 para sincronizar el
estado de la `Reservation` a `IN_PROGRESS` y consolidar, en la misma petición, los datos migratorios
de huéspedes extranjeros, sin exponer ninguna interfaz de Check-In propia ni alterar el estado
físico de la `Room`.

El Módulo 2 recibe la notificación de Check-In ejecutado en el Módulo 1 para actualizar el estado de
la `Reservation` y consolidar los datos migratorios de huéspedes extranjeros, sin duplicar el
proceso en pantallas diferentes. Por tratarse de una única notificación, el camino exitoso, la
recepción de datos migratorios, los rechazos por estado inválido y el reenvío idempotente se
consolidan en esta misma historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Es vital para mantener la coherencia del estado de la reserva y para no
duplicar la operación física, que pertenece al Módulo 1. Integra en una sola petición los datos del
reporte gubernamental. Se prioriza como P2 por tratarse de una notificación de sincronización, no
del flujo transaccional de venta.

**Independent Test**: Se envía una notificación simulada del Módulo 1 con el identificador de la
reserva y datos migratorios opcionales, y se valida que el estado cambie a `IN_PROGRESS` y que los
datos migratorios queden registrados en un `MigratoryMovement` de esa reserva. La prueba se completa
enviando notificaciones sobre reservas en un estado inválido, confirmando el rechazo y el registro
de la incidencia de conciliación, y reenviando la misma notificación para confirmar el
comportamiento idempotente.

**Acceptance Scenarios**:

1. **Escenario 1**: Actualización de estado por notificación válida (Happy Path - `IN_PROGRESS`)

   ```gherkin
   Given una Reservation en Reservation.state ACTIVE
   When el sistema recibe la notificación del Módulo 1 indicando que el Check-In se completó
   Then el sistema transiciona la Reservation a Reservation.state IN_PROGRESS
   And no realiza ninguna alteración sobre el estado físico de la Room
   ```

2. **Escenario 2**: Recepción y consolidación de datos migratorios de extranjero (`FOREIGN`)

   ```gherkin
   Given una Reservation de un Guest con type FOREIGN en proceso de Check-In
   When la notificación incluye el movementType y la fecha de ingreso migratorio
   Then el sistema los valida y los registra en un MigratoryMovement asociado a esa reserva
   And responde HTTP 200
   ```

3. **Escenario 3**: Rechazo de notificación con estado inválido y registro de `ReconciliationIncident` (Error)

   ```gherkin
   Given una Reservation en Reservation.state PENDING, COMPLETED, CANCELLED o NO_SHOW
   When el Módulo 1 envía una notificación de Check-In retrasada o prematura
   Then el sistema no modifica el Reservation.state
   And registra un ReconciliationIncident con origin CHECK_IN
   And responde con un error controlado HTTP 400 (Bad Request) indicando que la reserva no admite un Check-In en su estado actual
   ```

4. **Escenario 4**: Reenvío idempotente para completar datos migratorios en estado `IN_PROGRESS`

   ```gherkin
   Given una Reservation en Reservation.state IN_PROGRESS cuyo MigratoryMovement está INCOMPLETE
   When el Módulo 1 reenvía la notificación de Check-In con los datos migratorios completos
   Then el sistema no vuelve a modificar el Reservation.state
   And actualiza únicamente ese MigratoryMovement a validationStatus COMPLETE
   And responde HTTP 200
   ```

## 3. Casos Borde

- **Caso Borde 1**: Payload sin identificador de reserva. El sistema intercepta el error de
  inmediato y responde con un error controlado **HTTP 400 (Bad Request)**.
- **Caso Borde 2**: Reserva no encontrada en el Módulo 2. El sistema responde con **HTTP 400 (Bad
  Request)** y registra un `ReconciliationIncident`, porque el Módulo 1 ya ocupó físicamente una
  habitación sin que exista una reserva vigente que la respalde.
- **Caso Borde 3**: Notificación duplicada sobre una reserva ya en `IN_PROGRESS`. El sistema
  responde **HTTP 200** de forma idempotente, sin alterar el `Reservation.state`; solo si la
  notificación trae datos migratorios completos y el `MigratoryMovement` de esa reserva está
  `INCOMPLETE`, lo actualiza a `COMPLETE`.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe limitarse a exponer un endpoint de API para recibir la notificación
  del Módulo 1, sin ofrecer ninguna interfaz propia de Check-In presencial.
- **FR-002**: El sistema debe validar que la `Reservation` se encuentre en `Reservation.state`
  `ACTIVE` antes de procesar la notificación como transición nueva.
- **FR-003**: El sistema debe transicionar la `Reservation` a `Reservation.state` `IN_PROGRESS` al
  recibir una notificación válida.
- **FR-004**: El sistema debe recibir y consolidar, en la misma petición, los datos migratorios de
  huéspedes `FOREIGN`, registrándolos en un `MigratoryMovement` de esa reserva.
- **FR-005**: El sistema debe registrar un `ReconciliationIncident` y responder **HTTP 400 (Bad
  Request)** cuando la reserva notificada no exista o se encuentre en un `Reservation.state` que no
  admite Check-In (`PENDING`, `COMPLETED`, `CANCELLED` o `NO_SHOW`).
- **FR-006**: El sistema debe interceptar los errores de estructura o de seguridad del payload y
  responder con **HTTP 400 (Bad Request)**, quedando estrictamente prohibida la propagación de
  excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El procesamiento de la notificación debe completarse en menos de 500 milisegundos.

## 5. Entidades Clave

- **Reservation**: Reserva que transiciona a `IN_PROGRESS`. Atributos: `reservationRef`,
  `guestRef`, `categoryRoom` y `Reservation.state` (`PENDING`, `ACTIVE`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Guest**: Huésped titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`,
  `nationality` y `type` (`NATIONAL` | `FOREIGN`).
- **MigratoryMovement**: Movimiento migratorio de la estadía de un huésped `FOREIGN`. Atributos:
  `movementId`, `reservationRef`, `guestRef` y `validationStatus` (`COMPLETE` | `INCOMPLETE`).
- **ReconciliationIncident**: Registro de una discrepancia entre el Módulo 1 y el Módulo 2 que una
  persona debe resolver. Atributos: `incidentId`, `origin` (`CHECK_IN`), `reservationRef`, `reason`,
  `createdAt` y `resolutionStatus`.
- **Room**: Habitación física controlada por el Módulo 1, ya pasada a `Occupied` antes de esta
  notificación. Atributos: `categoryRoom`, `roomId` y `numberRoom`. Estados físicos administrados
  por el Módulo 1: `Available`, `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`,
  `TechnicalBlock` e `Inactive`.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las notificaciones válidas actualizan la reserva a `IN_PROGRESS`.
- **SC-002**: El 100% de los datos migratorios recibidos quedan registrados en `MigratoryMovement`.
- **SC-003**: Cero errores **HTTP 500**; el 100% de los rechazos generan un
  `ReconciliationIncident` y responden **HTTP 400**.
