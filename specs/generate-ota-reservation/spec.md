# Feature Specification: Generar Reservación por OTA

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

Una parte importante de las ventas del hotel llega a través de agencias de viaje en línea (OTA)
como Booking o Expedia. Estas plataformas no operan sobre una pantalla del hotel: envían las
reservas de sistema a sistema, de forma asíncrona y en cualquier momento del día. Si el Módulo 2 no
ofrece un punto de entrada confiable para recibirlas, el personal termina copiando reservas a mano
desde los portales de cada agencia, con retraso y con errores. Eso produce dos riesgos graves. El
primero es la sobreventa: mientras la reserva de la OTA no se registra, su habitación sigue
figurando como libre y puede venderse dos veces. El segundo es el descuadre financiero con el canal:
cada agencia cobra una comisión pactada sobre el valor del hospedaje, y si esa comisión no se
calcula y se asienta al registrar la reserva, la conciliación posterior se vuelve imprecisa. El
negocio necesita un endpoint de integración que reciba la reserva, valide la disponibilidad,
registre la comisión del intermediario y avise al Módulo 1 para apartar la habitación cuando la
llegada es el mismo día; si la llegada es futura, el Módulo 1 la aparta al iniciar el día operativo
de la llegada.

### Flujo de Usuario de Alto Nivel

1. La **Ota** envía a la API del Módulo 2 una solicitud de reserva en JSON, que incluye las fechas
   de estadía (comunes a toda la reserva), la cantidad de personas (`guestCount`), una lista de
   entre 1 y 10 habitaciones (cada una con un `roomId` específico o solo con la `categoryRoom`
   deseada), los datos del `Guest` titular (incluido el tipo de documento, `documentType`), las observaciones opcionales (`notes`), el valor bruto
   total del hospedaje (`totalAmount`, de todas las habitaciones) y el `externalConfirmationCode` de
   la agencia.
2. El sistema valida la estructura JSON y que estén presentes todos los campos obligatorios,
   incluido el `externalConfirmationCode`, y valida que `guestCount` sea mayor o igual a la cantidad
   de habitaciones.
3. El sistema ejecuta "Verificar disponibilidades" para cada habitación: cruza las fechas contra las
   reservas locales y consulta al Módulo 1 el calendario de mantenimientos y el inventario en tiempo
   real. Para las habitaciones pedidas solo por categoría, asigna una `Room` disponible de esa
   categoría (la de menor `roomNumber`), sin repetir una habitación ya asignada a la misma reserva.
   Con las habitaciones asignadas, valida que `guestCount` no supere la suma de su `maxCapacity`.
4. Si todas las habitaciones están disponibles, el sistema ejecuta "Registrar confirmación y comisión de ota",
   que calcula el `commissionAmount` con la fórmula `totalAmount × commissionPercentage`, con el
   porcentaje configurado para esa agencia.
5. El sistema registra el valor bruto recibido tal cual, sin recalcular la tarifa: en este flujo no
   interviene "Calcular tarifa dinámica".
6. El sistema persiste la `Reservation` en estado `PENDING`, con una `ReservationRoom` en
   `EXPECTED` por cada habitación asignada, a la espera de la confirmación de pago o garantía de la
   agencia.
7. Si la llegada (`startDate`) es hoy, el sistema ejecuta "Establecer estado de habitación" para
   ordenar al Módulo 1 marcar cada `Room` de la reserva como `Reserved`, adjuntando el detalle de la
   reserva. Si la llegada es futura, no emite ninguna orden y la reserva no depende del Módulo 1. Si
   el Módulo 1 rechaza la orden de alguna habitación porque ya está `Occupied`, el sistema cancela
   la reserva recién creada, libera las habitaciones que sí quedaron apartadas y responde **HTTP 409
   (Conflict)** con `errorCode` `NO_AVAILABILITY`; si no responde o falla la comunicación, la
   cancela y responde **HTTP 400** con `errorCode` `ROOM_UNCONFIRMED`. En ambos casos la creación es
   todo o nada y la agencia puede reintentar sin duplicar.
