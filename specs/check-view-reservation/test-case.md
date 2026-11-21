### Test Case Specification: Consultar Reservas
**Created** : 2026-11-14  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-004-CheckViewReservation
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que la Recepcionista encuentra cualquier reserva y que el Módulo 1 tiene siempre
la lista del día al día:
- el listado muestra todas las reservas de a 10 por página, abre en las llegadas de hoy y se acota por estado,
  canal, agencia, conflicto y fechas de estadía, con el orden y las páginas correctos (FR-001 a FR-005b);
- la búsqueda por código lleva a la reserva sin importar los filtros, y el detalle muestra todos sus datos,
  también los de la cancelación (FR-006);
- la búsqueda por titular encuentra sus reservas por documento exacto o por parte del nombre (FR-004);
- el Módulo 3 y el Módulo 1 consultan una reserva o un rango de fechas sin recibir datos que no les tocan
  (FR-022 y FR-023);
- el Módulo 1 recibe una sola lista del día con las reservas activas que llegan ese día, y después una
  actualización por cada cambio que la afecta, en orden (FR-012 a FR-021);
- los filtros y códigos inválidos dan un `400` controlado, nunca un `500`, y los logs no muestran datos
  personales (FR-009 y NFR-003).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Consultar Reservas | Specification Document | [specs/check-view-reservation/spec.md](spec.md) |
| Consultar Reservas | Plan Document | [specs/check-view-reservation/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) y primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* En la demo, la lista del día y sus actualizaciones las recibe el Módulo 1 real, y el Check-In y el Check-Out
  solo los publica él. Por eso las secciones 1 a 5 se ejecutan en local, donde la lista se lee en una cola
  propia y el Check-In y el Check-Out se publican a mano, salvo los pasos con reservas de Booking, que se
  ejecutan en la demo. La sección 6 se ejecuta en la demo.
* En la demo no se ve el aviso al Módulo 1 de una reserva de Booking (sección 5, paso 9): lo cubre
  `backend/test/integration/check-view-reservation/daily-list-updates-scenarios.spec.ts`.
* La lista del día se envía a las 00:00, o al arrancar el backend si ese día no salió, y el cierre del día
  corre a las 00:00:30, o al arrancar. Los pasos que los usan se ejecutan al día siguiente (sección 4 y sección
  5, paso 8), arrancando el backend local.
* No se pueden armar a mano, y los cubren las pruebas automatizadas:
  * un día sin llegadas (lista con cero reservas): `daily-list-scenarios.spec.ts`;
  * la publicación que falla y se reintenta en orden, con las actualizaciones esperando detrás de la lista:
    `daily-list-rabbitmq-outage.spec.ts`;
  * la reserva de Booking que queda con una habitación sin asignar (`ROOM_UNASSIGNED`):
    `daily-list-updates-scenarios.spec.ts`;
  * un texto que coincide a la vez con la referencia de una reserva y el código de Booking de otra:
    `search-and-detail-scenarios.spec.ts`;
  * una reserva `PENDING` con llegada hoy, porque Booking envía las reservas confirmadas:
    `backend/test/integration/use-cases/check-view-reservation/generate-daily-list.spec.ts`.
* Que una reserva que ya tuvo Check-In antes del día de su llegada no viaje en la lista lo cubre la misma
  `generate-daily-list.spec.ts`; estos pasos no la arman.
* NFR-001 (búsqueda por código en menos de 500 ms), NFR-002 (una página en menos de 1 s con 50 000 reservas),
  NFR-004 (la lista en menos de 1 min con 500 reservas) y NFR-005 (cada actualización en menos de 5 s) se miden
  en `check-view-load.spec.ts` y `daily-list-publication.spec.ts`. A mano solo se observan como cota superior.

##### Dependencies & Assumptions
* TC-009-GenerateDirectReservation debe pasar primero: las reservas que se consultan se crean desde el
  frontend.
* TC-013-UpdateReservation y TC-002-CancelReservation se usan para provocar las actualizaciones de la
  sección 5.
