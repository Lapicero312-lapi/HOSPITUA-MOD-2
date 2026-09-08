# Feature Specification: Establecer el Estado de la Habitación

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

El estado físico de una `Habitation` es propiedad exclusiva del Módulo 1, pero el Módulo 2 es quien
sabe cuándo ese estado debe cambiar: al confirmar un Check-In la habitación debe pasar a
`Occupied`, y al confirmar un Check-Out debe liberarse a `PendingCleaning`. Si esa comunicación
falla —por una caída de red o una indisponibilidad temporal del Módulo 1— el Check-In o el
Check-Out ya realizados en el Módulo 2 no pueden revertirse: el huésped ya fue admitido o ya salió.
El negocio necesita un mecanismo de integración desacoplado, que solicite el cambio de estado al
Módulo 1 sin bloquear la operación de recepción, y que permita reintentar la sincronización cuando
la comunicación se restablezca.

### Flujo de Usuario de Alto Nivel

1. Al confirmarse un Check-In o un Check-Out en el Módulo 2, o cuando la Recepcionista solicita un
   cambio manual de mantenimiento, el sistema construye una solicitud con el `habitationId`, el
   `requestedState` deseado y el `originEvent` que origina el cambio.
2. El sistema transmite la solicitud al **Módulo 1**.
3. Si el Módulo 1 confirma el cambio, el estado físico de la `Habitation` se actualiza y la
   solicitud local se marca como `COMPLETED`.
4. Si la comunicación con el Módulo 1 falla o se interrumpe, el sistema Módulo 2 **no** revierte el
   Check-In ni el Check-Out ya realizados; marca la solicitud como `PENDING` y habilita un
   mecanismo de reintento desacoplado.