8. Cuando la OTA confirma el pago o la garantía, el sistema ejecuta "Actualizar reservación" para
   cambiar la `Reservation` de `PENDING` a `ACTIVE`. Si la llegada es hoy y la lista del día ya se
   envió, el sistema avisa la reserva al Módulo 1 mediante "Enviar reservas del día al Módulo 1"
   (`ADDED`).
9. El sistema retorna una respuesta JSON de confirmación con el identificador interno generado y
   las habitaciones asignadas (`roomId` y `roomNumber` de cada una).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Procesamiento de Reservación por API Externa (Priority: P1)

Una **Ota** confirma una reserva en su plataforma y la transmite a la API del Módulo 2 mediante un
webhook. El sistema procesa la solicitud de forma transaccional y asíncrona, sin intervención humana
ni pantalla: valida la estructura y el `externalConfirmationCode`, verifica la disponibilidad de la
habitación, calcula y registra la comisión pactada, persiste la `Reservation` en `PENDING` con el
valor bruto enviado por la OTA y ordena al Módulo 1 apartar la `Room` si la llegada es hoy. Cuando
la agencia confirma el
pago o la garantía, la reserva pasa a `ACTIVE`. Por tratarse de un único flujo de integración, el
camino de éxito, la confirmación y los rechazos controlados (sin disponibilidad, código de
confirmación ausente, fechas mal formadas, concurrencia por la última habitación) se consolidan en
esta misma historia de usuario.

**Why this priority**: Permite captar de forma automática las ventas de los canales globales, sin
transcripción manual y sin ventana de doble venta. Al asentar la comisión en el mismo acto de
registro, deja la información financiera lista para la conciliación con cada agencia.

**Independent Test**: Se envía a la API un payload JSON simulando a la OTA, con una habitación
disponible. Se verifica que la `Reservation` se crea en `PENDING`, que se persiste el
`externalConfirmationCode`, que el `commissionAmount` es exactamente `totalAmount ×
commissionPercentage`, que, si la llegada es hoy, se emite la orden `Reserved` al Módulo 1 (con
llegada futura no se emite ninguna), y que al recibir la confirmación de la agencia pasa a `ACTIVE`.
La prueba se completa reenviando payloads sin
disponibilidad, sin `externalConfirmationCode` y con fechas incoherentes, confirmando que ninguno
crea una reserva y que todos devuelven una respuesta JSON de error estructurada.

**Acceptance Scenarios**:

1. **Scenario**: Generación exitosa de reserva por OTA (Happy Path)
   - **Given** que la `Room` solicitada está disponible en las fechas indicadas según "Verificar
     disponibilidades"
   - **When** la **Ota** envía un payload JSON válido con todos los datos requeridos, incluyendo el
     `externalConfirmationCode` y el valor bruto de la estadía
   - **Then** el sistema ejecuta "Registrar confirmación y comisión de ota", persiste la
     `Reservation` en `PENDING`, si la llegada es hoy ordena al Módulo 1 marcar la `Room` como
     `Reserved`, y retorna un código HTTP 201 (Created) con el ID interno generado

2. **Scenario**: Confirmación de pago o garantía por la agencia
   - **Given** una `Reservation` de canal OTA en estado `PENDING`
   - **When** la **Ota** notifica la confirmación del pago o la garantía
   - **Then** el sistema ejecuta "Actualizar reservación" para pasar la `Reservation` de `PENDING` a
     `ACTIVE` y retorna HTTP 200

3. **Scenario**: Intento de reserva por OTA sin disponibilidad (Error)
   - **Given** que la `Room` tiene un mantenimiento programado o una reserva cruzada en las fechas
     enviadas
   - **When** la **Ota** envía la solicitud de reserva
   - **Then** el sistema rechaza la transacción, no crea la reserva y retorna un error JSON con
     código HTTP 409 (Conflict): `{"errorCode": "NO_AVAILABILITY", "message": "No hay
     disponibilidad
     para la habitación seleccionada"}`

