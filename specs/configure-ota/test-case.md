### Test Case Specification: Configurar OTA
**Created** : 2026-11-14  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-005-ConfigureOta
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que el Módulo 2 deja a Booking.com configurado en Channex y mantiene al día lo
que Booking necesita para vender el hotel sin sobreventa:
- la propiedad de Channex verificada y la agencia Booking.com registrada una sola vez (historia 1);
- un tipo de habitación por categoría con habitaciones vendibles en el Módulo 1, con su cantidad y su
  capacidad, y su relación guardada (historia 2);
- la disponibilidad de cada categoría en Channex, que baja y sube con las reservas y los mantenimientos en
  menos de un minuto (historia 3 y NFR-001);
- la clave de acceso a Channex fuera de los logs y de las respuestas (NFR-002).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Configurar OTA | Specification Document | [specs/configure-ota/spec.md](spec.md) |
| Configurar OTA | Plan Document | [specs/configure-ota/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) y primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La demo corre en el plan gratuito de Render: el backend se duerme tras un rato sin uso y despierta en cerca
  de un minuto. Mientras duerme no corren las tareas de Channex, tampoco el envío completo de las 03:00.
* La demo es la única copia del Módulo 2 conectada a Channex. La sección 4, pasos 2 a 6, necesita pausarla
  mientras dure.
* Las habitaciones y los mantenimientos son del Módulo 1 real, que es de otro equipo, y él publica los avisos
  de mantenimiento y de inventario en su RabbitMQ. Los pasos que los necesitan se coordinan con él (sección 3,
  paso 7, y sección 5). Un aviso publicado a mano no sirve: el Módulo 2 vuelve a leer las habitaciones y los
  mantenimientos del Módulo 1 antes de calcular.
* No se pueden ejecutar a mano los escenarios que dependen del tiempo o de fallas de Channex. Los cubren las
  pruebas de integración de `backend/test/integration/use-cases/configure-ota/`:
  * historia 3, escenario 3 (cinco reservas en el mismo intervalo de 30 s salen en una sola solicitud):
    `availability-scenarios.spec.ts`;
  * historia 3, escenario 4 (Channex no responde o responde `429`): `availability-scenarios.spec.ts`;
  * historia 3, escenario 6 (una habitación con reserva y con mantenimiento la misma noche): el sistema no
    deja reservar una habitación en mantenimiento; `availability-scenarios.spec.ts`;
  * el tope de 20 tipos de habitación por propiedad (FR-008): `sync-room-types-scenarios.spec.ts`;
  * historia 2, escenario 3, si la propiedad no conserva tipos de una categoría sin habitaciones (sección 5,
    paso 3): `sync-room-types-scenarios.spec.ts`.
* Estos pasos no los arman, y los cubren otras pruebas automatizadas:
  * las fechas pasadas que no se envían y la cantidad que nunca baja de 0:
    `backend/test/unit/application/use-cases/configure-ota/publish-pending-availability.service.spec.ts`;
  * el mismo aviso publicado dos veces: `maintenance.consumer.spec.ts` e `inventory.consumer.spec.ts`, en
    `backend/test/integration/use-cases/configure-ota/`;
  * el aviso mal formado, que va a la dead-letter: `backend/test/integration/messaging/messaging.module.spec.ts`.
* Que Booking muestre los mismos valores que Channex solo se puede revisar con acceso a la extranet del hotel
  de prueba `10485037` y con la categoría mapeada en Channex. Sin ese acceso, se verifica en Channex.

##### Dependencies & Assumptions
* TC-002-CancelReservation y TC-009-GenerateDirectReservation deben pasar primero: la historia 3 crea y
  cancela una reserva directa desde el frontend.
* TC-006-ConsultMaintenanceCalendar y TC-007-ConsultRoomInventory deben pasar primero: el Módulo 2 lee del
  Módulo 1 las habitaciones vendibles y los mantenimientos.