5. Si se intenta un cambio físicamente incoherente, o sobre una habitación en `TechnicalBlock`, el
   sistema bloquea la acción y responde con un error de negocio controlado **HTTP 400 (Bad
   Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Solicitud de Cambio de Estado tras Check-In o Check-Out (Priority: P1)

La Recepcionista, mediante el proceso automatizado de Check-In o Check-Out, solicita cambiar el
estado físico de una `Habitation` en el Módulo 1: a `Occupied` al finalizar un Check-In, o a
`PendingCleaning` al finalizar un Check-Out. El sistema valida la solicitud, la transmite al
Módulo 1 y registra el resultado como `COMPLETED`. Esta historia es el flujo principal (Happy
Path) que sincroniza el inventario físico con las operaciones de recepción.

**Why this priority**: Es la funcionalidad básica para mantener actualizado el mapa de ocupación
del hotel. Sin ella, las habitaciones permanecerían con estados inconsistentes, provocando
sobreventas o demoras en la preparación de cuartos para nuevos huéspedes.

**Independent Test**: Se prueba enviando una solicitud para cambiar una habitación de `Available` a
`Occupied` tras un Check-In, verificando que el Módulo 1 reciba la orden y el `requestStatus` se
registre en `COMPLETED`. Se repite para un Check-Out cambiando de `Occupied` a `PendingCleaning`.

**Acceptance Scenarios**:

1. **Scenario**: Cambio de estado a Occupied tras Check-In exitoso (Happy Path)
   - **Given** una admisión de Check-In confirmada para una reserva en `CHECKED_IN` con la
     `Habitation` en `Available`
   - **When** el Módulo 2 envía la actualización mediante "Establecer el estado de la habitación"
   - **Then** el sistema comunica la solicitud al Módulo 1, cambia el `stateHabitation` a
     `Occupied`, y registra el `requestStatus` como `COMPLETED`

2. **Scenario**: Cambio de estado a PendingCleaning tras Check-Out exitoso (Happy Path)
   - **Given** una salida de Check-Out confirmada para una reserva en `CHECKED_OUT` con la
     `Habitation` en `Occupied`
   - **When** el Módulo 2 solicita la liberación mediante "Establecer el estado de la habitación"
   - **Then** el sistema solicita al Módulo 1 cambiar la `Habitation` a `PendingCleaning`,
     actualizando el `requestStatus` a `COMPLETED`

3. **Scenario**: Rechazo de ocupación directa para habitación bloqueada técnicamente (Error)
   - **Given** una `Habitation` cuyo `stateHabitation` actual en el Módulo 1 es `TechnicalBlock`
   - **When** se intenta forzar el cambio de estado directamente a `Occupied`
   - **Then** el sistema bloquea la transacción con **HTTP 400 (Bad Request)** indicando que la
     habitación requiere habilitación previa por mantenimiento

---

### User Story 2 - Reintento por Fallo de Comunicación con el Módulo 1 (Priority: P2)

Cuando la solicitud de cambio de estado falla por desconexión de red o indisponibilidad temporal
del Módulo 1, el sistema Módulo 2 mantiene la validez del Check-In o Check-Out, registra la
solicitud como `PENDING`, y permite reintentar la sincronización sin afectar al huésped.

**Why this priority**: Es un flujo de resiliencia crítico para asegurar que los problemas de
infraestructura del Módulo 1 no impidan la atención al cliente en recepción ni reviertan
admisiones o salidas ya registradas.

**Independent Test**: Se simula una caída de conexión con el Módulo 1 durante un Check-Out. Se
comprueba que el Check-Out en Módulo 2 se registre correctamente mientras el `requestStatus` pasa a
`PENDING`. Se ejecuta el reintento con la red restablecida, verificando que la `Habitation` pase
finalmente a `PendingCleaning` y la solicitud cambie a `COMPLETED`.

**Acceptance Scenarios**:

1. **Scenario**: Registro en PENDING tras falla de red con el Módulo 1
   - **Given** un Check-In o Check-Out registrado con éxito en el Módulo 2
   - **When** el envío del cambio de estado al Módulo 1 experimenta un fallo de conexión o tiempo
     de espera agotado
   - **Then** el sistema preserva la admisión o salida en el Módulo 2, guarda la solicitud con
     `requestStatus` `PENDING`, y notifica la pendiente a la Recepcionista mediante una advertencia
     controlada

2. **Scenario**: Reintento exitoso de sincronización del estado de habitación
   - **Given** una solicitud registrada con `requestStatus` en `PENDING`
   - **When** la Recepcionista o el servicio en segundo plano ejecuta el reintento tras
     restablecer la comunicación con el Módulo 1
   - **Then** el Módulo 1 procesa la orden, actualiza el `stateHabitation` al valor solicitado
     (`Occupied` o `PendingCleaning`), y el `requestStatus` local pasa a `COMPLETED`

---

### User Story 3 - Liberación Manual de Habitación para Mantenimiento (Priority: P3)

La Recepcionista cambia el estado de una `Habitation` sin ocupante activo a `DisabledForRepairs`
para reportar un daño físico, o a `Available` tras la inspección de limpieza (`InCleaning`)
completada.

**Why this priority**: Es un flujo secundario de gestión interna que coordina con el personal de
aseo y mantenimiento, pero no interviene directamente en la admisión síncrona de reservas.

**Independent Test**: Se selecciona una habitación en `InCleaning`, se envía una solicitud para
cambiarla a `Available` tras finalizar el aseo, y se comprueba que el Módulo 1 acepte el cambio.

**Acceptance Scenarios**:

1. **Scenario**: Habilitación manual de InCleaning a Available
   - **Given** una habitación liberada previamente en `InCleaning`
   - **When** la Recepcionista confirma la finalización del aseo y solicita cambiar el estado a
     `Available`
   - **Then** el sistema envía la solicitud al Módulo 1, actualiza el `stateHabitation` a
     `Available`, y confirma que la habitación puede recibir nuevas reservas

2. **Scenario**: Bloqueo de cambio a DisabledForRepairs con huésped hospedado (Error)
   - **Given** una habitación con una reserva en `CHECKED_IN` y `stateHabitation` `Occupied`
   - **When** la Recepcionista intenta marcar manualmente la habitación como `DisabledForRepairs`
     sin reasignar al huésped
   - **Then** el sistema rechaza el cambio con **HTTP 400 (Bad Request)** indicando que no se
     puede poner fuera de servicio una habitación con ocupación activa

### Casos Borde

- ¿Qué sucede si se envía una solicitud con `habitationId` vacío, nulo o inexistente? El sistema
  intercepta la solicitud y retorna **HTTP 400 (Bad Request)**, sin emitir peticiones erróneas al
  Módulo 1 ni generar fallas **HTTP 500**.
- ¿Cómo maneja el sistema la concurrencia al modificar el estado de la misma `Habitation`? La
  primera solicitud válida actualiza el estado a `COMPLETED`, mientras la segunda es informada
  mediante **HTTP 400 (Bad Request)** del cambio de estado previo.
- ¿Qué sucede si los datos de la solicitud contienen caracteres extraños o scripts maliciosos? El
  sistema los sanitiza, rechaza la operación con **HTTP 400** y registra el evento en la auditoría
  sin afectar el servidor.
- ¿Qué sucede si el Módulo 1 responde con un mensaje ambiguo o un código de error desconocido? El
  sistema Módulo 2 marca la solicitud como `PENDING` para revisión, evitando asunciones de estado
  no verificadas y prohibiendo errores **HTTP 500**.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir a la Recepcionista o al proceso automatizado de Módulo 2
  enviar solicitudes para actualizar el `stateHabitation` de una `Habitation` en el Módulo 1.
- **FR-002**: El sistema debe requerir los atributos `habitationId`, `requestedState` y
  `originEvent` en toda solicitud de cambio de estado.
- **FR-003**: El sistema debe validar que el `requestedState` pertenezca exclusivamente a la
  enumeración oficial del glosario: `Available`, `Occupied`, `PendingCleaning`, `InCleaning`,
  `DisabledForRepairs`, `TechnicalBlock`, `Inactive`.
- **FR-004**: El sistema debe enviar una solicitud de cambio a `Occupied` al Módulo 1 de forma
  síncrona al confirmarse un Check-In de una reserva en `CHECKED_IN`.
- **FR-005**: El sistema debe enviar una solicitud de cambio a `PendingCleaning` al Módulo 1 de
  forma síncrona al confirmarse un Check-Out de una reserva en `CHECKED_OUT`.
- **FR-006**: El sistema debe registrar la solicitud con `requestStatus` `COMPLETED` cuando el
  Módulo 1 confirme exitosamente la actualización.
- **FR-007**: El sistema debe registrar la solicitud con `requestStatus` `PENDING` cuando la
  comunicación con el Módulo 1 falle, sin revocar el evento de admisión o salida en el Módulo 2.
- **FR-008**: El sistema debe proveer una función de reintento para procesar solicitudes en
  `requestStatus` `PENDING`.
- **FR-009**: El sistema debe rechazar cualquier intento de cambiar directamente el estado a
  `Occupied` para habitaciones registradas en `TechnicalBlock`.
- **FR-010**: El sistema debe rechazar el cambio a `DisabledForRepairs` para habitaciones en
  `Occupied` sin previa reasignación de la reserva hospedada.
- **FR-011**: El sistema debe interceptar cualquier error de validación de entrada y responder con
  **HTTP 400 (Bad Request)**, prohibiendo fallas de infraestructura **HTTP 500**.
- **FR-012**: El sistema debe mantener un registro auditable de cada solicitud de cambio de
  estado, incluyendo fecha, actor, habitación, estado anterior, estado solicitado y resultado.

### Non-Functional Requirements

- **NFR-001**: El tiempo de procesamiento de la solicitud de cambio de estado en el Módulo 2 debe
  ser inferior a 1 segundo.
- **NFR-002**: El mecanismo de integración debe implementar patrones de tolerancia a fallos para
  garantizar la consistencia eventual entre el Módulo 2 y el Módulo 1.

### Key Entities *(include if feature involves data)*

- **HabitationStateRequest**: Representa la orden de actualización de estado enviada al Módulo 1.
  Atributos: `requestId`, `habitationId`, `requestedState` (uno de los siete estados oficiales del
  glosario), `previousState`, `originEvent` (`CHECK_IN` | `CHECK_OUT` | `MAINTENANCE`),
  `requestedAt`, `requestedBy` (Recepcionista o sistema), y `requestStatus` (`PENDING` |
  `COMPLETED`).
- **Habitation**: Representa la unidad física de alojamiento, propiedad del Módulo 1. Atributos:
  `habitationId`, `numberHabitation`, y `stateHabitation` con los siete estados oficiales del
  glosario: `Available`, `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`,
  `TechnicalBlock`, `Inactive`.
- **Reservation**: Representa la reserva asociada al evento. Atributos: `reservationRef`,
  categoría o habitación asignada, y `state` (`PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`,
  `CANCELLED`).
- **CheckIn**: Evento de admisión relacionado. Atributos: `reservationRef`, `status` (`IN_HOUSE`).
- **CheckOut**: Evento de salida relacionado. Atributos: `reservationRef`, `checkOutTime`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los Check-In exitosos generan una solicitud de cambio a `Occupied`, y al
  menos el 99% se confirman como `COMPLETED` en el Módulo 1 dentro de los 60 segundos posteriores.
- **SC-002**: El 100% de los Check-Out exitosos generan una solicitud de cambio a
  `PendingCleaning`.
- **SC-003**: Cero errores de servidor **HTTP 500** son provocados por solicitudes con estados o
  identificadores inválidos; el 100% se responde con **HTTP 400**.
- **SC-004**: El 100% de las fallas temporales de comunicación con el Módulo 1 registran la
  solicitud como `PENDING` sin corromper la admisión o salida en el Módulo 2.
- **SC-005**: El 95% de las solicitudes en `PENDING` se sincronizan correctamente a `COMPLETED` en
  el primer reintento tras el restablecimiento de la conexión.
