# Feature Specification: Procesar Datos de Huéspedes Extranjeros

**Created**: 2026-09-23
**Updated**: 2026-10-04

## Use Case (Caso de Uso)

### Descripción del problema

La ley exige reportar a Migración Colombia los huéspedes extranjeros que aloja el hotel, con su
información migratoria completa y el tipo de movimiento: **entrada** (cuando ingresan al hotel) y
**salida** (cuando lo dejan). Esos datos se capturan en persona, en el Check-In y en el Check-Out, y
por eso los procesa el Módulo 1, que es quien opera la recepción física. El Módulo 1 los envía al
Módulo 2 **ya procesados y completos**, por una cola propia de huéspedes extranjeros, separada de las
notificaciones de Check-In y de Check-Out; el Módulo 2 no tiene una pantalla propia para pedirlos ni los completa ni los corrige. La Recepcionista
luego genera con esos datos el archivo `.TXT` y lo envía a Migración (ver "Exportar archivo SIRE").

Una reserva puede alojar a varios huéspedes extranjeros (un grupo o una familia), y todos deben
reportarse, no solo el titular de la reserva. El negocio necesita un procesamiento que reciba los
datos migratorios de cada huésped extranjero (`ForeignGuestData`) y registre un movimiento migratorio
(`MigratoryMovement`) de entrada o de salida por cada huésped, dejándolos listos para "Exportar
archivo SIRE".

**Qué hace el Módulo 1 y qué hace el Módulo 2**: el Módulo 1 identifica a los ocupantes extranjeros
(nacionalidad distinta de Colombia), captura y valida sus datos, y asigna por su cuenta el tipo de
movimiento y su fecha, sin pedírselos a la Recepcionista: `ENTRY` con la fecha de llegada
(`checkInDate`) en el Check-In, y `DEPARTURE` con la fecha de salida (`checkOutDate`) en el
Check-Out, ambas solo fecha, sin hora. **El Módulo 2 da por hecho que los datos llegan completos y
correctos**: el Módulo 1 no arma ni envía el paquete si le falta algún dato. El Módulo 2 no captura,
no valida ni completa nada: recibe los datos ya procesados de cada huésped (tipo y número de
documento, fecha de nacimiento, nombre, apellido, nacionalidad, lugar de procedencia, lugar de
destino y tipo de movimiento), los guarda y luego los empaqueta en el archivo `.TXT`.

### Flujo de Usuario de Alto Nivel

1. El **Módulo 1** notifica el **Check-In** de una habitación de una reserva (cola
   `m2.habitacion.checkin.queue`, con `reservationRef`, `roomId` y `foreignGuestCount`, la cantidad de
   extranjeros que ingresan). El cambio de estado de la habitación y de la reserva lo ejecuta
   "Actualizar reservación".
2. Por **cada huésped extranjero** que ingresó a esa habitación, el Módulo 1 envía **un mensaje** por la
   cola `m2.huespedes.extranjeros.queue`, con `reservationRef`, `roomId`, sus `ForeignGuestData`,
   `movementType` `ENTRY` y su `movementDate`. Los mensajes de los extranjeros pueden llegar antes o
   después de la notificación de Check-In: el sistema los asocia por `reservationRef`.
3. El Módulo 1 notifica el **Check-Out** de una habitación (cola `m2.habitacion.checkout.queue`) y envía
   un mensaje por cada huésped extranjero que salió, con `movementType` `DEPARTURE` y su `movementDate`.
4. Por cada mensaje de un huésped extranjero, el sistema registra un `MigratoryMovement`. Hay un movimiento por
   cada combinación de reserva, huésped y tipo de movimiento: un huésped que ingresa y sale tiene
   dos, uno `ENTRY` y uno `DEPARTURE`.
5. Si la notificación indica `foreignGuestCount` en cero (por ejemplo, una reserva de huéspedes
   colombianos), no llega ningún mensaje de extranjeros y el sistema no registra ni exige nada.
   El Check-In y el Check-Out nunca esperan los mensajes de los extranjeros.
6. Solo un payload inutilizable (sin identificador de reserva o con caracteres maliciosos) se rechaza
   con **HTTP 400 (Bad Request)** sin registrar nada.
7. Cuando "Exportar archivo SIRE" (ejecutado por la Recepcionista) necesita los datos, invoca este
   caso de uso para obtener los movimientos del periodo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recepción de Datos Migratorios Procesados por el Módulo 1 (Priority: P1)

El sistema recibe, por la cola de huéspedes extranjeros del Módulo 1, los datos migratorios ya
procesados de cada huésped extranjero (un mensaje por huésped) y los registra como
`MigratoryMovement` de entrada o de salida. El camino exitoso, los grupos, los reenvíos duplicados y
los huéspedes colombianos se consolidan en esta misma historia de usuario.

**Why this priority**: Sin estos datos consolidados, el hotel no puede cumplir con el reporte
migratorio obligatorio. Recibirlos del Módulo 1 evita duplicar pantallas de captura
en el Módulo 2.