* La configuración inicial del spec ya está hecha a mano: la propiedad de Channex staging creada, con la
  zona horaria `America/Bogota` y las actualizaciones automáticas de disponibilidad por modificación y por
  cancelación apagadas, y el canal Booking.com conectado al hotel `10485037`.
* Los planes de tarifa y los precios son del Módulo 3: este caso de prueba no los revisa.
* La prueba automatizada contra Channex staging (`pnpm test:staging configure-ota`, en `backend`) cubre la
  sección 2 y los pasos 1 a 6 de la sección 3. Este caso de prueba es su versión manual, sobre la demo.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live* y las claves `X-Internal-Key` que exijan
  los Módulos 1 y 3 en el panel de Render. Fechas relativas: `hoy` es la fecha del hotel (`America/Bogota`) el
  día en que se ejecuta, y `hoy+N`, N días después.
* **Habitaciones del Módulo 1** (al 2026-11-21): 19 en cuatro categorías. `BOUTIQUE`: 205, 407, 408 y 409, de
  2 personas, y 304, de 3. `DOBLE`: 103, 109, 202 y 302, de 2, y 203, de 3. `SENCILLA`: 102, 201 y 301, de 2, y
  101 y 410, de 1. `SUITE`: 105, 204 y 303, de 4, y 604, de 5. Antes de ejecutar, compararlas con `GET https://gestionophospitua.tech/api/rooms?categoryRoom=…`;
  si cambiaron, ajustar las cantidades y capacidades de las secciones 2 y 3.
* **Mantenimiento que se le pide al Módulo 1** (sección 3, paso 7): la 303 (`SUITE`, `roomId`
  `a0000000-0000-0000-0000-000000000303`), del `hoy+15` al `hoy+18`. Es el mismo que usa
  TC-003-CheckRoomAvailability.
* **Environment** : Staging. Las secciones 1, 2, 3 y 5 se ejecutan en la demo de Render:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
  * Módulo 1: `https://gestionophospitua.tech`;
  * Channex staging (`staging.channex.io`).

  La sección 4 se ejecuta en local, con los "Primeros pasos" del README: `backend/.env.example` ya apunta a los
  Módulos 1 y 3 reales.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * Channex staging: la cuenta del equipo. Las credenciales no se escriben en este documento;
  * Render: la cuenta de quien desplegó la demo, para reiniciar y suspender el backend y ver sus logs;
  * el contacto del Módulo 1, para el mantenimiento y los cambios de inventario.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Configuración de Booking.com en Channex (historia 1)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Despertar la demo | Abrir la URL del backend y esperar a que responda | URL de la documentación de la API | Responde en cerca de un minuto como máximo | [ ] | |
| 2 | Entrar al frontend | Abrir el frontend, escribir el nombre y entrar | `Laura Méndez` | Se abre la pantalla de inicio de la Recepcionista | [ ] | |
| 3 | Ver la agencia registrada | Menú → Agencias | N/A | Una sola fila, "Booking.com", con Conexión "Conectada". Comisión "Sin porcentaje" si todavía no llegó ninguna reserva de Booking; si ya llegó, el porcentaje calculado | [ ] | Anotar la comisión y la fecha de "Vinculada el" |
| 4 | Reiniciar el backend | Render → `hospitua-m2-backend` → reiniciar el servicio y esperar a que quede en *Live* | N/A | El backend arranca sin errores; en sus logs, "Propiedad de Channex verificada" | [ ] | |
| 5 | Revisar que no se duplicó | Volver a Agencias y recargar | N/A | Sigue una sola fila "Booking.com", con la misma comisión y la misma fecha de "Vinculada el" del paso 3 (escenario 2) | [ ] | |
| 6 | Revisar que la clave no sale en las respuestas | Documentación de la API → `GET /api/otas` → ejecutar | N/A | La respuesta trae la agencia y no trae la clave de Channex ni ningún campo con ella | [ ] | |
| 7 | Revisar que la clave no sale en los logs | Render → `hospitua-m2-backend` → Logs → buscar los primeros caracteres de la clave | Los primeros 8 caracteres de la clave | Ningún resultado (NFR-002) | [ ] | La clave no se copia en los comentarios |

