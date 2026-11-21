### Test Case Specification: Calcular Tarifa Dinámica
**Created** : 2026-11-14  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-001-CalculateDynamicRate
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que el Módulo 2 obtiene del Módulo 3 la tarifa de cada habitación y la guarda tal
cual la recibe:
- al crear una reserva directa, una cotización por habitación; cada habitación guarda su `lodgingAmount` y su
  `quoteId`, y el total es solo la suma de esas tarifas (historia 1, FR-002, FR-002a y NFR-002);
- sin disponibilidad, no se llama al Módulo 3 (historia 1, escenario 3);
- al modificar una reserva, se recotizan solo las habitaciones afectadas, se muestra la tarifa nueva sin la
  anterior ni diferencias, y se guarda solo al confirmar (historia 2 y FR-007);
- si el Módulo 3 no responde, no se crea ni se modifica nada y la respuesta es un `400` controlado, nunca una
  tarifa asumida (FR-003, FR-004 y FR-008);
- el Módulo 3 recibe los `quoteIds` de cada reserva directa (FR-010);
- la pantalla "Tarifas" es solo de referencia y no llama al Módulo 3 (FR-009).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Calcular Tarifa Dinámica | Specification Document | [specs/calculate-dynamic-rate/spec.md](spec.md) |
| Calcular Tarifa Dinámica | Plan Document | [specs/calculate-dynamic-rate/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) y primeros pasos en local | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Las tarifas las calcula el Módulo 3 real con sus reglas de temporada, que son de otro equipo y no se prueban
  aquí. Por eso los pasos no fijan importes: comparan lo que muestra la consulta con lo que se guarda y con lo
  que recibe el Módulo 3. Dos habitaciones de la misma categoría pueden tener tarifas distintas.
* El Módulo 2 no escribe en el log las cotizaciones que salen bien, y los logs del Módulo 3 no son nuestros.
  Cuántas veces se llama al Módulo 3 (una por habitación al crear, ninguna sin disponibilidad, solo las
  habitaciones afectadas al modificar) lo cubren
  `backend/test/integration/calculate-dynamic-rate/calculate-dynamic-rate.service.spec.ts` y
  `backend/test/integration/use-cases/calculate-dynamic-rate/recalculation-scenarios.spec.ts`. A mano se ve por
  sus efectos: los `quoteId` de cada habitación que recibe el Módulo 3 y, en local, lo que sigue funcionando con
  el Módulo 3 sin responder (secciones 4 y 5).
* En la demo no se puede dejar sin responder al Módulo 3, que es de otro equipo. Las secciones 4 y 5 se
  ejecutan en local.
* La demo no configura `RATE_REFERENCE`, así que su pantalla "Tarifas" no tiene tarifas de referencia y
  muestra "No hay tarifas de referencia configuradas." (lo cubre `frontend/src/pages/rates/RatesPage.test.tsx`).
  La sección 5 se ejecuta en local, con la de `backend/.env.example`.
* NFR-001 (menos de 1,5 s para la llamada al Módulo 3) no se puede medir sola a mano. El tiempo de la consulta
  de disponibilidad y tarifa es una cota superior: también incluye al Módulo 1.
* No se pueden provocar a mano estos casos. Los cubren las pruebas de integración:
  * el Módulo 3 que responde después del tiempo máximo de espera, y una categoría que el Módulo 3 no conoce:
    `calculate-dynamic-rate.service.spec.ts`;
  * todo o nada (FR-002a): de tres cotizaciones falla una y no se guarda ninguna, al crear y al modificar:
    `calculate-dynamic-rate.service.spec.ts` y `recalculation-scenarios.spec.ts`;
  * la tarifa cambia entre la vista previa y la confirmación: `recalculation-scenarios.spec.ts`.

##### Dependencies & Assumptions
* TC-003-CheckRoomAvailability debe pasar primero: la disponibilidad se verifica antes de cotizar.
* TC-009-GenerateDirectReservation y TC-013-UpdateReservation deben pasar primero: este caso usa sus flujos
  para crear y modificar la reserva.
* TC-004-CheckViewReservation debe pasar primero: el detalle de la reserva y la consulta del Módulo 3 son
  suyos.
* La tarifa la fija el Módulo 3 por habitación y fechas: la cantidad de personas no se le envía.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live* y las claves `X-Internal-Key` que exijan
  los Módulos 1 y 3 en el panel de Render. Fechas relativas: `hoy` es la fecha del hotel (`America/Bogota`) el
  día en que se ejecuta, y `hoy+N`, N días después. Las secciones 1 y 2 usan la misma reserva, y la sección 2 la
  cancela al final. Las categorías del Módulo 1 real son `SENCILLA` (5 habitaciones), `DOBLE` (5) y `SUITE` (4):
  antes de ejecutar, comprobarlo con `GET https://gestionophospitua.tech/api/rooms?categoryRoom=…`. Si cambió
  la cantidad, ajustar la sección 3, paso 1, y la sección 4, paso 6.
