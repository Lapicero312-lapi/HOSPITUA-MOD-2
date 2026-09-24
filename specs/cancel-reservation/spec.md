# Feature Specification: Cancelación de Reservación

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

Las reservas se caen todo el tiempo: el huésped cambia de planes, la agencia recibe una anulación o
la Recepcionista atiende una llamada para dar de baja una reserva. El hotel necesita procesar esas
cancelaciones de forma ágil por los dos canales por los que llegan —recepción y API de la OTA— y, sobre todo, necesita que la habitación vuelva a estar libre de
inmediato para poder venderla otra vez. Como el pago del 100% de la estadía se liquida en el
Check-Out, cancelar antes del ingreso no genera cobros ni penalidades: es un proceso gratuito que
solo tiene efecto sobre la reserva y sobre el estado físico de la habitación. El sistema debe además
proteger la reserva frente a cancelaciones inválidas, como intentar anular una estadía que ya está
en curso.

### Flujo de Usuario de Alto Nivel

1. El solicitante (la **Recepcionista** o la **Ota** desde su API) localiza la reserva mediante "Consultar reservas".
2. El sistema valida que la `Reservation` esté en estado `ACTIVE` o `PENDING`.
3. El solicitante confirma la cancelación: en pantalla para la Recepcionista, o mediante el JSON recibido para la Ota.
4. El sistema cambia el `status` de la reserva a `CANCELLED`.
5. El sistema ejecuta "Establecer estado de habitación" para ordenar al Módulo 1 que la `Room`
   vuelva a `AVAILABLE`, si estaba en `RESERVED`.
6. El sistema registra la cancelación en `Cancellation` para auditoría.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cancelación de Reservación y Liberación de Habitación (Priority: P1)

Un solicitante necesita anular una reserva que aún no ha iniciado su estadía. El caso de negocio es el mismo para los dos canales: se localiza la reserva, se valida que su estado admita cancelación,
se confirma la baja, se cambia el estado a `CANCELLED` y se ordena al Módulo 1 liberar la
habitación. Por eso los caminos de éxito de los dos canales y los bloqueos lógicos (estadía en
curso o finalizada, referencia vacía, cancelación concurrente) se consolidan en esta misma historia
de usuario, para evitar la sobre-atomización.

**Why this priority**: Es el flujo principal para procesar bajas de hospedaje. Permite al hotel
recuperar inventario vendible en tiempo real, evitando ocupaciones fantasma por reservas que ya no
se van a honrar.

**Independent Test**: Se cancela una reserva `ACTIVE` por cada uno de los dos canales y se verifica
que el `status` cambia a `CANCELLED`, que se registra la `Cancellation` con el canal correcto y que
el Módulo 1 recibe la orden de devolver la `Room` a `AVAILABLE`. La prueba se completa intentando
cancelar reservas `IN_PROGRESS`, `COMPLETED`, `CANCELLED` y `NO_SHOW`, confirmando que cada intento
se bloquea con un error controlado.

**Acceptance Scenarios**:

