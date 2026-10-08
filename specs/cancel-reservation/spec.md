# Feature Specification: Cancelación de Reservación

**Created**: 2026-09-19
**Updated**: 2026-09-29

## Use Case (Caso de Uso)

### Descripción del problema

Las reservas se caen todo el tiempo: el huésped cambia de planes, la agencia recibe una anulación o
la Recepcionista atiende una llamada para dar de baja una reserva. El hotel necesita procesar esas
cancelaciones de forma ágil por los dos canales por los que llegan —recepción y API de la OTA— y,
sobre todo, cuando la cancelación ocurre el mismo día de la llegada, necesita avisar al Módulo 1 para
que libere la habitación. El Módulo 2 no libera habitaciones: lo avisa en la lista de reservas del día
y el Módulo 1, dueño del estado de las habitaciones, decide qué hacer. Como el pago del 100% de la estadía se liquida en el
Check-Out, cancelar antes del ingreso no genera cobros ni penalidades: es un proceso gratuito que
solo tiene efecto sobre la reserva. El sistema debe además
proteger la reserva frente a cancelaciones inválidas, como intentar anular una estadía que ya está
en curso.

### Flujo de Usuario de Alto Nivel

1. El solicitante (la **Recepcionista** o la **Ota** desde su API) localiza la reserva mediante
   "Consultar reservas". La Recepcionista solo cancela reservas de canal `DIRECT`; una reserva de
   canal `OTA` solo la cancela la Ota por su API (canal `OTA_API`).
2. El sistema valida que la `Reservation` esté en estado `ACTIVE` o `PENDING`.
3. El solicitante confirma la cancelación: para la Recepcionista, marcando en pantalla una casilla
   de confirmación ("Entiendo que la cancelación no se puede deshacer") antes de que el botón de
   confirmar se habilite; para la Ota, mediante el JSON recibido.
4. El sistema cambia el atributo `Reservation.status` directamente a `CANCELLED`, de forma atómica
   dentro de la transacción de cancelación, sin requerir la invocación del flujo de modificación de
   reservación.
5. Si la reserva forma parte de la lista del día ya enviada al Módulo 1, el sistema la quita de esa
   lista mediante "Enviar reservas del día al Módulo 1" (`REMOVED` con motivo `CANCELLED`). El Módulo
   1 decide qué hace con la habitación: el Módulo 2 no le ordena nada.
6. El sistema registra la cancelación en `Cancellation` para auditoría.

La cancelación aplica siempre a la reserva completa, con todas sus habitaciones. Para quitar solo
una habitación de una reserva con varias, se usa "Actualizar reservación".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cancelación de Reservación y Liberación de Habitación (Priority: P1)

Un solicitante necesita anular una reserva que aún no ha iniciado su estadía. El caso de negocio es
el mismo para los dos canales: se localiza la reserva, se valida que su estado admita cancelación,
se confirma la baja, se cambia el estado a `CANCELLED` y, si la reserva estaba en la lista del día, se
avisa al Módulo 1. Por eso los caminos de éxito de los dos canales y los bloqueos lógicos
(estadía en
curso o finalizada, referencia vacía, cancelación concurrente) se consolidan en esta misma historia
de usuario, para evitar la sobre-atomización.

**Why this priority**: Es el flujo principal para procesar bajas de hospedaje. Permite al hotel
avisar al Módulo 1 de inmediato para que recupere inventario vendible, evitando ocupaciones fantasma
por reservas que ya no se van a honrar.

**Independent Test**: Se cancela una reserva `ACTIVE` con llegada hoy por cada uno de los dos
canales y se verifica que el `status` cambia a `CANCELLED`, que se registra la `Cancellation` con el
canal correcto y que el Módulo 1 recibe de inmediato un `REMOVED` con motivo `CANCELLED`.
Se cancela una reserva con llegada futura y se verifica que no se avisa nada. La prueba se
completa intentando
cancelar reservas `IN_PROGRESS`, `COMPLETED`, `CANCELLED` y `NO_SHOW`, confirmando que cada intento
se bloquea con un error controlado.

**Acceptance Scenarios**:

1. **Scenario**: Cancelación exitosa por la Recepcionista (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` con llegada hoy, que ya está en la lista del día
   - **When** la Recepcionista confirma la cancelación
   - **Then** el sistema cambia la reserva a `CANCELLED`, registra la `Cancellation` con su canal, y
     avisa `REMOVED` (motivo `CANCELLED`) al Módulo 1

2. **Scenario**: Cancelación exitosa de una reserva OTA vía API (Happy Path)
   - **Given** una `Reservation` con `source` `OTA` en `ACTIVE` o `PENDING` y con llegada hoy
   - **When** la API recibe la solicitud de cancelación de la **Ota**
   - **Then** el sistema procesa la baja de inmediato, cambia la reserva a `CANCELLED`, avisa
     `REMOVED` al Módulo 1 si estaba en la lista del día y devuelve una respuesta HTTP 200

3. **Scenario**: Cancelación de una reserva con llegada futura (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` o `PENDING` cuya llegada es dentro de varios días
   - **When** cualquier canal confirma la cancelación
   - **Then** el sistema cambia la reserva a `CANCELLED`, registra la `Cancellation` y no avisa nada
     al Módulo 1

4. **Scenario**: Bloqueo de cancelación para estadía en curso o finalizada (Error)
   - **Given** una `Reservation` en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`
   - **When** cualquier canal intenta cancelarla
   - **Then** el sistema bloquea la acción, no avisa nada al Módulo 1 y responde con un
     error controlado **HTTP 400 (Bad Request)** indicando que el estado actual no admite
     cancelación

5. **Scenario**: Cancelación de una reserva con varias habitaciones y llegada hoy (Happy Path)
   - **Given** una `Reservation` `ACTIVE` con llegada hoy y las `Room` 101 y 102
   - **When** la Recepcionista confirma la cancelación
   - **Then** el sistema cambia la reserva a `CANCELLED`, registra una sola `Cancellation` y avisa
     `REMOVED` en la lista del día

6. **Scenario**: La Recepcionista intenta cancelar una reserva OTA (Error)
   - **Given** una `Reservation` con `source` `OTA` en `ACTIVE` o `PENDING`
   - **When** la Recepcionista intenta cancelarla
   - **Then** el sistema la rechaza con **HTTP 400** indicando que la cancelación debe llegar por la
     API de la agencia, y no registra ninguna `Cancellation`

### Casos Borde

- ¿Qué sucede si falla la publicación del aviso `REMOVED` al Módulo 1? La reserva queda cancelada
  localmente, el aviso queda pendiente y se reintenta en orden (ver "Consultar y buscar reservas").
- ¿Qué sucede si la referencia de la reserva es vacía o nula? El sistema intercepta el payload antes
  de tocar la lógica de negocio y responde **HTTP 400 (Bad Request)** con el mensaje: "La referencia
  de la reserva es obligatoria."
- ¿Cómo maneja el sistema dos cancelaciones simultáneas de la misma reserva? Usa control de
  concurrencia optimista: la primera aplica la cancelación y la segunda recibe **HTTP 400**
  indicando: "Esta reserva ya fue actualizada o cancelada recientemente", sin duplicar registros ni
  avisos al Módulo 1.
- ¿Se puede cancelar una reserva con varias habitaciones cuando una ya tuvo Check-In? No: la reserva
  ya está en `IN_PROGRESS` y el sistema responde **HTTP 400**. Las habitaciones que no lleguen quedan
  como `NOT_ARRIVED` en el cierre del día.


## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe ubicar la reserva mediante "Consultar reservas" antes de habilitar la
  cancelación.
- **FR-002**: El sistema debe autorizar la cancelación únicamente si la `Reservation` está en
  `ACTIVE` o `PENDING`.
- **FR-002a**: El sistema debe permitir a la Recepcionista cancelar solo reservas de canal `DIRECT`
  (canal `RECEPTION`); las reservas de canal `OTA` solo las cancela la Ota por su API (canal
  `OTA_API`).
- **FR-002b**: La pantalla de cancelación debe exigir que la Recepcionista marque una casilla de
  confirmación ("Entiendo que la cancelación no se puede deshacer") antes de habilitar el botón que
  confirma la cancelación.
- **FR-003**: El sistema debe cambiar el atributo `Reservation.status` directamente a `CANCELLED` al
  confirmarse la solicitud, de forma atómica dentro de la transacción de cancelación y aplicando las
  transiciones `ACTIVE` o `PENDING` → `CANCELLED` y el control de concurrencia, sin requerir la
  invocación del flujo de modificación de reservación.
- **FR-004a**: El sistema debe avisar al Módulo 1, mediante "Enviar reservas del día al Módulo 1",
  la cancelación de una reserva que forme parte de la lista del día ya enviada (`REMOVED` con motivo
  `CANCELLED`).
- **FR-005**: El sistema debe registrar cada cancelación en `Cancellation` con la referencia de la
  reserva, la fecha, el canal (`RECEPTION` u `OTA_API`) y quién la procesó.
- **FR-006**: El sistema no debe cobrar penalidades ni invocar la liquidación del Módulo 3 al
  cancelar, ni modificar la comisión de una reserva OTA cancelada por la Ota (ver
  `register-ota-information-commission` FR-007).
- **FR-007**: El sistema debe interceptar errores de validación, estado incorrecto o concurrencia y
  responder con **HTTP 400 (Bad Request)** amigable, prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El procesamiento local de la cancelación debe completarse en menos de 200
  milisegundos, sin contar la respuesta del Módulo 1.

### Key Entities *(include if feature involves data)*

- **Cancellation**: Registro de auditoría de la anulación. Atributos: `cancellationId`,
  `reservationRef`, `cancellationDate`, `reason` (opcional), `channel` (`RECEPTION` | `OTA_API`),
  `processedBy` y `status` (`COMPLETED`).
- **Reservation**: Estadía que se anula. Atributos: `reservationRef`, `guestRef`, `startDate`,
  `endDate`, `source` (`DIRECT` | `OTA`) y `status` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`). Solo pasa a `CANCELLED` desde `ACTIVE` o
  `PENDING`.
- **ReservationRoom**: Habitaciones de la reserva. Atributos: `reservationRef`,
  `roomId`, `roomNumber` y `stayStatus`.
- **Room**: Habitación física, propiedad del Módulo 1. Atributos: `id`, `roomNumber`, `categoryRoom`
  y `status` (`Available` | `Reserved` | `Occupied`). Solo se menciona: el Módulo 2 no la modifica.
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `contactEmail`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las cancelaciones de reservas que estaban en la lista del día se avisan al
  Módulo 1 como `REMOVED` con motivo `CANCELLED`.
- **SC-002**: El 100% de los intentos inválidos de cancelación se rechazan con **HTTP 400**, con
  cero errores **HTTP 500**.
- **SC-004**: El 100% de las cancelaciones quedan registradas en `Cancellation` con su canal de
  origen.
