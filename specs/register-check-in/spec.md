# Feature Specification: Registrar Check-In (Notificación)

**Created**: 2026-09-19

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sincronización de Estado e Integración de Extranjeros (Priority: P2)

Como sistema de Control de Reservas (Módulo 2), necesito recibir la notificación de Check-In exitoso ejecutado físicamente en el Módulo 1, para actualizar el estado interno de la `Reservation` correspondiente y consolidar los datos migratorios de los huéspedes extranjeros sin duplicar el proceso en pantallas diferentes.

**Why this priority**: Es vital para mantener la coherencia de estados de la reserva y delegar la operación del check-in físico de la habitación al Módulo 1. Adicionalmente, integra en un solo flujo la recepción de datos para reporte gubernamental, evitando que el recepcionista tenga que usar múltiples pantallas para el mismo proceso físico.

**Independent Test**: Puede ser probado enviando un payload de notificación simulado (webhook/API) desde el Módulo 1 conteniendo el identificador de la reserva y los datos migratorios opcionales. Se valida que el estado de la reserva cambia y que los datos migratorios se guardan localmente para el huésped.

**Acceptance Scenarios**:

1. **Scenario**: Actualización de estado por notificación de Check-in
   - **Given** una `Reservation` en estado `status: ACTIVE` o `status: PENDING`
   - **When** el sistema recibe la notificación del Módulo 1 indicando que el check-in físico fue completado exitosamente
   - **Then** el sistema actualiza de forma automática el estado de la `Reservation` a `status: IN_PROGRESS`.

2. **Scenario**: Recepción de datos de huéspedes extranjeros durante notificación
   - **Given** una `Reservation` de un `Guest` extranjero en proceso de check-in
   - **When** el sistema recibe la notificación del Módulo 1 que incluye el tipo de movimiento migratorio y la fecha de ingreso
   - **Then** el sistema integra estos datos a la entidad `Guest` asociada a la `Reservation` para su futura exportación (archivo SIRE).

3. **Scenario**: Rechazo de notificación con estado inválido
   - **Given** una `Reservation` que ya se encuentra en estado `status: CANCELLED` o `status: COMPLETED`
   - **When** el Módulo 1 intenta enviar una notificación de Check-In retrasada o duplicada
   - **Then** el sistema rechaza la actualización de estado y retorna un código HTTP 400 indicando que la reserva ya no admite un check-in.

### Edge Cases

- ¿Qué sucede si el payload enviado por el Módulo 1 viene vacío o le falta el identificador de la reserva?
  - El sistema intercepta el error de validación de entrada de inmediato, prohíbe errores de infraestructura, y responde con un código HTTP 400 (Bad Request) indicando: "El payload de notificación es inválido. Falta el identificador de la reserva."
- ¿Qué sucede si los datos migratorios enviados por el Módulo 1 para un huésped extranjero contienen formatos inválidos o fechas futuras irreales?
  - El sistema detecta la anomalía en los datos, cancela la actualización y retorna un HTTP 400 (Bad Request) con el mensaje: "Los datos migratorios provistos tienen un formato no válido."
- ¿Qué sucede si se recibe la notificación para una reserva que no existe en el Módulo 2?
  - El sistema lanza un error controlado de negocio devolviendo HTTP 400 (Bad Request) o HTTP 404 estructurado con el mensaje amigable: "La reserva notificada no existe en el sistema central de reservas."

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema (Módulo 2) ya no provee interfaz para el Check-in físico. Su función DEBE limitarse a exponer un endpoint/servicio para recibir la notificación de Check-in procesada por el Módulo 1.
- **FR-002**: Al recibir la notificación exitosa, el sistema DEBE actualizar el estado de la `Reservation` a `status: IN_PROGRESS`.
- **FR-003**: El sistema DEBE recibir, validar e integrar en la misma petición los datos migratorios (tipo de movimiento y fecha) enviados por el Módulo 1 para huéspedes extranjeros.
- **FR-004**: El sistema DEBE interceptar excepciones lógicas y validaciones de entrada para retornar estrictamente respuestas HTTP 400 controladas en lugar de errores HTTP 500.

### Key Entities

- **`Reservation`**: Entidad local que transiciona a estado `IN_PROGRESS` al recibir la notificación.
- **`Guest`**: Entidad que almacena los datos migratorios integrados en caso de extranjeros.
- **`Room`**: Entidad física controlada por el Módulo 1 (en este flujo, Módulo 1 ya se encargó de pasarla a `OCCUPIED`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las notificaciones válidas provenientes del Módulo 1 actualizan el estado de la reserva a `IN_PROGRESS`.
- **SC-002**: 100% de la información migratoria requerida enviada en el payload se consolida correctamente en la entidad del huésped sin intervención manual.
- **SC-003**: Cero errores HTTP 500 registrados ante payloads de notificación mal formados o reservas inexistentes.
