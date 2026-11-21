### Test Case Specification: Verificar Disponibilidades
**Created** : 2026-11-14  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-003-CheckRoomAvailability
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que la verificación de disponibilidad, la misma para todos los flujos de reserva,
dice con certeza si una habitación se puede ocupar en unas fechas:
- una habitación libre está disponible, y una con un mantenimiento del Módulo 1 o con otra reserva que se
  cruza no lo está, con su motivo por habitación (escenarios 1 a 3 y FR-002a);
- una habitación ocupada hoy por un huésped alojado no está disponible (escenario 4);
- una modificación no choca consigo misma (escenario 5 y FR-003);
- las reservas canceladas, completadas o que no se presentaron, y las habitaciones ya liberadas de una reserva
  en curso, no bloquean (escenarios 6 y 7);
- la consulta por categoría cuenta solo las habitaciones disponibles (FR-001 y FR-004);
- las fechas inválidas, un `roomId` inválido o el Módulo 1 sin responder dan un `400` controlado, nunca
  disponibilidad asumida ni un `500` (FR-005 y FR-006).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Verificar Disponibilidades | Specification Document | [specs/check-room-availability/spec.md](spec.md) |
| Verificar Disponibilidades | Plan Document | [specs/check-room-availability/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) y primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La verificación no tiene pantalla propia: se ejecuta dentro de la nueva reserva directa (por categoría) y de
  la modificación de una reserva, que muestra la columna "Disponibilidad" por habitación con su motivo:
  "Disponible", "Reservada en esas fechas" o "En mantenimiento".
* Los mantenimientos son del Módulo 1 real, que es de otro equipo: se le piden antes de ejecutar (ver las
  precondiciones). Las dos fechas de un mantenimiento están incluidas. La salida de una estadía no cuenta como
  noche.
* No se puede hacer que falle solo la consulta de mantenimientos del Módulo 1, ni provocar un tiempo de espera
  agotado. Lo cubre `backend/test/integration/check-room-availability/verify-availability-edge-cases.spec.ts`.
  En local se deja sin responder todo el Módulo 1 (sección 4).
* En la demo, el Check-In y el Check-Out solo los publica el Módulo 1 real. La sección 2 se ejecuta en local,
  donde se publican a mano.
* NFR-001 (menos de 2 s) solo se puede medir a mano como cota superior: la consulta de la nueva reserva
  también cotiza en el Módulo 3. La medición exacta está en `verify-availability-time.spec.ts`.
* Que las habitaciones sin asignar de una reserva de Booking en conflicto no bloqueen nada no se puede armar a
  mano. Lo cubre `verify-availability.spec.ts`.
* La habitación que no llegó (`NOT_ARRIVED`) solo aparece con el cierre del día: el paso que la usa se ejecuta
  al día siguiente (sección 2, paso 7).

##### Dependencies & Assumptions
* TC-007-ConsultRoomInventory y TC-006-ConsultMaintenanceCalendar deben pasar primero: la verificación usa el
  inventario y los mantenimientos del Módulo 1.
* TC-009-GenerateDirectReservation y TC-013-UpdateReservation deben pasar primero: sus pantallas son las que
  muestran el resultado de la verificación.
* La verificación no bloquea la habitación: la creación vuelve a verificar antes de guardar.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live* y las claves `X-Internal-Key` que exijan
  los Módulos 1 y 3 en el panel de Render, y el entorno local listo. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. Si una categoría no tiene cupo
  en las fechas de un paso por otras reservas, se usa otra con habitaciones libres.
* **Habitaciones del Módulo 1** (al 2026-11-21): `BOUTIQUE` 205, 304, 407, 408 y 409; `DOBLE` 103, 109, 202,
  203 y 302; `SENCILLA` 101, 102, 201, 301 y 410; `SUITE` 105, 204, 303 y 604. Antes de ejecutar, compararlas con
  `GET https://gestionophospitua.tech/api/rooms?categoryRoom=…`; si cambiaron, usar una de la misma categoría y
  ajustar los conteos de la sección 3.