* **Environment** : Staging. Las secciones 1 a 3 se ejecutan en la demo de Render:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
  * Módulo 3: `https://hospitua-module-3.onrender.com`. Está en el plan gratuito de Render: abrir su `/docs`
    antes de empezar, para que no esté dormido.

  Las secciones 4 y 5 se ejecutan en local, con los "Primeros pasos" del README: `backend/.env.example` ya
  apunta a los Módulos 1 y 3 reales. Si el Módulo 1 tarda más de lo que espera el backend local, subir
  `MODULE1_TIMEOUT_MS` a `2000`, como en la demo.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * claves `X-Internal-Key` de los Módulos 1 y 3 para `backend/.env` (secciones 4 y 5) y, si la demo exige
    `MODULE2_INTERNAL_KEY`, la nuestra para consultar con `X-Client` `MODULE3`: las tiene quien administra la
    demo.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Cotización de una reserva directa nueva (historia 1)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Despertar la demo y entrar | Abrir el backend y el `/docs` del Módulo 3, esperar a que respondan, abrir el frontend y entrar | `Laura Méndez` | Se abre la pantalla de inicio de la Recepcionista | [ ] | |
| 2 | Consultar la tarifa | Reservas → Nueva reserva directa. Llenar Estadía y Habitaciones | Categoría `DOBLE`; entrada `hoy+30`, salida `hoy+32`; 2 habitaciones, 1 persona en cada una | En "Disponibilidad y tarifa", cada habitación con 2 noches y su tarifa del Módulo 3, mayor que cero y en COP. El total es la suma exacta de las dos tarifas, sin impuestos, redondeos ni comisiones (FR-002 y NFR-002) | [ ] | Anotar la tarifa de cada habitación. Opcional (NFR-001): en las herramientas del navegador → Red, `POST /api/reservations/direct/preview` tarda menos de 1,5 s con la demo despierta. Si tarda más no prueba que falle: también incluye al Módulo 1 |
| 3 | Cambiar la cantidad de personas | En Habitaciones, poner 2 personas en una de las habitaciones | N/A | Cada habitación sigue con la tarifa anotada en el paso 2: la cantidad de personas no se envía al Módulo 3 | [ ] | |
| 4 | Crear la reserva | Llenar el Titular con datos ficticios y confirmar | Titular `Prueba Staging`, CC `1000000000` | La reserva queda creada, con su código `RSV-…` | [ ] | Anotar el código |
| 5 | Ver las tarifas guardadas | Reservas → abrir la reserva del paso 4 | Código del paso 4 | Estado activa; cada habitación con la tarifa anotada en el paso 2 y el total con su suma (escenario 1) | [ ] | |
| 6 | Ver lo que recibe el Módulo 3 | Documentación de la API → `GET /api/reservations/{reservationRef}` con `X-Client` `MODULE3` | Código del paso 4 | `200`, con `quoteIds`: dos identificadores distintos, uno por habitación, y `rooms` con el `roomId` de cada habitación y su `quoteId` (FR-010) | [ ] | Anotar los dos `quoteIds` |

--------------------------------------------------------------------------------

