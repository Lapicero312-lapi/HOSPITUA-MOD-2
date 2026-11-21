### Test Case Specification: Actualizar Reservación
**Created** : 2026-11-15  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-013-UpdateReservation
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que la reserva cambia solo por los caminos permitidos:
- la Recepcionista modifica una reserva directa en `ACTIVE`: fechas, habitaciones, personas, titular y
  observaciones. Lo que afecta el precio se verifica y se recotiza antes de guardar; lo demás se guarda sin
  recotizar (User Story 1, FR-001 a FR-005);
- los cambios de una reserva con llegada hoy se avisan al Módulo 1, y los de una con llegada futura no
  (FR-009, FR-011 y FR-012);
- las reservas en curso, finalizadas o de Booking no se modifican, y los datos inválidos y las ediciones
  simultáneas responden `400` (escenarios 4, 5, 10 y 12, FR-001a, FR-008 y FR-010);
- el Check-In y el Check-Out de cada habitación cambian la habitación y la reserva según las transiciones
  permitidas, y lo que no se puede aplicar queda en el log sin cambiar nada (User Story 2, FR-014, FR-015 y
  FR-017);
- el cierre del día pasa a `NO_SHOW` las reservas sin ingreso y a "No llegó" las habitaciones que no
  ingresaron (User Story 3, FR-018 a FR-021).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Actualizar Reservación | Specification Document | [specs/update-reservation/spec.md](spec.md) |
| Actualizar Reservación | Plan Document | [specs/update-reservation/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) y primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* En la demo, la lista del día y sus actualizaciones las recibe el Módulo 1 real, y el Check-In y el Check-Out
  solo los publica él. Por eso las secciones 3, 6, 7 y 8, la sección 4, paso 9, y la sección 5, paso 3, se
  ejecutan en local, donde la lista se lee en una cola propia y el Check-In y el Check-Out se publican a mano.
  Las demás se ejecutan en la demo.
* Las tarifas las calcula el Módulo 3 real con sus reglas de temporada: no hay valores fijos. Cada paso anota
  la tarifa que muestra la modificación y la compara con la de la reserva guardada.
* La sección 8 se ejecuta en dos días seguidos: el cierre del día corre a las 00:00:30 o, si el backend estaba
  apagado, al arrancar.
* Booking solo vende y cambia lo que Channex le dice que hay: no se puede provocar a mano un cambio de Booking
  sin disponibilidad, ni asignar la habitación de una reserva en conflicto (escenarios 13 y 14).
* No se pueden provocar a mano, y los cubre `backend/test/integration/use-cases/update-reservation/`:
  * el cambio de Booking sin disponibilidad, con capacidad superada, y la asignación de habitación
    (`ota-reservation-scenarios.spec.ts`);
  * el Check-In de una reserva de Booking en `PENDING`, porque Booking envía las reservas confirmadas
    (`room-stay-scenarios.spec.ts`);
  * el salto de secuencia (`check-in.consumer.spec.ts` y `check-out.consumer.spec.ts`);
  * una modificación y un Check-In de la misma reserva a la vez (`modification-check-in-concurrency.spec.ts`);
  * el Módulo 3 que falla en una sola de las habitaciones, y una sola habitación sin disponibilidad dentro de
    una reserva de varias (`modification-scenarios.spec.ts`);
  * el fallo de una reserva dentro del lote del cierre, la zona horaria distinta y la base que se cae
    (`close-day.spec.ts` y `close-day-job.spec.ts`);
  * NFR-001 a NFR-003 (`update-reservation-time.spec.ts`).

##### Dependencies & Assumptions
* TC-009-GenerateDirectReservation debe pasar primero: las reservas se crean desde el frontend.
* TC-003-CheckRoomAvailability y TC-001-CalculateDynamicRate verifican la disponibilidad y la cotización que
  usa la modificación.
* TC-011-ProcessGuestData verifica los datos de los huéspedes del Check-In y el Check-Out; este caso verifica
  los estados.
