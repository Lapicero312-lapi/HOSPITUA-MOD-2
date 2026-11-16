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
| Despliegue de la demo (Render) | README | [README.md](../../README.md) |
| Habitaciones, mantenimientos y tarifas de los simuladores | Datos de prueba | [simulators/src/data.js](../../simulators/src/data.js) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La sección 8 se ejecuta en dos días seguidos: el cierre del día corre a las 00:00:30 o, si la demo estaba
  dormida, al arrancar.
* En la demo, el Módulo 1 y el Módulo 3 son el mismo simulador: el Módulo 3 sin responder se prueba en local,
  como en TC-001-CalculateDynamicRate (sección 5, paso 3).
* El simulador del Módulo 1 revisa el `reservationRef`, el `roomId` y que haya huéspedes antes de publicar: una
  notificación sin identificadores no se puede enviar desde él.
* Booking solo vende y cambia lo que Channex le dice que hay: no se puede provocar a mano un cambio de Booking
  sin disponibilidad, ni asignar la habitación de una reserva en conflicto (escenarios 13 y 14).
* No se pueden provocar a mano, y los cubre `backend/test/integration/update-reservation/`:
  * el cambio de Booking sin disponibilidad, con capacidad superada, y la asignación de habitación
    (`ota-reservation-scenarios.spec.ts`);
  * la notificación sin identificadores y el salto de secuencia (`check-in.consumer.spec.ts` y
    `check-out.consumer.spec.ts`);
  * una modificación y un Check-In de la misma reserva a la vez (`modification-check-in-concurrency.spec.ts`);
  * el Módulo 3 que falla en una sola de las habitaciones (`modification-scenarios.spec.ts`);
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
* **Initial State** : la demo desplegada, con sus servicios en *Live*. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. En pantalla, las fechas se ven
  como `DD/MM/AAAA` y los valores como `440.000,00 COP`.
* **Tarifas por noche del Módulo 3 simulado** : `INDIVIDUAL` 150.000, `DOBLE` 220.000, `TRIPLE` 300.000,
  `SUITE_JUNIOR` 480.000 y `SUITE` 650.000 COP.
* **Titular ficticio** : `Camila Prueba`, `Cédula de ciudadanía` `1000000131`, `Colombia`, teléfono
  `3000000131`.
* **Check-In y Check-Out** : se publican con `POST` a
  `https://hospitua-m2-simulators.onrender.com/simulate/check-in` o `/simulate/check-out`, con el cuerpo C1 de
  TC-002-CancelReservation. C1b es C1 con `documentNumber` `1000000001`, para la segunda habitación. El
  `roomId` sale de `/api/rooms` del simulador, por el número de la habitación asignada. El resultado se ve en
  el detalle de la reserva y en los logs del backend.
* **Modificación por la API** : `PATCH /api/reservations/{reservationRef}` con la cabecera `X-User`
  (`Laura Méndez`) y un cuerpo con el `updatedAt` que devuelve `GET /api/reservations/{reservationRef}` con
  `X-Client` `RECEPTIONIST`, más lo que se cambia.
