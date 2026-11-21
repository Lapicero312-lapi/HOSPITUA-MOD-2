### Test Case Specification: Procesar Datos de Huéspedes
**Created** : 2026-11-15  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-011-ProcessGuestData
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que el Módulo 2 registra los datos de los huéspedes que envía el Módulo 1 en el
Check-In y el Check-Out, y que la Recepcionista los consulta:
- cada huésped de la habitación, colombiano o extranjero, queda con su entrada y su salida, con sus datos
  guardados una sola vez y tal como llegaron (User Story 1, FR-001, FR-002, FR-005 y FR-017);
- un huésped es extranjero si su nacionalidad no es `Colombia`, y solo los extranjeros llegan a la exportación
  SIRE (FR-003, User Story 2 y FR-008);
- una notificación repetida no duplica nada, un huésped incompleto se omite sin afectar a los demás y un mensaje
  con caracteres no válidos se rechaza sin registrar nada (escenario 5, FR-004, FR-007, FR-010 y SC-004);
- la vista "Huéspedes alojados" lista, filtra, busca y muestra el detalle, sin dejar modificar nada, y responde
  `400` con filtros inválidos (User Story 3, FR-009 y FR-011 a FR-016);
- los logs no tienen documentos ni fechas de nacimiento (NFR-002).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Procesar Datos de Huéspedes | Specification Document | [specs/process-guest-data/spec.md](spec.md) |
| Procesar Datos de Huéspedes | Plan Document | [specs/process-guest-data/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* En la demo, el Check-In y el Check-Out solo los publica el Módulo 1 real. Por eso todo el caso se ejecuta en
  local, donde se publican a mano en el panel de RabbitMQ.
* Las notificaciones llegan por cola, sin respuesta HTTP: el resultado se ve en el estado de la reserva, en la
  vista "Huéspedes alojados", en la terminal del backend local y, para los mensajes rechazados, en la
  dead-letter del panel.
* Este caso registra extranjeros el mismo día: no deja un periodo con solo huéspedes colombianos. La lista
  vacía de la selección para el SIRE (User Story 2, escenario 2) la cubre
  `backend/test/integration/process-guest-data/select-foreign-movements.spec.ts`, y el mensaje de la pantalla,
  TC-008-ExportSireFile (sección 4, paso 1).
* No se pueden provocar a mano, y los cubre `backend/test/integration/process-guest-data/`:
  * el cambio de habitación dentro de la estadía, con una sola entrada y una sola salida, y el huésped con
    nacionalidad vacía (`register-guest-movements.spec.ts`);
  * NFR-001, 10 huéspedes en menos de 500 ms, y NFR-003, una página en menos de 1 segundo con 50 000
    movimientos (`guest-data-time.spec.ts`).

##### Dependencies & Assumptions
* TC-009-GenerateDirectReservation debe pasar primero: las reservas de los huéspedes se crean desde el
  frontend.
* El paso de la habitación a `CHECKED_IN` y `CHECKED_OUT`, y de la reserva a "En curso" y "Completada", lo
  verifica TC-013-UpdateReservation.
* TC-008-ExportSireFile depende de este caso: exporta los movimientos que este caso registra.

##### Preconditions & Default Setup
* **Initial State** : el entorno local listo, con los "Primeros pasos" del README. Fechas relativas: `hoy` es
  la fecha del hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. En pantalla, las
  fechas se ven como `DD/MM/AAAA`. Las categorías del Módulo 1 real son `BOUTIQUE`, `DOBLE`, `SENCILLA` y
  `SUITE`; si una no tiene cupo en las fechas de un paso, se usa otra con la misma capacidad.
* **Huéspedes ficticios** (cada uno con `firstName`, `lastName`, `documentType`, `documentNumber`,
  `nationality`, `birthDate` y, los extranjeros, `originPlace` y `destinationPlace`):

  | Huésped | Documento | Nacionalidad | Nacimiento | Procedencia | Destino |
  | ------ | ------ | ------ | ------ | ------ | ------ |
  | Sofía Prueba | `CC` `1000000111` | `Colombia` | `1995-04-12` | — | — |
  | Pedro Prueba | `PAS` `X0000112` | `Perú` | `1988-09-05` | `Lima, Perú` | `Cartagena, Colombia` |
  | Lucas Prueba | `PAS` `X0000113` | `Argentina` | `1990-01-20` | `Buenos Aires, Argentina` | `Bogotá, Colombia` |
  | Andrea Prueba | `CC` `1000000114` | `Colombia` | `2000-06-30` | — | — |
  | Tomás Prueba | `CC` `1000000115` | `Colombia` | sin `birthDate` | — | — |
  | Elena Prueba | `CC` `1000000117` | `Colombia` | `1993-08-08` | — | — |
  | Valentina Prueba | `CC` `1000000116` | `Colombia` | solo titular de R3 | — | — |

* **Grupos** : G1 son Sofía, Pedro y Lucas; G1b es G1 con el `destinationPlace` de Pedro cambiado a
  `Santa Marta, Colombia`; G2 son Andrea, Sofía, Tomás y Andrea otra vez, en ese orden; G3 son Andrea, Sofía y
  Elena.
* **Check-In y Check-Out** : se publican a mano en el panel de RabbitMQ local, como dice
  TC-002-CancelReservation ("Check-In y Check-Out en local"), con el cuerpo C1 y el grupo de cada paso en
  `guests`. Cada mensaje lleva un `messageId` nuevo, salvo donde el paso dice que se repite. El `movementDate`
  es `hoy`, salvo donde el paso dice otra fecha.
* **Environment** : Local, con los "Primeros pasos" del README: frontend en `http://localhost:5173`,
  documentación de la API en `http://localhost:3000/api/docs` y el panel de RabbitMQ en
  `http://localhost:15672`, con el usuario y la clave del README. `backend/.env.example` ya apunta a los
  Módulos 1 y 3 reales.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * claves `X-Internal-Key` de los Módulos 1 y 3 para `backend/.env`, si las exigen: las tiene quien administra
    la demo.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Check-In de un grupo mixto (User Story 1, escenarios 1 y 2, y User Story 3, escenario 6)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear R1 | Entrar al frontend → Reservas → Nueva reserva directa, con Sofía Prueba como titular | `Laura Méndez`; `SUITE`; entrada `hoy`, salida `hoy+1`; 1 habitación, 3 personas | La reserva queda creada | [ ] | Anotar el código y la habitación |
| 2 | Publicar el Check-In del grupo | Panel → `hospitua.events` → Publish message, con la routing key `habitacion.checkin` | R1 con G1 | El panel confirma que el mensaje se enrutó y R1 queda "En curso" | [ ] | Guardar el cuerpo publicado para la sección 2 |
| 3 | Ver el registro en el log | Terminal del backend local | N/A | "Check-In aplicado (reserva <R1>, habitación <id>): 3 huéspedes recibidos, 3 registrados, 0 ya registrados, 2 extranjeros y 0 omitidos." (escenarios 1 y 2) | [ ] | |
| 4 | Buscar a un extranjero por su documento | Huéspedes alojados → Buscar | `X0000112` | En menos de 10 segundos, una fila: "Pedro Prueba", `PAS X0000112`, `Perú` con la marca "Extranjero", R1, entrada `hoy` y salida "En el hotel" (FR-011 y SC-005) | [ ] | |
| 5 | Buscar al colombiano | Buscar | `1000000111` | Una fila: "Sofía Prueba", `CC 1000000111`, `Colombia` sin la marca "Extranjero" (escenario 2 y FR-003) | [ ] | |
| 6 | Ver el detalle de un extranjero | Buscar `X0000112` → "Ver detalle" | N/A | Se abre el detalle con el título "Pedro Prueba": documento `PAS X0000112`, fecha de nacimiento `05/09/1988`, nacionalidad `Perú`, reserva R1, procedencia `Lima, Perú`, destino `Cartagena, Colombia`, y en "Movimientos" una "Entrada" con la fecha de `hoy`. Solo hay "Cerrar" y "Ver reserva": ningún dato se puede modificar (FR-009, FR-014 y FR-015) | [ ] | |
| 7 | Ver los datos vacíos | "Ver detalle" de Sofía | N/A | Procedencia y destino con una raya "—" | [ ] | |
| 8 | Ir a la reserva | "Ver reserva" en el detalle, y el código de R1 en la fila | N/A | Los dos abren el detalle de R1 (FR-014) | [ ] | |
| 9 | Revisar que los logs no tienen datos personales | En la terminal del backend local, buscar en todo lo que escribió desde el arranque | `X0000112`, `1000000111`, `1988-09-05` y `1995-04-12` | Ninguna coincidencia (NFR-002) | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: Notificación repetida (User Story 1, escenario 5)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Publicar otra vez el mismo mensaje | Publicar el cuerpo de la sección 1, paso 2, sin cambiar nada, también el `messageId` | El mismo cuerpo | En la terminal, "Check-In repetido (reserva <R1>, habitación <id>): el mensaje ya se procesó y se confirma sin cambios." | [ ] | |
| 2 | Publicar el mismo Check-In con otro mensaje | El mismo cuerpo, con un `messageId` nuevo y el `sequenceNumber` siguiente | R1 con G1 | En la terminal, "Check-In repetido (reserva <R1>, habitación <id>): la habitación ya está en CHECKED_IN y se confirma sin cambios." | [ ] | |
| 3 | Revisar que no se duplicó | Huéspedes alojados → Buscar `X0000112` → "Ver detalle" | N/A | Una sola fila, y en el detalle una sola "Entrada" (escenario 5) | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Check-Out (User Story 1, escenarios 3 y 3a, y FR-017)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Publicar el Check-Out con un dato distinto | Publish message, con la routing key `habitacion.checkout` y `movementType` `DEPARTURE` | R1 con G1b | R1 queda "Completada". En la terminal, "Check-Out aplicado (reserva <R1>, habitación <id>): 3 huéspedes recibidos, 3 registrados, 0 ya registrados, 2 extranjeros y 0 omitidos." | [ ] | |
| 2 | Ver la salida en el listado | Huéspedes alojados → Buscar `X0000112` | N/A | Sigue una sola fila, ahora con la salida en `hoy` en lugar de "En el hotel" (escenario 3) | [ ] | |
| 3 | Revisar que los datos no cambiaron | "Ver detalle" | N/A | "Movimientos" con una "Entrada" y una "Salida", las dos en `hoy`. El destino sigue en `Cartagena, Colombia`: el Check-Out identifica al huésped por su documento y no modifica sus datos (escenario 3a y FR-017) | [ ] | |
| 4 | Repetir el Check-Out con otra fecha | Otro Check-Out, con un `messageId` nuevo | R1 con G1; `movementDate` `hoy+1` | En la terminal, "Check-Out repetido (…): la habitación ya está en CHECKED_OUT y se confirma sin cambios.", y el detalle sigue con una sola "Salida" en `hoy` | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: Solo colombianos, huésped incompleto y otra estadía (User Story 1, escenario 4; User Story 2, escenario 1, y casos borde)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear R2 | Nueva reserva directa, con Andrea Prueba como titular | `DOBLE`; entrada `hoy`, salida `hoy+2`; 1 habitación, 1 persona | La reserva queda creada | [ ] | Anotar el código y la habitación |
| 2 | Publicar un Check-In con un huésped incompleto y otro repetido | Publicar el Check-In | R2 con G2 | R2 queda "En curso". En la terminal, "Check-In aplicado (…): 3 huéspedes recibidos, 2 registrados, 0 ya registrados, 0 extranjeros y 1 omitidos." y "Se omitió al huésped 3 de la notificación (reserva <R2>, habitación <id>) porque le falta: birthDate.", sin el nombre ni el documento de Tomás (FR-004, FR-007 y SC-004) | [ ] | |
| 3 | El repetido se registra una vez | Huéspedes alojados → Buscar `1000000114` | N/A | Una sola fila de Andrea, con R2 y "En el hotel". Llegaron más huéspedes que las personas de la reserva y se registraron todos | [ ] | |
| 4 | El incompleto no se registra | Buscar `1000000115` | N/A | "No hay huéspedes que coincidan con los filtros." | [ ] | |
| 5 | Otra estadía del mismo huésped | Buscar `1000000111` | N/A | Dos filas de Sofía: una de R1, con la salida en `hoy`, y otra de R2, "En el hotel". La de R1 no cambió | [ ] | |
| 6 | Solo los extranjeros llegan al SIRE | Exportar SIRE con el periodo `hoy` | N/A | En "Movimientos en el periodo" están la entrada y la salida de Pedro y de Lucas. No hay ninguna fila de Sofía ni de Andrea (User Story 1, escenario 4; User Story 2, escenario 1, y FR-008) | [ ] | Si hay varias páginas, las filas pueden estar en cualquiera |

--------------------------------------------------------------------------------

##### Section 5: Listado, filtros y búsqueda (User Story 3, escenarios 1 a 5 y 7)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Abrir el listado sin filtros | Huéspedes alojados → "Limpiar filtros" | N/A | Hasta 10 filas, de la entrada más reciente a la más antigua. Con más de 10, "Mostrando 1–10 de N huéspedes · página 1 de M", y "Siguiente" lleva a la página 2 (escenario 1 y FR-012) | [ ] | |
| 2 | Filtrar por nacionalidad | Desde y Hasta `hoy`; Nacionalidad "Extranjeros" y después "Colombianos" | N/A | Con "Extranjeros", todas las filas tienen la marca "Extranjero", entre ellas Pedro y Lucas. Con "Colombianos", ninguna la tiene, y están Sofía (dos veces) y Andrea (escenario 2) | [ ] | |
| 3 | Filtrar por situación | Nacionalidad "Todos"; Situación "En el hotel" y después "Ya salió" | Desde y Hasta `hoy` | Con "En el hotel", están Andrea y la fila de Sofía en R2, y no Pedro ni Lucas. Con "Ya salió", están Pedro, Lucas y la fila de Sofía en R1, y no Andrea (escenario 3) | [ ] | |
| 4 | Filtrar por periodo | Situación "Todos"; Desde y Hasta | `hoy-30` a `hoy-1`, y después `hoy` a `hoy` | Con el primer periodo no aparece ningún huésped de este caso: todos entraron hoy. Con `hoy`, aparecen todos (escenario 4) | [ ] | |
| 5 | Combinar filtros | Extranjeros, "Ya salió" y Desde y Hasta `hoy` | N/A | Pedro y Lucas aparecen; no aparecen colombianos ni huéspedes en el hotel (FR-013) | [ ] | |
| 6 | Buscar por nombre | "Limpiar filtros" → Buscar | `SOFIA`, y después `ofí` | Las dos búsquedas traen las dos filas de Sofía: la búsqueda por nombre es parcial y no distingue mayúsculas ni tildes (escenario 5) | [ ] | |
| 7 | Recargar la página | Con un filtro puesto, recargar el navegador | Nacionalidad "Extranjeros" | El filtro sigue puesto, con los mismos resultados | [ ] | |
| 8 | Sin resultados | Buscar | `Inexistente` | "No hay huéspedes que coincidan con los filtros." (escenario 7) | [ ] | |

--------------------------------------------------------------------------------

##### Section 6: Salida sin entrada y cierre de R2 (casos borde)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Publicar el Check-Out con un huésped que no entró | Publicar el Check-Out | R2 con G3 | R2 queda "Completada". En la terminal, "Se registró la salida del huésped 3 de la notificación (reserva <R2>, habitación <id>) sin una entrada registrada." | [ ] | |
| 2 | Ver al huésped sin entrada | Huéspedes alojados → Buscar `1000000117` | N/A | Una fila de Elena con la entrada en "—" y la salida en `hoy` | [ ] | |

--------------------------------------------------------------------------------

##### Section 7: Filtros inválidos (User Story 3, escenario 8)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Un rango al revés | Huéspedes alojados → Desde y Hasta | `hoy` a `hoy-1` | "La fecha inicial no puede ser posterior a la fecha final." | [ ] | |
| 2 | Un rango de más de un año | Desde y Hasta | `hoy-400` a `hoy` | "El rango de fechas no puede superar 366 días." | [ ] | |
| 3 | Una sola fecha | Solo Desde | `hoy` | "Debe completar ambas fechas del rango." | [ ] | |
| 4 | Un nombre demasiado corto | Buscar | `So` | "La búsqueda por nombre requiere al menos 3 caracteres." | [ ] | |
| 5 | Filtros inválidos por la API | Documentación de la API → `GET /api/guest-stays` | `nationality=OTRO`; `presence=OTRO`; `page=0` | `400` con `INVALID_NATIONALITY_FILTER` "El filtro de nacionalidad no es válido.", `INVALID_PRESENCE_FILTER` "El filtro de situación no es válido." e `INVALID_PAGE` "El número de página debe ser 1 o mayor." | [ ] | |
| 6 | Un detalle que no existe | `GET /api/reservations/{reservationRef}/guests/{documentNumber}` | `RSV-123` con `X0000112`; R1 con `X9999999` | `400` con `INVALID_RESERVATION_CODE` "Debe proveer un código de reserva válido para la consulta." y `400` con `GUEST_NOT_FOUND` "El huésped no existe en esa reserva." | [ ] | |

--------------------------------------------------------------------------------

##### Section 8: Mensajes que no se pueden usar (casos borde, FR-010, FR-016 y SC-003)
Cada mensaje rechazado va a la dead-letter `m2.habitacion.checkin.dlq`, donde se puede ver con Get messages.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear R3 | Nueva reserva directa, con Valentina Prueba como titular | `SENCILLA`; entrada `hoy`, salida `hoy+1`; 1 habitación | La reserva queda creada | [ ] | Anotar el código y la habitación |
| 2 | Un Check-In con caracteres no válidos | Publicar el Check-In | R3 con los datos de Valentina y `"firstName": "<script>alert(1)</script>"` | En la terminal, "Check-In a la dead-letter: Caracteres no válidos en los datos de los huéspedes.". R3 sigue "Activa": no se registró nada | [ ] | |
| 3 | Un Check-In con un huésped que no es un objeto | Publicar el Check-In | R3 con `"guests": ["texto"]` | En la terminal, "Check-In a la dead-letter: Payload inválido.", y R3 sigue "Activa" | [ ] | |
| 4 | Un Check-In sin huéspedes | Publicar el Check-In | R3 con `"guests": []` | En la terminal, "Check-In a la dead-letter: Payload inválido.", y R3 sigue "Activa" | [ ] | |
| 5 | Un Check-In sin identificador de reserva | Publicar el Check-In sin el campo `reservationRef` | R3, sin `reservationRef` | En la terminal, "Check-In a la dead-letter: El payload de notificación es inválido. Falta el identificador de la reserva o de la habitación.", sin un `500` ni reintentos | [ ] | |
| 6 | Ver los mensajes rechazados | Panel → Queues → `m2.habitacion.checkin.dlq` → Get messages | N/A | Los cuatro mensajes de los pasos 2 a 5 | [ ] | |
| 7 | Una reserva cancelada no tiene huéspedes alojados | Cancelar R3 → Huéspedes alojados → Buscar | `1000000116` | R3 queda "Cancelada" y la búsqueda responde "No hay huéspedes que coincidan con los filtros." (FR-016) | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa con una salida sin entrada registrada? Se registra, con una alerta en el log (sección 6,
  paso 1).
* **EC-002** : ¿Qué pasa si llegan más huéspedes que las personas de la habitación? Se registran todos (sección
  4, paso 3).
* **EC-003** : ¿Qué pasa con el mismo huésped repetido en una notificación? Se procesa una sola vez (sección 4,
  paso 3).
* **EC-004** : ¿Qué pasa con un huésped al que le falta un dato obligatorio? Se omite solo a él, con un log sin
  datos personales (sección 4, pasos 2 y 4).
* **EC-005** : ¿Qué pasa con caracteres no válidos? El mensaje va a la dead-letter sin registrar nada (sección
  8, paso 2).
* **EC-006** : ¿Qué pasa con una notificación vacía o sin identificador de reserva? Va a la dead-letter, sin un
  `500` (sección 8, pasos 4 y 5).
* **EC-007** : ¿Qué pasa con un huésped de varias estadías? Cada estadía tiene sus movimientos: la notificación de
  una no cambia los de la otra (sección 4, paso 5).
* **EC-008** : ¿Qué pasa con un cambio de habitación dentro de la estadía? Una sola entrada y una sola salida por
  reserva; está en las limitaciones.
* **EC-009** : ¿Qué pasa con una nacionalidad vacía? El huésped no se trata como extranjero ni entra al archivo
  SIRE; está en las limitaciones.
* **EC-010** : ¿Cómo aparece en la vista un huésped que se alojó varias veces? Con una fila por cada estadía
  (sección 4, paso 5).
* **EC-011** : ¿Cómo aparece en la vista un huésped con salida pero sin entrada registrada? Con su fecha de
  salida y la entrada vacía (sección 6, paso 2).
* **EC-012** : ¿Qué pasa con una reserva cancelada o en `NO_SHOW`? Sus huéspedes no aparecen en la vista
  (sección 8, paso 7).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, un huésped del Check-In sin su movimiento, un colombiano en la exportación SIRE, un huésped incompleto que impide registrar a los demás, o un documento en los logs. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, un movimiento duplicado por una notificación repetida, un Check-Out que modifica los datos del huésped, o un filtro de la vista que no filtra. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, la marca "Extranjero" mal alineada, o un dato vacío sin la raya "—". |
