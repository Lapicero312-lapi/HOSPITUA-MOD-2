### Test Case Specification: Consultar Inventario de Habitaciones
**Created** : 2026-11-14  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-007-ConsultRoomInventory
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que el Módulo 2 trabaja siempre con las habitaciones reales del Módulo 1, leídas
en el momento:
- la pantalla "Habitaciones" muestra todas las habitaciones vendibles de todas las categorías, con su
  categoría, su capacidad y su mantenimiento próximo, sin estado y sin editar nada (FR-006 y FR-007);
- la consulta por categoría trae todas las habitaciones de esa categoría, también las ocupadas hoy, y una
  categoría sin habitaciones no trae ninguna (escenarios 2 y 3, FR-002);
- la consulta de una habitación por su `roomId` trae sus datos, y su capacidad máxima limita las personas que
  caben en ella (escenario 1, FR-001 y FR-004);
- las categorías o identificadores inválidos y el Módulo 1 sin responder dan un `400` controlado, nunca un
  `500` (FR-005).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Consultar Inventario de Habitaciones | Specification Document | [specs/consult-room-inventory/spec.md](spec.md) |
| Consultar Inventario de Habitaciones | Plan Document | [specs/consult-room-inventory/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) | README | [README.md](../../README.md) |
| Habitaciones del Módulo 1 simulado | Datos de prueba | [simulators/src/data.js](../../simulators/src/data.js) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La consulta por categoría y la consulta por habitación no tienen pantalla propia: se ven en la vista previa
  de la reserva directa (`POST /api/reservations/direct/preview`, por categoría) y en la modificación de una
  reserva (por habitación).
* El Módulo 1 simulado tiene un inventario fijo de 20 habitaciones. Las altas y bajas que se publican a mano en
  CloudAMQP (TC-005-ConfigureOta) no lo cambian, así que en la demo no se puede probar a mano una pantalla sin
  habitaciones ("No hay habitaciones registradas."). La cubre
  `backend/test/integration/consult-room-inventory/rooms-screen.spec.ts`.
* El tiempo de espera agotado del Módulo 1 no se puede provocar a mano. Lo cubre
  `consult-room-inventory.service.spec.ts`.
* NFR-001 (consulta puntual en menos de 1 s) no se puede aislar a mano: cada flujo que la usa también consulta
  el calendario o cotiza. Se observa como cota superior en la sección 1, paso 4.

##### Dependencies & Assumptions
* Es la primera consulta de todos los flujos de reserva: TC-003-CheckRoomAvailability y
  TC-006-ConsultMaintenanceCalendar dependen de que este caso pase.
* La traducción del inventario a los tipos de habitación de Channex la verifica TC-005-ConfigureOta
  (sección 2).

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live*. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después.
* **Inventario esperado** (`número (capacidad)`):

  | Categoría | Habitaciones |
  | ------ | ------ |
  | `DOBLE` | 201 (2), 202 (3), 203 (2), 204 (2), 205 (3), 1001 (2) |
  | `INDIVIDUAL` | 102 (1), 103 (1), 104 (1), 105 (1) |
  | `SUITE` | 501 (4), 502 (4), 503 (5) |
  | `SUITE_JUNIOR` | 101 (2), 401 (2), 402 (3) |
  | `TRIPLE` | 301 (3), 302 (3), 303 (4), 304 (4) |

* **Reservas de la demo** : si en un paso con una habitación pedida por su `roomId` la respuesta es
  `ROOM_NOT_AVAILABLE`, otra reserva de la demo la ocupa esas noches; se repite con otras fechas.
* **Environment** : Staging, la demo de Render:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
  * simuladores: `https://hospitua-m2-simulators.onrender.com`, con el inventario en `/api/rooms` y el
    Check-In a pedido (`POST /simulate/check-in`, con el cuerpo C1 de TC-002-CancelReservation).
