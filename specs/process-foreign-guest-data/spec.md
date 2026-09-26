# Feature Specification: Procesar Datos de Huéspedes Extranjeros

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

La ley exige reportar a Migración los huéspedes extranjeros que aloja el hotel. Los datos
migratorios se capturan en persona, durante el Check-In, y por eso los recoge el Módulo 1, que es
quien opera la recepción física. El Módulo 2 no tiene una pantalla propia para pedirlos: los recibe
dentro de la notificación de Check-In. Si esos datos llegan incompletos o con formato inválido, el
reporte a Migración sale defectuoso y el hotel se expone a sanciones. El negocio necesita un
procesamiento que reciba los datos migratorios del Módulo 1 (`ForeignGuestData`), los valide, los
registre en un
`MigratoryMovement` asociado a la estadía y los deje listos para "Exportar archivo SIRE".

### Flujo de Usuario de Alto Nivel

1. El **Módulo 1** notifica el Check-In de una reserva cuyo huésped es extranjero (`Guest.type`
   `FOREIGN`) e incluye en la misma notificación sus `ForeignGuestData`, de los que el sistema toma
   el tipo de movimiento migratorio y su fecha. El cambio de estado de la reserva a `IN_PROGRESS` lo
   ejecuta "Actualizar reservación".
2. El sistema valida que los datos migratorios estén presentes, tengan formato correcto y sean
   coherentes (por ejemplo, que la fecha de movimiento no sea futura).
3. Si son válidos, el sistema los registra en un `MigratoryMovement` asociado a esa `Reservation`
   (una estadía), con `validationStatus` `COMPLETE`, sin sobrescribir los movimientos de otras
   estadías del mismo huésped, y los deja disponibles para el reporte gubernamental.
4. Si faltan datos o son inválidos, el sistema igualmente registra el `MigratoryMovement` con
   `validationStatus` `INCOMPLETE` —porque el Check-In físico ya ocurrió en el Módulo 1— y responde
   200 sin advertencias mezcladas; el campo que requiere corrección queda identificado en el propio
   `MigratoryMovement` (`INCOMPLETE`) y en el reporte de exclusiones de la exportación SIRE. Un
   reenvío posterior del Módulo 1 con los datos completos de esa reserva actualiza únicamente ese
   movimiento a `COMPLETE`. Solo un payload inutilizable
   (sin identificador de reserva o con caracteres maliciosos) se rechaza con **HTTP 400 (Bad
   Request)** sin registrar nada.
5. Cuando "Exportar archivo SIRE" (ejecutado por el actor Migración) necesita los datos, invoca este
   caso de uso para obtener los registros migratorios completos del periodo, e identifica los
   incompletos para no exportarlos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recepción y Validación de Datos Migratorios del Módulo 1 (Priority: P1)

El sistema recibe, dentro de la notificación de Check-In del Módulo 1, los datos migratorios de un
huésped extranjero, los valida y los registra como `MigratoryMovement` de la estadía. Por tratarse
de un único paso
integrado con la notificación de Check-In, el camino exitoso, los datos incompletos y los huéspedes
nacionales se consolidan en esta misma historia de usuario.

**Why this priority**: Sin estos datos consolidados, el hotel no puede cumplir con el reporte
migratorio obligatorio. Recibirlos en la misma notificación evita duplicar pantallas de captura en
el Módulo 2.

**Independent Test**: Se envía una notificación simulada del Módulo 1 con los datos migratorios
completos de un huésped extranjero y se verifica que queden registrados como `MigratoryMovement` de
esa reserva. Se repite omitiendo el tipo de movimiento y se confirma que queda `INCOMPLETE` con una
advertencia.

**Acceptance Scenarios**:

1. **Scenario**: Consolidación exitosa de datos migratorios (Happy Path)
   - **Given** una `Reservation` de un `Guest` `FOREIGN` en proceso de Check-In
   - **When** el sistema recibe la notificación del Módulo 1 con el tipo de movimiento migratorio y
     su fecha, ambos válidos
   - **Then** el sistema registra el `MigratoryMovement` de esa reserva con `validationStatus`
     `COMPLETE`, dejándolo disponible para "Exportar archivo SIRE"