4. **Scenario**: Rechazo por ausencia de código de confirmación externo (Error)
   - **Given** que el canal de origen de la transacción es "OTA"
   - **When** la solicitud no incluye el `externalConfirmationCode` o este se encuentra vacío
   - **Then** el sistema rechaza el registro con un error controlado HTTP 400 (Bad Request) que
     detalla la obligatoriedad del campo

5. **Scenario**: Reserva por OTA con llegada futura no aparta la habitación (Happy Path)
   - **Given** que la `Room` está disponible y la llegada es dentro de varias semanas
   - **When** la **Ota** envía un payload JSON válido
   - **Then** el sistema persiste la `Reservation` en `PENDING`, retorna HTTP 201 (Created) sin
     enviar ninguna orden al Módulo 1, y la `Room` se aparta recién al iniciar el día operativo de
     la llegada

6. **Scenario**: Reserva por OTA de varias habitaciones pedidas por categoría (Happy Path)
   - **Given** que la categoría `DOUBLE` tiene disponibles las `Room` 201, 202 y 203 en las fechas
   - **When** la **Ota** envía una reserva con dos habitaciones de categoría `DOUBLE` y
     `guestCount` 4
   - **Then** el sistema asigna las `Room` 201 y 202, persiste una sola `Reservation` en `PENDING`
     con dos `ReservationRoom`, calcula la comisión sobre el `totalAmount` completo y retorna HTTP
     201 con las habitaciones asignadas

7. **Scenario**: Categoría sin suficientes habitaciones (Error)
   - **Given** que la categoría `SUITE` tiene una sola habitación disponible en las fechas
   - **When** la **Ota** envía una reserva con dos habitaciones de categoría `SUITE`
   - **Then** el sistema no crea la reserva y retorna HTTP 409 con `errorCode` `NO_AVAILABILITY`

8. **Scenario**: Cantidad de personas fuera de la capacidad (Error)
   - **Given** dos habitaciones disponibles con capacidad máxima 2 cada una
   - **When** la **Ota** envía `guestCount` 6
   - **Then** el sistema no crea la reserva y retorna HTTP 400 con `errorCode` `INVALID_GUEST_COUNT`
     y el mensaje "La cantidad de personas supera la capacidad de las habitaciones de la reserva."

### Casos Borde

- ¿Qué sucede si una OTA envía una reserva con un formato de fecha inválido o incoherente (por
  ejemplo, salida anterior a la llegada)? El sistema intercepta la validación en el controlador de
  la API y retorna una respuesta estructurada **HTTP 400**, sin crear la reserva ni permitir que la
  excepción escale a **HTTP 500**.
- ¿Cómo maneja el sistema datos de huésped duplicados o con caracteres maliciosos en el texto libre?
  El sistema sanea y valida los datos del `Guest` antes de persistir, rechaza los patrones de
  inyección con una respuesta **HTTP 400** estructurada, y nunca almacena el valor crudo.
- ¿Qué sucede si dos solicitudes de diferentes OTAs intentan reservar simultáneamente la misma
  habitación? La creación se realiza en una transacción con bloqueo, de modo que solo una obtiene la
  habitación y se registra; la otra recibe **HTTP 409 (Conflict)** con `errorCode`
  `NO_AVAILABILITY`.
- ¿Qué sucede si el Módulo 1 no responde o falla al recibir la orden `Reserved` de una reserva con
  llegada hoy? El sistema cancela
  la reserva recién creada mediante "Actualizar reservación" con el motivo `ROOM_UNCONFIRMED`, emite
  una orden `Available` con un `sequenceNumber` mayor para neutralizar cualquier apartado aplicado
  sin confirmar, y responde **HTTP 400** con `errorCode` `ROOM_UNCONFIRMED`. Como no queda ninguna
  reserva, la agencia puede reintentar sin duplicar.