* **Cuerpo V1** de la vista previa: el de TC-006-ConsultMaintenanceCalendar
  (`startDate`, `endDate`, `categoryRoom` y `rooms`), con los datos de cada paso.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * Render: la cuenta de quien desplegó la demo, para suspender y reanudar los simuladores (sección 4).

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Pantalla "Habitaciones" (FR-006, FR-007 y SC-001)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ver todas las habitaciones | Entrar al frontend → Habitaciones | `Laura Méndez` | Las 20 habitaciones del inventario esperado, ordenadas por categoría y, dentro de cada una, por número. Columnas "N.º", "Categoría", "Capacidad" y "Mantenimiento próximo" | [ ] | |
| 2 | Revisar que es de solo lectura y sin estado | En la misma pantalla | N/A | Ninguna columna de estado (libre, ocupada, sucia…) ni botones o enlaces para editar, agregar o borrar (FR-003 y FR-006) | [ ] | |
| 3 | Comparar con el Módulo 1 | Abrir `https://hospitua-m2-simulators.onrender.com/api/rooms` | N/A | Las mismas 20 habitaciones, con el mismo número, categoría y capacidad que la pantalla: el Módulo 2 lee el inventario del Módulo 1, no una copia (SC-001) | [ ] | |
| 4 | Medir la consulta completa | Herramientas del navegador → Red, recargar Habitaciones y mirar `GET /api/rooms` | N/A | Responde en menos de 1 s con la demo despierta, aunque incluye el inventario y los 20 calendarios (NFR-001 y SC-002, cota superior) | [ ] | Opcional |
| 5 | Una habitación ocupada hoy sigue en la lista | Crear una reserva directa con llegada hoy y publicar su Check-In con el cuerpo C1. Volver a Habitaciones | `INDIVIDUAL`; entrada `hoy`, salida `hoy+1`; 1 habitación | La reserva queda "En curso" y su habitación sigue en Habitaciones, igual que antes y sin estado (caso borde) | [ ] | Anotar el número de la habitación (X) |

--------------------------------------------------------------------------------

