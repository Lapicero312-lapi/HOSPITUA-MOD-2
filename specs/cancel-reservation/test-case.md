### Test Case Specification: Cancelación de Reservación
**Created** : 2026-11-14  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-002-CancelReservation
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que una reserva que todavía no empezó se cancela completa, por los dos canales,
y que una cancelación inválida se rechaza:
- la Recepcionista cancela una reserva directa `ACTIVE` o `PENDING` solo después de marcar la casilla de
  confirmación, y la reserva queda `CANCELLED` con su `Cancellation` (canal, fecha, quién y motivo) (FR-002,
  FR-002b, FR-003 y FR-005);
- Booking cancela su reserva por el feed de Channex, con el canal `OTA_API` (escenario 2);
- si la llegada es hoy y la reserva ya está en la lista del día, el Módulo 1 recibe un `REMOVED` con motivo
  `CANCELLED`; si la llegada es futura, no recibe nada (FR-004);
- una reserva en curso, completada, cancelada o que no se presentó no se cancela, y la Recepcionista no
  cancela reservas de Booking: siempre con un `400` controlado, nunca un `500` (FR-002a y FR-007);
- cancelar no cobra nada, no llama al Módulo 3 y no cambia la comisión de una reserva de Booking (FR-006).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Cancelación de Reservación | Specification Document | [specs/cancel-reservation/spec.md](spec.md) |
| Cancelación de Reservación | Plan Document | [specs/cancel-reservation/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) | README | [README.md](../../README.md) |
| Habitaciones del Módulo 1 simulado | Datos de prueba | [simulators/src/data.js](../../simulators/src/data.js) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La demo corre en el plan gratuito de Render y se duerme tras un rato sin uso. Al despertar, el backend arma
  y envía la lista del día si todavía no lo hizo, y cierra el día anterior si estaba pendiente.
* El estado `NO_SHOW` solo aparece con el cierre del día: el paso que lo usa se ejecuta al día siguiente
  (sección 3, paso 4).
* La sección 4 necesita acceso al hotel de prueba de Booking `10485037` para crear y cancelar una reserva. Sin
  ese acceso, la cubre la prueba automatizada contra Channex staging de `generate-ota-reservation`
  (`pnpm test:staging booking`, en `backend`).
* NFR-001 (menos de 200 ms de procesamiento local) no se puede medir solo a mano: el tiempo que muestra el
  navegador también incluye la red. Lo cubre `backend/test/integration/cancel-reservation/cancel-reservation-time.spec.ts`.
* Que el aviso `REMOVED` quede pendiente y se reintente cuando falla la publicación al Módulo 1 no se puede
  provocar a mano en la demo. Lo cubre `backend/test/integration/cancel-reservation/cancel-reservation-edge-cases.spec.ts`.

##### Dependencies & Assumptions
* TC-004-CheckViewReservation debe pasar primero: la reserva se localiza en "Consultar reservas" y la lista del
  día es suya.
* TC-009-GenerateDirectReservation debe pasar primero: las reservas que se cancelan se crean desde el
  frontend.
* TC-010-GenerateOtaReservation debe pasar primero para la sección 4: la cancelación de Booking llega por su
  feed.
* La disponibilidad que la cancelación devuelve a Channex la verifica TC-005-ConfigureOta.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live*. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. Las categorías de los pasos son
  sugerencias: si una no tiene cupo ese día, se usa otra con las mismas habitaciones libres.
* **Environment** : Staging, la demo de Render:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
  * simuladores: `https://hospitua-m2-simulators.onrender.com`. Sus logs, en Render, muestran lo que recibe el
    Módulo 1 por la lista del día: `[Módulo 1] Lista del día recibida (…)` y
    `[Módulo 1] Actualización <tipo> (<motivo>) de <reservationRef> recibida (…)`.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * Render: la cuenta de quien desplegó la demo, para ver los logs;
  * Booking: el acceso al hotel de prueba `10485037` (sección 4). Las credenciales no se escriben en este
    documento.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Cancelación por la Recepcionista con llegada hoy (escenarios 1 y 5)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Despertar la demo y entrar | Abrir el backend y los simuladores, esperar a que respondan, abrir el frontend y entrar | `Laura Méndez` | Se abre la pantalla de inicio. En los logs del simulador, "Lista del día recibida" con la fecha de `hoy` (si la demo estaba dormida, aparece al despertar) | [ ] | |
