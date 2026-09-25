# Feature Specification: Registrar Check-In (Notificación)

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

El Check-In es un proceso presencial que ocurre en la recepción física del hotel: se entrega la
habitación y, si el huésped es extranjero, se capturan sus datos migratorios. Ese proceso pertenece
al Módulo 1, que es quien opera el hotel en persona. El Módulo 2, que gestiona el ciclo de vida de
las reservas, no debe duplicar una pantalla de ingreso: solo necesita enterarse de que el huésped ya
ingresó para actualizar el estado de su reserva y conservar los datos migratorios que exige el
reporte a Migración. Si esa notificación no se procesa, las reservas quedan desactualizadas y el
reporte SIRE incompleto.

### Flujo de Usuario de Alto Nivel

1. El **Módulo 1** ejecuta el Check-In físico: cambia la `Room` a `OCCUPIED` y entrega la
   habitación al huésped.
2. El Módulo 1 envía a la API del Módulo 2 una notificación con la referencia de la reserva y, si el
   huésped es extranjero, sus datos migratorios (tipo de movimiento y fecha).
3. El sistema localiza la reserva mediante "Consultar reservas" y valida que esté en `ACTIVE`.
4. El sistema ejecuta "Actualizar reservación" para cambiar el `status` a `IN_PROGRESS`.
5. Si hay datos migratorios, el sistema ejecuta "Procesar datos de huéspedes extranjeros" para
   validarlos y registrarlos en un `MigratoryMovement` de esa reserva.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sincronización de Estado e Integración de Extranjeros (Priority: P2)

El Módulo 2 recibe la notificación de Check-In ejecutado en el Módulo 1 para actualizar el estado de
la `Reservation` y consolidar los datos migratorios de huéspedes extranjeros, sin duplicar el
proceso en pantallas diferentes. Por tratarse de una única notificación, el camino exitoso, los
datos migratorios y los rechazos por estado inválido se consolidan en esta misma historia de
usuario.

**Why this priority**: Es vital para mantener la coherencia del estado de la reserva y para no
duplicar la operación física, que pertenece al Módulo 1. Integra en una sola petición los datos del
reporte gubernamental.

**Independent Test**: Se envía una notificación simulada del Módulo 1 con el identificador de la
reserva y datos migratorios opcionales, y se valida que el estado cambie a `IN_PROGRESS` y que los
datos migratorios queden registrados en un `MigratoryMovement` de esa reserva.

**Acceptance Scenarios**:

1. **Scenario**: Actualización de estado por notificación de Check-In (Happy Path)
   - **Given** una `Reservation` en estado `ACTIVE`
   - **When** el sistema recibe la notificación del Módulo 1 indicando que el Check-In se completó
   - **Then** el sistema actualiza la `Reservation` a `IN_PROGRESS`

2. **Scenario**: Recepción de datos de un huésped extranjero
   - **Given** una `Reservation` de un `Guest` `FOREIGN` en proceso de Check-In
   - **When** la notificación incluye el tipo de movimiento migratorio y la fecha de ingreso
   - **Then** el sistema los valida y los registra en un `MigratoryMovement` asociado a esa reserva, para su futura exportación SIRE

3. **Scenario**: Rechazo de notificación con estado inválido (Error)
   - **Given** una `Reservation` en `PENDING`, `COMPLETED`, `CANCELLED` o `NO_SHOW`
   - **When** el Módulo 1 envía una notificación de Check-In retrasada o prematura
   - **Then** el sistema no cambia el estado, responde **HTTP 400 (Bad Request)** indicando que la reserva no admite un Check-In en su estado actual, y registra una incidencia de conciliación con el Módulo 1

### Casos Borde

- ¿Qué sucede si el payload llega vacío o sin el identificador de la reserva? El sistema intercepta
  el error de inmediato y responde **HTTP 400** con el mensaje: "El payload de notificación es
  inválido. Falta el identificador de la reserva."
