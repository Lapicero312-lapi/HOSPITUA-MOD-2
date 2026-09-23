# Feature Specification: Registrar Check-Out (Notificación)

**Created**: 2026-09-19

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sincronización de Salida y Finalización de Reserva (Priority: P2)

Como sistema de Control de Reservas (Módulo 2), necesito recibir la notificación de Check-Out exitoso ejecutado en el Módulo 1, para marcar la estadía de la `Reservation` correspondiente como terminada, manteniendo la coherencia sin duplicar procesos de salida en este módulo.

**Why this priority**: Es el paso final del ciclo de vida de una reserva que fue utilizada. Permite liberar la carga lógica en este módulo, dejando la liberación física de la habitación a cargo del Módulo 1, asegurando así un historial limpio y finalizado.

**Independent Test**: Puede ser probado enviando un payload de notificación simulado (webhook/API) desde el Módulo 1 para una reserva que se encuentra en curso. Se valida que el estado interno cambia correctamente sin afectar la disponibilidad que ya gestiona el Módulo 1.

**Acceptance Scenarios**:

1. **Scenario**: Finalización exitosa de reserva por notificación de Check-Out
   - **Given** una `Reservation` en estado `status: IN_PROGRESS`
   - **When** el sistema recibe la notificación del Módulo 1 indicando que el check-out físico ha finalizado
   - **Then** el sistema actualiza de forma automática la `Reservation` a `status: COMPLETED`.

2. **Scenario**: Rechazo de notificación para reservas no iniciadas
   - **Given** una `Reservation` que se encuentra en estado `status: ACTIVE` o `status: PENDING`
   - **When** el Módulo 1 envía erróneamente una notificación de Check-Out
   - **Then** el sistema prohíbe el cambio de estado y retorna un código HTTP 400 (Bad Request) informando que la reserva aún no registra un ingreso.

3. **Scenario**: Rechazo de notificación duplicada
   - **Given** una `Reservation` que ya se encuentra en `status: COMPLETED`
   - **When** el sistema recibe nuevamente una notificación de Check-Out
   - **Then** el sistema rechaza la acción por idempotencia y devuelve un código HTTP 400 controlado.

### Edge Cases

- ¿Qué sucede si el payload enviado por el Módulo 1 viene vacío o incompleto?
  - El sistema bloquea el procesamiento en la validación inicial y retorna un código HTTP 400 (Bad Request) con el mensaje: "Petición inválida. Faltan datos requeridos para procesar la notificación de check-out."
- ¿Qué sucede si la notificación de check-out llega por un problema de red horas más tarde, durante un proceso de cierre del día?
  - El sistema procesa la notificación normalmente si la reserva aún está `IN_PROGRESS`, actualizándola a `COMPLETED` de forma transaccional y sin interrumpir procesos paralelos.
- ¿Qué sucede si la base de datos local no encuentra la reserva notificada?
  - El sistema intercepta el error y retorna un HTTP 400 amigable (ej. "Referencia de reserva no encontrada") evitando por completo un error de servidor HTTP 500.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema (Módulo 2) ya no posee interfaz ni responsabilidad para el Check-Out. Su única función DEBE ser exponer un servicio interno/API para recibir la notificación desde el Módulo 1.
- **FR-002**: El sistema DEBE validar que el estado actual de la `Reservation` sea estrictamente `status: IN_PROGRESS` antes de procesar la salida.
- **FR-003**: El sistema DEBE actualizar el estado interno de la `Reservation` a `status: COMPLETED` tras una notificación exitosa.
- **FR-004**: El sistema DEBE responder con códigos de estado HTTP 400 ante cualquier inconsistencia de negocio o datos, prohibiendo de forma estricta los errores HTTP 500.

### Key Entities

- **`Reservation`**: Entidad local que transiciona de `IN_PROGRESS` a `COMPLETED`.
- **`Room`**: Entidad física controlada por el Módulo 1. (En este paso, el Módulo 1 ya se encarga directamente de pasarla de `OCCUPIED` a `AVAILABLE` o limpieza).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% de las notificaciones de check-out válidas recibidas cambian la reserva al estado finalizado correctamente.
- **SC-002**: 100% de los intentos de check-out sobre reservas no iniciadas o ya finalizadas arrojan HTTP 400 sin generar errores de sistema.
