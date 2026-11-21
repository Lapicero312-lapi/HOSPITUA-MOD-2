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
- la consulta por categoría trae todas las habitaciones de esa categoría, también las ocupadas hoy (escenario 2
  y FR-002);
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
| Despliegue de la demo (Render) y primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La consulta por categoría y la consulta por habitación no tienen pantalla propia: se ven en la vista previa
  de la reserva directa (`POST /api/reservations/direct/preview`, por categoría) y en la modificación de una
  reserva (por habitación).
* El inventario es del Módulo 1 real, que es de otro equipo: no se puede vaciar ni dejar una categoría sin
  habitaciones para la prueba. Una categoría que el Módulo 1 no tiene la rechaza con `400` (sección 2,
  paso 4). Los cubren las pruebas automatizadas:
  * la pantalla sin habitaciones ("No hay habitaciones registradas."):
    `backend/test/integration/consult-room-inventory/rooms-screen.spec.ts`;
  * la categoría válida sin habitaciones, que devuelve una lista vacía (escenario 3):
    `backend/test/integration/consult-room-inventory/consult-room-inventory.service.spec.ts`.
* En la demo, el Check-In solo lo publica el Módulo 1. Los pasos con una habitación ocupada hoy (sección 1,
  paso 5, y sección 2, paso 2) se ejecutan en local, donde se publica a mano.
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
* **Initial State** : la demo desplegada, con sus servicios en *Live* y las claves `X-Internal-Key` que exijan
  los Módulos 1 y 3 en el panel de Render, y el entorno local listo. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después.
* **Inventario esperado** del Módulo 1, al 2026-11-21 (`número (capacidad)`):

  | Categoría | Habitaciones |
  | ------ | ------ |
  | `BOUTIQUE` | 205 (2), 304 (3), 407 (2), 408 (2), 409 (2) |
  | `DOBLE` | 103 (2), 109 (2), 202 (2), 203 (3), 302 (2) |
  | `SENCILLA` | 101 (1), 102 (2), 201 (2), 301 (2), 410 (1) |
  | `SUITE` | 105 (4), 204 (4), 303 (4), 604 (5) |

  Antes de ejecutar, compararlo con `GET https://gestionophospitua.tech/api/rooms`. Si cambió, se usa el que
  devuelva el Módulo 1, y en los pasos con una habitación pedida se elige otra con la misma capacidad.
* **Reservas de la demo** : si en un paso con una habitación pedida por su `roomId` la respuesta es
  `ROOM_NOT_AVAILABLE`, otra reserva de la demo o un mantenimiento la ocupan esas noches; se repite con otras
  fechas.
* **Environment** :
  * Staging, la demo de Render (todo, salvo los pasos que dicen "En local"):
    * frontend: `https://hospitua-m2-frontend.onrender.com`;
    * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
    * Módulo 1: `https://gestionophospitua.tech`;
    * Módulo 3: `https://hospitua-module-3.onrender.com`. La vista previa también cotiza, y el Módulo 3 está en
      el plan gratuito de Render: abrir su `/docs` antes de empezar, para que no esté dormido.
  * Local (sección 1, paso 5, sección 2, paso 2, y sección 4, pasos 5 a 7), con los "Primeros pasos" del
    README: frontend en `http://localhost:5173`, documentación de la API en `http://localhost:3000/api/docs` y
    el panel de RabbitMQ en `http://localhost:15672`, con el usuario y la clave del README.
    `backend/.env.example` ya apunta a los Módulos 1 y 3 reales. El Check-In y el Check-Out se publican a mano
    con el cuerpo C1, como dice TC-002-CancelReservation ("Check-In y Check-Out en local").
* **Cuerpo V1** de la vista previa: el de TC-006-ConsultMaintenanceCalendar
  (`startDate`, `endDate`, `categoryRoom` y `rooms`), con los datos de cada paso.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * claves `X-Internal-Key` de los Módulos 1 y 3 para `backend/.env`, si las exigen: las tiene quien administra
    la demo.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Pantalla "Habitaciones" (FR-006, FR-007 y SC-001)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ver todas las habitaciones | Entrar al frontend → Habitaciones | `Laura Méndez` | Las 19 habitaciones del inventario esperado, ordenadas por categoría y, dentro de cada una, por número. Columnas "N.º", "Categoría", "Capacidad" y "Mantenimiento próximo" | [ ] | |