**Independent Test**: Se envían dos mensajes de huéspedes extranjeros con `ENTRY` y se verifica que
queden dos movimientos `ENTRY`. Se envían los dos con `DEPARTURE` y se verifica que queden dos
movimientos `DEPARTURE`. Se reenvían los mismos mensajes y se verifica que no se duplican.

**Acceptance Scenarios**:

1. **Scenario**: Movimiento de entrada de un huésped (Happy Path)
   - **Given** una `Reservation` cuyo titular es extranjero, en Check-In
   - **When** el sistema recibe el mensaje del Módulo 1 con un huésped y `movementType` `ENTRY`
   - **Then** el sistema registra un `MigratoryMovement` `ENTRY`, disponible para "Exportar archivo
     SIRE"

2. **Scenario**: Grupo de extranjeros en una misma reserva
   - **Given** una `Reservation` con 3 personas, de las cuales 2 son extranjeras
   - **When** el Módulo 1 envía los mensajes de los 2 huéspedes extranjeros
   - **Then** el sistema registra dos `MigratoryMovement` `ENTRY`, uno por cada huésped, y no registra
     ninguno para la persona colombiana

3. **Scenario**: Movimiento de salida (Happy Path)
   - **Given** un huésped con su movimiento `ENTRY` registrado
   - **When** el Módulo 1 envía el mensaje de ese huésped con `movementType` `DEPARTURE` y su
     fecha
   - **Then** el sistema registra un `MigratoryMovement` `DEPARTURE` sin modificar el `ENTRY`; el
     huésped queda con dos movimientos

4. **Scenario**: Reserva de huéspedes colombianos
   - **Given** una `Reservation` cuyo titular es colombiano
   - **When** la notificación de Check-In llega con `foreignGuestCount` en cero
   - **Then** el sistema omite el procesamiento migratorio y no exige ningún dato

5. **Scenario**: Notificación repetida (idempotente)
   - **Given** un `MigratoryMovement` ya registrado
   - **When** el Módulo 1 envía de nuevo el mismo mensaje
   - **Then** el sistema responde 200 sin duplicar ni modificar el movimiento

---

### User Story 2 - Entrega de Registros Migratorios para la Exportación SIRE (Priority: P2)

Cuando la Recepcionista solicita "Exportar archivo SIRE", el sistema recupera los movimientos
migratorios del periodo y los entrega con toda la información de cada huésped.

**Why this priority**: Es el consumo final de los datos procesados. No bloquea la operación diaria,
pero es necesario para cumplir el reporte periódico.

**Independent Test**: Se solicitan los movimientos de un periodo con tres huéspedes extranjeros y se
verifica que se entreguen los tres, con su tipo de movimiento y su fecha.

**Acceptance Scenarios**:

1. **Scenario**: Entrega de registros
   - **Given** `MigratoryMovement` de tipo `ENTRY` y `DEPARTURE` con `movementDate` en el periodo
     solicitado
   - **When** "Exportar archivo SIRE" invoca este caso de uso
   - **Then** el sistema entrega los movimientos con todos los `ForeignGuestData` del huésped, el
     tipo de movimiento y su fecha

### Casos Borde

- ¿Qué sucede si llega un `DEPARTURE` de un huésped sin `ENTRY` registrado? Se registra normalmente
  y queda disponible para el reporte; no bloquea nada.
- ¿Qué sucede si llegan más huéspedes extranjeros que el `guestCount` de la reserva o que el
  `foreignGuestCount` del Check-In? Se registran todos. El `foreignGuestCount` es solo informativo: el
  sistema lo guarda en la habitación y la Recepcionista lo ve en la pantalla, junto a los extranjeros
  ya registrados, pero no se usa para validar ni para esperar mensajes.
- ¿Qué sucede si el mensaje de un huésped llega antes que el Check-In de su habitación? Se registra
  igual, porque el movimiento se asocia por `reservationRef`. Si la reserva todavía no se puede
  localizar, el mensaje se reintenta con espera creciente y, agotados los reintentos, va a la
  dead-letter queue.
- ¿Qué sucede si el mismo huésped viene repetido? Se procesa una sola vez, por su `documentNumber`.
- ¿Qué sucede si los datos migratorios contienen caracteres no soportados o patrones maliciosos? El
  sistema sanea la entrada, la rechaza con **HTTP 400** y el mensaje "Caracteres no válidos en los
  datos migratorios."
- ¿Qué sucede si un mensaje llega vacío o sin el identificador de la reserva? El sistema
  responde con **HTTP 400** indicando que el payload es inválido, sin producir errores de
  infraestructura **HTTP 500**.
- ¿Qué sucede si el mismo huésped tiene más de una estadía? Cada estadía tiene sus propios
  movimientos: una notificación nueva nunca sobrescribe los movimientos de una estadía anterior.
