# Feature Specification: Exportar Archivo SIRE

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Todo hotel en Colombia está obligado a reportar periódicamente a Migración Colombia los huéspedes
extranjeros que aloja, a través del sistema SIRE. Cuando ese reporte se arma a mano, es lento, se
presta a errores de formato que el sistema oficial rechaza, y es fácil omitir huéspedes o reportar
dos veces al mismo, lo que expone al hotel a multas. El negocio necesita automatizar la generación
del archivo: consolidar los datos de los huéspedes extranjeros recibidos durante el Check-In y
ofrecer al actor **Migración** una forma segura de filtrar por fechas y descargar el reporte
directamente, sin intermediación de la Recepcionista.

Esta funcionalidad opera de forma 100% autónoma sobre los datos locales del Módulo 2: no interactúa
con el Módulo 1 ni con el Módulo 3 en ningún punto de su ejecución.

### Flujo de Usuario de Alto Nivel

1. El actor **Migración** se autentica en la interfaz restringida provista para este fin y define el
   periodo del reporte (`startDate` y `endDate`).
2. El sistema ejecuta internamente "Procesar datos de huéspedes extranjeros" para filtrar los
   huéspedes `FOREIGN` asociados a reservas en `Reservation.state` `IN_PROGRESS` o `COMPLETED`
   dentro del rango solicitado, ignorando las reservas en `CANCELLED` o `NO_SHOW`.
3. El sistema valida la integridad de los datos migratorios de cada registro mediante el
   `MigratoryMovement`, conservando únicamente los que estén en `COMPLETE`.
4. El sistema genera el archivo de texto plano (`.TXT`) en el formato oficial de Migración Colombia,
   registra la exportación en `SireExport` y entrega la respuesta **HTTP 200** con únicamente el
   archivo, llevando el identificador de la exportación (`exportId`) en la cabecera `Export-Id`.
5. Los registros excluidos por datos migratorios incompletos quedan disponibles para su consulta en
   un reporte de exclusiones aparte, localizado mediante ese mismo `exportId`.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Generación y Exportación de SIRE con Datos de Extranjeros (Priority: P2)

**Plain Language**: Generación autónoma y local, dentro del Módulo 2, del archivo `.TXT` oficial
para Migración Colombia, a partir de los huéspedes `FOREIGN` con reservas efectivas en el periodo
solicitado, excluyendo los registros con datos migratorios incompletos y dejándolos disponibles en
un reporte de exclusiones aparte.

El actor Migración define un periodo y descarga el reporte de huéspedes extranjeros. En una sola
historia de usuario se resuelven la exportación exitosa, la exclusión de reservas no efectivas
(`CANCELLED` o `NO_SHOW`), la exclusión de registros con datos migratorios incompletos, el periodo
sin extranjeros y la consulta del reporte de exclusiones, para evitar la sobre-atomización.

**Why this priority**: Es una funcionalidad de cumplimiento legal. Aunque no bloquea la operación
diaria del hotel, es obligatorio enviar el reporte periódicamente; de lo contrario el hotel enfrenta
multas migratorias. Se prioriza como P2 por no ser parte del flujo transaccional diario de reservas.

**Independent Test**: Se genera el archivo para un periodo con huéspedes extranjeros en
`IN_PROGRESS` o `COMPLETED` con datos migratorios completos, y se valida que su estructura cumpla el
formato oficial. Se repite incluyendo reservas `CANCELLED` o `NO_SHOW`, verificando su exclusión; se
repite con un huésped con `MigratoryMovement` `INCOMPLETE`, verificando su exclusión del archivo y su
presencia en el reporte de exclusiones; y se repite con un periodo sin extranjeros, confirmando la
respuesta controlada **HTTP 400**.

**Acceptance Scenarios**:

1. **Escenario 1**: Exportación exitosa con extranjeros completos (Happy Path)

   ```gherkin
   Given reservas de huéspedes FOREIGN en Reservation.state IN_PROGRESS o COMPLETED con MigratoryMovement en estado COMPLETE dentro del periodo solicitado
   When el actor Migración solicita la exportación del periodo
   Then el sistema genera el archivo .TXT en el formato oficial con los registros válidos
   And registra la exportación en SireExport
   And responde HTTP 200 con únicamente el archivo y el exportId en la cabecera Export-Id
   ```

2. **Escenario 2**: Exclusión de reservas no efectivas (`CANCELLED` o `NO_SHOW`)

   ```gherkin
   Given reservas del periodo solicitado en Reservation.state CANCELLED o NO_SHOW
   When el sistema consolida la exportación
   Then el sistema excluye esas reservas del archivo generado
   ```

3. **Escenario 3**: Exclusión de registros con datos migratorios incompletos y entrega de la cabecera `Export-Id`

   ```gherkin
   Given un MigratoryMovement en estado INCOMPLETE de un huésped FOREIGN dentro del periodo solicitado
   When el sistema consolida la exportación
   Then el sistema omite ese registro del archivo .TXT
   And genera el archivo con los demás registros válidos
   And responde HTTP 200 entregando únicamente el archivo, con el exportId en la cabecera Export-Id
   And registra el registro omitido en el reporte de exclusiones de esa exportación con su motivo
   ```

