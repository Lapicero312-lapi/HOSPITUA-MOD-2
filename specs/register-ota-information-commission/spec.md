# Feature Specification: Registrar Confirmación y Comisión de OTA

**Created**: 2026-09-08
**Updated**: 2026-10-18

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
   comisión de ota" al validar una nueva reserva, enviando el `grossAmount` recibido de la OTA y el
   `externalConfirmationCode`.
2. El sistema consulta el `commissionPercentage` contractual configurado para esa `Ota`.
3. El sistema calcula el `commissionAmount` aplicando estrictamente la fórmula del glosario:
   `grossAmount × commissionPercentage / 100` (el porcentaje va de 0 a 100: `30` es el 30 %).
4. El sistema persiste el `commissionAmount` y el `commissionPercentage` en la `Reservation`, junto
   con el `externalConfirmationCode`, y marca el `commissionStatus` como `CALCULATED`.
5. Durante el ciclo de vida de la reserva, el Módulo 3 (finanzas) concilia la comisión contra el
   cierre contable mensual, y el sistema cambia el `commissionStatus` a `RECONCILED` o `PAID`
   según lo que el Módulo 3 le indica. Si la OTA cancela la reserva o el huésped no llega (`NO_SHOW`),
   el sistema solo cambia su `status`: no toca la comisión ni la concilia, porque Booking no la cobrará.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cálculo y Registro de Comisión al Confirmar una Reserva OTA (Priority: P1)

Al validarse una nueva reserva proveniente de una `Ota`, el sistema aplica el porcentaje
contractual configurado para esa agencia sobre el `grossAmount` recibido, calcula el
`commissionAmount` y lo persiste junto con el `externalConfirmationCode` en la `Reservation`, con
`commissionStatus` `CALCULATED`. Esta historia es el flujo maestro (Happy Path), invocado siempre
como parte de "Generar Reservación por OTA".

**Why this priority**: Es la funcionalidad esencial para operar con canales de distribución de
terceros: sin ella, el hotel recibiría reservas de OTA sin registrar con exactitud la comisión
pactada ni el ingreso neto real de cada una.

**Independent Test**: Se prueba invocando el caso de uso con un `grossAmount` de \$400 y un
`commissionPercentage` del 15% configurado para la agencia. Se verifica que el sistema calcule un
`commissionAmount` de \$60, lo persista junto al `externalConfirmationCode`, y marque el
`commissionStatus` como `CALCULATED`. Se completa arrancando con un `commissionPercentage` fuera
de 0 a 100 en la configuración y verificando que no se lean reservas de Booking.

**Acceptance Scenarios**:

1. **Scenario**: Registro exitoso de comisión al confirmar una reserva OTA (Happy Path)
   - **Given** una reserva proveniente de una `Ota` válida con `commissionPercentage`
     contractual configurado
   - **When** "Generar Reservación por OTA" invoca "Registrar confirmación y comisión de ota" con
     el `grossAmount` y el `externalConfirmationCode`
   - **Then** el sistema calcula el `commissionAmount` aplicando `grossAmount ×
     commissionPercentage / 100`, lo persiste en la `Reservation`, y marca el `commissionStatus` como
     `CALCULATED`

2. **Scenario**: Porcentaje de comisión inválido en la configuración (Error)
   - **Given** una configuración con un `commissionPercentage` menor a cero o superior a 100
   - **When** el sistema inicia
   - **Then** el sistema registra el error en el log y no lee reservas de Booking hasta que se
     corrija la configuración ("Configurar OTA"); nunca calcula una comisión con ese porcentaje

---

### User Story 2 - Conciliación Financiera de Comisiones OTA (Priority: P2)

El Módulo 3 (finanzas) revisa las comisiones de un periodo mensual, comparando las reservas con
`commissionStatus` `CALCULATED` contra las que completaron su estadía (`COMPLETED`). El Módulo 2
pone a su disposición esos datos y marca las comisiones como `RECONCILED` o `PAID` cuando el Módulo 3
se lo indica. La Recepcionista no concilia comisiones. Las reservas canceladas por la OTA o en `NO_SHOW`
no cambian su comisión ni se concilian.

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

3. **Scenario**: Reserva en `NO_SHOW`
   - **Given** una reserva de Booking en `NO_SHOW`, cuyo no-show se reportó a Booking por Channex
   - **When** el Módulo 3 intenta conciliar su comisión
   - **Then** el sistema la rechaza (`RESERVATION_NO_SHOW`) y no modifica el `commissionAmount` ni el
     `commissionStatus`