* Los pasos con reservas de Booking necesitan que la demo tenga alguna; si no la tiene, se crea en el hotel de
  prueba como en TC-010-GenerateOtaReservation.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live*, y el entorno local listo. Fechas
  relativas: `hoy` es la fecha del hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después.
  En pantalla, las fechas se ven como `DD/MM/AAAA`. Las categorías del Módulo 1 real son `BOUTIQUE`, `DOBLE`,
  `SENCILLA` y `SUITE`; si una no tiene cupo en las fechas de un paso, se usa otra con habitaciones libres y la misma
  capacidad.
* **Titular de prueba (T)**, ficticio, el mismo en todas las reservas propias: nombre `María José`, apellido
  `Gómez`, `Cédula de ciudadanía` `1000000044`, nacionalidad `Colombia`, teléfono `3000000000` y correo
  `maria.prueba@example.com`. Desde la segunda reserva, el formulario lo reconoce por su documento.
* **Environment** :
  * Local (secciones 1 a 5, salvo los pasos que dicen "En la demo"), con los "Primeros pasos" del README:
    frontend en `http://localhost:5173`, documentación de la API en `http://localhost:3000/api/docs` y el panel
    de RabbitMQ en `http://localhost:15672`, con el usuario y la clave del README. `backend/.env.example` ya
    apunta a los Módulos 1 y 3 reales; si el Módulo 1 tarda más de lo que espera el backend local, subir
    `MODULE1_TIMEOUT_MS` a `2000`, como en la demo. La lista del día y sus actualizaciones se leen en
    `m1.reservas.diarias.queue`, creada como dice TC-002-CancelReservation ("Lista del día en local"). El
    Check-In y el Check-Out se publican a mano en `hospitua.events`: el cuerpo C1 de TC-002-CancelReservation
    (huésped colombiano) y el cuerpo C2, que es C1 con `documentType` `PAS`, `documentNumber` `X0000001`,
    `nationality` `Venezuela`, `originPlace` `Caracas, Venezuela` y `destinationPlace` `Cartagena, Colombia`
    (huésped extranjero, que entra al archivo SIRE).
  * Staging, la demo de Render (pasos con Booking y sección 6):
    * frontend: `https://hospitua-m2-frontend.onrender.com`;
    * backend: `https://hospitua-m2-backend.onrender.com/api/docs`.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * claves `X-Internal-Key` de los Módulos 1 y 3 para `backend/.env`, si las exigen: las tiene quien administra
    la demo;
  * Booking: el acceso al hotel de prueba `10485037`, solo para la sección 5, paso 9. Las credenciales no se
    escriben en este documento.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Listado con filtros, orden y páginas (User Story 1)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Arrancar en local y entrar | Con el backend y el frontend arriba y la cola de la lista del día creada, abrir el frontend y entrar | `Laura Méndez` | Reservas abre en "Hoy", con "Llegadas del <hoy>". Encima, el resumen con "Llegadas esperadas hoy", "Salidas esperadas hoy" y "Día operativo" `<hoy>` | [ ] | Anotar las llegadas esperadas (L) |
