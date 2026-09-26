# Feature Specification: Marcar No-Show de Reserva

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

Una reserva cuyo huésped nunca llega queda "estancada": sigue ocupando una habitación apartada en el
Módulo 1 y distorsiona las métricas de ocupación. Si nadie la marca, el hotel pierde noches que
podría haber revendido y arrastra reservas que ya no se van a honrar. El negocio necesita un proceso
automático de cierre del día que identifique las reservas esperadas sin ingreso, las marque como no
presentadas y libere la habitación. El tratamiento depende del canal: una reserva OTA pasa a
`NO_SHOW` y se conserva en el Módulo 2 para conciliar comisiones con la agencia, mientras que una
reserva directa, que no genera comisión, pasa a `CANCELLED`.

### Flujo de Usuario de Alto Nivel

1. El sistema ejecuta un proceso automático al cierre del día operativo, según la zona horaria del
   hotel.
2. El sistema recorre las `Reservation` cuya `startDate` corresponde al día procesado.
3. Para cada una en `ACTIVE` o `PENDING` cuyo huésped no avisó una llegada tardía, ejecuta
   "Actualizar reservación" para cambiar el `status`: a `NO_SHOW` si el `source` es `OTA`, o a
   `CANCELLED` si es `DIRECT`.
4. En ambos canales, el sistema ejecuta "Establecer estado de habitación" para ordenar al Módulo 1
   devolver la `Room` a `Available`.
5. Las reservas en `IN_PROGRESS`, en otros estados finales o con llegada tardía avisada se ignoran.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validación Automática de Fin de Día (Priority: P2)

El sistema, sin intervención humana, identifica al cierre del día las reservas esperadas que no
registraron ingreso físico, las marca como `NO_SHOW` (canal OTA) o `CANCELLED` (canal directo) y
libera su habitación. Por tratarse de un
único proceso automático en lote, el camino exitoso, la exclusión de reservas en curso y el manejo
de fallos individuales se consolidan en esta misma historia de usuario.

**Why this priority**: Es una automatización necesaria para mantener la salud del inventario y las
métricas de ocupación, aunque no bloquea la operación diaria de reservas.

**Independent Test**: Se simula el cierre del día y se verifica que el proceso recorra las reservas
del día, marque como `NO_SHOW` las de canal OTA y como `CANCELLED` las de canal directo que no
tuvieron ingreso, ignore las `IN_PROGRESS` y las de llegada tardía avisada, y libere las
habitaciones correspondientes.

**Acceptance Scenarios**:

1. **Scenario**: Cambio automático a No-Show de una reserva OTA (Happy Path)
   - **Given** una `Reservation` con `source` `OTA`, con `startDate` de hoy, que sigue en `ACTIVE` o
     `PENDING`
   - **When** el sistema ejecuta el proceso de fin de día
   - **Then** el sistema cambia la reserva a `NO_SHOW`, la conserva para la conciliación de
     comisiones y ordena al Módulo 1 devolver la `Room` a `Available`

2. **Scenario**: Cancelación automática de una reserva directa sin presentarse (Happy Path)
   - **Given** una `Reservation` con `source` `DIRECT`, con `startDate` de hoy, que sigue en
     `ACTIVE` y cuyo huésped no avisó una llegada tardía
   - **When** el sistema ejecuta el proceso de fin de día
   - **Then** el sistema cambia la reserva a `CANCELLED`, sin generar comisión ni registro de
     `Cancellation`, y ordena al Módulo 1 devolver la `Room` a `Available`

3. **Scenario**: Exclusión de reservas en curso
   - **Given** una `Reservation` de hoy en `IN_PROGRESS`
   - **When** se ejecuta el proceso de fin de día
   - **Then** el sistema la ignora y mantiene su estado, porque el huésped ingresó

4. **Scenario**: Exclusión de reservas con llegada tardía avisada
   - **Given** una `Reservation` de hoy en `ACTIVE` cuyo huésped avisó una llegada tardía
   - **When** se ejecuta el proceso de fin de día
   - **Then** el sistema la ignora y la mantiene en `ACTIVE`, sin liberar la `Room`

