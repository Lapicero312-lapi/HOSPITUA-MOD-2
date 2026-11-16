### Test Case Specification: Generar Reservación por OTA
**Created** : 2026-11-15  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-010-GenerateOtaReservation
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P1 - Critical

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que las reservas, los cambios y las cancelaciones que se hacen en Booking llegan
solos al Módulo 2 por el feed de Channex:
- una reserva nueva de Booking queda registrada en menos de 2 minutos en `ACTIVE`, con su código de Booking, su
  valor, su comisión, el titular sin documento y la habitación de menor número asignada (escenarios 1 y 3 de
  la User Story 1, FR-003, FR-004, FR-008 y NFR-001);
- un cambio de Booking se aplica a la reserva y recalcula la comisión con el porcentaje congelado (escenario 1
  de la User Story 2 y FR-005);
- una cancelación de Booking cancela la reserva por el canal de Booking sin tocar la comisión (escenario 3 y
  FR-006);
- lo que Booking ya aceptó y no se puede aplicar no se rechaza: queda marcado en conflicto (escenario 4 y
  FR-007);
- el Módulo 1 recibe las reservas de Booking con llegada hoy, y el no-show se reporta a Booking (FR-009 y
  FR-011);
- los logs no tienen datos del titular (NFR-002).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Generar Reservación por OTA | Specification Document | [specs/generate-ota-reservation/spec.md](spec.md) |
| Generar Reservación por OTA | Plan Document | [specs/generate-ota-reservation/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) | README | [README.md](../../README.md) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* La demo es la única copia conectada a Channex: este caso se ejecuta solo contra la demo, nunca con un backend
  local conectado a Channex.
* Hace falta el acceso del equipo al hotel de prueba de Booking `10485037` para crear, cambiar y cancelar las
  reservas. Las credenciales no se escriben en este documento.
* La demo lee el feed cada 30 segundos solo mientras está despierta: el plan gratuito de Render la duerme tras
  un rato sin uso. Durante la prueba se mantiene abierto el frontend; si se durmió, al despertar procesa lo
  pendiente.
* El detalle de una reserva de Booking no muestra la comisión: se ve en `GET /api/ota-commissions` y en la
  consulta del Módulo 3.
* No se pueden provocar a mano desde Booking, porque Booking solo vende lo que Channex le dice que hay o porque
  dependen de fallas de Channex. Los cubre `backend/test/integration/use-cases/generate-ota-reservation/`:
  * la revisión repetida (`process-booking-feed.spec.ts`);
  * sin habitación disponible, capacidad superada, tipo de habitación sin relación y habitaciones con otras
    fechas (`booking-new-scenarios.spec.ts`);
  * el cambio sin disponibilidad y la cancelación de una reserva ya cancelada (`booking-changes.spec.ts`);
  * Channex sin responder o con `429` (`read-booking-feed.spec.ts`);
  * el reporte de no-show que Channex no acepta y se reintenta (`no-show-report.spec.ts`).
* Estos pasos no los arman, y los cubren las pruebas de
  `backend/test/unit/application/use-cases/generate-ota-reservation/`:
  * las personas de cada habitación (adultos más niños, sin los bebés) y las observaciones saneadas y recortadas
    a 500 caracteres (`booking-revision.mapper.spec.ts`);
  * el cambio de una reserva que el sistema no tiene, que se registra como nueva
    (`process-booking-revision.service.spec.ts`); su cancelación solo se confirma (`process-booking-feed.spec.ts`,
    en la carpeta de integración de arriba);
  * la revisión que no se puede guardar, que no se confirma a Channex y espera a la siguiente lectura
    (`process-booking-feed.service.spec.ts`).
* La prueba automatizada contra Channex staging de la tarea #306 (`backend/test/staging/booking-staging.spec.ts`,
  con `pnpm test:staging` en `backend`) repite la creación, el cambio y la cancelación. La corre quien tiene la
  clave de Channex, con la demo pausada y el feed vacío, como dice su archivo.

##### Dependencies & Assumptions
* TC-005-ConfigureOta debe pasar primero: la agencia Booking.com registrada, los tipos de habitación en Channex
  relacionados con las categorías y mapeados en Booking.
* TC-012-RegisterOtaInformationCommission verifica el porcentaje de comisión de la agencia, que este caso usa.
* TC-002-CancelReservation y TC-013-UpdateReservation verifican la cancelación y el cambio que este caso
  provoca desde Booking.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live*, y Agencias con Booking.com activa.
  Fechas relativas: `hoy` es la fecha del hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días
  después. En pantalla, las fechas se ven como `DD/MM/AAAA`.
* **Huésped ficticio de Booking** : nombre `Prueba`, apellido `Booking`, correo `prueba.booking@example.com`,
  teléfono `+1 305 000 0000` y país Estados Unidos. Las reservas se pagan con la tarjeta de prueba
  `4111 1111 1111 1111`.
