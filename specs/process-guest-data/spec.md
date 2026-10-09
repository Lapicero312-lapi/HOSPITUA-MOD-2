# Feature Specification: Procesar Datos de Huéspedes

**Created**: 2026-09-23
**Updated**: 2026-10-08

## Use Case (Caso de Uso)

### Descripción del problema

La ley exige reportar a Migración Colombia los huéspedes extranjeros que aloja el hotel, con su
información migratoria completa y el tipo de movimiento: **entrada** (cuando ingresan al hotel) y
**salida** (cuando lo dejan). Esos datos se capturan en persona, en el Check-In y en el Check-Out, y
por eso los procesa el Módulo 1, que es quien opera la recepción física. El Módulo 1 envía al Módulo 2,
dentro de las notificaciones de Check-In y de Check-Out de cada habitación, los datos **de todos los
huéspedes de esa habitación** (colombianos y extranjeros), ya procesados y completos. El Módulo 2 no
tiene una pantalla propia para pedirlos y no los completa ni los corrige.

Como el Módulo 1 no separa a los extranjeros, **la selección la hace el Módulo 2**: guarda a todos los
huéspedes y, cuando la Recepcionista exporta el archivo `.TXT` de SIRE, incluye únicamente a los
extranjeros (nacionalidad distinta de Colombia). La Recepcionista luego envía el archivo a Migración
(ver "Exportar archivo SIRE").

Una reserva puede alojar a varios huéspedes (un grupo o una familia), y todos los extranjeros deben
reportarse, no solo el titular de la reserva. El negocio necesita un procesamiento que reciba los datos
de cada huésped (`GuestData`), registre un movimiento (`MigratoryMovement`) de entrada o de salida por
cada uno, al exportar seleccione los extranjeros y le permita a la Recepcionista **consultar los
huéspedes que se han alojado** en el hotel.

**Qué hace el Módulo 1 y qué hace el Módulo 2**: el Módulo 1 captura y valida los datos de todos los
ocupantes y asigna por su cuenta el tipo de movimiento y su fecha, sin pedírselos a la Recepcionista:
`ENTRY` con la fecha de llegada (`checkInDate`) en el Check-In, y `DEPARTURE` con la fecha de salida
(`checkOutDate`) en el Check-Out, ambas solo fecha, sin hora. **El Módulo 2 da por hecho que los datos
llegan completos y correctos**: el Módulo 1 no envía a un huésped al que le falte algún dato obligatorio
(el lugar de procedencia y el de destino solo son obligatorios para los extranjeros). El Módulo
2 no captura, no valida ni completa nada: recibe los datos de cada huésped (tipo y número de documento,
fecha de nacimiento, nombre, apellido, nacionalidad, lugar de procedencia, lugar de destino y tipo de
movimiento), los guarda y, al exportar, selecciona los extranjeros y los empaqueta en el archivo `.TXT`.

### Flujo de Usuario de Alto Nivel

1. El **Módulo 1** notifica el **Check-In** de una habitación de una reserva (cola
   `m2.habitacion.checkin.queue`) con la `reservationRef` y la lista `guests` con **todos
   los huéspedes** que ingresaron a esa habitación, cada uno con sus `GuestData` (`originPlace` y `destinationPlace` solo para extranjeros).
   La notificación trae el `movementType` `ENTRY` y el `movementDate` (`checkInDate`) a nivel de
   mensaje, y valen para todos los huéspedes de la lista. El cambio de estado de la habitación y de la reserva lo
   ejecuta "Actualizar reservación".
2. El Módulo 1 notifica el **Check-Out** de una habitación (cola `m2.habitacion.checkout.queue`) con la
   `reservationRef` y la lista `guests` con todos los huéspedes que salieron de esa
   habitación. La notificación trae el `movementType` `DEPARTURE` y el `movementDate`
   (`checkOutDate`) a nivel de mensaje, y valen para todos los huéspedes de la lista.
