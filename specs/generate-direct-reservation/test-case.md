### Test Case Specification: Generar Reservación Directa
**Created** : 2026-11-15  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-009-GenerateDirectReservation
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que la Recepcionista crea una reserva directa confirmada, con una o varias
habitaciones, sin sobreventa y sin cobro:
- la pantalla verifica la disponibilidad y cotiza cada habitación sola, asigna la habitación disponible de
  menor número y crea la reserva en `ACTIVE`, con sus habitaciones en `EXPECTED`, su tarifa y su cotización
  (escenarios 1, 4 y 5, FR-002, FR-005 y FR-006);
- si la llegada es hoy, el Módulo 1 recibe la reserva; si es futura, no recibe nada (FR-009 y SC-004);
- el titular de una reserva anterior se precarga por su documento, y sus datos se copian sin ligar las
  reservas (escenarios 10 y 11, FR-011);
- un doble envío no crea dos reservas (escenario 8 y FR-008);
- una habitación no disponible, más personas de las que caben, fechas inválidas, datos mal formados o el
  Módulo 3 sin responder bloquean la reserva con un `400`, nunca un `500` (escenarios 2, 3, 6, 7 y 9, FR-001,
  FR-001a, FR-004 y FR-010).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Generar Reservación Directa | Specification Document | [specs/generate-direct-reservation/spec.md](spec.md) |
| Generar Reservación Directa | Plan Document | [specs/generate-direct-reservation/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) y primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La pantalla no deja elegir una habitación concreta: asigna sola la disponible de menor número. La habitación
  pedida por su `roomId` se prueba por la API (sección 5, paso 2).
* Las tarifas las calcula el Módulo 3 real con sus reglas de temporada: no hay valores fijos. Cada paso anota
  la tarifa que muestra la vista previa y la compara con la de la reserva creada.
* En la demo, la lista del día y sus actualizaciones las recibe el Módulo 1 real. Por eso las secciones 1 a 3
  se ejecutan en local, donde se leen en una cola propia; la sección 3 también, porque precarga al titular de
  la sección 1. El Módulo 3 sin responder también se prueba en local (sección 7, paso 1), como en
  TC-001-CalculateDynamicRate, sección 4.
* No se pueden provocar a mano, y los cubre `backend/test/integration/generate-direct-reservation/`:
  * dos creaciones exactamente a la vez sobre la última habitación (`AVAILABILITY_TAKEN`):
    `direct-reservation-concurrency.spec.ts`;
  * un Módulo 3 que cotiza unas habitaciones y falla en otra: `direct-reservation-edge-cases.spec.ts`;
  * NFR-001, el cruce local de reservas en menos de 200 ms: `crossing-time.spec.ts`.
* La comisión en `0` y el `quoteId` de cada habitación no se muestran en pantalla. Se ven en la consulta del
  Módulo 3 y, opcionalmente, en la base local.

##### Dependencies & Assumptions
* TC-007-ConsultRoomInventory, TC-006-ConsultMaintenanceCalendar, TC-003-CheckRoomAvailability y
  TC-001-CalculateDynamicRate deben pasar primero: la reserva usa el inventario, el calendario, la
  verificación y la cotización.
* El aviso al Módulo 1 sale por la lista del día, que verifica TC-004-CheckViewReservation.

##### Preconditions & Default Setup
* **Initial State** : el entorno local listo y la demo desplegada, con sus servicios en *Live* y las claves
  `X-Internal-Key` que exijan los Módulos 1 y 3 en el panel de Render. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. En pantalla, las fechas se ven
  como `DD/MM/AAAA` y los valores como `440.000,00 COP`.
* **Habitaciones del Módulo 1** (al 2026-11-21): `BOUTIQUE` 205, 304, 407, 408 y 409; `DOBLE` 103, 109, 202,
  203 (3 personas) y 302, de 2 personas; `SENCILLA` 101, 102, 201, 301 y 410; `SUITE` 105, 204, 303 y 604.
  Antes de ejecutar, compararlas con `GET https://gestionophospitua.tech/api/rooms`; si cambiaron, ajustar las
  habitaciones esperadas.
* **Mantenimiento que se le pide al Módulo 1** (sección 5, paso 2, y sección 7, pasos 2 y 3): la 303 (`SUITE`,
  `roomId` `a0000000-0000-0000-0000-000000000303`), del `hoy+15` al `hoy+18`, el mismo de
  TC-003-CheckRoomAvailability. Comprobarlo con
  `GET https://gestionophospitua.tech/api/rooms/a0000000-0000-0000-0000-000000000303/maintenances?startDate=…&endDate=…`.
