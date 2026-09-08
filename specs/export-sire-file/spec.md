# Feature Specification: Exportar Archivo SIRE

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Todo hotel en Colombia está obligado a reportar a Migración Colombia los huéspedes extranjeros que
aloja, a través del sistema SIRE. Cuando ese reporte se arma a mano —revisando registros de
check-in uno por uno, copiando pasaportes y fechas a una plantilla— el proceso es lento, se presta
a errores de formato que el sistema oficial rechaza, y es fácil omitir huéspedes o, al contrario,
reportar dos veces al mismo. Cualquiera de esas fallas expone al hotel a multas y sanciones. El
negocio necesita automatizar la generación del archivo: consolidar la información de los huéspedes
extranjeros ya validados durante el check-in y ofrecer a las autoridades de Migración una ventana
segura donde puedan filtrar por fechas y descargar el reporte directamente, sin intermediación del
personal del hotel y sin cuellos de botella.

### Flujo de Usuario de Alto Nivel

1. El actor **Migración** se autentica en la interfaz de autogestión segura y restringida provista
   para este fin.
2. El actor define el rango de fechas del reporte (`startDate` y `endDate`), basado en el momento
   real de llegada o de salida del huésped.
3. El sistema procesa la consulta de forma estrictamente local en la base de datos de reservas del
   Módulo 2, filtrando los huéspedes extranjeros (`Guest.type == FOREIGN`) asociados a reservas en
   estado `CHECKED_IN` o `CHECKED_OUT` cuyo `MigratoryValidation` resultó `PASSED`. Por defecto
   solo incluye los registros con `sireExportStatus` en `PENDING`.
4. El sistema genera el archivo de texto plano (`.TXT`) estructurado según el estándar de
   columnas, anchos y delimitadores de Migración Colombia.
5. Dentro de la misma transacción, el sistema actualiza el `sireExportStatus` de los registros
   incluidos a `EXPORTED` y persiste el log de auditoría en `SireExport`.
6. El sistema entrega el archivo de texto plano para su descarga inmediata.

Esta funcionalidad no interactúa con el Módulo 1 ni con el Módulo 3: opera solo sobre datos
locales del Módulo 2 generados durante el check-in.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generación y Descarga del Reporte SIRE (Priority: P1)

El actor **Migración** ingresa a la ventana de autogestión, define un rango de fechas y descarga
el reporte de huéspedes extranjeros. En una sola pantalla se resuelven las tres variantes del
caso: la exportación normal de los registros pendientes, la re-exportación histórica opcional de
registros ya descargados (para reponer archivos perdidos), y el bloqueo controlado cuando no hay
extranjeros que reportar en el período. Por tratarse de una única vista y un único caso de
negocio, estas variantes se consolidan en esta misma historia de usuario y no se modelan como
pantallas ni historias separadas, para evitar la sobre-atomización. Al completarse con éxito, los
registros incluidos quedan marcados como `EXPORTED` y la descarga queda asentada en `SireExport`.

**Why this priority**: Es una funcionalidad de estricto cumplimiento legal. Su falla, su retraso o
la entrega de un archivo con formato inválido exponen al hotel a multas y sanciones por parte de
la autoridad migratoria nacional. No existe una operación alternativa aceptable: el reporte debe
poder generarse de forma correcta y a tiempo, siempre.

**Independent Test**: Se puede probar de forma aislada cargando registros de check-in de huéspedes
extranjeros con `MigratoryValidation` en `PASSED` y `sireExportStatus` en `PENDING` dentro de un
rango de fechas, ejecutando la exportación y verificando que se descarga un archivo `.TXT`
estructurado con los datos exactos y en el formato oficial, que el `sireExportStatus` de esos
registros cambia de forma transaccional a `EXPORTED`, y que se persiste un log en `SireExport` con
el rango consultado, el total de registros y el actor. La prueba se completa repitiendo la
descarga con la opción "Incluir ya exportados" activada y confirmando que se obtiene el archivo
sin duplicar los logs de auditoría, y ejecutándola sobre un rango sin extranjeros, confirmando el
bloqueo controlado.

**Acceptance Scenarios**:

1. **Scenario**: Generación exitosa de reporte SIRE con registros pendientes (Happy Path)
   - **Given** que existen registros de check-in de huéspedes extranjeros (`Guest.type == FOREIGN`)
     válidos en estado `PENDING` en `MigratoryValidation` para el rango de fechas seleccionado
   - **When** el actor **Migración** solicita la generación y confirma la descarga del archivo
     `.TXT`
   - **Then** el sistema genera el archivo de texto plano estructurado según el estándar de
     columnas, cambia de forma transaccional el `sireExportStatus` de esos registros a `EXPORTED`
     en la base de datos local del Módulo 2, registra el log en `SireExport`, y entrega el archivo
     físico para su descarga

2. **Scenario**: Re-exportación histórica de huéspedes previamente procesados
   - **Given** que existen huéspedes extranjeros en estado `EXPORTED` dentro del rango de fechas
     seleccionado
   - **When** el actor **Migración** marca explícitamente la opción "Incluir ya exportados"
     (`includesReExported`) y ejecuta la descarga
   - **Then** el sistema permite descargar nuevamente el archivo `.TXT` con los registros
     históricos, sin duplicar ni alterar los registros de auditoría de `SireExport` existentes

3. **Scenario**: Intento de exportación en un período sin registros de extranjeros (Error)
   - **Given** que no existen ingresos de huéspedes extranjeros en el rango de fechas seleccionado
     en la base de datos local del Módulo 2
   - **When** el actor intenta generar la descarga
   - **Then** el sistema bloquea la operación y devuelve un error de negocio controlado HTTP 400
     (Bad Request) indicando que no se encontraron huéspedes extranjeros que reportar en ese rango

4. **Scenario**: Exclusión controlada de registros incompletos
   - **Given** que existen huéspedes extranjeros en las fechas seleccionadas, pero uno de ellos
     tiene un campo migratorio obligatorio vacío o nulo (por ejemplo, tipo de visa o pasaporte
     inválido)
   - **When** el actor genera la exportación
   - **Then** el sistema omite de forma segura ese registro para no generar un archivo corrupto
     ante las autoridades, procesa el `.TXT` con el resto de huéspedes correctos, y responde con
     una alerta amigable HTTP 400 que detalla exactamente qué nombres requieren corrección en
     recepción

### Casos Borde

- ¿Qué sucede si ocurre un error en la base de datos al guardar el estado `EXPORTED` en el momento
  de procesar la descarga? La generación del archivo y la actualización del estado se tratan como
  una única transacción de base de datos; si la persistencia del estado falla, el sistema aborta
  la descarga, no cambia ningún `sireExportStatus` y arroja un error controlado **HTTP 400** para
  impedir inconsistencias, sin permitir que la falla escale a un **HTTP 500**.
- ¿Cómo maneja el sistema un rango de fechas invertido (fecha de inicio posterior a la fecha de
  fin) o con formato inválido? El sistema intercepta la validación de forma local y responde con
  un error **HTTP 400 (Bad Request)** amigable, sin ejecutar ninguna consulta.
- ¿Qué sucede cuando el volumen de huéspedes extranjeros en el rango seleccionado es inusualmente
  masivo y podría degradar la memoria del servidor? El sistema procesa la consulta y la escritura
  del archivo en bloques paginados para no comprometer la infraestructura, y si la generación
  supera el límite de tiempo de descarga responde con un error de protección **HTTP 400** que
  sugiere acotar el rango de fechas.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe proveer una interfaz de autogestión exclusiva y segura para que el
  actor **Migración** acceda a la descarga del archivo estructurado de reporte.
- **FR-002**: El sistema debe permitir filtrar los registros por un rango de fechas obligatorio
  (`startDate` y `endDate`).
- **FR-003**: El sistema debe extraer de forma exclusiva los datos de huéspedes extranjeros
  (`Guest.type == FOREIGN`) cuyas reservas estén en estado `CHECKED_IN` o `CHECKED_OUT`.
- **FR-004**: El sistema debe verificar que los huéspedes elegibles posean un registro de
  `MigratoryValidation` en estado `PASSED` completado localmente durante su Check-In.
- **FR-005**: El sistema debe generar el archivo de texto plano (`.TXT`) estructurado respetando
  con rigurosidad las columnas, los anchos fijos y los delimitadores definidos por la normativa
  oficial de Migración Colombia.
