# Feature Specification: Exportar Archivo SIRE

**Created**: 2026-09-19
**Updated**: 2026-09-28

## Use Case (Caso de Uso)

### Descripción del problema

Todo hotel en Colombia está obligado a reportar periódicamente a Migración Colombia los huéspedes
extranjeros que aloja, a través del sistema SIRE, con su información migratoria completa y el tipo de
movimiento de cada uno: entrada o salida. Cuando ese reporte se arma a mano, es lento, se presta a
errores de formato que el sistema oficial rechaza, y es fácil omitir huéspedes o reportar dos veces
al mismo, lo que expone al hotel a multas. El negocio necesita automatizar la generación del archivo:
consolidar los datos de los huéspedes extranjeros que el Módulo 1 envía en el Check-In y en el
Check-Out, y ofrecer a la **Recepcionista** una forma de filtrar por fechas y descargar el archivo
`.TXT`, que ella misma envía después a Migración. El Módulo 2 no envía nada a Migración: Migración
no es un actor del sistema.

### Flujo de Usuario de Alto Nivel

1. La **Recepcionista** se autentica y abre la pantalla de exportación SIRE.
2. La Recepcionista define el periodo del reporte (`startDate` y `endDate`), que se compara con la
   fecha de cada movimiento migratorio (`movementDate`).
3. El sistema ejecuta "Procesar datos de huéspedes extranjeros" para obtener los movimientos
   migratorios completos del periodo, tanto de entrada (`ENTRY`) como de salida (`DEPARTURE`), e
   identificar los incompletos. Por defecto solo incluye los movimientos que aún no se han reportado
   en otra exportación; la Recepcionista puede pedir incluirlos (`includeAlreadyReported`).
4. El sistema genera el archivo de texto plano (`.TXT`) con las columnas, anchos y delimitadores de
   Migración Colombia. El archivo tiene una línea por cada movimiento de cada huésped, con toda su
   información migratoria (ver FR-005).
5. El sistema registra la exportación en `SireExport`, marca los movimientos incluidos como
   reportados (`reportedInExportId`) y entrega el archivo para su descarga; la respuesta contiene
   únicamente el archivo `.TXT` y lleva el identificador de la exportación (`exportId`) en la
   cabecera `Export-Id`.
6. Si hubo movimientos excluidos por estar incompletos, la Recepcionista los consulta en un recurso
   aparte, el reporte de exclusiones de esa exportación (`exportId`), que lista cada movimiento
   excluido y su motivo, para que pueda pedir al Módulo 1 su corrección. Una solicitud con un
   `exportId` inexistente se rechaza con **HTTP 400**.
7. La Recepcionista envía el archivo descargado a Migración por los medios que esta disponga, fuera
   del sistema.

Esta funcionalidad no interactúa con el Módulo 1 ni con el Módulo 3: opera sobre datos locales del
Módulo 2.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generación y Exportación de SIRE con Datos de Extranjeros (Priority: P2)

La Recepcionista define un periodo y descarga el archivo de huéspedes extranjeros para enviarlo a
Migración. En una sola pantalla se resuelven la exportación normal, las entradas y salidas, el
bloqueo por datos migratorios incompletos, la reexportación y el periodo sin extranjeros, por lo que
se consolidan en esta misma historia de usuario.

**Why this priority**: Es una funcionalidad de cumplimiento legal. Aunque no bloquea la operación
diaria del hotel, es obligatorio enviar el reporte periódicamente; de lo contrario el hotel enfrenta
multas migratorias.

**Independent Test**: Se genera el archivo para un periodo con huéspedes extranjeros que ingresaron
y salieron y se valida que tenga una línea por cada movimiento, con toda la información migratoria
del huésped y el tipo de movimiento y la fecha recibidos del Módulo 1. Se repite con un movimiento
incompleto, con una segunda exportación del mismo periodo y con un periodo sin extranjeros,
confirmando el comportamiento controlado.

**Acceptance Scenarios**:

1. **Scenario**: Exportación exitosa de entradas y salidas (Happy Path)
   - **Given** dos huéspedes extranjeros con un movimiento `ENTRY` y uno `DEPARTURE` completos, con
     `movementDate` dentro del periodo
   - **When** la Recepcionista solicita la exportación del periodo
   - **Then** el sistema genera un archivo válido con 4 líneas (una por movimiento), cada una con
     los datos migratorios del huésped, el tipo de movimiento y la fecha, y registra la exportación
     en `SireExport`

2. **Scenario**: Huésped que ingresó en el periodo y aún no sale
   - **Given** un huésped con movimiento `ENTRY` en el periodo y sin `DEPARTURE` (la reserva sigue
     `IN_PROGRESS`)
   - **When** se genera el archivo
   - **Then** el archivo incluye solo su línea de entrada; su salida se reportará en la exportación
     del periodo en que ocurra