* **Titulares ficticios** : H1, `Andrés Prueba`, `Cédula de ciudadanía` `1000000091`, `Colombia`, teléfono
  `3000000091`, correo `andres.prueba@example.com`; H2, `Lucía Prueba`, `Cédula de ciudadanía` `1000000092`,
  `Colombia`, sin teléfono ni correo. Si un documento ya se usó en una ejecución anterior en el mismo entorno,
  se precarga: se usa otro número sin reservas.
* **Reservas de la demo** : si una categoría no tiene cupo en las fechas de un paso, se usa otra con las
  mismas habitaciones libres.
* **Environment** :
  * Local (secciones 1 a 3 y sección 7, paso 1), con los "Primeros pasos" del README: frontend en
    `http://localhost:5173`, documentación de la API en `http://localhost:3000/api/docs` y el panel de RabbitMQ
    en `http://localhost:15672`, con el usuario y la clave del README. `backend/.env.example` ya apunta a los
    Módulos 1 y 3 reales. La lista del día y sus actualizaciones se leen en `m1.reservas.diarias.queue`, creada
    como dice TC-002-CancelReservation ("Lista del día en local").
  * Staging, la demo de Render (secciones 4 a 6 y sección 7, pasos 2 y 3):
    * frontend: `https://hospitua-m2-frontend.onrender.com`;
    * backend: `https://hospitua-m2-backend.onrender.com/api/docs`.
  * Módulo 3: `https://hospitua-module-3.onrender.com`. Está en el plan gratuito de Render: abrir su `/docs`
    antes de empezar, para que no esté dormido.
* **Cuerpo V1** de la vista previa (`POST /api/reservations/direct/preview`): el de
  TC-006-ConsultMaintenanceCalendar. **Cuerpo R1** de la creación (`POST /api/reservations/direct`, con las
  cabeceras `X-User` e `Idempotency-Key`, un UUID):

  ```json
  {
    "startDate": "<hoy+80>",
    "endDate": "<hoy+81>",
    "categoryRoom": "DOBLE",
    "rooms": [{ "guestCount": 1 }],
    "guest": {
      "firstName": "Lucía",
      "lastName": "Prueba",
      "documentType": "CC",
      "documentNumber": "1000000092",
      "nationality": "Colombia",
      "contactPhone": null,
      "contactEmail": null
    },
    "notes": null,
    "expectedRates": [{ "position": 1, "lodgingAmount": "<el de la vista previa>", "currency": "COP" }]
  }
  ```
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * claves `X-Internal-Key` de los Módulos 1 y 3 para `backend/.env`, si las exigen: las tiene quien administra
    la demo;
  * el contacto del Módulo 1, para el mantenimiento.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Reserva con llegada hoy (escenario 1, FR-005, FR-006, FR-009 y SC-001)
