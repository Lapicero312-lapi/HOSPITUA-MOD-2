# Feature Specification: Cancelación de Reservación

**Created**: 2026-09-08

## 1. Use Case (Caso de Uso)

### Descripción del problema

En HOSPITUA las reservaciones se caen de forma permanente: el huésped cambia de planes, la agencia
recibe una anulación desde su plataforma, o el recepcionista atiende una llamada para dar de baja
una reserva antes de la llegada. La cancelación, en esta etapa del ciclo de vida, es un proceso
puramente logístico y lógico cuyo único propósito de negocio es recuperar de inmediato inventario
vendible. Mientras la reserva sigue ocupando un cupo de aforo de su categoría de `Habitation`, ese
cupo no puede ofrecerse a otro cliente; cada minuto que la cancelación tarda en procesarse es una
ventana durante la cual el hotel podría estar revendiendo esa misma noche y no puede hacerlo. Por
eso la agilidad del proceso es directamente proporcional a la ocupación recuperada: en cuanto la
baja se confirma y el cupo de la categoría vuelve al inventario local del Módulo 2, la disponibilidad
se refleja en el acto para los tres canales de venta y el hotel deja de perder noches que ya no se
iban a honrar.

Bajo la regla de negocio vigente de HOSPITUA, la cancelación de reservaciones es **siempre 100%
gratuita**, lógica y libre de penalidades, cargos o costos, sin importar el canal de origen —Canal
Directo o canal OTA—. Como el pago del 100% de la estadía se liquida en el Check-Out y las reservas
directas nacen directamente en estado `ACTIVE` sin cobro de garantías previas, no existe ningún
concepto contable, de sanción ni de reembolso que calcular al anular. En consecuencia, esta
funcionalidad opera de manera **100% desacoplada** de los módulos externos:

- El sistema no debe realizar llamados síncronos ni asíncronos al Módulo 3 ("Procesar liquidación y
  validación"), porque no se procesan flujos contables ni de penalidad durante la cancelación.
- El sistema no debe realizar llamados síncronos ni asíncronos al Módulo 1 ("Establecer el estado de
  la habitación"), porque durante la etapa de reserva no hay habitaciones físicas asignadas: solo
  existe un cupo de aforo lógico por categoría de `Habitation` administrado dentro del Módulo 2.

La única interacción previa obligatoria del caso de uso es invocar de forma local el caso de uso
interno "Consultar / ver reserva" del Módulo 2, con el propósito exclusivo de verificar que la
reserva exista en la base de datos local y comprobar que su estado de ciclo de vida
(`Reservation.state`) sea estrictamente `ACTIVE`. El sistema debe además proteger la reserva frente
a cancelaciones inválidas, como intentar anular una estadía que ya está en curso o una reserva que
ya fue finalizada o cancelada.

### Flujo de Usuario de Alto Nivel

1. El solicitante —el **Recepcionista** en el mostrador, el **Huésped** titular desde su portal web,
   o la **Ota** mediante su API— localiza la reserva en el Módulo 2 invocando el caso de uso interno
   "Consultar / ver reserva".
2. El sistema valida de forma 100% local en el Módulo 2 que la reserva exista y que su estado de
   ciclo de vida (`Reservation.state`) sea estrictamente `ACTIVE`.
3. El solicitante confirma la baja: de forma interactiva en pantalla para los canales de recepción y
   del huésped, o mediante el procesamiento directo del payload JSON recibido para la API de la OTA.
4. El sistema actualiza localmente el estado de la reserva a `CANCELLED`, libera de inmediato el cupo
   de aforo de la categoría de `Habitation` en el inventario local del Módulo 2, y asienta el
   registro inmutable de la operación en la entidad `Cancellation`.

Esta funcionalidad no realiza, bajo ninguna circunstancia, ninguna llamada al Módulo 1 ni al
Módulo 3. Todo el proceso —validación, cambio de estado, liberación del cupo y auditoría— es interno
al Módulo 2. Para el canal del Huésped, y solo para ese canal, el sistema envía además de forma
local un correo electrónico de notificación al titular una vez persistida la baja.

## 2. User Scenarios & Testing *(mandatory)*

### User Story 1 - Cancelación de una Reservación (Priority: P1)

**Plain Language**: Un solicitante necesita anular una reserva que aún no ha completado su ciclo de
vida (`ACTIVE`). El caso de negocio es idéntico para los tres canales y se resuelve con una única
lógica operativa: la **Recepcionista** desde el mostrador, el **Huésped** titular desde su portal
web, o la **Ota** mediante su API localizan la reserva en el Módulo 2, el sistema valida de forma
local que su estado sea `ACTIVE`, el solicitante confirma la baja —en pantalla para la Recepcionista
y el Huésped, o mediante payload JSON para la Ota—, el sistema cambia el estado a `CANCELLED`, libera
el cupo de aforo de la categoría de `Habitation` en el inventario local del Módulo 2 y asienta el log
en `Cancellation`. La única diferencia entre canales es la forma de confirmar y un efecto accesorio:
el canal del Huésped envía además un correo local de notificación al titular. Los caminos de éxito de
los tres canales y los bloqueos lógicos (reserva en curso, ya finalizada o ya cancelada, referencia
vacía, cancelación concurrente) se consolidan en esta misma historia de usuario y no se modelan como
pantallas ni historias separadas, para evitar la sobre-atomización de una única unidad de valor.

**Why this priority**: Es el flujo que permite al hotel recuperar inventario vendible en el acto.
Liberar el cupo de la categoría apenas se confirma la cancelación evita que el hotel pierda noches de
ocupación por reservas que ya no se van a honrar. Al operar de forma 100% desacoplada de los
Módulos 1 y 3, la cancelación es rápida, confiable y no se ve afectada por caídas de integración ni
por flujos contables. Por sí sola, esta historia entrega un MVP utilizable: el hotel puede operar la
anulación de reservas de extremo a extremo por sus tres canales reales, incluido el rechazo
controlado de intentos inválidos.

**Independent Test**: Se puede probar de forma aislada tomando una reserva en estado `ACTIVE` y
ejecutando la cancelación por cada uno de los tres canales. Se verifica que la `Reservation`
transiciona a `CANCELLED`, que se registra el log en la entidad `Cancellation` con el canal correcto
(`RECEPTION`, `USER_PORTAL` u `OTA_API`), y que el cupo de aforo de la categoría se suma de nuevo al
inventario local del Módulo 2. La prueba confirma además que no se realiza ninguna llamada al
Módulo 1 ni al Módulo 3, y se completa intentando cancelar reservas en estado `CHECKED_IN`,
`CHECKED_OUT` y `CANCELLED`, comprobando que cada intento se bloquea con un error de negocio
controlado **HTTP 400 (Bad Request)** y sin efectos colaterales.

**Acceptance Scenarios**:

1. **Scenario**: Cancelación exitosa por Recepcionista (Canal Recepción)
   - **Given** que existe una reserva en estado `ACTIVE` en la base de datos local del Módulo 2
   - **When** la **Recepcionista** localiza la reserva mediante "Consultar / ver reserva" y confirma
     la cancelación en pantalla
   - **Then** el sistema cambia el estado de la `Reservation` a `CANCELLED` de forma local, libera de
     inmediato un cupo de aforo de la categoría de `Habitation` en el inventario del Módulo 2, y
     asienta el registro inmutable en `Cancellation` con `channel` igual a `RECEPTION` y
     `processedBy` igual al identificador de la recepcionista, sin realizar ninguna llamada al
     Módulo 1 ni al Módulo 3

2. **Scenario**: Cancelación exitosa por Huésped de autoservicio (Canal Portal Web)
   - **Given** que existe una reserva en estado `ACTIVE` de la cual el **Huésped** es titular
   - **When** el **Huésped** confirma la cancelación desde su portal web
   - **Then** el sistema cambia el estado de la `Reservation` a `CANCELLED` de forma local, libera un
     cupo de aforo de la categoría de `Habitation` en el Módulo 2, asienta el registro en
     `Cancellation` con `channel` igual a `USER_PORTAL`, y envía de forma local un correo electrónico
     de notificación de cancelación al `contactEmail` del titular, sin realizar ninguna llamada al
     Módulo 1 ni al Módulo 3

3. **Scenario**: Cancelación exitosa de reserva OTA vía API asíncrona (Canal Webhook/API)
   - **Given** que existe una reserva en estado `ACTIVE` cuyo atributo `source` es estrictamente
     `OTA` y cuyo `externalConfirmationCode` no está vacío
   - **When** la API del Módulo 2 recibe la solicitud de cancelación asíncrona enviada por la **Ota**
     con el payload JSON correspondiente
   - **Then** el sistema valida que `source` sea `OTA` y que `externalConfirmationCode` esté
     presente, procesa de inmediato la transacción, cambia el estado de la `Reservation` a
     `CANCELLED` de forma local, libera el cupo de aforo de la categoría de `Habitation`, asienta el
     registro en `Cancellation` con `channel` igual a `OTA_API`, y responde con **HTTP 200 (OK)**,
     sin realizar ninguna llamada al Módulo 1 ni al Módulo 3

4. **Scenario**: Bloqueo de cancelación para reservas hospedadas, finalizadas o ya canceladas
   - **Given** que una reserva se encuentra en estado `CHECKED_IN`, `CHECKED_OUT` o ya está
     `CANCELLED`
   - **When** se intenta iniciar un proceso de cancelación por cualquiera de los tres canales
   - **Then** el sistema intercepta la petición, bloquea la acción de forma segura, no modifica el
     `state` de la reserva ni el inventario de cupos, y responde con un error de negocio controlado
     **HTTP 400 (Bad Request)** que detalla que el estado actual de la reserva no admite cancelación

## 3. Casos Borde

- **Caso Borde 1 — Referencia ausente o valores vacíos**: ¿Qué sucede cuando se envía la solicitud
  de cancelación sin la referencia de la reserva, con la referencia vacía, o con valores nulos en
  campos obligatorios del payload? El sistema intercepta la validación de forma local en el
  controlador, antes de tocar la capa de negocio, y responde con un error estructurado **HTTP 400
  (Bad Request)** amigable que indica el dato faltante, previniendo de forma explícita que la
  excepción escale a un error de infraestructura **HTTP 500 (Internal Server Error)**.

- **Caso Borde 2 — No-Show (fecha de llegada ya vencida sin check-in)**: ¿Qué sucede si un
  solicitante cancela hoy una reserva cuya fecha de llegada (`checkInDate`) ya pasó pero que nunca
  registró su Check-In? El sistema procesa la cancelación como `CANCELLED` de manera completamente
  normal a nivel lógico para liberar el cupo de aforo de la categoría, y marca el registro de
  `Cancellation` con el valor `"No-Show"` en su atributo `reason`, dejando constancia auditable de
  la causa de la baja.

- **Caso Borde 3 — Concurrencia entre dos recepcionistas**: ¿Cómo maneja el sistema si dos
  recepcionistas intentan cancelar la misma reserva de forma simultánea? El sistema aplica control de
  concurrencia optimista sobre el atributo `version` de `Reservation`: la primera transacción aplica
  la cancelación e incrementa la `version`; la segunda detecta que la `version` esperada ya no
  coincide, aborta sin efectos y se rechaza con un error controlado **HTTP 400 (Bad Request)**
  amigable, sin producir un doble registro de `Cancellation` ni una doble liberación de cupo.

## 4. Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe exigir que, antes de habilitar la cancelación, se localice y valide la
  reserva mediante el caso de uso interno "Consultar / ver reserva" ejecutado de forma 100% local en
  el Módulo 2, con el propósito exclusivo de comprobar la existencia de la reserva en la base de
  datos local y su estado de ciclo de vida.
- **FR-002**: El sistema debe autorizar la transacción de cancelación únicamente si la `Reservation`
  se encuentra en estado `ACTIVE`.
- **FR-003**: Al confirmarse la cancelación, el sistema debe cambiar el estado de la `Reservation` a
  `CANCELLED` de forma local y liberar de inmediato un cupo de aforo de la categoría de `Habitation`
  correspondiente en el inventario local del Módulo 2, sin realizar ningún llamado síncrono ni
  asíncrono al Módulo 1 ni al Módulo 3.
- **FR-004**: Al confirmarse la cancelación, el sistema debe persistir un registro de auditoría
  inmutable en `Cancellation`, almacenando como mínimo la referencia de la reserva
  (`reservationRef`), la fecha de la baja (`cancellationDate`), el canal de origen (`channel`:
  `RECEPTION`, `USER_PORTAL` u `OTA_API`), el operador responsable (`processedBy`) y el estado
  `status` igual a `COMPLETED`.
- **FR-005**: Para el canal de la OTA, el sistema debe procesar la solicitud de forma directa a
  través de la API asíncrona y solo debe aceptar la transacción cuando el atributo `source` de la
  reserva sea estrictamente `OTA` y su `externalConfirmationCode` no esté vacío.
- **FR-006**: Para el canal del Huésped, el sistema debe enviar de forma local un correo electrónico
  de notificación de cancelación al `contactEmail` del titular una vez persistida con éxito la
  transacción.
- **FR-007**: El sistema debe rechazar con un error de negocio controlado **HTTP 400 (Bad Request)**
  cualquier intento de cancelación sobre una reserva en estado `CHECKED_IN`, `CHECKED_OUT` o
  `CANCELLED`, sin modificar el estado de la reserva ni el inventario de cupos.
- **FR-008**: El sistema debe interceptar cualquier error de validación de entrada o inconsistencia
  de negocio —incluyendo referencias vacías, payloads mal formados, conflictos de concurrencia
  optimista sobre `version` y estados no cancelables— para responder siempre con códigos de error
  estructurados **HTTP 400 (Bad Request)**, quedando explícitamente prohibida la propagación de
  excepciones que deriven en errores **HTTP 500 (Internal Server Error)** en producción.

### Non-Functional Requirements

- **NFR-001**: El procesamiento lógico local de la cancelación y la liberación del cupo de aforo de
  la categoría de `Habitation` en la base de datos de reservas del Módulo 2 debe completarse en un
  tiempo inferior a 200 milisegundos.
- **NFR-002**: El servicio de cancelación debe ser idempotente y seguro: una segunda solicitud de
  cancelación sobre una reserva que ya está en `CANCELLED` no debe producir efectos colaterales, no
  debe generar un segundo registro de `Cancellation` ni una segunda liberación de cupo, y debe
  responder de forma controlada.

## 5. Key Entities *(include if feature involves data)*

- **Cancellation**: Representa la anulación formal de una reserva y su registro de auditoría
  inmutable. Atributos: `cancellationId`, `reservationRef` (referencia a la reserva anulada),
  `cancellationDate`, `reason` (motivo u observación, opcional; toma el valor `"No-Show"` cuando la
  fecha de llegada ya venció sin Check-In), `channel` (`RECEPTION` | `USER_PORTAL` | `OTA_API`),
  `processedBy` (identificador del operador que procesó la baja: la Recepcionista, el propio Huésped
  o la integración de la Ota), y `status` (`COMPLETED`, único valor que esta funcionalidad asigna).
  Esta entidad no posee, de forma deliberada, atributos como `penaltyApplied` ni `settlementRef`,
  porque la cancelación es siempre 100% gratuita y no se calcula ningún cobro.

- **Reservation**: Representa la estadía reservada sobre la que opera la cancelación. Atributos:
  `id`, `guestRef` (referencia al `Guest` titular), `categoryHabitation` (categoría de `Habitation`
  reservada, sin habitación física asignada en esta etapa), `checkInDate`, `checkOutDate`,
  `grossAmount` (valor bruto de la estadía, informativo para esta funcionalidad ya que no se cobra ni
  se reembolsa nada al cancelar), `version` (contador de control de concurrencia optimista),
  `source` (`DIRECT` | `OTA`), `externalConfirmationCode` (código de confirmación de la agencia,
  presente únicamente cuando `source` es `OTA`), y `state` con estados permitidos: `ACTIVE`,
  `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. El estado `PENDING` queda inhabilitado en los flujos
  estándar para reservas directas: toda reserva directa nace directamente en `ACTIVE`, simplificando
  el backend al no cobrarse garantías previas al Check-In. La cancelación solo admite la transición a
  `CANCELLED` desde `ACTIVE`.

- **Guest**: Representa al cliente titular de la reserva. Atributos: `id`, `fullName`,
  `documentNumber`, `nationality` y `contactEmail`. En el canal de autoservicio, el sistema usa esta
  referencia para verificar que quien solicita la baja es el titular y para enviarle el correo local
  de notificación de cancelación.

- **Habitation**: Se referencia únicamente de forma informativa, para mantener la consistencia del
  modelo de datos de la categoría de alojamiento. La entidad física de alojamiento se denomina
  estrictamente `Habitation`, y sus siete estados oficiales del Módulo 1 son: `Available`,
  `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock` e `Inactive`.
  Esta funcionalidad no interactúa con el Módulo 1 ni consulta ni modifica el estado de ninguna
  `Habitation`: solo ajusta el conteo de cupos de aforo disponibles por categoría dentro del
  Módulo 2.

## 6. Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las cancelaciones registradas cuentan con el canal de origen (`channel`) y
  con la liberación del cupo de aforo de la categoría de `Habitation` reflejada de forma exacta en la
  base de datos local del Módulo 2.
- **SC-002**: El 100% de los intentos de validación fallidos o con datos corruptos se manejan con
  respuestas **HTTP 400 (Bad Request)** estructuradas, con cero excepciones **HTTP 500** propagadas
  en producción.
- **SC-003**: Cero llamadas síncronas o de integración se realizan hacia el Módulo 1 (Gestión de
  Habitaciones) y hacia el Módulo 3 (Pricing y Liquidación) durante el proceso de cancelación, bajo
  ninguna circunstancia y para ningún canal de origen.