* El no-show de una reserva de Booking y su reporte a Channex los verifica TC-010-GenerateOtaReservation,
  sección 4.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live* y las claves `X-Internal-Key` que exijan
  los Módulos 1 y 3 en el panel de Render, y el entorno local listo. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. En pantalla, las fechas se ven
  como `DD/MM/AAAA` y los valores como `440.000,00 COP`. Las categorías del Módulo 1 real son `BOUTIQUE`,
  `DOBLE`, `SENCILLA` y `SUITE`; si una no tiene cupo en las fechas de un paso, se usa otra con la misma
  capacidad.
* **Mantenimiento que se le pide al Módulo 1** (sección 4, paso 1): la 202 (`DOBLE`, `roomId`
  `a0000000-0000-0000-0000-000000000202`), del `hoy+9` al `hoy+11`, el mismo de TC-003-CheckRoomAvailability.
  Comprobarlo con
  `GET https://gestionophospitua.tech/api/rooms/a0000000-0000-0000-0000-000000000202/maintenances?startDate=…&endDate=…`.
* **Titular ficticio** : `Camila Prueba`, `Cédula de ciudadanía` `1000000131`, `Colombia`, teléfono
  `3000000131`.
* **Check-In y Check-Out** : se publican a mano en el panel de RabbitMQ local, como dice
  TC-002-CancelReservation ("Check-In y Check-Out en local"), con el cuerpo C1. C1b es C1 con `documentNumber`
  `1000000001`, para la segunda habitación. Cada mensaje lleva un `messageId` nuevo. El resultado se ve en el
  detalle de la reserva y en la terminal del backend local.
* **Modificación por la API** : `PATCH /api/reservations/{reservationRef}` con la cabecera `X-User`
  (`Laura Méndez`) y un cuerpo con el `updatedAt` que devuelve `GET /api/reservations/{reservationRef}` con
  `X-Client` `RECEPTIONIST`, más lo que se cambia.
* **Environment** :
  * Staging, la demo de Render (secciones 1 y 2, sección 4, salvo el paso 9, y sección 5, pasos 1 y 2):
    * frontend: `https://hospitua-m2-frontend.onrender.com`;
    * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
    * Módulo 3: `https://hospitua-module-3.onrender.com`. Está en el plan gratuito de Render: abrir su `/docs`
      antes de empezar, para que no esté dormido.
  * Local (secciones 3, 6, 7 y 8, sección 4, paso 9, y sección 5, paso 3), con los "Primeros pasos" del README:
    frontend en `http://localhost:5173`, documentación de la API en `http://localhost:3000/api/docs` y el panel
    de RabbitMQ en `http://localhost:15672`, con el usuario y la clave del README. `backend/.env.example` ya
    apunta a los Módulos 1 y 3 reales. La lista del día y sus actualizaciones se leen en
    `m1.reservas.diarias.queue`, creada como dice TC-002-CancelReservation ("Lista del día en local").
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * claves `X-Internal-Key` de los Módulos 1 y 3 para `backend/.env`, si las exigen: las tiene quien administra
    la demo;
  * el contacto del Módulo 1, para el mantenimiento.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Modificación con recotización (User Story 1, escenarios 1, 8 y 9, FR-002, FR-003 y FR-005)