- ¿Qué sucede si un huésped extranjero se hospeda en dos habitaciones de la misma reserva
  (cambio de habitación dentro de la estadía)? Sigue teniendo un solo `ENTRY` y un solo `DEPARTURE`
  por reserva: el movimiento es del huésped y la estadía, no de la habitación.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe recibir los datos migratorios ya procesados por la cola
  `m2.huespedes.extranjeros.queue`, con un mensaje por huésped extranjero que lleva `messageId`,
  `sequenceNumber`, `reservationRef`, `roomId`, sus `ForeignGuestData`, su `movementType` (`ENTRY` en
  el Check-In, `DEPARTURE` en el Check-Out) y su `movementDate`. Los descarta si su `messageId` ya
  se procesó.
- **FR-002**: El sistema no debe exigir datos migratorios cuando la reserva tiene titular colombiano
  y no llegan mensajes de extranjeros; sí debe registrar los huéspedes extranjeros cuyos mensajes
  lleguen aunque el titular sea colombiano.
- **FR-003**: El sistema debe dar por hecho que los datos migratorios de cada huésped llegan
  completos y correctos, porque el Módulo 1 los valida antes de enviarlos. No debe validarlos,
  completarlos ni corregirlos, y no debe devolverlos al Módulo 1.
- **FR-004**: El sistema debe registrar un `MigratoryMovement` por cada combinación de reserva,
  huésped (`documentNumber`) y `movementType`, sin sobrescribir los de otras estadías ni los del
  otro tipo de movimiento del mismo huésped. Un movimiento repetido no se duplica.
- **FR-005**: El sistema debe conservar el Check-In o el Check-Out y responder 200 al registrar los
  movimientos de los mensajes recibidos.
- **FR-006**: El sistema debe procesar cada mensaje de huésped de forma independiente, sin esperar el
  Check-In ni el Check-Out de su habitación.
- **FR-007**: El sistema debe entregar a "Exportar archivo SIRE" los movimientos del periodo, con
  toda la información de cada huésped.
- **FR-008**: El sistema no debe capturar datos migratorios desde una pantalla propia del Módulo 2:
  la captura y el procesamiento presencial son responsabilidad del Módulo 1.
- **FR-009**: El sistema debe interceptar los errores estructurales o de seguridad del payload (sin
  identificador de reserva, formato de payload inválido, caracteres maliciosos) y responder con
  **HTTP 400 (Bad Request)**, prohibiendo que escalen a **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El registro de los datos migratorios no debe superar los 500 milisegundos por
  notificación, por mensaje de huésped.
- **NFR-002**: Los datos migratorios (documento y fecha de nacimiento) no deben escribirse en los
  registros de log.

### Key Entities *(include if feature involves data)*

- **ForeignGuestData**: Datos migratorios ya procesados de un huésped extranjero, capturados por el
  Módulo 1 y enviados en su propio mensaje. Atributos: `firstName`, `lastName`, `documentType`,
  `documentNumber`, `birthDate`, `nationality`, `movementType` (`ENTRY` | `DEPARTURE`),
  `movementDate` (fecha sin hora: `checkInDate` en la entrada, `checkOutDate` en la salida),
  `originPlace` (lugar de procedencia) y `destinationPlace` (lugar de destino). SIRE exige los dos
  últimos y rechaza el registro si vienen vacíos.
  Es propiedad del Módulo 1 y esta funcionalidad no lo modifica; el Módulo 2 guarda una copia en cada
  `MigratoryMovement`.
- **MigratoryMovement**: Movimiento migratorio de un huésped extranjero en una estadía. Atributos:
  `movementId`, `reservationRef`, `guestRef` (solo si el huésped es el titular; los acompañantes no
  son `Guest` del Módulo 2), `movementType` (`ENTRY` | `DEPARTURE`), `movementDate`, los datos
  migratorios copiados de `ForeignGuestData` (`firstName`, `lastName`, `documentType`,
  `documentNumber`, `birthDate`, `nationality`, `originPlace`, `destinationPlace`).
  Identidad única: (`reservationRef`, `documentNumber`, `movementType`).
- **Guest**: Titular de la reserva. Atributos: `id`, `firstName`, `lastName`, `documentNumber` y `nationality`.
- **Reservation**: Estadía asociada a los huéspedes. Atributos: `reservationRef`, `guestRef`,
  `guestCount` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Se referencia solo como contexto de la notificación del Módulo 1 (`roomId` de la
  habitación del Check-In o del Check-Out). Atributos: `id`, `status` (`Available` | `Reserved` |
  `Occupied`). Esta funcionalidad no modifica su estado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los huéspedes extranjeros notificados por el Módulo 1 quedan con su
  movimiento de entrada o de salida registrado.
- **SC-002**: El 100% de los registros entregados a "Exportar archivo SIRE" corresponden a los
  movimientos recibidos del Módulo 1, sin modificaciones.
- **SC-003**: Cero errores **HTTP 500** por payloads mal formados; el 100% se responde con
  **HTTP 400**.
- **SC-004**: Ningún huésped extranjero de un grupo queda sin reportar por el error de otro huésped
  de la misma habitación.
