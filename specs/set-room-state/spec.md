# Feature Specification: Establecer Estado de Habitación

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

El Módulo 2 es el orquestador del estado lógico y financiero de las reservas, pero el estado físico
de una `Room` pertenece exclusivamente al Módulo 1, que es quien opera el hotel en persona. Cuando
una reserva se crea, la habitación debe quedar apartada (`RESERVED`) para que no se ofrezca a otro
cliente; cuando se cancela, debe volver a estar libre (`AVAILABLE`). Si esa comunicación falla —por
una caída de red o una indisponibilidad temporal del Módulo 1— hay dos situaciones distintas. Al
crear una reserva, la creación es todo o nada: sin la confirmación del Módulo 1 la reserva no se
conserva, para no prometer una habitación que no está apartada. En cambio, una cancelación, un
No-Show o la liberación de la habitación anterior en un cambio ya ocurrieron en el Módulo 2 y no
pueden revertirse. El negocio necesita un mecanismo de integración desacoplado que ordene el cambio
de estado al Módulo 1 y que reintente las liberaciones pendientes cuando la comunicación se
restablezca.

Los cambios de `Room` a `OCCUPIED` (Check-In) y a limpieza o `AVAILABLE` (Check-Out) los ejecuta el
propio Módulo 1 y quedan fuera de esta funcionalidad: el Módulo 2 solo los recibe como
notificaciones para actualizar la reserva (`IN_PROGRESS` y `COMPLETED`).

### Flujo de Usuario de Alto Nivel

1. Al crearse una `Reservation`, el sistema construye una solicitud con el `roomId`, el
   `requestedStatus` `RESERVED`, el `originEvent` `RESERVATION_CREATED` y el detalle completo de la
   reserva.
2. Al cancelarse una `Reservation` o marcarse como `NO_SHOW`, el sistema construye una solicitud con
   el `roomId`, el `requestedStatus` `AVAILABLE` y el `originEvent` `RESERVATION_CANCELLED` o
   `RESERVATION_NO_SHOW`. Cuando una modificación cambia la habitación de una reserva
   (`ROOM_CHANGED`), envía primero `RESERVED` para la nueva `Room` y, tras su confirmación,
   `AVAILABLE` para la anterior.
3. El sistema transmite la solicitud al **Módulo 1**.
4. Si el Módulo 1 confirma el cambio, la solicitud local se marca como `COMPLETED`.
5. Si la comunicación con el Módulo 1 falla en una orden `RESERVED` de una reserva recién creada, el
   flujo invocador compensa cancelando la reserva y responde **HTTP 400**. Si falla en una orden de
   liberación (`AVAILABLE`), el Módulo 2 **no** revierte la cancelación, el No-Show ni el cambio ya
   registrados; marca la solicitud como `PENDING` y habilita un reintento desacoplado.
6. Cada orden lleva un `sequenceNumber` creciente por `Room`: el Módulo 1 solo aplica una orden si
   su secuencia es mayor que la última aplicada para esa habitación, e ignora las obsoletas.
7. Si el Módulo 1 rechaza una orden `RESERVED` porque la `Room` ya está `OCCUPIED`, el sistema lo
   informa al flujo invocador, que actúa según el origen: para una reserva recién creada
   (`RESERVATION_CREATED`) compensa cancelándola; para un cambio de habitación (`ROOM_CHANGED`)
   aborta el cambio y conserva la reserva con su `Room` original. Si rechaza una orden `AVAILABLE`
   porque
   la `Room` está `OCCUPIED` o ya no la apartó esa reserva, el sistema la trata como sin efecto y
   registra la incidencia, sin liberar nunca una habitación ocupada.
