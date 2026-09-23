# Feature Specification: Cancelación de Reservación

**Created**: 2026-09-19

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cancelación de Reservación y Liberación de Habitación (Priority: P1)

Como `Receptionist`, `Guest` titular u OTA, necesito anular una `Reservation` confirmada para liberar el espacio y notificar de forma inmediata al Módulo 1 para que el estado de la `Room` vuelva a estar `AVAILABLE` (Libre).

**Why this priority**: Es el flujo principal para procesar bajas de hospedaje. Permite al hotel recuperar inventario vendible en tiempo real, garantizando que el estado físico o lógico de la `Room` se libere (de `RESERVED` a `AVAILABLE`) para admitir nuevos huéspedes, previniendo ocupaciones fantasma.

**Independent Test**: Puede ser probado enviando una solicitud de cancelación para una reserva en estado `status: ACTIVE`, verificando que el estado interno cambia a `status: CANCELLED` y asegurando que el Módulo 1 recibe la notificación exitosa para revertir la habitación a `status: AVAILABLE`.

**Acceptance Scenarios**:

1. **Scenario**: Cancelación exitosa y liberación de la habitación
   - **Given** una `Reservation` en estado `status: ACTIVE` con una `Room` previamente marcada como `status: RESERVED`
   - **When** el `Receptionist` o canal de ventas confirma la cancelación de la reserva
   - **Then** el sistema actualiza la `Reservation` a `status: CANCELLED` y notifica explícitamente al Módulo 1 para cambiar el estado de la `Room` nuevamente a `status: AVAILABLE`.

2. **Scenario**: Bloqueo de cancelación para estadía en curso
   - **Given** una `Reservation` que ya se encuentra en estado `status: IN_PROGRESS` (Check-in ya realizado)
   - **When** el `Receptionist` intenta cancelar la reserva
   - **Then** el sistema prohíbe la acción y no envía ninguna notificación de liberación al Módulo 1, indicando que el hospedaje ya comenzó.

### Edge Cases

- ¿Qué sucede si el Módulo 1 no responde al intentar enviar la notificación de liberación de habitación?
  - El sistema detecta el timeout, marca la reserva localmente como cancelada, pero retorna un HTTP 400 (Bad Request) o un warning controlado indicando: "Reserva cancelada, pero hubo un fallo al notificar la liberación de la habitación al sistema físico. Contacte a soporte."
- ¿Qué sucede si la referencia de la reserva enviada es vacía o nula?
  - El sistema intercepta el payload vacío antes de tocar lógica de negocio y retorna de forma inmediata un HTTP 400 (Bad Request) con el mensaje: "La referencia de la reserva es obligatoria y no puede estar vacía."
- ¿Qué sucede ante un conflicto de concurrencia optimista (dos operadores cancelando al mismo tiempo)?
  - El sistema detecta la inconsistencia de versiones, detiene el segundo intento, y retorna un código HTTP 400 (Bad Request) indicando: "Esta reserva ya fue actualizada o cancelada por otro usuario recientemente."

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE validar que el estado actual de la `Reservation` sea estrictamente `ACTIVE` o `PENDING` antes de autorizar la cancelación.
- **FR-002**: El sistema DEBE actualizar el estado local de la `Reservation` a `CANCELLED` al confirmarse la solicitud de cancelación.
- **FR-003**: El sistema DEBE notificar de forma inmediata y explícita al Módulo 1 (Gestión de Habitaciones) para revertir el estado de la `Room` a `AVAILABLE` (Libre), si esta se encontraba marcada previamente como `RESERVED`.
- **FR-004**: El sistema DEBE interceptar los errores de validación de entrada, estado incorrecto o concurrencia, retornando estrictamente códigos HTTP 400 controlados con mensajes amigables, prohibiendo que la excepción derive en un error de infraestructura HTTP 500.

### Key Entities

- **`Reservation`**: Entidad local que se anula. Transiciona exclusivamente a `CANCELLED`.
- **`Room`**: Entidad física en Módulo 1 que transiciona de `RESERVED` a `AVAILABLE` producto de la cancelación.
- **`Guest`**: Titular de la reserva notificado si aplica.
- **`Receptionist`**: Actor operativo principal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las cancelaciones exitosas notifican al Módulo 1 para la liberación del estado físico de la habitación (`AVAILABLE`).
- **SC-002**: El 100% de los intentos inválidos de cancelación (reservas ya finalizadas, datos faltantes) son rechazados de forma segura devolviendo un código HTTP 400.
- **SC-003**: 0% de casos donde la habitación permanece bloqueada lógicamente tras una cancelación confirmada.