| 2 | Crear una reserva de dos habitaciones con llegada hoy | Reservas → Nueva reserva directa, con un titular ficticio | Categoría `TRIPLE`; entrada `hoy`, salida `hoy+1`; 2 habitaciones, 1 persona en cada una | La reserva queda creada y activa. Antes de 10 s, en los logs del simulador, "Actualización ADDED de RSV-… recibida": entra a la lista del día ya enviada | [ ] | Anotar el código |
| 3 | Abrir la cancelación | Reservas → abrir la reserva → Cancelar reserva | Código del paso 2 | La pantalla "Cancelar reserva" muestra la reserva a cancelar con sus dos habitaciones. El botón que confirma está deshabilitado (FR-002b) | [ ] | |
| 4 | Marcar la casilla y confirmar | Marcar "Entiendo que la cancelación no se puede deshacer.", escribir un motivo y confirmar | Motivo `Cambio de planes del huésped` | El botón se habilita al marcar la casilla. La reserva queda "Cancelada" | [ ] | |
| 5 | Ver la cancelación registrada | Detalle de la reserva | N/A | Un solo panel "Cancelación", con la fecha y la hora, el canal "Recepción", procesada por `Laura Méndez` y el motivo del paso 4. Ya no se ofrece "Cancelar reserva" ni modificar (escenario 1, escenario 5 y FR-005) | [ ] | |
| 6 | Ver el aviso al Módulo 1 | Render → `hospitua-m2-simulators` → Logs | Código del paso 2 | Antes de 10 s, una sola línea "Actualización REMOVED (CANCELLED) de RSV-… recibida" para esa reserva, aunque tenga dos habitaciones. Ninguna llamada al Módulo 3 (FR-004 y FR-006) | [ ] | |
| 7 | Intentar cancelarla otra vez | Documentación de la API → `GET /api/reservations/{reservationRef}` con `X-Client` `RECEPTIONIST` para leer su `updatedAt`, y después `POST /api/reservations/{reservationRef}/cancellation` con `X-User` | `{"updatedAt": "<el leído>", "acknowledged": true}` | `400` con el código `STATUS_NOT_CANCELLABLE` y el mensaje "El estado actual de la reserva no admite cancelación.". No sale otro aviso al Módulo 1 (escenario 4, `CANCELLED`) | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: Cancelación con llegada futura (escenario 3)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear una reserva con llegada futura | Reservas → Nueva reserva directa | Categoría `DOBLE`; entrada `hoy+40`, salida `hoy+41`; 1 habitación | La reserva queda creada. En los logs del simulador no aparece ninguna actualización con su código | [ ] | Anotar el código |
| 2 | Cancelarla | Abrir la reserva → Cancelar reserva → marcar la casilla → confirmar | Sin motivo | La reserva queda "Cancelada", con su panel "Cancelación" (canal "Recepción" y motivo "—") | [ ] | |
| 3 | Revisar que no se avisa al Módulo 1 | Render → `hospitua-m2-simulators` → Logs | Código del paso 1 | Ninguna actualización con ese código | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Cancelaciones bloqueadas (escenarios 4 y 6, y casos borde)
Los Check-In y los Check-Out los publica el simulador del Módulo 1 a pedido, con `POST` a
`https://hospitua-m2-simulators.onrender.com/simulate/check-in` o `/simulate/check-out` (con curl, Postman o
similar) y el cuerpo C1. El `roomId` de cada habitación está en `/api/rooms` del simulador, por su número.

| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Poner en curso una reserva de dos habitaciones | Crear una reserva de dos habitaciones con llegada hoy y publicar el Check-In de una sola | Categoría `SUITE_JUNIOR`; entrada `hoy`, salida `hoy+1`; 2 habitaciones. Cuerpo C1 con la primera habitación | El simulador responde `202`. La reserva queda "En curso" y ya no ofrece "Cancelar reserva" | [ ] | Anotar el código |
| 2 | Intentar cancelarla | Por la API, como en la sección 1, paso 7 | El `updatedAt` actual | `400` `STATUS_NOT_CANCELLABLE`: "El estado actual de la reserva no admite cancelación.". Ninguna actualización `REMOVED` en los logs del simulador (escenario 4 y caso borde de varias habitaciones) | [ ] | |
| 3 | Completar una reserva e intentar cancelarla | Crear una reserva de una habitación con llegada hoy, publicar su Check-In y su Check-Out, y cancelar por la API | Categoría `INDIVIDUAL`; entrada `hoy`, salida `hoy+1`; 1 habitación. Cuerpo C1 | La reserva queda "Completada" y la cancelación responde `400` `STATUS_NOT_CANCELLABLE` (escenario 4) | [ ] | |
| 4 | Intentar cancelar una reserva que no se presentó | El día anterior, crear una reserva de una habitación con llegada ese día y sin Check-In. Hoy, después del cierre del día, cancelarla por la API | Una reserva de `ayer` | La reserva está en "No se presentó" y la cancelación responde `400` `STATUS_NOT_CANCELLABLE` (escenario 4) | [ ] | Se ejecuta al día siguiente |
| 5 | Intentar cancelar una reserva de Booking | Reservas → filtrar por canal OTA y abrir una reserva activa. Después, cancelarla por la API | Una reserva de Booking `ACTIVE` | El detalle no ofrece "Cancelar reserva". La API responde `400` con el código `OTA_RESERVATION_CANCEL_VIA_API` y "La cancelación de una reserva de OTA debe llegar desde Booking.". La reserva sigue activa y sin panel "Cancelación" (escenario 6) | [ ] | Solo si la demo tiene una reserva de Booking |

