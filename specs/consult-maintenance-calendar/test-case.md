### Test Case Specification: Consultar Calendario de Mantenimientos
**Created** : 2026-11-14  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-006-ConsultMaintenanceCalendar
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que el Módulo 2 lee bien el calendario de mantenimientos del Módulo 1 y nunca
reserva una habitación que estará en reparación:
- una habitación sin mantenimientos en las fechas pedidas se informa libre (escenario 1);
- un mantenimiento que se cruza con la estadía, total o parcialmente, la deja inhabilitada y devuelve los días
  del cruce (escenario 2, FR-002 y FR-003);
- un mantenimiento que termina el día antes de la llegada, o que empieza el día de la salida, no la bloquea
  (escenario 3);
- un mantenimiento siempre bloquea: la reserva no se puede hacer sobre esa habitación (FR-002 y SC-002);
- la pantalla "Habitaciones" muestra el mantenimiento próximo de cada habitación con la misma consulta
  (FR-007);
- las fechas o identificadores inválidos y el Módulo 1 sin responder dan un `400` controlado, sin asumir que la
  habitación está libre (FR-005 y FR-006).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Consultar Calendario de Mantenimientos | Specification Document | [specs/consult-maintenance-calendar/spec.md](spec.md) |
| Consultar Calendario de Mantenimientos | Plan Document | [specs/consult-maintenance-calendar/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) y primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La consulta no tiene pantalla propia. El periodo del cruce solo se ve en la respuesta de la vista previa de
  la reserva directa (`POST /api/reservations/direct/preview`): por cada habitación de la categoría,
  `available`, `reason`, `message` y, con `MAINTENANCE`, `maintenance` con `overlapStart` y `overlapEnd`. En
  pantalla, el resultado se ve en "Habitaciones" y en la columna "Disponibilidad" de la modificación
  (TC-003-CheckRoomAvailability).
* Hoy el Módulo 1 responde `400` a `GET /api/rooms` sin categoría (pendiente del Módulo 1). "Habitaciones"
  parte de esa consulta, así que mientras no cambie muestra "No se pudo consultar el inventario de habitaciones
  en este momento. Intente de nuevo." y la sección 2 no puede pasar. La vista previa consulta por categoría y
  no se ve afectada.
* El calendario es del Módulo 1 real, que es de otro equipo: los mantenimientos que usan los pasos se le piden
  antes de ejecutar (precondiciones). Un aviso de mantenimiento publicado a mano en RabbitMQ no cambia su
  calendario.
* El inventario y el calendario los da el mismo Módulo 1: cuando no responde, primero falla el inventario. El
  mensaje propio de esta consulta ("No es posible validar mantenimientos en este momento. Intente de nuevo."),
  el tiempo de espera agotado y la habitación que la pantalla muestra con "No se pudo consultar el
  mantenimiento" los cubre
  `backend/test/integration/consult-maintenance-calendar/consult-maintenance-calendar.service.spec.ts`.
* NFR-001 (menos de 1 s por consulta) no se puede aislar a mano. Se observa como cota superior en la
  sección 2, paso 2.

##### Dependencies & Assumptions
* TC-007-ConsultRoomInventory debe pasar primero: la pantalla "Habitaciones" y la vista previa parten del
  inventario.
* La disponibilidad que se envía a Channex sin las habitaciones en mantenimiento la verifica
  TC-005-ConfigureOta (sección 3).

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live* y las claves `X-Internal-Key` que exijan
  los Módulos 1 y 3 en el panel de Render. Fechas relativas: `hoy` es la fecha del hotel (`America/Bogota`) el
  día en que se ejecuta, y `hoy+N`, N días después. En pantalla, las fechas se ven como `DD/MM/AAAA`.
* **Habitaciones del Módulo 1** (al 2026-11-20): 14 en tres categorías. `SENCILLA` 101, 102, 201, 301 y 410;
  `DOBLE` 103, 109, 202, 203 y 302; `SUITE` 105, 204, 303 y 604. Antes de ejecutar, compararlas con
  `GET https://gestionophospitua.tech/api/rooms?categoryRoom=…`; si cambiaron, usar una de la misma categoría.
* **Mantenimientos que se le piden al Módulo 1**, en su sistema y relativos al día de la ejecución. Sus dos
  fechas están incluidas:
  * la 109 (`DOBLE`, `roomId` `de883f27-0bc5-4fe2-8f42-5cda86c6d375`), del `hoy-1` al `hoy+1`: se pide el día
    anterior a la ejecución, para que ya haya empezado;
  * la 102 y la 301 (`SENCILLA`, `roomId` `a0000000-0000-0000-0000-000000000102` y
    `a0000000-0000-0000-0000-000000000301`), del `hoy+5` al `hoy+7` y del `hoy+5` al `hoy+6`;
  * la 202 (`DOBLE`, `roomId` `a0000000-0000-0000-0000-000000000202`), del `hoy+9` al `hoy+11`;
  * la 303 (`SUITE`, `roomId` `a0000000-0000-0000-0000-000000000303`), del `hoy+15` al `hoy+18`.

  La 202 y la 303 son las mismas de TC-003-CheckRoomAvailability. Comprobarlos con
  `GET https://gestionophospitua.tech/api/rooms/{roomId}/maintenances?startDate=…&endDate=…`, del `hoy` al
  `hoy+30`: cada uno aparece en `conflicts`. Anotar también los mantenimientos que el Módulo 1 tenga en las
  demás habitaciones en esas fechas: cambian los conteos de los pasos 9 y 11 de la sección 1 y la sección 2,
  paso 1.