1. **Scenario**: Cancelación exitosa por la Recepcionista (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` cuya `Room` está en `RESERVED`
   - **When** la Recepcionista confirma la cancelación
   - **Then** el sistema cambia la reserva a `CANCELLED`, registra la `Cancellation` con su canal, y
     ordena al Módulo 1 cambiar la `Room` a `AVAILABLE`

2. **Scenario**: Cancelación exitosa de una reserva OTA vía API (Happy Path)
   - **Given** una `Reservation` con `source` `OTA` en `ACTIVE` o `PENDING`
   - **When** la API recibe la solicitud de cancelación de la **Ota**
   - **Then** el sistema procesa la baja de inmediato, cambia la reserva a `CANCELLED`, ordena al
     Módulo 1 liberar la `Room` y devuelve una respuesta HTTP 200

3. **Scenario**: Bloqueo de cancelación para estadía en curso o finalizada (Error)
   - **Given** una `Reservation` en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`
   - **When** cualquier canal intenta cancelarla
   - **Then** el sistema bloquea la acción, no envía ninguna orden al Módulo 1 y responde con un
     error controlado **HTTP 400 (Bad Request)** indicando que el estado actual no admite
     cancelación

### Casos Borde

- ¿Qué sucede si el Módulo 1 no responde al enviar la orden de liberación de la habitación? La
  reserva queda cancelada localmente, la orden queda en `PENDING` para reintentarse, y el sistema
  responde con una alerta controlada **HTTP 400** indicando: "Reserva cancelada, pero hubo un fallo
  al notificar la liberación de la habitación. Se reintentará automáticamente."
- ¿Qué sucede si la referencia de la reserva es vacía o nula? El sistema intercepta el payload antes
  de tocar la lógica de negocio y responde **HTTP 400 (Bad Request)** con el mensaje: "La referencia
  de la reserva es obligatoria."
- ¿Cómo maneja el sistema dos cancelaciones simultáneas de la misma reserva? Usa control de
  concurrencia optimista: la primera aplica la cancelación y la segunda recibe **HTTP 400**
  indicando: "Esta reserva ya fue actualizada o cancelada recientemente", sin duplicar registros ni
  órdenes al Módulo 1.


## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe ubicar la reserva mediante "Consultar reservas" antes de habilitar la
  cancelación.
- **FR-002**: El sistema debe autorizar la cancelación únicamente si la `Reservation` está en
  `ACTIVE` o `PENDING`.
- **FR-003**: El sistema debe cambiar el `status` de la `Reservation` a `CANCELLED` al confirmarse
  la solicitud.
- **FR-004**: El sistema debe ordenar al Módulo 1, mediante "Establecer estado de habitación",
  devolver la `Room` a `AVAILABLE` cuando estuviera en `RESERVED`, sin revertir la cancelación si esa
  orden falla.
- **FR-005**: El sistema debe registrar cada cancelación en `Cancellation` con la referencia de la
  reserva, la fecha, el canal (`RECEPTION` u `OTA_API`) y quién la procesó.
- **FR-006**: El sistema no debe cobrar penalidades ni invocar la liquidación del Módulo 3 al
  cancelar.
- **FR-007**: El sistema debe interceptar errores de validación, estado incorrecto o concurrencia y
  responder con **HTTP 400 (Bad Request)** amigable, prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El procesamiento local de la cancelación debe completarse en menos de 200
  milisegundos, sin contar la respuesta del Módulo 1.

### Key Entities *(include if feature involves data)*

- **Cancellation**: Registro de auditoría de la anulación. Atributos: `cancellationId`,
  `reservationRef`, `cancellationDate`, `reason` (opcional), `channel` (`RECEPTION` | `OTA_API`), `processedBy` y `status` (`COMPLETED`).
- **Reservation**: Estadía que se anula. Atributos: `reservationRef`, `guestRef`, `roomId`,
  `startDate`, `endDate`, `source` (`DIRECT` | `OTA`) y `status` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`). Solo pasa a `CANCELLED` desde `ACTIVE` o
  `PENDING`.
- **Room**: Habitación física, propiedad del Módulo 1. Atributos: `roomId`, `numberRoom`,
  `categoryRoom` y `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`). Pasa de `RESERVED` a
  `AVAILABLE` por la cancelación.
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `contactEmail`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las cancelaciones exitosas ordenan al Módulo 1 la liberación de la `Room`.
- **SC-002**: El 100% de los intentos inválidos de cancelación se rechazan con **HTTP 400**, con
  cero errores **HTTP 500**.
- **SC-003**: Cero habitaciones permanecen en `RESERVED` de forma indefinida tras una cancelación
  confirmada.
- **SC-004**: El 100% de las cancelaciones quedan registradas en `Cancellation` con su canal de
  origen.