4. **Escenario 4**: Periodo sin huéspedes extranjeros (Error)

   ```gherkin
   Given un periodo solicitado sin ningún huésped FOREIGN con reserva efectiva
   When el actor Migración solicita la exportación
   Then el sistema no genera ningún archivo
   And responde con un error controlado HTTP 400 (Bad Request) indicando que no hay registros migratorios que reportar en ese periodo
   ```

5. **Escenario 5**: Consulta del reporte de exclusiones mediante `exportId` válido

   ```gherkin
   Given una exportación previa identificada por un exportId válido que excluyó registros incompletos
   When el actor Migración consulta el reporte de exclusiones con ese exportId
   Then el sistema devuelve la lista de registros excluidos con reservationRef, guestRef y los campos migratorios faltantes
   ```

## 3. Casos Borde

- **Caso Borde 1**: Periodo con el 100% de los registros incompletos. El sistema no genera un
  archivo vacío: responde con un error controlado **HTTP 400 (Bad Request)** indicando que no hay
  registros válidos para exportar.
- **Caso Borde 2**: Rango de fechas mayor a 1 año. El sistema detiene la consulta masiva antes de
  ejecutarla y responde con un error controlado **HTTP 400 (Bad Request)**.
- **Caso Borde 3**: Concurrencia alta de solicitudes de exportación. El sistema aplica un límite de
  solicitudes y responde con **HTTP 429 (Too Many Requests)**, quedando estrictamente prohibida la
  propagación de una excepción **HTTP 500**.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe proveer una interfaz exclusiva y segura para que el actor Migración
  genere y descargue el archivo.
- **FR-002**: El sistema debe exigir como filtro obligatorio un periodo (`startDate` y `endDate`)
  antes de ejecutar cualquier consolidación de datos.
- **FR-003**: El sistema debe extraer únicamente huéspedes `FOREIGN` asociados a reservas en
  `Reservation.state` `IN_PROGRESS` o `COMPLETED`.
- **FR-004**: El sistema debe procesar el `MigratoryMovement` de cada registro y omitir del archivo
  aquellos que se encuentren en estado `INCOMPLETE`.
- **FR-005**: El sistema debe generar el archivo `.TXT` respetando las columnas, anchos y
  delimitadores oficiales de Migración Colombia.
- **FR-006**: El sistema debe registrar cada exportación en `SireExport` con auditabilidad completa,
  incluyendo el periodo, la cantidad de registros exportados y excluidos, y el actor que la ejecutó.
- **FR-007**: El sistema debe entregar la respuesta **HTTP 200** con únicamente el archivo `.TXT` y
  el `exportId` en la cabecera `Export-Id`, dejando los registros excluidos disponibles en un
  reporte de exclusiones consultable por ese mismo `exportId`.
- **FR-008**: El sistema debe interceptar los errores de validación de entrada o los periodos sin
  registros válidos, respondiendo con **HTTP 400 (Bad Request)**, quedando estrictamente prohibida
  la propagación de excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: La generación del archivo debe completarse en menos de 2 segundos para consultas de
  hasta 500 huéspedes.

## 5. Entidades Clave

- **SireExport**: Registro histórico de cada exportación. Atributos: `id` (`exportId`),
  `dateRangeStart`, `dateRangeEnd`, `exportDate`, `recordsCount`, `excludedCount` y `processedBy`.
- **Reservation**: Reserva de origen de cada registro exportado. Atributo de ciclo de vida:
  `Reservation.state` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
  Solo se exportan las reservas en `IN_PROGRESS` o `COMPLETED`.
- **Guest**: Huésped reportado. Atributos: `fullName`, `documentNumber`, `nationality` y `type`
  (`NATIONAL` | `FOREIGN`).
- **MigratoryMovement**: Movimiento migratorio de cada estadía, del que se toman el tipo y la fecha
  de cada línea del archivo. Atributos: `movementId`, `reservationRef`, `guestRef`, `movementType`,
  `movementDate`, `validationStatus` (`COMPLETE` | `INCOMPLETE`), `missingFields` y
  `validationReason` (estos dos últimos, solo cuando es `INCOMPLETE`). Solo los `COMPLETE` se
  exportan.
- **SireExportExclusion**: Registro excluido de una exportación por tener datos incompletos.
  Atributos: `exportId` (referencia al `SireExport`), `reservationRef`, `guestRef`,
  `missingFields` y `reason`.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de los archivos exportados cumplen las reglas de formato oficiales de SIRE.
- **SC-002**: El 100% de los registros incompletos se excluyen del archivo `.TXT` y quedan
  registrados en el reporte de exclusiones consultable por `exportId`.
- **SC-003**: El 100% de los errores de periodo inválido o ausencia de datos válidos se responden
  con **HTTP 400**, con cero excepciones **HTTP 500**.