3. Por cada huésped de la lista, el sistema guarda sus datos **una sola vez** en `GuestData` (por
   reserva y número de documento) y registra un `MigratoryMovement` con el tipo y la fecha, sea
   colombiano o extranjero. En el Check-Out el huésped se identifica por su `documentNumber`: no se
   duplica ni se modifican sus datos, y solo se agrega el `DEPARTURE`. Hay un
   movimiento por cada combinación de reserva, huésped y tipo de movimiento: un huésped que ingresa y
   sale tiene dos, uno `ENTRY` y uno `DEPARTURE`, ligados al mismo `GuestData`.
4. El sistema identifica como **extranjero** a todo huésped cuya `nationality` sea distinta de
   `Colombia` (el Módulo 1 escribe la nacionalidad de un colombiano exactamente así).
   Esta marca se deduce de la nacionalidad y no se guarda aparte.
5. Solo un payload inutilizable (sin identificador de reserva o con caracteres maliciosos) se rechaza
   con **HTTP 400 (Bad Request)** sin registrar nada.
6. Cuando "Exportar archivo SIRE" (ejecutado por la Recepcionista) necesita los datos, invoca este caso de
   uso para obtener los movimientos del periodo. El caso de uso **selecciona únicamente los de
   huéspedes extranjeros** y deja fuera a los colombianos.
7. La **Recepcionista** consulta en la vista de huéspedes alojados a todos los huéspedes registrados,
   colombianos y extranjeros, con filtros, búsqueda y su detalle. La vista es de solo consulta.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recepción de los Datos de los Huéspedes enviados por el Módulo 1 (Priority: P1)

El sistema recibe, dentro de las notificaciones de Check-In y de Check-Out del Módulo 1, los datos ya
procesados de todos los huéspedes de la habitación y los registra como `MigratoryMovement` de entrada
o de salida. El camino exitoso, los grupos mixtos de colombianos y extranjeros, los reenvíos duplicados y
las reservas solo de colombianos se consolidan en esta misma historia de usuario.

**Why this priority**: Sin estos datos consolidados, el hotel no puede cumplir con el reporte
migratorio obligatorio. Recibirlos en las mismas notificaciones evita duplicar pantallas de captura en el
Módulo 2.

**Independent Test**: Se envía una notificación simulada de Check-In con tres huéspedes (dos extranjeros
y uno colombiano) y se verifica que queden tres movimientos `ENTRY`. Se envía el Check-Out y se
verifica que queden tres movimientos `DEPARTURE`. Se reenvía la misma notificación y se verifica que no
se duplican.

**Acceptance Scenarios**:

1. **Scenario**: Movimiento de entrada de los huéspedes de una habitación (Happy Path)
   - **Given** una `Reservation` en Check-In
   - **When** el sistema recibe la notificación del Módulo 1 con los huéspedes de la habitación y
     `movementType` `ENTRY`
   - **Then** el sistema registra un `MigratoryMovement` `ENTRY` por cada huésped, colombiano o
     extranjero

2. **Scenario**: Grupo mixto en una misma reserva
   - **Given** una `Reservation` con 3 personas, de las cuales 2 son extranjeras
   - **When** la notificación de Check-In trae a las 3
   - **Then** el sistema registra tres `MigratoryMovement` `ENTRY` y reconoce como extranjeros solo a los
     dos de nacionalidad distinta de Colombia

3. **Scenario**: Movimiento de salida (Happy Path)
   - **Given** huéspedes con su movimiento `ENTRY` registrado
   - **When** la notificación de Check-Out trae a esos huéspedes con `movementType` `DEPARTURE` y su
     fecha
   - **Then** el sistema registra un `MigratoryMovement` `DEPARTURE` por cada uno, sin modificar el
     `ENTRY`; cada huésped queda con dos movimientos y un solo `GuestData`, sin datos duplicados

3a. **Scenario**: Salida de un huésped ya registrado
   - **Given** un huésped con su `GuestData` y su `ENTRY` registrados
   - **When** la notificación de Check-Out trae a ese huésped, identificado por su `documentNumber`
   - **Then** el sistema registra el `DEPARTURE` en ese huésped, sin crear otro `GuestData` ni
     modificar el existente

4. **Scenario**: Reserva solo de huéspedes colombianos
   - **Given** una `Reservation` cuyos huéspedes son todos colombianos
   - **When** llega la notificación de Check-In con sus datos
   - **Then** el sistema registra sus movimientos, pero ninguno es extranjero, así que no entrarán al
     archivo SIRE

