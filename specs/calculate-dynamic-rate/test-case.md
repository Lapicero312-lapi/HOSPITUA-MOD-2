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
| Tarifas por noche del Módulo 3 simulado | Datos de prueba | [simulators/src/data.js](../../simulators/src/data.js) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* El Módulo 3 simulado cobra una tarifa fija por noche y por categoría, sin reglas de temporada, ocupación ni
  anticipación: esas reglas son del motor del Módulo 3 y no se prueban aquí. Las tarifas son `INDIVIDUAL`
  150.000,00, `DOBLE` 220.000,00, `TRIPLE` 300.000,00, `SUITE_JUNIOR` 480.000,00 y `SUITE` 650.000,00 COP por
  noche.
* En la demo, los simuladores del Módulo 1 y del Módulo 3 son un solo servicio: no se puede dejar sin responder
  solo al Módulo 3. La sección 4 se ejecuta en local.
* La demo no configura `RATE_REFERENCE`, así que su pantalla "Tarifas" no tiene tarifas de referencia y
  muestra "No hay tarifas de referencia configuradas." (lo cubre `frontend/src/pages/rates/RatesPage.test.tsx`).
  La sección 5 se ejecuta en local, con la de `backend/.env.example`.
* NFR-001 (menos de 1,5 s para la llamada al Módulo 3) no se puede medir sola a mano. El tiempo de la consulta
  de disponibilidad y tarifa es una cota superior: también incluye al Módulo 1.
* No se pueden provocar a mano estos casos. Los cubren las pruebas de integración:
  * el Módulo 3 que responde después del tiempo máximo de espera, y una categoría que el Módulo 3 no conoce:
    `backend/test/integration/calculate-dynamic-rate/calculate-dynamic-rate.service.spec.ts`;
  * todo o nada (FR-002a): de tres cotizaciones falla una y no se guarda ninguna, al crear y al modificar:
    `calculate-dynamic-rate.service.spec.ts` y
    `backend/test/integration/use-cases/calculate-dynamic-rate/recalculation-scenarios.spec.ts`;
  * la tarifa cambia entre la vista previa y la confirmación: `recalculation-scenarios.spec.ts`.

##### Dependencies & Assumptions
* TC-003-CheckRoomAvailability debe pasar primero: la disponibilidad se verifica antes de cotizar.
* TC-009-GenerateDirectReservation y TC-013-UpdateReservation deben pasar primero: este caso usa sus flujos
  para crear y modificar la reserva.
* TC-004-CheckViewReservation debe pasar primero: el detalle de la reserva y la consulta del Módulo 3 son
  suyos.
* La tarifa se fija por categoría y fechas: la cantidad de personas no cambia la tarifa.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live*. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. Las secciones 1 y 2 usan la
  misma reserva, y la sección 2 la cancela al final.
* **Environment** : Staging. Las secciones 1 a 3 se ejecutan en la demo de Render:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
  * simuladores: `https://hospitua-m2-simulators.onrender.com`. Sus logs, en Render, muestran una línea
    `[Módulo 1 y Módulo 3] POST /pricing/quotes → 200` por cada cotización.

  Las secciones 4 y 5 se ejecutan en local, con los "Primeros pasos" del README. Ahí los logs del simulador
  muestran `[Módulo 3] POST /pricing/quotes → …`.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * Render: la cuenta de quien desplegó la demo, para ver los logs.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Cotización de una reserva directa nueva (historia 1)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Despertar la demo y entrar | Abrir el backend y los simuladores, esperar a que respondan, abrir el frontend y entrar | `Laura Méndez` | Se abre la pantalla de inicio de la Recepcionista | [ ] | |
