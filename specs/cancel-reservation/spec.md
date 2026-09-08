# Especificación de Funcionalidad: Cancelación de Reservación

**Creado**: 2026-09-05

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Cancelación de Reservación permite anular formalmente una reserva a través de
**tres canales distintos**, cada uno con sus propias reglas de negocio: el **Recepcionista** desde
la pantalla interna de recepción (cancelación presencial o telefónica), el **Usuario** desde el
portal web o la aplicación (cancelación autoservicio), y la **Ota** mediante integración
asíncrona de sistema a sistema (cancelación vía API). Los tres canales comparten el mismo caso de
uso de negocio y las mismas validaciones internas, por lo que no se modelan como historias de
usuario independientes sino como variantes de la misma historia:

- Antes de cancelar, el sistema debe ubicar y validar la reserva mediante el caso de uso interno
  **"Check/View Reservation"** (Consultar / Ver Reserva), sin importar el canal de origen de la
  solicitud.
- El sistema debe ejecutar obligatoriamente el caso de uso interno **"Process Billing /
  Liquidation"** (Procesar Liquidación de Cobros y Reembolsos), propiedad del **Módulo 3**, para
  determinar si la cancelación aplica dentro del tiempo permitido sin costo o si corresponde
  calcular una penalidad por cancelación tardía, y el reembolso resultante. Para el canal de la
  Ota, este cálculo utiliza las comisiones específicas pactadas con esa agencia en lugar de la
  política general de cancelación tardía usada para Recepcionista y Usuario.
- Para los canales de Recepcionista y Usuario, el sistema presenta en pantalla el resultado de la
  liquidación (si aplica penalidad, su monto, y el reembolso) para confirmación explícita antes de
  finalizar; el Recepcionista, adicionalmente, puede ajustar o anular manualmente esa penalidad
  dejando constancia del motivo. Para el canal de la Ota no existe pantalla de confirmación
  interactiva: la solicitud llega ya decidida desde el sistema externo y se procesa de forma
  directa.
- Una vez registrada la cancelación, si la reserva tenía una habitación asignada, el sistema
  solicita al **Módulo 1** liberar dicha habitación mediante el caso de uso **"Set Room State"**
  (Establecer el Estado de la Habitación), cambiándola a `AVAILABLE`. Para el canal de la Ota esta
  solicitud se envía con prioridad alta e inmediata, sin esperar ninguna confirmación interactiva.
- Para el canal de Usuario, una vez completada la cancelación, el sistema envía un correo
  electrónico de confirmación con el detalle de la penalidad y el reembolso aplicado.

