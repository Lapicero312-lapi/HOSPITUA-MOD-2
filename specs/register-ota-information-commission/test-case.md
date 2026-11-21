### Test Case Specification: Registrar Confirmación y Comisión de OTA
**Created** : 2026-11-15  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-012-RegisterOtaInformationCommission
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que el Módulo 2 registra la comisión de cada reserva de Booking y que el Módulo 3
la concilia:
- cada reserva de Booking queda con su código de Booking y una comisión `grossAmount × commissionPercentage /
  100`, calculada con el porcentaje fijo de la agencia, en `CALCULATED` (User Story 1, FR-001 a FR-003,
  NFR-002 y SC-001);
- un cambio de valor en Booking recalcula la comisión con el mismo porcentaje, y el porcentaje de la agencia no
  cambia (FR-001 y FR-002);
- el Módulo 3 pasa a `RECONCILED` o `PAID` solo las comisiones de reservas `COMPLETED` cuyos montos coinciden;
  las canceladas por Booking y las de no-show no cambian (User Story 2, FR-006, FR-007 y SC-004);
- cada comisión calculada o conciliada queda auditada (FR-010);
- la agencia Booking.com está registrada una sola vez, con su conexión y su última sincronización, y la
  Recepcionista solo la consulta (User Story 3, FR-008 y FR-008a);
