# Feature Specification: Exportar Archivo SIRE

**Created**: 2026-09-19
**Updated**: 2026-09-29

## Use Case (Caso de Uso)

### Descripción del problema

Todo hotel en Colombia está obligado a reportar periódicamente a Migración Colombia los huéspedes
extranjeros que aloja, a través del sistema SIRE, con su información migratoria completa y el tipo de
movimiento de cada uno: entrada o salida. Cuando ese reporte se arma a mano, es lento, se presta a
errores de formato que el sistema oficial rechaza, y es fácil omitir huéspedes o reportar dos veces
al mismo, lo que expone al hotel a multas. El negocio necesita automatizar la generación del archivo:
seleccionar los huéspedes extranjeros entre los datos de todos los huéspedes que el Módulo 1 envía en
el Check-In y en el Check-Out, y ofrecer a la **Recepcionista** una forma de filtrar por fechas y descargar el archivo
`.TXT`, que ella misma envía después a Migración. El Módulo 2 no envía nada a Migración: Migración
no es un actor del sistema.

### Flujo de Usuario de Alto Nivel

1. La **Recepcionista** se autentica y abre la pantalla de exportación SIRE.
2. La Recepcionista define el periodo del reporte (`startDate` y `endDate`), que se compara con la
   fecha de cada movimiento migratorio (`movementDate`).
3. El sistema ejecuta "Procesar datos de huéspedes" para obtener los movimientos del
   periodo, tanto de entrada (`ENTRY`) como de salida (`DEPARTURE`), **seleccionando solo los de
   huéspedes extranjeros** (nacionalidad distinta de Colombia). Los movimientos de huéspedes
   colombianos se omiten. Todos están completos, porque el Módulo 1 los envía ya procesados. El sistema no lleva
   cuenta de lo que ya se descargó: el mismo periodo se puede descargar las veces que haga falta.
4. El sistema genera el archivo de texto plano (`.TXT`) con las columnas, anchos y delimitadores de
   Migración Colombia. El archivo tiene una línea por cada movimiento de cada huésped, con toda su
   información migratoria (ver FR-005).
5. El sistema registra la exportación en `SireExport` (histórico de descargas) y entrega el archivo
   para su descarga; la respuesta contiene
   únicamente el archivo `.TXT` y lleva el identificador de la exportación (`exportId`) en la
   cabecera `Export-Id`.
   La pantalla lista cada movimiento del periodo (uno por huésped y tipo), y permite previsualizar la
   línea de cada uno sin registrar nada y descargar un archivo `.TXT` solo con ese movimiento
   (descarga individual). La descarga individual registra su propia `SireExport` (con un solo
   registro), igual que la exportación de todo el periodo.
6. La Recepcionista envía el archivo descargado a Migración por los medios que esta disponga, fuera
   del sistema.

Esta funcionalidad no interactúa con el Módulo 1 ni con el Módulo 3: opera sobre datos locales del
Módulo 2.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generación y Exportación de SIRE con Datos de Extranjeros (Priority: P2)

La Recepcionista define un periodo y descarga el archivo de huéspedes extranjeros para enviarlo a
Migración. En una sola pantalla se resuelven la exportación normal, las entradas y salidas, la
descarga repetida, la descarga individual y el periodo sin extranjeros, por lo que se consolidan en esta
misma historia de usuario.

**Why this priority**: Es una funcionalidad de cumplimiento legal. Aunque no bloquea la operación
diaria del hotel, es obligatorio enviar el reporte periódicamente; de lo contrario el hotel enfrenta
multas migratorias.

**Independent Test**: Se genera el archivo para un periodo con huéspedes extranjeros que ingresaron
y salieron y se valida que tenga una línea por cada movimiento, con toda la información migratoria
del huésped y el tipo de movimiento y la fecha recibidos del Módulo 1. Se repite con una segunda
exportación del mismo periodo y con un periodo sin extranjeros, confirmando el comportamiento
controlado.

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

3. **Scenario**: Grupo mixto de una misma reserva
   - **Given** una reserva con tres huéspedes, dos extranjeros y uno colombiano, cada uno con su
     movimiento completo
   - **When** se genera el archivo
   - **Then** el archivo incluye una línea por cada uno de los dos extranjeros, no solo la del titular, y
     deja fuera al colombiano

4. **Scenario**: Descarga repetida del mismo periodo
   - **Given** un periodo que la Recepcionista ya descargó antes
   - **When** vuelve a exportarlo
   - **Then** el archivo incluye de nuevo todos los movimientos del periodo, sin ninguna restricción,
     y la descarga queda registrada como una nueva `SireExport`

5. **Scenario**: Periodo sin huéspedes extranjeros (Error)
   - **Given** un periodo con solo huéspedes nacionales o sin ocupación
   - **When** se ejecuta la exportación
   - **Then** el sistema no genera archivo y responde **HTTP 400** indicando que no hay movimientos
     migratorios que reportar en ese periodo, sin generar errores de infraestructura

