# Feature Specification: Registrar Confirmación y Comisión de OTA

**Created**: 2026-09-08
**Updated**: 2026-09-29

## Use Case (Caso de Uso)

### Descripción del problema

Cada reserva que llega de una agencia de viajes en línea (OTA) trae consigo una obligación
financiera con esa agencia: una comisión pactada sobre el valor bruto de la estadía. Si esa
comisión no se calcula y se asienta en el mismo instante en que se registra la reserva, la
conciliación posterior con la OTA se vuelve imprecisa y el hotel pierde trazabilidad sobre cuánto
le corresponde retener a cada canal. El negocio necesita un caso de uso interno, invocado siempre
que "Generar Reservación por OTA" registra una nueva reserva, que aplique de forma estricta la
fórmula contractual y deje el importe neto listo para la conciliación mensual con cada agencia.

### Flujo de Usuario de Alto Nivel

1. El caso de uso "Generar Reservación por OTA" invoca internamente "Registrar confirmación y
   comisión de ota" al validar una nueva reserva, enviando el `totalAmount` recibido de la OTA y el
   `externalConfirmationCode`.
2. El sistema consulta el `commissionPercentage` contractual configurado para esa `Ota`.
3. El sistema calcula el `commissionAmount` aplicando estrictamente la fórmula del glosario:
   `totalAmount × commissionPercentage / 100` (el porcentaje va de 0 a 100: `30` es el 30 %).
4. El sistema persiste el `commissionAmount` y el `commissionPercentage` en la `Reservation`, junto
   con el `externalConfirmationCode`, y marca el `commissionStatus` como `CALCULATED`.
5. Durante el ciclo de vida de la reserva, el Módulo 3 (finanzas) concilia la comisión contra el
   cierre contable mensual, y el sistema cambia el `commissionStatus` a `RECONCILED` o `PAID`
   según lo que el Módulo 3 le indica. Si la OTA cancela la reserva, el sistema solo registra la
   reserva como `CANCELLED`: no toca la comisión, porque la agencia ya sabe que no la cobrará.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cálculo y Registro de Comisión al Confirmar una Reserva OTA (Priority: P1)

Al validarse una nueva reserva proveniente de una `Ota`, el sistema aplica el porcentaje
contractual configurado para esa agencia sobre el `totalAmount` recibido, calcula el
`commissionAmount` y lo persiste junto con el `externalConfirmationCode` en la `Reservation`, con
`commissionStatus` `CALCULATED`. Esta historia es el flujo maestro (Happy Path), invocado siempre
como parte de "Generar Reservación por OTA".

**Why this priority**: Es la funcionalidad esencial para operar con canales de distribución de
terceros: sin ella, el hotel recibiría reservas de OTA sin registrar con exactitud la comisión
pactada ni el ingreso neto real de cada una.

**Independent Test**: Se prueba invocando el caso de uso con un `totalAmount` de \$400 y un
`commissionPercentage` del 15% configurado para la agencia. Se verifica que el sistema calcule un
`commissionAmount` de \$60, lo persista junto al `externalConfirmationCode`, y marque el
`commissionStatus` como `CALCULATED`. Se completa enviando un `commissionPercentage` inválido,
confirmando el rechazo con **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Registro exitoso de comisión al confirmar una reserva OTA (Happy Path)
   - **Given** una reserva proveniente de una `Ota` válida con `commissionPercentage`
     contractual configurado
   - **When** "Generar Reservación por OTA" invoca "Registrar confirmación y comisión de ota" con
     el `totalAmount` y el `externalConfirmationCode`
   - **Then** el sistema calcula el `commissionAmount` aplicando `totalAmount ×
     commissionPercentage`, lo persiste en la `Reservation`, y marca el `commissionStatus` como
     `CALCULATED`

2. **Scenario**: Rechazo controlado por porcentaje de comisión inválido (Error)
   - **Given** una solicitud de registro de comisión
   - **When** el `commissionPercentage` configurado para el canal es menor a cero o superior al
     100%
   - **Then** el sistema intercepta la solicitud, responde con **HTTP 400 (Bad Request)**
     indicando que el porcentaje de comisión no es válido, y no persiste la reserva

---

### User Story 2 - Conciliación Financiera de Comisiones OTA (Priority: P2)

