# Feature Specification: Marcar No-Show de Reserva

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

Una reserva cuyo huésped nunca llega queda "estancada": sigue ocupando una habitación apartada en el
Módulo 1 y distorsiona las métricas de ocupación. Si nadie la marca, el hotel pierde noches que
podría haber revendido y arrastra reservas que ya no se van a honrar. El negocio necesita un proceso
automático de cierre del día que identifique las reservas esperadas sin ingreso, las marque como no
presentadas y libere la habitación.

### Flujo de Usuario de Alto Nivel

1. El sistema ejecuta un proceso automático al cierre del día operativo, según la zona horaria del
   hotel.
2. El sistema recorre las `Reservation` cuya `startDate` corresponde al día procesado.
3. Para cada una en `ACTIVE` o `PENDING`, ejecuta "Actualizar reservación" para cambiar el `status`
   a `NO_SHOW`.
4. El sistema ejecuta "Establecer estado de habitación" para ordenar al Módulo 1 devolver la `Room`
   a `AVAILABLE`.
5. Las reservas en `IN_PROGRESS` u otros estados finales se ignoran.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validación Automática de Fin de Día (Priority: P2)

El sistema, sin intervención humana, identifica al cierre del día las reservas esperadas que no
registraron ingreso físico, las marca como `NO_SHOW` y libera su habitación. Por tratarse de un
único proceso automático en lote, el camino exitoso, la exclusión de reservas en curso y el manejo
de fallos individuales se consolidan en esta misma historia de usuario.

**Why this priority**: Es una automatización necesaria para mantener la salud del inventario y las
métricas de ocupación, aunque no bloquea la operación diaria de reservas.

**Independent Test**: Se simula el cierre del día y se verifica que el proceso recorra las reservas
del día, marque como `NO_SHOW` solo las que no tuvieron ingreso, ignore las `IN_PROGRESS` y libere
las habitaciones correspondientes.

**Acceptance Scenarios**:

1. **Scenario**: Cambio automático a No-Show (Happy Path)
   - **Given** una `Reservation` con `startDate` de hoy que sigue en `ACTIVE` o `PENDING`
   - **When** el sistema ejecuta el proceso de fin de día
   - **Then** el sistema cambia la reserva a `NO_SHOW` y ordena al Módulo 1 devolver la `Room` a
     `AVAILABLE`

2. **Scenario**: Exclusión de reservas en curso
   - **Given** una `Reservation` de hoy en `IN_PROGRESS`
   - **When** se ejecuta el proceso de fin de día
   - **Then** el sistema la ignora y mantiene su estado, porque el huésped ingresó

3. **Scenario**: Fallo aislado dentro del lote (Error)
   - **Given** un lote de reservas donde una presenta datos corruptos
   - **When** el sistema las procesa una por una
   - **Then** el sistema captura el error del registro corrupto, deja un log de advertencia
     controlado, y continúa con el resto sin interrumpir el proceso

### Casos Borde

- ¿Qué sucede si el proceso se ejecuta dos veces el mismo día? El sistema es idempotente: ignora las
  reservas que ya están en `NO_SHOW` y responde exitosamente, sin errores.
- ¿Qué sucede si la zona horaria del servidor difiere de la del hotel? El sistema usa siempre la
  zona horaria configurada del hotel, evitando marcar como no presentadas reservas cuyo día aún no
  termina, y emite una alerta de negocio si las zonas son inconsistentes.
- ¿Qué ocurre si la base de datos pierde conexión durante el procesamiento masivo? El sistema
  detiene el proceso de forma transaccional, sin marcar reservas a medias, y emite alertas
  controladas sin exponer detalles de infraestructura.
- ¿Qué sucede si el Módulo 1 no responde al liberar una habitación? La reserva queda en `NO_SHOW`,
  la orden queda en `PENDING` para reintentarse, y el lote continúa.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe ejecutar un proceso automático al cierre del día operativo, usando la
  zona horaria del hotel.
- **FR-002**: El sistema debe recorrer las `Reservation` cuya `startDate` corresponda al día
  procesado.
- **FR-003**: El sistema debe procesar únicamente las reservas en `ACTIVE` o `PENDING`, ignorando
  `IN_PROGRESS` y los estados finales.
- **FR-004**: El sistema debe cambiar el `status` a `NO_SHOW` mediante "Actualizar reservación".
- **FR-005**: El sistema debe ordenar al Módulo 1, mediante "Establecer estado de habitación",
  devolver la `Room` a `AVAILABLE`.
- **FR-006**: El sistema debe procesar cada registro con manejo individual de excepciones, de modo
  que un error de validación no interrumpa el lote ni exponga errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El proceso debe ser idempotente y completar un lote de hasta 1000 reservas en menos
  de 1 minuto.

### Key Entities *(include if feature involves data)*

- **Reservation**: Reserva que transiciona de `ACTIVE` o `PENDING` a `NO_SHOW`. Atributos:
  `reservationRef`, `roomId`, `startDate`, `endDate` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Habitación física, propiedad del Módulo 1. Atributos: `roomId`, `status` (`AVAILABLE` |
  `RESERVED` | `OCCUPIED`). Vuelve de `RESERVED` a `AVAILABLE`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas sin ingreso al finalizar el día quedan marcadas como
  `NO_SHOW`, con su habitación liberada.
- **SC-002**: Cero interrupciones del proceso ni errores **HTTP 500** por un registro con formato
  inválido dentro del lote.
