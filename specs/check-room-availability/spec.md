# Feature Specification: Verificar Disponibilidades

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

Antes de registrar o modificar una reserva, el hotel necesita saber con certeza si la habitación
puede ocuparse en las fechas pedidas. Una habitación puede parecer libre y, aun así, tener otra
reserva que se cruza, un mantenimiento programado, o estar ocupada hoy mismo. Si esa validación se
hace de forma parcial o distinta según la pantalla, aparecen sobreventas y reservas que después hay
que cancelar. El negocio necesita una única verificación, reutilizada por todos los flujos de
reserva, que combine las reservas locales del Módulo 2 con el inventario y el calendario de
mantenimientos del Módulo 1.

### Flujo de Usuario de Alto Nivel

1. Un flujo de reserva (generar reservación directa, generar reservación por OTA o actualizar
   reservación) solicita verificar la disponibilidad de una `Room` para un rango de fechas
   (`startDate` y `endDate`) y, cuando se trata de una modificación, la `reservationRef` de la
   reserva editada.
2. El sistema cruza el rango contra las reservas locales mediante "Consultar reservas", considerando
   solo las que aún reservan inventario (`PENDING`, `ACTIVE` o `IN_PROGRESS`) y excluyendo la
   reserva indicada en `reservationRef`.
3. El sistema consulta el calendario del Módulo 1 mediante "Consultar calendario de
   mantenimientos".
4. Si la estadía incluye el día en curso, el sistema consulta el estado físico real mediante
   "Consultar inventario de habitaciones", enviando también la `reservationRef` de la reserva
   editada. El Módulo 1 informa qué reserva mantiene apartada la `Room`
   (`reservedByReservationRef`); si coincide con la reserva editada, ese `RESERVED` es su propio
   apartado y no cuenta como conflicto.
5. El sistema devuelve si la `Room` está disponible o no, indicando el motivo cuando no lo esté.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta y Validación de Disponibilidad (Priority: P1)

La Recepcionista o la OTA necesitan verificar que una `Room` está
disponible antes de registrar una `Reservation`, para evitar cruces de hospedaje y asegurar que la
habitación no esté inhabilitada por mantenimiento. Por tratarse de una única verificación, los
casos libre, bloqueada por mantenimiento, cruzada con otra reserva y ocupada hoy se consolidan en
esta misma historia de usuario.

**Why this priority**: Es el primer paso obligatorio del flujo de reservas. Garantiza que ninguna
reserva ingrese al sistema si la habitación está comprometida física o lógicamente.

**Independent Test**: Se envían consultas de disponibilidad para distintas habitaciones y se valida
que el sistema cruce correctamente las reservas locales, el calendario de mantenimientos y el
inventario del Módulo 1, devolviendo la disponibilidad precisa en cada caso.

**Acceptance Scenarios**:

1. **Scenario**: Habitación libre en las fechas solicitadas (Happy Path)
   - **Given** una `Room` sin mantenimientos programados ni reservas cruzadas en el rango pedido
   - **When** el solicitante verifica la disponibilidad
   - **Then** el sistema confirma la disponibilidad y permite continuar con la creación o
     modificación de la `Reservation`

2. **Scenario**: Bloqueo por mantenimiento programado (Error)
   - **Given** una `Room` con un mantenimiento programado en el calendario del Módulo 1 dentro del
     rango pedido
   - **When** el solicitante verifica la disponibilidad
   - **Then** el sistema la rechaza indicando que la habitación estará inhabilitada por
     mantenimiento

3. **Scenario**: Bloqueo por reserva cruzada (Error)
   - **Given** una `Room` con una `Reservation` activa cuyas fechas se solapan con el rango pedido
   - **When** el solicitante verifica la disponibilidad
   - **Then** el sistema la rechaza indicando que la habitación ya está reservada en esas fechas

4. **Scenario**: Validación en tiempo real para una reserva del mismo día
   - **Given** una consulta cuya estadía incluye el día en curso
   - **When** el solicitante verifica la disponibilidad
   - **Then** el sistema consulta el inventario del Módulo 1 y, si la `Room` está `OCCUPIED`, o
     `RESERVED` por una reserva distinta de la consultada, informa que no está disponible

5. **Scenario**: Modificación de fechas de una reserva existente
   - **Given** una `Reservation` en `ACTIVE` sobre una `Room` sin otras reservas ni mantenimientos
     en las nuevas fechas
   - **When** el solicitante verifica la disponibilidad enviando la `reservationRef` de esa reserva
     con las nuevas fechas
   - **Then** el sistema excluye la propia reserva del cruce y confirma la disponibilidad

