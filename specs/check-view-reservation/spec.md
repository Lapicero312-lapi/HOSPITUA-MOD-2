# Feature Specification: Consultar Reservas

**Created**: 2026-09-19
**Updated**: 2026-09-29

## Use Case (Caso de Uso)

### Descripción del problema

La Recepcionista necesita una vista única de todas las reservas del hotel para responder llamadas,
preparar las llegadas del día, revisar qué reservas siguen pendientes de confirmación de una OTA y
ubicar una reserva puntual antes de modificarla o cancelarla. Sin esa vista, termina armando listas
por fuera del sistema o preguntando al Módulo 1, que no es el dueño de las reservas. Además, casi
ninguna operación del Módulo 2 puede ejecutarse a ciegas: antes de cancelar, actualizar, verificar
disponibilidades o procesar una notificación de Check-In o Check-Out, el sistema necesita ubicar la
reserva exacta y conocer su estado vigente. Si cada funcionalidad implementara su propia búsqueda,
los criterios serían inconsistentes.

El negocio necesita un único servicio de consulta, de solo lectura, que:

- Liste **todas** las reservas, paginadas de a 10.
- Permita **filtrar por estado** (`status`), por canal, por agencia (en las reservas OTA) y por un
  rango de fechas sobre la estadía.
- Permita **ordenar** el listado por fecha de llegada.
- Permita **buscar** por código de reserva, código de la OTA, documento o nombre del titular, y ver el
  detalle completo de una reserva.
- Sea reutilizado internamente por las demás funcionalidades del Módulo 2.
- **Envíe cada día al Módulo 1** la lista de reservas `ACTIVE` que llegan ese día, con toda la
  información que necesita para recibir a los huéspedes, y le avise cada cambio posterior.

El **Módulo 1 no consulta este servicio**: el Módulo 2 le envía la información de las reservas del
día mediante "Enviar reservas del día al Módulo 1" (historias 4 y 5 de esta especificación), y el
Módulo 1 notifica el Check-In y el Check-Out para que "Actualizar reservación" cambie el estado de
la reserva.

El Módulo 1 opera el hotel en persona: recibe a los huéspedes, entrega las habitaciones y registra el
Check-In y el Check-Out. Para hacerlo necesita saber, cada día, quién llega, cuántas personas vienen,
qué habitaciones se les asignaron, quién es el titular, hasta cuándo se quedan y cualquier
observación de la reserva. Además, las reservas del día cambian durante el día: se crean reservas
para hoy, una OTA confirma una reserva pendiente, un huésped cancela o cambia de habitación. Si el
Módulo 1 solo recibiera la lista de la mañana, trabajaría con datos desactualizados. Esta
funcionalidad solo **informa**: no aparta ni libera habitaciones (el Módulo 1 decide qué hace con la lista) ni cambia el estado de ninguna reserva.

### Flujo de Usuario de Alto Nivel

**Listado y filtros**

1. La **Recepcionista** abre la vista de reservas. Sin filtros, el sistema muestra todas las
   reservas, de a 10 por página y ordenadas por fecha de llegada (`startDate`) de la más reciente a
   la más antigua.
2. La Recepcionista aplica, en cualquier combinación, los filtros disponibles:
   - **Búsqueda**: `reservationRef`, `externalConfirmationCode` (código de la OTA), `documentNumber`
     o `fullName` del `Guest` titular.
   - **Estado**: uno de `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` y `NO_SHOW`.
   - **Canal**: `DIRECT` u `OTA`.
   - **Agencia**: solo cuando el canal es `OTA`.
   - **Fecha**: un rango (`dateFrom` y `dateTo`, ambos inclusivos) sobre la estadía de la reserva:
     muestra las reservas cuya estadía se cruza con el rango (`startDate` ≤ `dateTo` y `endDate` >
     `dateFrom`). Para un solo día, `dateFrom` y `dateTo` son iguales.
3. El sistema combina todos los filtros aplicados con la regla "Y" (una reserva aparece solo si
   cumple todos) y devuelve la página solicitada (10 reservas), con el total de reservas que cumplen
   los filtros y el total de páginas.
4. La Recepcionista puede cambiar el orden (ascendente o descendente por `startDate`) y moverse entre
   páginas.
5. Desde cada fila, la Recepcionista puede **ver el detalle**, **modificar** o **cancelar** la
   reserva (las dos últimas solo en reservas directas `ACTIVE` o `PENDING`).

**Búsqueda por código**

1. La Recepcionista ingresa un código en el mismo cuadro de búsqueda del listado (no hay un campo
   separado para el código).
2. El sistema busca una coincidencia exacta con la `reservationRef` y, en paralelo, con el
   `externalConfirmationCode` (código de la OTA); no distingue mayúsculas de minúsculas.
3. Si la encuentra, el listado se acota a esa o esas reservas (puede haber más de una fila si el
   texto coincide con el `reservationRef` de una reserva y con el `externalConfirmationCode` de otra;
   ver Casos Borde), ignorando el resto de los filtros aplicados (estado, canal, agencia, fecha). La
   Recepcionista abre **Ver detalle** desde la fila para ver el detalle completo (FR-006).