Se ejecuta en la demo.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear M1 | Entrar al frontend → Reservas → Nueva reserva directa, con el titular ficticio | `Laura Méndez`; `DOBLE`; entrada `hoy+50`, salida `hoy+52`; 1 habitación, 2 personas | M1 queda "Activa", con el valor bruto que mostró la vista previa | [ ] | Anotar el código, la habitación y el valor (T1) |
| 2 | Abrir la modificación | Detalle de M1 → "Modificar" | N/A | "Modificar reserva <M1>", con "Estadía", "Habitaciones" (Habitación, Categoría, Personas y Disponibilidad), "Titular" sin la nacionalidad, "Observaciones (opcional)" y "Tarifa" con "No hay cambios.". "Guardar cambios" está deshabilitado | [ ] | |
| 3 | Cambiar la salida | Fecha de salida | `hoy+53` | Sin otro clic, "Consultando disponibilidad y tarifa…" y después la habitación "Disponible" y una tabla con la habitación, 3 noches, la tarifa nueva del Módulo 3 y "Total de la reserva" con ese mismo valor. Todavía no se guarda nada | [ ] | Anotar la tarifa nueva (T2) |
| 4 | Confirmar | "Guardar cambios" | N/A | Se abre el detalle: salida `hoy+53`, 3 noches y valor bruto T2 (escenario 1 y FR-003) | [ ] | |
| 5 | Agregar una habitación de otra categoría | "Modificar" → "+ Agregar habitación" → elegir una `SUITE` | Una `SUITE` con 2 personas | Solo se cotiza la agregada: 3 noches y su tarifa del Módulo 3 (TS), "Total de la reserva" T2 + TS y "Quedaría con 4 personas.". Al guardar, el detalle muestra dos habitaciones, 4 personas y la `SUITE` en "Esperada" con el valor bruto TS (escenarios 1 y 8) | [ ] | Anotar TS |
| 6 | Quitar la habitación agregada | "Modificar" → "Quitar" en la `SUITE` | N/A | "La tarifa no cambia." y "Quedaría con 2 personas.". Al guardar, el detalle muestra una sola habitación y 2 personas (escenario 9) | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: Cambios sin recotizar (User Story 1, escenarios 2, 7 y 11, y FR-004)
Se ejecuta en la demo.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Corregir el titular y las observaciones | "Modificar" en M1 → Teléfono y Observaciones | Teléfono `3000000199`; observaciones `Llega tarde` | "La tarifa no cambia.". Al guardar, el detalle muestra el teléfono y las observaciones nuevos, con las mismas fechas y el mismo valor (escenario 2) | [ ] | |
| 2 | Cambiar la habitación por otra de la misma categoría | "Modificar" → elegir otra `DOBLE` de la lista | Una `DOBLE` "hasta 2 personas" | "Disponible" y "La tarifa no cambia.". Al guardar, el detalle muestra la habitación nueva con el mismo valor bruto T2 (escenario 7) | [ ] | Que no se avise al Módulo 1 se ve en la sección 3, paso 2 |
| 3 | Cambiar solo las personas | "Modificar" → Personas | De 2 a 1 | "La tarifa no cambia.". Al guardar, el detalle muestra 1 persona (escenario 11) | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Avisos al Módulo 1 por los cambios de hoy (User Story 1, escenarios 6, 7, 8, 9 y 11, FR-009, FR-011 y FR-012)
Se ejecuta en local. Después de cada cambio se lee la cola de la lista del día.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear M2 para mañana | Nueva reserva directa | `DOBLE`; entrada `hoy+1`, salida `hoy+2`; 1 habitación, 1 persona | M2 queda "Activa" y no sale ninguna actualización | [ ] | Anotar el código |
| 2 | Un cambio con la llegada futura no se avisa | "Modificar" → otra `DOBLE` | N/A | Se guarda y no sale ninguna actualización de M2: llega mañana (escenario 7 y FR-011) | [ ] | |
| 3 | Moverla a hoy | "Modificar" → fechas | Entrada `hoy`, salida `hoy+1` | Se recotiza. Al guardar, un `ADDED` de M2: la llegada pasa a ser hoy | [ ] | |
| 4 | Cambiar la habitación | "Modificar" → otra `DOBLE` | N/A | Un `UPDATED` de M2. El Módulo 2 no ordena nada al Módulo 1 (escenario 6 y FR-009) | [ ] | |
| 5 | Cambiar las personas | "Modificar" → Personas | De 1 a 2 | Un `UPDATED` de M2 (escenario 11) | [ ] | |
| 6 | Agregar y quitar una habitación | "Modificar" → agregar una `SENCILLA` con 1 persona y guardar. Después, quitarla y guardar | N/A | Un `UPDATED` por cada cambio (escenarios 8 y 9) | [ ] | |
| 7 | Sacarla de hoy | "Modificar" → fechas | Entrada `hoy+1`, salida `hoy+2` | Un `REMOVED` de M2 con `removalReason` `DATE_CHANGED` | [ ] | Cancelar M2 al terminar: no sale ningún aviso, porque ya no llega hoy |

--------------------------------------------------------------------------------