6. **Scenario**: Reservas históricas que no bloquean
   - **Given** una `Room` cuyas únicas reservas solapadas están en `COMPLETED`, `CANCELLED` o
     `NO_SHOW`
   - **When** el solicitante verifica la disponibilidad
   - **Then** el sistema ignora esas reservas y confirma la disponibilidad

7. **Scenario**: Modificación de una reserva cuya estadía incluye hoy
   - **Given** una `Reservation` `ACTIVE` cuya `Room` está `RESERVED` por esa misma reserva y cuya
     estadía incluye el día en curso
   - **When** el solicitante verifica la disponibilidad enviando su `reservationRef` con nuevas
     fechas
   - **Then** el sistema reconoce que el `RESERVED` es el apartado propio
     (`reservedByReservationRef` coincide) y no lo trata como conflicto, por lo que la reserva puede
     modificar sus fechas

### Casos Borde

- ¿Qué sucede si el Módulo 1 no responde o agota el tiempo de espera durante la consulta? El
  sistema intercepta el fallo, prohíbe la propagación del error y retorna **HTTP 400 (Bad Request)**
  con el mensaje: "No es posible validar mantenimientos en este momento. Intente de nuevo." No
  asume disponibilidad.
- ¿Qué sucede si las fechas son inválidas (por ejemplo, salida anterior a llegada)? El sistema
  retorna **HTTP 400** con el mensaje: "Rango de fechas inválido. Verifique las fechas
  seleccionadas."
- ¿Qué sucede si el `roomId` no existe o tiene caracteres inválidos? El sistema retorna **HTTP 400**
  con el mensaje: "El identificador de la habitación es inválido."
- ¿Cómo maneja el sistema dos verificaciones simultáneas sobre la misma habitación? Ambas pueden
  responder disponible, porque esta funcionalidad no bloquea la habitación; la confirmación final se
  valida de nuevo al crear la reserva.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe consultar el calendario de mantenimientos del Módulo 1 mediante
  "Consultar calendario de mantenimientos" para garantizar que la `Room` no esté en reparación en
  las fechas pedidas.
- **FR-002**: El sistema debe cruzar el rango solicitado contra las reservas locales mediante
  "Consultar reservas" para descartar solapamientos, considerando únicamente las reservas en
  `PENDING`, `ACTIVE` o `IN_PROGRESS`; las `COMPLETED`, `CANCELLED` y `NO_SHOW` no deben bloquear la
  disponibilidad.
- **FR-003**: El sistema debe aceptar la `reservationRef` de la reserva que se está modificando y
  excluirla del cruce, para que una modificación de fechas no se reporte como no disponible por
  solaparse consigo misma.
- **FR-004**: El sistema debe consultar el `status` físico de la `Room` mediante "Consultar
  inventario de habitaciones" cuando la estadía incluya el día en curso, enviando la
  `reservationRef` de la reserva editada, y debe tratar un `RESERVED` cuyo
  `reservedByReservationRef` coincida con ella como el apartado propio de la reserva, no como un
  conflicto.
- **FR-005**: El sistema no debe asumir disponibilidad cuando el Módulo 1 no responda.
- **FR-006**: El sistema debe interceptar timeouts, fechas y formatos inválidos, respondiendo con
  **HTTP 400 (Bad Request)** y prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La verificación completa debe responder en menos de 2 segundos en condiciones
  normales.

### Key Entities *(include if feature involves data)*

- **Room**: Habitación física validada, propiedad del Módulo 1. Atributos: `roomId`, `numberRoom`,
  `categoryRoom` y `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`).
- **Reservation**: Reserva local con la que se cruzan las fechas. Atributos: `reservationRef`,
  `roomId`, `startDate`, `endDate` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`,
  `CANCELLED`, `NO_SHOW`).
- **MaintenanceSchedule**: Mantenimiento programado en el Módulo 1. Atributos: `roomId`,
  `maintenanceStart`, `maintenanceEnd`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas nuevas o modificadas pasan por esta verificación antes de
  confirmarse.
- **SC-002**: Cero sobreventas: ninguna habitación queda reservada sobre un mantenimiento
  programado ni sobre otra reserva que se cruce.
- **SC-003**: El 100% de los errores de validación y casos borde se responden con **HTTP 400**, con
  cero errores **HTTP 500**.
