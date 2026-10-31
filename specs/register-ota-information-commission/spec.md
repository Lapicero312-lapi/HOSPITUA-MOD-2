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
2. El sistema consulta el `commissionPercentage` fijo de esa `Ota`. Si todavía no lo tiene, lo calcula con
   esta primera reserva: la comisión que Booking informa por Channex (`ota_commission`) ÷ `grossAmount` ×
   100, con dos decimales y redondeo `ROUND_HALF_UP`. Lo guarda en la `Ota`.
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

Al validarse una nueva reserva proveniente de una `Ota`, el sistema aplica el porcentaje fijo de
la agencia, calculado con su primera reserva, sobre el `grossAmount` recibido, calcula el
`commissionAmount` y lo persiste junto con el `externalConfirmationCode` en la `Reservation`, con
`commissionStatus` `CALCULATED`. Esta historia es el flujo maestro (Happy Path), invocado siempre
como parte de "Generar Reservación por OTA".

**Why this priority**: Es la funcionalidad esencial para operar con canales de distribución de
terceros: sin ella, el hotel recibiría reservas de OTA sin registrar con exactitud la comisión
pactada ni el ingreso neto real de cada una.

**Independent Test**: Llega una primera reserva de Booking con un `grossAmount` de \$400 y una
comisión informada de \$60. El sistema guarda el porcentaje `15.00` en la agencia, calcula un
`commissionAmount` de \$60, lo persiste junto al `externalConfirmationCode` y marca el
`commissionStatus` como `CALCULATED`. Una segunda reserva de \$200 usa el mismo `15.00` y da \$30. Se
completa con una primera reserva sin comisión informada, que no se registra.

**Acceptance Scenarios**:

1. **Scenario**: Registro exitoso de comisión al confirmar una reserva OTA (Happy Path)
   - **Given** una reserva proveniente de una `Ota` válida con su `commissionPercentage` fijo ya
     calculado
   - **When** "Generar Reservación por OTA" invoca "Registrar confirmación y comisión de ota" con
     el `grossAmount` y el `externalConfirmationCode`
   - **Then** el sistema calcula el `commissionAmount` aplicando `grossAmount ×
     commissionPercentage / 100`, lo persiste en la `Reservation`, y marca el `commissionStatus` como
     `CALCULATED`

2. **Scenario**: Primera reserva de la agencia
   - **Given** una `Ota` sin `commissionPercentage`
   - **When** llega su primera revisión `new` con `ota_commission` y un `grossAmount` mayor que 0
   - **Then** el sistema calcula el porcentaje (`ota_commission ÷ grossAmount × 100`, con dos decimales y
     `ROUND_HALF_UP`), lo guarda en la `Ota` y lo aplica a esta reserva y a las siguientes

3. **Scenario**: Primera reserva sin comisión o con una comisión inválida (Error)
   - **Given** una `Ota` sin porcentaje
   - **When** llega una revisión sin `ota_commission`, o con una que da un porcentaje fuera de 0 a 100
   - **Then** el sistema no registra la reserva ni confirma la revisión a Channex, y deja el error en el
     log; nunca inventa una comisión

4. **Scenario**: Comisión que no coincide con el porcentaje (Advertencia)
   - **Given** una `Ota` con porcentaje `15.00`
   - **When** llega una reserva cuya comisión informada da un porcentaje que difiere en más de 0.01 puntos
   - **Then** el sistema aplica igual el `15.00` y registra una advertencia en el log (puede ser un cambio
     de contrato o una promoción)

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

La agencia **Booking.com** se registra una sola vez ("Configurar OTA"), sin porcentaje: el porcentaje
se calcula con su primera reserva. El sistema lleva el estado de la conexión con Channex y la fecha y hora de la
última lectura del feed. La Recepcionista no crea ni edita agencias: solo las consulta en la pantalla de
agencias.

**Why this priority**: Es una función de soporte para operar el canal, pero no interviene en el cálculo
de cada comisión.

**Independent Test**: Se arranca el sistema y se verifica que exista una sola `Ota` "Booking.com", sin
porcentaje. Llega su primera reserva y queda con el porcentaje calculado. Al reiniciar, no se duplica ni
pierde su porcentaje.

**Acceptance Scenarios**:

1. **Scenario**: Registro de la agencia al iniciar
   - **Given** la configuración de Channex válida
   - **When** el sistema inicia y la agencia no existe
   - **Then** el sistema registra la `Ota` "Booking.com" con su `linkedAt`, en `CONNECTED` y sin
     `commissionPercentage`

2. **Scenario**: Reinicio
   - **Given** la `Ota` "Booking.com" ya registrada, con o sin porcentaje
   - **When** el sistema inicia otra vez
   - **Then** no crea otra agencia y conserva su porcentaje

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

- ¿Con qué estado nace una `Ota`? Nace en `CONNECTED` al registrarse al iniciar ("Configurar OTA"); desde ese
  momento su estado y su `lastSyncAt` solo cambian por las lecturas del feed de Channex. La
  Recepcionista nunca los cambia.