| 2 | Crear R1, con llegada hoy | Nueva reserva directa con el titular T | `DOBLE`; entrada `hoy`, salida `hoy+2`; 1 habitación, 2 personas | La reserva queda creada. De vuelta en Reservas, "Llegadas esperadas hoy" muestra L+1 y R1 aparece en "Hoy" (FR-005a) | [ ] | Anotar el código |
| 3 | Crear R2, futura y con dos habitaciones | Nueva reserva directa con el titular T | `SUITE`; entrada `hoy+20`, salida `hoy+22`; 2 habitaciones, 3 y 2 personas | La reserva queda creada y no aparece en "Hoy" | [ ] | Anotar el código |
| 4 | Crear R3 y cancelarla | Nueva reserva directa con el titular T, y después cancelarla | `SENCILLA`; entrada `hoy+25`, salida `hoy+26`; motivo `Prueba de consulta` | R3 queda "Cancelada" | [ ] | Anotar el código |
| 5 | Crear R4 y completarla | Nueva reserva directa con el titular T. Publicar su Check-In con el cuerpo C2 y después su Check-Out | `SENCILLA`; entrada `hoy`, salida `hoy+1`; 1 habitación | R4 queda "Completada". "Hoy" muestra R1 y R4, en cualquier estado, y no R2 ni R3. "Llegadas esperadas hoy" sigue en L+1: R4 ya no se espera (escenario 1a) | [ ] | Anotar el código |
| 6 | Ver todas las reservas | Elegir "Todas", sin otros filtros | N/A | "N reservas" y "Página 1 de ⌈N/10⌉", con hasta 10 filas ordenadas de la llegada más reciente a la más antigua. Cada fila muestra Ref. reserva, Huésped (nombre y documento), Habitaciones (número · categoría), Canal, Fechas (in → out), Estado, Migración y Acciones. "Modificar" y "Cancelar" solo se habilitan en reservas directas "Activa" o "Pendiente" (escenario 1 y FR-005) | [ ] | Anotar N. Si N es 10 o menos, crear reservas futuras con el titular T hasta pasar de 10, para los pasos 14 y 15 |
| 7 | Filtrar por un estado | Estado → "Cancelada" | N/A | Solo reservas "Cancelada", con su propio total y sus páginas (escenario 2) | [ ] | |
| 8 | Filtrar por canal y agencia | En la demo: Reservas → "Todas"; Canal → "OTA"; Agencia → Booking.com | N/A | Solo reservas de Booking, cada una con el nombre de la agencia y su código de confirmación (escenario 3) | [ ] | Si la demo no tiene reservas de Booking: "No se encontraron reservas con los filtros aplicados." |
| 9 | Ver solo las reservas en conflicto | Limpiar filtros → "Todas" → marcar "Solo en conflicto" | N/A | Solo reservas con la marca "En conflicto", o el mensaje de que no hay resultados (FR-002a) | [ ] | |
| 10 | Filtrar por estadía | Limpiar filtros. Buscar el documento de T; Desde `hoy+21` y Hasta `hoy+25` | `1000000044` | R2 y R3, porque su estadía se cruza con el rango. R2 aparece en una sola fila, con sus dos habitaciones (escenario 4 y caso borde de varias habitaciones) | [ ] | |
| 11 | Un rango sin reservas | Cambiar el rango: Desde `hoy+22` y Hasta `hoy+24` | `1000000044` | "No se encontraron reservas con los filtros aplicados.", sin error: R2 sale el `hoy+22` y R3 llega el `hoy+25` (escenario 8) | [ ] | |
| 12 | Combinar filtros | Estado "Activa"; Desde y Hasta `hoy+21` | `1000000044` | Solo R2 (escenario 5) | [ ] | |
| 13 | Cambiar el orden | Quitar las fechas y el estado, dejar la búsqueda y elegir "Llegada: más antigua primero"; después, volver a "Llegada: más reciente primero" | `1000000044` | Primero R1 y R4, después R2 y al final R3; al volver, el orden se invierte. La búsqueda se conserva (escenario 6) | [ ] | |
| 14 | Pasar de página | Limpiar filtros → "Todas" → "Siguiente" hasta la última página | N/A | Cada página muestra 10 filas, con el mismo orden y el mismo total. La última muestra "Página p de p" con N − 10·(p−1) filas. "Anterior" está deshabilitado en la página 1 y "Siguiente", en la última (escenario 7) | [ ] | |
| 15 | Pedir una página que no existe | Abrir `http://localhost:5173/reservas?view=all&page=999` | N/A | Se muestra la última página válida, no una lista vacía (caso borde) | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: Búsqueda por código, detalle y consultas de los otros módulos (User Story 2, FR-022 y FR-023)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | El código ignora los filtros | En "Hoy", con Estado "Activa", buscar el código de R3 | Código de R3 | Solo R3, "Cancelada" (escenario 3) | [ ] | |
| 2 | Ver el detalle completo | Buscar el código de R2 → Ver detalle | Código de R2 | "Estadía y tarifa": canal "Directo", fecha de entrada `hoy+20`, de salida `hoy+22`, 2 noches, 5 personas, "Creada el" y "Observaciones". Dos habitaciones `SUITE`, con 3 y 2 personas, su valor bruto y el estado "Esperada". "Datos del huésped": `María José Gómez`, "Cédula de ciudadanía", `1000000044`, `Colombia`, el teléfono y el correo (escenario 1) | [ ] | |
| 3 | Ver el detalle de una cancelación | Buscar el código de R3 → Ver detalle | Código de R3 | El panel "Cancelación" con la fecha, el canal "Recepción", el motivo `Prueba de consulta` y procesada por `Laura Méndez` (escenario 4) | [ ] | |
| 4 | Buscar por el código de Booking | En la demo, buscar el código de confirmación de una reserva de Booking (se ve bajo su referencia en el listado) | El código de Booking | Solo esa reserva. Su detalle muestra el canal "OTA" y el "Código de la OTA", y el valor bruto vacío (escenario 2) | [ ] | Solo si la demo tiene una reserva de Booking |
| 5 | Una referencia que no existe | Buscar una referencia interna sin reserva | `RSV-FFFFFFFF` | "La reserva no existe." (escenario 5) | [ ] | |
| 6 | Un texto que no es referencia y no coincide | Buscar un texto con dígitos que no es de ninguna reserva | `ZZ-0000000` | "No se encontraron reservas con los filtros aplicados.": se buscó como documento, no como referencia (escenario 5) | [ ] | |
| 7 | Un código con caracteres inválidos | Buscar un texto con un carácter no permitido | `RSV-12#4` | "Debe proveer un código de reserva válido para la consulta." (escenario 6) | [ ] | |
| 8 | Consulta del Módulo 3 | Documentación de la API → `GET /api/reservations/{reservationRef}` con `X-Client` `MODULE3` | Código de R2 | `200` con `reservationRef`, `channel` `DIRECT`, `quoteIds` con dos elementos y `rooms` con el `roomId` y el `quoteId` de cada habitación. Sin datos del huésped ni otros datos financieros (FR-022) | [ ] | |
| 9 | Consulta del Módulo 3 de una reserva que no existe | La misma consulta con `MODULE3` y después con `RECEPTIONIST` | `RSV-FFFFFFFF` | `404` con el código `RESERVATION_NOT_FOUND` para el Módulo 3, y `400` con el mismo código para la Recepcionista | [ ] | |
| 10 | Consulta del Módulo 1 por fechas | `GET /api/reservations` con `X-Client` `MODULE1` | `dateFrom` `hoy+21`, `dateTo` `hoy+25` | `200` con R2: `reservationRef`, `status`, `startDate`, `endDate` y, por habitación, `roomId`, `roomNumber` y `categoryRoom`. No trae R3 (cancelada), ni datos del huésped ni financieros (FR-023) | [ ] | |
| 11 | El Módulo 1 con un filtro de la Recepcionista | La misma consulta, con un parámetro más | `status` `ACTIVE` | `400` con el código `UNSUPPORTED_PARAMETER` | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Búsqueda por titular (User Story 3, FR-005b y NFR-003)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Buscar por documento desde "Hoy" | Limpiar filtros, elegir "Hoy" y buscar el documento de T | `1000000044` | R1 "Activa", R2 "Activa", R3 "Cancelada" y R4 "Completada", aunque solo dos lleguen hoy: la búsqueda no se limita a las llegadas de hoy (escenarios 1 y 1b) | [ ] | |
| 2 | Ver el estado migratorio | En el mismo resultado, la columna "Migración" | N/A | R1 y R2 "Pendiente de Check-In", R3 "Sin Check-In" y R4 "Completo", porque su huésped es extranjero (FR-005b) | [ ] | "Sin extranjeros" se ve en la sección 5, paso 5 |
| 3 | Buscar por parte del nombre | Buscar en minúsculas y sin tilde | `gomez` | El resultado incluye R1, R2, R3 y R4 (escenario 2) | [ ] | |
| 4 | Combinar el titular con un estado | Buscar el documento y elegir Estado "Activa" | `1000000044` | Solo R1 y R2 (escenario 3) | [ ] | |
| 5 | Un nombre demasiado corto | Buscar dos letras | `go` | "La búsqueda por nombre requiere al menos 3 caracteres." (escenario 4) | [ ] | |
| 6 | Revisar que los logs no tienen datos personales | En la terminal del backend local, buscar el documento y el apellido en todo lo que escribió desde el arranque | `1000000044` y `Gómez` | Ninguna coincidencia (NFR-003) | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: Lista del día para el Módulo 1 (User Story 4)
Los pasos 1 y 2 se ejecutan un día (D) y los demás, al día siguiente (D+1), antes de hacer cambios ese día.
Entre los dos días, el backend local queda apagado.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Preparar tres llegadas activas para mañana | El día D, crear tres reservas directas con el titular T | L1: `DOBLE`, entrada `hoy+1`, salida `hoy+2`, 1 habitación y 2 personas. L2: `SUITE`, entrada `hoy+1`, salida `hoy+3`, 2 habitaciones con 3 y 2 personas. L3: `SENCILLA`, entrada `hoy+1`, salida `hoy+2`, 1 habitación y 1 persona | Las tres quedan "Activa" y la cola de la lista del día no recibe actualizaciones de ellas | [ ] | Anotar los códigos |
| 2 | Preparar dos reservas que no deben viajar | El día D, crear L4 y cancelarla, y crear L5. Después, apagar el backend local | L4: `DOBLE`, entrada `hoy+1`, salida `hoy+2`. L5: `DOBLE`, entrada `hoy+2`, salida `hoy+3` | L4 queda "Cancelada" y L5, "Activa" | [ ] | Anotar los códigos |
| 3 | Ver la lista recibida | El día D+1, arrancar el backend local y leer la cola | N/A | Una sola lista (`reserva.lista-del-dia`) con `sequenceNumber` 1, la `operationalDate` del D+1 y sus totales: `totalReservations` N, `totalRooms` M y `totalGuests` P. Cada reserva trae su referencia, estado, fechas, personas, habitaciones con número y categoría, y el titular con su documento, teléfono y correo, sin importes, comisiones, tarifas ni número de noches (FR-014 y FR-015) | [ ] | Anotar N, M y P |
| 4 | Comparar la lista con el listado | Reservas → "Hoy" → Estado "Activa" | N/A | N filas, entre ellas L1, L2 y L3, y no L4 (cancelada) ni L5 (llega mañana). M es la suma de sus habitaciones y P, la de sus personas (en el detalle). Si no hay otras llegadas ese día: 3 reservas, 4 habitaciones y 8 huéspedes (escenarios 1 y 2) | [ ] | |
| 5 | No se reenvía la lista | Apagar el backend local y volver a arrancarlo. Leer la cola | N/A | No llega otra lista del D+1 (escenario 4) | [ ] | |
| 6 | Los cambios siguientes viajan como actualizaciones | Crear una reserva directa con llegada hoy | `SENCILLA`; entrada `hoy`, salida `hoy+1` | En la cola, una actualización `ADDED` con su `reservationRef` y el `sequenceNumber` siguiente al último del D+1 (escenario 4) | [ ] | |
| 7 | Cancelar las reservas de prueba | Cancelar L1, L2, L3, L5 y la reserva del paso 6 | N/A | Quedan "Cancelada". En la cola, un `REMOVED` con `removalReason` `CANCELLED` por cada una de las que llegan hoy, y nada de L5 | [ ] | |

