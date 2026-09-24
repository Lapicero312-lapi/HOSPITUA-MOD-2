# Feature Specification: Procesar Datos de Huéspedes Extranjeros

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

La ley exige reportar a Migración los huéspedes extranjeros que aloja el hotel. Los datos
migratorios se capturan en persona, durante el Check-In, y por eso los recoge el Módulo 1, que es
quien opera la recepción física. El Módulo 2 no tiene una pantalla propia para pedirlos: los recibe
dentro de la notificación de Check-In. Si esos datos llegan incompletos o con formato inválido, el
reporte a Migración sale defectuoso y el hotel se expone a sanciones. El negocio necesita un
procesamiento que reciba los datos migratorios del Módulo 1, los valide, los consolide en el `Guest`
correspondiente y los deje listos para "Exportar archivo SIRE".

### Flujo de Usuario de Alto Nivel

1. El **Módulo 1** notifica el Check-In de una reserva cuyo huésped es extranjero (`Guest.type`
   `FOREIGN`) e incluye en la misma notificación el tipo de movimiento migratorio y su fecha.
2. El sistema valida que los datos migratorios estén presentes, tengan formato correcto y sean
   coherentes (por ejemplo, que la fecha de movimiento no sea futura).
3. Si son válidos, el sistema los consolida en el `Guest` asociado a la `Reservation`, dejándolos
   disponibles para el reporte gubernamental.
4. Si faltan datos o son inválidos, el sistema rechaza la consolidación con un error de negocio
   controlado **HTTP 400 (Bad Request)** que detalla qué campo requiere corrección.
5. Cuando "Exportar archivo SIRE" (ejecutado por el actor Migración) necesita los datos, invoca este
   caso de uso para obtener los registros migratorios completos del periodo, e identifica los
   incompletos para no exportarlos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recepción y Validación de Datos Migratorios del Módulo 1 (Priority: P1)

El sistema recibe, dentro de la notificación de Check-In del Módulo 1, los datos migratorios de un
huésped extranjero, los valida y los consolida en su `Guest`. Por tratarse de un único paso
integrado con la notificación de Check-In, el camino exitoso, los datos incompletos y los huéspedes
nacionales se consolidan en esta misma historia de usuario.

**Why this priority**: Sin estos datos consolidados, el hotel no puede cumplir con el reporte
migratorio obligatorio. Recibirlos en la misma notificación evita duplicar pantallas de captura en
el Módulo 2.

**Independent Test**: Se envía una notificación simulada del Módulo 1 con los datos migratorios
completos de un huésped extranjero y se verifica que queden almacenados en su `Guest`. Se repite
omitiendo el tipo de movimiento y se confirma el rechazo con **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Consolidación exitosa de datos migratorios (Happy Path)
   - **Given** una `Reservation` de un `Guest` `FOREIGN` en proceso de Check-In
   - **When** el sistema recibe la notificación del Módulo 1 con el tipo de movimiento migratorio y
     su fecha, ambos válidos
   - **Then** el sistema consolida los datos en el `Guest`, dejándolos disponibles para "Exportar
     archivo SIRE"

2. **Scenario**: Notificación con datos migratorios incompletos (Error)
   - **Given** una `Reservation` de un `Guest` `FOREIGN` en proceso de Check-In
   - **When** la notificación del Módulo 1 llega sin el tipo de movimiento o sin la fecha
   - **Then** el sistema no consolida los datos, responde con **HTTP 400 (Bad Request)** indicando
     el campo faltante, y no altera el `Guest`

3. **Scenario**: Huésped nacional sin datos migratorios
   - **Given** una `Reservation` de un `Guest` con `type` `NATIONAL`
   - **When** el sistema recibe la notificación de Check-In
   - **Then** el sistema omite el procesamiento migratorio y no exige ningún dato migratorio

---

### User Story 2 - Entrega de Registros Migratorios para la Exportación SIRE (Priority: P2)

Cuando el actor Migración solicita "Exportar archivo SIRE", el sistema recupera los datos migratorios
consolidados de los huéspedes extranjeros del periodo, entrega los completos y señala cuáles están
incompletos para excluirlos del archivo.