8. Si se intenta un cambio de estado que el Módulo 2 no puede solicitar, el sistema bloquea la
   acción con un error de negocio controlado **HTTP 400 (Bad Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Orden de Cambio de Estado por Creación o Cancelación de Reserva (Priority: P1)

Cuando el Módulo 2 crea o cancela una reserva, ordena al Módulo 1 cambiar el estado de la `Room`
asociada: a `RESERVED` al crearla, con el detalle de la reserva adjunto, y a `AVAILABLE` al
cancelarla. Esta historia es el flujo principal (Happy Path) que mantiene sincronizado el inventario
físico con las reservas.

**Why this priority**: Sin esta orden, el Módulo 1 desconocería qué habitaciones están apartadas o
liberadas, y el hotel podría vender dos veces la misma habitación o mantener bloqueada una que ya
no se va a usar.

**Independent Test**: Se crea una reserva y se verifica que el Módulo 1 recibe la orden `RESERVED`
con el detalle de la reserva y que la solicitud queda `COMPLETED`. Se cancela la reserva y se
verifica que el Módulo 1 recibe la orden `AVAILABLE`.

**Acceptance Scenarios**:

1. **Scenario**: Habitación apartada al crear una reserva (Happy Path)
   - **Given** una `Reservation` recién creada para una `Room` en estado `AVAILABLE`
   - **When** el sistema envía la orden mediante "Establecer estado de habitación"
   - **Then** el Módulo 1 recibe la orden junto con el detalle de la reserva, cambia el `status` de
     la `Room` a `RESERVED`, y la solicitud queda en `COMPLETED`

2. **Scenario**: Habitación liberada al cancelar una reserva (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` o `PENDING` cuya `Room` está en `RESERVED`
   - **When** la reserva se cancela y el sistema envía la orden de liberación
   - **Then** el Módulo 1 cambia el `status` de la `Room` a `AVAILABLE` y la solicitud queda en
     `COMPLETED`

3. **Scenario**: Rechazo de reserva sobre una habitación ocupada (Error)
   - **Given** una `Room` que el Módulo 1 reporta en `OCCUPIED`
   - **When** se intenta ordenar su cambio a `RESERVED`
   - **Then** el sistema bloquea la transacción con **HTTP 400 (Bad Request)** indicando que la
     habitación no está disponible

4. **Scenario**: Rechazo de estado no permitido para el Módulo 2 (Error)
   - **Given** una solicitud de cambio de estado
   - **When** el `requestedStatus` es `OCCUPIED` o cualquier valor distinto de `RESERVED` y
     `AVAILABLE`
   - **Then** el sistema rechaza la solicitud con **HTTP 400** indicando que los cambios a
     `OCCUPIED` los ejecuta exclusivamente el Módulo 1, y no emite ninguna orden

5. **Scenario**: Rechazo de la habitación nueva en un cambio de habitación (Error)
   - **Given** una `Reservation` `ACTIVE` con la `Room` A apartada, y un cambio a la `Room` B
     (`ROOM_CHANGED`)
   - **When** el Módulo 1 rechaza la orden `RESERVED` para la `Room` B porque está `OCCUPIED`
   - **Then** el sistema no cancela la reserva: el flujo de actualización aborta el cambio, la
     reserva conserva la `Room` A, y se responde **HTTP 400** indicando que la habitación nueva no
     está disponible

6. **Scenario**: Liberación rechazada sobre una habitación ocupada (Error)
   - **Given** una `Room` que el Módulo 1 reporta en `OCCUPIED` porque su Check-In llegó antes que
     la cancelación o el No-Show
   - **When** el sistema ordena `AVAILABLE` para esa `Room`
   - **Then** el Módulo 1 rechaza la orden y la `Room` permanece `OCCUPIED`; el sistema registra la
     solicitud como `REJECTED`, la trata como sin efecto y deja la incidencia registrada para
     revisión

---

### User Story 2 - Reintento por Fallo de Comunicación con el Módulo 1 (Priority: P2)

Cuando la orden de cambio de estado falla por desconexión de red o indisponibilidad del Módulo 1,
el Módulo 2 mantiene la validez de la reserva o de la cancelación, registra la solicitud como
`PENDING` y permite reintentar la sincronización sin afectar al huésped.

**Why this priority**: Es un flujo de resiliencia para que los problemas de infraestructura del
Módulo 1 no impidan crear ni cancelar reservas.

**Independent Test**: Se simula una caída del Módulo 1 al crear una reserva y se comprueba que la
reserva queda registrada con la solicitud en `PENDING`; con la red restablecida se ejecuta el
reintento y la solicitud pasa a `COMPLETED`.

**Acceptance Scenarios**:

1. **Scenario**: Solicitud en PENDING tras una falla de red
   - **Given** una cancelación, un No-Show o un cambio de habitación registrados con éxito en el
     Módulo 2
   - **When** el envío de la orden de liberación al Módulo 1 falla por conexión o tiempo de espera
     agotado
   - **Then** el sistema conserva la cancelación, el No-Show o el cambio, guarda la solicitud con
     `requestStatus` `PENDING` para reintentarla, y responde **HTTP 400** indicando que la
     liberación quedó pendiente

2. **Scenario**: Reintento exitoso de sincronización
   - **Given** una solicitud en `PENDING`
   - **When** el servicio en segundo plano ejecuta el reintento con la comunicación restablecida
   - **Then** el Módulo 1 procesa la orden y el `requestStatus` local pasa a `COMPLETED`

3. **Scenario**: Orden obsoleta ignorada por el Módulo 1
   - **Given** una orden `AVAILABLE` con `sequenceNumber` 5 que sigue en `PENDING`, y una reserva
     posterior que ya ordenó `RESERVED` con `sequenceNumber` 6 para la misma `Room`
   - **When** el reintento de la orden con secuencia 5 llega al Módulo 1
   - **Then** el Módulo 1 la ignora por tener una secuencia menor a la última aplicada, y la `Room`
     permanece `RESERVED` para la reserva nueva; el sistema marca la orden vieja como `REJECTED`

4. **Scenario**: Dos órdenes simultáneas reciben secuencias distintas
   - **Given** dos solicitudes de reserva que piden la misma `Room` en el mismo instante
   - **When** el sistema registra ambas órdenes al Módulo 1
   - **Then** el sistema les asigna `sequenceNumber` consecutivos y distintos, en el orden en que se
     confirmó cada transacción, de modo que el Módulo 1 aplica ambas en el orden correcto y ninguna
     válida se ignora por error

### Casos Borde

- ¿Qué sucede si se envía una solicitud con `roomId` vacío, nulo o inexistente? El sistema
  intercepta la solicitud y retorna **HTTP 400 (Bad Request)**, sin emitir peticiones erróneas al
  Módulo 1 ni generar fallas **HTTP 500**.
- ¿Cómo maneja el sistema dos órdenes simultáneas sobre la misma `Room`? El sistema serializa la
  asignación del `sequenceNumber` por `Room`: cada orden recibe un número distinto, en el orden en
  que se confirmó su transacción, y nunca se repite ni se salta. La primera solicitud válida se
  procesa, y la segunda, si al validar detecta que la habitación ya cambió de estado, recibe **HTTP
  400** informando del cambio previo.
- ¿Qué sucede si el Módulo 1 responde con un mensaje ambiguo o un código de error desconocido? El
  sistema marca la solicitud como `PENDING` para revisión, sin asumir estados no verificados.
- ¿Qué sucede si la reserva se cancela mientras su orden `RESERVED` sigue en `PENDING`? El sistema
  no descarta nada: emite la orden de liberación con un `sequenceNumber` mayor. El Módulo 1 aplica
  las órdenes por secuencia y descarta las de secuencia menor, de modo que una orden vieja que
  llegue tarde nunca sobrescribe una posterior ni deja la habitación apartada o libre por error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe enviar al Módulo 1 una orden de cambio de la `Room` a `RESERVED`,
  incluyendo el detalle completo de la reserva, al crearse una `Reservation`.
- **FR-002**: El sistema debe enviar al Módulo 1 una orden de cambio de la `Room` a `AVAILABLE` al
  cancelarse una `Reservation`, si la habitación se encontraba en `RESERVED`.
- **FR-003**: El sistema debe requerir `roomId`, `requestedStatus` y `originEvent` en toda
  solicitud, y validar que `requestedStatus` sea únicamente `RESERVED` o `AVAILABLE`.
- **FR-004**: El sistema no debe solicitar cambios a `OCCUPIED` ni a estados de limpieza: esos
  cambios los ejecuta exclusivamente el Módulo 1 durante el Check-In y el Check-Out.
- **FR-005**: El sistema debe registrar la solicitud con `requestStatus` `COMPLETED` cuando el
  Módulo 1 confirme el cambio. Cuando la comunicación falle en una orden de liberación
  (`AVAILABLE`), debe registrarla como `PENDING` y reintentarla sin revertir la cancelación, el
  No-Show ni el cambio; cuando falle en una orden `RESERVED` de una reserva recién creada, debe
  informarlo al flujo invocador para que compense.
- **FR-006**: El sistema debe proveer una función de reintento para las solicitudes en `PENDING`.
- **FR-007**: El sistema debe rechazar con **HTTP 400** cualquier orden de apartado sobre una `Room`
  que el Módulo 1 reporte en `OCCUPIED`.
- **FR-008**: El sistema debe interceptar cualquier error de validación de entrada y responder con
  **HTTP 400 (Bad Request)**, prohibiendo fallas de infraestructura **HTTP 500**.
- **FR-009**: El sistema debe asignar a cada solicitud un `sequenceNumber` creciente por `Room`, y
  el Módulo 1 solo debe aplicarla si es mayor que la última aplicada para esa habitación; las
  obsoletas deben quedar como `REJECTED`. La asignación debe ser atómica y serializada por `Room`,
  dentro de la misma transacción que registra la solicitud, con unicidad garantizada de `(roomId,
  sequenceNumber)`, de modo que dos solicitudes simultáneas nunca reciban el mismo número ni queden
  numeradas en un orden distinto al de su confirmación.
- **FR-010**: El sistema debe condicionar toda orden `AVAILABLE` a que la `Room` siga apartada por
  la misma reserva (`previousStatus` `RESERVED` y `reservationRef` coincidente), y no debe liberar
  una `Room` que el Módulo 1 reporte en `OCCUPIED`; en ese caso la orden queda `REJECTED`, sin
  efecto, y se registra la incidencia.
- **FR-011**: El sistema debe informar al flujo invocador el rechazo explícito de una orden
  `RESERVED` (por `Room` `OCCUPIED`) junto con su `originEvent`. Si el origen es
  `RESERVATION_CREATED`, ese flujo debe compensar, tanto por rechazo como por falta de respuesta del
  Módulo 1, cancelando la reserva recién creada con el motivo `ROOM_REJECTED` o `ROOM_UNCONFIRMED`.
  Si el origen es `ROOM_CHANGED`, el rechazo debe volver al flujo "Actualizar reservación", que
  aborta el cambio, conserva la reserva y su `Room` original y responde **HTTP 400**; en ningún caso
  debe cancelarse una estadía existente por el rechazo de una `Room` nueva.
- **FR-012**: El sistema debe mantener un registro auditable de cada solicitud, incluyendo fecha,
  actor, habitación, estado anterior, estado solicitado y resultado.

### Non-Functional Requirements

- **NFR-001**: El tiempo de procesamiento de la solicitud en el Módulo 2 debe ser inferior a 1
  segundo.
- **NFR-002**: El mecanismo de integración debe tolerar fallas para garantizar la consistencia
  eventual entre el Módulo 2 y el Módulo 1.

### Key Entities *(include if feature involves data)*

- **RoomStateRequest**: Orden de actualización de estado enviada al Módulo 1. Atributos:
  `requestId`, `roomId`, `requestedStatus` (`RESERVED` | `AVAILABLE`), `previousStatus`,
  `originEvent` (`RESERVATION_CREATED` | `RESERVATION_CANCELLED` | `RESERVATION_NO_SHOW` |
  `ROOM_CHANGED`), `reservationRef`, `sequenceNumber` (secuencia creciente y única por `Room`,
  asignada de forma atómica),
  `requestedAt`, `requestedBy` (Recepcionista, Ota o sistema) y `requestStatus` (`PENDING` |
  `COMPLETED` | `REJECTED`).
- **ReconciliationIncident**: Registro de una orden rechazada o sin efecto que requiere revisión
  humana (definida en "Registrar Check-In"). Atributos relevantes: `origin` `ROOM_STATE`, `roomId`,
  `reservationRef`, `reason` y `resolutionStatus`.
- **Room**: Unidad física de alojamiento, propiedad del Módulo 1. Atributos: `roomId`, `numberRoom`,
  `categoryRoom` y `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`).
- **Reservation**: Reserva asociada al evento. Atributos: `reservationRef`, `roomId` y `status`
  (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas creadas generan una orden `RESERVED` con el detalle de la
  reserva, y al menos el 99% se confirman como `COMPLETED` en el Módulo 1 dentro de 60 segundos.
- **SC-002**: El 100% de las cancelaciones generan una orden `AVAILABLE` hacia el Módulo 1.
- **SC-003**: Cero errores **HTTP 500** por solicitudes con estados o identificadores inválidos; el
  100% se responde con **HTTP 400**.
- **SC-004**: El 100% de las fallas de comunicación con el Módulo 1 dejan la solicitud en `PENDING`
  sin corromper la reserva ni la cancelación en el Módulo 2.
- **SC-005**: El 95% de las solicitudes en `PENDING` se sincronizan a `COMPLETED` en el primer
  reintento tras restablecerse la conexión.