##### Section 4: Bloqueos y datos inválidos (User Story 1, escenarios 4, 5, 10 y 12, FR-001a, FR-004a, FR-005 y casos borde)
Se ejecuta en la demo, salvo el paso 9.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una habitación no disponible | "Modificar" en M1 → fechas y habitación | Entrada `hoy+9`, salida `hoy+10`; la habitación 202 (en mantenimiento) | "La habitación 202 no está disponible para el rango de fechas solicitado." y "Guardar cambios" deshabilitado (escenario 4) | [ ] | "Volver sin guardar" al terminar |
| 2 | Entrada antes de hoy | "Modificar" → fechas | Entrada `hoy-1`, salida `hoy+1` | "La fecha de entrada no puede ser anterior a hoy." (FR-004a) | [ ] | |
| 3 | Salida igual a la entrada | "Modificar" → fechas | Entrada y salida `hoy+50` | "La fecha de salida debe ser posterior a la de entrada." | [ ] | |
| 4 | Más personas de las que caben, o ninguna | "Modificar" → Personas | 3 en una habitación "hasta 2 personas"; después 0 | Con 3, "La cantidad de personas supera la capacidad de la habitación.". Con 0, la pantalla pide "Elija las dos fechas y una habitación con sus personas en cada fila." sin consultar, y la API responde `400` `GUEST_COUNT_TOO_LOW` "Cada habitación debe tener al menos una persona." (escenario 12) | [ ] | |
| 5 | Quitar la única habitación | En pantalla, M1 con una habitación. Después, por la API con `"rooms": []` | N/A | En pantalla no aparece "Quitar". La API responde `400` con `LAST_ROOM_CANNOT_BE_REMOVED` y "La reserva debe conservar al menos una habitación." (escenario 10) | [ ] | |
| 6 | Habitación repetida o más de 10 | En pantalla, agregar habitaciones. Por la API, la misma habitación dos veces y 11 habitaciones | N/A | En pantalla, una habitación ya elegida no se puede elegir en otra fila y "+ Agregar habitación" desaparece en la décima. La API responde `400` con "La habitación ya forma parte de la reserva." y con "Una reserva debe tener entre 1 y 10 habitaciones." | [ ] | |
| 7 | Observaciones inválidas | En pantalla, Observaciones. Por la API, `notes` | 501 caracteres; `<script>alert(1)</script>` | La pantalla no deja escribir más de 500. La API responde `400` con "Las observaciones no pueden superar 500 caracteres." y con "El formato de los datos contiene caracteres no válidos." | [ ] | |
| 8 | Cambiar la nacionalidad | Por la API, el titular con `nationality` | `"nationality": "Perú"` | `400` con `NATIONALITY_NOT_EDITABLE` y "La nacionalidad no se puede modificar." | [ ] | |
| 9 | Una reserva cancelada no se modifica | En local: abrir el detalle de M2, abrir `http://localhost:5173/reservas/<M2>/modificar` y llamar a la API local con M2 | M2, cancelada al final de la sección 3 | El detalle no muestra "Modificar". La pantalla de modificación muestra "El estado actual de la reserva no admite modificaciones.". La API responde `400` con `STATUS_NOT_EDITABLE` (escenario 5) | [ ] | Las reservas en curso y completadas, en la sección 6, pasos 3 y 10 |
| 10 | Una reserva de Booking no se modifica | Abrir el detalle de una reserva de Booking, abrir `/reservas/<código>/modificar` y llamar a la API con ella | Una de TC-010-GenerateOtaReservation | El detalle no muestra "Modificar". La pantalla de modificación muestra "Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.". La API responde `400` con `OTA_RESERVATION_READ_ONLY` (FR-001a) | [ ] | |

--------------------------------------------------------------------------------

