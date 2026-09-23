# Feature Specification: Consultar y Ver Reserva

**Created**: 2026-09-19

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta de Reserva e Integración con Módulo 1 (Priority: P1)

Como `Receptionist`, `Guest` web o sistema externo (Módulo 1), necesito poder consultar el estado y el detalle completo de una `Reservation`, para proveer información confiable y sincronizar datos al momento de establecer reservas en las habitaciones físicas.

**Why this priority**: Es la funcionalidad básica de lectura (Happy Path) indispensable para cualquier operación de actualización, cancelación, o check-in. Además, facilita al Módulo 1 obtener la información detallada necesaria al momento de transicionar el estado físico de la habitación a reservada.

**Independent Test**: Puede ser probado consultando reservas existentes en distintos estados y asegurando que se retorna el detalle completo. Se puede simular la petición de notificación de "Habitación Reservada" al Módulo 1 y verificar que el payload incluye todos los datos detallados exigidos.

**Acceptance Scenarios**:

1. **Scenario**: Consulta exitosa del detalle completo
   - **Given** una `Reservation` válida en la base de datos
   - **When** el `Receptionist` o Módulo 1 envía una petición de consulta
   - **Then** el sistema retorna el estado explícito de la reserva (ej. `status: ACTIVE`) y todos los datos asociados al titular (`Guest`).

2. **Scenario**: Notificación enriquecida al Módulo 1
   - **Given** una nueva `Reservation` recién generada
   - **When** el sistema notifica al Módulo 1 para cambiar el estado de la `Room` a `status: RESERVED`
   - **Then** el sistema envía, junto con la orden de cambio de estado, la información detallada de dicha reserva para que el Módulo 1 la procese.

3. **Scenario**: Manejo de consulta de reserva inexistente
   - **Given** una referencia de reserva errónea o borrada
   - **When** el Módulo 1 o el `Receptionist` consulta la reserva
   - **Then** el sistema intercepta la excepción, prohibiendo un error interno, y retorna de forma controlada un código HTTP 400 (o 404) indicando que la reserva no existe.

### Edge Cases

- ¿Qué sucede si la solicitud de consulta carece del parámetro de identificador?
  - El sistema la intercepta inmediatamente con un HTTP 400 (Bad Request) controlado con el mensaje: "Debe proveer un identificador de reserva válido para la consulta."
- ¿Qué sucede si el Módulo 1 no está disponible al intentar notificar el cambio a "RESERVED" con los datos detallados?
  - El sistema detecta el timeout, marca la reserva localmente pero lanza una alerta HTTP 400 controlada de negocio indicando: "Reserva creada, pero hubo un error de comunicación al enviar los detalles al Módulo 1."
- ¿Qué sucede si un usuario intenta ver detalles enviando inyección de código en el ID?
  - El sistema valida el formato estricto del ID, detiene la petición, y retorna un HTTP 400 amigable sin provocar caídas del servidor HTTP 500.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE exponer un servicio o interfaz para permitir la consulta detallada de una `Reservation` por parte del `Receptionist`, `Guest` o del Módulo 1.
- **FR-002**: El sistema DEBE asegurar que, al momento de notificar al Módulo 1 para cambiar una `Room` a `status: RESERVED`, el payload incluya en conjunto la información detallada de dicha reserva.
- **FR-003**: El sistema DEBE proveer en la respuesta el estado explícito unificado (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **FR-004**: El sistema DEBE interceptar y manejar de forma segura las consultas inválidas devolviendo siempre códigos HTTP 400 y evitando la propagación a HTTP 500.

### Key Entities

- **`Reservation`**: Entidad consultada con todos sus estados permitidos.
- **`Room`**: Entidad del Módulo 1 que recibe la información detallada al pasar a `RESERVED`.
- **`Guest`**: Titular de la reserva cuya información es compartida en la consulta.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% de las notificaciones de habitación `RESERVED` al Módulo 1 envían el detalle completo de la reserva adjunto.
- **SC-002**: 100% de los identificadores inválidos retornan respuestas HTTP 400 limpias.