El Módulo 3 (finanzas) revisa las comisiones de un periodo mensual, comparando las reservas con
`commissionStatus` `CALCULATED` contra las que completaron su estadía (`COMPLETED`). El Módulo 2
pone a su disposición esos datos y marca las comisiones como `RECONCILED` o `PAID` cuando el Módulo 3
se lo indica. La Recepcionista no concilia comisiones. Las reservas canceladas por la OTA no cambian
su comisión: quedan como `CANCELLED` sin ningún ajuste financiero.

**Why this priority**: Es un flujo de auditoría contable importante para la liquidación mensual con
los proveedores de distribución, pero no interviene en la ingesta síncrona diaria de reservas.

**Independent Test**: Se genera el listado de comisiones de un canal sobre un conjunto de reservas
en `COMPLETED`. El Módulo 3 ejecuta la conciliación y se comprueba que las comisiones pasen a
`RECONCILED`, y que las reservas `CANCELLED` por la OTA conserven su comisión sin ningún cambio.

**Acceptance Scenarios**:

1. **Scenario**: Conciliación exitosa de comisiones para reservas con estadía finalizada
   - **Given** un conjunto de reservas OTA con `commissionStatus` `CALCULATED` en `status`
     `COMPLETED`
   - **When** el Módulo 3 ejecuta el proceso de conciliación del periodo
   - **Then** el sistema confirma la coincidencia de montos y actualiza el `commissionStatus` de
     esas reservas a `RECONCILED`

2. **Scenario**: Cancelación de la reserva por la OTA
   - **Given** una reserva de canal OTA que la Ota canceló y pasó a `status` `CANCELLED`
   - **When** el sistema registra la cancelación o procesa la conciliación de comisiones
   - **Then** el sistema no modifica el `commissionAmount` ni el `commissionStatus`: la agencia ya
     sabe que no cobrará comisión por esa reserva porque ella misma la canceló

---

### User Story 3 - Registro de la OTA por su API (Priority: P3)

Cuando el hotel vincula su cuenta en una OTA, la **Ota** se registra sola en el Módulo 2 enviando
por su API su `name`, el identificador de la cuenta del hotel en la agencia (`hotelAccountId`) y el
`commissionPercentage` pactado. Si la OTA cambia algún dato, lo envía de nuevo por la misma API.
La Recepcionista no crea ni edita agencias: solo las consulta en la pantalla de agencias. El
`connectionStatus` y el `lastSyncAt` siempre los administra el sistema a partir de los mensajes que
llegan por la API de la OTA.

**Why this priority**: Es una función de soporte para incorporar canales comerciales, pero no
interviene en la ingesta diaria de reservas existentes.

**Independent Test**: La OTA envía su registro con un 15% de comisión. Se envía una reserva de
prueba sobre ese canal y se verifica que el sistema aplique automáticamente el 15% al calcular el
`commissionAmount`. Luego la OTA envía una comisión nueva y se confirma que el cambio no afecta
reservas ya registradas.

**Acceptance Scenarios**:

1. **Scenario**: Registro automático de la OTA al vincular la cuenta
   - **Given** el hotel vinculó su cuenta en la OTA
   - **When** la **Ota** envía por su API su `name`, su `hotelAccountId` y un `commissionPercentage`
     válido
   - **Then** el sistema guarda la `Ota` con su `linkedAt` y la habilita para calcular comisiones de
     forma automática en sus futuras reservas

2. **Scenario**: Actualización de datos enviada por la OTA
   - **Given** una `Ota` ya registrada
   - **When** la **Ota** envía por su API un nuevo `commissionPercentage`
   - **Then** el sistema lo guarda y lo aplica solo a las reservas futuras

3. **Scenario**: Rechazo de registro por datos ausentes o inválidos (Error)
   - **When** la **Ota** envía su registro con `name` o `hotelAccountId` vacío, o con un
     `commissionPercentage` fuera de 0 a 100
   - **Then** el sistema responde con **HTTP 400 (Bad Request)** especificando los campos inválidos

4. **Scenario**: La OTA informa su desvinculación (cambio a `DISCONNECTED`)
   - **Given** una `Ota` en `connectionStatus` `CONNECTED`
   - **When** la **Ota** envía por su API el aviso de que la cuenta del hotel se desvinculó
   - **Then** el sistema cambia su `connectionStatus` a `DISCONNECTED` y actualiza su `lastSyncAt` con
     la fecha y hora de ese mensaje; la `Ota` y sus datos se conservan, y la Recepcionista sigue viéndola
     en la pantalla de agencias con el estado "Desconectada"

