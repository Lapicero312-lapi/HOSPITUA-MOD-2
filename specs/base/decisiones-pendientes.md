# Decisiones pendientes de los planes del Módulo 2

**Date**: 2026-09-26  
**Plan base**: [plan.md](./plan.md)  

Lista de lo que los planes dejaron abierto y debe decidir el equipo. Cada fila trae una propuesta; la
columna **Decisión** se llena en la reunión. Las decisiones ya tomadas (C1 a C10 y D1 a D9) están en el
plan base y no se repiten aquí.

**Cómo usarla**: marcar `[x]` cuando se decida, escribir la decisión y, si cambia un documento, avisar en
la columna **Notas**. Las secciones indican con quién se decide: A (bloqueantes), B (equipo del Módulo 1),
C (equipo del Módulo 3), D (equipo del Módulo 2) y E (ajustes a documentos).

## A. Bloqueantes: decidir antes de implementar

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| A1 | **Herramienta de build**: el repo ya tiene Gradle (`build.gradle`); el plan base aprobó Maven | Gradle, que ya existe; se cambia el plan | [ ] | Afecta tareas T001 y T002 del plan base |
| A2 | **Versión de Java**: el esqueleto usa la 26; la especificación técnica dice 21 | 21, salvo que el equipo prefiera la 26 | [ ] | La versión de Spring Boot del esqueleto es 4.1.1 |
| A3 | **Base de datos**: el esqueleto usa H2 y un perfil MySQL; la especificación dice PostgreSQL | PostgreSQL | [ ] | D3 (restricción de exclusión `btree_gist`) y C10 (bloqueo asesor) dependen de PostgreSQL; con MySQL hay que rehacerlas |
| A4 | **Acceso a datos**: el esqueleto usa `starter-jdbc`; la especificación dice Spring Data JPA | JPA | [ ] | El plan usa `@UpdateDateColumn` (`updatedAt`) para el control de concurrencia |
| A5 | **Estructura del proyecto**: `src/` en la raíz (esqueleto) o `backend/` + `frontend/` (plan) | `backend/` + `frontend/`, moviendo el esqueleto | [ ] | El paquete `com.hospitua.reservas` es compatible con el actual `com.hospitua` |
| A6 | **Contraseña de MySQL commiteada** en `application-mysql.properties` | Sacarla del repositorio y usar variables de entorno | [ ] | Riesgo de seguridad; no se ha modificado |
| A7 | **Autenticación (Spring Security)**: mecanismo para la Ota (clave de API u OAuth2 de cliente) y cómo se liga a `ota_id`; credenciales de servicio del Módulo 1 y del Módulo 3; sesión y expiración de la Recepcionista | Definir un mecanismo por tipo de actor | [ ] | Bloquea la tarea T018 y cinco planes |
| A8 | **Roles `FINANCE` y `ADMIN`**: el spec de comisión nombraba un "analista financiero" y un "Administrador" | **No se crean.** La conciliación de comisiones la hace el Módulo 3 (finanzas); la Recepcionista es el único usuario humano del Módulo 2 | [x] | Decidido por el negocio el 2026-09-29 (`register-ota-information-commission` US2 y FR-006) |
| A9 | **Formato oficial del archivo SIRE**: columnas, anchos, delimitadores, orden y juego de caracteres | **Orden de los 12 campos definido** en `export-sire-file` FR-005 (2026-09-29). El separador, el formato de fecha y las tablas de códigos (documento, nacionalidad, lugares) quedan en configuración y se cargan desde el manual de cargue de SIRE | [ ] | Único paso restante: descargar el manual desde el portal de SIRE con la cuenta del hotel y llenar la configuración. Ya no bloquea el diseño; bloquea el archivo de referencia de pruebas de `T-SIR-06` |
| A10 | **Mapeo de `movementType`** (`ENTRY`, `DEPARTURE`) a los códigos que exige Migración Colombia | `ENTRY` → `E`, `DEPARTURE` → `S` | [x] | Resuelto el 2026-09-29 (`export-sire-file` FR-005) |