* **Environment** : Staging, la demo de Render:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`, con sus logs en Render;
  * simuladores: `https://hospitua-m2-simulators.onrender.com`, con sus logs en Render (lo que recibe el
    Módulo 1).
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * Render: la cuenta de quien desplegó la demo, para ver los logs y reiniciar el backend.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Modificación con recotización (User Story 1, escenarios 1, 8 y 9, FR-002, FR-003 y FR-005)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear M1 | Entrar al frontend → Reservas → Nueva reserva directa, con el titular ficticio | `Laura Méndez`; `DOBLE`; entrada `hoy+50`, salida `hoy+52`; 1 habitación, 2 personas | M1 queda "Activa", con valor bruto `440.000,00 COP` | [ ] | Anotar el código y la habitación |
| 2 | Abrir la modificación | Detalle de M1 → "Modificar" | N/A | "Modificar reserva <M1>", con "Estadía", "Habitaciones" (Habitación, Categoría, Personas y Disponibilidad), "Titular" sin la nacionalidad, "Observaciones (opcional)" y "Tarifa" con "No hay cambios.". "Guardar cambios" está deshabilitado | [ ] | |
| 3 | Cambiar la salida | Fecha de salida | `hoy+53` | Sin otro clic, "Consultando disponibilidad y tarifa…" y después la habitación "Disponible" y una tabla con la habitación, 3 noches, `660.000,00 COP` y "Total de la reserva" `660.000,00 COP`. Todavía no se guarda nada | [ ] | |
| 4 | Confirmar | "Guardar cambios" | N/A | Se abre el detalle: salida `hoy+53`, 3 noches y valor bruto `660.000,00 COP` (escenario 1 y FR-003) | [ ] | |
| 5 | Agregar una habitación de otra categoría | "Modificar" → "+ Agregar habitación" → elegir una `TRIPLE` | Una `TRIPLE` con 2 personas | Solo se cotiza la agregada: 3 noches y `900.000,00 COP`, "Total de la reserva" `1.560.000,00 COP` y "Quedaría con 4 personas.". Al guardar, el detalle muestra dos habitaciones, 4 personas y la `TRIPLE` en "Esperada" con su valor bruto (escenarios 1 y 8) | [ ] | |
| 6 | Quitar la habitación agregada | "Modificar" → "Quitar" en la `TRIPLE` | N/A | "La tarifa no cambia." y "Quedaría con 2 personas.". Al guardar, el detalle muestra una sola habitación y 2 personas (escenario 9) | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: Cambios sin recotizar (User Story 1, escenarios 2, 7 y 11, y FR-004)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Corregir el titular y las observaciones | "Modificar" en M1 → Teléfono y Observaciones | Teléfono `3000000199`; observaciones `Llega tarde` | "La tarifa no cambia.". Al guardar, el detalle muestra el teléfono y las observaciones nuevos, con las mismas fechas y el mismo valor (escenario 2) | [ ] | |
| 2 | Cambiar la habitación por otra de la misma categoría | "Modificar" → elegir otra `DOBLE` de la lista | Una `DOBLE` "hasta 2 personas" | "Disponible" y "La tarifa no cambia.". Al guardar, el detalle muestra la habitación nueva con el mismo valor bruto. En los logs del simulador no aparece ninguna actualización de M1: llega en el futuro (escenario 7 y FR-011) | [ ] | |
| 3 | Cambiar solo las personas | "Modificar" → Personas | De 2 a 1 | "La tarifa no cambia.". Al guardar, el detalle muestra 1 persona (escenario 11) | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Avisos al Módulo 1 por los cambios de hoy (User Story 1, escenarios 6, 8, 9 y 11, FR-009, FR-011 y FR-012)
Se miran los logs de `hospitua-m2-simulators` en Render después de cada cambio.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear M2 para mañana | Nueva reserva directa | `DOBLE`; entrada `hoy+1`, salida `hoy+2`; 1 habitación, 1 persona | M2 queda "Activa" y no sale ninguna actualización | [ ] | Anotar el código |
| 2 | Moverla a hoy | "Modificar" → fechas | Entrada `hoy`, salida `hoy+1` | Se recotiza. Al guardar, "Actualización ADDED de <M2> recibida": la llegada pasa a ser hoy | [ ] | |
| 3 | Cambiar la habitación | "Modificar" → otra `DOBLE` | N/A | "Actualización UPDATED de <M2>". El Módulo 2 no ordena nada al Módulo 1 (escenario 6 y FR-009) | [ ] | |
| 4 | Cambiar las personas | "Modificar" → Personas | De 1 a 2 | "Actualización UPDATED de <M2>" (escenario 11) | [ ] | |
| 5 | Agregar y quitar una habitación | "Modificar" → agregar una `INDIVIDUAL` con 1 persona y guardar. Después, quitarla y guardar | N/A | Un "UPDATED" por cada cambio (escenarios 8 y 9) | [ ] | |
| 6 | Sacarla de hoy | "Modificar" → fechas | Entrada `hoy+1`, salida `hoy+2` | "Actualización REMOVED (DATE_CHANGED) de <M2>" | [ ] | Cancelar M2 al terminar: no sale ningún aviso, porque ya no llega hoy |

--------------------------------------------------------------------------------