2. **Scenario**: Notificación con datos migratorios incompletos
   - **Given** una `Reservation` de un `Guest` `FOREIGN` en proceso de Check-In
   - **When** la notificación del Módulo 1 llega sin el tipo de movimiento o sin la fecha
   - **Then** el sistema registra el `MigratoryMovement` con `validationStatus` `INCOMPLETE`,
     conserva el cambio de estado del Check-In y responde 200; el campo faltante queda identificado
     en el movimiento `INCOMPLETE`

3. **Scenario**: Huésped nacional sin datos migratorios
   - **Given** una `Reservation` de un `Guest` con `type` `NATIONAL`
   - **When** el sistema recibe la notificación de Check-In
   - **Then** el sistema omite el procesamiento migratorio y no exige ningún dato migratorio

4. **Scenario**: Corrección de datos migratorios por reenvío del Módulo 1
   - **Given** una `Reservation` en `IN_PROGRESS` cuyo `MigratoryMovement` está `INCOMPLETE`
   - **When** el Módulo 1 reenvía la notificación de Check-In con los datos migratorios completos
   - **Then** el sistema no cambia el estado de la reserva, actualiza únicamente ese
     `MigratoryMovement` a `COMPLETE` y responde 200

---

### User Story 2 - Entrega de Registros Migratorios para la Exportación SIRE (Priority: P2)

Cuando el actor Migración solicita "Exportar archivo SIRE", el sistema recupera los datos
migratorios
consolidados de los huéspedes extranjeros del periodo, entrega los completos y señala cuáles están
incompletos para excluirlos del archivo.

**Why this priority**: Es el consumo final de los datos procesados. No bloquea la operación diaria,
pero es necesario para cumplir el reporte periódico.

**Independent Test**: Se solicitan los registros de un periodo con dos huéspedes extranjeros, uno
completo y otro con la fecha migratoria ausente, y se verifica que se entregue el completo y se
señale el incompleto.

**Acceptance Scenarios**:

1. **Scenario**: Entrega de registros completos
   - **Given** `MigratoryMovement` `COMPLETE` de huéspedes `FOREIGN` en el periodo solicitado
   - **When** "Exportar archivo SIRE" invoca este caso de uso
   - **Then** el sistema entrega los registros completos con nacionalidad, documento, tipo de
     movimiento y fecha

2. **Scenario**: Señalamiento de registros incompletos
   - **Given** un `MigratoryMovement` `INCOMPLETE` del periodo, sin tipo de movimiento o fecha
     migratoria
   - **When** "Exportar archivo SIRE" invoca este caso de uso
   - **Then** el sistema excluye ese registro de la entrega y lo informa como advertencia, indicando
     la estadía y el huésped que requieren corrección

### Casos Borde

