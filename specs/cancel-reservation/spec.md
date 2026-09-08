# Feature Specification: Cancelación de Reservación

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Las reservas se caen todo el tiempo: el huésped cambia de planes, la agencia recibe una anulación
o el recepcionista atiende una llamada para dar de baja una reserva. El hotel necesita procesar
esas cancelaciones de forma ágil y por los tres canales por los que realmente llegan —recepción,
portal web de autogestión y la API de la OTA— y, sobre todo, necesita que el cupo de la categoría
vuelva a estar disponible de inmediato para poder venderlo otra vez. Si la cancelación depende de
llamadas a otros módulos o se demora, el hotel pierde noches de ocupación que podría haber
revendido. En HOSPITUA la cancelación antes del ingreso es, por regla general, un proceso
puramente lógico: como el pago del 100% de la estadía se liquida en el Check-Out y no se cobran
garantías al reservar, anular una reserva directa es gratuito y solo tiene efecto logístico. La
única excepción es el canal OTA: cuando la cancelación llega dentro de la ventana de penalidad
pactada en el contrato de la agencia, el sistema sí debe invocar de forma síncrona "Procesar
liquidación y validación" para calcular la sanción correspondiente y cerrar la liquidación antes de
confirmar la baja. El sistema debe además proteger la reserva frente a cancelaciones inválidas,
como intentar anular una estadía que ya está en curso.

### Flujo de Usuario de Alto Nivel

1. El solicitante (el **Recepcionista** desde recepción, el **Huésped** titular desde el portal
   web, o la **Ota** mediante su API) localiza la reserva en el Módulo 2 mediante el caso de uso
   interno "Consultar / ver reserva".
2. El sistema valida de forma local que la reserva esté en un estado cancelable (`ACTIVE`).
3. El solicitante confirma la cancelación: de forma interactiva en pantalla para los canales de
   recepción y del huésped, o mediante procesamiento directo del JSON recibido para la API de la
   OTA.
4. Si el solicitante es la **Ota** y la cancelación llega dentro de la ventana de penalidad
   contractual de la agencia, el sistema invoca de forma síncrona "Procesar liquidación y
   validación" para calcular el `penaltyAmount` y cerrar un `Settlement` en estado `Cancelled`
   antes de continuar. Para los demás casos —Recepcionista, Huésped, y OTA fuera de su ventana de
   penalidad— este paso se omite por completo.
5. El sistema persiste el cambio de estado de la `Reservation` a `CANCELLED` de forma local.
6. El sistema libera de inmediato un cupo de la categoría de habitación correspondiente en la base
   de datos de reservas del Módulo 2 y registra el log de la operación en `Cancellation`.

Esta funcionalidad no realiza ninguna llamada al Módulo 1 (no ejecuta `Set Habitation State`) bajo
ninguna circunstancia. Solo invoca al Módulo 3, mediante "Procesar liquidación y validación", en el
caso puntual de una cancelación tardía de una reserva OTA sujeta a penalidad contractual; en todos
los demás casos —incluidas las reservas OTA canceladas fuera de esa ventana— el proceso es 100%
interno del Módulo 2.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cancelación de una Reservación (Priority: P1)

Un solicitante necesita anular una reserva que aún no ha completado su ciclo (`ACTIVE`). El caso de
negocio es el mismo para los tres canales y se resuelve con una única lógica operativa: se localiza
la reserva en el Módulo 2, se valida de forma local que su estado admita cancelación, se confirma
la baja —en pantalla para el **Recepcionista** y el **Huésped**, o de forma directa mediante la API
para la **Ota**—, se cambia el estado a `CANCELLED` y se libera el cupo de la categoría en el
inventario local. La única diferencia entre canales es la forma de confirmar y los efectos
accesorios (el canal del Huésped envía además un correo de notificación); la única excepción
financiera es la cancelación tardía de una reserva OTA sujeta a penalidad contractual, cubierta por
separado en la Historia de Usuario 2. Por eso, los caminos de éxito de los tres canales y los
bloqueos lógicos (reserva en curso o ya finalizada, referencia vacía, cancelación concurrente) se
consolidan en esta misma historia de usuario y no se modelan como pantallas ni historias separadas,
para evitar la sobre-atomización.

**Why this priority**: Es el flujo que permite al hotel recuperar inventario vendible en el acto.
Liberar el cupo de la categoría apenas se confirma la cancelación evita que el hotel pierda
oportunidades de ocupación por reservas que ya no se van a honrar. Además, al operar de forma 100%
desacoplada de otros módulos, la cancelación es rápida, confiable y no se ve afectada por caídas
de integración.

