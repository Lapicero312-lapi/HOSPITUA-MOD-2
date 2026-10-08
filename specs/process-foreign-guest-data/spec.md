# Feature Specification: Procesar Datos de Huéspedes Extranjeros

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
cada uno y, al exportar, seleccione los extranjeros.

**Qué hace el Módulo 1 y qué hace el Módulo 2**: el Módulo 1 captura y valida los datos de todos los
ocupantes y asigna por su cuenta el tipo de movimiento y su fecha, sin pedírselos a la Recepcionista:
`ENTRY` con la fecha de llegada (`checkInDate`) en el Check-In, y `DEPARTURE` con la fecha de salida
(`checkOutDate`) en el Check-Out, ambas solo fecha, sin hora. **El Módulo 2 da por hecho que los datos
llegan completos y correctos**: el Módulo 1 no envía a un huésped al que le falte algún dato. El Módulo
2 no captura, no valida ni completa nada: recibe los datos de cada huésped (tipo y número de documento,
fecha de nacimiento, nombre, apellido, nacionalidad, lugar de procedencia, lugar de destino y tipo de
movimiento), los guarda y, al exportar, selecciona los extranjeros y los empaqueta en el archivo `.TXT`.

### Flujo de Usuario de Alto Nivel

1. El **Módulo 1** notifica el **Check-In** de una habitación de una reserva (cola
   `m2.habitacion.checkin.queue`) con la `reservationRef`, el `roomId` y la lista `guests` con **todos
   los huéspedes** que ingresaron a esa habitación, cada uno con sus `GuestData` (los diez campos),
   `movementType` `ENTRY` y su `movementDate`. El cambio de estado de la habitación y de la reserva lo
   ejecuta "Actualizar reservación".
2. El Módulo 1 notifica el **Check-Out** de una habitación (cola `m2.habitacion.checkout.queue`) con la
   `reservationRef`, el `roomId` y la lista `guests` con todos los huéspedes que salieron de esa
   habitación, con `movementType` `DEPARTURE` y su `movementDate`.
3. Por cada huésped de la lista, el sistema registra un `MigratoryMovement`, sea colombiano o extranjero.
   Hay un movimiento por cada combinación de reserva, huésped y tipo de movimiento: un huésped que
   ingresa y sale tiene dos, uno `ENTRY` y uno `DEPARTURE`.
4. El sistema identifica como **extranjero** a todo huésped cuya `nationality` sea distinta de Colombia.
   Esta marca se deduce de la nacionalidad y no se guarda aparte.
5. Solo un payload inutilizable (sin identificador de reserva o con caracteres maliciosos) se rechaza
   con **HTTP 400 (Bad Request)** sin registrar nada.
6. Cuando "Exportar archivo SIRE" (ejecutado por la Recepcionista) necesita los datos, invoca este caso de
   uso para obtener los movimientos del periodo. El caso de uso **selecciona únicamente los de
   huéspedes extranjeros** y deja fuera a los colombianos.

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
     `ENTRY`; cada huésped queda con dos movimientos

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

### Casos Borde

- ¿Qué sucede si llega un `DEPARTURE` de un huésped sin `ENTRY` registrado? Se registra normalmente
  y queda disponible para el reporte; no bloquea nada.
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

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe recibir los datos de los huéspedes dentro de las notificaciones de
  Check-In (`m2.habitacion.checkin.queue`) y de Check-Out (`m2.habitacion.checkout.queue`) del Módulo 1,
  como una lista `guests` con **todos** los huéspedes de la habitación, cada uno con sus `GuestData`,
  su `movementType` (`ENTRY` en el Check-In, `DEPARTURE` en el Check-Out) y su `movementDate`.
- **FR-002**: El sistema debe registrar un `MigratoryMovement` por cada huésped de la lista, sea
  colombiano o extranjero.
- **FR-003**: El sistema debe identificar como extranjero a todo huésped cuya `nationality` sea
  distinta de Colombia, sin guardar esa marca por separado.
- **FR-004**: El sistema debe dar por hecho que los datos de cada huésped llegan completos y correctos,
  porque el Módulo 1 los valida antes de enviarlos. No debe validarlos, completarlos ni corregirlos, y
  no debe devolverlos al Módulo 1.
- **FR-005**: El sistema debe registrar un `MigratoryMovement` por cada combinación de reserva,
  huésped (`documentNumber`) y `movementType`, sin sobrescribir los de otras estadías ni los del otro
  tipo de movimiento del mismo huésped. Un movimiento repetido no se duplica.
- **FR-006**: El sistema debe conservar el Check-In o el Check-Out y responder 200 al registrar los
  movimientos de la notificación.
- **FR-007**: El sistema debe procesar cada huésped de la lista de forma independiente.
- **FR-008**: El sistema debe entregar a "Exportar archivo SIRE" los movimientos del periodo
  **únicamente de huéspedes extranjeros**, con toda la información de cada huésped. Los movimientos de
  huéspedes colombianos se conservan, pero no se entregan.
- **FR-009**: El sistema no debe capturar datos de huéspedes desde una pantalla propia del Módulo 2: la
  captura y el procesamiento presencial son responsabilidad del Módulo 1.
- **FR-010**: El sistema debe interceptar los errores estructurales o de seguridad del payload (sin
  identificador de reserva, formato de payload inválido, caracteres maliciosos) y responder con
  **HTTP 400 (Bad Request)**, prohibiendo que escalen a **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El registro de los datos no debe superar los 500 milisegundos por notificación, con
  hasta 10 huéspedes por notificación.
- **NFR-002**: Los datos personales de los huéspedes (documento y fecha de nacimiento) no deben escribirse
  en los registros de log.

### Key Entities *(include if feature involves data)*

- **GuestData**: Datos ya procesados de un huésped, colombiano o extranjero, capturados por el Módulo 1
  y enviados en la notificación de Check-In o de Check-Out. Atributos: `firstName`, `lastName`,
  `documentType`, `documentNumber`, `birthDate`, `nationality`, `movementType` (`ENTRY` | `DEPARTURE`),
  `movementDate` (fecha sin hora: `checkInDate` en la entrada, `checkOutDate` en la salida),
  `originPlace` (lugar de procedencia) y `destinationPlace` (lugar de destino). SIRE exige los dos
  últimos para los extranjeros. Es propiedad del Módulo 1 y esta funcionalidad no lo modifica; el
  Módulo 2 guarda una copia en cada `MigratoryMovement`.
- **MigratoryMovement**: Movimiento de entrada o de salida de un huésped en una estadía, colombiano o
  extranjero. Solo los de extranjeros entran al archivo SIRE. Atributos: `movementId`, `reservationRef`,
  `guestRef` (solo si el huésped es el titular; los acompañantes no son `Guest` del Módulo 2),
  `movementType` (`ENTRY` | `DEPARTURE`), `movementDate`, los datos copiados de `GuestData`
  (`firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`, `nationality`,
  `originPlace`, `destinationPlace`). Identidad única: (`reservationRef`, `documentNumber`,
  `movementType`).
- **Guest**: Titular de la reserva. Atributos: `id`, `firstName`, `lastName`, `documentNumber` y `nationality`.
- **Reservation**: Estadía asociada a los huéspedes. Atributos: `reservationRef`, `guestRef`,
  `guestCount` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Se referencia solo como contexto de los mensajes del Módulo 1 (`roomId` de la
  habitación del Check-In o del Check-Out). Atributos: `id`, `status` (`Available` | `Reserved` |
  `Occupied`). Esta funcionalidad no modifica su estado.

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