* **Reservas de la demo** : la verificación revisa primero las reservas y después el calendario. Si en un paso
  la habitación sale con `reason` `RESERVED`, otra reserva de la demo la ocupa alguna de esas noches: si es de
  prueba, se cancela y se repite el paso.
* **Environment** :
  * Staging, la demo de Render (secciones 1 y 2, y sección 3, pasos 1 a 3):
    * frontend: `https://hospitua-m2-frontend.onrender.com`;
    * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
    * Módulo 3: `https://hospitua-module-3.onrender.com`. La vista previa también cotiza, y el Módulo 3 está en
      el plan gratuito de Render: abrir su `/docs` antes de empezar, para que no esté dormido.
  * Local (sección 3, pasos 4 y 5), con los "Primeros pasos" del README: frontend en `http://localhost:5173` y
    documentación de la API en `http://localhost:3000/api/docs`. `backend/.env.example` ya apunta a los Módulos
    1 y 3 reales.
* **Cuerpo V1** de la vista previa, con las fechas de cada paso:

  ```json
  {
    "startDate": "<entrada>",
    "endDate": "<salida>",
    "categoryRoom": "DOBLE",
    "rooms": [{ "guestCount": 1 }]
  }
  ```
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * claves `X-Internal-Key` de los Módulos 1 y 3 para `backend/.env`, si las exigen: las tiene quien administra
    la demo;
  * el contacto del Módulo 1, para los mantenimientos.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Mantenimientos que cruzan una estadía (escenarios 1, 2 y 3, FR-002 y FR-003)
