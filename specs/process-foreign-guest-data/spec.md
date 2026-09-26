# Feature Specification: Procesar Datos de Huéspedes Extranjeros

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

La ley exige reportar a Migración los huéspedes extranjeros que aloja el hotel. Los datos
migratorios (`movementType` y `movementDate`) se capturan en persona, durante el Check-In, y por
eso los recoge el Módulo 1, que es quien opera la recepción física. El Módulo 2 no tiene una
pantalla propia para pedirlos: los recibe dentro de la misma notificación de Check-In. Si esos datos
llegan incompletos o con formato inválido, el reporte a Migración sale defectuoso y el hotel se
expone a sanciones, pero eso nunca debe bloquear la operación física del hotel: el Check-In ya
ocurrió en el Módulo 1 y debe quedar confirmado en el Módulo 2 de todas formas.

El negocio necesita un procesamiento que reciba los datos migratorios del Módulo 1, los valide, los
registre en un `MigratoryMovement` asociado a la estadía —distinguiendo huéspedes `NATIONAL` de
`FOREIGN`— y los deje listos como insumo de lectura para "Exportar archivo SIRE".

### Flujo de Usuario de Alto Nivel

1. El Módulo 1 envía la notificación de Check-In de una `Reservation`, incluyendo los datos del
   `Guest` y, cuando su `type` es `FOREIGN`, el tipo de movimiento migratorio y su fecha.
2. El sistema valida el formato y la coherencia de los datos migratorios recibidos.
3. Si el `Guest` es `NATIONAL`, el sistema omite por completo el procesamiento migratorio.
4. Si el `Guest` es `FOREIGN` y los datos son válidos, el sistema persiste el `MigratoryMovement`
   asociado a esa `Reservation` con `validationStatus` `COMPLETE`.
5. Si el `Guest` es `FOREIGN` pero los datos migratorios faltan o son inválidos, el sistema
   igualmente confirma el Check-In de la estadía en el Módulo 2, persiste el `MigratoryMovement` con
   `validationStatus` `INCOMPLETE` y la lista de campos faltantes, y responde **HTTP 200** para no
   obstaculizar la operación física del hotel.
6. Solo un payload corrupto, sin identificador de reserva o con patrones maliciosos se rechaza con
   **HTTP 400 (Bad Request)**, sin registrar nada.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Recepción y Validación de Datos Migratorios del Módulo 1 (Priority: P1)

**Plain Language**: Recepción, validación y consolidación de los datos migratorios de huéspedes
extranjeros dentro de la propia notificación de Check-In del Módulo 1, sin exponer ninguna pantalla
de captura en el Módulo 2 y sin bloquear el Check-In ante datos incompletos.

El sistema recibe, dentro de la notificación de Check-In del Módulo 1, los datos migratorios de un
huésped extranjero, los valida y los registra como `MigratoryMovement` de la estadía. Por tratarse
de un único paso integrado con la notificación de Check-In, el camino exitoso, los datos
incompletos y los huéspedes nacionales se consolidan en esta misma historia de usuario, para evitar
la sobre-atomización.

**Why this priority**: Sin estos datos consolidados, el hotel no puede cumplir con el reporte
migratorio obligatorio. Recibirlos en la misma notificación evita duplicar pantallas de captura en
el Módulo 2 y garantiza que el Check-In físico nunca se vea bloqueado por un dato migratorio
faltante.

**Independent Test**: Se envía una notificación simulada del Módulo 1 con los datos migratorios
completos de un huésped `FOREIGN` y se verifica que queden registrados como `MigratoryMovement`
`COMPLETE` de esa reserva. Se repite omitiendo el tipo de movimiento, confirmando que el
`MigratoryMovement` queda `INCOMPLETE`, que el Check-In se confirma igualmente y que la respuesta es
**HTTP 200**. Se repite con un huésped `NATIONAL`, confirmando que no se exige ni se procesa ningún
dato migratorio.

**Acceptance Scenarios**:

1. **Escenario 1**: Consolidación exitosa de datos migratorios (Happy Path - `COMPLETE`)

   ```gherkin
   Given una Reservation de un Guest con type FOREIGN en proceso de Check-In notificado por el Módulo 1
   When la notificación incluye el movementType y el movementDate, ambos válidos y coherentes
   Then el sistema registra el MigratoryMovement de esa Reservation con validationStatus COMPLETE
   And lo deja disponible como insumo de lectura para "Exportar archivo SIRE"
   ```

2. **Escenario 2**: Notificación con datos migratorios incompletos (`INCOMPLETE` y HTTP 200)

   ```gherkin
   Given una Reservation de un Guest con type FOREIGN en proceso de Check-In notificado por el Módulo 1
   When la notificación llega sin el movementType, sin el movementDate, o con datos inválidos
   Then el sistema confirma el Check-In de la estadía en el Módulo 2
   And registra el MigratoryMovement con validationStatus INCOMPLETE y la lista de campos faltantes
   And responde HTTP 200 sin bloquear la operación
   ```

3. **Escenario 3**: Huésped nacional sin requerimiento de datos migratorios

   ```gherkin
   Given una Reservation de un Guest con type NATIONAL
   When el sistema recibe la notificación de Check-In del Módulo 1
   Then el sistema omite por completo el procesamiento migratorio
   And no exige ningún dato migratorio ni crea un MigratoryMovement
   ```

---

### User Story 2 - Entrega de Registros Migratorios a Exportación SIRE (Priority: P2)

**Plain Language**: Entrega, como insumo de solo lectura, de los `MigratoryMovement` consolidados de
un periodo al caso de uso "Exportar archivo SIRE", distinguiendo los registros `COMPLETE` de los
`INCOMPLETE` para su exclusión y auditoría.