##### Section 5: Ediciones simultáneas, tarifas y Módulo 3 sin responder (FR-008, FR-010 y casos borde)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Dos ediciones a la vez | En la demo, abrir "Modificar" de M1 en dos pestañas. Guardar un cambio en la primera y después otro en la segunda | Observaciones `Primera` y `Segunda` | La segunda muestra "Esta reserva ya fue actualizada o cancelada recientemente" y "Volver a cargar la reserva", que trae los datos guardados por la primera. No se pierde ningún cambio sin aviso (FR-008) | [ ] | |
| 2 | Una tarifa que ya no vale | Por la API de la demo, M1 con otras fechas y un `expectedRates` con otro `lodgingAmount` | `"lodgingAmount": "1.00"` | `400` con `RATE_CHANGED` y "La tarifa cambió, vuelva a cotizar.", sin guardar nada | [ ] | |
| 3 | El Módulo 3 no responde | En local, crear una reserva directa y dejar al Módulo 3 sin responder como en TC-001-CalculateDynamicRate, sección 4, pasos 1 y 2. Después, "Modificar" en esa reserva → Fecha de salida | La reserva de ese paso 1 (`DOBLE`, de `hoy+30` a `hoy+32`); salida `hoy+33` | "No se pudo calcular la nueva tarifa en este momento. Intente más tarde.", sin guardar nada | [ ] | Al terminar, el paso 7 de esa sección de TC-001 devuelve la dirección real del Módulo 3 |

--------------------------------------------------------------------------------

##### Section 6: Check-In y Check-Out por habitación (User Story 2, escenarios 1, 2, 4, 7, 8, 9 y 11, y User Story 1, escenario 5)
Se ejecuta en local.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear E1 con dos habitaciones | Nueva reserva directa | `DOBLE`; entrada `hoy`, salida `hoy+1`; 2 habitaciones con 2 personas cada una | E1 queda "Activa", con A y B en "Esperada" | [ ] | Anotar el código y las habitaciones A y B |
| 2 | Check-In de la primera | Publicar el Check-In | E1, A, C1 | E1 queda "En curso", A "Con Check-In" y B "Esperada" (escenario 1) | [ ] | |
| 3 | Una reserva en curso no se modifica | Abrir el detalle de E1, abrir `http://localhost:5173/reservas/<E1>/modificar` y llamar a la API local con E1 | E1 | El detalle no muestra "Modificar". La pantalla de modificación muestra "El estado actual de la reserva no admite modificaciones.". La API responde `400` con `STATUS_NOT_EDITABLE` (User Story 1, escenario 5) | [ ] | |
| 4 | Check-Out de una que no ingresó | Publicar el Check-Out | E1, B, C1b | Nada cambia. En la terminal del backend, "Check-Out rechazado (reserva <E1>, habitación <B>): La habitación notificada aún no registra un ingreso. Está en EXPECTED." (escenario 9) | [ ] | |
| 5 | Check-In repetido | Publicar otra vez el Check-In de A, con un `messageId` nuevo | E1, A, C1 | Nada cambia. En la terminal, "Check-In repetido (…): la habitación ya está en CHECKED_IN y se confirma sin cambios." (escenario 4) | [ ] | |
| 6 | Check-In de la segunda | Publicar el Check-In | E1, B, C1b | B "Con Check-In", y E1 sigue "En curso" (escenario 2) | [ ] | |
| 7 | Check-Out parcial | Publicar el Check-Out | E1, A, C1 | A "Con Check-Out", y E1 sigue "En curso" (escenario 8) | [ ] | |
| 8 | Check-Out de la última | Publicar el Check-Out | E1, B, C1b | B "Con Check-Out" y E1 "Completada" (escenarios 7 y 8) | [ ] | |
| 9 | Check-Out repetido | Publicar otra vez el Check-Out de B, con un `messageId` nuevo | E1, B, C1b | Nada cambia. En la terminal, "Check-Out repetido (…): la habitación ya está en CHECKED_OUT y se confirma sin cambios." (escenario 11) | [ ] | |
| 10 | Una reserva completada no se modifica | Abrir el detalle de E1, abrir `http://localhost:5173/reservas/<E1>/modificar` y llamar a la API local con E1 | E1 | El detalle no muestra "Modificar". La pantalla de modificación muestra "El estado actual de la reserva no admite modificaciones.". La API responde `400` con `STATUS_NOT_EDITABLE` (User Story 1, escenario 5) | [ ] | |

--------------------------------------------------------------------------------