- **FR-006**: El sistema debe validar que los campos migratorios obligatorios (tipo de visa,
  pasaporte, nacionalidad y fechas de estancia) estén completos antes de escribir cada línea de
  registro; si un registro está incompleto, debe omitirse de la descarga actual y alertar al
  usuario para su corrección.
- **FR-007**: Al generarse exitosamente el archivo, el sistema debe cambiar de forma transaccional
  el estado del atributo `sireExportStatus` a `EXPORTED` en la tabla de `MigratoryValidation` del
  Módulo 2.
- **FR-008**: El sistema debe permitir solicitar la re-exportación de registros marcados como
  `EXPORTED` cuando el actor activa el control booleano `includesReExported`, sin generar logs de
  auditoría duplicados.
- **FR-009**: Al completarse la descarga con éxito, el sistema debe persistir un log de auditoría
  inmutable en la entidad `SireExport` registrando la fecha de descarga, el rango de fechas
  consultado, el total de registros incluidos y las credenciales del actor que ejecutó la
  consulta.
- **FR-010**: El sistema debe interceptar cualquier inconsistencia de entrada o error de base de
  datos para responder con errores de negocio controlados **HTTP 400 (Bad Request)**, prohibiendo
  explícitamente la propagación de fallas técnicas que deriven en errores **HTTP 500 (Internal
  Server Error)**.

### Non-Functional Requirements

- **NFR-001**: El tiempo de procesamiento y generación de la descarga del archivo `.TXT` en el
  servidor debe ser menor a 2 segundos para consultas de hasta 500 registros de huéspedes.

### Key Entities *(include if feature involves data)*

- **SireExport**: Representa el histórico de descargas del reporte SIRE, con fines de auditoría del
  hotel y del gobierno. Atributos: `id`, `exportDate` (momento de la generación), `recordsCount`
  (cantidad de registros incluidos), `dateRangeStart`, `dateRangeEnd`, `processedBy` (credenciales
  del actor de Migración) e `includesReExported` (booleano que indica si la descarga incorporó
  registros ya exportados).
- **Reservation**: Representa la reserva de origen del huésped reportado. Atributos:
  `reservationRef`, `startDate`, `endDate`, `source` (`DIRECT` | `OTA`), y `state` con estados
  permitidos: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Solo son elegibles
  las reservas en `CHECKED_IN` o `CHECKED_OUT`.
- **CheckIn**: Representa la admisión del huésped en el hotel. Atributos relevantes para este
  flujo: `reservationRef`, `arrivalTime` (momento real de llegada, base del filtro por fechas) y
  la referencia a la `MigratoryValidation` de cada `Guest` extranjero.
- **Guest**: Representa al huésped extranjero reportado. Atributos: `fullName`, `documentId`,
  `nationality`, `type` (`NATIONAL` | `FOREIGN`; solo se exportan los `FOREIGN`), `visaType` y
  `stayDates`.
- **MigratoryValidation**: Representa la validación migratoria local realizada por el Módulo 2
  durante el Check-In. Atributos: `guestRef`, `result` (`PASSED` | `FAILED`; solo se exportan los
  `PASSED`) y `sireExportStatus` con dos estados oficiales: `PENDING` (validado localmente, aún no
  exportado) y `EXPORTED` (ya incluido en una descarga).
- **Habitation**: Se referencia únicamente de forma informativa para la consistencia del modelo de
  datos. Sus siete estados oficiales del glosario son: `Available`, `Occupied`, `PendingCleaning`,
  `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`. Esta funcionalidad no
  interactúa con el Módulo 1.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los registros incluidos en el archivo `.TXT` corresponden exactamente a
  huéspedes de nacionalidad extranjera validados en estado `PASSED` en su Check-In.
- **SC-002**: El formato final del archivo `.TXT` cumple estrictamente con el validador oficial del
  sistema SIRE de Migración Colombia.
- **SC-003**: El 100% de las descargas exitosas generan un registro inmutable en `SireExport` para
  fines de auditoría del hotel y del gobierno.
- **SC-004**: El 100% de los fallos de consulta o de inconsistencia de fechas devuelven respuestas
  HTTP 400 estructuradas, con cero excepciones HTTP 500 en producción.