##### Section 4: Bloqueos y datos inválidos (User Story 1, escenarios 4, 5, 10 y 12, FR-001a, FR-004a, FR-005 y casos borde)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una habitación no disponible | "Modificar" en M1 → fechas y habitación | Entrada `hoy+9`, salida `hoy+10`; la habitación 201 (en mantenimiento) | "La habitación 201 no está disponible para el rango de fechas solicitado." y "Guardar cambios" deshabilitado (escenario 4) | [ ] | "Volver sin guardar" al terminar |
| 2 | Entrada antes de hoy | "Modificar" → fechas | Entrada `hoy-1`, salida `hoy+1` | "La fecha de entrada no puede ser anterior a hoy." (FR-004a) | [ ] | |
| 3 | Salida igual a la entrada | "Modificar" → fechas | Entrada y salida `hoy+50` | "La fecha de salida debe ser posterior a la de entrada." | [ ] | |
| 4 | Más personas de las que caben, o ninguna | "Modificar" → Personas | 3 en una habitación "hasta 2 personas"; después 0 | Con 3, "La cantidad de personas supera la capacidad de la habitación.". Con 0, la pantalla pide "Elija las dos fechas y una habitación con sus personas en cada fila." sin consultar, y la API responde `400` `GUEST_COUNT_TOO_LOW` "Cada habitación debe tener al menos una persona." (escenario 12) | [ ] | |
| 5 | Quitar la única habitación | En pantalla, M1 con una habitación. Después, por la API con `"rooms": []` | N/A | En pantalla no aparece "Quitar". La API responde `400` con `LAST_ROOM_CANNOT_BE_REMOVED` y "La reserva debe conservar al menos una habitación." (escenario 10) | [ ] | |
| 6 | Habitación repetida o más de 10 | En pantalla, agregar habitaciones. Por la API, la misma habitación dos veces y 11 habitaciones | N/A | En pantalla, una habitación ya elegida no se puede elegir en otra fila y "+ Agregar habitación" desaparece en la décima. La API responde `400` con "La habitación ya forma parte de la reserva." y con "Una reserva debe tener entre 1 y 10 habitaciones." | [ ] | |
| 7 | Observaciones inválidas | En pantalla, Observaciones. Por la API, `notes` | 501 caracteres; `<script>alert(1)</script>` | La pantalla no deja escribir más de 500. La API responde `400` con "Las observaciones no pueden superar 500 caracteres." y con "El formato de los datos contiene caracteres no válidos." | [ ] | |
| 8 | Cambiar la nacionalidad | Por la API, el titular con `nationality` | `"nationality": "Perú"` | `400` con `NATIONALITY_NOT_EDITABLE` y "La nacionalidad no se puede modificar." | [ ] | |
| 9 | Reservas que no se modifican | Abrir el detalle de una reserva "En curso", una "Completada", una "Cancelada" y una de Booking. Después, abrir `/reservas/<código>/modificar` y llamar a la API con cada una | Las de la sección 6 y una de TC-010-GenerateOtaReservation | El detalle no muestra "Modificar". La pantalla de modificación muestra "El estado actual de la reserva no admite modificaciones." o, en la de Booking, "Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.". La API responde `400` con `STATUS_NOT_EDITABLE` u `OTA_RESERVATION_READ_ONLY` (escenario 5 y FR-001a) | [ ] | |

--------------------------------------------------------------------------------

##### Section 5: Ediciones simultáneas, tarifas y Módulo 3 sin responder (FR-008, FR-010 y casos borde)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Dos ediciones a la vez | Abrir "Modificar" de M1 en dos pestañas. Guardar un cambio en la primera y después otro en la segunda | Observaciones `Primera` y `Segunda` | La segunda muestra "Esta reserva ya fue actualizada o cancelada recientemente" y "Volver a cargar la reserva", que trae los datos guardados por la primera. No se pierde ningún cambio sin aviso (FR-008) | [ ] | |
| 2 | Una tarifa que ya no vale | Por la API, M1 con otras fechas y un `expectedRates` con otro `lodgingAmount` | `"lodgingAmount": "1.00"` | `400` con `RATE_CHANGED` y "La tarifa cambió, vuelva a cotizar.", sin guardar nada | [ ] | |
| 3 | El Módulo 3 no responde | En local, con el Módulo 3 apagado como en TC-001-CalculateDynamicRate, sección 4. Modificar las fechas de una reserva directa | Otra salida | "No se pudo calcular la nueva tarifa en este momento. Intente más tarde.", sin guardar nada | [ ] | Requiere el backend en local |

--------------------------------------------------------------------------------