3. **Scenario**: Grupo de varios extranjeros de una misma reserva
   - **Given** una reserva con tres huéspedes extranjeros, cada uno con su movimiento completo
   - **When** se genera el archivo
   - **Then** el archivo incluye una línea por cada uno de los tres, no solo la del titular

4. **Scenario**: Exclusión de movimientos incompletos
   - **Given** un `MigratoryMovement` `INCOMPLETE`, sin un dato obligatorio
   - **When** el sistema consolida la exportación
   - **Then** el sistema omite ese movimiento, genera el archivo con los demás y responde 200
     entregando solo el archivo, con el `exportId` en la cabecera `Export-Id`; el movimiento
     omitido queda en el reporte de exclusiones de esa exportación con el motivo "Datos incompletos
     para el huésped X en la reserva Y"

5. **Scenario**: Movimiento corregido y reexportado
   - **Given** un movimiento que estuvo excluido por `INCOMPLETE` y que el Módulo 1 corrigió y quedó
     `COMPLETE`
   - **When** la Recepcionista exporta de nuevo el periodo
   - **Then** el archivo incluye ese movimiento, porque nunca se reportó

6. **Scenario**: Los movimientos ya reportados no se repiten
   - **Given** movimientos completos ya incluidos en una exportación anterior
   - **When** la Recepcionista exporta el mismo periodo sin `includeAlreadyReported`
   - **Then** el sistema no los incluye; si no queda ningún movimiento nuevo, responde **HTTP 400**
     indicando que no hay movimientos nuevos por reportar en ese periodo

7. **Scenario**: Reexportación intencional
   - **Given** movimientos ya reportados en la exportación 12
   - **When** la Recepcionista exporta el periodo con `includeAlreadyReported` verdadero
   - **Then** el archivo los incluye de nuevo, la exportación queda registrada como una nueva
     `SireExport`, y los movimientos conservan su `reportedInExportId` original

8. **Scenario**: Periodo sin huéspedes extranjeros (Error)
   - **Given** un periodo con solo huéspedes nacionales o sin ocupación
   - **When** se ejecuta la exportación
   - **Then** el sistema no genera archivo y responde **HTTP 400** indicando que no hay movimientos
     migratorios que reportar en ese periodo, sin generar errores de infraestructura

9. **Scenario**: Consulta del reporte de exclusiones de una exportación
   - **Given** una exportación con un `exportId` válido que excluyó movimientos incompletos
   - **When** la Recepcionista consulta el reporte de exclusiones con ese `exportId`
   - **Then** el sistema devuelve la lista de movimientos excluidos, con la `reservationRef`, el
     huésped, el tipo de movimiento y los campos migratorios que faltan, para que puedan corregirse

### Casos Borde

- ¿Qué sucede si todos los movimientos del periodo están incompletos y no queda ninguno válido? El
  sistema no genera archivo vacío: responde **HTTP 400** indicando que no hay movimientos válidos
  para exportar y que existen movimientos incompletos por corregir.
- ¿Qué sucede si el rango de fechas supera 1 año y sobrecarga el sistema? El sistema detiene la
  operación y retorna **HTTP 400 (Bad Request)** con el mensaje: "El periodo solicitado excede el
  límite permitido. Por favor exporte periodos más cortos."
- ¿Qué sucede si el rango de fechas está invertido o tiene formato inválido? El sistema responde
  **HTTP 400** sin ejecutar ninguna consulta.
- ¿Qué ocurre si los datos de un huésped contienen caracteres corruptos que no pueden codificarse en
  el archivo? El sistema detiene el proceso con **HTTP 400** y el mensaje: "Caracteres no válidos en
  el registro del huésped."
- ¿Qué sucede si la exportación se solicita simultáneamente más veces de las permitidas? El sistema
  aplica un límite de solicitudes y responde **HTTP 429 (Too Many Requests)**, evitando un **HTTP
  500** por falta de memoria.
- ¿Qué sucede si dos Recepcionistas exportan el mismo periodo al mismo tiempo? Cada movimiento se
  marca como reportado dentro de la misma transacción de la exportación: solo una de las dos lo
  incluye, y la otra recibe los movimientos restantes o el **HTTP 400** de "no hay movimientos
  nuevos".
- ¿Qué sucede si falla la generación del archivo a mitad del proceso? La transacción se revierte: no
  queda registro en `SireExport` ni movimientos marcados como reportados.
- ¿Qué sucede con las reservas `CANCELLED` o `NO_SHOW`? No tienen movimientos migratorios, porque
  nunca hubo Check-In, así que no aparecen en el archivo.