5. **Scenario**: Notificación repetida (idempotente)
   - **Given** movimientos ya registrados
   - **When** el Módulo 1 envía de nuevo la misma notificación
   - **Then** el sistema responde sin duplicar ni modificar los movimientos

---

### User Story 2 - Selección de Extranjeros para la Exportación SIRE (Priority: P2)

Cuando la Recepcionista solicita "Exportar archivo SIRE", el sistema recupera los movimientos del
periodo, **selecciona solo los de huéspedes extranjeros** y los entrega con toda la información de cada
huésped.

**Why this priority**: Es el consumo final de los datos procesados. No bloquea la operación diaria,
pero es necesario para cumplir el reporte periódico y no reportar a huéspedes colombianos.

**Independent Test**: Se solicitan los movimientos de un periodo con tres extranjeros y dos colombianos
y se verifica que se entreguen solo los tres extranjeros, con su tipo de movimiento y su fecha.

**Acceptance Scenarios**:

1. **Scenario**: Selección de extranjeros
   - **Given** `MigratoryMovement` de tipo `ENTRY` y `DEPARTURE` con `movementDate` en el periodo
     solicitado, de huéspedes colombianos y extranjeros
   - **When** "Exportar archivo SIRE" invoca este caso de uso
   - **Then** el sistema entrega solo los movimientos de los huéspedes cuya `nationality` es distinta de
     Colombia, con todos los datos del huésped, el tipo de movimiento y su fecha

2. **Scenario**: Periodo sin extranjeros
   - **Given** movimientos en el periodo, todos de huéspedes colombianos
   - **When** "Exportar archivo SIRE" invoca este caso de uso
   - **Then** el sistema entrega una lista vacía y "Exportar archivo SIRE" informa que no hay
     movimientos de extranjeros que reportar

### User Story 3 - Consulta de Huéspedes Alojados (Priority: P2)

La Recepcionista necesita ver qué personas se han alojado en el hotel, colombianas y extranjeras, con
los datos que envió el Módulo 1: quién está hoy en el hotel, quién ya salió, a qué reserva perteneció y
sus datos de identidad. Es una vista de **solo consulta**: no captura ni corrige datos, porque
esos son del Módulo 1. El listado, los filtros, la búsqueda y el detalle se consolidan en esta misma
historia de usuario.

**Why this priority**: Permite responder preguntas de recepción (por ejemplo, si un huésped sigue en el
hotel o cuándo salió) y verificar lo que envió el Módulo 1, sin depender del archivo SIRE, que solo
muestra extranjeros. No bloquea la operación diaria.

**Independent Test**: Se registran huéspedes colombianos y extranjeros en varias reservas, algunos con
salida y otros todavía en el hotel. Se abre la vista, se aplica cada filtro y la búsqueda, se abre el
detalle de un huésped y se verifica que los datos coinciden con los recibidos del Módulo 1 y que la
vista no permite modificar nada.

**Acceptance Scenarios**:

1. **Scenario**: Listado de huéspedes alojados (Happy Path)
   - **Given** huéspedes registrados en distintas reservas
   - **When** la Recepcionista abre la vista de huéspedes alojados
   - **Then** el sistema muestra la página 1 con hasta 10 huéspedes, ordenados por fecha de entrada de
     la más reciente a la más antigua, cada uno con su nombre, documento, nacionalidad (con la marca de
     extranjero cuando aplica), reserva, fecha de entrada y fecha de salida, o "En el hotel" si
     todavía no salió

2. **Scenario**: Filtrar por extranjeros o colombianos
   - **Given** huéspedes colombianos y extranjeros registrados
   - **When** la Recepcionista filtra por extranjeros
   - **Then** el sistema muestra solo los de nacionalidad distinta de Colombia; con el filtro de
     colombianos, solo los de nacionalidad Colombia

3. **Scenario**: Filtrar quién está en el hotel
   - **Given** huéspedes con entrada y sin salida, y otros con entrada y salida
   - **When** la Recepcionista filtra por "En el hotel"
   - **Then** el sistema muestra solo los que tienen entrada registrada y todavía no tienen salida; con
     "Ya salió", solo los que ya tienen salida