--------------------------------------------------------------------------------

##### Section 2: Tipos de habitación desde las habitaciones vendibles (historia 2, escenario 1)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ver las habitaciones del Módulo 1 | Menú → Habitaciones | N/A | 19 habitaciones en cuatro categorías: `BOUTIQUE` (5), `DOBLE` (5), `SENCILLA` (5) y `SUITE` (4) | [ ] | |
| 2 | Ver los tipos de habitación en Channex | Panel de Channex staging → la propiedad del hotel → tipos de habitación | N/A | Un tipo por cada categoría del paso 1, con su mismo nombre, sin repetidos | [ ] | Si la propiedad se usó con los simuladores, también están `INDIVIDUAL`, `SUITE_JUNIOR` y `TRIPLE`: ver la sección 5, paso 3 |
| 3 | Revisar la cantidad y la capacidad de cada tipo | Abrir cada tipo en Channex | N/A | `BOUTIQUE`: 5 habitaciones, 3 adultos. `DOBLE`: 5 y 3. `SENCILLA`: 5 y 2. `SUITE`: 4 y 5 (escenario 1). La capacidad es la mayor de la categoría | [ ] | |
| 4 | Revisar la relación guardada (opcional) | Render → `hospitua-m2-db` → conectarse y consultar la tabla `ota_room_type_mapping` | `SELECT category_room, count_of_rooms, occupancy, channex_room_type_id FROM ota_room_type_mapping ORDER BY category_room;` | Una fila por cada tipo del paso 2. Las de `BOUTIQUE`, `DOBLE`, `SENCILLA` y `SUITE`, con las cantidades y las capacidades del paso 3 y con el mismo id de cada tipo en Channex | [ ] | Requiere acceso a la base de la demo |

--------------------------------------------------------------------------------

##### Section 3: Disponibilidad en Channex (historia 3)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Anotar la disponibilidad de partida | Panel de Channex staging → la propiedad → la grilla de disponibilidad → tipo `SUITE` | Noches `hoy+60`, `hoy+61` y `hoy+62` | Se anota el valor de cada noche (`n`). Sin otras reservas ni mantenimientos de `SUITE` esas noches, `n` es 4 | [ ] | Anotar los tres valores |
| 2 | Crear una reserva directa | Frontend → Reservas → Nueva reserva directa. Llenar Estadía, Habitaciones y Titular, revisar Disponibilidad y tarifa, y confirmar | Categoría `SUITE`; entrada `hoy+60`, salida `hoy+62`; 1 habitación para 1 persona; titular de prueba (`Prueba Staging`, CC `1000000000`) | La reserva queda creada, con su código `RSV-…` | [ ] | Anotar el código y la hora |
| 3 | Ver que baja la disponibilidad | Recargar la grilla de Channex antes de que pase un minuto desde el paso 2 | Noches `hoy+60` a `hoy+62` | `hoy+60` y `hoy+61` muestran `n - 1`. `hoy+62` no cambia: es el día de salida (escenario 1 y NFR-001) | [ ] | |
| 4 | Ver lo mismo en Booking (opcional) | Extranet de Booking del hotel `10485037` → disponibilidad de la habitación mapeada a `SUITE` | Noches `hoy+60` y `hoy+61` | Los mismos valores que en Channex | [ ] | Solo con acceso a la extranet y con `SUITE` mapeada |
| 5 | Cancelar la reserva | Frontend → Reservas → abrir la reserva del paso 2 → Cancelar reserva → confirmar | Código del paso 2 | La reserva queda cancelada | [ ] | |
| 6 | Ver que sube la disponibilidad | Recargar la grilla de Channex antes de que pase un minuto desde el paso 5 | Noches `hoy+60` y `hoy+61` | Vuelven a `n` (escenario 2) | [ ] | |
| 7 | El Módulo 1 registra un mantenimiento | Pedirle al Módulo 1 que registre en su sistema el mantenimiento de las precondiciones, y anotar la hora. Él publica el aviso `habitacion.mantenimiento` | La 303 (`SUITE`), del `hoy+15` al `hoy+18` | `GET https://gestionophospitua.tech/api/rooms/a0000000-0000-0000-0000-000000000303/maintenances` del `hoy` al `hoy+30` lo muestra en `conflicts` | [ ] | |
| 8 | Ver que baja la disponibilidad solo en las fechas del mantenimiento | Recargar la grilla de Channex, tipo `SUITE`, antes de que pase un minuto desde el paso 7 | Noches `hoy+14` a `hoy+19` | De `hoy+15` a `hoy+18`, una habitación menos que el resto (3 si no hay reservas ni otros mantenimientos de `SUITE` esas noches). `hoy+14` y `hoy+19` no bajan (escenario 5) | [ ] | Si el Módulo 1 lo registró antes de la ejecución, o si el envío de las 03:00 ya corrió, el mantenimiento ya se veía: se revisan solo las fechas, sin el minuto |

