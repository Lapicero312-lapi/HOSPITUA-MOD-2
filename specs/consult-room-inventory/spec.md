# Feature Specification: Consultar Inventario de Habitaciones

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

Para verificar disponibilidad, el Módulo 2 necesita saber qué habitaciones tiene el hotel a la venta
y sus datos: número, categoría y capacidad máxima. Esa información es propiedad exclusiva del
Módulo 1, que es quien opera el hotel en persona. Todas las habitaciones que entrega el Módulo 1 son
vendibles: si una habitación está libre en unas fechas no depende de su estado de hoy, sino de las
reservas del Módulo 2 y de los mantenimientos programados. Si el Módulo 2 guardara una copia propia
del inventario, o asumiera habitaciones por su cuenta, aparecerían sobreventas o reservas sobre
habitaciones que no existen. El negocio necesita una consulta de solo lectura, en tiempo real,
contra el inventario del Módulo 1, que sirva de insumo a "Verificar disponibilidades" antes de crear
o modificar cualquier reserva.

### Flujo de Usuario de Alto Nivel

1. El caso de uso "Verificar disponibilidades" invoca "Consultar inventario de habitaciones"
   enviando un `roomId` puntual o una categoría (`categoryRoom`).
2. El sistema consulta de forma síncrona el inventario del **Módulo 1**, fuente de verdad exclusiva
   de las habitaciones del hotel.
3. Si la consulta es puntual, el sistema retorna los datos de esa `Room`: `id`, `roomNumber`,
   `categoryRoom` y `maxCapacity`.
4. Si la consulta es por categoría, el sistema retorna **todas** las habitaciones de esa categoría con
   esos mismos datos, sin filtrar por estado.
5. Si el Módulo 1 no responde o el identificador consultado no existe, el sistema informa el
   fallo con un error de negocio controlado **HTTP 400 (Bad Request)**.

