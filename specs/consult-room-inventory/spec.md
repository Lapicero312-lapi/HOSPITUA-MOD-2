# Feature Specification: Consultar Inventario de Habitaciones

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Durante la fase de reserva, el Módulo 2 nunca asigna un `roomId` ni un `numberRoom` físico
individual al huésped: esa asignación ocurre de forma operativa recién en el Check-In, dentro del
Módulo 1. Sin embargo, para calcular cuánto cupo de aforo puede ofrecer, el Módulo 2 necesita
conocer, en tiempo real, cuántas habitaciones físicas de una `categoryRoom` se encuentran realmente
en estado `Available` según el inventario operativo que administra el Módulo 1.

Ese estado físico es propiedad exclusiva del Módulo 1, que es quien opera el hotel en persona. Si el
Módulo 2 guardara una copia propia del inventario físico, o asumiera un valor por su cuenta ante la
falta de respuesta, aparecerían sobreventas de cupo o rechazos de reservas sobre categorías que en
realidad sí tienen habitaciones disponibles. El negocio necesita una consulta de solo lectura, en
tiempo real, contra el inventario físico del Módulo 1, que sirva de insumo directo al cálculo de
aforo de "Verificar disponibilidades" antes de confirmar cualquier reserva.

### Flujo de Usuario de Alto Nivel

1. El caso de uso "Verificar disponibilidades" invoca "Consultar inventario de habitaciones"
   enviando la `categoryRoom` a validar.
2. El sistema realiza una petición síncrona de solo lectura a la API del Módulo 1.
3. El Módulo 1 retorna el conteo y el listado de las habitaciones de esa `categoryRoom` que se
   encuentran actualmente en estado físico `Available`.
4. El sistema integra ese dato al cálculo del aforo lógico de "Verificar disponibilidades".
5. Si ocurre un timeout, una falla de red o la `categoryRoom` no existe, el sistema interrumpe la
   consulta y responde con un error controlado **HTTP 400 (Bad Request)**.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Consulta de Inventario Físico por Categoría (Priority: P1)

**Plain Language**: Consulta de solo lectura, en tiempo real, al inventario físico del Módulo 1 que
retorna cuántas habitaciones de una `categoryRoom` están actualmente en estado `Available`, como
insumo directo del cálculo de aforo de "Verificar disponibilidades".

Al verificar la disponibilidad, el sistema consulta el inventario físico del Módulo 1 para una
`categoryRoom` completa y obtiene el conteo vigente de habitaciones en `Available`. Por tratarse de
una única consulta de lectura reutilizada por "Verificar disponibilidades", el camino de éxito con
habitaciones disponibles, el caso sin ninguna habitación disponible y los fallos de integración con
el Módulo 1 se consolidan en esta misma historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Es la base del cálculo de aforo. Sin conocer el inventario físico real
administrado por el Módulo 1, el hotel no puede evitar ofrecer cupo de una `categoryRoom` por
encima de las habitaciones que realmente están operativas y libres.

**Independent Test**: Se consulta una `categoryRoom` con habitaciones en `Available` y se verifica
que el conteo y el listado retornado sean exactos; se consulta una `categoryRoom` cuyas habitaciones
están todas en otro estado físico (`Occupied`, `PendingCleaning`, `InCleaning`,
`DisabledForRepairs`, `TechnicalBlock` o `Inactive`) y se verifica que se retorne un listado vacío; y
se simula una falla de comunicación con el Módulo 1, confirmando la respuesta controlada **HTTP
400**.

**Acceptance Scenarios**:

1. **Escenario 1**: Consulta exitosa de inventario disponible por `categoryRoom` (Happy Path)

   ```gherkin
   Given una categoryRoom con una o más habitaciones en estado físico Available en el Módulo 1
   When "Verificar disponibilidades" consulta el inventario enviando la categoryRoom
   Then el sistema realiza la petición síncrona de solo lectura al Módulo 1
   And retorna el conteo y el listado exacto de habitaciones en Available de esa categoryRoom
   ```