| 2 | Consultar la tarifa | Reservas → Nueva reserva directa. Llenar Estadía y Habitaciones | Categoría `DOBLE`; entrada `hoy+30`, salida `hoy+32`; 2 habitaciones, 1 persona en cada una | En "Disponibilidad y tarifa", cada habitación con 2 noches y tarifa 440.000,00 COP, y el total en 880.000,00 COP: la suma exacta, sin impuestos, redondeos ni comisiones (FR-002 y NFR-002) | [ ] | Opcional (NFR-001): en las herramientas del navegador → Red, `POST /api/reservations/direct/preview` tarda menos de 1,5 s con la demo despierta. Si tarda más no prueba que falle: también incluye al Módulo 1 |
| 3 | Revisar las llamadas al Módulo 3 | Render → `hospitua-m2-simulators` → Logs | N/A | Dos líneas `POST /pricing/quotes → 200`, una por habitación (FR-002a) | [ ] | |
| 4 | Cambiar la cantidad de personas | En Habitaciones, poner 2 personas en una de las habitaciones | N/A | La tarifa de cada habitación sigue en 440.000,00 COP: la cantidad de personas no se envía al Módulo 3 | [ ] | |
| 5 | Crear la reserva | Llenar el Titular con datos ficticios y confirmar | Titular `Prueba Staging`, CC `1000000000` | La reserva queda creada, con su código `RSV-…`. En los logs del simulador, otras dos líneas `POST /pricing/quotes → 200`: al crear, el Módulo 2 vuelve a cotizar cada habitación para confirmar que la tarifa es la que se mostró | [ ] | Anotar el código |
| 6 | Ver las tarifas guardadas | Reservas → abrir la reserva del paso 5 | Código del paso 5 | Estado activa; cada habitación con 440.000,00 COP y el total en 880.000,00 COP (escenario 1) | [ ] | |
| 7 | Ver lo que recibe el Módulo 3 | Documentación de la API → `GET /api/reservations/{reservationRef}` con `X-Client` `MODULE3` | Código del paso 5 | `200`, con `quoteIds`: dos identificadores distintos, uno por habitación (FR-010) | [ ] | Anotar los dos `quoteIds` |

--------------------------------------------------------------------------------

##### Section 2: Recotización por modificación de la estadía (historia 2)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ampliar las fechas sin confirmar | Abrir la reserva de la sección 1 → modificar. Cambiar la salida | Salida `hoy+33` | Después de "Consultando disponibilidad y tarifa…", cada habitación con 3 noches y tarifa 660.000,00 COP. No se muestra la tarifa anterior ni una diferencia. En los logs del simulador, dos líneas `POST /pricing/quotes → 200` (escenario 1) | [ ] | |
| 2 | No confirmar | Salir de la modificación sin confirmar y volver al detalle | N/A | La reserva sigue con salida `hoy+32` y 440.000,00 COP por habitación (escenario 2) | [ ] | |
| 3 | Ampliar las fechas y confirmar | Repetir el paso 1 y confirmar | Salida `hoy+33` | El detalle muestra la salida `hoy+33`, 660.000,00 COP por habitación y el total en 1.320.000,00 COP. Con `X-Client` `MODULE3`, dos `quoteIds` nuevos, distintos de los de la sección 1, paso 7 (FR-007) | [ ] | |
| 4 | Cambiar una habitación por otra de la misma categoría | Modificar → cambiar una habitación por otra `DOBLE` libre, sin tocar las fechas | Otra habitación `DOBLE` | "La tarifa no cambia." En los logs del simulador no aparece ningún `POST /pricing/quotes` nuevo. Al confirmar, las tarifas siguen en 660.000,00 COP (escenario 4) | [ ] | |
| 5 | Cambiar una habitación de categoría | Modificar → cambiar una de las habitaciones a `TRIPLE` | Categoría `TRIPLE` | Se cotiza solo esa habitación: un `POST /pricing/quotes` en los logs, y su tarifa nueva, 900.000,00 COP por 3 noches, con el mismo detalle que al crear y sin tarifa anterior ni diferencia (escenario 3) | [ ] | |
| 6 | Agregar una habitación | En la misma modificación, agregar una habitación | Categoría `INDIVIDUAL`, 1 persona | Se cotiza solo la agregada: otro `POST /pricing/quotes`, con 450.000,00 COP por 3 noches (escenario 3) | [ ] | |
| 7 | Dejar limpia la demo | Salir sin confirmar y cancelar la reserva: abrirla → Cancelar reserva → confirmar | N/A | La reserva queda cancelada | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Sin disponibilidad y datos inválidos (historia 1, escenario 3, y FR-008)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Pedir más habitaciones de las que hay | Reservas → Nueva reserva directa | Categoría `INDIVIDUAL`; entrada `hoy+30`, salida `hoy+31`; 5 habitaciones (la categoría tiene 4) | Un mensaje de falta de disponibilidad y no se puede crear la reserva. En los logs del simulador no aparece ningún `POST /pricing/quotes` (escenario 3) | [ ] | |
| 2 | Pedir una categoría que no existe | Documentación de la API → `POST /api/reservations/direct/preview` | `categoryRoom` `PRESIDENCIAL`, fechas `hoy+30` a `hoy+31` | `400` con un código de error estructurado, nunca `500`. No se llama al Módulo 3 | [ ] | |
| 3 | Pedir fechas incoherentes | Documentación de la API → `POST /api/reservations/direct/preview` | Categoría `DOBLE`; entrada `hoy+31`, salida `hoy+30` | `400` con un código de error estructurado, nunca `500`. No se llama al Módulo 3 | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: El Módulo 3 no responde (FR-003, FR-004 y casos borde)
Se ejecuta en local, porque en la demo no se puede apagar solo al Módulo 3.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear una reserva con el Módulo 3 respondiendo | En local, con el backend, el frontend y los simuladores arriba, crear una reserva directa | Categoría `DOBLE`; entrada `hoy+30`, salida `hoy+32`; 1 habitación | La reserva queda creada con 440.000,00 COP | [ ] | Anotar el código |
| 2 | Dejar al Módulo 3 sin responder | En `backend/.env`, cambiar `MODULE3_BASE_URL` a un puerto donde no hay nada y reiniciar el backend | `MODULE3_BASE_URL=http://localhost:4999` | El backend arranca; el Módulo 1 sigue respondiendo | [ ] | |
| 3 | Intentar una reserva nueva | Reservas → Nueva reserva directa con los datos del paso 1 | Los del paso 1 | El mensaje "Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde". No se muestra ninguna tarifa, ni a cero, y no se puede crear la reserva. La lista de reservas no tiene una nueva (escenario 2) | [ ] | |
| 4 | Intentar crearla por la API | Documentación de la API → `POST /api/reservations/direct` con un cuerpo completo | Los datos del paso 1 y un `Idempotency-Key` nuevo | `400` con el código `PRICING_UNAVAILABLE` y el mismo mensaje. No se crea la reserva (FR-003) | [ ] | |
| 5 | Intentar modificar la reserva del paso 1 | Abrir la reserva del paso 1 → modificar → cambiar la salida | Salida `hoy+33` | El mensaje "No se pudo calcular la nueva tarifa en este momento. Intente más tarde.". La reserva sigue con sus fechas y su tarifa (FR-004) | [ ] | |
| 6 | Volver a la normalidad | Devolver `MODULE3_BASE_URL` a `http://localhost:4003` y reiniciar el backend | N/A | La modificación del paso 5 ya cotiza: 660.000,00 COP por 3 noches | [ ] | |

