# Feature Specification: Verificar Disponibilidades

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Antes de registrar o modificar una reserva, el hotel necesita saber con certeza si existe cupo de
aforo disponible dentro de la categoría de habitación (`categoryRoom`) solicitada. Durante la etapa
de reserva no existe un `numberRoom` físico asignado al huésped —esa asignación ocurre únicamente en
el Check-In, en el Módulo 1 / Front Desk—, por lo que la verificación de disponibilidad no opera
sobre una habitación individual, sino sobre el aforo lógico agregado de la categoría.

Ese aforo puede verse reducido por dos motivos distintos que es obligatorio combinar en una sola
verificación: las reservas locales del Módulo 2 que ya están comprometiendo cupo de esa
`categoryRoom` en el rango de fechas pedido, y los bloqueos físicos que el Módulo 1 tiene
registrados en su Calendario de Mantenimientos para habitaciones de esa misma categoría. Si esta
validación se hiciera de forma parcial, o de manera distinta según la pantalla que la invoque,
aparecerían sobreventas de cupo y reservas que después habría que cancelar. El negocio necesita una
única verificación, reutilizada por todos los flujos de reserva, que reste ambos factores del
cupo total de la categoría antes de confirmar disponibilidad.

### Flujo de Usuario de Alto Nivel

1. El cliente (un flujo de reserva o de actualización dentro del Módulo 2) envía la `categoryRoom`,
   el `startDate`, el `endDate` y, opcionalmente, la `reservationRef` cuando la consulta corresponde
   a la modificación de una reserva existente.
2. El sistema consulta de forma síncrona al Módulo 1 el Calendario de Mantenimientos, para obtener
   la cantidad de habitaciones de esa `categoryRoom` inhabilitadas en el rango de fechas solicitado.
3. El sistema calcula, dentro de la base de datos local del Módulo 2, la cantidad de reservas
   activas (`PENDING`, `ACTIVE` e `IN_PROGRESS`) que ya comprometen cupo de esa misma `categoryRoom`
   en el rango solicitado, excluyendo la `reservationRef` recibida cuando esté presente.
4. El sistema resta ambos factores —mantenimientos del Módulo 1 y reservas activas locales— del
   cupo total de la `categoryRoom`, y retorna la confirmación de disponibilidad (`available`) junto
   con la cantidad de cupos restantes.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Verificación de Disponibilidad por Categoría (Priority: P1)

**Plain Language**: Verificación unificada del cupo de aforo de una `categoryRoom` para un rango de
fechas, combinando las reservas activas locales del Módulo 2 con los bloqueos del Calendario de
Mantenimientos del Módulo 1, incluyendo el caso de auto-exclusión cuando la consulta proviene de la
modificación de una reserva existente.

La Recepcionista, el Huésped o la Ota necesitan verificar que existe cupo disponible en una
`categoryRoom` antes de registrar o modificar una `Reservation`, para evitar sobreventas de aforo y
asegurar que el cupo no esté comprometido por mantenimientos programados. Por tratarse de una única
verificación, los casos de cupo libre, aforo agotado por reservas activas, bloqueo por
mantenimientos, exclusión de la propia reserva en modificaciones y falla de integración con el
Módulo 1 se consolidan en esta misma historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Es el primer paso obligatorio de todo flujo de reserva. Garantiza que ninguna
reserva ingrese al sistema si el cupo de aforo de la categoría está comprometido, ya sea lógica o
físicamente.

**Independent Test**: Se envían consultas de disponibilidad para distintas `categoryRoom` y se
valida que el sistema descuente correctamente las reservas activas locales y los mantenimientos del
Módulo 1 del cupo total, devolviendo el booleano `available` y la cantidad exacta de cupos
restantes en cada caso, incluyendo el escenario de modificación con auto-exclusión y el de falla de
comunicación con el Módulo 1.

**Acceptance Scenarios**:

1. **Escenario 1**: Disponibilidad confirmada con cupo libre en la categoría (Happy Path)

   ```gherkin
   Given una categoryRoom con capacidad total sin mantenimientos programados ni reservas activas suficientes para agotarla en el rango solicitado
   When el cliente verifica la disponibilidad enviando categoryRoom, startDate y endDate
   Then el sistema consulta el Módulo 1 y calcula las reservas activas locales
   And retorna available true junto con la cantidad de cupos restantes
   ```

2. **Escenario 2**: Indisponibilidad por aforo completo de reservas activas (Error)

   ```gherkin
   Given una categoryRoom cuyas reservas en PENDING, ACTIVE e IN_PROGRESS agotan la capacidad total en el rango solicitado
   When el cliente verifica la disponibilidad
   Then el sistema retorna available false indicando que el aforo local está agotado por reservas activas
   ```

3. **Escenario 3**: Indisponibilidad por mantenimientos en el Módulo 1 (Error)

   ```gherkin
   Given una categoryRoom cuyas habitaciones bloqueadas en el Calendario de Mantenimientos del Módulo 1 agotan la capacidad total en el rango solicitado
   When el cliente verifica la disponibilidad
   Then el sistema retorna available false indicando que el aforo está comprometido por mantenimientos
   ```