- ¿Qué sucede si el mismo huésped ingresó y salió dentro del periodo? Aparece con dos líneas, una de
  entrada y una de salida, con sus fechas respectivas.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe proveer una interfaz segura, exclusiva de la Recepcionista, para
  generar y descargar el archivo. El sistema no debe enviar el archivo a Migración.
- **FR-002**: El sistema debe filtrar por un periodo obligatorio (`startDate` y `endDate`, máximo un
  año), aplicado a la `movementDate` de cada movimiento migratorio.
- **FR-003**: El sistema debe incluir los movimientos `ENTRY` y `DEPARTURE` de todos los huéspedes
  extranjeros de las reservas del periodo, no solo del titular, sin depender del estado actual de la
  reserva.
- **FR-004**: El sistema debe obtener los `MigratoryMovement` mediante "Procesar datos de huéspedes
  extranjeros" y omitir los incompletos, informando cuáles requieren corrección.
- **FR-005**: El sistema debe generar el archivo `.TXT` respetando las columnas, anchos y
  delimitadores oficiales de Migración Colombia, con una línea por movimiento que contenga, para
  cada huésped: nombre, apellido, tipo de documento, número de documento, fecha de nacimiento,
  nacionalidad, tipo de movimiento (entrada o salida) y fecha del movimiento.
- **FR-006**: El sistema debe excluir por defecto los movimientos ya reportados en otra exportación
  (`reportedInExportId` no nulo) y permitir incluirlos con `includeAlreadyReported`, sin cambiar su
  `reportedInExportId` original.
- **FR-007**: El sistema debe registrar cada exportación en `SireExport` con la fecha, el periodo, la
  cantidad de movimientos incluidos y excluidos y la Recepcionista que la ejecutó, y marcar los
  movimientos incluidos como reportados dentro de la misma transacción.
- **FR-008**: El sistema debe excluir los movimientos incompletos del archivo y entregar la respuesta
  200 con únicamente el archivo `.TXT` y el `exportId` en la cabecera `Export-Id`, sin mezclar
  advertencias en esa respuesta; los movimientos excluidos deben quedar disponibles en un reporte de
  exclusiones consultable por `exportId`.
- **FR-009**: El sistema debe interceptar los errores de validación de entrada (periodo inválido,
  sin movimientos, sin movimientos válidos, sin movimientos nuevos, `exportId` inexistente) y de
  consulta, respondiendo **HTTP 400 (Bad Request)** sin archivo y prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La generación del archivo debe tardar menos de 2 segundos para consultas de hasta 500
  movimientos.
- **NFR-002**: El archivo descargado y el reporte de exclusiones contienen datos personales: el
  acceso queda limitado a la Recepcionista y las descargas quedan registradas en `SireExport`.

### Key Entities *(include if feature involves data)*

- **SireExport**: Histórico de exportaciones. Atributos: `id` (identificador único de la
  exportación; es el valor que `SireExportExclusion` y `MigratoryMovement.reportedInExportId`
  referencian), `exportDate`, `recordsCount`, `excludedCount`, `dateRangeStart`, `dateRangeEnd`,
  `includeAlreadyReported` y `processedBy` (la Recepcionista).
- **MigratoryMovement**: Movimiento migratorio de un huésped extranjero en una estadía, del que se
  toman todos los campos de cada línea del archivo. Atributos: `movementId`, `reservationRef`,
  `movementType` (`ENTRY` | `DEPARTURE`), `movementDate`, `firstName`, `lastName`, `documentType`,
  `documentNumber`, `birthDate`, `nationality`, `validationStatus` (`COMPLETE` |
  `INCOMPLETE`), `missingFields`, `validationReason` (estos dos últimos, solo cuando es
  `INCOMPLETE`, y son los que alimentan el reporte de exclusiones) y `reportedInExportId`. Solo los
  `COMPLETE` se exportan.
- **SireExportExclusion**: Movimiento excluido de una exportación por tener datos incompletos.
  Atributos: `exportId` (referencia directa a `SireExport.id`), `reservationRef`, `movementId`,
  `documentNumber`, `movementType`, `missingFields` y `reason`. Forma el reporte de exclusiones de
  esa exportación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los archivos exportados contienen la información migratoria obligatoria de
  cada huésped y su tipo de movimiento en el formato exacto requerido.
- **SC-002**: El 100% de los movimientos incompletos se excluyen del archivo y quedan en el reporte
  de exclusiones de su exportación, y el 100% de los periodos inválidos, sin extranjeros o sin
  movimientos válidos responden **HTTP 400**, con cero errores **HTTP 500**.
- **SC-003**: El 100% de las exportaciones generan un registro auditable en `SireExport`.
- **SC-004**: Ningún movimiento completo se reporta dos veces por accidente: solo se repite cuando la
  Recepcionista lo pide con `includeAlreadyReported`.
