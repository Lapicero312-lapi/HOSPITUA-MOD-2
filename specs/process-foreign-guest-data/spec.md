# Feature Specification: Procesar Datos de Huéspedes Extranjeros

**Created**: 2026-09-23
**Updated**: 2026-09-29

## Use Case (Caso de Uso)

### Descripción del problema

La ley exige reportar a Migración Colombia los huéspedes extranjeros que aloja el hotel, con su
información migratoria completa y el tipo de movimiento: **entrada** (cuando ingresan al hotel) y
**salida** (cuando lo dejan). Esos datos se capturan en persona, en el Check-In y en el Check-Out, y
por eso los procesa el Módulo 1, que es quien opera la recepción física. El Módulo 1 los envía al
Módulo 2 **ya procesados**, dentro de las notificaciones de Check-In y de Check-Out; el Módulo 2 no
tiene una pantalla propia para pedirlos ni los completa. La Recepcionista luego genera con esos datos
el archivo `.TXT` y lo envía a Migración (ver "Exportar archivo SIRE").

Una reserva puede alojar a varios huéspedes extranjeros (un grupo o una familia), y todos deben
reportarse, no solo el titular de la reserva. El negocio necesita un procesamiento que reciba los
datos migratorios de cada huésped extranjero (`ForeignGuestData`), verifique que vengan completos, y
registre un movimiento migratorio (`MigratoryMovement`) de entrada o de salida por cada huésped,
dejándolos listos para "Exportar archivo SIRE".

**Qué hace el Módulo 1 y qué hace el Módulo 2**: el Módulo 1 identifica a los ocupantes extranjeros
(nacionalidad distinta de Colombia), captura y valida sus datos, y asigna por su cuenta el tipo de
movimiento y su fecha, sin pedírselos a la Recepcionista: `ENTRY` con la fecha de llegada
(`checkInDate`) en el Check-In, y `DEPARTURE` con la fecha de salida (`checkOutDate`) en el
Check-Out, ambas solo fecha, sin hora. El Módulo 1 no arma ni envía el paquete si le falta algún dato.
El Módulo 2 no captura ni completa nada: recibe los datos ya procesados de cada huésped (tipo y número
de documento, fecha de nacimiento, nombre, apellido, nacionalidad, lugar de procedencia, lugar de
destino y tipo de movimiento), los guarda y luego los empaqueta en el archivo `.TXT`. Un movimiento
guardado en el Módulo 2 siempre está completo: no existe un estado "incompleto".

### Flujo de Usuario de Alto Nivel

1. El **Módulo 1** notifica el **Check-In** de una habitación de una reserva e incluye en la misma
   notificación la lista de los huéspedes extranjeros que ingresaron a esa habitación
   (`foreignGuests`), cada uno con sus `ForeignGuestData` y con `movementType` `ENTRY` y su
   `movementDate`. El cambio de estado de la habitación y de la reserva lo ejecuta "Actualizar
   reservación".
2. El Módulo 1 notifica el **Check-Out** de una habitación e incluye la lista de los huéspedes
   extranjeros que salieron de esa habitación, cada uno con `movementType` `DEPARTURE` y su
   `movementDate`.
3. Por cada huésped de la lista, el sistema verifica que traiga todos los campos obligatorios.
4. Si el huésped está completo, el sistema registra un `MigratoryMovement`. Hay un movimiento por cada
   combinación de reserva, huésped y tipo de movimiento: un huésped que ingresa y sale tiene dos, uno
   `ENTRY` y uno `DEPARTURE`.
5. Si a un huésped le falta algún campo obligatorio o algún dato es inválido, el sistema **no registra
   su movimiento y se lo devuelve al Módulo 1** (`MigratoryDataReturned`), indicando la reserva, el
   huésped, los campos faltantes o inválidos y el motivo. El Módulo 1 debe volver a enviar los datos de
   ese huésped ya completos. El Módulo 2 no completa ni corrige nada. El Check-In o el Check-Out físico
   ya ocurrió, así que el cambio de estado de la reserva se conserva y la respuesta a la notificación
   es 200. Los demás huéspedes de la misma notificación se registran normalmente. La devolución queda
   anotada como una `ReconciliationIncident` `OPEN`, que pasa a `RESOLVED` cuando el Módulo 1 reenvía
   al huésped completo y el movimiento se registra. Solo un payload inutilizable (sin identificador
   de reserva o con caracteres maliciosos) se rechaza con **HTTP 400 (Bad Request)** sin registrar
   nada.
