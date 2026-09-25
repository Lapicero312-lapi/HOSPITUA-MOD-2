# Feature Specification: Exportar Archivo SIRE

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

Todo hotel en Colombia está obligado a reportar periódicamente a Migración Colombia los huéspedes
extranjeros que aloja, a través del sistema SIRE. Cuando ese reporte se arma a mano, es lento, se
presta a errores de formato que el sistema oficial rechaza, y es fácil omitir huéspedes o reportar
dos veces al mismo, lo que expone al hotel a multas. El negocio necesita automatizar la generación
del archivo: consolidar los datos de los huéspedes extranjeros recibidos del Módulo 1 durante el
Check-In y ofrecer al actor **Migración** una forma segura de filtrar por fechas y descargar el
reporte directamente, sin intermediación de la Recepcionista.

### Flujo de Usuario de Alto Nivel

1. El actor **Migración** se autentica en la interfaz restringida provista para este fin.
2. El actor define el periodo del reporte (`startDate` y `endDate`).
3. El sistema ejecuta "Procesar datos de huéspedes extranjeros" para obtener los registros
   migratorios completos de los huéspedes `FOREIGN` con reservas en `IN_PROGRESS` o `COMPLETED`, e
   identificar los incompletos.
4. El sistema genera el archivo de texto plano (`.TXT`) con las columnas, anchos y delimitadores de
   Migración Colombia.
5. El sistema registra la exportación en `SireExport` y entrega el archivo para su descarga; la
   respuesta contiene únicamente el archivo `.TXT` y lleva el identificador de la exportación
   (`exportId`) en la cabecera `Export-Id`.
6. Si hubo registros excluidos por estar incompletos, el actor los consulta en un recurso aparte, el
   reporte de exclusiones de esa exportación (`exportId`), que lista cada registro excluido y su
   motivo. Una solicitud con un `exportId` inexistente se rechaza con **HTTP 400**.

Esta funcionalidad no interactúa con el Módulo 1 ni con el Módulo 3: opera sobre datos locales del
Módulo 2.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generación y Exportación de SIRE con Datos de Extranjeros (Priority: P2)

El actor Migración define un periodo y descarga el reporte de huéspedes extranjeros. En una sola
pantalla se resuelven la exportación normal, el bloqueo por datos migratorios incompletos y el
periodo sin extranjeros, por lo que se consolidan en esta misma historia de usuario.

**Why this priority**: Es una funcionalidad de cumplimiento legal. Aunque no bloquea la operación
diaria del hotel, es obligatorio enviar el reporte periódicamente; de lo contrario el hotel enfrenta
multas migratorias.

**Independent Test**: Se genera el archivo para un periodo con huéspedes extranjeros y se valida que
su estructura cumpla el formato oficial e incluya el tipo de movimiento y la fecha recibidos del
Módulo 1. Se repite con un huésped incompleto y con un periodo sin extranjeros, confirmando el
comportamiento controlado.

**Acceptance Scenarios**:

1. **Scenario**: Exportación exitosa con datos de extranjeros (Happy Path)
   - **Given** reservas de huéspedes `FOREIGN` en `IN_PROGRESS` o `COMPLETED` con datos migratorios
     completos
   - **When** el actor Migración solicita la exportación del periodo
   - **Then** el sistema genera el archivo válido con nacionalidad, documento, tipo de movimiento y
     fecha de cada huésped, y registra la exportación en `SireExport`

2. **Scenario**: Exclusión de reservas no efectivas
   - **Given** reservas del periodo en `CANCELLED` o `NO_SHOW`
   - **When** se genera el archivo
   - **Then** el sistema las excluye del archivo

3. **Scenario**: Exclusión de registros con datos migratorios incompletos
   - **Given** un `MigratoryMovement` `INCOMPLETE` de un huésped `FOREIGN`, sin tipo de movimiento o
     sin fecha migratoria válida
   - **When** el sistema consolida la exportación
   - **Then** el sistema omite ese registro, genera el archivo con los demás y responde 200
     entregando solo el archivo, con el `exportId` en la cabecera `Export-Id`; el registro omitido
     queda en el reporte de exclusiones de esa exportación con el motivo "Datos incompletos para
     extranjeros en la reserva X"

4. **Scenario**: Periodo sin huéspedes extranjeros (Error)
   - **Given** un periodo con solo reservas nacionales o sin ocupación
   - **When** se ejecuta la exportación
   - **Then** el sistema no genera archivo y responde **HTTP 400** indicando que no hay registros
     migratorios que reportar en ese periodo, sin generar errores de infraestructura

5. **Scenario**: Consulta del reporte de exclusiones de una exportación
   - **Given** una exportación con un `exportId` válido que excluyó registros incompletos
   - **When** el actor consulta el reporte de exclusiones con ese `exportId`
   - **Then** el sistema devuelve la lista de registros excluidos, con la `reservationRef`, el
     huésped y los campos migratorios que faltan, para que puedan corregirse