##### Section 7: Notificaciones que no se aplican (User Story 2, escenarios 5, 6 y 10, y casos borde)
Se ejecuta en local. Cada rechazo deja una línea "Check-In rechazado" o "Check-Out rechazado" en la terminal del
backend, con la reserva, la habitación y el motivo, sin datos de los huéspedes.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Check-Out de una reserva sin ingreso | Crear P1 con el titular ficticio y publicar su Check-Out | P1: `DOBLE`, entrada `hoy+50`, salida `hoy+52`, 1 habitación; su habitación, C1 | P1 sigue "Activa". Motivo: "La reserva aún no registra un ingreso. Está en ACTIVE." (escenario 10) | [ ] | Anotar el código y la habitación de P1 |
| 2 | Check-In con una habitación ajena | Publicar el Check-In | P1 con el `roomId` de otra habitación | P1 sigue "Activa". Motivo: "La habitación notificada no pertenece a la reserva." (escenario 6) | [ ] | |
| 3 | Check-In de una reserva que no existe | Publicar el Check-In | `RSV-00000000` con cualquier `roomId` | Motivo: "La reserva notificada no existe en el sistema de reservas." | [ ] | |
| 4 | Check-In de una reserva cancelada o completada | Publicar el Check-In | M2 (cancelada en la sección 3); E1, A | Nada cambia. Motivo: "La reserva no admite un Check-In en su estado actual. Está en CANCELLED." y "… Está en COMPLETED." (escenario 5) | [ ] | |
| 5 | Check-Out de una reserva cancelada | Publicar el Check-Out | M2 (cancelada en la sección 3), su habitación, C1 | M2 sigue "Cancelada". Motivo: "La reserva aún no registra un ingreso. Está en CANCELLED." | [ ] | |
| 6 | Check-In antes de la fecha de entrada | Publicar el Check-In | P1 (llega el `hoy+50`), su habitación, C1 | Se aplica: P1 queda "En curso", porque el Check-In físico ya ocurrió en el Módulo 1 | [ ] | Publicar su Check-Out al terminar: P1 queda "Completada" |

--------------------------------------------------------------------------------

##### Section 8: Cierre del día (User Story 3, escenarios 1, 3 y 4, FR-018 a FR-021 y casos borde)
Se ejecuta en local. Los pasos 1 a 4 se ejecutan un día (D) y los demás, al día siguiente (D+1). Entre los dos
días, el backend local puede quedar apagado: el cierre corre al arrancar.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una reserva que no llegará | El día D, crear N1 y no publicar nada | `SENCILLA`; entrada `hoy`, salida `hoy+1` | N1 queda "Activa" | [ ] | Anotar los códigos y las habitaciones de los pasos 1 a 4 |
| 2 | Un grupo que llega a medias | Crear N2 y publicar el Check-In de una sola habitación (A) | `SUITE`; entrada `hoy`, salida `hoy+1`; 2 habitaciones, 1 persona cada una | N2 "En curso", A "Con Check-In" y B "Esperada" | [ ] | |
| 3 | Un grupo cuya parte que llegó ya salió | Crear N3 y publicar el Check-In y el Check-Out de una sola habitación (A) | `DOBLE`; entrada `hoy`, salida `hoy+1`; 2 habitaciones, 1 persona cada una | N3 sigue "En curso": la B sigue "Esperada" hasta el cierre | [ ] | |
| 4 | Una reserva que llegó completa | Crear N4 y publicar su Check-In | `SENCILLA`; entrada `hoy`, salida `hoy+2` | N4 "En curso" | [ ] | |
| 5 | Ver el cierre | El día D+1, arrancar el backend local y mirar su terminal | N/A | "Cierre del día <D>: N No-Show, M con habitaciones sin llegar, K completadas, …" con al menos 1 en cada uno y 0 con error | [ ] | Las cifras incluyen otras reservas de la base local |
| 6 | La reserva que no llegó | Detalle de N1, y la cola de la lista del día | N/A | "No se presentó", la habitación "No llegó" y sin el panel "Cancelación". En la cola, un `REMOVED` de N1 con `removalReason` `NO_SHOW` y la `operationalDate` de D (escenario 1, FR-020 y FR-021) | [ ] | |
| 7 | El grupo que llegó a medias | Detalle de N2 | N/A | Sigue "En curso", con A "Con Check-In" y B "No llegó" (escenario 3) | [ ] | |
| 8 | El grupo cuya parte ya salió | Detalle de N3 | N/A | "Completada", con A "Con Check-Out" y B "No llegó" | [ ] | |
| 9 | La reserva completa se ignora | Detalle de N4 | N/A | Sigue "En curso", con su habitación "Con Check-In" (escenario 4) | [ ] | |
| 10 | El huésped que llega tarde | Publicar el Check-In | N2, B, C1b | Nada cambia. En la terminal, "Check-In rechazado (…): La habitación notificada no admite un Check-In: está en NOT_ARRIVED." | [ ] | |
| 11 | Check-In de la reserva que no se presentó | Publicar el Check-In | N1, su habitación, C1 | N1 sigue "No se presentó". En la terminal, "Check-In rechazado (…): La reserva no admite un Check-In en su estado actual. Está en NO_SHOW." | [ ] | |
| 12 | Check-Out de la reserva que no se presentó | Publicar el Check-Out | N1, su habitación, C1 | N1 sigue "No se presentó". En la terminal, "Check-Out rechazado (…): La reserva aún no registra un ingreso. Está en NO_SHOW." | [ ] | |
| 13 | El cierre no se repite | Apagar el backend local y volver a arrancarlo | N/A | N1 a N4 siguen igual, y la cola no recibe otro `REMOVED` `NO_SHOW` de N1 | [ ] | |
| 14 | Dejar limpio el entorno local | Publicar el Check-Out de A en N2 y el de N4 | N/A | N2 queda "Completada", porque su otra habitación no llegó; N4 queda "Completada" | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si el Módulo 3 no responde al recotizar? `400` y no se guarda nada (sección 5, paso 3).
  Si falla en una sola de varias habitaciones, tampoco se aplica nada; está en las limitaciones.