6. Si el titular de la reserva es extranjero (`Guest.type` `FOREIGN`) y la notificación llega sin
   ningún dato migratorio suyo, el sistema devuelve al Módulo 1 la notificación indicando que falta el
   titular, y el Módulo 1 debe reenviarla con sus datos.
7. Cuando "Exportar archivo SIRE" (ejecutado por la Recepcionista) necesita los datos, invoca este
   caso de uso para obtener los movimientos del periodo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recepción de Datos Migratorios Procesados por el Módulo 1 (Priority: P1)

El sistema recibe, dentro de las notificaciones de Check-In y de Check-Out del Módulo 1, los datos
migratorios ya procesados de cada huésped extranjero y los registra como `MigratoryMovement` de
entrada o de salida. Por tratarse de un único paso integrado con esas notificaciones, el camino
exitoso, los grupos, los datos ausentes, los reenvíos y los huéspedes nacionales se consolidan en
esta misma historia de usuario.

**Why this priority**: Sin estos datos consolidados, el hotel no puede cumplir con el reporte
migratorio obligatorio. Recibirlos en las mismas notificaciones evita duplicar pantallas de captura
en el Módulo 2.

**Independent Test**: Se envía una notificación simulada de Check-In con dos huéspedes extranjeros
completos y se verifica que queden dos movimientos `ENTRY`. Se envía el Check-Out y se verifica que
queden dos movimientos `DEPARTURE`. Se repite omitiendo un dato de uno de ellos y se confirma que no
se registra su movimiento, que se le devuelve al Módulo 1 con el campo faltante y que el otro
huésped sí queda registrado. Se reenvía completo y se verifica que ahora sí se registra.

**Acceptance Scenarios**:

1. **Scenario**: Movimiento de entrada de un huésped (Happy Path)
   - **Given** una `Reservation` cuyo titular es extranjero, en Check-In
   - **When** el sistema recibe la notificación del Módulo 1 con un huésped con todos sus datos
     migratorios y `movementType` `ENTRY`
   - **Then** el sistema registra un `MigratoryMovement` `ENTRY`, disponible para "Exportar archivo
     SIRE"

2. **Scenario**: Grupo de extranjeros en una misma reserva
   - **Given** una `Reservation` con 3 personas, de las cuales 2 son extranjeras
   - **When** la notificación de Check-In trae a los 2 huéspedes extranjeros
   - **Then** el sistema registra dos `MigratoryMovement` `ENTRY`, uno por cada huésped, y no registra
     ninguno para la persona nacional

3. **Scenario**: Movimiento de salida (Happy Path)
   - **Given** un huésped con su movimiento `ENTRY` registrado
   - **When** la notificación de Check-Out trae a ese huésped con `movementType` `DEPARTURE` y su
     fecha
   - **Then** el sistema registra un `MigratoryMovement` `DEPARTURE` sin modificar el `ENTRY`; el
     huésped queda con dos movimientos

4. **Scenario**: Huésped al que le falta un dato obligatorio
   - **Given** una notificación de Check-In con un huésped sin fecha de nacimiento
   - **When** el sistema la procesa
   - **Then** el sistema no registra su movimiento y se lo devuelve al Módulo 1 indicando el campo
     faltante `["birthDate"]`, conserva el cambio de estado del Check-In y responde 200; los demás
     huéspedes de la misma notificación se registran normalmente

5. **Scenario**: Titular extranjero sin ningún dato migratorio
   - **Given** una `Reservation` cuyo titular es `FOREIGN`
   - **When** la notificación de Check-In llega sin `foreignGuests`
   - **Then** el sistema devuelve al Módulo 1 la notificación indicando que falta el titular,
     conserva el Check-In y responde 200

6. **Scenario**: Reserva de huéspedes nacionales
   - **Given** una `Reservation` cuyo titular es `NATIONAL`
   - **When** la notificación de Check-In llega sin `foreignGuests`
   - **Then** el sistema omite el procesamiento migratorio y no exige ningún dato

7. **Scenario**: Reenvío del Módulo 1 con los datos completos
   - **Given** un huésped cuyos datos se devolvieron al Módulo 1 por estar incompletos
   - **When** el Módulo 1 reenvía la notificación con los datos completos de ese huésped y tipo de
     movimiento
   - **Then** el sistema no cambia el estado de la reserva ni de la habitación, registra ese
     movimiento, marca la incidencia como `RESOLVED` y responde 200

8. **Scenario**: Reenvío de un movimiento ya registrado (idempotente)
   - **Given** un `MigratoryMovement` ya registrado
   - **When** el Módulo 1 envía de nuevo los mismos datos
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