4. **Scenario**: Filtrar por periodo
   - **Given** huéspedes con estadías en distintas fechas
   - **When** la Recepcionista indica un rango de fechas
   - **Then** el sistema muestra los huéspedes cuya estadía se cruza con ese rango

5. **Scenario**: Búsqueda por documento o por nombre
   - **Given** un huésped registrado
   - **When** la Recepcionista busca por su número de documento, o por al menos 3 letras de su nombre o
     apellido
   - **Then** el sistema muestra las estadías de ese huésped (una por reserva); por documento, la
     coincidencia es exacta, y por nombre, parcial y sin distinguir mayúsculas ni tildes

6. **Scenario**: Detalle de un huésped
   - **Given** un huésped del listado
   - **When** la Recepcionista abre su detalle
   - **Then** el sistema muestra todos sus datos (tipo y número de documento, nombre, apellido, fecha de
     nacimiento, nacionalidad, procedencia y destino; si están vacíos, muestra una raya "—"), la
     reserva con un enlace a su detalle, y sus movimientos de entrada y salida con su fecha

7. **Scenario**: Sin resultados
   - **Given** filtros que ningún huésped cumple
   - **When** la Recepcionista los aplica
   - **Then** el sistema muestra el listado vacío con el mensaje "No hay huéspedes que coincidan con los
     filtros."

8. **Scenario**: Filtros inválidos (Error)
   - **Given** un rango de fechas invertido o mayor a un año, o una búsqueda por nombre de menos de 3
     caracteres
   - **When** la Recepcionista aplica los filtros
   - **Then** el sistema responde **HTTP 400** con el mensaje del filtro inválido, sin consultar

9. **Scenario**: Acceso de otros actores (Error)
   - **Given** la Ota, el Módulo 1 o el Módulo 3
   - **When** intentan usar esta vista
   - **Then** el sistema la rechaza con **HTTP 403**: la vista es exclusiva de la Recepcionista

### Casos Borde

- ¿Qué sucede si llega un `DEPARTURE` de un huésped sin `ENTRY` registrado? No debería ocurrir, porque
  el Módulo 1 siempre envía primero el Check-In con los datos del huésped.
- ¿Qué sucede si la notificación trae más huéspedes que el `guestCount` de la habitación? Se registran
  todos; la Recepcionista ve en la pantalla la cantidad de huéspedes que informó el Módulo 1.
- ¿Qué sucede si el mismo huésped viene repetido en la misma notificación? Se procesa una sola vez,
  por su `documentNumber`.
- ¿Qué sucede si los datos contienen caracteres no soportados o patrones maliciosos? El sistema sanea
  la entrada, la rechaza con **HTTP 400** y el mensaje "Caracteres no válidos en los datos de los
  huéspedes."
- ¿Qué sucede si la notificación llega vacía o sin el identificador de la reserva? El sistema
  responde con **HTTP 400** indicando que el payload es inválido, sin producir errores de
  infraestructura **HTTP 500**.
- ¿Qué sucede si el mismo huésped tiene más de una estadía? Cada estadía tiene sus propios
  movimientos: una notificación nueva nunca sobrescribe los movimientos de una estadía anterior.
- ¿Qué sucede si un huésped se hospeda en dos habitaciones de la misma reserva (cambio de habitación
  dentro de la estadía)? Sigue teniendo un solo `ENTRY` y un solo `DEPARTURE` por reserva: el
  movimiento es del huésped y la estadía, no de la habitación.
- ¿Qué sucede si un huésped tiene nacionalidad vacía? El Módulo 1 no la envía vacía; si llegara, el
  huésped no se trata como extranjero y no entra al archivo SIRE.
- ¿Cómo aparece en la vista un huésped que se ha alojado varias veces? Con una fila por cada estadía
  (cada reserva), porque cada una tiene sus propias fechas de entrada y salida.
- ¿Qué pasa en la vista con un huésped que tiene salida pero no entrada registrada? Aparece con su
  fecha de salida y la entrada vacía.