2. **Escenario 2**: Consulta de categoría sin habitaciones disponibles en estado `Available`

   ```gherkin
   Given una categoryRoom cuyas habitaciones se encuentran todas en un estado físico distinto de Available
   When "Verificar disponibilidades" consulta el inventario enviando la categoryRoom
   Then el sistema retorna un listado vacío y un conteo de cero habitaciones disponibles
   ```

3. **Escenario 3**: Fallo de integración o timeout con el Módulo 1 (Error)

   ```gherkin
   Given una consulta de inventario en curso hacia el Módulo 1
   When el Módulo 1 no responde o la conexión agota el tiempo de espera
   Then el sistema interrumpe la consulta sin asumir disponibilidad por defecto
   And responde con un error controlado HTTP 400 (Bad Request) indicando: "Error 400: No se pudo consultar el inventario de habitaciones en este momento"
   And prohíbe estrictamente la propagación de una excepción HTTP 500
   ```

## 3. Casos Borde

- **Caso Borde 1**: Consulta con parámetro `categoryRoom` vacío o nulo. El sistema intercepta la
  solicitud antes de tocar la lógica de negocio y responde con un error controlado **HTTP 400 (Bad
  Request)**.
- **Caso Borde 2**: Consulta sobre una `categoryRoom` inexistente en el catálogo del hotel. El
  sistema responde con un error controlado **HTTP 400 (Bad Request)**, sin intentar consultar el
  inventario del Módulo 1.
- **Caso Borde 3**: Caída o lentitud de red con el Módulo 1. El sistema intercepta la falla de forma
  limpia y responde con **HTTP 400 (Bad Request)**, sin propagar en ningún caso una excepción **HTTP
  500**.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe permitir la consulta del inventario de habitaciones por `categoryRoom`
  directamente contra el Módulo 1.
- **FR-002**: El sistema debe retornar únicamente las habitaciones que se encuentran en estado
  físico `Available`, descartando explícitamente las que estén en `Occupied`, `PendingCleaning`,
  `InCleaning`, `DisabledForRepairs`, `TechnicalBlock` o `Inactive`.
- **FR-003**: El sistema debe garantizar que la consulta sea estrictamente de solo lectura, sin
  alterar el estado físico de ninguna `Room` en el Módulo 1.
- **FR-004**: El sistema debe entregar el resultado como insumo directo para el cálculo de aforo de
  "Verificar disponibilidades".
- **FR-005**: El sistema debe capturar cualquier error de integración con el Módulo 1 y responder
  obligatoriamente con **HTTP 400 (Bad Request)**, quedando estrictamente prohibida la propagación de
  excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de respuesta de la consulta debe ser inferior a 1 segundo en condiciones
  normales.
- **NFR-002**: La operación debe ser idempotente, sin efectos colaterales sobre el inventario del
  Módulo 1 entre ejecuciones sucesivas.

## 5. Entidades Clave

- **Room**: Unidad física administrada por el Módulo 1. Atributos: `roomId`, `numberRoom` y
  `categoryRoom`. Su estado físico es propiedad exclusiva del Módulo 1 (`Available`, `Occupied`,
  `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock` e `Inactive`; el Módulo 1
  no cuenta con un estado `RESERVED`); esta funcionalidad solo lo consulta.
- **Reservation**: Se referencia de forma informativa como la reserva u operación que origina la
  consulta de aforo. Atributo de ciclo de vida: `Reservation.state` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las verificaciones de aforo descuentan el inventario real en estado
  `Available` provisto por el Módulo 1.
- **SC-002**: El 100% de las consultas retornan el resultado en menos de 1 segundo en condiciones
  normales.
- **SC-003**: Cero errores **HTTP 500** por fallos de integración con el Módulo 1; el 100% se
  responde con **HTTP 400**.