- ¿Qué sucede si la fecha del movimiento es futura o la de nacimiento no es pasada? Se trata como un
  dato inválido: el sistema no registra el movimiento y lo devuelve al Módulo 1 con el motivo "La
  fecha de movimiento migratorio no puede ser futura" (o el que corresponda), y responde 200.
- ¿Qué sucede si el `movementType` de la notificación no corresponde al evento (un `DEPARTURE` en un
  Check-In, o un `ENTRY` en un Check-Out)? No se registra el movimiento y se devuelve al Módulo 1 con
  el campo `movementType` como inválido, y responde 200.
- ¿Qué sucede si llega un `DEPARTURE` de un huésped sin `ENTRY` registrado? Se registra normalmente:
  el Check-In pudo haber ocurrido antes de que existiera el reporte o haberse perdido. Queda
  disponible para el reporte y no bloquea nada.
- ¿Qué sucede si la fecha de salida es anterior a la de entrada del mismo huésped? No se registra el
  `DEPARTURE` y se devuelve al Módulo 1 con el motivo "La fecha de salida no puede ser anterior a la
  de entrada".
- ¿Qué sucede si la notificación trae más huéspedes extranjeros que el `guestCount` de la reserva? Se
  registran todos y se crea una `ReconciliationIncident` (`CHECK_IN` o `CHECK_OUT`) para que una
  persona revise la discrepancia con el Módulo 1.
- ¿Qué sucede si el mismo huésped viene repetido en la misma notificación? Se procesa una sola vez,
  por su `documentNumber`.
- ¿Qué sucede si los datos migratorios contienen caracteres no soportados o patrones maliciosos? El
  sistema sanea la entrada, la rechaza con **HTTP 400** y el mensaje "Caracteres no válidos en los
  datos migratorios."
- ¿Qué sucede si la notificación llega vacía o sin el identificador de la reserva? El sistema
  responde con **HTTP 400** indicando que el payload es inválido, sin producir errores de
  infraestructura **HTTP 500**.
- ¿Qué sucede si el mismo huésped tiene más de una estadía? Cada estadía tiene sus propios
  movimientos: una notificación nueva nunca sobrescribe los movimientos de una estadía anterior.
- ¿Qué sucede si un huésped extranjero se hospeda en dos habitaciones de la misma reserva
  (cambio de habitación dentro de la estadía)? Sigue teniendo un solo `ENTRY` y un solo `DEPARTURE`
  por reserva: el movimiento es del huésped y la estadía, no de la habitación.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe recibir los datos migratorios ya procesados dentro de las
  notificaciones de Check-In y de Check-Out del Módulo 1, como una lista de huéspedes extranjeros
  (`foreignGuests`), cada uno con sus `ForeignGuestData`, su `movementType` (`ENTRY` en el Check-In,
  `DEPARTURE` en el Check-Out) y su `movementDate`.
- **FR-002**: El sistema no debe exigir datos migratorios cuando la reserva tiene titular `NATIONAL`
  y la notificación no trae huéspedes extranjeros; sí debe registrar los huéspedes extranjeros que la
  notificación traiga aunque el titular sea nacional.
- **FR-003**: El sistema debe verificar, por cada huésped, que los datos obligatorios estén presentes
  (`firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`, `nationality`,
  `movementType`, `movementDate`, `originPlace`, `destinationPlace`), con una fecha de nacimiento
  pasada y con una fecha de movimiento no futura. No debe completar ni corregir ningún dato.
- **FR-004**: El sistema debe registrar un `MigratoryMovement` por cada combinación de reserva,
  huésped (`documentNumber`) y `movementType`, sin sobrescribir los de otras estadías ni los del
  otro tipo de movimiento del mismo huésped.
- **FR-005**: El sistema no debe registrar el movimiento de un huésped cuyos datos falten o sean
  inválidos: debe devolverlo al Módulo 1 (`MigratoryDataReturned`) con la reserva, el huésped, los
  campos faltantes o inválidos y el motivo, dejar la devolución anotada como `ReconciliationIncident`
  `OPEN`, conservar el Check-In o el Check-Out y responder 200. El Módulo 1 debe reenviar al huésped
  con los datos completos; ese reenvío debe registrar el movimiento, marcar la incidencia como
  `RESOLVED` y ser idempotente.
- **FR-006**: El sistema debe procesar cada huésped de la lista de forma independiente: el error de
  un huésped no debe impedir registrar a los demás de la misma notificación.
- **FR-007**: El sistema debe devolver al Módulo 1 la notificación cuando el titular es `FOREIGN` y el
  Check-In o el Check-Out llega sin sus datos migratorios, para que la reenvíe con ellos.