##### Section 2: Recotización por modificación de la estadía (historia 2)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ampliar las fechas sin confirmar | Abrir la reserva de la sección 1 → modificar. Cambiar la salida | Salida `hoy+33` | Después de "Consultando disponibilidad y tarifa…", cada habitación con 3 noches y su tarifa nueva del Módulo 3. No se muestra la tarifa anterior ni una diferencia (escenario 1) | [ ] | Anotar las tarifas nuevas |
| 2 | No confirmar | Salir de la modificación sin confirmar y volver al detalle | N/A | La reserva sigue con salida `hoy+32` y las tarifas de la sección 1 (escenario 2) | [ ] | |
| 3 | Ampliar las fechas y confirmar | Repetir el paso 1 y confirmar | Salida `hoy+33` | El detalle muestra la salida `hoy+33`, las tarifas anotadas en el paso 1 y el total con su suma. Con `X-Client` `MODULE3`, dos `quoteIds` nuevos, distintos de los de la sección 1, paso 6 (FR-007) | [ ] | Anotar el `quoteId` de cada `roomId` |
| 4 | Cambiar una habitación por otra de la misma categoría | Modificar → cambiar una habitación por otra `DOBLE` libre, sin tocar las fechas, y confirmar | Otra habitación `DOBLE` | "La tarifa no cambia." Al confirmar, las tarifas siguen como en el paso 3 y, con `X-Client` `MODULE3`, los `quoteIds` son los mismos del paso 3: no se volvió a cotizar (escenario 4) | [ ] | |
| 5 | Cambiar una habitación de categoría | Modificar → cambiar una de las habitaciones a `SUITE` | Categoría `SUITE` | Se cotiza solo esa habitación: su tarifa nueva por 3 noches, con el mismo detalle que al crear y sin tarifa anterior ni diferencia. La otra habitación conserva su tarifa (escenario 3) | [ ] | |
| 6 | Agregar una habitación | En la misma modificación, agregar una habitación | Categoría `SENCILLA`, 1 persona | Se cotiza solo la agregada: su tarifa por 3 noches. Las otras dos no cambian (escenario 3) | [ ] | |
| 7 | Confirmar y ver qué se recotizó | Confirmar la modificación. Después, `GET /api/reservations/{reservationRef}` con `X-Client` `MODULE3` | N/A | Tres habitaciones. En `rooms`, la `DOBLE` que no cambió conserva el `quoteId` del paso 4; la `SUITE` y la `SENCILLA` traen `quoteId` nuevos (escenario 3 y FR-007) | [ ] | |
| 8 | Dejar limpia la demo | Cancelar la reserva: abrirla → Cancelar reserva → confirmar | N/A | La reserva queda cancelada | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Sin disponibilidad y datos inválidos (historia 1, escenario 3, y FR-008)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Pedir más habitaciones de las que hay | Reservas → Nueva reserva directa | Categoría `SENCILLA`; entrada `hoy+30`, salida `hoy+31`; 6 habitaciones (la categoría tiene 5) | Un mensaje de falta de disponibilidad y no se puede crear la reserva. Que no se llama al Módulo 3 se comprueba en la sección 4, paso 6 (escenario 3) | [ ] | |
| 2 | Pedir una categoría que no existe | Documentación de la API → `POST /api/reservations/direct/preview` | `categoryRoom` `PRESIDENCIAL`, fechas `hoy+30` a `hoy+31` | `400` con un código de error estructurado, nunca `500` | [ ] | |
| 3 | Pedir fechas incoherentes | Documentación de la API → `POST /api/reservations/direct/preview` | Categoría `DOBLE`; entrada `hoy+31`, salida `hoy+30` | `400` con un código de error estructurado, nunca `500` | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: El Módulo 3 no responde (FR-003, FR-004 y casos borde)
Se ejecuta en local, porque en la demo no se puede dejar sin responder al Módulo 3.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear una reserva con el Módulo 3 respondiendo | En local, con el backend y el frontend arriba, crear una reserva directa | Categoría `DOBLE`; entrada `hoy+30`, salida `hoy+32`; 1 habitación | La reserva queda creada con la tarifa del Módulo 3 | [ ] | Anotar el código y la tarifa |
| 2 | Dejar al Módulo 3 sin responder | En `backend/.env`, cambiar `MODULE3_BASE_URL` a un puerto donde no hay nada y reiniciar el backend | `MODULE3_BASE_URL=http://localhost:4999` | El backend arranca; el Módulo 1 sigue respondiendo | [ ] | |
| 3 | Intentar una reserva nueva | Reservas → Nueva reserva directa con los datos del paso 1 | Los del paso 1 | El mensaje "Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde". No se muestra ninguna tarifa, ni a cero, y no se puede crear la reserva. La lista de reservas no tiene una nueva (escenario 2) | [ ] | |
| 4 | Intentar crearla por la API | Documentación de la API → `POST /api/reservations/direct` con un cuerpo completo | Los datos del paso 1 y un `Idempotency-Key` nuevo | `400` con el código `PRICING_UNAVAILABLE` y el mismo mensaje. No se crea la reserva (FR-003) | [ ] | |
| 5 | Intentar modificar la reserva del paso 1 | Abrir la reserva del paso 1 → modificar → cambiar la salida | Salida `hoy+33` | El mensaje "No se pudo calcular la nueva tarifa en este momento. Intente más tarde.". La reserva sigue con sus fechas y la tarifa anotada en el paso 1 (FR-004) | [ ] | |
| 6 | Pedir más habitaciones de las que hay | Reservas → Nueva reserva directa | Categoría `SENCILLA`; entrada `hoy+30`, salida `hoy+31`; 6 habitaciones | El mismo mensaje de falta de disponibilidad de la sección 3, paso 1, y no el del servicio de cotización: sin disponibilidad no se llama al Módulo 3 (escenario 3) | [ ] | |
| 7 | Volver a la normalidad | Devolver `MODULE3_BASE_URL` a `https://hospitua-module-3.onrender.com` y reiniciar el backend | N/A | La modificación del paso 5 ya cotiza: 3 noches con la tarifa del Módulo 3 | [ ] | |