--------------------------------------------------------------------------------

##### Section 5: Actualizaciones de la lista del día (User Story 5)
Requiere que la lista del día ya se haya enviado (sección 1, paso 1). Cada aviso se lee en la cola de la lista
del día.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una reserva nueva para hoy | Crear U1 con el titular T | `DOBLE`; entrada `hoy`, salida `hoy+1`; 1 habitación, 2 personas | En pocos segundos, un `ADDED` de U1 con `sequenceNumber` s y la `operationalDate` de `hoy` (escenario 1) | [ ] | NFR-005: menos de 5 s |
| 2 | Un cambio en una reserva de la lista | Modificar U1: agregar una habitación `DOBLE` con 2 personas y confirmar | N/A | Un `UPDATED` de U1, con un `sequenceNumber` mayor que s. El detalle de U1 muestra 2 habitaciones y 4 personas (escenario 3) | [ ] | |
| 3 | La cancelación sale después del cambio | Cancelar U1 | N/A | Un `REMOVED` de U1 con `removalReason` `CANCELLED` y un `sequenceNumber` mayor que el del `UPDATED`: el Módulo 1 recibe primero el cambio y después la baja (escenarios 4 y 7) | [ ] | |
| 4 | Un cambio de fecha que la saca de la lista | Crear U2 con llegada hoy. Después, modificar sus fechas y confirmar | `DOBLE`; entrada `hoy`, salida `hoy+1`; después, entrada `hoy+1`, salida `hoy+2` | Un `ADDED` de U2 al crearla, y un `REMOVED` con `removalReason` `DATE_CHANGED` al moverla (escenario 5) | [ ] | Cancelar U2 al terminar: no sale ningún aviso, porque ya no llega hoy |
| 5 | El Check-In y el Check-Out no se avisan | Crear U3 con llegada hoy, y publicar su Check-In con el cuerpo C1 y después su Check-Out | `SENCILLA`; entrada `hoy`, salida `hoy+1` | Solo el `ADDED` de U3 al crearla: el Check-In y el Check-Out no generan actualizaciones. Tras el Check-In, el listado muestra U3 "En curso" y "Sin extranjeros" (FR-017 y FR-005b) | [ ] | |
| 6 | Un cambio que no afecta a la lista | Modificar R2 (sección 1): bajar de 3 a 2 las personas de una habitación y confirmar | N/A | Ninguna actualización de R2: llega el `hoy+20` (escenario 8) | [ ] | |
| 7 | Las secuencias van seguidas | Revisar todos los mensajes de `<hoy>` leídos en la cola | N/A | Los `sequenceNumber` van de 1 en 1 desde la lista, sin saltos ni repetidos (SC-008) | [ ] | |
| 8 | El no-show sale al cierre del día | Al día siguiente, arrancar el backend local, leer la cola y abrir R1 (sección 1) | Código de R1 | Un `REMOVED` de R1 con `removalReason` `NO_SHOW` y la `operationalDate` del día anterior. R1 está "No se presentó" y "Sin Check-In" (escenario 6) | [ ] | Se ejecuta al día siguiente |
| 9 | Una reserva de Booking para hoy | En la demo: en el hotel de prueba de Booking `10485037`, reservar con llegada hoy y datos ficticios | Llegada `hoy`, salida `hoy+1` | Antes de un minuto, la reserva aparece en Reservas de la demo. Su aviso `ADDED` al Módulo 1 está en las limitaciones (escenario 2) | [ ] | Requiere acceso a Booking. Cancelarla en Booking al terminar |