- **FR-008**: El sistema debe entregar a "Exportar archivo SIRE" los movimientos del periodo, con
  toda la información de cada huésped.
- **FR-009**: El sistema no debe capturar datos migratorios desde una pantalla propia del Módulo 2:
  la captura y el procesamiento presencial son responsabilidad del Módulo 1.
- **FR-010**: El sistema debe interceptar los errores lógicos, estructurales o de seguridad del
  payload (sin identificador de reserva, formato de payload inválido, caracteres maliciosos) y
  responder con **HTTP 400 (Bad Request)**, prohibiendo que escalen a **HTTP 500**. Los datos
  migratorios faltantes o inválidos de una reserva válida no son un error del payload: se rigen por
  FR-005 (200 e incidencia).

### Non-Functional Requirements

- **NFR-001**: La verificación y el registro de los datos migratorios no debe superar los 500
  milisegundos por notificación, con hasta 10 huéspedes extranjeros por notificación.
- **NFR-002**: Los datos migratorios (documento y fecha de nacimiento) no deben escribirse en los
  registros de log.

### Key Entities *(include if feature involves data)*

- **ForeignGuestData**: Datos migratorios ya procesados de un huésped extranjero, capturados por el
  Módulo 1 y enviados con la notificación. Atributos: `firstName`, `lastName`, `documentType`,
  `documentNumber`, `birthDate`, `nationality`, `movementType` (`ENTRY` | `DEPARTURE`),
  `movementDate` (fecha sin hora: `checkInDate` en la entrada, `checkOutDate` en la salida),
  `originPlace` (lugar de procedencia) y `destinationPlace` (lugar de destino). SIRE exige los dos
  últimos y rechaza el registro si vienen vacíos.
  Es propiedad del Módulo 1 y esta funcionalidad no lo modifica; el Módulo 2 guarda una copia en cada
  `MigratoryMovement`.
- **MigratoryMovement**: Movimiento migratorio de un huésped extranjero en una estadía. Siempre está
  completo. Atributos: `movementId`, `reservationRef`, `guestRef` (solo si el huésped es el titular;
  los acompañantes no son `Guest` del Módulo 2), `movementType` (`ENTRY` | `DEPARTURE`),
  `movementDate`, los datos migratorios copiados de `ForeignGuestData` (`firstName`, `lastName`,
  `documentType`, `documentNumber`, `birthDate`, `nationality`, `originPlace`, `destinationPlace`).
  Identidad única: (`reservationRef`, `documentNumber`, `movementType`).
- **ReconciliationIncident**: Registro de una discrepancia con el Módulo 1. Aquí se crea cuando los
  datos de un huésped se devuelven al Módulo 1 por estar incompletos (o falta el titular extranjero) y
  cuando hay más extranjeros que `guestCount`. La devolución se resuelve sola cuando el Módulo 1
  reenvía los datos completos. Atributos: `incidentId`, `origin` (`CHECK_IN` | `CHECK_OUT`),
  `reservationRef`, `reason`, `missingFields`, `createdAt` y `resolutionStatus` (`OPEN` | `RESOLVED`).
- **MigratoryDataReturned**: Mensaje que el Módulo 2 envía al Módulo 1 para devolverle los datos de un
  huésped que no se pudieron registrar. Atributos: `reservationRef`, `guest` (`documentNumber` y
  nombre, si se enviaron), `origin` (`CHECK_IN` | `CHECK_OUT`), `missingFields` y `reason`.
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `nationality` y
  `type` (`NATIONAL` | `FOREIGN`).
- **Reservation**: Estadía asociada a los huéspedes. Atributos: `reservationRef`, `guestRef`,
  `guestCount` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Se referencia solo como contexto de la notificación del Módulo 1 (`roomId` de la
  habitación del Check-In o del Check-Out). Atributos: `id`, `status` (`Available` | `Reserved` |
  `Occupied`). Esta funcionalidad no modifica su estado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los huéspedes extranjeros notificados con todos sus datos por el Módulo 1
  quedan con su movimiento de entrada o de salida registrado; los que llegan con datos ausentes se
  devuelven al Módulo 1 con el campo a completar identificado.
- **SC-002**: El 100% de los registros entregados a "Exportar archivo SIRE" tienen todos los datos
  obligatorios, tipo de movimiento y fecha válidos.
- **SC-003**: Cero errores **HTTP 500** por payloads mal formados o datos ilógicos; el 100% se
  responde con **HTTP 400**.
- **SC-004**: Ningún huésped extranjero de un grupo queda sin reportar por el error de otro huésped
  de la misma notificación.
