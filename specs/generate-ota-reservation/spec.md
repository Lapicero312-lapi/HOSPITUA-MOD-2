# Feature Specification: Generar Reservación por OTA

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Una parte importante de las ventas del hotel llega a través de agencias de viaje en línea (OTA)
como Booking o Expedia. Estas plataformas no operan sobre una pantalla del hotel: envían las
reservas de sistema a sistema, de forma asíncrona y en cualquier momento del día. Si el Módulo 2 no
ofrece un punto de entrada confiable para recibirlas, el personal termina copiando reservas a mano
desde los portales de cada agencia, con retraso y con errores. Eso produce dos riesgos graves. El
primero es la sobreventa de cupo: mientras la reserva de la OTA no se registra, el aforo de la
`categoryRoom` sigue figurando como disponible y puede venderse dos veces. El segundo es el
descuadre financiero con el canal: cada agencia cobra una comisión pactada sobre el valor del
hospedaje, y si esa comisión no se calcula y se asienta al registrar la reserva, la conciliación
posterior se vuelve imprecisa.

Durante la etapa de reserva no se asigna ningún `numberRoom` ni `roomId` físico: esa asignación
ocurre únicamente en el Check-In, dentro del Módulo 1 / Front Desk. El negocio necesita un endpoint
de integración que reciba la reserva, valide el aforo lógico local de la `categoryRoom`, registre la
comisión del intermediario y persista la reserva de forma 100% local, sin invocar al Módulo 1 ni al
Módulo 3.

### Flujo de Usuario de Alto Nivel

1. La **Ota** envía a la API del Módulo 2 una solicitud de reserva en JSON, que incluye las fechas
   de estadía, la `categoryRoom`, los datos del `Guest` titular, el `grossAmount` del hospedaje y el
   `externalConfirmationCode` de la agencia.
2. El sistema valida la estructura del JSON y la presencia obligatoria de todos los campos
   requeridos, incluido el `externalConfirmationCode`.
3. El sistema ejecuta "Verificar disponibilidades" sobre la `categoryRoom` solicitada, validando el
   aforo lógico local del Módulo 2.
4. Si existe cupo disponible, el sistema calcula el `commissionAmount` a partir del `grossAmount`
   recibido y del `commissionPercentage` configurado para esa agencia, sin invocar "Calcular tarifa
   dinámica" del Módulo 3: el valor bruto se toma tal cual lo envía la OTA.
5. El sistema persiste la `Reservation` localmente en estado `PENDING`, a la espera de la
   confirmación de pago o garantía de la agencia, descontando de inmediato un cupo del aforo lógico
   local de la `categoryRoom`, sin realizar ninguna llamada hacia el Módulo 1.
6. Cuando la OTA notifica la confirmación del pago o la garantía, el sistema transiciona la
   `Reservation` de `PENDING` a `ACTIVE`.
7. El sistema retorna una respuesta JSON de confirmación con el identificador interno generado.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Procesamiento de Reservación por API Externa (Priority: P1)

**Plain Language**: Recepción asíncrona de reservas de agencias externas (OTA) mediante webhook,
que valida el aforo lógico local de una `categoryRoom`, calcula la comisión pactada sobre el valor
bruto informado por la agencia, y persiste la reserva en `PENDING` hasta su confirmación, sin
ninguna llamada hacia el Módulo 1 ni el Módulo 3.

Una **Ota** confirma una reserva en su plataforma y la transmite a la API del Módulo 2 mediante un
webhook. El sistema procesa la solicitud de forma transaccional y asíncrona, sin intervención humana
ni pantalla: valida la estructura y el `externalConfirmationCode`, verifica el aforo lógico local de
la `categoryRoom`, calcula y registra la comisión pactada, y persiste la `Reservation` en `PENDING`
con el valor bruto enviado por la OTA, descontando de inmediato el cupo de aforo correspondiente.
Cuando la agencia confirma el pago o la garantía, la reserva pasa a `ACTIVE`. Por tratarse de un
único flujo de integración, el camino de éxito, la confirmación posterior, y los rechazos
controlados (sin aforo disponible, código de confirmación ausente) se consolidan en esta misma
historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Permite captar de forma automática las ventas de los canales globales, sin
transcripción manual y sin ventana de doble venta de cupo. Al asentar la comisión en el mismo acto
de registro, deja la información financiera lista para la conciliación con cada agencia, sin acoplar
la creación de la reserva a la disponibilidad ni a la respuesta del Módulo 1.

**Independent Test**: Se envía a la API un payload JSON simulando a la OTA, para una `categoryRoom`
con cupo de aforo disponible. Se verifica que la `Reservation` se crea en `PENDING`, que se persiste
el `externalConfirmationCode`, que el `commissionAmount` es exactamente `grossAmount ×
commissionPercentage / 100`, que el aforo lógico local se descuenta en 1, y que no se registra
ninguna llamada hacia el Módulo 1. Al recibir la confirmación de la agencia, se verifica que la
reserva pasa a `ACTIVE`. La prueba se completa reenviando payloads sin aforo disponible y sin
`externalConfirmationCode`, confirmando que ninguno crea una reserva y que ambos devuelven una
respuesta JSON de error estructurada.

**Acceptance Scenarios**:

1. **Escenario 1**: Generación exitosa de reserva por OTA en `PENDING` (Happy Path)

   ```gherkin
   Given una categoryRoom con cupo de aforo lógico disponible según "Verificar disponibilidades" para el rango solicitado
   When la Ota envía un payload JSON válido con categoryRoom, fechas, datos del Guest, grossAmount y externalConfirmationCode
   Then el sistema calcula el commissionAmount a partir del grossAmount y el commissionPercentage de la agencia
   And persiste la Reservation localmente en state PENDING con source OTA
   And descuenta de inmediato un cupo del aforo lógico local de la categoryRoom
   And responde HTTP 201 (Created) con el identificador interno generado, sin emitir ninguna llamada hacia el Módulo 1
   ```