* **Mantenimientos que se le piden al Módulo 1** antes de ejecutar, en su sistema y relativos al día de la
  ejecución:
  * la 202 (`DOBLE`, `roomId` `a0000000-0000-0000-0000-000000000202`), del `hoy+9` al `hoy+11`;
  * la 303 (`SUITE`, `roomId` `a0000000-0000-0000-0000-000000000303`), del `hoy+15` al `hoy+18`.

  Comprobarlos con `GET https://gestionophospitua.tech/api/rooms/{roomId}/maintenances?startDate=…&endDate=…`,
  del `hoy` al `hoy+30`: cada uno aparece en `conflicts`. Si las otras habitaciones de esas categorías tienen
  mantenimientos en las fechas de los pasos, se usan otras fechas.
* **Environment** :
  * Staging, la demo de Render (secciones 1, 3 y 4, pasos 1 a 3):
    * frontend: `https://hospitua-m2-frontend.onrender.com`;
    * backend: `https://hospitua-m2-backend.onrender.com/api/docs`.
  * Local (sección 2 y sección 4, pasos 4 y 5), con los "Primeros pasos" del README: frontend en
    `http://localhost:5173` y el panel de RabbitMQ en `http://localhost:15672`, con el usuario y la clave del
    README. `backend/.env.example` ya apunta a los Módulos 1 y 3 reales; si el Módulo 1 tarda más de lo que
    espera el backend local, subir `MODULE1_TIMEOUT_MS` a `2000`, como en la demo. El Check-In y el Check-Out
    se publican a mano en `hospitua.events`, con el cuerpo C1 de TC-002-CancelReservation.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * claves `X-Internal-Key` de los Módulos 1 y 3 para `backend/.env`, si las exigen: las tiene quien administra
    la demo.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Disponibilidad por habitación (escenarios 1, 2, 3 y 5)