- las solicitudes inválidas responden `400`, nunca `500` (FR-009 y SC-003).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Registrar Confirmación y Comisión de OTA | Specification Document | [specs/register-ota-information-commission/spec.md](spec.md) |
| Registrar Confirmación y Comisión de OTA | Plan Document | [specs/register-ota-information-commission/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) | README | [README.md](../../README.md) |
| Los Módulos 1 y 3 | README | [README.md](../../README.md#los-módulos-1-y-3) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* Las reservas de Booking se crean en el hotel de prueba `10485037`, con el acceso del equipo. La demo es la
  única copia conectada a Channex, así que este caso se ejecuta solo contra ella. Las credenciales no se
  escriben en este documento.
* En la demo, el Check-In y el Check-Out solo los publica el Módulo 1 real. La reserva de Booking que se
  completa en la sección 3, paso 2, se coordina con él, que hace el Check-In y el Check-Out en su sistema. Si no
  puede, los pasos 2 a 7 y 11 de la sección 3 los cubre
  `backend/test/integration/register-ota-information-commission/reconciliation-scenarios.spec.ts`.
* El porcentaje de la agencia se calcula una sola vez, con su primera reserva. Si en la demo Booking.com ya
  tiene porcentaje, el escenario 2 no se puede repetir a mano.
* Booking decide la comisión que informa: no se puede provocar a mano una primera reserva sin comisión, o con
  una fuera de 0 a 100 (escenario 3), ni una comisión que no coincida con el porcentaje (escenario 4).
* Llevar la agencia a "Desconectada" exige poner una clave de Channex inválida en la demo compartida
  (escenarios 3 y 4 de la User Story 3).
* La comisión no se muestra en la pantalla de reservas: se ve en `GET /api/ota-commissions`, que usa el
  Módulo 3. La conciliación se hace por la API, como lo haría el Módulo 3.
* Los casos que no se pueden provocar a mano los cubre
  `backend/test/integration/register-ota-information-commission/`:
  * la primera reserva, la que no trae comisión o la trae inválida, la advertencia de una comisión que no
    coincide y el código de confirmación duplicado (`commission-scenarios.spec.ts`);
  * la desconexión y la reconexión con Channex (`ota-registration-and-connection.spec.ts`);
  * dos actualizaciones simultáneas de la misma reserva (`reconciliation-scenarios.spec.ts`);
  * NFR-001, el cálculo en menos de 1 segundo (`commission-time.spec.ts`).

##### Dependencies & Assumptions
* TC-005-ConfigureOta debe pasar primero: la agencia y los tipos de habitación relacionados con las
  categorías.
* TC-010-GenerateOtaReservation debe pasar primero: las reservas de Booking llegan por el feed. Su sección 4
  deja la reserva en no-show que usa la sección 3 de este caso.
* El Check-In y el Check-Out que completan una reserva los verifica TC-013-UpdateReservation.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live* y las claves `X-Internal-Key` que exijan
  los Módulos 1 y 3 en el panel de Render. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. En pantalla, las fechas se ven
  como `DD/MM/AAAA` y el porcentaje como `15 %` o `12,5 %`.
* **Huésped ficticio de Booking** : el de TC-010-GenerateOtaReservation (`Prueba Booking`), con la tarjeta de
  prueba `4111 1111 1111 1111`.
* **Cuerpo K1** de la conciliación (`POST /api/ota-commissions/reconciliations`):

  ```json
  {
    "action": "RECONCILED",
    "items": [
      { "reservationRef": "<código RSV->", "grossAmount": "<valor bruto>", "commissionAmount": "<comisión>" }
    ]
  }
  ```
* **Environment** : Staging, la demo de Render y Booking:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`, con sus logs en Render;
  * Booking: el hotel de prueba `10485037`, conectado a la propiedad de Channex staging.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * Booking: el acceso del equipo al hotel de prueba;
  * Render: la cuenta de quien desplegó la demo, para reiniciar el backend y, opcionalmente, consultar la base;
  * el contacto del Módulo 1, para el Check-In y el Check-Out de la sección 3, paso 2.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: La agencia registrada (User Story 3, escenarios 1, 2 y 5, FR-008 y FR-008a)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Ver la agencia | Entrar al frontend → Agencias OTA | `Laura Méndez` | Una sola fila, "Booking.com", con "Comisión" en un porcentaje o en "Sin porcentaje" si todavía no tuvo reservas, "Conexión" "Conectada", "Vinculada el", "Última sincronización" hace menos de un minuto y "Reservas activas" (escenario 1) | [ ] | Anotar el porcentaje (P) y la fecha de vinculación |
| 2 | La sincronización avanza | Esperar un minuto y recargar | N/A | "Última sincronización" muestra una hora más reciente: cada lectura del feed la actualiza, traiga o no reservas (escenario 5) | [ ] | |
| 3 | Solo consulta | Revisar la pantalla | N/A | No hay botones para crear, editar ni borrar agencias (FR-008) | [ ] | |
| 4 | Consultar por la API | Documentación de la API → `GET /api/otas` y `GET /api/otas/{otaId}` | El `id` de Booking.com | Una lista con un solo elemento, y la agencia con los mismos datos: `name`, `commissionPercentage`, `connectionStatus` `CONNECTED`, `linkedAt`, `lastSyncAt` y `activeReservations` | [ ] | |
| 5 | Reiniciar el backend | Render → `hospitua-m2-backend` → reiniciar el servicio ("Restart service"), y volver a Agencias OTA | N/A | Sigue una sola fila de Booking.com, con el mismo porcentaje y la misma fecha de vinculación (escenario 2) | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: La comisión de una reserva de Booking (User Story 1, escenarios 1 y 2, FR-001 a FR-003 y FR-005)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Reservar en Booking | En el hotel de prueba, reservar una habitación con el huésped ficticio | Llegada `hoy+40`, salida `hoy+42` | Booking confirma la reserva. En menos de 2 minutos aparece en el Módulo 2, "Activa" | [ ] | Anotar el código de Booking, el total (G) y el código `RSV-` (K) |
| 2 | Revisar el porcentaje de la agencia | Agencias OTA | N/A | Si en la sección 1 tenía "Sin porcentaje", ahora tiene P = comisión que informó Booking ÷ G × 100, con dos decimales (escenario 2). Si ya tenía P, no cambió | [ ] | |
| 3 | Revisar la comisión de la reserva | `GET /api/ota-commissions` | `dateFrom` y `dateTo` `hoy+42` | El elemento de K con el código de Booking, `grossAmount` G, `commissionPercentage` P, `commissionAmount` exactamente G × P / 100 con dos decimales, y `commissionStatus` `CALCULATED` (escenario 1, FR-003, NFR-002 y SC-001) | [ ] | Anotar la comisión (C) |
| 4 | Revisar la auditoría | Opcional, con acceso a la base de la demo: `SELECT a.action, a.previous_status, a.gross_amount, a.commission_percentage, a.commission_amount, a.channel, a.occurred_at FROM commission_audit a JOIN reservation r ON r.id = a.reservation_id WHERE r.reservation_ref = '<K>';` | K | Una fila `CALCULATED`, sin estado anterior, con G, P y C y el canal `OTA_API` (FR-010) | [ ] | Opcional |
| 5 | Cambiar el valor en Booking | En Booking, cambiar la salida de esa reserva | Salida `hoy+43` | En menos de 2 minutos, la reserva tiene salida `hoy+43`. Sigue una sola reserva con ese código de Booking (FR-005) | [ ] | Anotar el total nuevo (G2) |
| 6 | La comisión se recalcula con el mismo porcentaje | `GET /api/ota-commissions` y Agencias OTA | `dateFrom` y `dateTo` `hoy+43` | `grossAmount` G2, `commissionPercentage` P y `commissionAmount` G2 × P / 100. La agencia sigue con P (FR-001 y FR-002). Opcional: la consulta del paso 4 muestra una segunda fila `CALCULATED`, con el estado anterior `CALCULATED` y G2, P y C2 (FR-010) | [ ] | Anotar la comisión nueva (C2) |

--------------------------------------------------------------------------------

##### Section 3: Conciliación del Módulo 3 (User Story 2, FR-006, FR-007 y SC-004)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una reserva que no terminó | `POST /api/ota-commissions/reconciliations` con K1 | K con G2 y C2 | `200` con el resultado `REJECTED`, el motivo `RESERVATION_NOT_COMPLETED` y `commissionStatus` `CALCULATED` | [ ] | |
| 2 | Completar una reserva de Booking | Reservar en Booking con llegada hoy y pedirle al Módulo 1 que haga en su sistema el Check-In y el Check-Out de esa reserva | Llegada `hoy`, salida `hoy+1` | La reserva queda "Completada" | [ ] | Anotar el código `RSV-` (L), su valor (GL) y su comisión (CL) con `GET /api/ota-commissions` en `hoy+1` |
| 3 | Conciliar la reserva completada | K1 | L con GL y CL | `200` con `APPLIED` y `commissionStatus` `RECONCILED`, y el resumen `applied` 1 (escenario 1) | [ ] | |
| 4 | Repetir la conciliación | La misma llamada | La misma | `ALREADY_APPLIED`, sin cambios (FR-006) | [ ] | |
| 5 | Marcarla pagada | K1 con `"action": "PAID"` | L con GL y CL | `APPLIED` y `commissionStatus` `PAID` | [ ] | |
| 6 | Volver a conciliada | K1 con `"action": "RECONCILED"` | L con GL y CL | `REJECTED` con el motivo `INVALID_TRANSITION`; sigue en `PAID` | [ ] | |
| 7 | Montos que no coinciden | K1 | L con GL y otra comisión, por ejemplo `1.00` | `REJECTED` con el motivo `AMOUNT_MISMATCH`; la comisión no cambia | [ ] | |
| 8 | Una reserva cancelada por Booking | Cancelar en Booking la reserva K. Después, K1 | K con G2 y C2 | La reserva queda "Cancelada". La conciliación responde `REJECTED` con `RESERVATION_CANCELLED`, y `GET /api/ota-commissions` sigue mostrando C2 en `CALCULATED` (escenario 2 y FR-007) | [ ] | |
| 9 | Una reserva en no-show | K1 | La reserva de TC-010-GenerateOtaReservation, sección 4, con su valor y su comisión | `REJECTED` con `RESERVATION_NO_SHOW`; la comisión no cambia (escenario 3) | [ ] | |
| 10 | Otras reservas | K1 con dos ítems | Una reserva directa cualquiera, y `RSV-00000000` | `NOT_OTA_RESERVATION` para la directa y `RESERVATION_NOT_FOUND` para la otra. Cada ítem se procesa por separado y el resumen cuenta 2 rechazados | [ ] | |
| 11 | Revisar la auditoría | Opcional: la consulta de la sección 2, paso 4, con L | L | Una fila `CALCULATED` del canal `OTA_API`, una `RECONCILED` y una `PAID` del canal `MODULE3`, cada una con su estado anterior. Ninguna por los pasos 4, 6 y 7 (FR-010) | [ ] | Opcional |

--------------------------------------------------------------------------------

##### Section 4: Solicitudes inválidas (FR-009 y SC-003)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Una conciliación sin ítems | `POST /api/ota-commissions/reconciliations` | `"items": []` | `400` con `INVALID_RECONCILIATION_REQUEST` y "La solicitud de conciliación no es válida.", sin procesar nada | [ ] | |
| 2 | Una acción que no existe | K1 | `"action": "CALCULATED"` | `400` con `INVALID_RECONCILIATION_ACTION` y "La acción de conciliación no es válida." | [ ] | |
| 3 | Un código mal escrito | K1 | `"reservationRef": "RSV-123"` | `400` con `INVALID_RESERVATION_CODE` y "Debe proveer un código de reserva válido para la consulta." | [ ] | |
| 4 | Un importe inválido | K1 | `"commissionAmount": "-5"`, y después `"60.123"` | `400` con `INVALID_AMOUNT` y "El importe no es válido." en los dos casos | [ ] | |
| 5 | Un listado sin fechas | `GET /api/ota-commissions` | Sin `dateFrom` ni `dateTo` | `400` con `INCOMPLETE_DATE_RANGE` y "Debe completar ambas fechas del rango." | [ ] | |
| 6 | Un periodo inválido | `GET /api/ota-commissions` | `hoy` a `hoy-1`; `hoy-400` a `hoy` | `400` con `INVALID_DATE_RANGE` y con `DATE_RANGE_TOO_LARGE` | [ ] | |
| 7 | Filtros inválidos | `GET /api/ota-commissions` con fechas válidas | `commissionStatus=OTRO`; `otaId=123` | `400` con `INVALID_COMMISSION_STATUS` "El estado de la comisión no es válido." y con `OTA_NOT_FOUND` "La agencia no existe." | [ ] | |
| 8 | Una agencia que no existe | `GET /api/otas/{otaId}` | `123` | `400` con `OTA_NOT_FOUND` y "La agencia no existe." | [ ] | |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Con qué estado nace la agencia? `CONNECTED`, y solo las lecturas del feed cambian su estado y
  su última sincronización (sección 1).
* **EC-002** : ¿Qué pasa con las reservas de una agencia desconectada? No cambian; está en las limitaciones.
* **EC-003** : ¿Se recalcula el porcentaje? No: queda fijo desde la primera reserva (sección 2, pasos 2 y 6).
* **EC-004** : ¿Qué muestra la agencia antes de su primera reserva? "Sin porcentaje" (sección 1, paso 1).
* **EC-005** : ¿Qué pasa con un código de Booking ya registrado? Se aplica a la reserva que ya existe, sin otra
  reserva ni otra comisión (sección 2, paso 5).
* **EC-006** : ¿Qué pasa con la comisión de una reserva que Booking cancela? No cambia, tampoco al conciliar
  (sección 3, paso 8).
* **EC-007** : ¿Qué pasa con dos actualizaciones simultáneas de la misma reserva? Se procesan en secuencia;
  está en las limitaciones.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva de Booking sin comisión, una comisión que no es `grossAmount × commissionPercentage / 100`, dos reservas con el mismo código de Booking, o un `500`. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, una comisión de una reserva cancelada que cambia al conciliar, un porcentaje que se recalcula, o una conciliación sin auditoría. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, el porcentaje con punto en lugar de coma, o una fecha de vinculación sin el formato `DD/MM/AAAA`. |