2. **Escenario 2**: Transición de la reserva a `ACTIVE` tras la confirmación de pago/garantía por la OTA

   ```gherkin
   Given una Reservation de canal OTA en state PENDING
   When la Ota notifica la confirmación del pago o la garantía
   Then el sistema transiciona la Reservation de PENDING a ACTIVE
   And responde HTTP 200
   ```

3. **Escenario 3**: Rechazo por falta de aforo en `categoryRoom` (Error)

   ```gherkin
   Given una categoryRoom cuyo aforo lógico local está agotado para el rango de fechas solicitado
   When la Ota envía la solicitud de reserva
   Then el sistema rechaza la transacción sin crear ninguna Reservation
   And responde con un error controlado HTTP 409 (Conflict) indicando que no hay cupo disponible en la categoryRoom
   ```

4. **Escenario 4**: Rechazo por ausencia o vacuidad del `externalConfirmationCode` (Error)

   ```gherkin
   Given una solicitud de reserva de canal OTA
   When el payload no incluye el externalConfirmationCode o este llega vacío
   Then el sistema rechaza el registro antes de verificar el aforo
   And responde con un error controlado HTTP 400 (Bad Request) indicando la obligatoriedad del campo
   ```

## 3. Casos Borde

- **Caso Borde 1**: Rango de fechas incoherente o con formato inválido. El sistema intercepta la
  validación en el controlador de la API y responde con **HTTP 400 (Bad Request)**, sin crear la
  reserva ni verificar el aforo.
- **Caso Borde 2**: Concurrencia masiva por el último cupo de la `categoryRoom`. La creación se
  realiza dentro de una transacción con control de concurrencia, de modo que solo una solicitud
  confirma la reserva y descuenta el cupo; las demás reciben un error controlado **HTTP 409
  (Conflict)** con `errorCode` `NO_AVAILABILITY`.
- **Caso Borde 3**: Payload con datos del `Guest` con caracteres maliciosos. El sistema sanea y
  valida los datos antes de persistir, rechaza los patrones de inyección con **HTTP 400 (Bad
  Request)**, y nunca almacena el valor crudo.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe exponer un endpoint de API REST seguro para la recepción de
  solicitudes de reservas de canales externos (`Ota`).
- **FR-002**: El sistema debe exigir el atributo de texto `externalConfirmationCode` como parámetro
  obligatorio en el canal OTA.
- **FR-003**: El sistema debe verificar el aforo lógico local de la `categoryRoom` mediante
  "Verificar disponibilidades" antes de registrar la reserva.
- **FR-004**: El sistema debe registrar el `grossAmount` recibido de la OTA sin invocar "Calcular
  tarifa dinámica" del Módulo 3, y calcular el `commissionAmount` con la fórmula `grossAmount ×
  commissionPercentage / 100`.
- **FR-005**: El sistema debe persistir la reserva localmente en `Reservation.state` `PENDING` y
  transicionarla a `ACTIVE` cuando la agencia confirme el pago o la garantía; esta funcionalidad no
  debe modificar el estado por su cuenta después de la creación.
- **FR-006**: Queda estrictamente prohibido que el sistema realice cualquier llamada de
  modificación de estado hacia el Módulo 1 (incluyendo el caso de uso "Establecer estado de
  habitación") durante este proceso.
- **FR-007**: El sistema debe responder con **HTTP 400 (Bad Request)** ante parámetros inválidos o
  ausentes, y con **HTTP 409 (Conflict)** ante la falta de disponibilidad de cupo, quedando
  estrictamente prohibida la propagación de excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El endpoint debe procesar y responder la solicitud transaccional en menos de 1.5
  segundos en condiciones normales de carga.

## 5. Entidades Clave

- **Reservation**: Contrato de reserva registrado desde el canal externo. Atributos: `id`,
  `guestRef`, `categoryRoom`, `checkInDate`, `checkOutDate`, `grossAmount` (valor bruto enviado por
  la OTA), `commissionPercentage`, `commissionAmount`, `externalConfirmationCode`, `source` (`OTA`),
  `version` (control de concurrencia optimista) y `state` (`PENDING`, `ACTIVE`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED`, `NO_SHOW`). En este flujo se crea en `PENDING` y pasa a `ACTIVE` con la
  confirmación de la agencia.
- **Guest**: Huésped titular. Atributos: `id`, `fullName`, `documentNumber`, `documentType`,
  `email`, `phone` y `nationality`, extraídos del payload de la OTA.
- **Ota**: Intermediario externo que origina la reserva. Atributos: `id`, `name` y
  `commissionPercentage`.
- **Room**: Concepto de categoría de habitación (`categoryRoom`) y su cupo de aforo lógico local,
  administrado dentro del Módulo 2. No representa aquí ninguna habitación física individual, ya que
  el `numberRoom` y el `roomId` no se asignan sino hasta el Check-In, dentro del Módulo 1.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las reservas OTA persisten con su `externalConfirmationCode` y su comisión
  calculada de forma exacta a partir del `grossAmount` informado.
- **SC-002**: Cero llamadas de modificación de estado realizadas hacia el Módulo 1 durante todo el
  proceso de creación de la reserva.
- **SC-003**: El 100% de los rechazos por falta de aforo o datos inválidos retornan respuestas
  estructuradas **HTTP 409** o **HTTP 400**, con cero errores **HTTP 500**.