**Why this priority**: Es el consumo final de los datos procesados. No bloquea la operación diaria,
pero es necesario para cumplir el reporte periódico.

**Independent Test**: Se solicitan los registros de un periodo con dos huéspedes extranjeros, uno
completo y otro con la fecha migratoria ausente, y se verifica que se entregue el completo y se
señale el incompleto.

**Acceptance Scenarios**:

1. **Scenario**: Entrega de registros completos
   - **Given** huéspedes `FOREIGN` con datos migratorios consolidados en el periodo solicitado
   - **When** "Exportar archivo SIRE" invoca este caso de uso
   - **Then** el sistema entrega los registros completos con nacionalidad, documento, tipo de
     movimiento y fecha

2. **Scenario**: Señalamiento de registros incompletos
   - **Given** un `Guest` `FOREIGN` del periodo sin tipo de movimiento o fecha migratoria
   - **When** "Exportar archivo SIRE" invoca este caso de uso
   - **Then** el sistema excluye ese registro de la entrega y lo informa como incompleto con
     **HTTP 400**, indicando el huésped que requiere corrección

### Casos Borde

- ¿Qué sucede si la fecha de movimiento migratorio es futura? El sistema la rechaza con **HTTP 400
  (Bad Request)** y el mensaje "La fecha de movimiento migratorio no puede ser futura."
- ¿Qué sucede si los datos migratorios contienen caracteres no soportados o patrones maliciosos? El
  sistema sanea la entrada, la rechaza con **HTTP 400** y el mensaje "Caracteres no válidos en los
  datos migratorios."
- ¿Qué sucede si la notificación llega vacía o sin el identificador de la reserva? El sistema
  responde con **HTTP 400** indicando que el payload es inválido, sin producir errores de
  infraestructura **HTTP 500**.
- ¿Qué sucede si llegan datos migratorios para un huésped ya consolidado? El sistema actualiza el
  registro con la información más reciente y conserva una traza del cambio.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe recibir los datos migratorios (tipo de movimiento y fecha) dentro de
  la notificación de Check-In del Módulo 1 para huéspedes con `type` `FOREIGN`.
- **FR-002**: El sistema no debe exigir ni procesar datos migratorios para huéspedes `NATIONAL`.
- **FR-003**: El sistema debe validar que los datos migratorios estén presentes, con formato
  correcto y con una fecha no futura antes de consolidarlos.
- **FR-004**: El sistema debe consolidar los datos migratorios válidos en la entidad `Guest`
  asociada a la `Reservation`.
- **FR-005**: El sistema debe entregar a "Exportar archivo SIRE" los registros migratorios
  completos del periodo y señalar los incompletos.
- **FR-006**: El sistema no debe capturar datos migratorios desde una pantalla propia del Módulo 2:
  la captura presencial es responsabilidad del Módulo 1.
- **FR-007**: El sistema debe interceptar los errores de validación y responder con **HTTP 400
  (Bad Request)**, prohibiendo que escalen a **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La validación y consolidación de los datos migratorios no debe superar los 500
  milisegundos por notificación.

### Key Entities *(include if feature involves data)*

- **Guest**: Huésped cuyos datos se procesan. Atributos: `id`, `fullName`, `documentNumber`,
  `nationality`, `type` (`NATIONAL` | `FOREIGN`), `migratoryMovementType` (`ENTRY` | `DEPARTURE`) y
  `migratoryMovementDate`. Los dos últimos solo aplican a huéspedes `FOREIGN`.
- **Reservation**: Estadía asociada al huésped. Atributos: `reservationRef`, `guestRef` y `status`
  (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Se referencia solo como contexto de la notificación del Módulo 1. Atributos: `roomId`,
  `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`). Esta funcionalidad no modifica su estado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los huéspedes `FOREIGN` con Check-In notificado quedan con sus datos
  migratorios consolidados, o rechazados con un mensaje que indica qué corregir.
- **SC-002**: El 100% de los registros entregados a "Exportar archivo SIRE" tienen tipo de
  movimiento y fecha válidos.
- **SC-003**: Cero errores **HTTP 500** por payloads mal formados o datos ilógicos; el 100% se
  responde con **HTTP 400**.