| 2 | Revisar que es de solo lectura y sin estado | En la misma pantalla | N/A | Ninguna columna de estado (libre, ocupada, sucia…) ni botones o enlaces para editar, agregar o borrar (FR-003 y FR-006) | [ ] | |
| 3 | Comparar con el Módulo 1 | Abrir `https://gestionophospitua.tech/api/rooms` | N/A | Las mismas 19 habitaciones, con el mismo número, categoría y capacidad que la pantalla: el Módulo 2 lee el inventario del Módulo 1, no una copia (SC-001) | [ ] | |
| 4 | Medir la consulta completa | Herramientas del navegador → Red, recargar Habitaciones y mirar `GET /api/rooms` | N/A | Responde en menos de 1 s con la demo despierta, aunque incluye el inventario y los 19 calendarios (NFR-001 y SC-002, cota superior) | [ ] | Opcional |
| 5 | Una habitación ocupada hoy sigue en la lista | En local: crear una reserva directa con llegada hoy y publicar su Check-In con el cuerpo C1. Volver a Habitaciones | `SENCILLA`; entrada `hoy`, salida `hoy+1`; 1 habitación | La reserva queda "En curso" y su habitación sigue en Habitaciones, igual que antes y sin estado (caso borde) | [ ] | Anotar el número de la habitación (X) |

--------------------------------------------------------------------------------

##### Section 2: Consulta por categoría (escenario 2 y FR-002)
Todos los pasos usan la documentación de la API → `POST /api/reservations/direct/preview` con el cuerpo V1.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Todas las habitaciones de una categoría | V1 | `DOBLE`; entrada `hoy+30`, salida `hoy+31`; `rooms` `[{"guestCount": 1}]` | `200`. `availability.rooms` trae las 5 `DOBLE`, cada una con su `roomId` y su `roomNumber`, y ninguna de otra categoría (escenario 2) | [ ] | |
| 2 | Las ocupadas también vienen | En local: V1 | `SENCILLA`; entrada `hoy`, salida `hoy+1`; `rooms` `[{"guestCount": 1}]` | Las 5 `SENCILLA`, también X (sección 1, paso 5), que viene con `available` `false` y `reason` `RESERVED`: el inventario no filtra por estado | [ ] | Si las 5 `SENCILLA` están ocupadas hoy, la respuesta es `NO_AVAILABILITY` y no trae la lista: se repite la sección 1, paso 5, con otra categoría que tenga alguna habitación libre hoy |
| 3 | La capacidad de la categoría limita a las personas | V1 | `DOBLE`; entrada `hoy+30`, salida `hoy+31`; `rooms` `[{"guestCount": 4}]` | `400` con el código `GUEST_COUNT_EXCEEDS_CAPACITY` y "La cantidad de personas supera la capacidad de la habitación.": ninguna `DOBLE` admite 4 | [ ] | |
| 4 | Una categoría que el Módulo 1 no tiene | Abrir `https://gestionophospitua.tech/api/rooms?categoryRoom=PRESIDENCIAL`. Después, V1 con esa categoría | `PRESIDENCIAL`; entrada `hoy+30`, salida `hoy+31`; `rooms` `[{"guestCount": 1}]` | El Módulo 1 responde `400` con `VALIDATION_ERROR`. La vista previa responde `400` con el código `INVALID_CATEGORY` y "La categoría indicada no es válida.", nunca un `500` | [ ] | La categoría válida sin habitaciones (escenario 3) está en las limitaciones |

--------------------------------------------------------------------------------

