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
5. El sistema registra la exportación en `SireExport` y entrega el archivo para su descarga.

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

3. **Scenario**: Exclusión con advertencias por datos migratorios incompletos
   - **Given** un `MigratoryMovement` `INCOMPLETE` de un huésped `FOREIGN`, sin tipo de movimiento o
     sin fecha migratoria válida
   - **When** el sistema consolida la exportación
   - **Then** el sistema omite ese registro, genera el archivo con los demás y responde 200 con el
     archivo y una lista de advertencias que indica: "Datos incompletos para extranjeros en la
     reserva X"; no responde HTTP 400, porque el archivo sí se genera

4. **Scenario**: Periodo sin huéspedes extranjeros (Error)
   - **Given** un periodo con solo reservas nacionales o sin ocupación
   - **When** se ejecuta la exportación
   - **Then** el sistema no genera archivo y responde **HTTP 400** indicando que no hay registros
     migratorios que
     reportar en ese periodo, sin generar errores de infraestructura

### Casos Borde

- ¿Qué sucede si el rango de fechas supera 1 año y sobrecarga el sistema? El sistema detiene la
  operación y retorna **HTTP 400 (Bad Request)** con el mensaje: "El periodo solicitado excede el
  límite permitido. Por favor exporte periodos más cortos."
- ¿Qué sucede si el rango de fechas está invertido o tiene formato inválido? El sistema responde
  **HTTP 400** sin ejecutar ninguna consulta.
- ¿Qué ocurre si los datos del `Guest` contienen caracteres corruptos que no pueden codificarse en
  el archivo? El sistema detiene el proceso con **HTTP 400** y el mensaje: "Caracteres no válidos en
  el registro del huésped."
- ¿Qué sucede si la exportación se solicita simultáneamente más veces de las permitidas? El sistema
  aplica un límite de solicitudes y responde **HTTP 400** o 429, evitando un **HTTP 500** por falta
  de memoria.

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
- **FR-007**: El sistema debe excluir los registros incompletos y entregarlos como advertencias
  junto con el archivo en una respuesta 200; y debe interceptar los errores de validación de entrada
  (periodo inválido o sin extranjeros) y de consulta, respondiendo **HTTP 400 (Bad Request)** sin
  archivo y prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La generación del archivo debe tardar menos de 2 segundos para consultas de hasta 500
  huéspedes.

### Key Entities *(include if feature involves data)*

- **SireExport**: Histórico de exportaciones. Atributos: `id`, `exportDate`, `recordsCount`,
  `dateRangeStart`, `dateRangeEnd` y `processedBy`.
- **Reservation**: Reserva de origen. Atributos: `reservationRef`, `guestRef`, `startDate`,
  `endDate` y `status`. Solo se exportan las `IN_PROGRESS` o `COMPLETED`.
- **Guest**: Huésped reportado. Atributos: `fullName`, `documentNumber`, `nationality` y `type`
  (`NATIONAL` | `FOREIGN`).
- **MigratoryMovement**: Movimiento migratorio de cada estadía, del que se toman el tipo y la fecha
  de cada línea del archivo. Atributos: `movementId`, `reservationRef`, `guestRef`, `movementType`,
  `movementDate` y `validationStatus` (`COMPLETE` | `INCOMPLETE`). Solo los `COMPLETE` se exportan.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los archivos exportados contienen la información migratoria obligatoria en
  el formato exacto requerido.
- **SC-002**: El 100% de los registros incompletos se excluyen del archivo y se informan como
  advertencias, y el 100% de los periodos inválidos o sin extranjeros responden **HTTP 400**, con
  cero errores **HTTP 500**.
- **SC-003**: El 100% de las exportaciones generan un registro auditable en `SireExport`.
