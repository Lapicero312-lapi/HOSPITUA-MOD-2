# Feature Specification: Establecer Estado de Habitación

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

El Módulo 2 es el orquestador del estado lógico y financiero de las reservas, pero el estado físico
de una `Room` pertenece exclusivamente al Módulo 1, que es quien opera el hotel en persona. El
Módulo 1 aparta físicamente la habitación (`Reserved`) únicamente cuando la reserva es para el día
operativo en curso, ya sea al crearse una reserva para hoy o al iniciar el día operativo, y no
semanas o meses antes; así se evita que Recepción la asigne a un cliente sin reserva (*walk-in*).
Las reservas con llegada futura no modifican el inventario físico: su disponibilidad se controla con
las reservas locales del Módulo 2. Si la reserva se cancela ese mismo día, la habitación debe volver
a estar libre (`Available`). Si esa comunicación falla —por
una caída de red o una indisponibilidad temporal del Módulo 1— hay dos situaciones distintas. Al
crear una reserva para el día en curso, la creación es todo o nada: sin la confirmación del Módulo 1
la reserva no se
conserva, para no prometer una habitación que no está apartada. En cambio, una cancelación, un
No-Show o la liberación de la habitación anterior en un cambio ya ocurrieron en el Módulo 2 y no
pueden revertirse. El negocio necesita un mecanismo de integración desacoplado que ordene el cambio
de estado al Módulo 1 y que reintente las liberaciones pendientes cuando la comunicación se
restablezca.

Los cambios de `Room` a `Occupied` (Check-In) y a limpieza o `Available` (Check-Out) los ejecuta el
propio Módulo 1 y quedan fuera de esta funcionalidad: el Módulo 2 solo los recibe como
notificaciones para actualizar la reserva (`IN_PROGRESS` y `COMPLETED`).

### Flujo de Usuario de Alto Nivel

1. Al crearse una `Reservation` cuya llegada (`startDate`) es el día operativo en curso, el sistema
   construye una solicitud con el `roomId`, el `requestedStatus` `Reserved`, el `originEvent`
   `RESERVATION_CREATED` y el detalle completo de la reserva. Si la llegada es posterior, no emite
   ninguna orden. Al iniciar cada día operativo, el sistema construye la misma solicitud, con
   `originEvent` `RESERVATION_DUE_TODAY`, para cada reserva `ACTIVE` o `PENDING` cuya llegada es hoy
   y cuya `Room` aún no está apartada por ella.
2. Al cancelarse una `Reservation` cuya `Room` ya está apartada (el mismo día de la llegada) o al
   registrarse su No-Show (`CANCELLED` en canal directo, `NO_SHOW` en canal OTA), el sistema
   notifica de inmediato al Módulo 1 con una solicitud con el `roomId`, el `requestedStatus`
   `Available` y el `originEvent` `RESERVATION_CANCELLED` o `RESERVATION_NO_SHOW`. Si la reserva es
   futura y su `Room` nunca se apartó, no emite ninguna orden. Cuando una modificación cambia la
   habitación de una reserva
   (`ROOM_CHANGED`) en una reserva que ya está apartada, envía primero `Reserved` para la nueva
   `Room` y, tras su confirmación, `Available` para la anterior. Cuando una modificación de fechas
   hace que la llegada sea hoy (`DATES_CHANGED`), envía `Reserved`; si la llegada era hoy y deja de
   serlo, envía `Available`.
3. El sistema transmite la solicitud al **Módulo 1**.
4. Si el Módulo 1 confirma el cambio, la solicitud local se marca como `COMPLETED`.
5. Si la comunicación con el Módulo 1 falla en una orden `Reserved` de una reserva recién creada
   para hoy, el flujo invocador compensa cancelando la reserva y responde **HTTP 400**. Si falla en
   el apartado del inicio del día (`RESERVATION_DUE_TODAY`), la reserva ya existente se conserva: la
   solicitud queda `PENDING` y se reintenta. Si falla en una orden de
   liberación (`Available`), el Módulo 2 **no** revierte la cancelación, el No-Show ni el cambio ya
   registrados; marca la solicitud como `PENDING` y habilita un reintento desacoplado.