--------------------------------------------------------------------------------

##### Section 6: Filtros inválidos (User Story 1, escenario 9, FR-009 y casos borde)
Se ejecuta en la demo. Todos por la documentación de la API, con `GET /api/reservations` y `X-Client`
`RECEPTIONIST`.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Un estado que no existe | `status` | `ARCHIVED` | `400` `INVALID_STATUS`: "El estado indicado no es válido." | [ ] | |
| 2 | Un canal que no existe | `source` | `PHONE` | `400` `INVALID_CHANNEL`: "El canal indicado no es válido." | [ ] | |
| 3 | Una fecha mal formada | `dateFrom` y `dateTo` | `hoy+1` escrita como `DD/MM/AAAA`, y `hoy+2` como `AAAA-MM-DD` | `400` `INVALID_DATE`: "La fecha indicada no es válida." | [ ] | |
| 4 | Una sola fecha del rango | Solo `dateFrom` | `hoy+1` | `400` `INCOMPLETE_DATE_RANGE`: "Debe completar ambas fechas del rango." | [ ] | |
| 5 | El rango al revés | `dateFrom` y `dateTo` | `hoy+5` y `hoy+1` | `400` `INVALID_DATE_RANGE`: "La fecha inicial no puede ser posterior a la fecha final." | [ ] | |
| 6 | Un rango de más de 366 días | `dateFrom` y `dateTo` | `hoy` y `hoy+400` | `400` `DATE_RANGE_TOO_LARGE`: "El rango de fechas no puede superar 366 días." | [ ] | |
| 7 | Un orden que no existe | `order` | `random` | `400` `INVALID_SORT_ORDER`: "El orden indicado no es válido." | [ ] | |
| 8 | Una página menor a 1 | `page` | `0` | `400` `INVALID_PAGE`: "El número de página debe ser 1 o mayor." | [ ] | |
| 9 | Un filtro de conflicto inválido | `inConflict` | `quizas` | `400` `INVALID_CONFLICT_FILTER`: "El filtro de conflicto no es válido." | [ ] | |
| 10 | Un intento de inyección | `search` | `' OR 1=1 --` | `400` `INVALID_RESERVATION_CODE`: "Debe proveer un código de reserva válido para la consulta.". Ningún `500` | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si el texto buscado es un código? Tiene prioridad e ignora los demás filtros
  (sección 2, paso 1). Si tiene el formato `RSV-` y no existe: "La reserva no existe." (sección 2, paso 5).
