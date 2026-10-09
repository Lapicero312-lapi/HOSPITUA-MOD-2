# Feature Specification: Verificar Disponibilidades

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

Antes de registrar o modificar una reserva, el hotel necesita saber con certeza si la habitación
puede ocuparse en las fechas pedidas. Una habitación puede parecer libre y, aun así, tener otra
reserva que se cruza o un mantenimiento programado. Si esa validación se hace de forma parcial o
distinta según la pantalla, aparecen sobreventas y reservas que después hay que cancelar. El negocio
necesita una única verificación, reutilizada por todos los flujos de reserva, que combine las
reservas locales del Módulo 2 con las habitaciones vendibles y el calendario de mantenimientos del
Módulo 1. Todo huésped alojado tiene una reserva del Módulo 2, así que la ocupación de hoy también se
detecta con esas reservas, sin consultar el estado físico de la habitación. La verificación de disponibilidad admite la consulta tanto por
categoría de habitación (`categoryRoom`) como por habitación específica (`roomId`).

Como una reserva puede tener varias habitaciones, el flujo invocador ejecuta esta verificación una
vez por cada habitación de la reserva, y la reserva solo se crea o se modifica si **todas** están
disponibles. La consulta por categoría devuelve todas las habitaciones disponibles de esa categoría,
para que el flujo invocador elija o asigne las que necesita.

### Flujo de Usuario de Alto Nivel

1. Un flujo de reserva (generar reservación directa, generar reservación por OTA o actualizar
   reservación) solicita verificar la disponibilidad por categoría (`categoryRoom`) o de una `Room`
   (`roomId`) para un rango de fechas (`startDate` y `endDate`) y, cuando se trata de una
   modificación, la `reservationRef` de la reserva editada.
2. Si la consulta es por categoría, el sistema obtiene las habitaciones vendibles de esa categoría
   mediante "Consultar inventario de habitaciones"; si es por `roomId`, verifica que la habitación
   exista.
3. El sistema cruza el rango de cada habitación contra las habitaciones de las reservas locales
   mediante "Consultar reservas", considerando solo las reservas que aún reservan inventario
   (`PENDING`, `ACTIVE` o `IN_PROGRESS`) y, dentro de ellas, solo las habitaciones que no están en
   `CHECKED_OUT` ni en `NOT_ARRIVED`, y excluyendo la reserva indicada en `reservationRef`. Así se
   detecta también la habitación ocupada hoy, que está en `CHECKED_IN` dentro de una reserva
   `IN_PROGRESS`.
4. El sistema consulta el calendario del Módulo 1 mediante "Consultar calendario de
   mantenimientos" para cada habitación que pasó el cruce.
5. El sistema devuelve las habitaciones disponibles y el motivo de cada una que no lo esté.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta y Validación de Disponibilidad (Priority: P1)

La Recepcionista o la OTA necesitan verificar que una `Room` está
disponible antes de registrar una `Reservation`, para evitar cruces de hospedaje y asegurar que la
habitación no esté inhabilitada por mantenimiento. Por tratarse de una única verificación, los
casos libre, bloqueada por mantenimiento, cruzada con otra reserva y ocupada hoy por un huésped
alojado se consolidan en esta misma historia de usuario.

**Why this priority**: Es el primer paso obligatorio del flujo de reservas. Garantiza que ninguna
reserva ingrese al sistema si la habitación está comprometida física o lógicamente.

**Independent Test**: Se envían consultas de disponibilidad para distintas habitaciones y se valida
que el sistema cruce correctamente las reservas locales, el calendario de mantenimientos y las
habitaciones vendibles del Módulo 1, devolviendo la disponibilidad precisa en cada caso.

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

4. **Scenario**: Habitación ocupada hoy por un huésped alojado
   - **Given** una `Room` en `CHECKED_IN` dentro de una `Reservation` `IN_PROGRESS` cuyas fechas se
     cruzan con el rango pedido
   - **When** el solicitante verifica la disponibilidad
   - **Then** el sistema la rechaza indicando que la habitación ya está reservada en esas fechas

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

7. **Scenario**: Habitación liberada dentro de una reserva en curso
   - **Given** una `Room` que pertenece a una reserva `IN_PROGRESS` pero está en `NOT_ARRIVED` o
     `CHECKED_OUT` dentro de esa reserva
   - **When** el solicitante verifica la disponibilidad de esa `Room` en fechas que se cruzan con
     esa reserva
   - **Then** el sistema no la considera ocupada por esa reserva, porque la habitación ya fue
     liberada

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
  las fechas pedidas. La verificación de disponibilidad admite la consulta tanto por categoría de
  habitación (`categoryRoom`) como por habitación específica (`roomId`).
- **FR-002**: El sistema debe cruzar el rango solicitado contra las habitaciones de las reservas
  locales mediante "Consultar reservas" para descartar solapamientos, considerando únicamente las
  reservas en `PENDING`, `ACTIVE` o `IN_PROGRESS` y, dentro de ellas, las habitaciones que no estén
  en `CHECKED_OUT` ni en `NOT_ARRIVED`; las reservas `COMPLETED`, `CANCELLED` y `NO_SHOW` no deben
  bloquear la disponibilidad.
- **FR-002a**: El sistema debe responder por habitación: cuando el flujo invocador verifica varias
  habitaciones de una misma reserva, debe indicar cuáles están disponibles y el motivo de cada una
  que no lo esté.
- **FR-003**: El sistema debe aceptar la `reservationRef` de la reserva que se está modificando y
  excluirla del cruce, para que una modificación de fechas no se reporte como no disponible por
  solaparse consigo misma.
- **FR-004**: El sistema debe obtener las habitaciones de la categoría mediante "Consultar
  inventario de habitaciones" (todas son vendibles) y no debe usar el estado físico de hoy: la
  ocupación se detecta solo con las reservas del Módulo 2.
- **FR-005**: El sistema no debe asumir disponibilidad cuando el Módulo 1 no responda.
- **FR-006**: El sistema debe interceptar timeouts, fechas y formatos inválidos, respondiendo con
  **HTTP 400 (Bad Request)** y prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La verificación completa debe responder en menos de 2 segundos en condiciones
  normales.

### Key Entities *(include if feature involves data)*

- **Room**: Habitación vendible, propiedad del Módulo 1. Atributos: `id`, `roomNumber`,
  `categoryRoom` y `maxCapacity`.
- **Reservation**: Reserva local con la que se cruzan las fechas. Atributos: `reservationRef`,
  `startDate`, `endDate` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`,
  `CANCELLED`, `NO_SHOW`).
- **ReservationRoom**: Habitación de una reserva local. Atributos: `reservationRef`, `roomId` y
  `stayStatus` (`EXPECTED` | `CHECKED_IN` | `CHECKED_OUT` | `NOT_ARRIVED`).
- **MaintenanceCalendar**: Mantenimiento programado en el calendario del Módulo 1. Atributos:
  `roomId`,
  `maintenanceStart`, `maintenanceEnd`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas nuevas o modificadas pasan por esta verificación antes de
  confirmarse.
- **SC-002**: Cero sobreventas: ninguna habitación queda reservada sobre un mantenimiento
  programado ni sobre otra reserva que se cruce.
- **SC-003**: El 100% de los errores de validación y casos borde se responden con **HTTP 400**, con
  cero errores **HTTP 500**.