**Pantalla de referencia "Habitaciones" (solo lectura, fuera de "Verificar disponibilidades"):**
además de ser insumo interno de "Verificar disponibilidades", el Módulo 2 ofrece a la Recepcionista
una pantalla de solo lectura que lista **todas** las `Room` de **todas** las categorías con su
`categoryRoom` y su capacidad máxima (`maxCapacity`) (reutilizando FR-002, una vez por categoría) y,
por cada una, si tiene un mantenimiento próximo, lo indica (dato que proviene de "Consultar
calendario de mantenimientos"). La pantalla no muestra el estado de la habitación. Esta pantalla no
modifica ningún dato ni sustituye la consulta síncrona que hace "Verificar disponibilidades" al
procesar una reserva real.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta del Inventario de Habitaciones en Tiempo Real (Priority: P1)

Al verificar la disponibilidad, el sistema consulta el inventario del Módulo 1 para una habitación
puntual o para una categoría completa, y obtiene las habitaciones vendibles con sus datos. Por
tratarse de una única consulta de lectura reutilizada por varios flujos (crear, actualizar y
verificar reservas), el camino de éxito puntual, el listado por categoría y los fallos de
integración se consolidan en esta misma historia de usuario.

**Why this priority**: Es la base de la verificación de disponibilidad. Sin conocer las habitaciones
reales del Módulo 1 y su capacidad, el hotel no puede asignar habitaciones ni validar cuántas
personas caben en cada una.

**Independent Test**: Se consulta una `Room` conocida por su `roomId` y se verifica que se retornen
sus datos; se consulta una categoría con varias habitaciones y se comprueba que el listado incluya
todas, con sus datos y sin filtrar por estado; y se consulta una categoría sin habitaciones y se
comprueba que el listado venga vacío.

**Acceptance Scenarios**:

1. **Scenario**: Consulta puntual de una habitación (Happy Path)
   - **Given** el `roomId` de una `Room` del Módulo 1
   - **When** el sistema la consulta mediante "Consultar inventario de habitaciones"
   - **Then** el Módulo 1 retorna su `id`, `roomNumber`, `categoryRoom` y `maxCapacity`, y el sistema
     los entrega a "Verificar disponibilidades" sin modificar ningún dato

2. **Scenario**: Listado de una categoría
   - **Given** una categoría con varias habitaciones
   - **When** el sistema consulta el inventario por `categoryRoom`
   - **Then** el sistema retorna todas las habitaciones de la categoría, con `id`, `roomNumber`,
     `categoryRoom` y `maxCapacity`, sin filtrar por estado

3. **Scenario**: Categoría sin habitaciones
   - **Given** una categoría que no tiene habitaciones en el Módulo 1
   - **When** el sistema consulta el inventario por `categoryRoom`
   - **Then** el sistema retorna un listado vacío indicando que no hay habitaciones en esa categoría

### Casos Borde

- ¿Qué sucede si el Módulo 1 no responde o agota el tiempo de espera? El sistema intercepta la
  falla, evita que se propague como un error de servidor y retorna **HTTP 400 (Bad Request)** con el
  mensaje "No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo."
- ¿Qué sucede si se consulta un `roomId` inexistente o con caracteres inválidos? El sistema detecta
  el identificador inválido y retorna **HTTP 400** con el mensaje "El identificador de la
  habitación es inválido."
- ¿Qué sucede si una habitación está ocupada hoy? Se devuelve igual, porque es vendible; si está
  libre en las fechas pedidas lo decide "Verificar disponibilidades" con las reservas del Módulo 2.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe consultar una `Room` por su `roomId` directamente en el inventario del
  Módulo 1 y retornar su `id`, `roomNumber`, `categoryRoom` y `maxCapacity`, sin estado.
- **FR-002**: El sistema debe permitir consultar el inventario por `categoryRoom` y retornar todas
  las habitaciones de la categoría con esos mismos datos, sin filtrar por estado.
- **FR-003**: El sistema debe ser de solo lectura: no debe modificar ninguna `Room`.
- **FR-004**: El sistema debe entregar el resultado a "Verificar disponibilidades" como insumo de la
  validación previa a cualquier reserva.
- **FR-005**: El sistema debe interceptar los fallos de integración con el Módulo 1 y los
  identificadores inválidos, respondiendo con **HTTP 400 (Bad Request)** y prohibiendo que escalen a
  **HTTP 500**.
- **FR-006**: El sistema debe ofrecer a la Recepcionista una pantalla de solo lectura con todas las
  `Room` de todas las categorías, con su `categoryRoom` y su `maxCapacity`, sin estado y sin opción
  de editar, reutilizando esta misma consulta y la de "Consultar calendario de mantenimientos" para
  indicar el mantenimiento próximo de cada habitación.

### Non-Functional Requirements

- **NFR-001**: La consulta puntual al inventario del Módulo 1 debe completarse en menos de 1
  segundo.

### Key Entities *(include if feature involves data)*

- **Room**: Unidad física provista por el Módulo 1. Atributos: `id`, `roomNumber`,
  `categoryRoom` y `maxCapacity` (capacidad máxima de personas, usada para validar el `guestCount` de
  cada habitación de la reserva). Todas las habitaciones del Módulo 1 son vendibles; esta
  funcionalidad solo las consulta.
- **Reservation**: Se referencia de forma informativa. Atributos: `reservationRef` y `status`
  (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`). Sus habitaciones
  (`ReservationRoom.roomId`) se consultan una por una.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las verificaciones de disponibilidad se apoyan en las habitaciones reales
  del Módulo 1 obtenidas en el momento de la consulta.
- **SC-002**: El 100% de las consultas retornan el resultado en menos de 1 segundo en condiciones
  normales.
- **SC-003**: Cero errores **HTTP 500** por fallos del Módulo 1 o identificadores inválidos; el 100%
  se responde con **HTTP 400**.