* **EC-002** : ¿Qué pasa con fechas inválidas (la salida antes de la entrada, o vacías)? `400` "La fecha de
  salida debe ser posterior a la de entrada.", sin consultar al Módulo 3 (sección 4, paso 3).
* **EC-003** : ¿Qué pasa con una entrada antes de hoy? `400` "La fecha de entrada no puede ser anterior a hoy."
  (sección 4, paso 2). "Hoy" es la fecha del hotel el día en que se ejecuta, no una fecha fija.
* **EC-004** : ¿Qué pasa con caracteres extraños en los datos del titular o en las observaciones? `400` "El
  formato de los datos contiene caracteres no válidos." (sección 4, paso 7).
* **EC-005** : ¿Qué pasa con observaciones de más de 500 caracteres? `400` "Las observaciones no pueden superar
  500 caracteres.", y la pantalla no deja escribir más (sección 4, paso 7).
* **EC-006** : ¿Qué pasa si se agrega una habitación que ya está en la reserva? `400` "La habitación ya forma
  parte de la reserva." (sección 4, paso 6).
* **EC-007** : ¿Qué pasa si la reserva pasa de 10 habitaciones? `400` "Una reserva debe tener entre 1 y 10
  habitaciones." (sección 4, paso 6).
* **EC-008** : ¿Qué pasa si al cambiar las fechas una sola habitación no está disponible? Se rechaza el cambio
  completo, con el número de la habitación (sección 4, paso 1). Con varias habitaciones, está en las
  limitaciones.
* **EC-009** : ¿Qué pasa si las personas de una habitación superan su capacidad? `400` con el mensaje de
  capacidad y sin guardar nada (sección 4, paso 4).
* **EC-010** : ¿Qué pasa con dos ediciones simultáneas? La segunda recibe `400` y puede volver a cargar la
  reserva (sección 5, paso 1).
* **EC-011** : ¿Qué recibe el Módulo 1 cuando solo cambian las fechas? Nada, salvo que crucen el día actual:
  `ADDED` si la llegada pasa a ser hoy y `REMOVED` con `DATE_CHANGED` si deja de serlo (sección 3, pasos 3 y 7).
  Un cambio de habitación con llegada futura tampoco se avisa (sección 3, paso 2).
