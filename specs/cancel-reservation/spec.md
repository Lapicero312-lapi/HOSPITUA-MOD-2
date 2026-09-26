# Feature Specification: Cancelación de Reservación

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Las reservas se caen todo el tiempo: el huésped cambia de planes, la agencia recibe una anulación o
la Recepcionista atiende una solicitud para dar de baja una estadía. El hotel necesita procesar esas
cancelaciones de forma ágil por los tres canales por los que llegan —recepción, portal del huésped y
API de la Ota— y, sobre todo, necesita recuperar de inmediato el cupo de aforo de la `categoryRoom`
correspondiente, para poder ofrecerlo nuevamente en tiempo real.

Es importante precisar que, durante la etapa de reserva, no existe ningún `numberRoom` físico
asignado: la asignación del cuarto real ocurre únicamente en el Check-In, en recepción. Por lo
tanto, cancelar una reserva no libera ni modifica ninguna `Room` física del Módulo 1, porque en esta
etapa no hay ningún cuarto físico que liberar. La cancelación se resuelve de manera enteramente
local, dentro del inventario y la base de datos de reservas del Módulo 2, sin depender de la
disponibilidad ni de la respuesta de otros módulos.

Como el pago del 100% de la estadía se liquida en el Check-Out, cancelar antes del ingreso no genera
cobros ni penalidades para ningún canal, sea Directo u Ota: es un proceso gratuito que no requiere
ninguna llamada al Módulo 3 de liquidación. El sistema debe además proteger la reserva frente a
cancelaciones inválidas, como intentar anular una estadía que ya inició, que ya finalizó o que ya
fue anulada previamente.

### Flujo de Usuario de Alto Nivel

1. El solicitante (la **Recepcionista**, el **Huésped** desde el portal, o la **Ota** desde su API)
   localiza la reserva invocando localmente el caso de uso interno "Consultar / ver reserva" dentro
   del Módulo 2.
2. El sistema valida localmente que la `Reservation` esté en estado `ACTIVE`.
3. El solicitante confirma la anulación: en pantalla para la Recepcionista o el Huésped, o mediante
   el JSON/webhook recibido para la Ota.
4. El sistema transiciona el estado local de la reserva a `CANCELLED`.
5. El sistema restituye de inmediato, dentro del inventario local del Módulo 2, el cupo de aforo de
   la `categoryRoom` asociada a la reserva.
6. El sistema registra la cancelación en `Cancellation` para auditoría.

No existe ningún paso adicional hacia el Módulo 1 ni hacia el Módulo 3: la totalidad del proceso se
resuelve dentro de los límites del Módulo 2.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Cancelación de Reservación (Priority: P1)

**Plain Language**: Anulación local y gratuita de reservas activas, disponible para los tres canales
de solicitud (Recepción, Huésped y Ota), que restituye de inmediato el cupo de aforo lógico de la
`categoryRoom` en el inventario del Módulo 2, sin ninguna dependencia del Módulo 1 ni del Módulo 3.

Un solicitante necesita anular una reserva que aún no ha iniciado su estadía. El caso de negocio es
el mismo para los tres canales: se localiza la reserva mediante "Consultar / ver reserva", se valida
que su estado admita cancelación, se confirma la baja, se transiciona el estado a `CANCELLED` y se
restituye el cupo de aforo local de la `categoryRoom`. Por eso los caminos de éxito de los tres
canales y el bloqueo lógico por estadía en curso, finalizada o ya anulada se consolidan en esta misma
historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Es el flujo principal para procesar bajas de hospedaje. Permite al hotel
recuperar cupo de aforo vendible en tiempo real, evitando ocupaciones fantasma por reservas que ya
no se van a honrar, sin generar acoplamientos ni fallos en cascada hacia otros módulos.

**Independent Test**: Se cancela una `Reservation` en `ACTIVE` por cada uno de los tres canales y se
verifica que el `state` cambia a `CANCELLED`, que el cupo de aforo local de la `categoryRoom` se
restituye de inmediato en la base de datos del Módulo 2, y que se registra la `Cancellation` con el
canal correcto. La prueba se completa intentando cancelar reservas en `CHECKED_IN`, `CHECKED_OUT`,
`CANCELLED` y `NO_SHOW`, confirmando que cada intento se bloquea con un error controlado **HTTP
400**, y verificando en todos los casos que no se produce ninguna llamada, síncrona ni asíncrona,
hacia el Módulo 1 o el Módulo 3.

**Acceptance Scenarios**:

1. **Escenario 1**: Cancelación por Recepcionista (Canal Recepción)

   ```gherkin
   Given una Reservation en estado ACTIVE localizada mediante "Consultar / ver reserva"
   When la Recepcionista confirma la cancelación desde el canal Recepción
   Then el sistema transiciona el state de la reserva a CANCELLED
   And restituye de inmediato el cupo de aforo local de la categoryRoom en el Módulo 2
   And registra la Cancellation con channel RECEPTION y processedBy la Recepcionista
   And no emite ninguna llamada hacia el Módulo 1 ni hacia el Módulo 3
   ```

2. **Escenario 2**: Cancelación por Huésped (Canal Web, con notificación local por correo)

   ```gherkin
   Given una Reservation en estado ACTIVE consultada por el propio Huésped en el portal web
   When el Huésped confirma la cancelación desde el portal
   Then el sistema transiciona el state de la reserva a CANCELLED
   And restituye de inmediato el cupo de aforo local de la categoryRoom en el Módulo 2
   And registra la Cancellation con channel USER_PORTAL
   And envía una notificación local por correo confirmando la anulación al Huésped
   ```