4. Si el texto tiene el formato de una `reservationRef` interna (empieza con `RSV-`) y no hay
   coincidencia, el sistema responde con el mensaje "La reserva no existe." Si el texto no tiene ese
   formato y tampoco coincide con ningún `externalConfirmationCode`, el sistema no lo trata como un
   código fallido: continúa evaluándolo como búsqueda por documento o por nombre (ver "Búsqueda por
   titular").

**Detalle de la reserva**

Al seleccionar una reserva del listado o encontrarla por código, el sistema muestra su detalle
completo (ver FR-006), incluidas todas sus habitaciones y la cantidad de personas.

**Envío de la lista del día al Módulo 1**

1. Al iniciar el día operativo (00:00, hora de Colombia, UTC-5; el día operativo es el día calendario
   y va de las 00:00 a las 23:59, fijo), el sistema ejecuta un proceso automático.
2. El sistema localiza las `Reservation` con `startDate` igual al día operativo y `status` `ACTIVE`,
   con los mismos criterios de este servicio.
3. El sistema arma la lista del día (`DailyReservationList`) con una cabecera (fecha operativa, fecha
   y hora de generación, total de reservas, total de habitaciones y total de personas) y, por cada
   reserva, el detalle de FR-014.
4. El sistema envía la lista al **Módulo 1** como notificación proactiva por cola (el Módulo 1 no
   responde).
5. Si no hay reservas con llegada ese día, el sistema envía igualmente la lista con cero reservas,
   para que el Módulo 1 sepa que la lista se generó y no se perdió.

**Actualizaciones de la lista durante el día**

1. Después de enviada la lista, cualquier evento que agregue, cambie o quite una reserva de la lista
   del día genera una actualización (`DailyReservationUpdate`):
   - `ADDED`: una reserva pasa a formar parte de la lista: se crea una reserva directa `ACTIVE` con
     llegada hoy, una OTA confirma hoy una reserva con llegada hoy (`PENDING` → `ACTIVE`), o una
     modificación cambia la llegada a hoy.
   - `UPDATED`: cambia un dato enviado de una reserva que ya está en la lista: habitaciones
     (agregar, quitar o cambiar), `guestCount`, `endDate`, datos del titular o `notes`.
   - `REMOVED`: una reserva sale de la lista: se cancela (`CANCELLED`), una modificación mueve su
     llegada a otro día, o el cierre del día la marca `NO_SHOW` o `CANCELLED`.
2. Las actualizaciones `ADDED` y `UPDATED` llevan el detalle completo y vigente de la reserva, no
   solo el campo que cambió. La actualización `REMOVED` lleva la `reservationRef` y el motivo
   (`CANCELLED`, `DATE_CHANGED`, `NO_SHOW`).
3. El sistema envía la actualización al Módulo 1 por la misma cola, después de confirmar el cambio
   en el Módulo 2.

El Check-In y el Check-Out de las reservas de la lista no generan actualizaciones: los ejecuta el
propio Módulo 1, que los notifica al Módulo 2.

**Uso interno**

Las funcionalidades "Actualizar reservación", "Cancelar reservación", "Verificar disponibilidades",
"Enviar reservas del día al Módulo 1" y los procesos de Check-In, Check-Out y cierre del día
localizan reservas mediante este mismo servicio, con los mismos criterios.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Listado de Todas las Reservas con Filtros, Orden y Paginación (Priority: P1)

La Recepcionista necesita ver todas las reservas del hotel, de a 10 por página, y acotarlas por
estado, canal, agencia y fecha para preparar el día (por ejemplo, las llegadas de hoy en `ACTIVE`),
revisar las reservas OTA que siguen en `PENDING` o consultar las salidas de mañana. Por tratarse de
una única vista, el listado sin filtros, cada filtro, el orden, la paginación y los rechazos por
filtros inválidos se consolidan en esta historia.

**Why this priority**: Es la herramienta diaria de la Recepcionista para operar el front-desk y el
punto de partida para cancelar o modificar una reserva.

**Independent Test**: Con un conjunto de reservas de prueba en los seis estados, de ambos canales y en
distintas fechas, se consulta el listado sin filtros, por cada estado, por canal, por agencia, por el
rango de fechas sobre la estadía y con filtros combinados, y se verifica que cada resultado contenga
exactamente las reservas esperadas, con el total correcto y la paginación de a 10 correcta. Luego se
cambia el orden y se envían filtros inválidos y se confirma el **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Listado de todas las reservas sin filtros (Happy Path)
   - **Given** 45 reservas registradas en distintos estados
   - **When** la Recepcionista abre la vista de reservas sin filtros
   - **Then** el sistema muestra la página 1 con 10 reservas ordenadas por `startDate` descendente,
     informa un total de 45 y 5 páginas, y cada fila muestra los datos de FR-005

2. **Scenario**: Filtro por un estado
   - **Given** reservas en `ACTIVE`, `PENDING` y `CANCELLED`
   - **When** la Recepcionista filtra por `PENDING`
   - **Then** el sistema muestra únicamente las reservas en `PENDING`

3. **Scenario**: Filtro por canal y agencia
   - **Given** reservas directas y reservas OTA de dos agencias
   - **When** la Recepcionista filtra por canal `OTA` y elige una agencia
   - **Then** el sistema muestra solo las reservas OTA de esa agencia, con el nombre de la agencia y
     su código de confirmación en cada fila

4. **Scenario**: Reservas en el hotel en un rango (filtro por estadía)
   - **Given** una reserva del 2026-09-28 al 2026-10-03, otra del 2026-10-05 al 2026-10-08 y otra del
     2026-10-10 al 2026-10-12
   - **When** la Recepcionista filtra entre 2026-10-02 y 2026-10-06
   - **Then** el sistema muestra las dos primeras, porque su estadía se cruza con el rango
     (`startDate` ≤ `dateTo` y `endDate` > `dateFrom`), y excluye la tercera

5. **Scenario**: Filtros combinados
   - **Given** reservas `ACTIVE` y `CANCELLED`, directas y OTA, con estadía que incluye el 2026-10-01
   - **When** la Recepcionista filtra por estado `ACTIVE`, canal `DIRECT` y rango de fecha con
     `dateFrom` y `dateTo` iguales a 2026-10-01
   - **Then** el sistema muestra solo las reservas directas en `ACTIVE` cuya estadía incluye ese día

6. **Scenario**: Cambio de orden
   - **Given** el listado ordenado por `startDate` descendente
   - **When** la Recepcionista cambia el orden a ascendente
   - **Then** el sistema muestra las mismas reservas de la página 1 ordenadas de la llegada más
     antigua a la más reciente, sin alterar los filtros aplicados

7. **Scenario**: Navegación entre páginas
   - **Given** 25 reservas que cumplen los filtros aplicados
   - **When** la Recepcionista pasa a la página 3
   - **Then** el sistema muestra las 5 últimas reservas e informa el total de 25 y 3 páginas, con los
     mismos filtros y el mismo orden

8. **Scenario**: Filtros sin resultados
   - **Given** que ninguna reserva cumple los filtros aplicados
   - **When** la Recepcionista consulta el listado
   - **Then** el sistema responde 200 con una lista vacía, total 0 y el mensaje "No se encontraron
     reservas con los filtros aplicados." (no es un error)

9. **Scenario**: Filtro con valores inválidos (Error)
   - **Given** un filtro con un estado o un canal que no existe, una fecha mal formada, `dateFrom`
     posterior a `dateTo`, o solo una de las dos fechas del rango
   - **When** la Recepcionista consulta el listado
   - **Then** el sistema responde **HTTP 400** con el mensaje correspondiente de la tabla de
     validaciones (FR-009) y no ejecuta la consulta

---

### User Story 2 - Búsqueda por Código de Reserva y Detalle Completo (Priority: P1)

La Recepcionista necesita encontrar una reserva puntual a partir del código que le da el huésped o
la agencia, y ver todo su detalle para confirmarlo, modificarla o cancelarla. Por tratarse de una
misma consulta, la búsqueda exitosa por cada tipo de código, el detalle y el rechazo por código
inexistente o mal formado se consolidan en esta historia.

**Why this priority**: Es la forma más rápida de atender a un huésped o una agencia, y es el paso
previo obligatorio de "Actualizar reservación" y "Cancelar reservación".

**Independent Test**: Se busca una reserva por su `reservationRef`, otra por su
`externalConfirmationCode`, se verifica que el detalle contenga todos los campos de FR-006, y se
busca un código inexistente y uno con caracteres inválidos confirmando el **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Búsqueda por `reservationRef` (Happy Path)
   - **Given** una `Reservation` con dos habitaciones y 5 personas
   - **When** la Recepcionista busca su `reservationRef` exacta
   - **Then** el sistema muestra el detalle completo: `status`, fechas, noches, `guestCount`, las
     dos habitaciones con su `roomId`, `categoryRoom` y `stayStatus`, el titular y el canal

2. **Scenario**: Búsqueda por código de la OTA
   - **Given** una `Reservation` de canal `OTA` con `externalConfirmationCode` `BK-99812`
   - **When** la Recepcionista busca `BK-99812`
   - **Then** el sistema muestra el detalle de esa reserva

3. **Scenario**: El código ignora los demás filtros
   - **Given** una reserva `CANCELLED` y el filtro de estado `ACTIVE` aplicado en la vista
   - **When** la Recepcionista busca el código de esa reserva
   - **Then** el sistema muestra la reserva `CANCELLED`, porque la búsqueda por código ignora los
     filtros

4. **Scenario**: Detalle de una reserva cancelada
   - **Given** una reserva `CANCELLED` por la Recepcionista
   - **When** la Recepcionista abre su detalle
   - **Then** el sistema muestra también la fecha, el canal, el motivo y quién procesó la
     cancelación (`Cancellation`)

5. **Scenario**: Código inexistente (Error)
   - **Given** un texto con el formato de una `reservationRef` interna (empieza con `RSV-`) que no
     corresponde a ninguna reserva
   - **When** la Recepcionista lo busca
   - **Then** el sistema responde con el mensaje "La reserva no existe." Si el texto buscado no tiene
     ese formato y tampoco coincide con ningún `externalConfirmationCode`, el sistema no muestra este
     mensaje: lo evalúa en cambio como búsqueda por documento o por nombre (User Story 3)

6. **Scenario**: Código vacío o con caracteres inválidos (Error)
   - **Given** un código vacío, con solo espacios o con caracteres fuera de letras, dígitos y guion
   - **When** la Recepcionista lo busca
   - **Then** el sistema responde **HTTP 400** con el mensaje "Debe proveer un código de reserva
     válido para la consulta." sin llegar a consultar la base de datos

---

### User Story 3 - Búsqueda por Titular (Priority: P2)

Cuando el huésped no tiene a mano el código, la Recepcionista busca sus reservas por número de
documento o por nombre, usando el mismo cuadro de búsqueda del listado (no hay campos separados para
código, documento y nombre). Si el texto no coincide con ningún código (ver "Búsqueda por código") y
contiene al menos un dígito, el sistema lo trata como `documentNumber` con coincidencia exacta; si no
contiene ningún dígito, lo trata como `fullName` con coincidencia parcial. Por tener un único cuadro,
nunca se envían `documentNumber` y `fullName` a la vez. Esta búsqueda se combina con los filtros de
estado, canal y fecha.

**Why this priority**: Complementa la búsqueda por código en la atención telefónica y presencial,
pero la operación puede avanzar con el listado filtrado y la búsqueda por código.

**Independent Test**: Se busca un huésped con varias reservas por su documento y por parte de su
nombre, con y sin filtro de estado, y se verifica que se listen solo sus reservas.

**Acceptance Scenarios**:

1. **Scenario**: Búsqueda por documento
   - **Given** un huésped con tres reservas (una `COMPLETED`, una `ACTIVE` y una `CANCELLED`)
   - **When** la Recepcionista busca por su `documentNumber`
   - **Then** el sistema lista las tres reservas con su `status`

2. **Scenario**: Búsqueda por nombre parcial
   - **Given** un titular llamado "María José Gómez"
   - **When** la Recepcionista busca "gomez"
   - **Then** el sistema incluye sus reservas, porque la búsqueda por nombre es parcial y no
     distingue mayúsculas ni tildes

3. **Scenario**: Titular combinado con estado
   - **Given** el mismo huésped con tres reservas
   - **When** la Recepcionista busca por su `documentNumber` y filtra por `ACTIVE`
   - **Then** el sistema lista solo la reserva `ACTIVE`

4. **Scenario**: Nombre demasiado corto (Error)
   - **Given** un texto de búsqueda por nombre de menos de 3 caracteres
   - **When** la Recepcionista consulta
   - **Then** el sistema responde **HTTP 400** con el mensaje "La búsqueda por nombre requiere al
     menos 3 caracteres."

---

### User Story 4 - Envío de la Lista de Reservas del Día al Módulo 1 (Priority: P1)

Al iniciar cada día operativo, el Módulo 2 envía al Módulo 1 la lista completa de las reservas
`ACTIVE` que llegan ese día, con la cantidad de personas, las habitaciones, el titular, la fecha de
salida y los detalles de cada reserva. Por tratarse de un único proceso automático, el envío con
reservas, el envío vacío, la exclusión de reservas en otros estados y la ejecución repetida se
consolidan en esta historia.

**Why this priority**: Sin esta lista, el Módulo 1 no puede preparar las llegadas ni reconocer al
huésped en el Check-In.

**Independent Test**: Con reservas de prueba con llegada hoy en `ACTIVE`, `PENDING` y `CANCELLED`, y
otras con llegada mañana, se ejecuta el proceso del inicio del día y se verifica que el Módulo 1
recibe una sola lista con exactamente las reservas `ACTIVE` de hoy, con todos los campos de FR-014 y
totales correctos. Se ejecuta de nuevo el proceso el mismo día y se verifica que no se envía una
segunda lista.

**Acceptance Scenarios**:

1. **Scenario**: Envío de la lista con reservas (Happy Path)
   - **Given** tres reservas `ACTIVE` con llegada hoy: una con 1 habitación y 2 personas, otra con 2
     habitaciones y 5 personas, y otra con 1 habitación y 1 persona
   - **When** inicia el día operativo
   - **Then** el Módulo 1 recibe la lista del día con 3 reservas, 4 habitaciones y 8 personas en la
     cabecera, y por cada reserva el detalle completo de FR-014

2. **Scenario**: Solo se envían reservas `ACTIVE` con llegada hoy
   - **Given** reservas con llegada hoy en `ACTIVE`, `PENDING` y `CANCELLED`, y una reserva `ACTIVE`
     con llegada mañana
   - **When** inicia el día operativo
   - **Then** la lista incluye solo las reservas `ACTIVE` con llegada hoy

3. **Scenario**: Día sin llegadas
   - **Given** que ninguna reserva `ACTIVE` tiene llegada hoy
   - **When** inicia el día operativo
   - **Then** el Módulo 1 recibe la lista del día con cero reservas y totales en 0

4. **Scenario**: Ejecución repetida el mismo día
   - **Given** que la lista del día ya se envió
   - **When** el proceso del inicio del día se ejecuta de nuevo el mismo día (por un reinicio del
     servidor, por ejemplo)
   - **Then** el sistema no envía una segunda lista; los cambios posteriores al primer envío ya
     viajan como actualizaciones


---

### User Story 5 - Actualizaciones de la Lista del Día (Priority: P1)

Después del envío de la mañana, cada cambio que afecta a las reservas del día se avisa al Módulo 1
para que su lista quede siempre al día. Por tratarse del mismo mecanismo, las altas, los cambios, las
bajas y el orden de entrega se consolidan en esta historia.

**Why this priority**: Una lista que no se actualiza lleva al Módulo 1 a esperar huéspedes que
cancelaron o a no reconocer reservas creadas durante el día.

**Independent Test**: Después de enviar la lista del día, se crea una reserva directa para hoy, se
confirma una reserva OTA con llegada hoy, se cambia la cantidad de personas de otra, se agrega una
habitación a otra y se cancela una cuarta; se verifica que el Módulo 1 recibe, en orden, dos
`ADDED`, dos `UPDATED` y un `REMOVED` con el contenido correcto.

**Acceptance Scenarios**:

1. **Scenario**: Nueva reserva directa para hoy (`ADDED`)
   - **Given** que la lista del día ya se envió
   - **When** la Recepcionista crea una reserva directa con llegada hoy y queda `ACTIVE`
   - **Then** el Módulo 1 recibe una actualización `ADDED` con el detalle completo de la reserva

2. **Scenario**: Confirmación de una reserva OTA con llegada hoy (`ADDED`)
   - **Given** una reserva OTA `PENDING` con llegada hoy, que no estaba en la lista
   - **When** la OTA confirma el pago o la garantía y la reserva pasa a `ACTIVE`
   - **Then** el Módulo 1 recibe una actualización `ADDED` con el detalle completo

3. **Scenario**: Cambio de datos de una reserva de la lista (`UPDATED`)
   - **Given** una reserva de la lista del día con 1 habitación y 2 personas
   - **When** la Recepcionista agrega una habitación y cambia `guestCount` a 4
   - **Then** el Módulo 1 recibe una actualización `UPDATED` con el detalle completo vigente: 2
     habitaciones y 4 personas

4. **Scenario**: Cancelación de una reserva de la lista (`REMOVED`)
   - **Given** una reserva de la lista del día
   - **When** la reserva se cancela
   - **Then** el Módulo 1 recibe una actualización `REMOVED` con la `reservationRef` y el motivo
     `CANCELLED`

5. **Scenario**: Cambio de fecha que saca una reserva de la lista (`REMOVED`)
   - **Given** una reserva de la lista del día
   - **When** la Recepcionista mueve su llegada a mañana
   - **Then** el Módulo 1 recibe una actualización `REMOVED` con el motivo `DATE_CHANGED`; la reserva
     viajará en la lista de mañana

6. **Scenario**: No-Show al cierre del día (`REMOVED`)
   - **Given** una reserva de la lista del día que sigue `ACTIVE` sin Check-In
   - **When** el cierre del día la marca `NO_SHOW` (OTA) o `CANCELLED` (directa)
   - **Then** el Módulo 1 recibe una actualización `REMOVED` con el motivo `NO_SHOW`

7. **Scenario**: Orden de entrega
   - **Given** dos cambios seguidos sobre la misma reserva (por ejemplo, cambio de personas y luego
     cancelación)
   - **When** el sistema envía las actualizaciones
   - **Then** cada actualización lleva un `sequenceNumber` creciente dentro del día operativo, y el
     Módulo 1 recibe primero la `UPDATED` y después la `REMOVED`

8. **Scenario**: Cambio que no afecta a la lista
   - **Given** una reserva con llegada dentro de una semana
   - **When** la Recepcionista cambia su cantidad de personas
   - **Then** el sistema no envía ninguna actualización hoy; el dato viajará en la lista del día de
     su llegada

### Casos Borde

- ¿Qué sucede si el texto del cuadro de búsqueda coincide con una `reservationRef` o un
  `externalConfirmationCode`? El código tiene prioridad: se ignoran los demás filtros aplicados
  (estado, canal, agencia, fecha) y se devuelve solo esa reserva. Si el texto tiene el formato de una
  `reservationRef` interna (empieza con `RSV-`) y no hay coincidencia, responde con el mensaje
  "La reserva no existe."
- ¿Puede la Recepcionista buscar por `documentNumber` y por `fullName` a la vez? No: hay un único
  cuadro de búsqueda, y el sistema decide automáticamente cuál de los dos aplica según si el texto
  contiene algún dígito (ver "Búsqueda por titular").
- ¿Qué sucede si un texto coincide con la `reservationRef` de una reserva y, a la vez, con el
  `externalConfirmationCode` de otra? El sistema no resuelve una prioridad entre ambas: lista las dos
  coincidencias para que la Recepcionista elija. Dos OTAs distintas también pueden usar el mismo
  `externalConfirmationCode`; en ese caso también se listan todas las coincidencias.
- ¿Qué sucede si se pide una página que no existe (por ejemplo, la página 10 cuando solo hay 3)?
  El sistema ajusta automáticamente a la última página válida y la muestra, en vez de devolver una
  lista vacía.
- ¿Qué sucede si el rango de fechas supera los 366 días? El sistema responde **HTTP 400** con el
  mensaje "El rango de fechas no puede superar 366 días."
- ¿Qué sucede con los filtros de fecha y las reservas sin fechas reales, como `NO_SHOW` o
  `CANCELLED`? Se filtran por sus fechas planeadas (`startDate` y `endDate`), que se conservan
  aunque la reserva no se haya usado.
- ¿Qué sucede si cambian las reservas mientras la Recepcionista navega las páginas? Cada página se
  calcula al pedirla; una reserva nueva puede desplazar a otra a la página siguiente o anterior.
- ¿Qué sucede si una reserva tiene varias habitaciones? Aparece una sola vez en el listado, con la
  cantidad de habitaciones y sus números de habitación; nunca se repite por habitación.
- ¿Qué sucede si se envían caracteres especiales o intentos de inyección en cualquier filtro? El
  sistema valida el formato de cada campo, detiene la petición y responde **HTTP 400**, sin provocar
  caídas del servidor **HTTP 500**.
- ¿Cómo maneja el sistema una consulta sobre una reserva cuyo `status` cambia en ese instante (por
  ejemplo, llega un Check-In)? Retorna el último estado confirmado en la base de datos; la
  siguiente consulta ya refleja el cambio.
- ¿Qué sucede si la Ota o el Módulo 1 intentan usar la vista y la búsqueda? El sistema lo rechaza:
  son exclusivas de la Recepcionista y de los procesos internos del Módulo 2.

**Envío al Módulo 1**

- ¿Qué sucede si se crea una reserva para hoy antes de que se envíe la lista del día? No se envía una
  actualización aparte: la reserva queda incluida en la lista, porque la lista se arma con los datos
  vigentes al momento del envío.
- ¿Qué sucede si la publicación en la cola falla (por ejemplo, el servidor de mensajería no está
  disponible)? La operación que originó el cambio (crear, cancelar, modificar) **no** se revierte. El
  sistema guarda el envío como pendiente y lo reintenta en orden, sin saltarse el `sequenceNumber`,
  hasta publicarlo; si tras los reintentos no lo logra, registra una alerta para revisión humana. Lo
  mismo aplica a la lista del inicio del día.
- ¿Qué sucede si la lista del inicio del día no pudo enviarse y mientras tanto hay cambios? Las
  actualizaciones del día esperan en cola detrás de la lista: el Módulo 1 nunca recibe una
  actualización antes que la lista de ese día.
- ¿Qué sucede si una reserva de la lista queda en `IN_PROGRESS` por el Check-In? No se envía ninguna
  actualización: el Check-In lo ejecutó el propio Módulo 1.
- ¿Qué sucede si una reserva ya tuvo Check-In antes del inicio del día (llegada anticipada) y está en
  `IN_PROGRESS` al armar la lista? No se incluye, porque el Módulo 1 ya registró su ingreso.
- ¿Qué sucede si una reserva `PENDING` de una OTA tiene llegada hoy y nunca se confirma? No viaja en
  la lista. Si la OTA la confirma
  durante el día, viaja como `ADDED`; si no, el cierre del día la marca `NO_SHOW`.
- ¿Qué sucede si una reserva de la lista cambia varias veces en pocos segundos? Se envía una
  actualización por cada cambio confirmado, cada una con el detalle completo vigente en ese momento y
  su `sequenceNumber`; el Módulo 1 se queda con la de mayor secuencia.
- ¿Qué sucede si el día operativo cambia mientras hay actualizaciones pendientes del día anterior? Se
  envían igualmente con la fecha operativa a la que pertenecen, para que el Módulo 1 las aplique a la
  lista correcta.
- ¿Qué sucede si el titular no tiene teléfono o correo registrados? Los campos viajan vacíos
  (`null`); no impiden el envío.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir a la Recepcionista listar todas las `Reservation`
  registradas, en páginas de **10 reservas** (tamaño fijo), informando el total de reservas que
  cumplen los filtros y el total de páginas.
- **FR-002**: El sistema debe permitir filtrar el listado por `status` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`). Sin filtro de estado, debe incluir todos los
  estados.
- **FR-003**: El sistema debe permitir filtrar el listado por un rango inclusivo de fechas
  (`dateFrom` y `dateTo`, formato `AAAA-MM-DD`, hora de Colombia) sobre la estadía: muestra las
  reservas cuya estadía se cruza con el rango (`startDate` ≤ `dateTo` y `endDate` > `dateFrom`).
- **FR-003a**: El sistema debe permitir ordenar el listado por `startDate`, ascendente o descendente.
  Por defecto, descendente (la llegada más reciente primero). El orden y los filtros se conservan al
  cambiar de página.
- **FR-004**: El sistema debe permitir filtrar por titular a través del mismo cuadro de búsqueda
  usado para el código: si el texto no coincide con ningún código y contiene al menos un dígito, se
  interpreta como `documentNumber` con coincidencia exacta; si no contiene ningún dígito, se
  interpreta como `fullName` con coincidencia parcial sin distinguir mayúsculas ni tildes y con
  mínimo 3 caracteres. El sistema también debe permitir filtrar por canal (`source`: `DIRECT` |
  `OTA`) y, cuando el canal es `OTA`, por agencia (`otaId`), y combinar todos los filtros con la
  regla "Y".
- **FR-005**: Cada fila del listado debe mostrar: `reservationRef` (y, si es `OTA`, el
  `externalConfirmationCode`), el `fullName` y el `documentNumber` del titular, los `roomNumber` y la
  `categoryRoom` de sus habitaciones, el canal (`source` y, si es `OTA`, el `name` de la agencia),
  `startDate` y `endDate`, `status`, su estado migratorio (`migrationStatus`, FR-005b) y las acciones
  Ver detalle, Modificar y Cancelar. Modificar y Cancelar solo se habilitan en reservas directas
  `ACTIVE` o `PENDING`. El número de noches y `guestCount` se ven en el detalle
  (FR-006).
- **FR-005a**: Encima del listado, el sistema debe mostrar a la Recepcionista un resumen del día
  operativo, calculado solo con datos del Módulo 2:
  - Llegadas esperadas hoy: reservas `ACTIVE` o `PENDING` con `startDate` igual a hoy.
  - Salidas esperadas hoy: reservas `IN_PROGRESS` con `endDate` igual a hoy.
  La ocupación física no se muestra aquí: es un dato del Módulo 1.
- **FR-005b**: El `migrationStatus` de cada reserva se deriva de sus `MigratoryMovement` y nunca se
  muestra vacío ni como "N/A":
  - `AWAITING_CHECK_IN` ("Pendiente de Check-In"): reserva `ACTIVE` o `PENDING`. Aún no se conoce
    la nacionalidad de todos los huéspedes; los datos migratorios llegan con el Check-In del Módulo 1.
  - `COMPLETE`: tiene movimientos migratorios registrados.
  - `NOT_REQUIRED` ("Sin extranjeros"): reserva `IN_PROGRESS` o `COMPLETED` sin huéspedes
    extranjeros, por lo que no entra al reporte SIRE.
  - `NO_CHECK_IN` ("Sin Check-In"): reserva `CANCELLED` o `NO_SHOW`; nunca tuvo ingreso ni
    movimientos que reportar.
- **FR-006**: El sistema debe permitir buscar una reserva por código (coincidencia exacta sobre
  `reservationRef` y sobre `externalConfirmationCode`, evaluadas en paralelo), acotar el listado a
  la o las reservas encontradas ignorando los demás filtros, y permitir abrir desde ahí el detalle
  completo de una reserva:
  - Datos de la reserva: `reservationRef`, `status`, `source`, `externalConfirmationCode` (solo
    `OTA`), `startDate`, `endDate`, número de noches, `guestCount`, `notes`, `createdAt`.
  - Habitaciones (`ReservationRoom`): por cada una, `roomNumber`, `categoryRoom`,
    `roomGrossAmount` (tarifa, informativa; vacía en reservas `OTA`) y `stayStatus`.
  - Titular (`Guest`): `fullName`, `documentType`, `documentNumber`, `nationality`, `contactPhone`,
    `contactEmail`.
  - Si la reserva está `CANCELLED` por una solicitud explícita: `cancellationDate`, `channel`,
    `reason` y `processedBy` de la `Cancellation`.
- **FR-007**: El sistema debe exponer la misma búsqueda como servicio interno para las demás
  funcionalidades del Módulo 2, devolviendo la reserva completa (incluidos `updatedAt` y los datos de
  comisión, que no se muestran en el listado).
- **FR-008**: El sistema debe ser de solo lectura e idempotente: ninguna consulta modifica ninguna
  entidad.
- **FR-009**: El sistema debe validar todos los parámetros antes de consultar y responder **HTTP 400
  (Bad Request)** con estos mensajes, prohibiendo la propagación a **HTTP 500**:

  | Caso | Mensaje |
  |---|---|
  | Código vacío, solo espacios o con caracteres distintos de letras, dígitos y guion, o de más de 40 caracteres | "Debe proveer un código de reserva válido para la consulta." |
  | Código con el formato de `reservationRef` interna (empieza con `RSV-`) sin coincidencias | "La reserva no existe." |
  | Estado inexistente | "El estado indicado no es válido." |
  | Canal inexistente | "El canal indicado no es válido." |
  | Fecha con formato distinto de `AAAA-MM-DD` o inexistente | "La fecha indicada no es válida." |
  | Solo una de las dos fechas del rango (`dateFrom` sin `dateTo`, o `dateTo` sin `dateFrom`) | "Debe completar ambas fechas del rango." |
  | `dateFrom` posterior a `dateTo` | "La fecha inicial no puede ser posterior a la fecha final." |
  | Rango de más de 366 días | "El rango de fechas no puede superar 366 días." |
  | Orden distinto de ascendente o descendente | "El orden indicado no es válido." |
  | Página menor a 1 | "El número de página debe ser 1 o mayor." |
  | `fullName` de menos de 3 caracteres (texto sin dígitos interpretado como nombre) | "La búsqueda por nombre requiere al menos 3 caracteres." |

- **FR-010**: El sistema debe responder 200 con una lista vacía, y no un error, cuando los filtros
  son válidos pero ninguna reserva los cumple.
- **FR-011**: El sistema debe restringir la vista y la búsqueda a la Recepcionista y a los procesos
  internos del Módulo 2. Ni la Ota ni el Módulo 1 tienen acceso a la vista ni a la búsqueda.
- **FR-012**: El sistema debe ejecutar, una vez por día operativo, a las 00:00 de Colombia (UTC-5),
  un proceso automático que envíe al Módulo 1 la lista de las
  `Reservation` con `startDate` igual al día operativo y `status` `ACTIVE`.
- **FR-013**: La lista debe tener una cabecera con `operationalDate`, `generatedAt`,
  `totalReservations`, `totalRooms` y `totalGuests` (suma de `guestCount`), y debe enviarse aunque no
  haya reservas, con cero reservas y totales en `0`. Debe enviarse una sola vez por día operativo: si
  el proceso se ejecuta de nuevo el mismo día, no debe reenviarla.
- **FR-014**: Por cada reserva, la lista y las actualizaciones `ADDED` y `UPDATED` deben incluir:
  - Reserva: `reservationRef`, `status`, `source`, `externalConfirmationCode` (solo `OTA`),
    `startDate`, `endDate` (fecha de salida), número de noches, `guestCount` (cantidad de personas),
    `notes` (observaciones) y `updatedAt`.
  - Habitaciones: por cada `ReservationRoom`, `roomId`, `roomNumber` y `categoryRoom`.
  - Titular (`Guest`): `guestRef`, `fullName`, `documentType`, `documentNumber`, `nationality`,
    `contactPhone` y `contactEmail`.
- **FR-015**: El sistema no debe incluir datos financieros (`grossAmount`, comisión) en la lista ni
  en las actualizaciones: no los necesita el Módulo 1. La consulta por referencia del Módulo 3 (FR-022)
  es aparte y sí entrega los `quoteIds` y el porcentaje de comisión.
- **FR-016**: Después del envío de la lista, el sistema debe enviar una actualización
  `DailyReservationUpdate` por cada cambio confirmado que afecte a la lista del día: `ADDED` cuando
  una reserva entra (creación directa para hoy, confirmación OTA con llegada hoy, cambio de llegada
  a hoy), `UPDATED` cuando cambia un dato de FR-014 de una reserva de la lista, y `REMOVED` cuando
  sale (motivo `CANCELLED`, `DATE_CHANGED` o `NO_SHOW`).
- **FR-017**: El sistema no debe enviar actualizaciones por el Check-In ni por el Check-Out, ni por
  cambios en reservas cuya llegada no es el día operativo en curso.
- **FR-018**: Cada lista y cada actualización deben llevar un identificador único (`messageId`) y un
  `sequenceNumber` creciente dentro del día operativo (la lista es la secuencia 1), para que el
  Módulo 1 descarte duplicados y aplique los cambios en orden.
- **FR-019**: El sistema debe enviar la lista y las actualizaciones por cola (notificación proactiva,
  sin respuesta del Módulo 1), en el orden de su `sequenceNumber`, y solo después de confirmar en el
  Módulo 2 el cambio que las origina.
- **FR-020**: Si la publicación falla, el sistema no debe revertir la operación que originó el
  cambio; debe guardar el envío como pendiente, reintentarlo en orden y, si no logra publicarlo tras
  los reintentos, registrar una alerta para revisión humana.
- **FR-021**: El envío al Módulo 1 no debe cambiar el `status` de ninguna reserva ni el estado de
  ninguna `Room`.
- **FR-023**: El sistema debe permitir que el Módulo 1 consulte, con una credencial de servicio (actor
  `Modulo1`), las reservas cuya estadía se cruza con un rango de fechas, con fecha de inicio (`dateFrom`) y fecha
  de fin (`dateTo`) obligatorias, ambas con formato `AAAA-MM-DD` y la misma regla de cruce de FR-003, y,
  opcionalmente, las de una habitación (`roomId`), para que verifique un mantenimiento al registrarlo o dé
  de baja una habitación (las fechas son las de inicio y fin del mantenimiento o de la baja). Solo devuelve reservas vigentes
  (`PENDING`, `ACTIVE` o `IN_PROGRESS`), con `reservationRef`, `status`, `startDate`, `endDate` y, por
  cada `ReservationRoom`, `roomId`, `roomNumber` y `categoryRoom`. No incluye datos financieros ni del
  huésped. El Módulo 2 solo informa: no decide qué hacer con la reserva ni modifica nada, esa lógica
  la aplica el Módulo 1. Es de solo lectura.
- **FR-022**: El sistema debe permitir que el Módulo 3 consulte una reserva por su `reservationRef`
  con una credencial de servicio (actor `Modulo3`), para que genere la liquidación en el Check-Out. La
  respuesta lleva `reservationRef`, `channel` (`DIRECT` | `OTA`) y `quoteIds`, la lista con el
  `quoteId` de cada `ReservationRoom` (una cotización por habitación; la lista va vacía en las
  reservas `OTA`, que no tienen cotización). Solo si el canal es `OTA`, también lleva `otaId` (el `id`
  de la `Ota`), `otaConfirmationCode` (el `externalConfirmationCode`) y `otaCommissionPercentage` (el
  `commissionPercentage` congelado). No incluye otros datos financieros ni datos del huésped. Si la reserva no existe, responde **HTTP 404 (Not Found)**. Es de solo lectura y
  no modifica nada.

### Non-Functional Requirements

- **NFR-001**: La búsqueda por código debe responder en menos de 500 milisegundos.
- **NFR-002**: Una página del listado, con cualquier combinación de filtros y cualquier orden, debe
  responder en menos de 1 segundo con hasta 50 000 reservas registradas.
- **NFR-003**: Los datos personales del titular no deben escribirse en los registros de log.
- **NFR-004**: La lista del día debe quedar publicada en menos de 1 minuto desde las 00:00 del día
  operativo, con hasta 500 reservas.
- **NFR-005**: Cada actualización debe quedar publicada en menos de 5 segundos desde que se confirma
  el cambio que la origina, en condiciones normales.

### Key Entities *(include if feature involves data)*

- **Reservation**: Entidad consultada. Atributos: `reservationRef`, `guestRef`, `guestCount`,
  `startDate`, `endDate`, `source` (`DIRECT` | `OTA`), `externalConfirmationCode`,
  `notes`, `createdAt`, `updatedAt` y `status` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **ReservationRoom**: Cada habitación de la reserva. Atributos: `reservationRef`, `roomId`,
  `roomNumber`, `categoryRoom` y `stayStatus` (`EXPECTED` | `CHECKED_IN` | `CHECKED_OUT` |
  `NOT_ARRIVED`).
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentType` (tipo de documento: `CC`, `CE`, `PASSPORT` u `OTHER`),
  `documentNumber`, `nationality`, `contactPhone`, `contactEmail`.
- **Cancellation**: Se muestra en el detalle de una reserva cancelada. Atributos: `cancellationDate`,
  `channel`, `reason` y `processedBy`.
- **DailyReservationList**: Lista del día enviada al Módulo 1. Atributos: `messageId`,
  `operationalDate`, `generatedAt`, `sequenceNumber` (siempre `1`), `totalReservations`,
  `totalRooms`, `totalGuests`, `reservations` (detalle de FR-014) y `publishStatus` (`PENDING` |
  `PUBLISHED` | `FAILED`).
- **DailyReservationUpdate**: Actualización de la lista del día. Atributos: `messageId`,
  `operationalDate`, `sequenceNumber`, `updateType` (`ADDED` | `UPDATED` | `REMOVED`),
  `reservationRef`, `reservation` (detalle de FR-014; solo en `ADDED` y `UPDATED`), `removalReason`
  (`CANCELLED` | `DATE_CHANGED` | `NO_SHOW`; solo en `REMOVED`), `occurredAt` y `publishStatus`
  (`PENDING` | `PUBLISHED` | `FAILED`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La Recepcionista ve el resumen del día operativo (FR-005a), con las llegadas y salidas
  esperadas hoy, en menos de 1 segundo y sin tener que armar un filtro, encima del listado.
- **SC-002**: El 100% de las búsquedas por código existente retornan el detalle completo en menos de
  500 milisegundos.
- **SC-003**: El 100% de los listados filtrados contienen exactamente las reservas que cumplen todos
  los filtros, sin duplicados por habitación.
- **SC-004**: Cero errores **HTTP 500** ante parámetros vacíos, inválidos o inexistentes.
- **SC-005**: El Módulo 1 recibe la lista del día el 100% de los días operativos, incluidos los días
  sin llegadas.
- **SC-006**: El 100% de las reservas `ACTIVE` con llegada en el día están en la lista o llegan como
  `ADDED` antes de que el huésped se presente.
- **SC-007**: El 100% de las cancelaciones y cambios de fecha de reservas de la lista llegan al
  Módulo 1 como `REMOVED` en menos de 5 segundos en condiciones normales.
- **SC-008**: Cero actualizaciones perdidas o aplicadas fuera de orden: cada día operativo tiene una
  secuencia continua de `sequenceNumber`.