--------------------------------------------------------------------------------

##### Section 5: Pantalla de referencia "Tarifas" (FR-009)
Se ejecuta en local, con el `RATE_REFERENCE` de `backend/.env.example`: ajuste de temporada del 15 %, `DOBLE`
220.000,00 y `SUITE_JUNIOR` 480.000,00 COP.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ver las tarifas de referencia | Menú → Tarifas | N/A | Una tabla con Categoría, Tarifa base, Ajuste de temporada y Tarifa efectiva / noche: `DOBLE` 220.000,00 COP, +15 % y 253.000,00 COP; `SUITE_JUNIOR` 480.000,00 COP, +15 % y 552.000,00 COP. No muestra la capacidad de las habitaciones | [ ] | |
| 2 | Revisar que no llama al Módulo 3 | Mirar los logs del simulador mientras se abre y se recarga Tarifas | N/A | Ningún `POST /pricing/quotes` | [ ] | |
| 3 | Revisar que la referencia no se usa al reservar | Reservas → Nueva reserva directa → consultar la tarifa | Categoría `DOBLE`, 1 noche, 1 habitación | La tarifa es la del Módulo 3, 220.000,00 COP, y no la efectiva de referencia (253.000,00 COP) | [ ] | |

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
* **EC-009** : ¿Cambia la tarifa con la cantidad de personas? No: depende de la categoría y de las fechas
  (sección 1, paso 4).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva creada con una tarifa asumida o a cero, una tarifa guardada distinta del `lodgingAmount` del Módulo 3, o un `500` cuando el Módulo 3 no responde. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, una modificación que recotiza habitaciones que no cambiaron, o que no deja confirmar la tarifa nueva. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, un importe mal formateado en la pantalla de Tarifas. |