* **EC-002** : ¿Se puede buscar por documento y por nombre a la vez? No: hay un solo cuadro, y con algún dígito
  se busca como documento; sin dígitos, como nombre (sección 2, paso 6, y sección 3).
* **EC-003** : ¿Qué pasa si un texto coincide con la referencia de una reserva y con el código de Booking de
  otra? Se listan las dos; está en las limitaciones.
* **EC-004** : ¿Qué pasa con una página que no existe? Se muestra la última página válida (sección 1, paso 15).
* **EC-005** : ¿Qué pasa con un rango de más de 366 días? `400` "El rango de fechas no puede superar 366 días."
  (sección 6, paso 6).
* **EC-006** : ¿Cómo se filtran por fecha las reservas canceladas o que no se presentaron? Por sus fechas
  planeadas (sección 1, paso 10, con R3).
* **EC-007** : ¿Qué pasa si cambian las reservas mientras se pasan las páginas? Cada página se calcula al
  pedirla: una reserva nueva puede mover otra a la página siguiente o a la anterior. No se provoca aparte; si
  pasa en la sección 1, paso 14, porque otra pestaña crea reservas, el total cambia y no es un defecto.
* **EC-008** : ¿Se repite una reserva de varias habitaciones? No: una fila, con todas sus habitaciones
  (sección 1, paso 10).