## B. Con el equipo del Módulo 1

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| B1 | **El Módulo 1 maneja `Reserved` y `Available`** por su cuenta con la lista del día | El Módulo 2 no envía órdenes de estado | [x] | Decidido: se elimina `set-room-state`; reemplaza a C8, C9, B7 y B8 |
| B2 | **Contrato REST del inventario**: rutas, campos y si acepta rango de fechas | No enviar fechas (el estado físico es del instante actual) | [ ] | Plan `consult-room-inventory`. Su spec (2026-09-07) no filtra por fechas, como se propuso; faltan rutas y nombres de campos (B17) |
| B3 | **Listado por categoría**: completo o filtrado por estado | Que ofrezca ambos modos (D4) | [x] | Cubierto por su spec (2026-09-07): filtra por tipo y por estado, combinables |
| B4 | **Categoría inexistente** en el inventario | Devolver lista vacía, no error | [x] | Cubierto por su spec (2026-09-07): sin resultados devuelve lista vacía |
| B5 | **Calendario de mantenimientos**: si las fechas son fecha o fecha y hora, y si el fin es inclusivo | Fecha, con fin inclusivo | [ ] | La regla de cruce depende de esto |
| B6 | **Calendario por categoría**: que acepte `categoryRoom` o varios `roomId` | Sí, para evitar una llamada por habitación | [ ] | |
| B9 | **Mensajes `habitacion.checkin` y `habitacion.checkout`**: confirmar que traen dentro la lista `foreignGuests` con los datos migratorios de cada huésped extranjero de la habitación, incluidos `movementType` (`ENTRY` en el Check-In, `DEPARTURE` en el Check-Out) y `movementDate` | Dentro de cada mensaje (C2), actualizado el 2026-09-28: el Check-Out también los trae | [ ] | El Módulo 1 procesa los datos y los envía (2026-09-28) |
| B15 | **Campos de `ForeignGuestData`**: confirmar que el Módulo 1 envía, por huésped, `firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`, `nationality`, `movementType` y `movementDate` | Esa lista, según la especificación del Módulo 1 y lo pedido por el negocio el 2026-09-28 | [ ] | Los obligatorios están en `process-foreign-guest-data` FR-003 |
| B16 | **`reservedByReservationRef` en el inventario**: el spec de inventario del Módulo 1 (2026-09-07) no lo trae | Que lo agreguen, solo cuando el estado es `Reserved` | [ ] | Sin él no se distingue el apartado propio de una reserva de uno ajeno, ni se libera solo lo apartado por ella (`check-room-availability`, `set-room-state` FR-010) |
| B17 | **Nombres de los campos del inventario**: su spec dice ID (UUID), número, tipo y capacidad máxima; el diccionario dice `id`, `roomNumber`, `categoryRoom`, `maxCapacity` | Confirmar los nombres exactos | [ ] | |
| B18 | **Excluir habitaciones `Inactive`**: su listado las incluye por defecto | Poder excluirlas al filtrar y filtrar por varios estados | [ ] | Ver D6 (excluirlas siempre) |
| B19 | **Estados que impiden reservar** una estadía futura, ahora que hay 8 | `PendingCleaning` e `InCleaning` **no bloquean** (decidido por el negocio el 2026-09-29). Falta confirmar cuáles de los demás bloquean: `Occupied`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive` | [ ] | Relacionada con E3 y E4 |
| B10 | **Diagrama `mod-1-2-3.drawio`**: quitar la flecha "Datos de huéspedes extranjeros" y agregar la del calendario | Actualizarlo | [ ] | C2 y C4 |
| B11 | **Hora de inicio del día operativo** y zona horaria del hotel | **Fijas:** el día operativo es el día calendario de Colombia, de las 00:00 a las 23:59 (UTC-5). La lista del día se envía a las 00:00 | [x] | Decidido por el negocio el 2026-09-29 (`check-view-reservation` FR-012, `update-reservation` FR-018). Ya no son configurables |
| B12 | **`maxCapacity` en el inventario**: que el Módulo 1 devuelva la capacidad máxima de cada habitación | Agregarlo a la consulta puntual y por categoría | [x] | Cubierto por su spec (2026-09-07): incluye la capacidad máxima de personas |
| B13 | **Check-In y Check-Out por habitación**: que `habitacion.checkin` y `habitacion.checkout` traigan el `roomId` además de la `reservationRef` | Obligatorio en ambos mensajes | [ ] | Reservas con varias habitaciones (2026-09-28) |
| B14 | **Lista de reservas del día**: que el Módulo 1 consuma por cola la lista (`DailyReservationList`) y sus actualizaciones (`ADDED`, `UPDATED`, `REMOVED`) y deje de consultar `GET /api/reservations` | Routing keys propuestas: `reserva.lista-del-dia` y `reserva.lista-del-dia.actualizacion` | [ ] | Spec `check-view-reservation`, historias 4 y 5 (2026-09-28) |
| B20 | **Consulta de reservas por fechas**: el Módulo 1 consulta las reservas de un rango (y habitación) al registrar un mantenimiento y al dar de baja una habitación | `GET /api/reservations` con `dateFrom`, `dateTo` y `roomId` (`check-view-reservation` FR-023) | [x] | Confirmado: parámetros `dateFrom`, `dateTo` y `roomId`. Falta confirmar los campos devueltos. El Módulo 2 solo informa; la lógica la aplica el Módulo 1 |

## C. Con el equipo del Módulo 3

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| C1 | **Contrato de la tarifa dinámica**: ruta, campos y autenticación | `POST /pricing/quotes` con `roomType`, `checkInDate`, `checkOutDate`; responde `quoteId`, `nightlyRates`, `lodgingAmount` (propuesto por el Módulo 3) | [x] | Ruta y campos acordados; falta la autenticación. Specs ajustados |
| C1a | **Cotización por habitación**: se cotiza una vez por habitación | La consulta de la reserva devuelve la lista `quoteIds` (un `quoteId` por habitación; vacía en OTA) | [x] | Acordado con el Módulo 3 (2026-10-07) |
| C1b | **Consulta de la reserva por el Módulo 3**: `GET /api/reservations/{reservationRef}` con `quoteIds`, `channel` y, solo si es OTA, `otaId`, `otaConfirmationCode` y `otaCommissionPercentage`; 404 si no existe; credencial de servicio (actor Módulo 3) | Adoptarlo (`check-view-reservation` FR-022) | [x] | Acordado con el Módulo 3; falta la autenticación (C4) |
| C2 | **Escala del importe** (decimales) y moneda | La respuesta de `POST /pricing/quotes` trae `currency` (por ejemplo `COP`); el Módulo 2 la guarda en la habitación | [x] | Moneda acordada con el Módulo 3 (2026-10-07); falta definir la escala de los decimales |
| C3 | **Porcentaje de comisión**: confirmar que lo expresan de 0 a 100 | 0 a 100, dividido entre 100 (C7) | [ ] | |
| C4 | **Autenticación del Módulo 3** al llamar a `GET /api/otas/{otaId}` | Credencial de servicio (ver A7) | [ ] | |

## D. Decisiones del equipo del Módulo 2

### Reservas y huéspedes

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D1 | **Formato de `reservationRef`** | Letras, dígitos y guion, hasta 40 caracteres (o UUID corto) | [ ] | Lo genera el sistema |
| D2 | **Búsqueda por `fullName`** | Parcial, sin distinguir mayúsculas ni acentos, mínimo 3 caracteres | [ ] | |
| D3 | **Límite de resultados** de la búsqueda | 50 por búsqueda | [ ] | El spec lo menciona para un rango de fechas que no es criterio (ver E) |
| D4 | **`roomNumber` en la respuesta** de consulta de reservas | Devolver solo `roomId`; alternativa: guardar una copia al asignar | [ ] | El Módulo 1 es dueño de `roomNumber` |
| D5 | **Elegir habitación** cuando solo llega la categoría | La de menor `roomNumber` entre las candidatas | [ ] | Direct y OTA |
| D6 | **Habitaciones `Inactive`** | Excluirlas siempre | [ ] | El spec no lo dice |
| D7 | **Tope de habitaciones candidatas** por categoría y `hospitua.availability.max-parallel` | Definir según el tamaño real del hotel | [ ] | |
| D8 | **País del hotel** para decidir si un huésped es extranjero (nacionalidad distinta del país del hotel) | Parámetro `hospitua.hotel.country` | [ ] | |
| D9 | **Huésped existente**: si el tipo de documento también lo identifica, y qué campos son obligatorios | Buscar por `documentNumber`; `fullName` y `documentNumber` obligatorios | [ ] | |

### OTA y comisión

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D10 | **`currency` en el payload de la agencia** | La agencia la envía | [ ] | D2 la exige en la reserva |
| D11 | **Reintento tras un timeout**: el spec rechaza el código repetido con 400 | Alternativa: devolver la reserva ya creada | [ ] | Hoy se sigue el spec |
| D12 | **Cómo notifica la agencia el pago o la garantía** | `POST /api/ota/reservations/{reservationRef}/confirmation` | [ ] | No está en el spec |
| D13 | **Campos que puede editar la Ota**, y si puede cambiar datos del huésped | Definir según el negocio | [ ] | |
| D14 | **Estado de la comisión al cancelar** | **No se toca.** Solo la Ota cancela sus reservas y solo cambia el `status` a `CANCELLED`; la comisión y su estado quedan como estaban, porque la agencia ya sabe que no la cobrará | [x] | Decidido por el negocio el 2026-09-29 (`register-ota-information-commission` FR-007 y `cancel-reservation` FR-006). Los `plan.md` todavía dicen "importe en cero" (E14) |
| D15 | **Estado `DISPUTED`** | Dejarlo fuera | [ ] | Ningún escenario lo usa |

### Cancelación y ciclo de vida

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D16 | **Formato de `processedBy`** en las cancelaciones | Usuario autenticado (Recepcionista) o identificador de la agencia | [ ] | |
| D17 | **Cancelar una reserva OTA en `PENDING`** | Igual que `ACTIVE` | [ ] | El spec lo admite |
| D19 | **Hora de cierre del día operativo** | **Fija:** al terminar las 23:59, hora de Colombia | [x] | Decidido por el negocio el 2026-09-29 (ver B11) |
| D20 | **Reintentos de los consumidores de colas** | Definir cantidad y espera | [ ] | |
| D21 | ~~Check-In de un huésped `NATIONAL` con datos migratorios~~ | **Resuelto 2026-09-28**: se registran los huéspedes extranjeros que envíe el Módulo 1 aunque el titular sea nacional | [x] | Los acompañantes pueden ser extranjeros |

### SIRE

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D22 | **Doble reporte** al mismo huésped en periodos que se solapan | **No se controla.** El sistema no lleva cuenta de lo ya descargado: cualquier periodo o movimiento se descarga las veces que haga falta. Reemplaza la decisión anterior (`reportedInExportId` e `includeAlreadyReported`) | [x] | Decidido por el negocio |
| D23 | **Límite de exportaciones simultáneas** y su alcance por instancia | Empezar con 2 por instancia | [ ] | Responde 429 al exceder |

### Generales

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D24 | **Performance Goals, Constraints y Scale/Scope** globales | Definir según el uso esperado | [ ] | Hoy solo hay tiempos por operación |
| D25 | **Herramienta de pruebas del frontend** | Vitest con Testing Library | [ ] | Propuesta nueva; no está en la especificación técnica |
| D26 | **Resilience4j** para llamadas REST | No; solo timeouts de `RestClient` | [ ] | |

### Varias habitaciones por reserva y lista del día (2026-09-28)

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D27 | **Máximo de habitaciones por reserva** | 10 | [ ] | Usado en generar directa, generar OTA y actualizar |
| D29 | **Reservas `PENDING` en la lista del día** | No se envían; viajan como `ADDED` si la OTA las confirma ese día | [ ] | El negocio pidió "reservas activas" |
| D30 | **Largo máximo de `notes`** (observaciones) | 500 caracteres | [ ] | |
| D32 | **Archivo SIRE por Recepcionista** | La Recepcionista genera el `.TXT` y lo envía a Migración fuera del sistema; Migración no es actor del sistema | [ ] | Cambio del 2026-09-28: antes Migración descargaba el archivo |
| D37 | **Datos migratorios completos** | El Módulo 1 envía los huéspedes extranjeros ya procesados y completos; el Módulo 2 da por hecho que llegan bien y **no los valida ni los devuelve**. Reemplaza la decisión anterior de devolver los incompletos (`MigratoryDataReturned`, `PENDING_RESEND`) | [x] | Decidido por el negocio el 2026-09-29 (`process-foreign-guest-data` FR-005, `export-sire-file`, `check-view-reservation` FR-005b, `update-reservation` FR-016). Se quitó el reporte de exclusiones de SIRE. Se quitó el estado migratorio `PENDING_RESEND` del listado de reservas. El Módulo 1 debe garantizar que envía los datos completos (B9, B15) |
| D33 | **Campos obligatorios de cada huésped extranjero** | Los ocho de B15 más `originPlace` y `destinationPlace` (diez en total), porque SIRE los exige y rechaza el registro si vienen vacíos | [ ] | Cambio del 2026-09-29: la procedencia se había quitado el 2026-09-28, pero SIRE la exige. Hay que avisar al Módulo 1 que debe capturar procedencia y destino en el Check-In |
| D34 | **Persona que ingresa y sale en distintas habitaciones o fechas** | Un solo `ENTRY` y un solo `DEPARTURE` por huésped y reserva | [ ] | |
| D35 | **Descarga individual de SIRE por movimiento** | La Recepcionista puede previsualizar y descargar un movimiento solo; cada descarga crea una `SireExport` de un registro y no marca nada | [x] | Decidido por el negocio el 2026-09-29 (`export-sire-file`, FR-010). Un archivo de una línea usa el mismo formato que el del periodo. Falta actualizar `export-sire-file/plan.md` |
| D36 | **La información de las OTA no se edita en el hotel** | La `Ota` se registra sola al vincular la cuenta del hotel, con los datos que envía por su API (`name`, `hotelAccountId`, `commissionPercentage`); la Recepcionista solo la consulta. Las reservas `OTA` solo las modifica o cancela la Ota por su API | [ ] | Cambio del 2026-09-29 en `register-ota-information-commission` (US3, FR-008), `update-reservation` (FR-001a) y `cancel-reservation` (FR-002a). Pendiente: quitar `POST /api/otas` y `PUT /api/otas/{otaId}` de la Recepcionista y el Administrador en `base/plan.md`, definir el endpoint de registro de la Ota, y actualizar A8 y E11 |
| D38 | **Tipo de documento del titular (`documentType`)**: el Módulo 1 lo pide en la lista de reservas del día | Valores `CC`, `CE`, `PASSPORT` y `OTHER`; se captura en reserva directa y modificación, y en OTA viene en el payload | [ ] | Confirmado: las OTA sí envían el tipo de documento en su payload. Pendiente confirmar con el Módulo 1 y con las OTA la lista de valores |
| D31 | **Llegada parcial de un grupo**: habitaciones sin Check-In al cierre del día | `NOT_ARRIVED` y se liberan; la reserva sigue `IN_PROGRESS` | [ ] | Sin efecto financiero en el Módulo 2; el ajuste del cobro es del Módulo 3 |

## E. Ajustes a documentos del equipo

Ninguno de estos cambios está hecho.

| # | Documento | Ajuste | Motivo |
|---|---|---|---|
| E1 | `DIAGRAMA.drawio` (casos de uso) | Quitar "Establecer estado de habitación" y sus uniones | El Módulo 2 ya no ordena estados de habitación |
| E2 | `DIAGRAMA.drawio` | Quitar la línea de "Generar reservación por OTA" a "Calcular tarifa dinámica" | Decisión C5 |
| E3 | `diccionario.md` y `guia_flujo_reservas.html` | Aclarar que el inventario se consulta siempre solo para elegir habitaciones y el estado físico solo si la estadía incluye hoy | El spec de disponibilidad dice esto último |
| E4 | Specs de disponibilidad, inventario y otros | Listar los 8 estados de `Room` del diccionario, no solo 3 | Inconsistencia |
| E5 | `diccionario.md` | ~~Corregir "descarga asíncronamente" de Migración~~ (resuelto 2026-09-28: Migración ya no es actor); agregar `currency` de la tarifa de la habitación y `status_reason`; unificar `totalAmount` con `grossAmount` | Inconsistencias y D2, D6, C6 |
| E6 | `check-view-reservation/spec.md` | ~~Quitar o definir la "búsqueda por rango de fechas"~~ | **Resuelto 2026-09-29**: el listado filtra por estado, canal, agencia y fecha (`ARRIVAL`, `DEPARTURE`, `STAY`), con una búsqueda por código, documento o nombre; se ordena por `startDate` (ascendente o descendente) y se **pagina de a 10** |
| E7 | `process-foreign-guest-data/spec.md` | Unificar "con una advertencia" y "200 sin advertencias mezcladas" | Se contradice |
| E8 | `export-sire-file/spec.md` | Cambiar `GET` a `POST` en la generación y definir el formato del archivo | D9 y A9 |
| E9 | `update-reservation` y `process-foreign-guest-data` | Cambiar "responde 200/400" por las reglas de cola | Decisión C1 |
| E10 | `register-ota-information-commission/spec.md` y `generate-ota-reservation/spec.md` | Usar `grossAmount` en la entidad; exponer `GET /api/otas/{otaId}` | Decisiones C3a y C6 |
| E11 | ~~Actores de `register-ota-information-commission`~~ | **Resuelto 2026-09-29**: no son actores del Módulo 2; la conciliación la hace el Módulo 3 (A8) | Spec actualizado |
| E12 | `template/sdd-guide.MD` | Corregir la ruta `specs/templates/` a `specs/template/` | Carpeta real |
| E13 | Disponibilidad agotada | Confirmar que responder 400 (directa y actualizar) y 409 (OTA) es intencional | Cada spec lo define distinto |
| E14 | Todos los `plan.md` y `base/plan.md` | Actualizar a los specs del 2026-09-28: varias habitaciones por reserva (`ReservationRoom`, `stayStatus`), `guestCount`, `notes`, Check-In/Out por habitación, nueva historia de envío diario al Módulo 1 dentro de `check-view-reservation`, y quitar al Módulo 1 como consumidor de `GET /api/reservations` | Los planes quedaron desactualizados; los números de FR de `generate-direct-reservation` y `update-reservation` cambiaron |
| E15 | `mod-1-2-3.drawio` | Cambiar la flecha "Consultar reservas" (M1 → M2, REST) por "Lista de reservas del día" (M2 → M1, cola) | Decisión del negocio del 2026-09-28 |
| E16 | `DIAGRAMA.drawio` (casos de uso) y `guia_flujo_reservas.html` | Quitar a Migración como actor de "Exportar archivo SIRE" y ponerlo a cargo de la Recepcionista; en `mod-1-2-3.drawio`, anotar que la flecha de check-out también lleva datos migratorios | Decisión del negocio del 2026-09-28 |
| E17 | `base/plan.md`, `process-foreign-guest-data/plan.md` y `export-sire-file/plan.md` | Actualizar a `MigratoryMovement` por huésped y tipo, `foreignGuests` en check-in y check-out y actor Recepcionista | Decisión del negocio del 2026-09-28 |