**Estados de la entidad `Reservation`** (deben usarse exactamente estos valores en todo el
sistema): `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Esta funcionalidad solo
permite la transición desde `PENDING` o `ACTIVE` hacia `CANCELLED`, sin importar el canal.

**Estados de la entidad `Room`** relevantes para esta funcionalidad (el estado físico completo es
propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

### Historia de Usuario 1 - Cancelación de una Reservación (Prioridad: P1)

Una reserva en estado `PENDING` o `ACTIVE` necesita cancelarse, ya sea porque el Recepcionista
atiende una solicitud presencial o telefónica, porque el Usuario decide cancelarla de forma
autónoma desde el portal, o porque la Ota que originó la reserva envía una cancelación asíncrona
desde su propio sistema. En los tres casos, el sistema consulta al Módulo 3 si corresponde una
penalidad por cancelación tardía y el reembolso resultante, aplica las reglas de confirmación
propias de cada canal, cambia el estado de la reserva a `CANCELLED`, y si había una habitación
asignada, solicita al Módulo 1 liberarla como `AVAILABLE`. Esta historia es el flujo maestro de la
funcionalidad: cubre los tres caminos exitosos (uno por canal) y los caminos de error que impiden
cancelar una reserva que ya no corresponde (ya cancelada, con check-out, o actualmente hospedada).

**Por qué esta prioridad**: Cancelar correctamente y a tiempo es crítico tanto para la caja del
hotel como para la disponibilidad de inventario: una penalidad mal calculada o no cobrada
representa una pérdida financiera directa, y una habitación que no se libera con agilidad tras una
cancelación bloquea una venta futura. Al soportar los tres canales por los que realmente llegan
las cancelaciones —Recepción, autoservicio del huésped, e integración con las Otas—, esta historia
entrega por sí sola un MVP utilizable: el hotel puede liberar inventario y liquidar penalidades de
forma correcta y consistente sin importar el origen de la solicitud.

**Prueba Independiente**: Se puede probar de forma completa cancelando, desde la pantalla del
Recepcionista, una reserva `ACTIVE` dentro de la ventana sin penalidad, y confirmando que pasa a
`CANCELLED` sin cargos y que se solicita la liberación de la habitación. Se completa cancelando,
desde el portal del Usuario, una reserva fuera de esa ventana, confirmando que se muestra y se
acepta la penalidad calculada por el Módulo 3, que se cobra correctamente, y que se envía el
correo de confirmación. Se completa además simulando una solicitud de cancelación asíncrona desde
la API de una Ota sobre una reserva cuyo origen es `OTA`, confirmando que se procesa sin pantalla
intermedia, aplicando la comisión pactada y liberando la habitación de inmediato. Finalmente, se
completa intentando cancelar una reserva `CANCELLED`, una `CHECKED_OUT`, y una `CHECKED_IN` desde
cualquiera de los tres canales, confirmando que los intentos se bloquean con una razón clara y sin
efecto colateral. Entrega el valor de una cancelación multicanal, auditable y financieramente
correcta.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Cancelación exitosa por Recepcionista sin penalidad dentro del tiempo permitido
   - **Dado** que existe una reserva en estado `ACTIVE` cuya fecha de cancelación está dentro de
     la ventana permitida sin costo y el canal de origen es interno
   - **Cuando** el **Recepcionista** busca la reserva y confirma la cancelación en pantalla
   - **Entonces** el sistema invoca a "Process Billing / Liquidation" (Módulo 3), determina que no
     aplica penalidad, cambia el estado de la `Reservation` a `CANCELLED` y solicita al Módulo 1
     liberar la `Room` como `AVAILABLE`

2. **Escenario**: Cancelación exitosa por Usuario con penalidad por cancelación tardía
   - **Dado** que existe una reserva en estado `ACTIVE` propiedad de un **Usuario** (canal
     directo) fuera de la ventana permitida de cancelación sin costo
   - **Cuando** el **Usuario** solicita la cancelación desde su portal web, el sistema le muestra
     el cobro de la penalidad calculado por el Módulo 3, y el **Usuario** confirma que la acepta
   - **Entonces** el sistema registra el cobro de la penalidad, cambia el estado de la
     `Reservation` a `CANCELLED`, solicita al Módulo 1 liberar la habitación asignada como
     `AVAILABLE`, y envía un correo electrónico de confirmación con el detalle del cobro y el
     reembolso

3. **Escenario**: Cancelación exitosa de una reserva por integración externa de la Ota
   - **Dado** que existe una reserva activa en estado `ACTIVE` cuyo atributo `source` es `OTA`
   - **Cuando** llega la solicitud de cancelación asíncrona desde la API externa de la **Ota**
   - **Entonces** el sistema procesa la baja de forma directa sin pantalla intermedia, aplica la
     penalidad de comisión pactada con esa agencia, cambia el estado de la `Reservation` a
     `CANCELLED`, y envía una solicitud de alta prioridad al Módulo 1 para liberar de inmediato la
     habitación como `AVAILABLE`

*Escenarios de Error / Casos Espejo (Caminos Tristes)*

4. **Escenario**: Bloqueo controlado de cancelación para reservas con estadías finalizadas o
   activas
   - **Dado** que una reserva se encuentra en estado `CHECKED_IN`, en estado `CHECKED_OUT`, o ya
     está `CANCELLED`
   - **Cuando** se intenta iniciar un proceso de cancelación desde cualquiera de los tres canales
   - **Entonces** el sistema intercepta la petición, bloquea la operación de forma segura, y
     devuelve un error de negocio controlado **HTTP 400 (Bad Request)** indicando que la reserva
     se encuentra en un estado que no admite cancelación, sin modificar la reserva ni la
     habitación

### Casos Borde

- **¿Qué sucede cuando se envía la solicitud de cancelación sin el identificador de la reserva o
  con una justificación vacía?**: el sistema intercepta la validación en el controlador del
  Módulo 2 antes de invocar cualquier lógica de negocio, y responde con un código **HTTP 400 (Bad
  Request)** controlado indicando de forma amigable qué dato falta, sin exponer errores de
  infraestructura (HTTP 500).
- **¿Cómo maneja el sistema si la API de liquidación de cobros del Módulo 3 no responde o
  experimenta un timeout durante la cancelación?**: el sistema no bloquea la operación del hotel;
  la cancelación de la reserva y la liberación de la habitación continúan su curso, mientras que
  la liquidación de la reserva se marca localmente con el estado `PENDING_LIQUIDATION` para ser
  recalculada de forma asíncrona en cuanto el Módulo 3 se recupere.
- **¿Qué sucede si la solicitud de liberación de habitación ("Set Room State") enviada al Módulo 1
  falla por un error de red tras una cancelación financiera ya exitosa?**: la transacción de
  cancelación se mantiene firme y válida en la base de datos; la notificación de cambio de estado
  de la habitación queda encolada localmente como `PENDING` para reintentos asíncronos, sin
  obligar a repetir la cancelación.
- **¿Cómo maneja el sistema una fecha de cancelación posterior a la fecha de llegada de la
  reserva?**: el sistema rechaza la operación con **HTTP 400** y un mensaje claro, indicando que
  la reserva ya debió resolverse mediante check-in o ya no admite cancelación estándar por
  ninguno de los tres canales.
- **¿Qué sucede si se intenta registrar un monto de penalidad negativo, con formato inválido, o
  con caracteres extraños o potencialmente maliciosos en la razón de cancelación?**: el sistema
  intercepta y rechaza la entrada con **HTTP 400** y un mensaje amigable, sin aplicar ese monto ni
  esa razón a la cancelación, en lugar de procesarla o dejar que provoque un fallo interno.
- **¿Qué sucede cuando la reserva cancelada no tenía ninguna habitación asignada al momento de la
  cancelación?**: el sistema completa la cancelación con normalidad, en cualquiera de los tres
  canales, sin emitir ninguna solicitud de liberación al Módulo 1, ya que no existe una habitación
  física que liberar.

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema debe exigir que se ubique y valide la existencia y el estado de la
  reserva mediante el caso de uso interno "Check/View Reservation" antes de habilitar la
  cancelación en cualquier canal.
- **FR-002**: El sistema debe autorizar el proceso de cancelación únicamente si la `Reservation`
  se encuentra en estado `PENDING` o `ACTIVE`.
- **FR-003**: El sistema debe rechazar la cancelación si la reserva está en estado `CHECKED_IN`,
  indicando que una estadía en curso requiere un flujo de check-out prematuro controlado y no una
  cancelación estándar.
- **FR-004**: El sistema debe rechazar de manera inmediata cualquier intento de cancelación sobre
  reservas en estado `CANCELLED` o `CHECKED_OUT`, respondiendo con un error de negocio **HTTP 400**
  amigable.
- **FR-005**: El sistema debe invocar el caso de uso externo "Process Billing / Liquidation"
  (Módulo 3) para calcular de manera automática si aplica penalidad, según las fechas y las
  políticas vigentes.
- **FR-006**: Para los canales de Recepcionista y Usuario, el sistema debe presentar en pantalla
  el desglose del monto de penalidad (`penaltyAmount`) y del reembolso resultante
  (`refundAmount`) antes de guardar el cambio de estado.
- **FR-007**: El sistema debe exigir una confirmación explícita del Recepcionista o del Usuario en
  pantalla antes de aplicar la cancelación e invocar la liberación física de la habitación; para
  la Ota, el sistema debe omitir la confirmación interactiva y procesar la transacción de forma
  directa.
- **FR-008**: Al completarse la cancelación con éxito, el sistema debe actualizar el estado de la
  reserva (`Reservation.status`) a `CANCELLED` y generar un registro de auditoría inmutable en
  `Cancellation`, indicando el canal de origen.
- **FR-009**: Si la reserva cancelada tenía asignada una habitación física, el sistema debe emitir
  una solicitud para cambiar el estado de la habitación a `AVAILABLE` en el Módulo 1 mediante el
  caso de uso "Set Room State".
- **FR-010**: El sistema debe asegurar que, si el servicio externo de liquidación (Módulo 3)
  falla, el registro de la cancelación no se bloquee ni se detenga la transacción, persistiendo
  localmente el registro con estado de liquidación `PENDING_LIQUIDATION`.
- **FR-011**: El sistema debe interceptar cualquier inconsistencia de datos o fallo de negocio y
  responder con errores estructurados **HTTP 400 (Bad Request)**; el sistema no debe permitir que
  estas fallas se propaguen como errores de infraestructura **HTTP 500 (Internal Server Error)**.
- **FR-012**: El sistema debe validar que cualquier monto de penalidad sea numérico y no negativo
  antes de aplicarlo a una cancelación.
- **FR-013**: El sistema debe rechazar una fecha de cancelación posterior a la fecha de llegada de
  la estadía reservada, sin importar el canal de origen.
- **FR-014**: El sistema debe permitir exclusivamente al canal de Recepcionista ajustar o anular
  manualmente el monto de penalidad calculado por el Módulo 3, dejando registrado el motivo del
  ajuste; los canales de Usuario y de Ota no deben contar con esta capacidad.
- **FR-015**: Para el canal de la Ota, el sistema debe calcular la penalidad utilizando las
  comisiones específicas pactadas con esa agencia, y solo debe aceptar la solicitud de cancelación
  vía API cuando el atributo `source` de la reserva sea `OTA`.
- **FR-016**: Para el canal de Usuario, el sistema debe enviar un correo electrónico de
  confirmación de la cancelación con el detalle de la penalidad y el reembolso aplicado, una vez
  completada la transacción.
- **FR-017**: Para el canal de la Ota, el sistema debe procesar la solicitud de liberación de la
  habitación al Módulo 1 con prioridad alta e inmediata, sin esperar ninguna confirmación
  interactiva.
- **FR-018**: El sistema debe mantener un registro auditable de cada intento de cancelación,
  incluyendo el canal de origen, los intentos bloqueados o fallidos, y la razón del bloqueo.
- **FR-019**: El sistema debe comunicar con claridad, en cada caso de rechazo, exactamente qué
  dato falta o es inválido, adaptando el formato del mensaje al canal correspondiente: en pantalla
  para Recepcionista y Usuario, y como una respuesta estructurada para la integración de la Ota.

### Requisitos No Funcionales

- **NFR-001**: El sistema debe aislar y proteger el canal de la API de cancelaciones de la Ota, de
  forma que un volumen alto de cancelaciones de agencias no degrade el rendimiento de las
  terminales físicas de Recepción ni del portal del Usuario.
- **NFR-002**: El tiempo de respuesta de la validación de inventario con el Módulo 1 junto con el
  cálculo financiero del Módulo 3 debe ser inferior a 3 segundos bajo condiciones normales de
  carga.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Cancellation**: Representa la anulación formal de una reserva, sin importar el canal que la
  originó. Atributos clave: `cancellationId` (identificador de la cancelación), `reservationRef`
  (referencia a la `Reservation` cancelada), `cancellationDate` (fecha en la que se solicitó la
  cancelación), `reason` (razón de la cancelación), `channel` (canal de origen:
  `RECEPTION` | `USER_PORTAL` | `OTA_API`), `penaltyApplied` (booleano que indica si se cobró una
  penalidad), `penaltyAmount` (monto de la penalidad, cero si no aplica), `penaltyOverridden`
  (booleano que indica si el Recepcionista ajustó manualmente el monto calculado por el Módulo 3;
  solo aplicable al canal `RECEPTION`), `refundAmount` (monto a reembolsar al huésped),
  `processedBy` (identificador de quien procesó la cancelación: el Recepcionista, el propio
  Usuario, o la integración de la Ota), `status` (`COMPLETED`, único valor que esta funcionalidad
  asigna), `liquidationStatus` (`PENDING_LIQUIDATION` | `COMPLETED`, según la disponibilidad del
  Módulo 3 al momento de cancelar), y `roomStateRequestStatus` (`PENDING` | `COMPLETED`). Una
  `Cancellation` pertenece a exactamente una `Reservation`.
- **Reservation**: Representa la estadía reservada sobre la que opera la cancelación. Atributos
  clave: `reservationRef` (referencia de reserva), `guestList` (lista de huéspedes),
  `assignedRoom` (habitación o tipo de habitación asignada, si existe), `startDate` y `endDate`
  (fecha de inicio y fin de estadía), `source` (origen de la reserva: `DIRECT` | `OTA`; determina
  si es elegible para cancelación vía el canal de la Ota), y `status` con valores posibles:
  `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Se valida mediante "Check/View
  Reservation" y esta funcionalidad solo permite su transición desde `PENDING` o `ACTIVE` hacia
  `CANCELLED`.
