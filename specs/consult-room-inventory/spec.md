# Feature Specification: Consultar Inventario de Habitaciones

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

Para saber si una habitación puede reservarse, el Módulo 2 necesita conocer su estado físico real en
ese instante: si está libre (`AVAILABLE`), apartada por otra reserva (`RESERVED`) o con un huésped
adentro (`OCCUPIED`). Ese estado es propiedad exclusiva del Módulo 1, que es quien opera el hotel en
persona. Si el Módulo 2 guardara una copia propia, o asumiera valores por su cuenta, aparecerían
sobreventas o reservas rechazadas sobre habitaciones que en realidad están libres. El negocio
necesita una consulta de solo lectura, en tiempo real, contra el inventario del Módulo 1, que sirva
de insumo a "Verificar disponibilidades" antes de crear o modificar cualquier reserva.

### Flujo de Usuario de Alto Nivel

1. El caso de uso "Verificar disponibilidades" invoca "Consultar inventario de habitaciones"
   enviando un `roomId` puntual o una categoría (`categoryRoom`) junto con el rango de fechas.
2. El sistema consulta de forma síncrona el inventario del **Módulo 1**, fuente de verdad exclusiva del estado físico de la `Room`. Cuando la `Room` está `RESERVED`, el Módulo 1 también informa qué reserva la mantiene apartada (`reservedByReservationRef`).
3. Si la consulta es puntual, el sistema retorna el `status` actual de esa `Room` y, si está `RESERVED`, la `reservationRef` que la mantiene apartada, para que quien consulta pueda distinguir un apartado ajeno del propio.
4. Si la consulta es por categoría, el sistema retorna únicamente las habitaciones en `AVAILABLE`,
   con sus atributos (`roomId`, `numberRoom`, `categoryRoom`).
5. Si el Módulo 1 no responde o el identificador consultado no existe, el sistema informa el
   fallo con un error de negocio controlado **HTTP 400 (Bad Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta del Inventario Físico en Tiempo Real (Priority: P1)

Al verificar la disponibilidad, el sistema consulta el inventario del Módulo 1 para una habitación
puntual o para una categoría completa, y obtiene el estado físico vigente. Por tratarse de una única
consulta de lectura reutilizada por varios flujos (crear, actualizar y verificar reservas), el
camino
de éxito puntual, el listado por categoría y los fallos de integración se consolidan en esta misma
historia de usuario.

**Why this priority**: Es la base de la verificación de disponibilidad. Sin conocer el estado real
de la `Room` en el Módulo 1, el hotel no puede evitar reservar habitaciones que ya están apartadas u
ocupadas.

**Independent Test**: Se consulta una `Room` conocida en `AVAILABLE` y se verifica que se retorne
ese estado; se repite con una en `RESERVED` y otra en `OCCUPIED`; se consulta una categoría con
varias habitaciones y se comprueba que el listado solo incluya las `AVAILABLE`.

**Acceptance Scenarios**:

1. **Scenario**: Consulta puntual de una habitación disponible (Happy Path)
   - **Given** el `roomId` de una `Room` en `AVAILABLE` en el Módulo 1
   - **When** el sistema consulta su estado mediante "Consultar inventario de habitaciones"
   - **Then** el Módulo 1 retorna `AVAILABLE` y el sistema lo reporta a "Verificar
     disponibilidades" sin modificar ningún dato

2. **Scenario**: Consulta puntual de una habitación no disponible
   - **Given** el `roomId` de una `Room` en `RESERVED` u `OCCUPIED`
   - **When** el sistema consulta su estado
   - **Then** el sistema retorna ese estado indicando que la habitación no está disponible

3. **Scenario**: Listado de habitaciones disponibles por categoría
   - **Given** una categoría con varias habitaciones en distintos estados
   - **When** el sistema consulta el inventario por `categoryRoom`
   - **Then** el sistema retorna únicamente las habitaciones en `AVAILABLE`, con `roomId`,
     `numberRoom` y `categoryRoom`

4. **Scenario**: Categoría sin habitaciones disponibles
   - **Given** una categoría cuyas habitaciones están todas en `RESERVED` u `OCCUPIED`
   - **When** el sistema consulta el inventario por `categoryRoom`
   - **Then** el sistema retorna un listado vacío indicando que no hay habitaciones disponibles

### Casos Borde

- ¿Qué sucede si el Módulo 1 no responde o agota el tiempo de espera? El sistema intercepta la
  falla, evita que se propague como un error de servidor y retorna **HTTP 400 (Bad Request)** con el
  mensaje "No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo."
- ¿Qué sucede si se consulta un `roomId` inexistente o con caracteres inválidos? El sistema detecta
  el identificador inválido y retorna **HTTP 400** con el mensaje "El identificador de la
  habitación es inválido."
- ¿Qué sucede si el estado de la habitación cambia entre la consulta y la creación de la reserva?
  Esta consulta no reserva la habitación; la confirmación final se valida de nuevo al crear la
  reserva, y si ya cambió, el sistema responde con **HTTP 400** indicando que ya no está disponible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe consultar el `status` de una `Room` por su `roomId` directamente en el inventario del Módulo 1 y, cuando esté `RESERVED`, retornar también la reserva que la mantiene apartada (`reservedByReservationRef`).
- **FR-002**: El sistema debe permitir consultar el inventario por `categoryRoom` y retornar
  únicamente las habitaciones en `AVAILABLE`.
- **FR-003**: El sistema debe ser de solo lectura: no debe modificar el `status` de ninguna `Room`.
- **FR-004**: El sistema debe entregar el resultado a "Verificar disponibilidades" como insumo de la
  validación previa a cualquier reserva.
- **FR-005**: El sistema debe interceptar los fallos de integración con el Módulo 1 y los
  identificadores inválidos, respondiendo con **HTTP 400 (Bad Request)** y prohibiendo que escalen a
  **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La consulta puntual al inventario del Módulo 1 debe completarse en menos de 1
  segundo.

### Key Entities *(include if feature involves data)*

- **Room**: Unidad física provista por el Módulo 1. Atributos: `roomId`, `numberRoom`,
  `categoryRoom`, `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`) y `reservedByReservationRef` (reserva que la mantiene apartada; solo presente cuando el `status` es `RESERVED`). Su estado es propiedad
  exclusiva del Módulo 1; esta funcionalidad solo lo consulta.
- **Reservation**: Se referencia de forma informativa. Atributos: `reservationRef`, `roomId` y
  `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las verificaciones de disponibilidad se apoyan en el estado real de la
  `Room` obtenido del Módulo 1 en el momento de la consulta.
- **SC-002**: El 100% de las consultas retornan el resultado en menos de 1 segundo en condiciones
  normales.
- **SC-003**: Cero errores **HTTP 500** por fallos del Módulo 1 o identificadores inválidos; el 100%
  se responde con **HTTP 400**.
