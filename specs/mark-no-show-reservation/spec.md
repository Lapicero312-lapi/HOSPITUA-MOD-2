# Feature Specification: Marcar No-Show Reserva

**Created**: 2026-09-19

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validación Automática de Fin de Día (Priority: P2)

Como sistema de Control de Reservas, necesito ejecutar una validación automática al finalizar el día para identificar aquellas reservas esperadas que no registraron ingreso físico, con el fin de marcarlas como no presentadas y liberar la obligación de hospedaje.

**Why this priority**: Es una automatización indispensable para mantener la salud del inventario y las métricas de ocupación. Sin este proceso, las reservas que no se concretan quedarían "estancadas" bloqueando lógicamente futuras operaciones. 

**Independent Test**: Puede ser probado inyectando una fecha simulada de fin de día (cron), comprobando que el sistema barre las reservas del día, ignora las que están en curso, y actualiza exclusivamente las que no se presentaron al nuevo estado.

**Acceptance Scenarios**:

1. **Scenario**: Cambio automático a No-Show
   - **Given** una `Reservation` programada para el día de hoy que se mantiene en `status: ACTIVE` o `status: PENDING`
   - **When** el sistema ejecuta el proceso automático de cierre o fin de día
   - **Then** el sistema marca automáticamente la reserva cambiando su estado a `status: NO_SHOW` y actualiza la obligación correspondiente.

2. **Scenario**: Exclusión de reservas en curso
   - **Given** una `Reservation` para el día de hoy que se encuentra en `status: IN_PROGRESS`
   - **When** se ejecuta el proceso automático de fin de día
   - **Then** el sistema ignora esta reserva, manteniendo su estado sin alteraciones, ya que el huésped ingresó exitosamente.

3. **Scenario**: Manejo de fallos en el proceso en lote
   - **Given** un lote masivo de reservas para procesar al final del día donde una presenta corrupción de datos
   - **When** el sistema automático las procesa iterativamente
   - **Then** el sistema intercepta la excepción en el registro corrupto, no rompe la iteración (evita HTTP 500 o caída del cron), continúa con el resto y deja un log de advertencia controlado tipo HTTP 400.

### Edge Cases

- ¿Qué sucede si el cron job se ejecuta dos veces por accidente el mismo día?
  - El sistema es idempotente: verifica si las reservas ya están en `status: NO_SHOW` y las ignora en la segunda pasada, retornando un estado exitoso y evitando errores paralelos.
- ¿Qué sucede si la zona horaria del servidor difiere de la zona horaria del hotel al marcar el "fin de día"?
  - El sistema debe procesar estrictamente utilizando la zona horaria del hotel configurada, previniendo que reservas de la noche se marquen erróneamente como no presentadas si el servidor está adelantado, retornando alertas de negocio (HTTP 400) si las zonas son inconsistentes.
- ¿Qué ocurre si la base de datos pierde conexión durante el procesamiento masivo?
  - El sistema detiene el proceso transaccionalmente, sin marcar a medias, y emite alertas controladas sin exponer un stack trace inseguro de infraestructura (HTTP 500).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE ejecutar un proceso automático (job/cron) al cierre del día operativo.
- **FR-002**: El sistema DEBE barrer todas las entidades de `Reservation` cuya fecha de inicio corresponda al día procesado.
- **FR-003**: El sistema DEBE validar si el estado actual es diferente a `status: IN_PROGRESS` o estados finales.
- **FR-004**: El sistema DEBE actualizar el estado a `status: NO_SHOW` de manera automática para aquellas reservas que apliquen.
- **FR-005**: El sistema DEBE procesar cada registro con manejo individual de excepciones lógicas, garantizando que errores de validación retornen códigos controlados (HTTP 400 lógicos en logs) y que una caída transaccional no exponga errores HTTP 500 o quiebre el motor de hilos.

### Key Entities

- **`Reservation`**: Entidad local cuyas instancias transicionan de `ACTIVE`/`PENDING` a `NO_SHOW`.
- **`Room`**: Entidad física controlada por Módulo 1 (no sufre cambios por Módulo 2 en este proceso directo, solo se libera la reserva lógica).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas no iniciadas al finalizar el día quedan correctamente etiquetadas como `NO_SHOW`.
- **SC-002**: 0% de interrupciones fatales (HTTP 500 / Crash del Job) si un registro presenta formato inválido dentro del lote de procesamiento.