Se ejecuta en local, con la cola de la lista del día creada y el backend arrancado: la lista del día ya salió.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Abrir el formulario | Entrar al frontend → Reservas → "+ Nueva reserva directa" | `Laura Méndez` | "Nueva reserva directa", con "Estadía", "Habitaciones", "Disponibilidad y tarifa" y "Titular". "Crear reserva" está deshabilitado | [ ] | Tomar el tiempo desde aquí (SC-001) |
| 2 | Pedir la estadía | Llenar las fechas, la categoría y las personas | Entrada `hoy`, salida `hoy+2`; `DOBLE`; 1 habitación, 2 personas | Sin otro clic, "Consultando disponibilidad…" y después "N habitaciones DOBLE disponibles." y una fila con la habitación asignada, 2 personas, 2 noches y la tarifa del Módulo 3. La habitación es la `DOBLE` disponible de menor número (la 103 va antes que la 109) | [ ] | Anotar la tarifa (TA) |
| 3 | Escribir un documento sin reservas | Titular → Tipo de documento y No. documento | H1: `Cédula de ciudadanía` `1000000091` | "No hay reservas con ese documento: escriba los datos del titular." (escenario 11) | [ ] | |
| 4 | Completar y crear | Nombres, Apellidos, País de origen, Teléfono, Email y Observaciones → "Crear reserva" | H1; observaciones `Llega tarde` | El botón muestra "Creando…" y se abre el detalle de la reserva nueva. Desde el paso 1, menos de 1 minuto (SC-001) | [ ] | Anotar el código |
| 5 | Revisar la reserva | El detalle de la reserva | N/A | "Activa", canal "Directo", sin "Código de la OTA"; entrada `hoy`, salida `hoy+2`, 2 noches, 2 personas, observaciones `Llega tarde`. Una habitación `DOBLE` con 2 personas, valor bruto TA y estado "Esperada". Los datos del huésped de H1 (escenario 1, FR-005 y FR-006) | [ ] | |
| 6 | Ver el aviso al Módulo 1 | Panel de RabbitMQ → `m1.reservas.diarias.queue` → Get messages | Código del paso 4 | Una actualización `ADDED` con ese `reservationRef` y la `operationalDate` de `hoy`: la llegada es hoy y la lista del día ya se envió (FR-009) | [ ] | |
| 7 | Ver la cotización guardada | Documentación de la API → `GET /api/reservations/{reservationRef}` con `X-Client` `MODULE3` | Código del paso 4 | `channel` `DIRECT`, `quoteIds` con un elemento, `rooms` con el `roomId` y el `quoteId` de la habitación, y `ota` en `null` (FR-006) | [ ] | |
| 8 | Revisar la base | Opcional, con un cliente de PostgreSQL contra la base local (los datos de conexión están en `backend/.env`): `SELECT r.source, r.status, r.commission_percentage, r.commission_amount, r.external_confirmation_code, rr.room_gross_amount, rr.quote_id, rr.stay_status FROM reservation r JOIN reservation_room rr ON rr.reservation_id = r.id WHERE r.reservation_ref = '<código>';` | Código del paso 4 | `DIRECT`, `ACTIVE`, comisión `0` y `0`, código externo vacío; la habitación con TA, el `quote_id` del paso 7 y `EXPECTED` (SC-002) | [ ] | Opcional |

--------------------------------------------------------------------------------

##### Section 2: Llegada futura con varias habitaciones (escenarios 4 y 5)
Se ejecuta en local.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Pedir dos habitaciones | Nueva reserva directa → "+ Agregar habitación" | Entrada `hoy+45`, salida `hoy+47`; `SUITE`; 2 habitaciones, 2 personas en cada una | Dos filas, con las dos `SUITE` disponibles de menor número (105 y 204, si están libres), 2 noches y cada una con su tarifa del Módulo 3 | [ ] | Anotar las dos tarifas |
| 2 | Crear la reserva | Titular H2 → "Crear reserva" | H2 | Se abre el detalle: una sola reserva "Activa" con 4 personas y dos habitaciones "Esperada", cada una con el valor bruto anotado en el paso 1 (escenario 5) | [ ] | Anotar el código |
| 3 | Revisar que no se avisa al Módulo 1 | Leer la cola de la lista del día | Código del paso 2 | Ninguna actualización con ese `reservationRef`: viajará en la lista del día de su llegada (escenario 4 y SC-004) | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Precarga del titular (escenarios 10 y 11, FR-011)
Se ejecuta en local.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Precargar un titular conocido | Nueva reserva directa con una estadía libre. Titular → el documento de H1 | Entrada `hoy+60`, salida `hoy+61`; `DOBLE`; 1 habitación, 1 persona; `Cédula de ciudadanía` `1000000091` | "Se precargaron los datos de la última reserva con ese documento." y el formulario con el nombre, el apellido, el país, el teléfono y el correo de H1 (escenario 10) | [ ] | |
| 2 | Corregir un dato y crear | Cambiar el teléfono → "Crear reserva" | Teléfono `3000000099` | La reserva nueva muestra el teléfono `3000000099` | [ ] | Anotar el código |
| 3 | La reserva anterior no cambia | Abrir la reserva de la sección 1 | Código de la sección 1 | Su teléfono sigue en `3000000091`: los datos se copiaron, no se ligaron | [ ] | |
| 4 | La precarga toma la reserva más reciente | Nueva reserva directa → el documento de H1 otra vez | `1000000091` | Se precarga el teléfono `3000000099`, el de la reserva del paso 2 | [ ] | Salir sin crear |
| 5 | Dejar limpio el entorno local | Cancelar las reservas de las secciones 1, 2 y 3 | N/A | Quedan "Cancelada". En la cola, un `REMOVED` con `removalReason` `CANCELLED` solo por la de la sección 1, que llega hoy | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: Doble envío y tarifas (escenario 8 y FR-008)
Se ejecuta en la demo.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Doble clic en "Crear reserva" | Nueva reserva directa, y doble clic rápido en "Crear reserva" | Entrada `hoy+70`, salida `hoy+71`; `DOBLE`; 1 habitación; H2 | Se crea una sola reserva: buscando el documento de H2 con Desde y Hasta `hoy+70` aparece una sola | [ ] | Anotar el código |
| 2 | Pedir la tarifa por la API | `POST /api/reservations/direct/preview` con V1 | Entrada `hoy+80`, salida `hoy+81`; `DOBLE`; 1 habitación | `200`, con el `lodgingAmount` de la habitación en `COP` | [ ] | Anotar el `lodgingAmount` |
| 3 | Crear por la API | `POST /api/reservations/direct` con R1 y un `Idempotency-Key` nuevo | R1, con el `lodgingAmount` del paso 2; `X-User` `Laura Méndez` | `201` con la reserva en `ACTIVE` | [ ] | Anotar el código y la clave |
| 4 | Reenviar la misma solicitud | La misma llamada, con la misma clave y el mismo cuerpo | La misma | `201` con la misma reserva del paso 3: no se crea otra (escenario 8) | [ ] | |
| 5 | Reusar la clave con otros datos | La misma clave, con otras observaciones | `"notes": "Otra cosa"` | `400` con el código `IDEMPOTENCY_KEY_REUSED` y "La solicitud ya se usó con otros datos." | [ ] | |
| 6 | Crear sin clave | R1 sin `Idempotency-Key` | R1 | `400` con el código `IDEMPOTENCY_KEY_REQUIRED` y "Falta el identificador de la solicitud." | [ ] | |
| 7 | Crear con una tarifa que ya no vale | R1 con otra clave y otro `lodgingAmount` | Un `lodgingAmount` distinto del del paso 2 | `400` con el código `RATE_CHANGED` y "La tarifa cambió, vuelva a cotizar.", sin reserva | [ ] | |
| 8 | Dejar limpia la demo | Cancelar las reservas de los pasos 1 y 3 | N/A | Quedan "Cancelada" | [ ] | |