##### Section 6: Check-In y Check-Out por habitación (User Story 2, escenarios 1, 2, 4, 7, 8, 9 y 11)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear E1 con dos habitaciones | Nueva reserva directa | `TRIPLE`; entrada `hoy`, salida `hoy+1`; 2 habitaciones con 2 personas cada una | E1 queda "Activa", con A y B en "Esperada" | [ ] | Anotar el código y las habitaciones A y B |
| 2 | Check-In de la primera | `POST /simulate/check-in` | E1, A, C1 | E1 queda "En curso", A "Con Check-In" y B "Esperada" (escenario 1) | [ ] | |
| 3 | Check-Out de una que no ingresó | `POST /simulate/check-out` | E1, B, C1b | Nada cambia. En los logs del backend, "Check-Out rechazado (reserva <E1>, habitación <B>): La habitación notificada aún no registra un ingreso. Está en EXPECTED." (escenario 9) | [ ] | |
| 4 | Check-In repetido | `POST /simulate/check-in` | E1, A, C1 | Nada cambia. En los logs, "Check-In repetido (…): la habitación ya está en CHECKED_IN y se confirma sin cambios." (escenario 4) | [ ] | |
| 5 | Check-In de la segunda | `POST /simulate/check-in` | E1, B, C1b | B "Con Check-In", y E1 sigue "En curso" (escenario 2) | [ ] | |
| 6 | Check-Out parcial | `POST /simulate/check-out` | E1, A, C1 | A "Con Check-Out", y E1 sigue "En curso" (escenario 8) | [ ] | |
| 7 | Check-Out de la última | `POST /simulate/check-out` | E1, B, C1b | B "Con Check-Out" y E1 "Completada" (escenarios 7 y 8) | [ ] | |
| 8 | Check-Out repetido | `POST /simulate/check-out` | E1, B, C1b | Nada cambia. En los logs, "Check-Out repetido (…): la habitación ya está en CHECKED_OUT y se confirma sin cambios." (escenario 11) | [ ] | |

--------------------------------------------------------------------------------

##### Section 7: Notificaciones que no se aplican (User Story 2, escenarios 5, 6 y 10, y casos borde)
Cada rechazo deja una línea "Check-In rechazado" o "Check-Out rechazado" en los logs del backend, con la
reserva, la habitación y el motivo, sin datos de los huéspedes.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Check-Out de una reserva sin ingreso | `POST /simulate/check-out` | M1, su habitación, C1 | M1 sigue "Activa". Motivo: "La reserva aún no registra un ingreso. Está en ACTIVE." (escenario 10) | [ ] | |
| 2 | Check-In con una habitación ajena | `POST /simulate/check-in` | M1 con el `roomId` de otra habitación | M1 sigue "Activa". Motivo: "La habitación notificada no pertenece a la reserva." (escenario 6) | [ ] | |
| 3 | Check-In de una reserva que no existe | `POST /simulate/check-in` | `RSV-00000000` con cualquier `roomId` | Motivo: "La reserva notificada no existe en el sistema de reservas." | [ ] | |
| 4 | Check-In de una reserva cancelada o completada | `POST /simulate/check-in` | M2 (cancelada en la sección 3); E1, A | Nada cambia. Motivo: "La reserva no admite un Check-In en su estado actual. Está en CANCELLED." y "… Está en COMPLETED." (escenario 5) | [ ] | |
| 5 | Check-In antes de la fecha de entrada | `POST /simulate/check-in` | M1 (llega el `hoy+50`), su habitación, C1 | Se aplica: M1 queda "En curso", porque el Check-In físico ya ocurrió en el Módulo 1 | [ ] | Publicar su Check-Out al terminar: M1 queda "Completada" |

--------------------------------------------------------------------------------