---

### User Story 3 - Registro de la Agencia y Estado de la Conexión (Priority: P3)

La agencia **Booking.com** se registra una sola vez, por configuración ("Configurar OTA"), con su
`commissionPercentage`. El sistema lleva el estado de la conexión con Channex y la fecha y hora de la
última lectura del feed. La Recepcionista no crea ni edita agencias: solo las consulta en la pantalla de
agencias.

**Why this priority**: Es una función de soporte para operar el canal, pero no interviene en el cálculo
de cada comisión.

**Independent Test**: Se configura un 15% de comisión para Booking, se recibe una reserva de prueba y se
verifica que el sistema aplique el 15%. Luego se cambia el porcentaje en la configuración, se reinicia y
se confirma que el cambio no afecta las reservas ya registradas.

**Acceptance Scenarios**:

1. **Scenario**: Registro de la agencia por configuración
   - **Given** la configuración de Booking con un `commissionPercentage` de `15`
   - **When** el sistema inicia y la agencia no existe
   - **Then** el sistema registra la `Ota` "Booking.com" con su `linkedAt`, en `CONNECTED`, y la usa para
     calcular la comisión de sus reservas

2. **Scenario**: Cambio del porcentaje
   - **Given** la `Ota` "Booking.com" ya registrada
   - **When** el sistema inicia con un porcentaje distinto en la configuración
   - **Then** el sistema guarda el nuevo porcentaje y lo aplica solo a las reservas futuras

3. **Scenario**: Channex rechaza la conexión (cambio a `DISCONNECTED`)
   - **Given** la `Ota` en `CONNECTED`
   - **When** Channex rechaza la lectura del feed por una clave de acceso inválida o sin permiso
   - **Then** el sistema cambia el `connectionStatus` a `DISCONNECTED`; la `Ota` y sus reservas se
     conservan, y la Recepcionista la ve en la pantalla de agencias como "Desconectada"

4. **Scenario**: La conexión se recupera (cambio a `CONNECTED`)
   - **Given** la `Ota` en `DISCONNECTED`
   - **When** una lectura del feed vuelve a funcionar
   - **Then** el sistema cambia el `connectionStatus` a `CONNECTED` sin perder el `linkedAt` original

5. **Scenario**: Cada lectura del feed actualiza la última sincronización
   - **Given** la `Ota` registrada
   - **When** una lectura del feed termina bien, traiga o no reservas
   - **Then** el sistema actualiza su `lastSyncAt` con la fecha y hora de esa lectura

### Casos Borde

- ¿Con qué estado nace una `Ota`? Nace en `CONNECTED` al registrarse por configuración; desde ese
  momento su estado y su `lastSyncAt` solo cambian por las lecturas del feed de Channex. La
  Recepcionista nunca los cambia.
- ¿Qué sucede con las reservas ya registradas de una `Ota` que pasa a `DISCONNECTED`? No cambian: conservan
  su `status`, su `commissionAmount` y su `commissionStatus`. La desvinculación solo cambia el estado de la
  conexión de la agencia.
- ¿Qué sucede si cambia el `commissionPercentage` configurado de una `Ota` con reservas ya
  registradas? El nuevo porcentaje aplica exclusivamente a las reservas futuras; las reservas
  existentes conservan el `commissionAmount` calculado al momento de su creación.
- ¿Qué sucede si llega una reserva con un `externalConfirmationCode` ya registrado para la misma
  `Ota`? No se crea otra reserva ni otra comisión: la revisión se aplica a la reserva que ya existe
  (ver "Generar reservación por OTA").
- ¿Cómo maneja el sistema la cancelación de una reserva OTA, incluso si es tardía? Solo la cancela
  Booking, por el feed de Channex. El sistema marca la reserva como `CANCELLED` y no toca la comisión: el manejo
  financiero de esa cancelación es entre la agencia y el hotel, fuera de este módulo.
- ¿Cómo maneja el sistema dos actualizaciones simultáneas de la misma reserva OTA? El sistema
  procesa secuencialmente los eventos para garantizar que el `commissionStatus` final refleje la
  versión de datos más reciente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe calcular automáticamente el `commissionAmount` aplicando la fórmula
  `grossAmount × commissionPercentage / 100` (el porcentaje va de 0 a 100) al registrar una nueva reserva
  de canal OTA, y recalcularlo con el mismo porcentaje congelado si Booking cambia el valor de la reserva.