5. **Scenario**: Fallo aislado dentro del lote (Error)
   - **Given** un lote de reservas donde una presenta datos corruptos
   - **When** el sistema las procesa una por una
   - **Then** el sistema captura el error del registro corrupto, deja un log de advertencia
     controlado, y continúa con el resto sin interrumpir el proceso

### Casos Borde

- ¿Qué sucede si el proceso se ejecuta dos veces el mismo día? El sistema es idempotente: ignora las
  reservas que ya no están en `ACTIVE` o `PENDING` (por ejemplo, las que ya pasaron a `NO_SHOW` o
  `CANCELLED`) y responde exitosamente, sin errores.
- ¿Qué sucede si la zona horaria del servidor difiere de la del hotel? El sistema usa siempre la
  zona horaria configurada del hotel, evitando marcar como no presentadas reservas cuyo día aún no
  termina, y emite una alerta de negocio si las zonas son inconsistentes.
- ¿Qué ocurre si la base de datos pierde conexión durante el procesamiento masivo? El sistema
  detiene el proceso de forma transaccional, sin marcar reservas a medias, y emite alertas
  controladas sin exponer detalles de infraestructura.
- ¿Qué sucede si el Módulo 1 no responde al liberar una habitación? La reserva queda en su nuevo
  estado (`NO_SHOW` o `CANCELLED`), la orden queda en `PENDING` para reintentarse, y el lote
  continúa.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe ejecutar un proceso automático al cierre del día operativo, usando la
  zona horaria del hotel.
- **FR-002**: El sistema debe recorrer las `Reservation` cuya `startDate` corresponda al día
  procesado.
- **FR-003**: El sistema debe procesar únicamente las reservas en `ACTIVE` o `PENDING` cuyo huésped
  no haya avisado una llegada tardía, ignorando `IN_PROGRESS`, los estados finales y las reservas
  con llegada tardía avisada.
- **FR-004**: El sistema debe cambiar el `status` mediante "Actualizar reservación", según el canal:
  a `NO_SHOW` si el `source` es `OTA` y a `CANCELLED` si es `DIRECT`.
- **FR-005**: El sistema debe ordenar al Módulo 1, en ambos canales y mediante "Establecer estado de
  habitación", devolver la `Room` a `Available` solo si sigue apartada por esa reserva; si el Módulo
  1 la reporta
  `Occupied`, la orden se trata como sin efecto y se registra la incidencia.
- **FR-006**: El sistema debe procesar cada registro con manejo individual de excepciones, de modo
  que un error de validación no interrumpa el lote ni exponga errores **HTTP 500**.
- **FR-007**: El sistema debe conservar en el Módulo 2 las reservas OTA marcadas como `NO_SHOW` para
  la conciliación de comisiones con la agencia, y no debe registrar una `Cancellation` para las
  reservas directas que pasan a `CANCELLED` por este proceso.

### Non-Functional Requirements

- **NFR-001**: El proceso debe ser idempotente y completar un lote de hasta 1000 reservas en menos
  de 1 minuto.

### Key Entities *(include if feature involves data)*

- **Reservation**: Reserva que transiciona de `ACTIVE` o `PENDING` a `NO_SHOW` (canal OTA) o a
  `CANCELLED` (canal directo). Atributos: `reservationRef`, `roomId`, `startDate`, `endDate`,
  `source` (`DIRECT` | `OTA`), `lateArrivalNotice` (indica que el huésped avisó una llegada tardía)
  y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Habitación física, propiedad del Módulo 1. Atributos: `id`, `status` (`Available` |
  `Reserved` | `Occupied`). Vuelve de `Reserved` a `Available`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas sin ingreso ni aviso de llegada tardía al finalizar el día
  quedan marcadas como `NO_SHOW` (canal OTA) o `CANCELLED` (canal directo), con su habitación
  liberada.
- **SC-002**: Cero interrupciones del proceso ni errores **HTTP 500** por un registro con formato
  inválido dentro del lote.
