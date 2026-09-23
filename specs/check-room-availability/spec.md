# Feature Specification: Verificar Disponibilidades

**Created**: 2026-09-19

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta y Validación de Disponibilidad (Priority: P1)

Como `Receptionist` o canal de ventas, necesito verificar que una `Room` está disponible antes de intentar registrar una `Reservation`, para evitar cruces de hospedaje y garantizar que la habitación no se encuentre inhabilitada por mantenimientos.

**Why this priority**: Es el primer paso obligatorio del Happy Path (flujo básico para que el negocio funcione). Garantiza que ninguna reserva ingrese al sistema si la habitación está comprometida física o lógicamente en las fechas solicitadas.

**Independent Test**: Puede ser probado enviando peticiones de consulta de fechas para distintas habitaciones y validando que el sistema cruza los datos correctamente con el calendario de mantenimientos y el inventario del Módulo 1, retornando la disponibilidad precisa.

**Acceptance Scenarios**:

1. **Scenario**: Habitación completamente libre en fechas futuras
   - **Given** una `Room` que no tiene mantenimientos programados ni reservas previas cruzadas en las fechas solicitadas
   - **When** el `Receptionist` consulta la disponibilidad para dicha habitación
   - **Then** el sistema confirma la disponibilidad y permite continuar con la creación de la `Reservation`

2. **Scenario**: Bloqueo por mantenimiento programado
   - **Given** una `Room` que tiene un mantenimiento programado en el calendario del Módulo 1 durante las fechas solicitadas
   - **When** el `Receptionist` consulta la disponibilidad
   - **Then** el sistema rechaza la solicitud de forma inmediata, indicando que la habitación estará inhabilitada por mantenimiento

3. **Scenario**: Validación en tiempo real para reserva de última hora (mismo día)
   - **Given** una consulta de disponibilidad de última hora para el día en curso
   - **When** el `Receptionist` intenta validar la disponibilidad
   - **Then** el sistema consulta el inventario en tiempo real del Módulo 1 y, si la `Room` se encuentra en estado `status: OCCUPIED` o `status: RESERVED`, devuelve que la habitación no está disponible

### Edge Cases

- ¿Qué sucede si el Módulo 1 (Calendario de Mantenimientos) no responde o arroja un timeout durante la consulta?
  - El sistema intercepta el fallo de comunicación, prohíbe la propagación del error y retorna un código HTTP 400 (Bad Request) con el mensaje amigable: "No es posible validar mantenimientos en este momento. Intente de nuevo."
- ¿Qué sucede si las fechas enviadas para validar disponibilidad son inválidas (ej. fecha de salida anterior a la fecha de llegada)?
  - El sistema detecta la inconsistencia de inmediato y retorna un código HTTP 400 (Bad Request) con el mensaje: "Rango de fechas inválido. Verifique las fechas seleccionadas."
- ¿Qué sucede si la referencia de la `Room` enviada no existe o tiene caracteres inválidos?
  - El sistema intercepta la validación del identificador y retorna un HTTP 400 (Bad Request) con el mensaje: "El identificador de la habitación es inválido."

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE consultar obligatoriamente el calendario de mantenimientos expuesto por el Módulo 1 para garantizar que la `Room` no esté en reparación durante las fechas solicitadas.
- **FR-002**: El sistema DEBE cruzar las fechas solicitadas contra la base de datos local de `Reservation` para validar que no existan reservas previas que se solapen.
- **FR-003**: Para las reservas correspondientes al día en curso, el sistema DEBE revisar el inventario físico del Módulo 1 en tiempo real para confirmar que la `Room` no esté actualmente `status: OCCUPIED` o `status: RESERVED`.
- **FR-004**: El sistema DEBE interceptar todas las excepciones (timeouts, formatos inválidos) retornando estrictamente códigos HTTP 400 controlados, prohibiendo la generación de errores HTTP 500.

### Key Entities

- **`Room`**: Entidad física validada. Estados relevantes controlados por Módulo 1: `AVAILABLE`, `RESERVED`, `OCCUPIED`.
- **`Reservation`**: Entidad local con la que se cruzan las fechas. Estados posibles: `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`.
- **`Receptionist`**: Actor operativo principal que ejecuta la consulta de disponibilidades.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las consultas de disponibilidad validan exitosamente contra el calendario de mantenimiento del Módulo 1 antes de permitir la reserva.
- **SC-002**: 100% de los errores de validación de negocio y casos borde retornan HTTP 400 amigables sin generar caídas (HTTP 500) en el servidor.
- **SC-003**: 0% de overbooking (sobreventa) cruzada en las habitaciones consultadas.