6. **Scenario**: Previsualización de un movimiento
   - **Given** un movimiento del periodo
   - **When** la Recepcionista pide previsualizarlo
   - **Then** el sistema muestra la línea tal como saldría en el archivo, sin crear una `SireExport`

7. **Scenario**: Descarga individual de un movimiento
   - **Given** un movimiento del periodo
   - **When** la Recepcionista descarga solo ese movimiento, las veces que quiera
   - **Then** el sistema entrega un `.TXT` con una sola línea y registra una `SireExport` con un
     registro incluido

### Casos Borde

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
- ¿Qué sucede si falla la generación del archivo a mitad del proceso? No queda registro en
  `SireExport`.
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
- **FR-003**: El sistema debe seleccionar e incluir los movimientos `ENTRY` y `DEPARTURE` de todos los
  huéspedes extranjeros (nacionalidad distinta de Colombia) de las reservas del periodo, sin incluir a
  los colombianos, no solo del titular, sin depender del estado actual de la
  reserva.
- **FR-004**: El sistema debe obtener los `MigratoryMovement` mediante "Procesar datos de huéspedes
  extranjeros". Todos están completos: el Módulo 1 los envía ya procesados.
- **FR-005**: El sistema debe generar el archivo plano `.TXT` de cargue de hospedaje de SIRE, con
  una línea por movimiento y estos 12 campos en este orden:
  1. Código del hotel en SIRE (`hotelSireCode`, configuración del hotel).
  2. Código de la ciudad del hotel (`hotelCityCode`, configuración del hotel).
  3. Código del tipo de documento (`documentType`, convertido a la tabla de códigos de SIRE).
  4. Número de documento (`documentNumber`).
  5. Código de la nacionalidad (`nationality`, convertido a la tabla de códigos de SIRE).
  6. Apellidos (`lastName`).
  7. Nombres (`firstName`).
  8. Tipo de movimiento: `E` para `ENTRY` y `S` para `DEPARTURE`.
  9. Fecha del movimiento (`movementDate`).
  10. Lugar de procedencia (`originPlace`).
  11. Lugar de destino (`destinationPlace`).
  12. Fecha de nacimiento (`birthDate`).
  El separador de campos, el formato de fecha y las tablas de códigos de documento, nacionalidad y
  lugares son los del manual de cargue de SIRE, disponible en el portal de SIRE con la cuenta del
  hotel; el sistema los toma de configuración para no fijarlos en el código.
- **FR-006**: El sistema no debe llevar cuenta de los movimientos ya descargados: cualquier
  periodo o movimiento se puede descargar las veces que haga falta, sin restricciones.
- **FR-007**: El sistema debe registrar cada exportación en `SireExport` con la fecha, el periodo, la
  cantidad de movimientos incluidos y la Recepcionista que la ejecutó. No marca los movimientos.
- **FR-008**: El sistema debe entregar la respuesta 200 con únicamente el archivo `.TXT` y el
  `exportId` en la cabecera `Export-Id`, sin mezclar advertencias en esa respuesta.
- **FR-010**: El sistema debe listar los movimientos del periodo (uno por huésped y tipo de
  movimiento) y permitir a la Recepcionista previsualizar la línea de cada uno sin efectos, y
  descargar un `.TXT` de un solo movimiento. Cada descarga individual se registra como una
  `SireExport` de un registro (FR-006 y FR-007 aplican igual).
- **FR-009**: El sistema debe interceptar los errores de validación de entrada (periodo inválido,
  sin movimientos) y de consulta, respondiendo **HTTP 400 (Bad Request)** sin archivo y prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La generación del archivo debe tardar menos de 2 segundos para consultas de hasta 500
  movimientos.
- **NFR-002**: El archivo descargado contiene datos personales: el acceso queda limitado a la
  Recepcionista y las descargas quedan registradas en `SireExport`.

### Key Entities *(include if feature involves data)*

- **SireExport**: Histórico de exportaciones. Atributos: `id` (identificador único de la
  exportación), `exportDate`,
  `exportKind` (`PERIOD` | `SINGLE_MOVEMENT`), `recordsCount`, `dateRangeStart`, `dateRangeEnd`
  y `processedBy` (la Recepcionista).
- **MigratoryMovement**: Movimiento de un huésped en una estadía. Cada línea del archivo une el
  movimiento con los datos de su `GuestData`. Solo entran al archivo los de huéspedes extranjeros. Siempre está completo. Atributos del movimiento: `movementId`,
  `reservationRef`, `documentNumber`, `movementType` (`ENTRY` | `DEPARTURE`) y `movementDate`. Los datos
  del huésped (`firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`, `nationality`,
  `originPlace` y `destinationPlace`) salen de `GuestData`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los archivos exportados contienen la información migratoria obligatoria de
  cada huésped y su tipo de movimiento en el formato exacto requerido.
- **SC-002**: El 100% de los periodos inválidos o sin extranjeros responden
  **HTTP 400**, con cero errores **HTTP 500**.
- **SC-003**: El 100% de las exportaciones generan un registro auditable en `SireExport`.