##### Section 3: Consulta por habitación (escenario 1, FR-001 y FR-004)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una habitación pedida que admite a sus personas | V1 con la 203 pedida por su `roomId` (sale en la respuesta de la sección 2, paso 1) | `DOBLE`; entrada `hoy+30`, salida `hoy+31`; `rooms` `[{"guestCount": 3, "roomId": "<id de la 203>"}]` | `200`, con la 203 asignada: su capacidad es 3 | [ ] | |
| 2 | Una habitación pedida con más personas de las que admite | La misma consulta con la 202 | `rooms` `[{"guestCount": 3, "roomId": "<id de la 202>"}]` | `400` `GUEST_COUNT_EXCEEDS_CAPACITY`: la capacidad de la 202 es 2 | [ ] | |
| 3 | Crear una reserva de sonda | Reservas → Nueva reserva directa, con un titular ficticio | `DOBLE`; entrada `hoy+40`, salida `hoy+41`; 1 habitación, 1 persona | La reserva queda creada | [ ] | Anotar el código |
| 4 | Elegir habitaciones de otras categorías al modificar | Abrir la reserva → modificar. Abrir la lista de habitaciones | N/A | La lista ofrece las 19 habitaciones. Al elegir la 303, la columna "Categoría" muestra `SUITE` | [ ] | |
| 5 | La capacidad de la habitación elegida | Con la 303, poner 4 personas; después, elegir la 202 con 3 personas | 303 con 4; 202 con 3 | Con la 303 no hay error de capacidad. Con la 202 aparece "La cantidad de personas supera la capacidad de la habitación." y "Guardar cambios" queda deshabilitado (FR-004) | [ ] | |
| 6 | Dejar limpia la demo | "Volver sin guardar" y cancelar la reserva de sonda | N/A | La reserva de sonda queda "Cancelada" | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: Datos inválidos y Módulo 1 sin responder (casos borde y FR-005)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una categoría con otro formato | V1 | `categoryRoom` `doble` | `400` con el código `INVALID_CATEGORY` y "La categoría indicada no es válida." | [ ] | |
| 2 | Una categoría vacía | V1 | `categoryRoom` `""` | `400` `INVALID_CATEGORY`, el mismo mensaje | [ ] | |
| 3 | Un `roomId` con caracteres inválidos | V1 | `rooms` `[{"guestCount": 1, "roomId": "202"}]` | `400` con el código `INVALID_ROOM_ID` y "El identificador de la habitación es inválido." | [ ] | |
| 4 | Un `roomId` que no existe | V1 | `roomId` `00000000-0000-4000-8000-000000000000` | `400` `INVALID_ROOM_ID`, el mismo mensaje: el Módulo 1 responde `404` | [ ] | |
| 5 | Módulo 1 sin responder | En local, cambiar `MODULE1_BASE_URL` en `backend/.env` a un puerto donde no hay nada y reiniciar el backend. Abrir Habitaciones y repetir la sección 2, paso 1, en la documentación de la API local | `MODULE1_BASE_URL=http://localhost:4998` | Habitaciones muestra "No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo." y la vista previa responde `400` con el código `INVENTORY_UNAVAILABLE`, nunca un `500` | [ ] | |
| 6 | Volver a la normalidad | Devolver `MODULE1_BASE_URL` a `https://gestionophospitua.tech`, reiniciar el backend y volver a Habitaciones | N/A | Las 19 habitaciones otra vez | [ ] | |
| 7 | Dejar limpio el entorno local | Publicar el Check-Out de la reserva de la sección 1, paso 5 | N/A | La reserva queda "Completada" | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si el Módulo 1 no responde o se agota el tiempo de espera? `400` "No se pudo consultar
  el inventario de habitaciones en este momento. Intente de nuevo." (sección 4, paso 5). El tiempo de espera
  está en las limitaciones.
* **EC-002** : ¿Qué pasa con un `roomId` que no existe o tiene caracteres inválidos? `400` "El identificador de
  la habitación es inválido." (sección 4, pasos 3 y 4).
* **EC-003** : ¿Qué pasa con una categoría vacía o con otro formato? `400` "La categoría indicada no es válida."
  (sección 4, pasos 1 y 2). Lo mismo con una categoría que el Módulo 1 no tiene (sección 2, paso 4).
* **EC-004** : ¿Qué pasa con una habitación ocupada hoy? Se devuelve igual; si está libre en unas fechas lo
  decide la verificación de disponibilidad (sección 1, paso 5, y sección 2, paso 2).
* **EC-005** : ¿Qué pasa con una categoría válida que no tiene habitaciones? Lista vacía, sin error; está en
  las limitaciones.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva sobre una habitación que no existe, más personas de las que caben en una habitación, o un `500` cuando el Módulo 1 no responde. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, "Habitaciones" sin alguna habitación del Módulo 1, una capacidad distinta de la del Módulo 1, o una habitación ocupada que desaparece de la lista. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, la tabla de Habitaciones fuera del orden por categoría y número. |