6. Cada orden lleva un `sequenceNumber` creciente por `Room`: el Módulo 1 solo aplica una orden si
   su secuencia es mayor que la última aplicada para esa habitación, e ignora las obsoletas.
7. Si el Módulo 1 rechaza una orden `Reserved` porque la `Room` ya está `Occupied`, el sistema lo
   informa al flujo invocador, que actúa según el origen: para una reserva recién creada
   (`RESERVATION_CREATED`) compensa cancelándola; para un cambio de habitación (`ROOM_CHANGED`)
   aborta el cambio y conserva la reserva con su `Room` original; para el apartado del inicio del
   día (`RESERVATION_DUE_TODAY`) conserva la reserva y registra una `ReconciliationIncident`. Si
   rechaza una orden `Available`
   porque
   la `Room` está `Occupied` o ya no la apartó esa reserva, el sistema la trata como sin efecto y
   registra la incidencia, sin liberar nunca una habitación ocupada.
8. Si se intenta un cambio de estado que el Módulo 2 no puede solicitar, el sistema bloquea la
   acción con un error de negocio controlado **HTTP 400 (Bad Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Orden de Cambio de Estado por Creación o Cancelación de Reserva (Priority: P1)

Cuando el Módulo 2 crea o cancela una reserva, ordena al Módulo 1 cambiar el estado de la `Room`
asociada: a `Reserved` el día de la llegada (al crearla si es para hoy, o al iniciar el día
operativo), con el detalle de la reserva adjunto, y a `Available` al cancelarla ese mismo día. Esta
historia es el flujo principal (Happy Path) que mantiene sincronizado el inventario
físico con las reservas.

**Why this priority**: Sin esta orden, el Módulo 1 desconocería qué habitaciones están apartadas o
liberadas, y el hotel podría vender dos veces la misma habitación o mantener bloqueada una que ya
no se va a usar.

**Independent Test**: Se crea una reserva con llegada hoy y se verifica que el Módulo 1 recibe la
orden `Reserved` con el detalle de la reserva y que la solicitud queda `COMPLETED`. Se crea otra con
llegada futura y se verifica que no se emite ninguna orden. Se cancela la primera y se verifica que
el Módulo 1 recibe la orden `Available`.

**Acceptance Scenarios**:

1. **Scenario**: Habitación apartada al crear una reserva para hoy (Happy Path)
   - **Given** una `Reservation` recién creada con llegada hoy para una `Room` en estado
     `Available`
   - **When** el sistema envía la orden mediante "Establecer estado de habitación"
   - **Then** el Módulo 1 recibe la orden junto con el detalle de la reserva, cambia el `status` de
     la `Room` a `Reserved`, y la solicitud queda en `COMPLETED`

2. **Scenario**: Habitación liberada al cancelar una reserva el mismo día (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` o `PENDING` con llegada hoy, cuya `Room` está en
     `Reserved`
   - **When** la reserva se cancela y el sistema notifica de inmediato la orden de liberación
   - **Then** el Módulo 1 cambia el `status` de la `Room` a `Available` y la solicitud queda en
     `COMPLETED`

3. **Scenario**: Rechazo de reserva sobre una habitación ocupada (Error)
   - **Given** una `Room` que el Módulo 1 reporta en `Occupied`
   - **When** se intenta ordenar su cambio a `Reserved`
   - **Then** el sistema bloquea la transacción con **HTTP 400 (Bad Request)** indicando que la
     habitación no está disponible

4. **Scenario**: Rechazo de estado no permitido para el Módulo 2 (Error)
   - **Given** una solicitud de cambio de estado
   - **When** el `requestedStatus` es `Occupied` o cualquier valor distinto de `Reserved` y
     `Available`
   - **Then** el sistema rechaza la solicitud con **HTTP 400** indicando que los cambios a
     `Occupied` los ejecuta exclusivamente el Módulo 1, y no emite ninguna orden

5. **Scenario**: Rechazo de la habitación nueva en un cambio de habitación (Error)
   - **Given** una `Reservation` `ACTIVE` con la `Room` A apartada, y un cambio a la `Room` B
     (`ROOM_CHANGED`)
   - **When** el Módulo 1 rechaza la orden `Reserved` para la `Room` B porque está `Occupied`
   - **Then** el sistema no cancela la reserva: el flujo de actualización aborta el cambio, la
     reserva conserva la `Room` A, y se responde **HTTP 400** indicando que la habitación nueva no
     está disponible

6. **Scenario**: Liberación rechazada sobre una habitación ocupada (Error)
   - **Given** una `Room` que el Módulo 1 reporta en `Occupied` porque su Check-In llegó antes que
     la cancelación o el No-Show
   - **When** el sistema ordena `Available` para esa `Room`
   - **Then** el Módulo 1 rechaza la orden y la `Room` permanece `Occupied`; el sistema registra la
     solicitud como `REJECTED`, la trata como sin efecto y deja la incidencia registrada para
     revisión

7. **Scenario**: Reserva con llegada futura no aparta la habitación
   - **Given** una `Reservation` que se crea con llegada dentro de varias semanas
   - **When** el flujo de creación termina con éxito
   - **Then** el sistema no envía ninguna orden al Módulo 1 y la `Room` conserva su estado; la
     reserva solo bloquea la disponibilidad en las reservas locales del Módulo 2

8. **Scenario**: Habitación apartada al iniciar el día operativo (Happy Path)
   - **Given** una `Reservation` `ACTIVE` con llegada hoy, cuya `Room` sigue en `Available` en el
     Módulo 1
   - **When** inicia el día operativo y el sistema envía la orden con `originEvent`
     `RESERVATION_DUE_TODAY`
   - **Then** el Módulo 1 cambia el `status` de la `Room` a `Reserved` y la solicitud queda en
     `COMPLETED`; si la reserva ya estaba apartada, el sistema no envía una orden repetida

---

### User Story 2 - Reintento por Fallo de Comunicación con el Módulo 1 (Priority: P2)

Cuando una orden de liberación (`Available`) falla por desconexión de red o indisponibilidad del
Módulo 1, el Módulo 2 mantiene la validez de la cancelación, del No-Show o del cambio de habitación,
registra la solicitud como `PENDING` y permite reintentar la sincronización sin afectar al huésped.
Las órdenes `Reserved` de una reserva recién creada no se reintentan: si fallan, se compensa
cancelando la reserva.

**Why this priority**: Es un flujo de resiliencia para que los problemas de infraestructura del
Módulo 1 no impidan cancelar reservas ni procesar el No-Show ni un cambio de habitación ya
registrados.

**Independent Test**: Se simula una caída del Módulo 1 al cancelar una reserva y se comprueba que la
cancelación queda registrada con la orden de liberación en `PENDING`; con la red restablecida se
ejecuta el reintento y la solicitud pasa a `COMPLETED`. Se simula la misma caída al crear una
reserva y se comprueba que la reserva se cancela por compensación y no queda ninguna orden `PENDING`
de apartado.

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

3. **Scenario**: Copia tardía de una orden ya superada, ignorada por el Módulo 1
   - **Given** una orden `Available` con `sequenceNumber` 5 que ya fue aplicada, y una reserva
     posterior cuya orden `Reserved` con `sequenceNumber` 6 también ya fue aplicada para la misma
     `Room`
   - **When** una copia o reintento tardío de la orden con secuencia 5 llega de nuevo al Módulo 1
     por un retraso de red
   - **Then** el Módulo 1 la ignora por tener una secuencia menor a la última aplicada, y la `Room`
     permanece `Reserved` para la reserva nueva; el sistema registra esa copia como `REJECTED`

4. **Scenario**: Dos órdenes simultáneas reciben secuencias distintas
   - **Given** dos solicitudes de reserva que piden la misma `Room` en el mismo instante
   - **When** el sistema registra ambas órdenes al Módulo 1
   - **Then** el sistema les asigna `sequenceNumber` consecutivos y distintos, en el orden en que se
     confirmó cada transacción, y las envía en orden: la de mayor secuencia espera en cola hasta que
     la anterior esté `COMPLETED` o `REJECTED`, de modo que el Módulo 1 siempre recibe primero la de
     menor secuencia y ninguna orden válida se descarta por llegar desordenada

5. **Scenario**: Orden ambigua resuelta antes de avanzar la cola
   - **Given** una orden `Reserved` en `PENDING` por una respuesta ambigua del Módulo 1, y una orden
     `Available` de la misma `Room` esperando en cola
   - **When** el sistema consulta el resultado de la orden `Reserved` por su `requestId`
   - **Then** si el Módulo 1 confirma el resultado, la orden pasa a `COMPLETED` o `REJECTED` y la
     cola avanza; si tras los reintentos acotados no hay respuesta concluyente, la orden queda
     `REJECTED` con `rejectionReason` `UNRESOLVED`, se registra una `ReconciliationIncident` y la
     orden `Available` puede enviarse

### Casos Borde

- ¿Qué sucede si se cancela una reserva con llegada futura? El sistema la cancela solo en el Módulo
  2 y no emite ninguna orden al Módulo 1, porque su `Room` nunca se apartó.
- ¿Qué sucede si al iniciar el día operativo la `Room` sigue `Occupied` por un Check-Out pendiente?
  El Módulo 1 rechaza el apartado (`ROOM_OCCUPIED`), el sistema conserva la reserva, registra una
  `ReconciliationIncident` y no la cancela.
- ¿Qué sucede si se envía una solicitud con `roomId` vacío, nulo o inexistente? El sistema
  intercepta la solicitud y retorna **HTTP 400 (Bad Request)**, sin emitir peticiones erróneas al
  Módulo 1 ni generar fallas **HTTP 500**.
- ¿Cómo maneja el sistema dos órdenes simultáneas sobre la misma `Room`? El sistema serializa la
  asignación del `sequenceNumber` por `Room`: cada orden recibe un número distinto, en el orden en
  que se confirmó su transacción, y nunca se repite ni se salta. La primera solicitud válida se
  procesa, y la segunda, si al validar detecta que la habitación ya cambió de estado, recibe **HTTP
  400** informando del cambio previo.
- ¿Qué sucede si el Módulo 1 responde con un mensaje ambiguo o un código de error desconocido? El
  sistema no asume ningún estado: mantiene la solicitud en `PENDING` solo de forma transitoria y la
  lleva a un estado terminal antes de avanzar la cola de esa `Room`. Para ello consulta al Módulo 1
  el resultado de esa orden por su `requestId` (consulta idempotente) con reintentos acotados; si el
  Módulo 1 confirma que se aplicó, queda `COMPLETED`, y si confirma que no, `REJECTED`. Si al agotar
  los reintentos o el plazo no hay una respuesta concluyente, la marca `REJECTED` con
  `rejectionReason` `UNRESOLVED`, registra una `ReconciliationIncident` y libera la cola, de modo
  que ninguna orden ambigua bloquea indefinidamente a las siguientes.
- ¿Qué sucede si la reserva se cancela mientras su orden `Reserved` sigue en `PENDING`? El sistema
  no descarta nada: registra la orden de liberación con un `sequenceNumber` mayor y la deja en cola
  detrás de la `Reserved`, sin enviarla hasta que esa quede `COMPLETED` o `REJECTED`, respetando la
  entrega ordenada por `Room`. Si más tarde llega al Módulo 1 una copia tardía de una orden ya
  superada, este la descarta por tener una secuencia menor, de modo que nunca sobrescribe una
  posterior ni deja la habitación apartada o libre por error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe enviar al Módulo 1 una orden de cambio de la `Room` a `Reserved`,
  incluyendo el detalle completo de la reserva, únicamente cuando la llegada de la `Reservation` es
  el día operativo en curso: al crearse ese mismo día o al iniciar el día operativo
  (`RESERVATION_DUE_TODAY`). No debe enviarla para reservas con llegada posterior.
- **FR-002**: El sistema debe enviar al Módulo 1, de inmediato, una orden de cambio de la `Room` a
  `Available` al cancelarse una `Reservation` o registrarse su No-Show, si la habitación se
  encontraba en `Reserved`; si nunca se apartó, no debe emitir ninguna orden.
- **FR-003**: El sistema debe requerir `roomId`, `requestedStatus` y `originEvent` en toda
  solicitud, y validar que `requestedStatus` sea únicamente `Reserved` o `Available`.
- **FR-004**: El sistema no debe solicitar cambios a `Occupied` ni a estados de limpieza: esos
  cambios los ejecuta exclusivamente el Módulo 1 durante el Check-In y el Check-Out.
- **FR-005**: El sistema debe registrar la solicitud con `requestStatus` `COMPLETED` cuando el
  Módulo 1 confirme el cambio. Cuando la comunicación falle en una orden de liberación
  (`Available`), debe registrarla como `PENDING` y reintentarla sin revertir la cancelación, el
  No-Show ni el cambio; cuando falle en una orden `Reserved` de una reserva recién creada para hoy,
  debe registrarla como `REJECTED`, informarlo al flujo invocador para que compense y no debe
  reintentarla; cuando falle en el apartado del inicio del día (`RESERVATION_DUE_TODAY`), debe
  registrarla como `PENDING` y reintentarla sin cancelar la reserva.
- **FR-006**: El sistema debe proveer una función de reintento para las solicitudes en `PENDING`.
- **FR-007**: El sistema debe rechazar con **HTTP 400** cualquier orden de apartado sobre una `Room`
  que el Módulo 1 reporte en `Occupied`.
- **FR-008**: El sistema debe interceptar cualquier error de validación de entrada y responder con
  **HTTP 400 (Bad Request)**, prohibiendo fallas de infraestructura **HTTP 500**.
- **FR-009**: El sistema debe enviar las órdenes de una misma `Room` de una en una, en el orden de
  su `sequenceNumber`: no debe enviar la orden N+1 hasta que la N esté `COMPLETED` o `REJECTED`
  (según FR-012, una orden en `PENDING` debe resolverse a uno de esos estados terminales), y las
  siguientes deben esperar en cola por `Room`, de modo que el Módulo 1 reciba siempre primero la
  de menor secuencia; el rechazo por obsoleta del Módulo 1 queda solo como red de seguridad ante
  reintentos tardíos. El sistema debe asignar a cada solicitud un `sequenceNumber` creciente por
  `Room`; el Módulo 1 solo debe aplicarla si es mayor que la última aplicada para esa habitación;
  las
  obsoletas deben quedar como `REJECTED`. La asignación debe ser atómica y serializada por `Room`,
  dentro de la misma transacción que registra la solicitud, con unicidad garantizada de `(roomId,
  sequenceNumber)`, de modo que dos solicitudes simultáneas nunca reciban el mismo número ni queden
  numeradas en un orden distinto al de su confirmación.
- **FR-010**: El sistema debe condicionar toda orden `Available` a que la `Room` siga apartada por
  la misma reserva (`previousStatus` `Reserved` y `reservationRef` coincidente), y no debe liberar
  una `Room` que el Módulo 1 reporte en `Occupied`; en ese caso la orden queda `REJECTED`, sin
  efecto, y se registra la incidencia.
- **FR-011**: El sistema debe informar al flujo invocador el rechazo explícito de una orden
  `Reserved` (por `Room` `Occupied`) junto con su `originEvent`. Si el origen es
  `RESERVATION_CREATED`, ese flujo debe compensar, tanto por rechazo como por falta de respuesta del
  Módulo 1, cancelando la reserva recién creada con el motivo `ROOM_REJECTED` o `ROOM_UNCONFIRMED`.
  Si el origen es `ROOM_CHANGED`, el rechazo debe volver al flujo "Actualizar reservación", que
  aborta el cambio, conserva la reserva y su `Room` original y responde **HTTP 400**; en ningún caso
  debe cancelarse una estadía existente por el rechazo de una `Room` nueva. Si el origen es
  `ROOM_CHANGED` y el Módulo 1 no responde, el sistema debe además neutralizar la posible reserva de
  la `Room` nueva con una orden `Available` de mayor `sequenceNumber`, ya que el resultado es
  ambiguo.
- **FR-012**: El sistema debe llevar a un estado terminal (`COMPLETED` o `REJECTED`) toda orden que
  quede en `PENDING` por una respuesta ambigua, un timeout o una falla de comunicación, consultando
  al Módulo 1 el resultado de esa orden por su `requestId` con reintentos y un plazo acotados; si no
  obtiene una respuesta concluyente, debe marcarla `REJECTED` con `rejectionReason` `UNRESOLVED`,
  registrar una `ReconciliationIncident` y liberar la cola de esa `Room`, para que ninguna orden
  bloquee indefinidamente a las siguientes.
- **FR-013**: El sistema debe mantener un registro auditable de cada solicitud, incluyendo fecha,
  actor, habitación, estado anterior, estado solicitado y resultado.
- **FR-014**: El sistema debe ejecutar al inicio de cada día operativo un proceso que ordene
  `Reserved` para las reservas `ACTIVE` o `PENDING` con llegada hoy cuya `Room` aún no esté apartada
  por ellas, sin enviar órdenes repetidas si el proceso se ejecuta más de una vez.
- **FR-015**: El sistema debe conservar la reserva cuando el Módulo 1 rechace o no confirme el
  apartado del inicio del día, y registrar una `ReconciliationIncident` en el caso de un rechazo por
  `Room` `Occupied`.

### Non-Functional Requirements

- **NFR-001**: El tiempo de procesamiento de la solicitud en el Módulo 2 debe ser inferior a 1
  segundo.
- **NFR-002**: El mecanismo de integración debe tolerar fallas para garantizar la consistencia
  eventual entre el Módulo 2 y el Módulo 1.

### Key Entities *(include if feature involves data)*

- **RoomStateRequest**: Orden de actualización de estado enviada al Módulo 1. Atributos:
  `requestId`, `roomId`, `requestedStatus` (`Reserved` | `Available`), `previousStatus`,
  `originEvent` (`RESERVATION_CREATED` | `RESERVATION_DUE_TODAY` | `RESERVATION_CANCELLED` |
  `RESERVATION_NO_SHOW` | `ROOM_CHANGED` | `DATES_CHANGED`), `reservationRef`, `sequenceNumber`
  (secuencia creciente y
  única por `Room`,
  asignada de forma atómica),
  `requestedAt`, `requestedBy` (Recepcionista, Ota o sistema) y `requestStatus` (`PENDING` |
  `COMPLETED` | `REJECTED`) y `rejectionReason` (`OBSOLETE` | `ROOM_OCCUPIED` | `UNRESOLVED`, solo
  cuando es `REJECTED`).
- **ReconciliationIncident**: Registro de una orden rechazada o sin efecto que requiere revisión
  humana (definida en "Registrar Check-In"). Atributos relevantes: `origin` `ROOM_STATE`, `roomId`,
  `reservationRef`, `reason` y `resolutionStatus`.
- **Room**: Unidad física de alojamiento, propiedad del Módulo 1. Atributos: `id`, `roomNumber`,
  `categoryRoom` y `status` (`Available` | `Reserved` | `Occupied`).
- **Reservation**: Reserva asociada al evento. Atributos: `reservationRef`, `roomId` y `status`
  (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas con llegada en el día en curso (creadas hoy o al iniciar el
  día operativo) generan una orden `Reserved` con el detalle de la reserva, y al menos el 99% se
  confirman como `COMPLETED` en el Módulo 1 dentro de 60 segundos; ninguna reserva con llegada
  posterior genera una orden.
- **SC-002**: El 100% de las cancelaciones y No-Shows de reservas cuya `Room` estaba `Reserved`
  generan una orden `Available` hacia el Módulo 1.
- **SC-003**: Cero errores **HTTP 500** por solicitudes con estados o identificadores inválidos; el
  100% se responde con **HTTP 400**.
- **SC-004**: El 100% de las fallas de comunicación con el Módulo 1 en órdenes de liberación dejan
  la solicitud en `PENDING` sin corromper la cancelación, el No-Show ni el cambio de habitación en
  el Módulo 2, y el 100% de las fallas en órdenes `Reserved` de una reserva recién creada se
  compensan cancelándola, sin dejar reservas sin habitación apartada.
- **SC-005**: El 95% de las solicitudes en `PENDING` se sincronizan a `COMPLETED` en el primer
  reintento tras restablecerse la conexión.