--------------------------------------------------------------------------------

##### Section 5: Habitaciones no disponibles y personas (escenarios 2, 6 y 7)
Se ejecuta en la demo.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Más habitaciones de las disponibles | Nueva reserva directa | Entrada `hoy+30`, salida `hoy+31`; `SUITE`; 5 habitaciones (la categoría tiene 4) | "Error 400: La habitación no está disponible para el rango de fechas solicitado", sin tarifa, y "Crear reserva" deshabilitado (escenario 2) | [ ] | |
| 2 | Una habitación del grupo no disponible | `POST /api/reservations/direct/preview` con la 105 y la 303 por su `roomId` | `SUITE`; entrada `hoy+16`, salida `hoy+17`; `rooms` `[{"guestCount": 1, "roomId": "a0000000-0000-0000-0000-000000000105"}, {"guestCount": 1, "roomId": "a0000000-0000-0000-0000-000000000303"}]` | `400` con el código `ROOM_NOT_AVAILABLE` y "La habitación 303 no está disponible para el rango de fechas solicitado.": está en mantenimiento (escenario 6) | [ ] | |
| 3 | Más personas de las que caben | Nueva reserva directa | `DOBLE`; entrada `hoy+30`, salida `hoy+31`; 1 habitación, 4 personas | "La cantidad de personas supera la capacidad de la habitación." y "Crear reserva" deshabilitado (escenario 7) | [ ] | |
| 4 | Una habitación sin personas | V1 por la API | `rooms` `[{"guestCount": 0}]` | `400` con el código `GUEST_COUNT_TOO_LOW` y "Cada habitación debe tener al menos una persona." (escenario 7) | [ ] | La pantalla no consulta con 0 personas |
| 5 | Personas que no son un entero | V1 por la API | `rooms` `[{"guestCount": 1.5}]` | `400` con el código `INVALID_GUEST_COUNT` y "La cantidad de personas debe ser un número entero mayor que cero." | [ ] | |
| 6 | La misma habitación dos veces | V1 por la API | `rooms` con el mismo `roomId` dos veces | `400` con el código `ROOM_ALREADY_IN_RESERVATION` y "La habitación ya forma parte de la reserva." | [ ] | |
| 7 | Ninguna habitación o más de 10 | En pantalla, agregar habitaciones hasta 10. Después, V1 por la API con `rooms` vacío y con 11 | `[]` y 11 habitaciones | En pantalla, "+ Agregar habitación" desaparece en la décima. La API responde `400` con el código `INVALID_ROOM_COUNT` y "Una reserva debe tener entre 1 y 10 habitaciones." en los dos casos | [ ] | |

--------------------------------------------------------------------------------