- ¿Qué sucede con las reservas ya registradas de una `Ota` que pasa a `DISCONNECTED`? No cambian: conservan
  su `status`, su `commissionAmount` y su `commissionStatus`. La desvinculación solo cambia el estado de la
  conexión de la agencia.
- ¿Se recalcula el porcentaje de una agencia? No: queda fijo desde su primera reserva. Si una reserva
  posterior trae una comisión que da otro porcentaje, se registra una advertencia y se aplica el fijo.
  Corregirlo es una tarea manual de administración, en la base de datos.
- ¿Qué muestra la agencia antes de su primera reserva? El `commissionPercentage` vacío.
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
  `grossAmount × commissionPercentage / 100` (el porcentaje va de 0 a 100), con el porcentaje fijo de la
  agencia, al registrar una nueva reserva de canal OTA, y recalcularlo con el mismo porcentaje congelado si Booking cambia el valor de la reserva.
- **FR-002**: El sistema debe usar el `commissionPercentage` fijo de la `Ota` que origina cada reserva.
  Si la agencia aún no lo tiene, debe calcularlo con su primera revisión `new` que traiga la comisión de
  Booking (`ota_commission ÷ grossAmount × 100`, con dos decimales y `ROUND_HALF_UP`) y guardarlo en la
  `Ota`. Las revisiones `modified` y `cancelled` no lo calculan, y no se recalcula después.
- **FR-003**: El sistema debe asignar el `commissionStatus` inicial `CALCULATED` a toda reserva OTA
  registrada correctamente.
- **FR-004**: El sistema no debe calcular comisiones sin porcentaje, ni con uno fuera de 0 a 100. Una
  primera revisión sin comisión informada, o con una que da un porcentaje fuera de 0 a 100, no se procesa
  ni se confirma a Channex, y queda en el log.
- **FR-004a**: El sistema debe registrar una advertencia cuando la comisión que informa Booking en una
  reserva da un porcentaje que difiere en más de 0.01 puntos del fijo de la agencia, sin cambiar la
  comisión calculada.
- **FR-005**: El sistema no debe registrar dos reservas OTA con el mismo `externalConfirmationCode` para
  la misma `Ota`: una revisión con un código ya registrado se aplica a esa reserva.
- **FR-006**: El sistema debe proveer al Módulo 3 (finanzas) una función de conciliación que cambie
  el `commissionStatus` de `CALCULATED` a `RECONCILED` o `PAID`, solo para reservas `COMPLETED`. La
  Recepcionista no concilia comisiones.
- **FR-007**: El sistema no debe modificar el `commissionAmount` ni el `commissionStatus` de una
  reserva OTA cuando Booking la cancela ni cuando queda en `NO_SHOW`: solo cambia su `status`. Booking
  no cobra comisión por una cancelación, y el no-show se le reporta por Channex sin cobrar penalidad al
  huésped ("Generar reservación por OTA"), así que tampoco la cobra. Esas comisiones no se concilian.
- **FR-008**: El sistema debe registrar la `Ota` "Booking.com" al iniciar, con su `name` y sin
  porcentaje, sin duplicarla. La Recepcionista no crea ni edita agencias; solo las consulta.
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
  (porcentaje fijo de la agencia, congelado en la reserva), `commissionStatus` (`CALCULATED` | `RECONCILED` |
  `PAID`), `externalConfirmationCode`, `source` (`OTA`), y `status` con estados permitidos:
  `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. Una reserva de Booking se crea
  directamente en `ACTIVE`, porque Booking ya la confirmó; la comisión se calcula desde el momento de su
  registro.
- **Ota**: Representa al intermediario externo que origina la reserva. Se registra al iniciar
  ("Configurar OTA"); la Recepcionista no la crea ni la edita. Atributos: `id`, `name`,
  `linkedAt` (fecha de vinculación), `commissionPercentage` (porcentaje fijo de la agencia, calculado
  con su primera reserva; vacío hasta entonces), `connectionStatus`
  (`CONNECTED` | `DISCONNECTED`: `DISCONNECTED` cuando Channex rechaza la conexión) y `lastSyncAt`
  (fecha y hora de la última lectura del feed de Channex que terminó bien).
- **Guest**: Representa al huésped titular de la reserva. Atributos: `id`, `firstName`, `lastName`,
  `documentType`, `documentNumber`, `nationality`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas con `source` `OTA` cuentan con `commissionAmount` y
  `commissionStatus` `CALCULATED` registrados al momento de su registro.
- **SC-002**: Cero reservas OTA duplicadas por un mismo `externalConfirmationCode`, y cero comisiones
  calculadas con un porcentaje fuera de 0 a 100.
- **SC-003**: Cero errores de servidor **HTTP 500** son provocados por fallos en el cálculo o
  conciliación de comisiones OTA; el 100% se responde con **HTTP 400**.
- **SC-004**: El 100% de las reservas OTA canceladas por la agencia o en `NO_SHOW` conservan su `commissionAmount` y
  su `commissionStatus` sin cambios.
- **SC-005**: El tiempo de respuesta para el registro y cálculo de comisión de una reserva OTA es
  inferior a 1 segundo.