--------------------------------------------------------------------------------

##### Section 5: Pantalla de referencia "Tarifas" (FR-009)
Se ejecuta en local, con el `RATE_REFERENCE` de `backend/.env.example`: ajuste de temporada del 15 %, `DOBLE`
220.000,00 y `SUITE_JUNIOR` 480.000,00 COP. Es una configuración de referencia: no tiene que coincidir con las
categorías del Módulo 1.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ver las tarifas de referencia | Menú → Tarifas | N/A | Una tabla con Categoría, Tarifa base, Ajuste de temporada y Tarifa efectiva / noche: `DOBLE` 220.000,00 COP, +15 % y 253.000,00 COP; `SUITE_JUNIOR` 480.000,00 COP, +15 % y 552.000,00 COP. No muestra la capacidad de las habitaciones | [ ] | |
| 2 | Dejar al Módulo 3 sin responder | Como en la sección 4, paso 2 | `MODULE3_BASE_URL=http://localhost:4999` | El backend arranca | [ ] | |
| 3 | Revisar que no llama al Módulo 3 | Recargar Tarifas | N/A | La misma tabla del paso 1, sin errores: la pantalla no depende del Módulo 3 | [ ] | |
| 4 | Revisar que la referencia no se usa al reservar | Reservas → Nueva reserva directa → consultar la tarifa | Categoría `DOBLE`, 1 noche, 1 habitación | El mensaje del servicio de cotización de la sección 4, paso 3, y no la tarifa efectiva de referencia (253.000,00 COP): la reserva solo usa la tarifa del Módulo 3 | [ ] | |
| 5 | Volver a la normalidad | Como en la sección 4, paso 7 | N/A | La consulta del paso 4 muestra la tarifa del Módulo 3 | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si el Módulo 3 no responde al cotizar una reserva nueva? `400` "Error 400: El servicio
  de cotización de tarifas no se encuentra disponible. Por favor intente más tarde" y no se crea la reserva, ni
  con una tarifa por defecto (sección 4, pasos 3 y 4).
* **EC-002** : ¿Qué pasa si el Módulo 3 no responde al recotizar una reserva activa? `400` "No se pudo calcular
  la nueva tarifa en este momento. Intente más tarde." y la reserva conserva sus fechas y sus tarifas (sección
  4, paso 5).
* **EC-003** : ¿Qué pasa si se cotiza una categoría que no existe en el catálogo? Responde `400`, nunca `500`
  (sección 3, paso 2).
* **EC-004** : ¿Qué pasa con un rango de fechas incoherente (la salida igual o antes de la entrada)? Responde
  `400` sin llamar al Módulo 3 (sección 3, paso 3).
* **EC-005** : ¿Qué recibe el Módulo 3 de una reserva de Booking? Con `X-Client` `MODULE3`, `quoteIds` vacío: su
  valor lo informa la agencia y no se cotiza (FR-010; TC-010-GenerateOtaReservation, sección 1, paso 6).
* **EC-006** : ¿Qué pasa con una habitación que se quita al modificar? Se va con su tarifa, sin llamar al
  Módulo 3, y no se muestra en la tarifa nueva (TC-013-UpdateReservation, sección 1, paso 6).
* **EC-007** : ¿Qué pasa si falla una sola de varias cotizaciones? No se guarda ninguna tarifa (FR-002a); está
  en las limitaciones.
* **EC-008** : ¿Qué muestra "Tarifas" si `RATE_REFERENCE` no está configurada, como en la demo? "No hay tarifas
  de referencia configuradas.", sin error; está en las limitaciones.
* **EC-009** : ¿Cambia la tarifa con la cantidad de personas? No: el Módulo 3 cotiza por habitación y fechas
  (sección 1, paso 3).
* **EC-010** : ¿Se llama al Módulo 3 cuando no hay disponibilidad? No: con el Módulo 3 sin responder, la falta
  de disponibilidad se informa igual (sección 4, paso 6).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva creada con una tarifa asumida o a cero, una tarifa guardada distinta del `lodgingAmount` del Módulo 3, o un `500` cuando el Módulo 3 no responde. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, una modificación que recotiza habitaciones que no cambiaron, o que no deja confirmar la tarifa nueva. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, un importe mal formateado en la pantalla de Tarifas. |