##### Section 6: Fechas y datos inválidos (escenario 9, FR-001a, casos borde y FR-010)
Se ejecuta en la demo.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Entrada antes de hoy | V1 por la API | Entrada `hoy-1`, salida `hoy+1` | `400` con el código `START_DATE_IN_PAST` y "La fecha de entrada no puede ser anterior a hoy.". La entrada `hoy` sí se acepta (sección 1) (escenario 9) | [ ] | |
| 2 | Salida igual a la entrada | V1 por la API | Entrada y salida `hoy+30` | `400` con el código `INVALID_RESERVATION_DATES` y "La fecha de salida debe ser posterior a la de entrada." | [ ] | |
| 3 | Una fecha que no existe | V1 por la API | Entrada el 30 de febrero del año siguiente | `400` `INVALID_RESERVATION_DATES`, sin consultar disponibilidad ni cotizar | [ ] | |
| 4 | Observaciones demasiado largas | R1 por la API, con otra clave | `notes` de 501 caracteres | `400` con el código `NOTES_TOO_LONG` y "Las observaciones no pueden superar 500 caracteres." | [ ] | La pantalla no deja escribir más de 500 |
| 5 | Caracteres no válidos | R1 por la API, con otra clave | `"notes": "<script>alert(1)</script>"` | `400` con el código `INVALID_CHARACTERS` y "El formato de los datos contiene caracteres no válidos." | [ ] | |
| 6 | Titular incompleto | R1 por la API, con otra clave y sin `firstName` | N/A | `400` con el código `GUEST_DATA_REQUIRED` y "Los datos del titular son obligatorios." | [ ] | |

--------------------------------------------------------------------------------

##### Section 7: Módulo 3 sin responder y la última habitación (escenario 3 y casos borde)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | El Módulo 3 no responde | En local, con el Módulo 3 sin responder como en TC-001-CalculateDynamicRate, sección 4. Nueva reserva directa. Al terminar, devolver la dirección real del Módulo 3 | `DOBLE`; entrada `hoy+30`, salida `hoy+31`; 1 habitación | "Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde", sin tarifa y sin poder crear la reserva (escenario 3 y FR-004) | [ ] | |
| 2 | Dos pestañas por las mismas habitaciones | En la demo, abrir Nueva reserva directa en dos pestañas con la misma estadía hasta ver la tarifa en las dos | `SUITE`; entrada `hoy+16`, salida `hoy+17`; 2 habitaciones (la 303 está en mantenimiento: quedan 3 libres) | Las dos pestañas muestran la tarifa: la consulta no aparta habitaciones | [ ] | |
| 3 | Crear en las dos | Crear en la primera con H1 y después en la segunda con H2 | N/A | La primera se crea. La segunda responde "Error 400: La habitación no está disponible para el rango de fechas solicitado" y vuelve a consultar: no hay sobreventa (SC-003) | [ ] | Cancelar la reserva creada al terminar |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa con fechas incoherentes o que no existen? `400`, sin consultar disponibilidad ni
  cotizar (sección 6, pasos 1 a 3).
* **EC-002** : ¿Qué pasa con dos solicitudes por la misma habitación a la vez? Solo una queda en `ACTIVE`; la
  otra recibe un `400` de falta de disponibilidad (sección 7, paso 3). La simultaneidad exacta está en las
  limitaciones.
* **EC-003** : ¿Qué pasa con la misma habitación dos veces? `400` "La habitación ya forma parte de la reserva."
  (sección 5, paso 6).
* **EC-004** : ¿Qué pasa con más de 10 habitaciones o ninguna? `400` "Una reserva debe tener entre 1 y 10
  habitaciones." (sección 5, paso 7).
* **EC-005** : ¿Qué pasa con personas que no son un entero positivo? `400` "La cantidad de personas debe ser un
  número entero mayor que cero." (sección 5, paso 5).
* **EC-006** : ¿Qué pasa si el Módulo 3 cotiza unas habitaciones y falla en otra? No se crea la reserva; está en
  las limitaciones.
* **EC-007** : ¿Qué pasa con observaciones de más de 500 caracteres o con caracteres no válidos? `400` (sección
  6, pasos 4 y 5).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva sobre una habitación no disponible (sobreventa), una reserva creada sin cotización, dos reservas por un doble clic, o un `500`. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, una reserva de hoy que no llega al Módulo 1, la precarga del titular que no funciona, o una comisión distinta de `0`. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, una tarifa sin el formato `440.000,00 COP`, o un aviso de precarga mal escrito. |