--------------------------------------------------------------------------------

##### Section 4: Errores de configuración y del Módulo 1 (historia 1, escenario 3, e historia 2, escenario 4)
Se ejecuta en local. Los pasos 2 a 6 conectan el backend local a Channex staging, con la demo pausada para
que no compitan. Mientras duren, no se hacen reservas en Booking: el backend local leería y confirmaría esas
revisiones, y la demo ya no las vería.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Arrancar sin la configuración de Channex | En local, con `CHANNEX_API_KEY` vacía en `backend/.env` (como lo deja el README), arrancar el backend y el frontend y crear una reserva directa | Una reserva de cualquier categoría a 30 días | En el log del backend, "Configuración de Channex incompleta o inválida (CHANNEX_API_KEY): las tareas de Channex quedan apagadas". El backend no llama a Channex y, con la base local vacía, Agencias no muestra ninguna agencia. La reserva se crea igual: el resto del Módulo 2 funciona (escenario 3) | [ ] | |
| 2 | Pausar la demo | Render → suspender `hospitua-m2-backend` | N/A | El servicio queda suspendido | [ ] | |
| 3 | Arrancar en local contra Channex staging | Poner la dirección, la clave y la propiedad de Channex staging en `backend/.env` y reiniciar el backend | N/A | En el log, "Propiedad de Channex verificada". En Channex no cambian los tipos: son las mismas habitaciones del Módulo 1 que usa la demo | [ ] | |
| 4 | Dejar al Módulo 1 sin responder | En `backend/.env`, cambiar `MODULE1_BASE_URL` a un puerto donde no hay nada y reiniciar el backend | `MODULE1_BASE_URL=http://localhost:4998` | En el log del backend, "No se sincronizan los tipos de habitación: el Módulo 1 no respondió (…). Se intenta en la siguiente sincronización." En Channex, los tipos no cambian | [ ] | |
| 5 | Volver a la normalidad | Devolver `MODULE1_BASE_URL` a `https://gestionophospitua.tech` y reiniciar el backend | N/A | El backend sincroniza sin errores. En Channex siguen los mismos tipos, sin repetidos (escenario 4) | [ ] | |
| 6 | Reanudar la demo | Detener el backend local, dejar `CHANNEX_API_KEY` vacía en `backend/.env` y reanudar `hospitua-m2-backend` en Render | N/A | La demo arranca, verifica la propiedad y no cambia los tipos | [ ] | |

--------------------------------------------------------------------------------