* **EC-012** : ¿Qué pasa con un cambio, una adición o una eliminación de habitación en una reserva con llegada
  hoy? Se aplica y se avisa con un `UPDATED`; el Módulo 2 no le ordena nada al Módulo 1 (sección 3, pasos 4 y 6).
* **EC-013** : ¿Qué significan "responde 200" y "responde 400" si las notificaciones llegan por cola? "200" es
  confirmar el mensaje y aplicarlo (sección 6, paso 2), o confirmarlo sin efectos si es un duplicado (sección 6,
  pasos 5 y 9). "400" es confirmarlo sin aplicarlo y dejarlo en el log (sección 7). Un mensaje ilegible va a la
  dead-letter (TC-011-ProcessGuestData, sección 8, pasos 2 y 3).
* **EC-014** : ¿Qué pasa con el Check-In de una reserva de Booking con una habitación sin asignar? Esa reserva no
  viaja en la lista del día, así que el Módulo 1 no la conoce. Un Check-In con una habitación que no es de la
  reserva se rechaza como cualquier otro (sección 7, paso 2). La reserva de Booking en conflicto está en las
  limitaciones.
* **EC-015** : ¿Qué pasa con una notificación vacía, o sin la referencia de la reserva o el `roomId`? Va a la
  dead-letter sin un `500` y sin cambiar nada (TC-011-ProcessGuestData, sección 8, pasos 4 y 5).
* **EC-016** : ¿Qué pasa en una reserva con varias habitaciones? Cada notificación trae solo los huéspedes de su
  habitación (sección 6, pasos 2 y 6). Los movimientos de cada huésped los verifica TC-011-ProcessGuestData.
* **EC-017** : ¿Qué pasa con una notificación de una reserva que no existe? Queda en el log con "La reserva
  notificada no existe en el sistema de reservas.", sin cambios (sección 7, paso 3).
* **EC-018** : ¿Qué pasa con el Check-In de una reserva cancelada, en No-Show, `PENDING` o completada? `400` sin
  cambiar el estado, y queda en el log (sección 7, paso 4, y sección 8, paso 11). La `PENDING` está en las
  limitaciones.
* **EC-019** : ¿Qué pasa con el Check-In de una habitación que no llegó? Queda en el log sin cambios (sección 8,
  paso 10).
* **EC-020** : ¿Qué pasa con un Check-In antes de la fecha de entrada? Se aplica (sección 7, paso 6).
* **EC-021** : ¿Qué pasa con un Check-Out que llega con horas de retraso? Se aplica mientras la habitación siga
  "Con Check-In" (sección 8, paso 14, que lo publica al día siguiente del Check-In).
* **EC-022** : ¿Qué pasa con el Check-Out de una reserva cancelada o en No-Show? `400` sin cambios, y queda en el
  log (sección 7, paso 5, y sección 8, paso 12).
* **EC-023** : ¿Qué pasa si todas las habitaciones que ingresaron ya salieron pero queda una esperada? La
  reserva sigue en curso hasta el cierre, que la completa (sección 8, pasos 3 y 8).
* **EC-024** : ¿Qué pasa si el cierre se ejecuta otra vez? No vuelve a marcar nada (sección 8, paso 13).
* **EC-025** : ¿Qué pasa si la zona horaria del servidor es distinta a la de Colombia? El cierre usa siempre la
  de Colombia; está en las limitaciones.
* **EC-026** : ¿Qué pasa si la base de datos se cae durante el cierre? Se detiene sin dejar reservas marcadas a
  medias; está en las limitaciones.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una modificación que deja una habitación reservada dos veces, una reserva que no pasa a "En curso" con el Check-In, una reserva sin ingreso que sigue "Activa" después del cierre, o un `500`. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, un cambio de hoy que no se avisa al Módulo 1, una edición simultánea que pisa la otra sin aviso, o un Check-In rechazado que no queda en el log. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, "Quedaría con N personas" con una cifra mal escrita, o un estado de habitación sin su etiqueta en español. |