- ¿Qué sucede si la fecha de movimiento migratorio es futura? El sistema registra el
  `MigratoryMovement` como `INCOMPLETE` (con el motivo "La fecha de movimiento migratorio no puede
  ser futura") y responde 200.
- ¿Qué sucede si los datos migratorios contienen caracteres no soportados o patrones maliciosos? El
  sistema sanea la entrada, la rechaza con **HTTP 400** y el mensaje "Caracteres no válidos en los
  datos migratorios."
- ¿Qué sucede si la notificación llega vacía o sin el identificador de la reserva? El sistema
  responde con **HTTP 400** indicando que el payload es inválido, sin producir errores de
  infraestructura **HTTP 500**.
- ¿Qué sucede si el mismo huésped tiene más de una estadía? Cada estadía tiene su propio
  `MigratoryMovement`: una notificación nueva nunca sobrescribe el movimiento de una estadía
  anterior, y "Exportar archivo SIRE" recupera el movimiento de cada reserva.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe recibir los datos migratorios (`ForeignGuestData`, de los que toma el
  tipo de movimiento y la fecha) dentro de la notificación de Check-In del Módulo 1 para huéspedes
  con `type` `FOREIGN`.
- **FR-002**: El sistema no debe exigir ni procesar datos migratorios para huéspedes `NATIONAL`.
- **FR-003**: El sistema debe validar que los datos migratorios estén presentes, con formato
  correcto y con una fecha no futura antes de consolidarlos.
- **FR-004**: El sistema debe registrar los datos migratorios en un `MigratoryMovement` asociado a
  cada `Reservation` (estadía), sin sobrescribir los de otras estadías del mismo huésped.
- **FR-005**: El sistema debe registrar como `INCOMPLETE`, indicando los campos faltantes o
  inválidos, el movimiento cuyos datos falten o sean inválidos, conservando el Check-In, y excluirlo
  de la exportación SIRE hasta que se corrija; la corrección se hace con un reenvío del Módulo 1 con
  los datos completos, que debe actualizar únicamente ese movimiento a `COMPLETE` de forma
  idempotente.
- **FR-006**: El sistema debe entregar a "Exportar archivo SIRE" los registros migratorios
  completos del periodo y señalar los incompletos.
- **FR-007**: El sistema no debe capturar datos migratorios desde una pantalla propia del Módulo 2:
  la captura presencial es responsabilidad del Módulo 1.
- **FR-008**: El sistema debe interceptar los errores lógicos, estructurales o de seguridad del
  payload (sin identificador de reserva, formato de payload inválido, caracteres maliciosos) y
  responder con **HTTP 400 (Bad Request)**, prohibiendo que escalen a **HTTP 500**. Los datos
  migratorios faltantes o inválidos de una reserva válida no son un error del payload: se rigen por
  FR-005 (200 y movimiento `INCOMPLETE`).

### Non-Functional Requirements

- **NFR-001**: La validación y consolidación de los datos migratorios no debe superar los 500
  milisegundos por notificación.

### Key Entities *(include if feature involves data)*

- **Guest**: Huésped cuyos datos se procesan. Atributos: `id`, `fullName`, `documentNumber`,
  `nationality` y `type` (`NATIONAL` | `FOREIGN`).
- **ForeignGuestData**: Datos migratorios del huésped extranjero, capturados por el Módulo 1 en el
  Check-In y enviados con la notificación (pasaporte, visa, nacionalidad, fecha de nacimiento y
  procedencia, según el diccionario). De ellos el Módulo 2 toma el tipo y la fecha del movimiento
  migratorio. Es propiedad del Módulo 1 y esta funcionalidad no lo modifica.
- **MigratoryMovement**: Movimiento migratorio de una estadía de un huésped `FOREIGN`. Atributos:
  `movementId`, `reservationRef`, `guestRef`, `movementType` (`ENTRY` | `DEPARTURE`), `movementDate`
  `validationStatus` (`COMPLETE` | `INCOMPLETE`), `missingFields` (lista de campos faltantes o
  inválidos, solo cuando es `INCOMPLETE`) y `validationReason` (motivo legible de la invalidez, solo
  cuando es `INCOMPLETE`). Hay uno por reserva, de modo que las estadías de
  un mismo huésped no se sobrescriben.
- **Reservation**: Estadía asociada al huésped. Atributos: `reservationRef`, `guestRef` y `status`
  (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Se referencia solo como contexto de la notificación del Módulo 1. Atributos: `id`,
  `status` (`Available` | `Reserved` | `Occupied`). Esta funcionalidad no modifica su estado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los huéspedes `FOREIGN` con Check-In notificado quedan con sus datos
  migratorios consolidados, o rechazados con un mensaje que indica qué corregir.
- **SC-002**: El 100% de los registros entregados a "Exportar archivo SIRE" tienen tipo de
  movimiento y fecha válidos.
- **SC-003**: Cero errores **HTTP 500** por payloads mal formados o datos ilógicos; el 100% se
  responde con **HTTP 400**.