Cuerpo C1, con datos ficticios. Sin `birthDate`, el Módulo 2 aplica el Check-In pero omite al huésped: no
registra sus datos ni su movimiento migratorio.

```json
{
  "reservationRef": "<código de la reserva>",
  "roomId": "<id de la habitación>",
  "guests": [
    {
      "firstName": "Prueba",
      "lastName": "Staging",
      "documentType": "CC",
      "documentNumber": "1000000000",
      "nationality": "Colombia",
      "birthDate": "1990-05-20"
    }
  ]
}
```

--------------------------------------------------------------------------------

##### Section 4: Cancelación desde Booking (escenario 2)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear una reserva en Booking con llegada hoy | En el hotel de prueba de Booking `10485037`, reservar una habitación con datos ficticios | Llegada `hoy`, salida `hoy+1` | Antes de un minuto, la reserva aparece en Reservas, con canal OTA y activa. En los logs del simulador, "Actualización ADDED de RSV-… recibida" | [ ] | Anotar el código y la comisión del detalle |
| 2 | Cancelarla desde Booking | En Booking, cancelar esa reserva | N/A | Antes de un minuto, la reserva queda "Cancelada", con su panel "Cancelación": canal "Booking" y procesada por Booking.com | [ ] | |
| 3 | Revisar el aviso y la comisión | Logs del simulador y detalle de la reserva | Código del paso 1 | Una línea "Actualización REMOVED (CANCELLED) de RSV-… recibida". La comisión de la reserva no cambia (FR-006) | [ ] | |

--------------------------------------------------------------------------------

##### Section 5: Solicitudes inválidas (casos borde y FR-007)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Cancelar sin referencia | Documentación de la API → `POST /api/reservations/{reservationRef}/cancellation` con la referencia solo con espacios | Referencia `%20%20` | `400` con el código `RESERVATION_REF_REQUIRED` y "La referencia de la reserva es obligatoria." | [ ] | |
| 2 | Cancelar sin confirmar | Crear una reserva con llegada futura y cancelarla por la API sin la confirmación | `{"updatedAt": "<el leído>", "acknowledged": false}` | `400` con el código `CANCELLATION_NOT_CONFIRMED` y "Debe confirmar que entiende que la cancelación no se puede deshacer.". La reserva sigue activa | [ ] | Anotar el código |
| 3 | Dos cancelaciones a la vez | Abrir "Cancelar reserva" de la reserva del paso 2 en dos pestañas. Confirmar en la primera y después en la segunda | Código del paso 2 | La primera la cancela. La segunda recibe "Esta reserva ya fue actualizada o cancelada recientemente". El detalle tiene un solo panel "Cancelación" | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa si falla la publicación del aviso `REMOVED` al Módulo 1? La reserva queda cancelada,
  el aviso queda pendiente y se reintenta en orden; está en las limitaciones.
* **EC-002** : ¿Qué pasa con una referencia vacía o solo con espacios? `400` "La referencia de la reserva es
  obligatoria." antes de tocar la reserva (sección 5, paso 1).
* **EC-003** : ¿Qué pasa con dos cancelaciones simultáneas de la misma reserva? La segunda recibe `400` "Esta
  reserva ya fue actualizada o cancelada recientemente", sin duplicar la cancelación ni el aviso (sección 5,
  paso 3).
* **EC-004** : ¿Se puede cancelar una reserva de varias habitaciones cuando una ya tuvo Check-In? No: está en
  curso y responde `400` (sección 3, paso 2). Las habitaciones que no lleguen quedan sin llegar en el cierre
  del día.
* **EC-005** : ¿Se puede cancelar solo una habitación de una reserva con varias? No: la cancelación siempre es
  de la reserva completa. Para quitar una habitación se usa "Actualizar reservación".
* **EC-006** : ¿Qué pasa si Booking envía la cancelación de una reserva que ya está en curso o completada?
  "Generar reservación por OTA" la marca en conflicto (`CHANGE_NOT_APPLICABLE`); si ya estaba cancelada, la
  ignora.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva en curso que se deja cancelar, una cancelación de hoy que no llega al Módulo 1, o un `500` al cancelar. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, una cancelación que no queda registrada con su canal, o un botón que confirma sin marcar la casilla. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, el motivo vacío que se muestra en blanco en lugar de "—". |