##### Section 2: Consulta por categoría (escenarios 2 y 3, FR-002)
Todos los pasos usan la documentación de la API → `POST /api/reservations/direct/preview` con el cuerpo V1.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Todas las habitaciones de una categoría | V1 | `DOBLE`; entrada `hoy+30`, salida `hoy+31`; `rooms` `[{"guestCount": 1}]` | `200`. `availability.rooms` trae las 6 `DOBLE`, cada una con su `roomId` y su `roomNumber`, y ninguna de otra categoría (escenario 2) | [ ] | |
| 2 | Las ocupadas también vienen | V1 | `INDIVIDUAL`; entrada `hoy`, salida `hoy+1`; `rooms` `[{"guestCount": 1}]` | Las 4 `INDIVIDUAL`, también X (sección 1, paso 5), que viene con `available` `false` y `reason` `RESERVED`: el inventario no filtra por estado | [ ] | Si las 4 `INDIVIDUAL` están ocupadas hoy, la respuesta es `NO_AVAILABILITY` y no trae la lista: se repite la sección 1, paso 5, con otra categoría que tenga alguna habitación libre hoy |
| 3 | La capacidad de la categoría limita a las personas | V1 | `DOBLE`; entrada `hoy+30`, salida `hoy+31`; `rooms` `[{"guestCount": 4}]` | `400` con el código `GUEST_COUNT_EXCEEDS_CAPACITY` y "La cantidad de personas supera la capacidad de la habitación.": ninguna `DOBLE` admite 4 | [ ] | |
| 4 | Una categoría sin habitaciones | Abrir `https://hospitua-m2-simulators.onrender.com/api/rooms?categoryRoom=PRESIDENCIAL`. Después, V1 con esa categoría | `PRESIDENCIAL`; entrada `hoy+30`, salida `hoy+31`; `rooms` `[{"guestCount": 1}]` | El Módulo 1 responde una lista vacía (`[]`). La vista previa responde `400` con el código `NO_AVAILABILITY`, porque no hay ninguna habitación que asignar, nunca un `500` (escenario 3) | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Consulta por habitación (escenario 1, FR-001 y FR-004)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una habitación pedida que admite a sus personas | V1 con la 202 pedida por su `roomId` (sale en la respuesta de la sección 2, paso 1) | `DOBLE`; entrada `hoy+30`, salida `hoy+31`; `rooms` `[{"guestCount": 3, "roomId": "<id de la 202>"}]` | `200`, con la 202 asignada: su capacidad es 3 | [ ] | |
| 2 | Una habitación pedida con más personas de las que admite | La misma consulta con la 201 | `rooms` `[{"guestCount": 3, "roomId": "<id de la 201>"}]` | `400` `GUEST_COUNT_EXCEEDS_CAPACITY`: la capacidad de la 201 es 2 | [ ] | |
| 3 | Crear una reserva de sonda | Reservas → Nueva reserva directa, con un titular ficticio | `DOBLE`; entrada `hoy+40`, salida `hoy+41`; 1 habitación, 1 persona | La reserva queda creada | [ ] | Anotar el código |
| 4 | Elegir habitaciones de otras categorías al modificar | Abrir la reserva → modificar. Abrir la lista de habitaciones | N/A | La lista ofrece las 20 habitaciones. Al elegir la 303, la columna "Categoría" muestra `TRIPLE` | [ ] | |
| 5 | La capacidad de la habitación elegida | Con la 303, poner 4 personas; después, elegir la 201 con 3 personas | 303 con 4; 201 con 3 | Con la 303 no hay error de capacidad. Con la 201 aparece "La cantidad de personas supera la capacidad de la habitación." y "Guardar cambios" queda deshabilitado (FR-004) | [ ] | |
| 6 | Dejar limpia la demo | "Volver sin guardar" y cancelar la reserva de sonda y la de la sección 1, paso 5 (si sigue en curso, publicar antes su Check-Out) | N/A | La reserva de sonda queda "Cancelada" y la otra, "Completada" | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: Datos inválidos y Módulo 1 sin responder (casos borde y FR-005)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una categoría con otro formato | V1 | `categoryRoom` `doble` | `400` con el código `INVALID_CATEGORY` y "La categoría indicada no es válida." | [ ] | |
| 2 | Una categoría vacía | V1 | `categoryRoom` `""` | `400` `INVALID_CATEGORY`, el mismo mensaje | [ ] | |
| 3 | Un `roomId` con caracteres inválidos | V1 | `rooms` `[{"guestCount": 1, "roomId": "201"}]` | `400` con el código `INVALID_ROOM_ID` y "El identificador de la habitación es inválido." | [ ] | |
| 4 | Un `roomId` que no existe | V1 | `roomId` `00000000-0000-4000-8000-000000000000` | `400` `INVALID_ROOM_ID`, el mismo mensaje | [ ] | |
| 5 | Módulo 1 sin responder | Render → suspender `hospitua-m2-simulators`. Después, abrir Habitaciones y repetir la sección 2, paso 1 | N/A | Habitaciones muestra "No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo." y la vista previa responde `400` con el código `INVENTORY_UNAVAILABLE`, nunca un `500` | [ ] | |
| 6 | Volver a la normalidad | Render → reanudar `hospitua-m2-simulators` y volver a Habitaciones | N/A | Las 20 habitaciones otra vez | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si el Módulo 1 no responde o se agota el tiempo de espera? `400` "No se pudo consultar
  el inventario de habitaciones en este momento. Intente de nuevo." (sección 4, paso 5). El tiempo de espera
  está en las limitaciones.
* **EC-002** : ¿Qué pasa con un `roomId` que no existe o tiene caracteres inválidos? `400` "El identificador de
  la habitación es inválido." (sección 4, pasos 3 y 4).
* **EC-003** : ¿Qué pasa con una categoría vacía o con otro formato? `400` "La categoría indicada no es válida."
  (sección 4, pasos 1 y 2).
* **EC-004** : ¿Qué pasa con una habitación ocupada hoy? Se devuelve igual; si está libre en unas fechas lo
  decide la verificación de disponibilidad (sección 1, paso 5, y sección 2, paso 2).
* **EC-005** : ¿Qué pasa con una categoría que existe en el formato pero no tiene habitaciones? Lista vacía en
  el Módulo 1 y falta de disponibilidad en la reserva (sección 2, paso 4).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva sobre una habitación que no existe, más personas de las que caben en una habitación, o un `500` cuando el Módulo 1 no responde. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, "Habitaciones" sin alguna habitación del Módulo 1, una capacidad distinta de la del Módulo 1, o una habitación ocupada que desaparece de la lista. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, la tabla de Habitaciones fuera del orden por categoría y número. |