**Independent Test**: Se puede probar de forma aislada tomando una reserva en estado `ACTIVE` y
ejecutando la cancelación por cada uno de los tres canales. Se verifica que la `Reservation`
transiciona a `CANCELLED`, que se registra el log en la entidad `Cancellation` con el canal
correcto (`RECEPTION`, `USER_PORTAL` u `OTA_API`), y que el cupo de la categoría se suma de nuevo
al inventario local del Módulo 2. La prueba confirma además que no se realiza ninguna llamada al
Módulo 1 ni al Módulo 3, y se completa intentando cancelar reservas en estado `CHECKED_IN`,
`CHECKED_OUT` y `CANCELLED`, comprobando que cada intento se bloquea con un error controlado.

**Acceptance Scenarios**:

1. **Scenario**: Cancelación exitosa por Recepcionista (Happy Path - Recepción)
   - **Given** que existe una reserva en estado `ACTIVE` en la base de datos local del Módulo 2
   - **When** el **Recepcionista** confirma la cancelación en pantalla
   - **Then** el sistema cambia el estado de la `Reservation` a `CANCELLED`, libera un cupo de la
     categoría localmente en el Módulo 2, y genera el log de `Cancellation` con el canal
     `RECEPTION`

2. **Scenario**: Cancelación exitosa por Huésped de autoservicio (Happy Path - Autoservicio)
   - **Given** que existe una reserva en estado `ACTIVE` de la cual el **Huésped** es titular
   - **When** el **Huésped** confirma la cancelación desde su portal web
   - **Then** el sistema cambia el estado de la `Reservation` a `CANCELLED`, libera un cupo de la
     categoría localmente en el Módulo 2, genera el log de `Cancellation` con el canal
     `USER_PORTAL`, y envía el correo electrónico de notificación al titular

3. **Scenario**: Cancelación de una reserva de origen OTA vía API asíncrona (Happy Path -
   Integración)
   - **Given** que existe una reserva en estado `ACTIVE` cuyo atributo `source` es estrictamente
     `OTA`
   - **When** la API del Módulo 2 recibe la solicitud de cancelación asíncrona enviada por la
     **Ota**
   - **Then** el sistema procesa de inmediato la transacción, cambia el estado de la `Reservation`
     a `CANCELLED` localmente, libera el cupo de la categoría de habitación, registra el log de
     `Cancellation` con el canal `OTA_API` y devuelve una respuesta HTTP 200 de éxito

4. **Scenario**: Bloqueo de cancelación para reservas inactivas o finalizadas (Error)
   - **Given** que una reserva se encuentra en estado `CHECKED_IN`, `CHECKED_OUT` o ya está
     `CANCELLED`
   - **When** se intenta iniciar un proceso de cancelación por cualquiera de los tres canales
   - **Then** el sistema intercepta la petición, bloquea la acción de forma segura y devuelve un
     error de negocio controlado HTTP 400 (Bad Request) que detalla que el estado actual no admite
     cancelación

---

### User Story 2 - Cancelación Tardía de una Reserva OTA con Penalidad Contractual (Priority: P2)

Cuando la **Ota** solicita cancelar una reserva `ACTIVE` dentro de la ventana de penalidad definida
en su contrato, el sistema invoca "Procesar liquidación y validación" para calcular el
`penaltyAmount` y cerrar un `Settlement` en estado `Cancelled`, antes de cambiar la `Reservation` a
`CANCELLED` y liberar el cupo como en el flujo estándar.

**Why this priority**: Es un flujo alternativo acotado al canal OTA, necesario para respetar los
contratos de comisión y penalidad pactados con cada agencia. No es parte del flujo maestro porque
las reservas de canal directo nunca cobran garantías y jamás lo disparan.

**Independent Test**: Se toma una reserva `source` `OTA` dentro de la ventana de penalidad
contractual de su agencia y se cancela vía API. Se verifica que el sistema invoque "Procesar
liquidación y validación", que se cierre un `Settlement` en `Cancelled` con el `penaltyAmount`
correcto, y que la `Reservation` termine en `CANCELLED` con el cupo liberado. Se completa cancelando
una reserva OTA fuera de esa ventana, confirmando que no se genera ningún `Settlement`.

**Acceptance Scenarios**:

1. **Scenario**: Cancelación OTA con penalidad calculada por el Módulo 3
   - **Given** una reserva `source` `OTA` en estado `ACTIVE` cuya cancelación llega dentro de la
     ventana de penalidad contractual de la agencia
   - **When** la API del Módulo 2 recibe la solicitud de cancelación
   - **Then** el sistema invoca "Procesar liquidación y validación", que calcula el
     `penaltyAmount` y cierra el `Settlement` en estado `Cancelled`; el sistema cambia la
     `Reservation` a `CANCELLED`, libera el cupo de la categoría, y registra el log de
     `Cancellation` con el canal `OTA_API` y el `penaltyApplied` en verdadero

2. **Scenario**: Cancelación OTA fuera de la ventana de penalidad
   - **Given** una reserva `source` `OTA` en estado `ACTIVE` cuya cancelación llega fuera de la
     ventana de penalidad contractual
   - **When** la API del Módulo 2 recibe la solicitud de cancelación
   - **Then** el sistema no invoca "Procesar liquidación y validación", cambia la `Reservation` a
     `CANCELLED`, libera el cupo, y registra el log de `Cancellation` con `penaltyApplied` en falso,
     igual que el flujo estándar de la Historia de Usuario 1

### Casos Borde

- ¿Qué sucede cuando se envía la solicitud de cancelación sin la referencia de la reserva o con
  una justificación vacía cuando esta es obligatoria para el canal? El sistema intercepta la
  validación de forma local y responde con un error estructurado **HTTP 400 (Bad Request)**
  amigable, impidiendo que la excepción escale a un error de infraestructura **HTTP 500**.
- ¿Qué sucede si un solicitante intenta cancelar una reserva hoy, pero la fecha de llegada
  reservada ya pasó y el huésped nunca hizo check-in (No-Show)? El sistema procesa la cancelación
  de forma normal a nivel lógico para liberar el cupo, y marca el log de `Cancellation` con la
  observación "No-Show" en el atributo `reason`.
- ¿Cómo maneja el sistema si dos usuarios intentan cancelar la misma reserva de forma simultánea?
  El sistema usa control de concurrencia optimista sobre `Reservation`: la primera transacción
  aplica la cancelación y la segunda detecta que el estado ya cambió, por lo que se rechaza con un
  error controlado **HTTP 400** amigable, sin producir un doble log ni una doble liberación de
  cupo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe exigir que se busque y valide la existencia y el estado de la
  reserva mediante el caso de uso interno "Consultar / ver reserva" de forma local en el Módulo 2
  antes de habilitar la cancelación.
- **FR-002**: El sistema debe autorizar el proceso de cancelación únicamente si la `Reservation`
  se encuentra en estado `ACTIVE`.
- **FR-003**: El sistema debe rechazar de inmediato la cancelación si la reserva está en estado
  `CHECKED_IN`, informando que una estadía en curso requiere un flujo de check-out controlado y no
  una cancelación.
- **FR-004**: El sistema debe rechazar cualquier intento de cancelación sobre reservas en estado
  `CANCELLED` o `CHECKED_OUT`, respondiendo con un error controlado **HTTP 400 (Bad Request)**.
- **FR-005**: Al confirmarse la cancelación, el sistema debe cambiar el estado de la `Reservation`
  a `CANCELLED` de forma local y liberar un cupo de la categoría de habitación seleccionada en la
  base de datos del Módulo 2.
- **FR-006**: Al confirmarse la cancelación, el sistema debe persistir un registro de auditoría
  inmutable en `Cancellation`, almacenando la referencia de la reserva, la fecha de la baja y el
  canal de origen (`RECEPTION`, `USER_PORTAL`, `OTA_API`).
- **FR-007**: Para el canal de la OTA, el sistema debe procesar la solicitud de forma directa a
  través de la API asíncrona y solo debe aceptar la transacción cuando el atributo `source` de la
  reserva sea estrictamente `OTA`.
- **FR-008**: Para el canal del Huésped, el sistema debe enviar un correo electrónico de
  notificación de cancelación al titular una vez persistida la transacción de manera exitosa.
- **FR-009**: El sistema debe interceptar cualquier error de validación de entrada o inconsistencia
  de negocio para responder con códigos de error amigables **HTTP 400 (Bad Request)**, prohibiendo
  la propagación de excepciones que deriven en errores **HTTP 500 (Internal Server Error)**.