4. **Escenario 4**: Verificación exitosa en modificación de reserva (auto-exclusión)

   ```gherkin
   Given una Reservation existente identificada por reservationRef que ya ocupa cupo de una categoryRoom
   When el solicitante verifica la disponibilidad de nuevas fechas enviando esa misma reservationRef
   Then el sistema excluye la reservationRef propia del conteo de reservas activas
   And calcula el cupo disponible sin contar esa reserva como ocupación
   And retorna available true si el resto del aforo lo permite
   ```

5. **Escenario 5**: Fallo de comunicación con el Módulo 1 (Error)

   ```gherkin
   Given una solicitud de verificación de disponibilidad en curso
   When la consulta síncrona al Calendario de Mantenimientos del Módulo 1 no responde o falla
   Then el sistema interrumpe la confirmación de disponibilidad
   And no asume disponibilidad por defecto
   And responde con un error controlado HTTP 400 (Bad Request) indicando: "Error 400: No se pudo verificar el calendario de mantenimientos del Módulo 1"
   And prohíbe estrictamente la propagación de una excepción HTTP 500
   ```

## 3. Casos Borde

- **Caso Borde 1**: Rango de fechas inválido. Si el `checkOutDate` es anterior o igual al
  `checkInDate`, el sistema intercepta la solicitud antes de consultar cualquier fuente de datos y
  responde con un error controlado **HTTP 400 (Bad Request)**.
- **Caso Borde 2**: Categoría inexistente. Si la `categoryRoom` solicitada no existe en el catálogo
  del hotel, el sistema responde con un error controlado **HTTP 400 (Bad Request)**, sin intentar
  calcular ningún cupo de aforo.
- **Caso Borde 3**: Caída o timeout de red con el Módulo 1. Si la consulta síncrona al Calendario de
  Mantenimientos del Módulo 1 se cae o agota el tiempo de espera, el sistema la intercepta de forma
  limpia y responde con **HTTP 400 (Bad Request)**, sin propagar en ningún caso una excepción **HTTP
  500**.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe recibir como parámetros de entrada la `categoryRoom`, el `startDate`,
  el `endDate` y, opcionalmente, la `reservationRef` cuando la consulta provenga de una modificación.
- **FR-002**: El sistema debe consultar de forma síncrona el Calendario de Mantenimientos del Módulo
  1 para obtener la cantidad de habitaciones de esa `categoryRoom` inhabilitadas en el rango
  solicitado.
- **FR-003**: El sistema debe calcular el cupo de aforo disponible restando, del cupo total de la
  `categoryRoom`, la cantidad de habitaciones bloqueadas por mantenimientos del Módulo 1 y la
  cantidad de reservas locales en estado `PENDING`, `ACTIVE` e `IN_PROGRESS` para esa misma
  categoría en el rango solicitado.
- **FR-004**: El sistema debe excluir la propia `reservationRef` del conteo de reservas activas
  cuando ese parámetro esté presente en la solicitud, para prevenir falsos positivos de
  auto-colisión de disponibilidad.
- **FR-005**: El sistema debe responder con un valor booleano (`available`: `true` o `false`) y con
  la cantidad exacta de cupos disponibles resultante del cálculo.
- **FR-006**: El sistema debe capturar cualquier fallo de integración con el Módulo 1 o de
  validación de los parámetros de entrada, y responder en todos esos casos con un error controlado
  **HTTP 400 (Bad Request)**, quedando prohibida la propagación de excepciones de infraestructura
  **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de respuesta total de la verificación debe ser inferior a 1.5 segundos en
  condiciones normales.
- **NFR-002**: La consulta debe ser segura e idempotente, sin modificar ninguna entidad ni reservar
  cupo de aforo por sí misma.

## 5. Entidades Clave

- **Reservation**: Reserva local con la que se cruza el cálculo de aforo. Atributos: `id`,
  `reservationRef`, `categoryRoom`, `checkInDate`, `checkOutDate` y `state` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`). Solo las reservas en `PENDING`, `ACTIVE` e
  `IN_PROGRESS` descuentan cupo de aforo.
- **Room**: Concepto de categoría de habitación (`categoryRoom`) y su cupo de aforo total local,
  administrado dentro del Módulo 2. No representa aquí ninguna habitación física individual, ya
  que el `numberRoom` no se asigna sino hasta el Check-In.
- **MaintenanceBlock** (del Módulo 1): Entidad leída de paso, consultada de forma síncrona para
  identificar los bloqueos por mantenimiento que afectan a una `categoryRoom` en un rango de
  fechas determinado.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las verificaciones descuentan con exactitud las reservas activas locales y
  los mantenimientos del Módulo 1 del cupo total de la `categoryRoom`.
- **SC-002**: El 100% de las modificaciones de fechas que envían su propia `reservationRef` excluyen
  esa reserva del cálculo, sin generar falsos positivos de indisponibilidad.
- **SC-003**: Cero excepciones **HTTP 500** propagadas ante caídas del Módulo 1 o entradas
  inválidas; el 100% de esos casos responde con **HTTP 400**.