- ¿Qué pasa en la vista con una reserva cancelada o en `NO_SHOW`? Sus huéspedes no aparecen, porque
  nunca hubo Check-In ni movimientos.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe recibir los datos de los huéspedes dentro de las notificaciones de
  Check-In (`m2.habitacion.checkin.queue`) y de Check-Out (`m2.habitacion.checkout.queue`) del Módulo 1,
  como una lista `guests` con **todos** los huéspedes de la habitación, cada uno con sus `GuestData`.
  La notificación trae, a nivel de mensaje, el `movementType` (`ENTRY` en el Check-In, `DEPARTURE` en
  el Check-Out) y el `movementDate`, que valen para todos los huéspedes de la lista.
- **FR-002**: El sistema debe guardar los datos de cada huésped de la lista en `GuestData` y registrar
  un `MigratoryMovement` por cada uno, sea colombiano o extranjero.
- **FR-003**: El sistema debe identificar como extranjero a todo huésped cuya `nationality` sea
  distinta de `Colombia` (escrita exactamente así para los colombianos), sin guardar esa marca por
  separado.
- **FR-004**: El sistema debe dar por hecho que los datos de cada huésped llegan completos y correctos,
  porque el Módulo 1 los valida antes de enviarlos. El lugar de procedencia y el de destino solo son
  obligatorios para los extranjeros; para los colombianos pueden venir vacíos. No debe validarlos, completarlos ni corregirlos, y
  no debe devolverlos al Módulo 1.
- **FR-005**: El sistema debe registrar un `MigratoryMovement` por cada combinación de reserva,
  huésped (`documentNumber`) y `movementType`, sin sobrescribir los de otras estadías ni los del otro
  tipo de movimiento del mismo huésped. Un movimiento repetido no se duplica.
- **FR-017**: El sistema debe guardar los datos personales de cada huésped una sola vez por reserva y
  `documentNumber` (`GuestData`), sin copiarlos en cada movimiento. En el Check-Out debe identificar al
  huésped por su `documentNumber` y agregarle el `DEPARTURE`, sin modificar sus datos.
- **FR-006**: El sistema debe conservar el Check-In o el Check-Out y responder 200 al registrar los
  movimientos de la notificación.
- **FR-007**: El sistema debe procesar cada huésped de la lista de forma independiente.
- **FR-008**: El sistema debe entregar a "Exportar archivo SIRE" los movimientos del periodo
  **únicamente de huéspedes extranjeros**, con toda la información de cada huésped. Los movimientos de
  huéspedes colombianos se conservan, pero no se entregan.
- **FR-009**: El sistema no debe capturar, editar ni corregir datos de huéspedes desde una pantalla del
  Módulo 2: la captura y el procesamiento presencial son responsabilidad del Módulo 1. La vista de
  huéspedes alojados (FR-011 a FR-016) es solo de consulta.
- **FR-010**: El sistema debe interceptar los errores estructurales o de seguridad del payload (sin
  identificador de reserva, formato de payload inválido, caracteres maliciosos) y responder con
  **HTTP 400 (Bad Request)**, prohibiendo que escalen a **HTTP 500**.
- **FR-011**: El sistema debe ofrecer a la Recepcionista una vista de huéspedes alojados con una fila
  por huésped y reserva (`GuestStay`), armada a partir de sus `MigratoryMovement`: nombre y apellido,
  tipo y número de documento, nacionalidad con la marca de extranjero (nacionalidad distinta de
  Colombia), `reservationRef`, fecha de entrada y fecha de salida, o "En el hotel" si aún no tiene
  salida.
- **FR-012**: El sistema debe paginar el listado de a 10 filas, ordenado por fecha de entrada de la más
  reciente a la más antigua.
- **FR-013**: El sistema debe permitir filtrar, combinando los filtros con la regla "Y", por:
  nacionalidad (todos, extranjeros o colombianos), situación (todos, en el hotel o ya salió) y periodo
  (rango de fechas de máximo un año: la estadía se cruza con el rango), y buscar por número de
  documento (coincidencia exacta) o por nombre o apellido (coincidencia parcial, sin distinguir
  mayúsculas ni tildes, mínimo 3 caracteres).