Todos los pasos usan la documentación de la API → `POST /api/reservations/direct/preview` con el cuerpo V1, y
miran la habitación indicada dentro de `availability.rooms`.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Sin mantenimientos en el rango | V1 | Entrada `hoy+30`, salida `hoy+31` | `200`. Ninguna de las 5 habitaciones `DOBLE` tiene `reason` `MAINTENANCE` (escenario 1) | [ ] | Si el Módulo 1 tiene un mantenimiento propio esas noches, usar otras fechas sin mantenimientos |
| 2 | Un mantenimiento dentro de la estadía | V1 | Entrada `hoy+8`, salida `hoy+13` | La 202 con `available` `false`, `reason` `MAINTENANCE`, `message` "La habitación estará inhabilitada por mantenimiento en esas fechas." y `maintenance` de `hoy+9` a `hoy+11` (escenario 2, cruce total) | [ ] | |
| 3 | Un cruce al principio de la estadía | V1 | Entrada `hoy+10`, salida `hoy+13` | La 202 con `MAINTENANCE` y cruce de `hoy+10` a `hoy+11` (escenario 2, cruce parcial) | [ ] | |
| 4 | Un cruce al final de la estadía | V1 | Entrada `hoy+7`, salida `hoy+10` | La 202 con `MAINTENANCE` y cruce de `hoy+9` a `hoy+9`: la noche de la salida no cuenta (escenario 2, cruce parcial) | [ ] | |
| 5 | Una estadía dentro del mantenimiento | V1 | Entrada `hoy+10`, salida `hoy+11` | La 202 con `MAINTENANCE` y cruce de `hoy+10` a `hoy+10` | [ ] | |
| 6 | Un mantenimiento que termina el día antes de la llegada | V1 | Entrada `hoy+12`, salida `hoy+13` | La 202 con `available` `true` y sin `maintenance` (escenario 3) | [ ] | |
| 7 | Un mantenimiento que empieza el día de la salida | V1 | Entrada `hoy+7`, salida `hoy+9` | La 202 con `available` `true`: la estadía no ocupa la noche del `hoy+9` | [ ] | |
| 8 | Un mantenimiento que ya empezó | V1 | Entrada `hoy`, salida `hoy+1` | La 109 con `MAINTENANCE` y cruce de `hoy` a `hoy`, aunque el mantenimiento empezó ayer | [ ] | |
| 9 | Dos habitaciones de la misma categoría a la vez | V1 con `categoryRoom` `SENCILLA` | Entrada `hoy+5`, salida `hoy+6` | La 102 y la 301 con `MAINTENANCE`. `availableCount` cuenta solo las demás `SENCILLA` libres: 3 si no tienen reservas ni otros mantenimientos esa noche | [ ] | |
| 10 | Un mantenimiento siempre bloquea | V1 con `categoryRoom` `SENCILLA` y la 301 pedida por su `roomId` | Entrada `hoy+5`, salida `hoy+6`; `rooms` `[{"guestCount": 1, "roomId": "a0000000-0000-0000-0000-000000000301"}]` | `400` con el código `ROOM_NOT_AVAILABLE` y "La habitación 301 no está disponible para el rango de fechas solicitado." (FR-002 y SC-002) | [ ] | |
| 11 | Más habitaciones que las libres por mantenimiento | V1 con `categoryRoom` `SENCILLA` y una habitación más que el `availableCount` del paso 9 | Entrada `hoy+5`, salida `hoy+6` | `400` con el código `NO_AVAILABILITY` y "Error 400: La habitación no está disponible para el rango de fechas solicitado" | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: Mantenimiento próximo en "Habitaciones" (FR-007)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ver el mantenimiento próximo de cada habitación | Entrar al frontend → Habitaciones | `Laura Méndez` | La columna "Mantenimiento próximo" muestra `DD/MM/AAAA → DD/MM/AAAA` con las fechas de las precondiciones en la 109, 102, 301, 202 y 303, y en las que tengan un mantenimiento propio del Módulo 1. Las demás muestran "Sin mantenimiento próximo" | [ ] | La pantalla mira de `hoy` a `hoy+29` |
| 2 | Medir la pantalla completa | Herramientas del navegador → Red, recargar Habitaciones y mirar `GET /api/rooms` | N/A | Responde en menos de 1 s con la demo despierta: incluye una consulta al calendario por cada una de las 14 habitaciones (NFR-001, cota superior) | [ ] | Opcional |
| 3 | La consulta no cambia el calendario | Repetir la sección 1 y volver a Habitaciones | N/A | Los mismos mantenimientos que en el paso 1 (FR-004) | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Datos inválidos y Módulo 1 sin responder (casos borde, FR-005 y FR-006)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Fechas al revés | V1 | Entrada `hoy+11`, salida `hoy+9` | `400` con el código `INVALID_STAY_DATES` y "Rango de fechas inválido. Verifique las fechas seleccionadas." | [ ] | |
| 2 | `roomId` con caracteres inválidos | V1 con un `roomId` que es un número de habitación | `rooms` `[{"guestCount": 1, "roomId": "202"}]`; entrada `hoy+30`, salida `hoy+31` | `400` con el código `INVALID_ROOM_ID` y "El identificador de la habitación es inválido." | [ ] | |
| 3 | `roomId` que no existe | V1 con un UUID que no es de ninguna habitación | `roomId` `00000000-0000-4000-8000-000000000000`; las mismas fechas | `400` `INVALID_ROOM_ID`, el mismo mensaje: el Módulo 1 responde `404` | [ ] | |
| 4 | Módulo 1 sin responder | En local, cambiar `MODULE1_BASE_URL` en `backend/.env` a un puerto donde no hay nada y reiniciar el backend. Abrir Habitaciones y repetir el paso 2 de la sección 1 en la documentación de la API local | `MODULE1_BASE_URL=http://localhost:4998` | Habitaciones muestra "No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo.", y la vista previa responde `400` con el código `INVENTORY_UNAVAILABLE`. En ningún caso se muestra la habitación libre (FR-005) | [ ] | |
| 5 | Volver a la normalidad | Devolver `MODULE1_BASE_URL` a `https://gestionophospitua.tech`, reiniciar el backend y repetir el paso 2 de la sección 1 en local | N/A | La 202 vuelve a salir con `MAINTENANCE` y cruce de `hoy+9` a `hoy+11` | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si el Módulo 1 no responde o se agota el tiempo de espera? `400` con "No es posible
  validar mantenimientos en este momento. Intente de nuevo.", sin asumir que la habitación está libre. Primero
  falla el inventario (sección 3, paso 4); el mensaje propio está en las limitaciones.
* **EC-002** : ¿Qué pasa con una salida anterior a la llegada? `400` "Rango de fechas inválido. Verifique las
  fechas seleccionadas." (sección 3, paso 1).
* **EC-003** : ¿Qué pasa con un `roomId` que no existe o tiene caracteres inválidos? `400` "El identificador de
  la habitación es inválido." (sección 3, pasos 2 y 3).
* **EC-004** : ¿Qué pasa si un mantenimiento se programa después de crear la reserva? El Módulo 1 consulta antes
  las reservas de esas fechas (TC-004-CheckViewReservation, sección 2, paso 10) y, al registrarlo, lo avisa por
  cola para que se descuente de Channex (TC-005-ConfigureOta, sección 3).
* **EC-005** : ¿Cuenta la noche de la salida en el cruce? No: el cruce termina el día antes de la salida
  (sección 1, pasos 4 y 7).
* **EC-006** : ¿Bloquea un mantenimiento que ya empezó? Sí, en los días que le quedan (sección 1, paso 8).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una habitación en mantenimiento que se deja reservar, una habitación que se da por libre cuando el Módulo 1 no responde, o un `500`. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, un periodo de cruce equivocado, un mantenimiento contiguo que bloquea, o "Habitaciones" sin el mantenimiento próximo de una habitación. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, las fechas del mantenimiento sin el formato `DD/MM/AAAA`. |