* **EC-009** : ¿Qué pasa con caracteres especiales o intentos de inyección? `400`, nunca `500` (sección 6,
  paso 10).
* **EC-010** : ¿Qué devuelve una consulta sobre una reserva cuyo estado cambia en ese momento? El último estado
  guardado; la consulta siguiente ya muestra el cambio, como el "En curso" tras el Check-In (sección 5, paso 5).
* **EC-011** : ¿Usan la vista y la búsqueda la OTA o el Módulo 1? No: con `X-Client` `MODULE1`, la misma ruta
  responde la consulta por fechas y rechaza los filtros de la Recepcionista (sección 2, pasos 10 y 11). Booking
  no llama al Módulo 2.
* **EC-012** : ¿Qué pasa con una reserva creada para hoy antes de enviar la lista? Va dentro de la lista, sin
  actualización aparte (sección 4, pasos 1 a 4).
* **EC-013** : ¿Qué pasa si falla la publicación al Módulo 1? El cambio no se revierte y el aviso se reintenta
  en orden; está en las limitaciones.
* **EC-014** : ¿Qué pasa si la lista del día no sale y mientras tanto hay cambios? Las actualizaciones esperan
  detrás de la lista: el Módulo 1 nunca recibe una antes que la lista de ese día; está en las limitaciones.
* **EC-015** : ¿Qué pasa si una reserva de la lista tiene Check-In? No se envía nada (sección 5, paso 5).
* **EC-016** : ¿Viaja en la lista una reserva que ya tuvo Check-In antes del día de su llegada? No, porque el
  Módulo 1 ya registró su ingreso; está en las limitaciones.
* **EC-017** : ¿Viaja en la lista una reserva `PENDING` con llegada hoy? No, hasta que se confirme. Hoy no
  ocurre, porque Booking envía las reservas confirmadas; está en las limitaciones.
* **EC-018** : ¿Qué pasa si una reserva de la lista cambia varias veces seguidas? Sale una actualización por
  cada cambio, cada una con su secuencia (sección 5, pasos 2, 3 y 7).
* **EC-019** : ¿Qué pasa con las actualizaciones del día anterior que salen después de medianoche? Llevan la
  fecha del día al que pertenecen (sección 5, paso 8).
* **EC-020** : ¿Qué pasa si el titular no tiene teléfono ni correo? Esos campos viajan `null` y no impiden el
  envío. En local se vería en el JSON de la lista, pero estos pasos no arman ese titular, y ninguna prueba
  automatizada lo cubre aparte.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una lista del día que no llega o llega dos veces, una cancelación de hoy que no se avisa al Módulo 1, datos personales en los logs, o un `500` con un filtro inválido. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, un filtro que trae reservas que no cumplen, un total o unas páginas equivocados, o un detalle sin el panel de la cancelación. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, una fecha que no se muestra como `DD/MM/AAAA`, o una etiqueta de estado mal escrita. |