5. **Scenario**: La OTA se vuelve a vincular (cambio a `CONNECTED`)
   - **Given** una `Ota` en `connectionStatus` `DISCONNECTED`
   - **When** la **Ota** envía por su API el aviso de que la cuenta del hotel quedó vinculada de nuevo
   - **Then** el sistema cambia su `connectionStatus` a `CONNECTED` y actualiza su `lastSyncAt`; no se
     crea una `Ota` nueva ni se pierde su `linkedAt` original

6. **Scenario**: Cada mensaje de la OTA actualiza su última sincronización
   - **Given** una `Ota` registrada, en cualquier `connectionStatus`
   - **When** la **Ota** envía cualquier mensaje por su API (una reserva, un cambio, una cancelación o
     un aviso de conexión)
   - **Then** el sistema actualiza su `lastSyncAt` con la fecha y hora de ese mensaje, sin modificar
     ningún otro dato de la `Ota`

### Casos Borde

- ¿Con qué estado nace una `Ota`? Nace en `CONNECTED` al registrarse por su API, con `lastSyncAt`
  igual a la fecha y hora de ese mensaje, y desde ese momento solo cambian por los mensajes que llegan
  por la API de la OTA. La Recepcionista nunca los cambia.
- ¿Qué sucede con las reservas ya registradas de una `Ota` que pasa a `DISCONNECTED`? No cambian: conservan
  su `status`, su `commissionAmount` y su `commissionStatus`. La desvinculación solo cambia el estado de la
  conexión de la agencia.
- ¿Qué sucede si la OTA envía un nuevo `commissionPercentage` para una `Ota` con reservas ya
  registradas? El nuevo porcentaje aplica exclusivamente a las reservas futuras; las reservas
  existentes conservan el `commissionAmount` calculado al momento de su creación.
- ¿Qué sucede si se recibe una nueva reserva reutilizando un `externalConfirmationCode` ya
  registrado para la misma `Ota`? El sistema rechaza el intento por duplicidad, responde con **HTTP
  400 (Bad Request)**, y no genera un registro de comisión duplicado.
- ¿Cómo maneja el sistema la cancelación de una reserva OTA, incluso si es tardía? Solo la cancela la
  Ota por su API. El sistema marca la reserva como `CANCELLED` y no toca la comisión: el manejo
  financiero de esa cancelación es entre la agencia y el hotel, fuera de este módulo.
- ¿Cómo maneja el sistema dos actualizaciones simultáneas de la misma reserva OTA? El sistema
  procesa secuencialmente los eventos para garantizar que el `commissionStatus` final refleje la
  versión de datos más reciente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe calcular automáticamente el `commissionAmount` aplicando la fórmula
  `totalAmount × commissionPercentage / 100` (el porcentaje va de 0 a 100) al validar una nueva reserva de canal OTA.
- **FR-002**: El sistema debe consultar el `commissionPercentage` contractual configurado para la
  `Ota` que origina cada reserva.
- **FR-003**: El sistema debe asignar el `commissionStatus` inicial `CALCULATED` a toda reserva OTA
  registrada correctamente.
- **FR-004**: El sistema debe rechazar el registro de reservas OTA cuyo `commissionPercentage` sea
  menor a cero o superior al 100%.
- **FR-005**: El sistema debe rechazar cualquier intento de registrar una reserva OTA con un
  `externalConfirmationCode` ya existente para el mismo canal.
- **FR-006**: El sistema debe proveer al Módulo 3 (finanzas) una función de conciliación que cambie
  el `commissionStatus` de `CALCULATED` a `RECONCILED` o `PAID`. La Recepcionista no concilia
  comisiones.
- **FR-007**: El sistema no debe modificar el `commissionAmount` ni el `commissionStatus` de una
  reserva OTA cuando la Ota la cancela: solo cambia su `status` a `CANCELLED`, porque la agencia ya
  sabe que no cobrará comisión por esa reserva.
- **FR-008**: El sistema debe registrar y actualizar cada `Ota` con los datos (`name`,
  `hotelAccountId`, `commissionPercentage`) que la propia OTA envía por su API al vincular la cuenta
  del hotel o cuando los cambia. La Recepcionista no crea ni edita agencias; solo las consulta. El
  sistema guarda, por separado, el estado de la conexión
  (`connectionStatus`) y la fecha y hora del último mensaje recibido de la OTA (`lastSyncAt`): esos dos
  campos los administra únicamente el sistema a partir de la API de la OTA.