* **Porcentaje de Booking** : el que muestra Agencias para Booking.com (P). Si la agencia todavía no tiene
  porcentaje, la primera reserva lo fija con la comisión que informa Booking.
* **Environment** : Staging, la demo de Render y Booking:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
  * simuladores: `https://hospitua-m2-simulators.onrender.com`, con sus logs en Render y el Check-In a pedido
    (`POST /simulate/check-in` y `/simulate/check-out`, con el cuerpo C1 de TC-002-CancelReservation);
  * Booking: el hotel de prueba `10485037`, conectado a la propiedad de Channex staging.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * Booking: el acceso del equipo al hotel de prueba;
  * Render: la cuenta de quien desplegó la demo, para ver los logs.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Reserva nueva con llegada hoy (User Story 1, escenario 1, FR-003, FR-004, FR-008, FR-009 y NFR-001)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Preparar la demo | Abrir el backend y los simuladores, entrar al frontend y abrir Agencias | `Laura Méndez` | Booking.com aparece activa | [ ] | Anotar P |
| 2 | Reservar en Booking | En el hotel de prueba `10485037`, reservar una habitación del tipo relacionado con `DOBLE` con el huésped ficticio | Llegada `hoy`, salida `hoy+2`; 2 adultos | Booking confirma la reserva | [ ] | Anotar el código de Booking, el total y la hora |
| 3 | Ver la reserva en el Módulo 2 | Reservas → buscar el código de Booking | El código de Booking | Antes de 2 minutos desde la confirmación, una sola reserva "Activa", con el canal "OTA" y Booking.com, y el código de Booking bajo su referencia (NFR-001) | [ ] | Anotar el código `RSV-` |
| 4 | Revisar el detalle | Ver detalle | N/A | Canal "OTA · Booking.com", el "Código de la OTA", entrada `hoy`, salida `hoy+2`, 2 noches y 2 personas. Una habitación `DOBLE`, la libre de menor número, en "Esperada" y sin valor bruto por habitación. El titular `Prueba Booking`, con su correo y su teléfono, nacionalidad `Estados Unidos` (Booking envía `US`) y sin tipo ni número de documento (escenario 1 y FR-008) | [ ] | |
| 5 | Revisar el valor y la comisión | Documentación de la API → `GET /api/ota-commissions` | `dateFrom` y `dateTo` `hoy+2` | Un elemento con la reserva, `otaName` Booking.com, el código de Booking, `grossAmount` igual al total de Booking, `commissionPercentage` P y `commissionAmount` igual a `grossAmount × P / 100` (FR-004 y SC-002) | [ ] | |
| 6 | Revisar la consulta del Módulo 3 | `GET /api/reservations/{reservationRef}` con `X-Client` `MODULE3` | El código `RSV-` | `channel` `OTA`, `quoteIds` vacío y `ota` con el `otaId` de Booking.com, `confirmationCode` igual al código de Booking y `commissionPercentage` P | [ ] | |
| 7 | Ver el aviso al Módulo 1 | Render → `hospitua-m2-simulators` → Logs | El código `RSV-` | "Actualización ADDED de <código> recibida": llega hoy y tiene su habitación asignada (FR-009) | [ ] | |
| 8 | Revisar que los logs no tienen datos del titular | Render → `hospitua-m2-backend` → Logs, buscar el apellido, el correo y el teléfono | `Booking`, `prueba.booking@example.com` y `305 000 0000` | Ninguna coincidencia con los datos del titular (NFR-002) | [ ] | La palabra "Booking" puede salir como nombre de la agencia |

--------------------------------------------------------------------------------

##### Section 2: Varias habitaciones, cambio y cancelación (User Story 1, escenario 3, y User Story 2, escenarios 1 y 3)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Reservar dos habitaciones en Booking | En el hotel de prueba, reservar dos habitaciones del tipo relacionado con `DOBLE` | Llegada `hoy+30`, salida `hoy+32`; 2 adultos en cada una | Booking confirma la reserva | [ ] | Anotar el código y el total |
| 2 | Ver una sola reserva con dos habitaciones | Reservas → buscar el código de Booking → Ver detalle | El código de Booking | Una sola reserva "Activa" con 4 personas y dos habitaciones `DOBLE`, las dos libres de menor número. En los logs del simulador no aparece nada: llega en el futuro (escenario 3 y SC-004) | [ ] | Anotar el código `RSV-` |
| 3 | Cambiar la salida en Booking | En Booking, cambiar la fecha de salida de esa reserva | Salida `hoy+33` | Antes de 2 minutos, el detalle muestra salida `hoy+33` y 3 noches, con las mismas habitaciones si siguen libres (escenario 1 de la User Story 2) | [ ] | Anotar el total nuevo |
| 4 | Revisar la comisión recalculada | `GET /api/ota-commissions` | `dateFrom` y `dateTo` `hoy+33` | `grossAmount` igual al total nuevo y `commissionAmount` igual a `grossAmount × P / 100`, con el mismo porcentaje congelado (FR-005) | [ ] | |
| 5 | Cancelar en Booking | En Booking, cancelar esa reserva | N/A | Antes de 2 minutos, la reserva queda "Cancelada", con el panel "Cancelación": canal "Booking" y procesada por `Booking.com` (escenario 3 de la User Story 2) | [ ] | |
| 6 | La comisión no cambia | `GET /api/ota-commissions`, como en el paso 4 | `dateFrom` y `dateTo` `hoy+33` | La reserva con el mismo `grossAmount` y el mismo `commissionAmount` del paso 4 (FR-006) | [ ] | |