- ¿Qué sucede si los datos migratorios tienen formato inválido o fechas futuras? El Check-In físico ya ocurrió en el Módulo 1, así que el sistema no lo rechaza: actualiza la reserva a `IN_PROGRESS`, registra el `MigratoryMovement` como `INCOMPLETE` y responde 200 con la advertencia "Los datos migratorios provistos tienen un formato no válido.". Ese movimiento queda excluido de la exportación SIRE hasta corregirse.
- ¿Qué sucede si la reserva notificada no existe en el Módulo 2? El sistema responde **HTTP 400** con el mensaje: "La reserva notificada no existe en el sistema de reservas." y registra la incidencia de conciliación, porque el Módulo 1 ya ocupó físicamente una habitación.
- ¿Qué sucede si la notificación llega duplicada o la reserva ya no está en `ACTIVE`? Si la reserva ya está en `IN_PROGRESS`, la notificación es idempotente: responde 200 sin efectos nuevos. Si está en `CANCELLED`, `NO_SHOW`, `PENDING` o `COMPLETED`, responde **HTTP 400** sin cambiar el estado y registra una incidencia de conciliación, para que una persona resuelva la discrepancia con el Módulo 1 (la habitación quedó ocupada sin una reserva vigente).
- ¿Qué sucede si la notificación llega antes de la fecha de inicio de la estadía? El sistema procesa
  la notificación normalmente, porque el Check-In físico ya ocurrió en el Módulo 1, que es quien
  valida las fechas de ingreso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema no debe ofrecer una interfaz para el Check-In físico: debe limitarse a
  exponer un servicio para recibir la notificación del Módulo 1.
- **FR-002**: El sistema debe validar que la `Reservation` esté en `ACTIVE` antes de procesar la
  notificación.
- **FR-003**: El sistema debe actualizar el `status` a `IN_PROGRESS` mediante "Actualizar
  reservación" al recibir una notificación válida.
- **FR-004**: El sistema debe recibir y validar en la misma petición los datos migratorios de huéspedes `FOREIGN`, registrándolos en un `MigratoryMovement` de esa reserva mediante "Procesar datos de huéspedes extranjeros"; si son inválidos, debe conservar el Check-In y marcar el movimiento como `INCOMPLETE` con una advertencia.
- **FR-005**: El sistema debe tratar la notificación como idempotente (200 sin efectos si la reserva ya está en `IN_PROGRESS`) y, cuando la reserva no esté en `ACTIVE` ni en `IN_PROGRESS`, o no exista, debe responder **HTTP 400** sin cambiar el estado y registrar una incidencia de conciliación con el Módulo 1, porque el efecto físico ya ocurrió allá.
- **FR-006**: El sistema debe interceptar excepciones lógicas y errores de validación, respondiendo **HTTP 400 (Bad Request)** y prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El procesamiento de la notificación debe completarse en menos de 500 milisegundos.

### Key Entities *(include if feature involves data)*

- **Reservation**: Reserva que transiciona a `IN_PROGRESS`. Atributos: `reservationRef`, `guestRef`,
  `roomId` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Guest**: Huésped titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `nationality`, `type` (`NATIONAL` | `FOREIGN`).
- **MigratoryMovement**: Movimiento migratorio de la estadía de un huésped `FOREIGN`. Atributos: `movementId`, `reservationRef`, `guestRef`, `movementType`, `movementDate` y `validationStatus` (`COMPLETE` | `INCOMPLETE`).
- **Room**: Habitación física controlada por el Módulo 1, que ya la pasó a `OCCUPIED`. Atributos:
  `roomId`, `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las notificaciones válidas del Módulo 1 actualizan la reserva a
  `IN_PROGRESS`.
- **SC-002**: El 100% de la información migratoria enviada en el payload se registra en el `MigratoryMovement` de la reserva sin intervención manual, o queda marcada como `INCOMPLETE` con una advertencia.
- **SC-003**: Cero errores **HTTP 500** ante payloads mal formados o reservas inexistentes, y el 100% de las notificaciones que no pueden aplicarse dejan una incidencia de conciliación registrada.