- **Room**: Representa la unidad física que estaba asignada a la reserva cancelada. Atributos
  clave: `roomId` (identificador de habitación), `roomType` (tipo de habitación), y `status`
  (subconjunto relevante para esta funcionalidad: `AVAILABLE`, `OCCUPIED`, `CLEANING`,
  `OUT_OF_SERVICE`). El estado físico de `Room` es propiedad del Módulo 1 y se solicita cambiar a
  `AVAILABLE` como resultado de una `Cancellation` exitosa sobre una reserva que tenía habitación
  asignada, sin importar el canal que ejecutó la cancelación.
- **Guest**: Representa al huésped titular de la reserva cancelada. Atributos clave: `fullName`
  (nombre completo), `documentId` (documento de identidad), `nationality` (nacionalidad), y `type`
  (clasificación: `NATIONAL` | `FOREIGN`). En el canal de Usuario, el sistema usa esta referencia
  para verificar que quien solicita la cancelación es el titular de la reserva.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de las cancelaciones finalizadas quedan registradas de forma consistente con
  su canal de origen (`channel`) mapeado correctamente entre Recepción, Usuario u Ota.
- **SC-002**: El 100% de las reservas canceladas con habitación física asignada liberan
  exitosamente su espacio, reflejando el estado `AVAILABLE` en el Módulo 1 en menos de 1 minuto,
  sin importar el canal de origen.