Cuando el actor Migración solicita "Exportar archivo SIRE", el sistema recupera los datos
migratorios consolidados de los huéspedes extranjeros del periodo, entrega los `COMPLETE` para la
generación del archivo y señala los `INCOMPLETE` para que queden excluidos y auditables.

**Why this priority**: Es el consumo final de los datos procesados. No bloquea la operación diaria,
pero es necesario para cumplir el reporte periódico. Se prioriza como P2 por depender de la
ejecución previa de la User Story 1.

**Independent Test**: Se solicitan los registros de un periodo con dos huéspedes extranjeros, uno
con `MigratoryMovement` `COMPLETE` y otro con la fecha migratoria ausente (`INCOMPLETE`), y se
verifica que se entregue el primero para la generación del archivo y se señale el segundo para su
exclusión en el reporte de auditoría.

**Acceptance Scenarios**:

1. **Escenario 1**: Entrega de registros `COMPLETE` para la generación del `.TXT`

   ```gherkin
   Given MigratoryMovement en validationStatus COMPLETE de huéspedes FOREIGN dentro del periodo solicitado
   When "Exportar archivo SIRE" invoca este caso de uso
   Then el sistema entrega esos registros con nacionalidad, documento, movementType y movementDate
   ```

2. **Escenario 2**: Señalamiento de registros `INCOMPLETE` para su exclusión en el reporte de auditoría

   ```gherkin
   Given un MigratoryMovement en validationStatus INCOMPLETE dentro del periodo solicitado
   When "Exportar archivo SIRE" invoca este caso de uso
   Then el sistema excluye ese registro de la entrega para el archivo
   And lo señala como advertencia auditable, indicando la reserva, el huésped y los campos faltantes
   ```

## 3. Casos Borde

- **Caso Borde 1**: Fecha de movimiento migratorio futura. El sistema registra el
  `MigratoryMovement` como `INCOMPLETE`, con un motivo explicativo indicando que la fecha no puede
  ser futura, y responde **HTTP 200**.
- **Caso Borde 2**: Caracteres maliciosos o payload corrupto. El sistema rechaza la notificación con
  un error controlado **HTTP 400 (Bad Request)**, sin registrar ningún dato.
- **Caso Borde 3**: Múltiples estadías del mismo huésped. El sistema crea una entidad
  `MigratoryMovement` independiente por cada `Reservation`, de modo que una notificación nueva nunca
  sobrescribe el movimiento de una estadía anterior.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe recibir los datos migratorios (`movementType` y `movementDate`)
  dentro de la notificación de Check-In del Módulo 1, únicamente para huéspedes con `type`
  `FOREIGN`.
- **FR-002**: El sistema debe omitir cualquier requerimiento de datos migratorios para huéspedes con
  `type` `NATIONAL`.
- **FR-003**: El sistema debe validar que los datos migratorios estén presentes y que su fecha sea
  coherente (no futura) antes de consolidarlos como `COMPLETE`.
- **FR-004**: El sistema debe registrar un `MigratoryMovement` por cada `Reservation`, sin
  sobrescribir el historial de estadías anteriores del mismo huésped.
- **FR-005**: El sistema debe registrar como `INCOMPLETE`, con la lista de campos faltantes, las
  notificaciones cuyos datos migratorios falten o sean inválidos, sin anular ni bloquear el Check-In
  de la estadía, y respondiendo **HTTP 200**.
- **FR-006**: El sistema debe servir como insumo de lectura para "Exportar archivo SIRE", entregando
  los registros `COMPLETE` y señalando los `INCOMPLETE`.
- **FR-007**: El sistema debe garantizar que la captura presencial de los datos migratorios sea
  responsabilidad exclusiva del Módulo 1, sin exponer ninguna pantalla propia de captura en el
  Módulo 2.
- **FR-008**: El sistema debe interceptar los errores de estructura o de seguridad del payload
  (payload corrupto, sin identificador de reserva, o con patrones maliciosos) y responder con
  **HTTP 400 (Bad Request)**, quedando estrictamente prohibida la propagación de excepciones de
  infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El procesamiento de cada notificación debe completarse en menos de 500 milisegundos.

## 5. Entidades Clave

- **Guest**: Huésped cuyos datos se procesan. Atributos: `id`, `fullName`, `documentNumber`,
  `nationality` y `type` (`NATIONAL` | `FOREIGN`).
- **MigratoryMovement**: Movimiento migratorio de una estadía de un huésped `FOREIGN`. Atributos:
  `movementId`, `reservationRef`, `guestRef`, `movementType` (`ENTRY` | `DEPARTURE`),
  `movementDate`, `validationStatus` (`COMPLETE` | `INCOMPLETE`), `missingFields` y
  `validationReason` (estos dos últimos, solo cuando es `INCOMPLETE`). Hay uno por reserva, de modo
  que las estadías de un mismo huésped no se sobrescriben.
- **Reservation**: Estadía asociada al huésped. Atributo de ciclo de vida: `Reservation.state`
  (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Se referencia solo como contexto informativo de la notificación de Check-In del Módulo
  1; esta funcionalidad no modifica su estado. Estados físicos administrados por el Módulo 1:
  `Available`, `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock` e
  `Inactive`.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las notificaciones de huéspedes `FOREIGN` quedan con su registro
  migratorio en `COMPLETE` o `INCOMPLETE`.
- **SC-002**: El 100% de los datos entregados a "Exportar archivo SIRE" son válidos y corresponden a
  registros `COMPLETE`.
- **SC-003**: Cero errores **HTTP 500**; el 100% de los errores de payload se responden con **HTTP
  400**.