3. **Escenario 3**: Cancelación por OTA (API / Webhook asíncrono)

   ```gherkin
   Given una Reservation con source OTA en estado ACTIVE
   When la API del Módulo 2 recibe el webhook asíncrono de cancelación de la Ota
   Then el sistema transiciona el state de la reserva a CANCELLED
   And restituye de inmediato el cupo de aforo local de la categoryRoom en el Módulo 2
   And registra la Cancellation con channel OTA_API
   And responde con confirmación HTTP 200 sin invocar al Módulo 1 ni al Módulo 3
   ```

4. **Escenario 4**: Bloqueo de cancelación para reservas inactivas o finalizadas (Error)

   ```gherkin
   Given una Reservation en estado CHECKED_IN, CHECKED_OUT, CANCELLED o NO_SHOW
   When cualquier canal intenta cancelarla
   Then el sistema bloquea la acción sin modificar el state actual
   And no restituye ningún cupo de aforo
   And no emite ninguna llamada hacia el Módulo 1 ni hacia el Módulo 3
   And responde con un error controlado HTTP 400 (Bad Request) indicando que el estado actual no admite cancelación
   ```

## 3. Casos Borde

- **Caso Borde 1**: Solicitud con parámetros nulos o invalidados. Si la referencia de la reserva
  llega vacía, nula o con un formato inválido, el sistema intercepta el payload antes de tocar la
  lógica de negocio y responde con un error controlado **HTTP 400 (Bad Request)** indicando que la
  referencia de la reserva es obligatoria.
- **Caso Borde 2**: Incoherencia de fechas o No-Show. Si la reserva tiene una fecha de llegada ya
  superada sin que el huésped haya realizado el ingreso, la solicitud de cancelación se procesa de
  igual forma: el sistema transiciona el `state` a `CANCELLED` de manera local y libera de inmediato
  el cupo de aforo de la `categoryRoom`, sin distinguir este caso como una situación especial de
  No-Show, ya que dicha clasificación corresponde a otra funcionalidad independiente.
- **Caso Borde 3**: Concurrencia simultánea de cancelación. Si dos solicitudes intentan cancelar la
  misma reserva al mismo tiempo, el sistema aplica control de concurrencia optimista mediante el
  atributo `version` de `Reservation`: la primera solicitud aplica la cancelación y actualiza la
  `version`; la segunda, al no coincidir con la `version` vigente, es rechazada con un error
  controlado **HTTP 400**, sin duplicar registros de `Cancellation` ni restituir el cupo de aforo dos
  veces.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe validar la existencia local de la reserva invocando el caso de uso
  interno "Consultar / ver reserva" del Módulo 2, antes de habilitar la cancelación.
- **FR-002**: El sistema debe exigir que la `Reservation` se encuentre en estado `ACTIVE` para
  proceder con la cancelación; cualquier otro estado debe bloquear la operación.
- **FR-003**: El sistema debe transicionar el `state` de la `Reservation` a `CANCELLED` y restituir
  de inmediato el cupo de aforo local de la `categoryRoom` correspondiente, en la base de datos del
  Módulo 2.
- **FR-004**: Queda estrictamente prohibido que el sistema realice cualquier llamada, síncrona o
  asíncrona, hacia el Módulo 1 (incluyendo el caso de uso "Establecer estado de habitación" o
  "Set Room State") o hacia el Módulo 3, como parte del proceso de cancelación.
- **FR-005**: El sistema debe registrar cada cancelación en una bitácora inmutable dentro de la
  entidad `Cancellation`, incluyendo la referencia de la reserva, la fecha, el canal de origen y
  quién la procesó.
- **FR-006**: El sistema debe responder obligatoriamente con errores controlados **HTTP 400 (Bad
  Request)** o **HTTP 404 (Not Found)** ante cualquier condición inválida, quedando prohibida la
  propagación de errores **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El procesamiento local de la cancelación debe completarse en un tiempo de respuesta
  inferior a 200 milisegundos.
- **NFR-002**: La operación de cancelación debe ser idempotente, de modo que reintentos ante fallas
  de red no dupliquen registros de `Cancellation` ni restituyan el cupo de aforo más de una vez.

## 5. Entidades Clave

- **Cancellation**: Registro de auditoría inmutable de la anulación. Atributos: `cancellationId`,
  `reservationRef`, `cancellationDate`, `reason` (opcional), `channel` (`RECEPTION` |
  `USER_PORTAL` | `OTA_API`), `processedBy` y `status` (`COMPLETED`).
- **Reservation**: Estadía que se anula. Atributos: `id`, `guestRef`, `categoryRoom`,
  `checkInDate`, `checkOutDate`, `grossAmount`, `version` (control de concurrencia optimista),
  `source` (`DIRECT` | `OTA`) y `state` (`ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`,
  `NO_SHOW`). Solo pasa a `CANCELLED` desde `ACTIVE`.
- **Room**: Entidad física de alojamiento del Módulo 1, identificada por `roomId` y `numberRoom`. En
  el alcance de esta funcionalidad se referencia únicamente a través de su categoría lógica
  (`categoryRoom`), utilizada exclusivamente para identificar el cupo de aforo local que se
  restituye dentro del Módulo 2; no se referencia ni se modifica ningún `numberRoom` físico
  individual.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las cancelaciones restituyen el cupo del aforo lógico de la `categoryRoom`
  de forma exacta en la base de datos local del Módulo 2.
- **SC-002**: Cero llamadas de integración, síncronas o asíncronas, realizadas hacia el Módulo 1 o el
  Módulo 3 durante todo el proceso de cancelación.
- **SC-003**: El 100% de los fallos de validación, estado inválido o concurrencia devuelven
  respuestas estructuradas **HTTP 400**, con cero excepciones **HTTP 500**.