- **FR-002**: El sistema debe consultar el `commissionPercentage` contractual configurado para la
  `Ota` que origina cada reserva.
- **FR-003**: El sistema debe asignar el `commissionStatus` inicial `CALCULATED` a toda reserva OTA
  registrada correctamente.
- **FR-004**: El sistema no debe calcular comisiones con un `commissionPercentage` configurado menor a
  cero o superior a 100: con esa configuración no lee reservas de Booking (ver "Configurar OTA").
- **FR-005**: El sistema no debe registrar dos reservas OTA con el mismo `externalConfirmationCode` para
  la misma `Ota`: una revisión con un código ya registrado se aplica a esa reserva.
- **FR-006**: El sistema debe proveer al Módulo 3 (finanzas) una función de conciliación que cambie
  el `commissionStatus` de `CALCULATED` a `RECONCILED` o `PAID`, solo para reservas `COMPLETED`. La
  Recepcionista no concilia comisiones.
- **FR-007**: El sistema no debe modificar el `commissionAmount` ni el `commissionStatus` de una
  reserva OTA cuando Booking la cancela ni cuando queda en `NO_SHOW`: solo cambia su `status`. Booking
  no cobra comisión por una cancelación, y el no-show se le reporta por Channex sin cobrar penalidad al
  huésped ("Generar reservación por OTA"), así que tampoco la cobra. Esas comisiones no se concilian.
- **FR-008**: El sistema debe registrar la `Ota` "Booking.com" por configuración, con su `name`,
  su `hotelAccountId` (el id del hotel en Booking, `10485037`) y su `commissionPercentage`, sin
  duplicarla. La Recepcionista no crea ni edita agencias; solo las consulta.
- **FR-008a**: El sistema debe cambiar el `connectionStatus` a `DISCONNECTED` cuando Channex rechace la
  lectura del feed por la clave de acceso o los permisos, y de nuevo a `CONNECTED` cuando una lectura
  vuelva a funcionar; debe actualizar el `lastSyncAt` con cada lectura que termine bien, y no debe
  eliminar la `Ota` ni modificar sus reservas al cambiar de estado.
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
  Atributos: `reservationRef`, `guestRef`, `guestCount`, `grossAmount` (valor bruto total de todas
  las habitaciones, recibido de la OTA), `currency`, `commissionAmount` (comisión calculada sobre el
  `grossAmount` completo; se recalcula si Booking cambia el valor), `commissionPercentage`
  (porcentaje contractual aplicado), `commissionStatus` (`CALCULATED` | `RECONCILED` |
  `PAID`), `externalConfirmationCode`, `source` (`OTA`), y `status` con estados permitidos:
  `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. Una reserva de Booking se crea
  directamente en `ACTIVE`, porque Booking ya la confirmó; la comisión se calcula desde el momento de su
  registro.
- **Ota**: Representa al intermediario externo que origina la reserva. Se registra por configuración
  ("Configurar OTA"); la Recepcionista no la crea ni la edita. Atributos: `id`, `name`,
  `hotelAccountId` (cuenta del hotel en la OTA), `linkedAt` (fecha de vinculación),
  `commissionPercentage` (porcentaje de comisión pactado por defecto), `connectionStatus`
  (`CONNECTED` | `DISCONNECTED`: `DISCONNECTED` cuando Channex rechaza la conexión) y `lastSyncAt`
  (fecha y hora de la última lectura del feed de Channex que terminó bien).
- **Guest**: Representa al huésped titular de la reserva. Atributos: `id`, `firstName`, `lastName`,
  `documentType`, `documentNumber`, `nationality`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas con `source` `OTA` cuentan con `commissionAmount` y
  `commissionStatus` `CALCULATED` calculados de forma exacta al momento de su registro.
- **SC-002**: Cero reservas OTA duplicadas por un mismo `externalConfirmationCode`, y cero comisiones
  calculadas con un porcentaje fuera de 0 a 100.
- **SC-003**: Cero errores de servidor **HTTP 500** son provocados por fallos en el cálculo o
  conciliación de comisiones OTA; el 100% se responde con **HTTP 400**.
- **SC-004**: El 100% de las reservas OTA canceladas por la agencia o en `NO_SHOW` conservan su `commissionAmount` y
  su `commissionStatus` sin cambios.
- **SC-005**: El tiempo de respuesta para el registro y cálculo de comisión de una reserva OTA es
  inferior a 1 segundo.