- **FR-010**: El sistema debe invocar "Procesar liquidación y validación" exclusivamente cuando el
  canal es la OTA y la cancelación llega dentro de la ventana de penalidad contractual de la
  agencia, para calcular el `penaltyAmount` y cerrar el `Settlement` correspondiente en estado
  `Cancelled` antes de confirmar la baja; para el Recepcionista, el Huésped, y la OTA fuera de esa
  ventana, el sistema no debe invocar el Módulo 3 bajo ninguna circunstancia.

### Non-Functional Requirements

- **NFR-001**: El procesamiento lógico de la cancelación y la liberación del cupo de categoría en
  la base de datos local del Módulo 2 debe completarse en un tiempo inferior a 200 milisegundos.

### Key Entities *(include if feature involves data)*

- **Cancellation**: Representa la anulación formal de una reserva y su registro de auditoría.
  Atributos: `cancellationId`, `reservationRef`, `cancellationDate`, `reason` (motivo u
  observación, opcional salvo que el canal lo exija), `channel` (`RECEPTION` | `USER_PORTAL` |
  `OTA_API`), `processedBy` (identificador de quien procesó la baja: el Recepcionista, el propio
  Huésped o la integración de la Ota), `penaltyApplied` (booleano; verdadero únicamente cuando el
  canal es `OTA_API` y la cancelación cae dentro de la ventana de penalidad contractual),
  `settlementRef` (referencia al `Settlement` generado por "Procesar liquidación y validación",
  presente solo cuando `penaltyApplied` es verdadero), y `status` (`COMPLETED`, único valor que esta
  funcionalidad asigna).
- **Reservation**: Representa la estadía sobre la que opera la cancelación. Atributos:
  `reservationRef`, `categoryHabitation` (categoría de habitación asociada), `startDate`,
  `endDate`, `source` (`DIRECT` | `OTA`), `createdAt`, y `state` con estados permitidos: `ACTIVE`,
  `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. El estado `PENDING` queda inhabilitado en los flujos
  estándar: toda reserva nace directamente en `ACTIVE`. Solo admite transición a `CANCELLED` desde
  `ACTIVE`.
- **Settlement**: Se referencia únicamente para la cancelación tardía de reservas OTA con
  penalidad. Atributos relevantes: `reservationRef`, `penaltyAmount`, y `status` (`Cancelled` en
  este flujo). Es generado y gestionado por "Procesar liquidación y validación", fuera del alcance
  de esta funcionalidad.
- **Ota**: Se referencia únicamente para obtener la ventana y el contrato de penalidad por
  cancelación tardía. Atributos relevantes: `id`, `name`, `commissionPercentage`.
- **Guest**: Representa al cliente titular de la reserva. Atributos: `id`, `fullName`,
  `documentNumber`, `nationality` y `contactEmail`. En el canal de autoservicio, el sistema usa
  esta referencia para verificar que quien cancela es el titular y para enviarle el correo de
  notificación.
- **Habitation**: Se referencia únicamente de forma informativa para la consistencia del modelo de
  datos. Sus siete estados oficiales del glosario son: `Available`, `Occupied`, `PendingCleaning`,
  `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`. Esta funcionalidad no
  interactúa con el Módulo 1 ni modifica el `stateHabitation`: solo ajusta el conteo de cupos por
  categoría en el Módulo 2.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las cancelaciones registradas cuentan con el canal de origen (`channel`)
  y con la liberación del cupo de la categoría de habitación registrada de forma exacta en la base
  de datos del Módulo 2.
- **SC-002**: El 100% de los intentos fallidos de validación o con datos corruptos se manejan con
  respuestas HTTP 400 estructuradas, con cero excepciones HTTP 500 propagadas en producción.
- **SC-003**: Cero llamadas síncronas o de integración se realizan hacia el Módulo 1 durante el
  proceso de cancelación, bajo ninguna circunstancia. Hacia el Módulo 3, cero llamadas se realizan
  salvo en la cancelación tardía de una reserva OTA sujeta a penalidad contractual, garantizando la
  independencia de las reservas de canal directo antes del check-in.
- **SC-004**: El 100% de las cancelaciones tardías de reservas OTA dentro de su ventana de
  penalidad contractual generan un `Settlement` en `Cancelled` con el `penaltyAmount` exacto antes
  de completar la baja; cero cancelaciones de Recepcionista, Huésped, u OTA fuera de esa ventana
  invocan el Módulo 3.