- **SC-003**: Cero excepciones técnicas o fallas de base de datos se propagan como errores de
  infraestructura **HTTP 500** durante validaciones de fechas o de datos vacíos, en ninguno de los
  tres canales.
- **SC-004**: El 100% de las cancelaciones procesadas vía la API de la Ota corresponden a reservas
  cuyo `source` es `OTA`; cero cancelaciones vía API se aplican sobre reservas de origen distinto.
- **SC-005**: El 100% de las cancelaciones completadas por el canal de Usuario generan y entregan
  correctamente el correo electrónico de confirmación con el detalle de la penalidad y el
  reembolso.
- **SC-006**: Un Recepcionista puede completar una cancelación presencial estándar sin penalidad,
  desde ubicar la reserva hasta la solicitud de liberación de la habitación, en menos de 1 minuto.
- **SC-007**: El 100% de los errores de validación de entrada (campos vacíos, fechas inválidas,
  montos negativos, caracteres no permitidos) se responden con **HTTP 400** y un mensaje amigable
  o una respuesta estructurada según el canal; cero errores de este tipo se propagan como
  **HTTP 500**.
- **SC-008**: El 100% de las cancelaciones registradas con `liquidationStatus` en
  `PENDING_LIQUIDATION` por una caída del Módulo 3 quedan liquidadas correctamente dentro de las
  24 horas siguientes, sin pérdida de ningún registro de cancelación.