--------------------------------------------------------------------------------

##### Section 3: Un cambio de Booking que no se puede aplicar (User Story 2, escenario 4, y FR-007)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Poner en curso la reserva de la sección 1 | Publicar el Check-In de su habitación con el cuerpo C1 | El código `RSV-` de la sección 1 | El simulador responde `202` y la reserva queda "En curso" | [ ] | El `roomId` sale de `/api/rooms` del simulador |
| 2 | Cancelarla en Booking | En Booking, cancelar esa reserva | N/A | Antes de 2 minutos, la reserva sigue "En curso", y el detalle muestra "En conflicto: El cambio de Booking no se pudo aplicar, desde el …". En el listado tiene la marca "En conflicto" y sale con "Solo en conflicto" (escenario 4) | [ ] | |
| 3 | Dejar terminada la estadía | Publicar el Check-Out con el cuerpo C1 | N/A | La reserva queda "Completada" | [ ] | Queda en conflicto para que la Recepcionista lo revise |

--------------------------------------------------------------------------------

##### Section 4: No-show reportado a Booking (User Story 2, escenario 6, y FR-011)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Reservar en Booking con llegada hoy | En el hotel de prueba, reservar una habitación con el huésped ficticio y no publicar ningún Check-In | Llegada `hoy`, salida `hoy+1` | La reserva aparece en el Módulo 2 "Activa" y en los logs del simulador sale su ADDED | [ ] | Anotar los códigos |
| 2 | Ver el no-show al día siguiente | Al día siguiente, abrir la demo después del cierre del día y abrir la reserva | El código `RSV-` | "No se presentó". En los logs del simulador, "Actualización REMOVED (NO_SHOW) de <código>", con la fecha de ayer | [ ] | Se ejecuta al día siguiente |
| 3 | Ver el reporte a Channex | Render → `hospitua-m2-backend` → Logs | N/A | "No-shows a Channex: 1 reportados, 0 rechazados y 0 pendientes." (o con más reportados, si hubo otros) | [ ] | |
| 4 | Ver el no-show en Booking | En el hotel de prueba de Booking, abrir la reserva | El código de Booking | Booking la muestra como no-show, sin cargo al huésped | [ ] | Channex lo acepta hasta 48 horas después de la llegada |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué datos del titular llegan? Nombre, apellido, correo, teléfono y país; sin documento (sección
  1, paso 4).
* **EC-002** : ¿Cómo se guarda el país? Como nombre del país, informativo: `US` queda `Estados Unidos` (sección
  1, paso 4). Un código que no está en la tabla deja la nacionalidad vacía.
* **EC-003** : ¿Cuántas personas tiene cada habitación? Adultos más niños; los bebés no cuentan. Está en las
  limitaciones.
* **EC-004** : ¿Qué pasa con observaciones de más de 500 caracteres o con caracteres no válidos? Se sanean y se
  recortan; la reserva no se rechaza. Está en las limitaciones.
* **EC-005** : ¿Qué pasa con un cambio de una reserva que el sistema no tiene? Se registra como nueva; una
  cancelación solo se confirma. Está en las limitaciones.
* **EC-006** : ¿Qué pasa con dos revisiones de la misma reserva juntas? Se procesan en orden (sección 2, pasos
  3 y 5, si se hacen seguidos).
* **EC-007** : ¿Qué pasa si falla el guardado de una revisión? No se confirma a Channex y se procesa en la
  siguiente lectura; está en las limitaciones.
* **EC-008** : ¿Qué pasa con una reserva de Booking que la agencia nunca confirma? No existe ese caso: Booking
  envía las reservas ya confirmadas, y llegan "Activa" (sección 1, paso 3).
* **EC-009** : ¿Qué pasa si Booking vende una habitación que ya no hay? La reserva se registra sin habitación
  asignada y en conflicto; está en las limitaciones.

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, una reserva de Booking que no llega, que llega dos veces, una cancelación de Booking que no se aplica, o datos del titular en los logs. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, una comisión mal calculada, un cambio de fechas que no se aplica, o un no-show que no se reporta a Booking. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, la nacionalidad con el código `US` en lugar del nombre del país. |