- ¿Qué sucede si el Módulo 1 rechaza la orden `Reserved` de una reserva con llegada hoy porque la
  `Room` ya está `Occupied`? El
  sistema cancela la reserva recién creada mediante "Actualizar reservación" con el motivo
  `ROOM_REJECTED` y responde **HTTP 409 (Conflict)** con `errorCode` `NO_AVAILABILITY`.
- ¿Qué sucede si la agencia nunca confirma el pago o la garantía de una reserva `PENDING`? La
  reserva permanece en `PENDING` y puede cancelarse por la vía estándar, o marcarse como `NO_SHOW`
  por el proceso de fin de día si su fecha de inicio pasa sin ingreso.
- ¿Qué sucede si la OTA envía la lista de habitaciones vacía, más de 10 habitaciones, o el mismo
  `roomId` dos veces? El sistema responde **HTTP 400** con `errorCode` `INVALID_ROOMS` y el mensaje
  "Una reserva debe tener entre 1 y 10 habitaciones distintas."
- ¿Qué sucede si una habitación de la lista no trae ni `roomId` ni `categoryRoom`? El sistema
  responde **HTTP 400** con `errorCode` `INVALID_ROOMS` indicando la posición de la habitación
  incompleta.
- ¿Qué sucede si falta `guestCount` o no es un entero mayor que cero? El sistema responde **HTTP
  400** con `errorCode` `INVALID_GUEST_COUNT`.
- ¿Qué sucede si `notes` supera los 500 caracteres? El sistema responde **HTTP 400** con
  `errorCode` `INVALID_NOTES`.
- ¿Qué sucede si una sola de las habitaciones pedidas no está disponible? El sistema no crea la
  reserva y responde **HTTP 409** con `errorCode` `NO_AVAILABILITY`, indicando qué habitación o
  categoría no tiene disponibilidad; no se crean reservas parciales.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe proveer un endpoint de API REST seguro para la recepción de
  solicitudes de reservas de canales externos (`Ota`).
- **FR-002**: El sistema debe exigir el atributo de texto `externalConfirmationCode` como parámetro
  obligatorio en el canal OTA.
- **FR-003**: El sistema debe verificar la disponibilidad de cada `Room` de la reserva mediante
  "Verificar disponibilidades" antes de registrarla, asignar una `Room` disponible de la categoría a
  cada habitación pedida solo por categoría, y rechazar la reserva completa si una sola no tiene
  disponibilidad.
- **FR-003a**: El sistema debe exigir entre 1 y 10 habitaciones distintas y un `guestCount` entero,
  mayor o igual a la cantidad de habitaciones y menor o igual a la suma de la `maxCapacity` de las
  habitaciones asignadas; `notes` es opcional, con máximo 500 caracteres.
- **FR-004**: Al persistir la reserva, el sistema debe registrar `source` como `OTA` y calcular la
  comisión pactada (`commissionAmount`) con la fórmula `totalAmount × commissionPercentage`,
  mediante "Registrar confirmación y comisión de ota".
- **FR-005**: El sistema debe registrar el valor bruto enviado por la OTA en `totalAmount` sin
  recalcularlo y sin invocar "Calcular tarifa dinámica".
- **FR-006**: El sistema debe guardar la reserva en estado `PENDING` y cambiarla a `ACTIVE`,
  mediante "Actualizar reservación", cuando la agencia confirme el pago o la garantía; esta
  funcionalidad no debe modificar el `status` por su cuenta después de la creación.
- **FR-007**: El sistema debe ordenar al Módulo 1, mediante "Establecer estado de habitación",
  marcar cada `Room` de la reserva como `Reserved` con el detalle de la reserva cuando la llegada es
  hoy, y en ese caso solo debe responder 201 (Created) cuando el Módulo 1 confirme todas. La
  creación debe ser todo o nada. Para reservas con llegada futura no debe emitir la orden: el Módulo
  1 aparta las habitaciones al iniciar el día operativo de la llegada.