##### Section 8: Cierre del día (User Story 3, escenarios 1, 3 y 4, FR-018 a FR-021 y casos borde)
Los pasos 1 a 4 se ejecutan un día (D) y los demás, al día siguiente (D+1).

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una reserva que no llegará | El día D, crear N1 y no publicar nada | `INDIVIDUAL`; entrada `hoy`, salida `hoy+1` | N1 queda "Activa" | [ ] | Anotar los códigos y las habitaciones de los pasos 1 a 4 |
| 2 | Un grupo que llega a medias | Crear N2 y publicar el Check-In de una sola habitación (A) | `SUITE_JUNIOR`; entrada `hoy`, salida `hoy+1`; 2 habitaciones, 1 persona cada una | N2 "En curso", A "Con Check-In" y B "Esperada" | [ ] | |
| 3 | Un grupo cuya parte que llegó ya salió | Crear N3 y publicar el Check-In y el Check-Out de una sola habitación (A) | `DOBLE`; entrada `hoy`, salida `hoy+1`; 2 habitaciones, 1 persona cada una | N3 sigue "En curso": la B sigue "Esperada" hasta el cierre | [ ] | |
| 4 | Una reserva que llegó completa | Crear N4 y publicar su Check-In | `INDIVIDUAL`; entrada `hoy`, salida `hoy+2` | N4 "En curso" | [ ] | |
| 5 | Ver el cierre | El día D+1, abrir el backend y los simuladores. Render → `hospitua-m2-backend` → Logs | N/A | "Cierre del día <D>: N No-Show, M con habitaciones sin llegar, K completadas, …" con al menos 1 en cada uno y 0 con error | [ ] | Las cifras incluyen otras reservas de la demo |
| 6 | La reserva que no llegó | Detalle de N1, y los logs del simulador | N/A | "No se presentó", la habitación "No llegó" y sin el panel "Cancelación". En el simulador, "Actualización REMOVED (NO_SHOW) de <N1>", con la fecha de D (escenario 1, FR-020 y FR-021) | [ ] | |
| 7 | El grupo que llegó a medias | Detalle de N2 | N/A | Sigue "En curso", con A "Con Check-In" y B "No llegó" (escenario 3) | [ ] | |
| 8 | El grupo cuya parte ya salió | Detalle de N3 | N/A | "Completada", con A "Con Check-Out" y B "No llegó" | [ ] | |
| 9 | La reserva completa se ignora | Detalle de N4 | N/A | Sigue "En curso", con su habitación "Con Check-In" (escenario 4) | [ ] | |
| 10 | El huésped que llega tarde | `POST /simulate/check-in` | N2, B, C1b | Nada cambia. En los logs del backend, "Check-In rechazado (…): La habitación notificada no admite un Check-In: está en NOT_ARRIVED." | [ ] | |
| 11 | El cierre no se repite | Render → `hospitua-m2-backend` → reiniciar el servicio ("Restart service") | N/A | N1 a N4 siguen igual, y el simulador no recibe otro "REMOVED (NO_SHOW)" de N1 | [ ] | |
| 12 | Dejar limpia la demo | Publicar el Check-Out de A en N2 y el de N4 | N/A | N2 queda "Completada", porque su otra habitación no llegó; N4 queda "Completada" | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si el Módulo 3 no responde al recotizar? `400` y no se guarda nada (sección 5, paso 3).
* **EC-002** : ¿Qué pasa con fechas inválidas o una entrada antes de hoy? `400` sin consultar (sección 4, pasos
  2 y 3).
* **EC-003** : ¿Qué pasa con caracteres no válidos u observaciones de más de 500 caracteres? `400` (sección 4,
  paso 7).
* **EC-004** : ¿Qué pasa con una habitación repetida o más de 10? `400` (sección 4, paso 6).
* **EC-005** : ¿Qué pasa con dos ediciones simultáneas? La segunda recibe `400` y puede volver a cargar la
  reserva (sección 5, paso 1).
* **EC-006** : ¿Qué recibe el Módulo 1 cuando cambian las fechas? `ADDED` si la llegada pasa a ser hoy y
  `REMOVED (DATE_CHANGED)` si deja de serlo; nada si no cruza el día actual (sección 3, pasos 2 y 6).
* **EC-007** : ¿Qué pasa con una notificación de una reserva que no existe? Queda en el log sin cambios (sección
  7, paso 3).
* **EC-008** : ¿Qué pasa con el Check-In de una habitación que no llegó? Queda en el log sin cambios (sección 8,
  paso 10).
* **EC-009** : ¿Qué pasa con un Check-In antes de la fecha de entrada? Se aplica (sección 7, paso 5).
* **EC-010** : ¿Qué pasa si todas las habitaciones que ingresaron ya salieron pero queda una esperada? La
  reserva sigue en curso hasta el cierre, que la completa (sección 8, pasos 3 y 8).
* **EC-011** : ¿Qué pasa si el cierre se ejecuta otra vez? No vuelve a marcar nada (sección 8, paso 11).
* **EC-012** : ¿Qué pasa con una notificación sin identificadores, o con la zona horaria del servidor distinta?
  Están en las limitaciones.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una modificación que deja una habitación reservada dos veces, una reserva que no pasa a "En curso" con el Check-In, una reserva sin ingreso que sigue "Activa" después del cierre, o un `500`. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, un cambio de hoy que no se avisa al Módulo 1, una edición simultánea que pisa la otra sin aviso, o un Check-In rechazado que no queda en el log. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, "Quedaría con N personas" con una cifra mal escrita, o un estado de habitación sin su etiqueta en español. |