- **FR-014**: El sistema debe mostrar el detalle de un huésped con todos sus `GuestData`, la reserva
  (con enlace a su detalle en "Consultar y buscar reservas") y sus movimientos de entrada y
  salida.
- **FR-015**: La vista debe ser de solo lectura y exclusiva de la Recepcionista; cualquier otro actor
  recibe **HTTP 403**. Con filtros inválidos debe responder **HTTP 400** con el mensaje correspondiente.
- **FR-016**: La vista no debe mostrar a los huéspedes de reservas sin Check-In (`CANCELLED`, `NO_SHOW`,
  `PENDING` o `ACTIVE` sin ingreso), porque no tienen movimientos.

### Non-Functional Requirements

- **NFR-001**: El registro de los datos no debe superar los 500 milisegundos por notificación, con
  hasta 10 huéspedes por notificación.
- **NFR-002**: Los datos personales de los huéspedes (documento y fecha de nacimiento) no deben escribirse
  en los registros de log.
- **NFR-003**: Una página de la vista de huéspedes alojados, con cualquier combinación de filtros, debe
  responder en menos de 1 segundo con hasta 50 000 movimientos registrados.

### Key Entities *(include if feature involves data)*

- **GuestData**: Datos de un huésped, colombiano o extranjero, capturados por el Módulo 1 y enviados
  en la lista `guests` de la notificación de Check-In o de Check-Out (cuyo `movementType` y
  `movementDate` van a nivel de mensaje y valen para todos). El Módulo 2 los guarda **una sola vez** por reserva. Atributos:
  `reservationRef`, `firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`,
  `nationality`, `originPlace` (lugar de procedencia) y `destinationPlace` (lugar de destino). SIRE
  exige los dos últimos para los extranjeros; para los colombianos pueden estar vacíos. Identidad única: (`reservationRef`, `documentNumber`).
  Se crea en el Check-In y no se modifica: el Check-Out solo agrega el `DEPARTURE`.
- **MigratoryMovement**: Movimiento de entrada o de salida de un huésped en una estadía, colombiano o
  extranjero. Solo los de extranjeros entran al archivo SIRE. Atributos: `movementId`, `reservationRef`,
  `documentNumber` (referencia a su `GuestData`), `guestRef` (solo si el huésped es el titular; los
  acompañantes no son `Guest` del Módulo 2), `movementType` (`ENTRY` | `DEPARTURE`) y `movementDate`
  (fecha sin hora: `checkInDate` en la entrada, `checkOutDate` en la salida). Los datos del huésped no se
  copian: se obtienen de su `GuestData`. Identidad única: (`reservationRef`, `documentNumber`,
  `movementType`).
- **GuestStay** (derivada, no se guarda): Fila de la vista de huéspedes alojados, una por huésped y
  reserva. Se arma con el `GuestData` del huésped y su `ENTRY` y `DEPARTURE` en esa reserva: datos del huésped,
  `reservationRef`, fecha de entrada (`movementDate` del `ENTRY`) y fecha de salida
  (`movementDate` del `DEPARTURE`, vacía si aún está en el hotel). Es extranjero si su `nationality` es
  distinta de Colombia.
- **Guest**: Titular de la reserva. Atributos: `id`, `firstName`, `lastName`, `documentNumber` y `nationality`.
- **Reservation**: Estadía asociada a los huéspedes. Atributos: `reservationRef`, `guestRef`,
  `guestCount` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los huéspedes notificados por el Módulo 1 quedan con su movimiento de entrada
  o de salida registrado.
- **SC-002**: El 100% de los registros entregados a "Exportar archivo SIRE" son de huéspedes extranjeros
  y corresponden a los movimientos recibidos del Módulo 1, sin modificaciones; ningún huésped colombiano
  llega al archivo.
- **SC-003**: Cero errores **HTTP 500** por payloads mal formados; el 100% se responde con
  **HTTP 400**.
- **SC-004**: Ningún huésped de un grupo queda sin registrar por el error de otro huésped de la misma
  notificación.
- **SC-005**: La Recepcionista encuentra a un huésped por su documento en la vista de huéspedes alojados
  en menos de 10 segundos, y el 100% de los huéspedes con Check-In aparecen en ella.