##### Section 5: Cambios de inventario del Módulo 1 (historia 2, escenarios 2 y 3)
Se ejecuta en la demo. Los pasos 1 y 2 se coordinan con el Módulo 1, que agrega una habitación de prueba en su
sistema, publica el aviso `habitacion.inventario` y después la quita. Si el Módulo 1 no puede hacerlo, los
cubre `inventory.consumer.spec.ts`.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | El Módulo 1 agrega una habitación `DOBLE` | Pedirle al Módulo 1 que agregue una habitación `DOBLE` de 2 personas y anotar la hora. Después, revisar el tipo `DOBLE` en Channex | Una habitación `DOBLE` nueva, de 2 personas | `GET https://gestionophospitua.tech/api/rooms?categoryRoom=DOBLE` la muestra. Antes de un minuto, el tipo `DOBLE` en Channex pasa a 6 habitaciones, con la misma capacidad (3), y su disponibilidad de los próximos 90 días se reenvía con las 6 (escenario 2) | [ ] | Anotar su número |
| 2 | El Módulo 1 la quita | Pedirle al Módulo 1 que quite esa habitación. Después, revisar el tipo `DOBLE` en Channex | La habitación del paso 1 | Antes de un minuto, `DOBLE` vuelve a 5 habitaciones y su disponibilidad, a la de antes del paso 1 | [ ] | |
| 3 | Una categoría sin habitaciones vendibles | Si la propiedad conserva tipos de cuando la demo usaba los simuladores (`INDIVIDUAL`, `SUITE_JUNIOR` o `TRIPLE`), revisarlos en Channex y buscar su categoría en los logs del backend | Uno de esos tipos | El tipo no se borra y conserva su cantidad. Su disponibilidad de los próximos 90 días está en 0. En el log, en cada sincronización, "La categoría … ya no tiene habitaciones vendibles: …" (escenario 3) | [ ] | Si la propiedad no tiene esos tipos, está en las limitaciones |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Quién crea los planes de tarifa y envía los precios? El Módulo 3, directamente a Channex; el
  Módulo 2 no lo hace. Este caso no los revisa (Dependencies & Assumptions), y ninguna prueba automatizada lo
  cubre aparte.
* **EC-002** : ¿Qué pasa con los mantenimientos? El Módulo 1 avisa cada uno por cola, y la disponibilidad baja
  solo en sus fechas (sección 3, pasos 7 y 8). Si el aviso llega tarde y Booking alcanza a vender la
  habitación, la reserva entra en conflicto (TC-010-GenerateOtaReservation, EC-009).
* **EC-003** : ¿Qué pasa si el Módulo 1 agrega, da de baja o cambia una habitación? Lo avisa por cola, y el
  tipo de habitación y su disponibilidad se actualizan sin esperar a las 03:00 (sección 5, pasos 1 y 2).
* **EC-004** : ¿Qué capacidad se usa si las habitaciones de una categoría tienen capacidades distintas? La
  mayor: `SUITE` (4, 4, 4 y 5) va a Channex con 5 adultos, y `DOBLE` (2 y 3) con 3 (sección 2, paso 3).
* **EC-005** : ¿Qué pasa si hay más reservas que habitaciones en una categoría, por un conflicto? Se envía
  `0`, nunca un número negativo; está en las limitaciones.
* **EC-006** : ¿Qué pasa con las fechas pasadas? No se envían; está en las limitaciones.
* **EC-007** : ¿Qué pasa si en el futuro se agrega otra agencia (por ejemplo, Airbnb)? Los tipos de
  habitación y la disponibilidad son de la propiedad, no de la agencia, así que no cambian. No se puede probar
  hoy: la propiedad solo tiene Booking.com.
* **EC-008** : ¿Qué pasa si se publica dos veces el mismo aviso (el mismo `messageId`)? El segundo se ignora:
  no se vuelve a sincronizar ni a anotar nada; está en las limitaciones.
* **EC-009** : ¿Qué pasa con un aviso mal formado (sin `messageId` o con fechas inválidas)? Va a la
  dead-letter queue sin procesar, y la disponibilidad en Channex no cambia; está en las limitaciones.
* **EC-010** : ¿Qué pasa si la demo está dormida a las 03:00? El envío completo no corre ese día. Los
  cambios anotados se envían en el primer ciclo después de que despierte; está en las limitaciones.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva directa que no se puede crear porque falla Channex, o una disponibilidad en Channex mayor que la real (sobreventa). |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, un tipo de habitación con la cantidad equivocada que se corrige con el envío de las 03:00. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, un texto mal escrito en la pantalla de Agencias. |