### Casos Borde

- ¿Qué sucede si todos los registros del periodo están incompletos y no queda ninguno válido? El
  sistema no genera archivo vacío: responde **HTTP 400** indicando que no hay registros válidos para
  exportar y que existen registros incompletos por corregir.
- ¿Qué sucede si el rango de fechas supera 1 año y sobrecarga el sistema? El sistema detiene la
  operación y retorna **HTTP 400 (Bad Request)** con el mensaje: "El periodo solicitado excede el
  límite permitido. Por favor exporte periodos más cortos."
- ¿Qué sucede si el rango de fechas está invertido o tiene formato inválido? El sistema responde
  **HTTP 400** sin ejecutar ninguna consulta.
- ¿Qué ocurre si los datos del `Guest` contienen caracteres corruptos que no pueden codificarse en
  el archivo? El sistema detiene el proceso con **HTTP 400** y el mensaje: "Caracteres no válidos en
  el registro del huésped."
- ¿Qué sucede si la exportación se solicita simultáneamente más veces de las permitidas? El sistema
  aplica un límite de solicitudes y responde **HTTP 429 (Too Many Requests)**, evitando un **HTTP
  500** por falta de memoria.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe proveer una interfaz exclusiva y segura para que el actor Migración
  genere y descargue el archivo.
- **FR-002**: El sistema debe filtrar por un periodo obligatorio (`startDate` y `endDate`).
- **FR-003**: El sistema debe extraer únicamente huéspedes `FOREIGN` con reservas en `IN_PROGRESS`
  o `COMPLETED`, excluyendo `CANCELLED` y `NO_SHOW`.
- **FR-004**: El sistema debe obtener el `MigratoryMovement` de cada reserva mediante "Procesar
  datos de huéspedes extranjeros" y omitir los registros incompletos, informando cuáles requieren
  corrección.
- **FR-005**: El sistema debe generar el archivo `.TXT` respetando las columnas, anchos y
  delimitadores oficiales de Migración Colombia.
- **FR-006**: El sistema debe registrar cada exportación en `SireExport` con la fecha, el periodo,
  la cantidad de registros y el actor que la ejecutó.
- **FR-007**: El sistema debe excluir los registros incompletos del archivo y entregar la respuesta
  200 con únicamente el archivo `.TXT` y el `exportId` en la cabecera `Export-Id`, sin mezclar
  advertencias en esa respuesta; los registros excluidos deben quedar disponibles en un reporte de
  exclusiones consultable por `exportId`.
- **FR-008**: El sistema debe interceptar los errores de validación de entrada (periodo inválido,
  sin extranjeros, sin registros válidos, `exportId` inexistente) y de consulta, respondiendo **HTTP
  400 (Bad Request)** sin archivo y prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La generación del archivo debe tardar menos de 2 segundos para consultas de hasta 500
  huéspedes.

### Key Entities *(include if feature involves data)*

- **SireExport**: Histórico de exportaciones. Atributos: `id` (identificador de la exportación, el
  `exportId`), `excludedCount`, `exportDate`, `recordsCount`,
  `dateRangeStart`, `dateRangeEnd` y `processedBy`.
- **Reservation**: Reserva de origen. Atributos: `reservationRef`, `guestRef`, `startDate`,
  `endDate` y `status`. Solo se exportan las `IN_PROGRESS` o `COMPLETED`.
- **Guest**: Huésped reportado. Atributos: `fullName`, `documentNumber`, `nationality` y `type`
  (`NATIONAL` | `FOREIGN`).
- **MigratoryMovement**: Movimiento migratorio de cada estadía, del que se toman el tipo y la fecha
  de cada línea del archivo. Atributos: `movementId`, `reservationRef`, `guestRef`, `movementType`,
  `movementDate` y `validationStatus` (`COMPLETE` | `INCOMPLETE`). Solo los `COMPLETE` se exportan.
- **SireExportExclusion**: Registro excluido de una exportación por tener datos incompletos.
  Atributos: `exportId` (referencia al `SireExport`), `reservationRef`, `guestRef`, `missingFields`
  y `reason`. Forma el reporte de exclusiones de esa exportación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los archivos exportados contienen la información migratoria obligatoria en
  el formato exacto requerido.
- **SC-002**: El 100% de los registros incompletos se excluyen del archivo y quedan en el reporte de
  exclusiones de su exportación, y el 100% de los periodos inválidos, sin extranjeros o sin
  registros válidos responden **HTTP 400**, con cero errores **HTTP 500**.
- **SC-003**: El 100% de las exportaciones generan un registro auditable en `SireExport`.
