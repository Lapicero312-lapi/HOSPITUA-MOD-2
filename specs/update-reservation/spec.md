# Feature Specification: Actualizar Reservación

**Created**: 2026-09-19

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Modificación de Datos de Reservación y Cambios de Estado (Priority: P1)

Como `Receptionist` o canal de ventas, necesito actualizar los detalles de una `Reservation` o gestionar sus cambios de estado utilizando una nomenclatura unificada con el Módulo 1 (ej. transiciones a estados en curso), para reflejar con precisión la situación real del hospedaje y mantener la coherencia financiera e inventariable.

**Why this priority**: Es el flujo vital secundario para gestionar cambios y devoluciones. Permite al hotel acomodar cambios del cliente (fechas, datos) o gestionar los cambios de estado de la reserva utilizando la nomenclatura de estados unificada y acordada con el Módulo 1, asegurando la consistencia antes, durante y después del hospedaje.

**Independent Test**: Puede ser probado aislando una reserva en estado `status: ACTIVE` o `status: PENDING`, enviando la petición de actualización de fechas, validando la disponibilidad de cupos, confirmando que la `Reservation` guarda sus datos y/o estado actualizado, y verificando que el Módulo 3 fue notificado para recalcular la tarifa si aplica.

**Acceptance Scenarios**:

1. **Scenario**: Actualización de fechas o categoría con recálculo exitoso
   - **Given** una `Reservation` en estado `status: ACTIVE` con disponibilidad validada para nuevas fechas
   - **When** el `Receptionist` modifica las fechas de estadía o categoría de habitación
   - **Then** el sistema delega el recálculo al Módulo 3, presenta el resumen financiero y, tras la confirmación, actualiza la `Reservation` manteniendo la nomenclatura de estados unificada.

2. **Scenario**: Gestión de cambios de estado manuales/forzados
   - **Given** una `Reservation` que requiere un ajuste administrativo de estado
   - **When** el `Receptionist` gestiona un cambio de estado sobre la reserva
   - **Then** el sistema actualiza la `Reservation` utilizando estrictamente la nomenclatura unificada acordada con el Módulo 1 (ej. transicionando a `status: IN_PROGRESS` si aplica bajo las reglas de negocio) e informando del cambio.

3. **Scenario**: Bloqueo por falta de disponibilidad de cupos en fechas nuevas
   - **Given** que no existen cupos disponibles en el Módulo 1 para las nuevas fechas solicitadas
   - **When** el `Receptionist` intenta modificar la fecha de la `Reservation`
   - **Then** el sistema bloquea la acción de confirmación y prohíbe el guardado de la actualización.

### Edge Cases

- ¿Qué sucede cuando el Módulo 3 (Pricing) no responde durante el recálculo financiero?
  - El sistema intercepta el fallo asíncrono, detiene la confirmación de la actualización financiera y retorna un HTTP 400 (Bad Request) con el mensaje: "No se pudo calcular la nueva tarifa en este momento. Intente más tarde."
- ¿Qué sucede cuando se intenta enviar fechas inválidas (ej. salida antes de llegada)?
  - El sistema detecta la inconsistencia de inmediato, prohíbe el envío al Módulo 3 y retorna un HTTP 400 (Bad Request) con el mensaje: "Las nuevas fechas de reserva son inválidas."
- ¿Qué sucede si se ingresan caracteres extraños en los campos de edición del huésped?
  - El sistema intercepta la validación de entrada antes del guardado y retorna un HTTP 400 (Bad Request) con el mensaje: "El formato de los datos contiene caracteres no válidos."

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir la edición de datos de estadía y personales de una `Reservation`.
- **FR-002**: El sistema DEBE gestionar y persistir los cambios de estado de la reserva utilizando estrictamente la nomenclatura unificada acordada con el Módulo 1.
- **FR-003**: El sistema DEBE validar de forma local e integrada la disponibilidad de cupos si el solicitante cambia las fechas de estadía.
- **FR-004**: El sistema DEBE comunicarse con el Módulo 3 para recalcular la tarifa dinámica si los cambios afectan las fechas o categoría de la reserva.
- **FR-005**: El sistema DEBE interceptar todas las excepciones de concurrencia y validación (formatos inválidos) y retornar códigos HTTP 400 controlados, prohibiendo los errores de infraestructura HTTP 500.

### Key Entities

- **`Reservation`**: Entidad principal actualizada. Estados permitidos unificados con Módulo 1: `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`.
- **`Guest`**: Titular de la reserva.
- **`Room`**: Entidad física referenciada para disponibilidad (Estados: `AVAILABLE`, `RESERVED`, `OCCUPIED`).
- **`Receptionist`**: Actor operativo que procesa los cambios.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los cambios de estado aplicados sobre la reserva cumplen con la nomenclatura oficial en inglés acordada con el Módulo 1.
- **SC-002**: 100% de los intentos inválidos de actualización (fechas pasadas, falta de disponibilidad) retornan HTTP 400 de forma limpia y controlada, sin HTTP 500.
- **SC-003**: 0% de discrepancias financieras entre el Módulo 2 y el Módulo 3 tras actualizaciones exitosas.