- **FR-007a**: El sistema debe avisar al Módulo 1, mediante "Enviar reservas del día al Módulo 1",
  la reserva que pase a `ACTIVE` con llegada hoy después de enviada la lista del día (`ADDED`).
- **FR-008**: El sistema debe, en reservas con llegada hoy, compensar el rechazo del Módulo 1
  (`Room` ya `Occupied`) o su falta de respuesta para cualquiera de sus habitaciones, cancelando la
  reserva creada con el motivo `ROOM_REJECTED` o `ROOM_UNCONFIRMED`, liberando las habitaciones que
  sí quedaron apartadas, neutralizando cualquier apartado ambiguo con una orden `Available` de mayor
  `sequenceNumber`, y
  respondiendo HTTP 409 con `errorCode` `NO_AVAILABILITY` si el Módulo 1 rechazó la orden, o HTTP
  400 con `errorCode` `ROOM_UNCONFIRMED` si no respondió.
- **FR-009**: El sistema debe interceptar cualquier inconsistencia o fallo de validación y retornar
  respuestas JSON estructuradas con un código de la familia 4xx —**HTTP 400 (Bad Request)** por
  defecto y **HTTP 409 (Conflict)** para los conflictos de disponibilidad—, prohibiendo **HTTP
  500**.

### Non-Functional Requirements

- **NFR-001**: El endpoint debe procesar y responder la solicitud transaccional en menos de 1.5
  segundos en condiciones normales de carga.

### Key Entities *(include if feature involves data)*

- **Reservation**: Contrato de reserva registrado desde el canal externo. Atributos:
  `reservationRef`,
  `guestRef`, `guestCount`, `startDate`, `endDate`, `totalAmount` (valor bruto total de todas las
  habitaciones enviado por la OTA), `commissionAmount`, `externalConfirmationCode`, `notes`,
  `source` (`OTA`), `createdAt`,
  y `status` con estados permitidos: `PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`,
  `NO_SHOW`. En este flujo se crea en `PENDING` y pasa a `ACTIVE` con la confirmación de la agencia.
  Una reserva OTA no tiene aviso de llegada tardía (`lateArrivalNotice`): ese aviso solo existe en
  las reservas directas, y el cierre del día marca `NO_SHOW` a la OTA sin Check-In el día de llegada.
- **ReservationRoom**: Cada habitación de la reserva. Atributos: `reservationRef`, `roomId`,
  `roomNumber`, `categoryRoom` y `stayStatus` (nace en `EXPECTED`). En canal OTA no tiene valor por
  habitación: el valor es el `totalAmount` de la reserva.
- **Guest**: Huésped titular. Atributos: `id`, `fullName`, `documentType` (`CC`, `CE`, `PASSPORT` u `OTHER`), `documentNumber`,
  `nationality`, `contactPhone`, `contactEmail`, extraídos del payload de la OTA.
- **Ota**: Intermediario externo que origina la reserva. Atributos: `id`, `name` y
  `commissionPercentage`.
- **Room**: Habitación física, cuyo estado es propiedad del Módulo 1. Atributos: `id`,
  `roomNumber`, `categoryRoom`, `maxCapacity` y `status` (`Available` | `Reserved` | `Occupied`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas registradas por la API externa cuentan con un
  `externalConfirmationCode` y con la comisión calculada y almacenada de forma exacta.
- **SC-002**: El 100% de los rechazos por falta de disponibilidad o formato inválido devuelven
  payloads JSON estructurados con un código 4xx (HTTP 400 o HTTP 409), con cero errores HTTP 500.
- **SC-003**: El 100% de las reservas OTA con llegada hoy generan la orden `Reserved` hacia el
  Módulo 1, y ninguna reserva con llegada futura genera una.