Se ejecuta en la demo. La reserva A ocupa una habitación. La reserva B sirve de sonda: en su modificación se
eligen otras habitaciones y fechas para ver la columna "Disponibilidad", sin confirmar.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear la reserva A | Entrar al frontend → Reservas → Nueva reserva directa, con un titular ficticio | `DOBLE`; entrada `hoy+40`, salida `hoy+42`; 1 habitación | La reserva queda creada, con una habitación asignada | [ ] | Anotar el código y el número de la habitación (X) |
| 2 | Crear la reserva B | Reservas → Nueva reserva directa | `DOBLE`; entrada `hoy+50`, salida `hoy+51`; 1 habitación | La reserva queda creada | [ ] | Anotar el código |
| 3 | Habitación libre | Abrir B → modificar. Elegir la habitación 302 y cambiar las fechas | 302; entrada `hoy+30`, salida `hoy+31` | "Disponible" (escenario 1) | [ ] | Si la 302 es la X, usar otra `DOBLE` sin mantenimiento |
| 4 | Habitación en mantenimiento | En la misma modificación, elegir la 202 | 202; entrada `hoy+10`, salida `hoy+11` | "En mantenimiento" (escenario 2) | [ ] | |
| 5 | Salir el día que empieza el mantenimiento | Cambiar las fechas | 202; entrada `hoy+7`, salida `hoy+9` | "Disponible": la noche del `hoy+9` no se ocupa | [ ] | |
| 6 | Llegar el día después del mantenimiento | Cambiar las fechas | 202; entrada `hoy+12`, salida `hoy+13` | "Disponible": el mantenimiento termina el `hoy+11`, incluido | [ ] | |
| 7 | Habitación con otra reserva que se cruza | Elegir la habitación X | X; entrada `hoy+41`, salida `hoy+43` | "Reservada en esas fechas" (escenario 3) | [ ] | |
| 8 | Llegar el día que sale la otra reserva | Cambiar las fechas | X; entrada `hoy+42`, salida `hoy+43` | "Disponible" | [ ] | |
| 9 | Salir sin guardar | Salir de la modificación de B sin confirmar | N/A | B sigue como en el paso 2 | [ ] | |
| 10 | Modificar A sin chocar consigo misma | Abrir A → modificar → cambiar las fechas, con la misma habitación X | X; entrada `hoy+41`, salida `hoy+43` | "Disponible": la propia reserva no cuenta en el cruce (escenario 5) | [ ] | Salir sin confirmar |
| 11 | Dejar limpia la demo | Cancelar A y B | N/A | Las dos quedan "Cancelada" | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: Reservas que bloquean y reservas que no (escenarios 4, 6 y 7)
Se ejecuta en local, con el Check-In y el Check-Out publicados a mano. B vuelve a ser la sonda.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear la reserva B | En local, entrar al frontend → Reservas → Nueva reserva directa | `DOBLE`; entrada `hoy+50`, salida `hoy+51`; 1 habitación | La reserva queda creada | [ ] | Anotar el código |
| 2 | Crear la reserva A y cancelarla | Crear A y después cancelarla: abrirla → Cancelar reserva → confirmar | `DOBLE`; entrada `hoy+40`, salida `hoy+42`; 1 habitación | A queda "Cancelada" | [ ] | Anotar el número de su habitación (X) |
| 3 | Una reserva cancelada no bloquea | Abrir B → modificar → elegir X | X; entrada `hoy+41`, salida `hoy+43` | "Disponible" (escenario 6, `CANCELLED`) | [ ] | Salir sin confirmar |
| 4 | Poner en curso la reserva C | Crear C con dos habitaciones y llegada hoy, y publicar el Check-In solo de la primera | `SUITE`; entrada `hoy`, salida `hoy+1`; 2 habitaciones | C queda "En curso" | [ ] | Anotar el código y los números de sus dos habitaciones (Y1 con Check-In, Y2 sin) |
| 5 | La habitación de un huésped alojado bloquea | Abrir B → modificar → elegir Y1 | Y1; entrada `hoy`, salida `hoy+1` | "Reservada en esas fechas" (escenario 4) | [ ] | |
| 6 | Una habitación liberada dentro de una reserva en curso no bloquea | Publicar el Check-Out de Y1. Volver a la modificación de B con Y1 | Y1; entrada `hoy`, salida `hoy+1` | C sigue "En curso" (Y2 no llegó), pero Y1 sale "Disponible" (escenario 7, `CHECKED_OUT`). En la modificación de B, Y2 sigue "Reservada en esas fechas": la habitación que todavía se espera bloquea | [ ] | Salir sin confirmar |
| 7 | Una habitación que no llegó no bloquea | Al día siguiente, arrancar el backend local (al arrancar cierra el día anterior) y verificar Y2 en las fechas de C desde la modificación de B | Y2; entrada `hoy`, salida `hoy+1` (las fechas de C) | Y2 está "No llegó" en C y sale "Disponible" (escenario 7, `NOT_ARRIVED`) | [ ] | Se ejecuta al día siguiente |
| 8 | Una reserva completada no bloquea | Crear D con una habitación y llegada hoy, publicar su Check-In y su Check-Out, y verificar su habitación desde B | `SENCILLA`; entrada `hoy`, salida `hoy+1` | D queda "Completada" y su habitación sale "Disponible" (escenario 6, `COMPLETED`) | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Disponibilidad por categoría y verificaciones simultáneas (FR-001, FR-004 y casos borde)
Se ejecuta en la demo.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Contar por categoría con un mantenimiento | Reservas → Nueva reserva directa → consultar | `SUITE`; entrada `hoy+16`, salida `hoy+17`; 1 habitación | "3 habitaciones SUITE disponibles.": la 303 está en mantenimiento (sin otras reservas de `SUITE` esas noches) | [ ] | Opcional (NFR-001): en las herramientas del navegador → Red, la consulta tarda menos de 2 s; incluye la cotización |
| 2 | Pedir más habitaciones de las disponibles | Agregar habitaciones hasta 4 y consultar | `SUITE`; las mismas fechas; 4 habitaciones | Un mensaje de falta de disponibilidad y no se puede crear la reserva | [ ] | |
| 3 | Dos verificaciones a la vez | En dos pestañas, consultar la misma reserva hasta ver la tarifa en las dos | `SUITE`; las mismas fechas; 3 habitaciones | Las dos pestañas la muestran disponible: verificar no bloquea | [ ] | |
| 4 | Crear en las dos pestañas | Crear en la primera y después en la segunda | Titular ficticio | La primera se crea. La segunda se rechaza por falta de disponibilidad: la creación vuelve a verificar | [ ] | |
| 5 | Dejar limpia la demo | Cancelar la reserva creada en el paso 4 | N/A | La reserva queda "Cancelada" | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: Datos inválidos y Módulo 1 sin responder (casos borde, FR-005 y FR-006)
Los pasos 1 a 3 se ejecutan en la demo; los pasos 4 y 5, en local, porque el Módulo 1 es de otro equipo.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Fechas inválidas | Documentación de la API → `POST /api/reservations/direct/preview` | `DOBLE`; entrada `hoy+31`, salida `hoy+30`; 1 habitación | `400` con el código `INVALID_STAY_DATES` y "Rango de fechas inválido. Verifique las fechas seleccionadas." | [ ] | |
| 2 | `roomId` con caracteres inválidos | `POST /api/reservations/direct/preview` con una habitación por `roomId` | `roomId` `habitacion-201` | `400` con el código `INVALID_ROOM_ID` y "El identificador de la habitación es inválido." | [ ] | |
| 3 | `roomId` que no existe | `POST /api/reservations/direct/preview` con un UUID que no es de ninguna habitación | `roomId` `00000000-0000-4000-8000-000000000000` | `400` `INVALID_ROOM_ID`, el mismo mensaje | [ ] | |
| 4 | Módulo 1 sin responder | En `backend/.env`, cambiar `MODULE1_BASE_URL` a un puerto donde no hay nada y reiniciar el backend. Después, Reservas → Nueva reserva directa → consultar | `MODULE1_BASE_URL=http://localhost:4998`; `DOBLE`; entrada `hoy+30`, salida `hoy+31` | "No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo." No se muestra disponibilidad ni se puede crear la reserva | [ ] | |
| 5 | Volver a la normalidad | Devolver `MODULE1_BASE_URL` a `https://gestionophospitua.tech`, reiniciar el backend y repetir la consulta | Los mismos datos | Se muestra la disponibilidad y la tarifa | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si el Módulo 1 no responde o agota el tiempo de espera? `400` con "No es posible
  validar mantenimientos en este momento. Intente de nuevo." o, si falla el inventario, "No se pudo consultar
  el inventario de habitaciones en este momento. Intente de nuevo." (sección 4, paso 4). Nunca se asume
  disponibilidad.
* **EC-002** : ¿Qué pasa con una salida anterior o igual a la llegada? `400` "Rango de fechas inválido.
  Verifique las fechas seleccionadas." (sección 4, paso 1).
* **EC-003** : ¿Qué pasa con un `roomId` que no existe o con caracteres inválidos? `400` "El identificador de la
  habitación es inválido." (sección 4, pasos 2 y 3).
* **EC-004** : ¿Qué pasa con dos verificaciones simultáneas de la misma habitación? Las dos pueden responder
  disponible; la creación vuelve a verificar (sección 3, pasos 3 y 4).
* **EC-005** : ¿Bloquea una reserva que sale el mismo día en que llega otra? No: la salida no cuenta como noche
  (sección 1, paso 8).
* **EC-006** : ¿Bloquea un mantenimiento que empieza el día de la salida? No: el mantenimiento incluye sus dos
  fechas, pero la estadía no ocupa la noche de la salida (sección 1, paso 5).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una habitación en mantenimiento o con otra reserva que sale disponible (sobreventa), disponibilidad asumida cuando el Módulo 1 no responde, o un `500`. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, una reserva cancelada que sigue bloqueando su habitación, o una modificación que choca consigo misma. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, el motivo de una habitación no disponible que no se muestra con su texto. |