- **FR-008a**: El sistema debe rechazar el registro o la actualización de una `Ota` por su API cuando el `name` o
  el `hotelAccountId` vienen vacíos, el `commissionPercentage` está fuera de 0 a 100, o el `name`
  coincide con el de una `Ota` ya registrada, respondiendo **HTTP 400 (Bad Request)**.
- **FR-008b**: El sistema debe cambiar el `connectionStatus` de una `Ota` a `DISCONNECTED` cuando la
  propia OTA informa por su API que la cuenta del hotel se desvinculó, y de nuevo a `CONNECTED` cuando
  informa que se vinculó otra vez; debe actualizar el `lastSyncAt` con cada mensaje recibido de la OTA;
  y no debe eliminar la `Ota` ni modificar sus reservas al cambiar de estado. Una `Ota` nace en
  `CONNECTED` al registrarse. Estos cambios son funcionamiento interno: la Recepcionista solo
  consulta el resultado en la pantalla de agencias.
- **FR-009**: El sistema debe interceptar cualquier error de validación de entrada o integración y
  responder con **HTTP 400 (Bad Request)**, prohibiendo que se propaguen como fallas **HTTP 500**.
- **FR-010**: El sistema debe mantener un registro auditable de cada comisión calculada o
  conciliada, incluyendo la fecha, el canal responsable y los importes aplicados.

### Non-Functional Requirements

- **NFR-001**: El cálculo y registro de la comisión al validar una reserva OTA debe completarse en
  un tiempo inferior a 1 segundo.
- **NFR-002**: El cálculo de comisiones debe realizarse con precisión decimal exacta para evitar
  descuadres en los cierres contables mensuales.

### Key Entities *(include if feature involves data)*

- **Reservation**: Representa la reserva de canal OTA sobre la que se calcula la comisión.
  Atributos: `reservationRef`, `guestRef`, `guestCount`, `totalAmount` (valor bruto total de todas
  las habitaciones, recibido de la OTA), `commissionAmount` (comisión calculada sobre el
  `totalAmount` completo, una sola vez por reserva), `commissionPercentage`
  (porcentaje contractual aplicado), `commissionStatus` (`CALCULATED` | `RECONCILED` | `PAID` |
  `DISPUTED`), `externalConfirmationCode`, `source` (`OTA`), y `status` con estados permitidos:
  `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. Una reserva OTA se crea
  en
  `PENDING` y pasa a `ACTIVE` cuando la agencia confirma el pago o la garantía; la comisión se
  calcula desde el momento de su registro.
- **Ota**: Representa al intermediario externo que origina la reserva. Se registra sola por su API al
  vincular la cuenta del hotel; la Recepcionista no la crea ni la edita. Atributos: `id`, `name`,
  `hotelAccountId` (cuenta del hotel en la OTA), `linkedAt` (fecha de vinculación),
  `commissionPercentage` (porcentaje de comisión pactado por defecto), `connectionStatus`
  (`CONNECTED` | `DISCONNECTED`: `CONNECTED` mientras la cuenta del hotel siga vinculada y
  `DISCONNECTED` cuando la OTA informa que se desvinculó) y `lastSyncAt` (fecha y hora del último
  mensaje que la OTA envió por su API).
- **Guest**: Representa al huésped titular de la reserva. Atributos: `id`, `firstName`, `lastName`,
  `documentType`, `documentNumber`, `nationality`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas con `source` `OTA` cuentan con `commissionAmount` y
  `commissionStatus` `CALCULATED` calculados de forma exacta al momento de su registro.
- **SC-002**: El 100% de los intentos de registro con `externalConfirmationCode` duplicado o
  `commissionPercentage` inválido son rechazados con **HTTP 400 (Bad Request)**.
- **SC-003**: Cero errores de servidor **HTTP 500** son provocados por fallos en el cálculo o
  conciliación de comisiones OTA; el 100% se responde con **HTTP 400**.
- **SC-004**: El 100% de las reservas OTA canceladas por la agencia conservan su `commissionAmount` y
  su `commissionStatus` sin cambios.
- **SC-005**: El tiempo de respuesta para el registro y cálculo de comisión de una reserva OTA es
  inferior a 1 segundo.
