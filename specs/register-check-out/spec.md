# Especificación de Funcionalidad: Registro de Check-Out

**Creado**: 2026-09-05

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Registro de Check-Out permite al **Recepcionista** formalizar la salida de un
huésped hospedado y liberar su habitación. Toda la interacción ocurre en una única pantalla de
check-out que agrupa los siguientes pasos y validaciones internas, por lo que estas no se modelan
como historias de usuario independientes sino como pasos o escenarios de la misma historia:

- Antes de iniciar la salida, el sistema debe ubicar y validar la reserva hospedada mediante el
  caso de uso interno **"Check/View Reservation"** (Consultar / Ver Reserva).
- El recepcionista puede registrar cargos adicionales por consumos durante la estadía (por
  ejemplo, servicio a la habitación) antes de calcular el total a pagar; esto es un paso
  dentro del mismo flujo, no una historia aparte.
- El sistema debe calcular el monto final de la estadía mediante el caso de uso externo
  **"Calculate Dynamic Rate"** (Calcular Tarifa Dinámica), propiedad del **Módulo 3**, combinando
  las fechas de estadía, la habitación y los cargos adicionales registrados.
- Antes de finalizar, el sistema presenta un resumen de la salida para confirmación explícita del
  recepcionista; esto es un paso dentro del mismo flujo, no una historia aparte.
- Una vez registrado el check-out, el sistema solicita al **Módulo 1** cambiar el estado físico de
  la habitación liberada mediante el caso de uso **"Set Room State"** (Establecer el Estado de la
  Habitación).

**Estados de la entidad `Reservation`** (deben usarse exactamente estos valores en todo el
sistema): `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `Room`** relevantes para esta funcionalidad (el estado físico completo es
propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

### Historia de Usuario 1 - Registro de Check-Out de un Huésped (Prioridad: P1)

Un recepcionista despide a un huésped cuya reserva está en estado `CHECKED_IN`. El recepcionista
busca la reserva, registra los cargos adicionales de la estadía si los hay, revisa el monto final
calculado y confirma la salida. Al finalizar, el sistema marca la reserva como `CHECKED_OUT` y
solicita al Módulo 1 poner la habitación en estado `CLEANING`.

**Por qué esta prioridad**: Es el flujo principal y de mayor frecuencia de la funcionalidad. Sin
él no es posible liberar habitaciones ni cerrar la estadía de un huésped, y todos los demás
escenarios son variaciones sobre este camino. Por sí solo entrega un MVP utilizable: el hotel
puede operar el cierre de estadías de extremo a extremo.

**Prueba Independiente**: Se puede probar de forma completa tomando una reserva `CHECKED_IN`,
ejecutando el check-out sin cargos adicionales y confirmando que la reserva pasa a `CHECKED_OUT`,
que se crea un registro de check-out con el momento real de salida, y que se emite una solicitud
para poner la habitación en limpieza. Repitiendo la prueba con cargos adicionales válidos se valida
además que el monto final calculado los incluye. Entrega el valor de un cierre de estadía completo
y auditable.

**Escenarios de Aceptación**:

1. **Escenario**: Huésped con reserva hospedada es despedido exitosamente
   - **Dado** que existe una reserva en estado `CHECKED_IN` con una habitación asignada y sin
     cargos adicionales pendientes
   - **Cuando** el recepcionista revisa el monto final calculado y confirma el check-out
   - **Entonces** el sistema registra el check-out, cambia el estado de la reserva a
     `CHECKED_OUT`, guarda el momento real de salida y el recepcionista responsable, y solicita al
     Módulo 1 cambiar el estado de la habitación a `CLEANING`

2. **Escenario**: La reserva se ubica antes de iniciar la salida
   - **Dado** que el recepcionista solo cuenta con el nombre del huésped o la referencia de la
     reserva
   - **Cuando** el recepcionista busca la reserva mediante "Check/View Reservation"
   - **Entonces** el sistema devuelve la reserva coincidente con su habitación, fechas de estadía
     y estado `CHECKED_IN`, para que el recepcionista continúe con el check-out

3. **Escenario**: Se calcula el monto final incluyendo cargos adicionales
   - **Dado** que el recepcionista registró uno o más cargos adicionales válidos durante la
     estadía
   - **Cuando** el sistema ejecuta "Calculate Dynamic Rate"
   - **Entonces** el sistema muestra el monto final como la suma de la tarifa de estadía y los
     cargos adicionales registrados, antes de permitir la confirmación

4. **Escenario**: Se muestra un resumen de confirmación antes de finalizar
   - **Dado** que el recepcionista revisó el monto final calculado para la reserva
   - **Cuando** el recepcionista solicita finalizar
   - **Entonces** el sistema presenta un resumen con huésped, habitación, fechas de estadía, cargos
     adicionales y monto final, y solo completa el check-out tras la confirmación explícita

### Historia de Usuario 2 - Bloqueo de Check-Out sin Reserva Hospedada Válida (Prioridad: P2)

El sistema no debe permitir el check-out de una reserva que no esté en estado `CHECKED_IN`. El
recepcionista debe ubicar y validar la reserva mediante "Check/View Reservation"; si la reserva no
existe o no está hospedada, la salida se rechaza.

**Por qué esta prioridad**: Es un flujo de error sobre el camino principal: protege la integridad
de los datos de ocupación y facturación ante intentos de check-out inválidos, pero el negocio ya
funciona sin él si se opera con disciplina manual.

**Prueba Independiente**: Se puede probar de forma completa intentando un check-out sin reserva
coincidente, con una reserva en estado `ACTIVE` (nunca hospedada), y con una reserva `CANCELLED`,
confirmando que cada intento se bloquea con una razón clara y que no se crea ningún registro de
check-out.

**Escenarios de Aceptación**:

1. **Escenario**: No se encuentra reserva para el huésped
   - **Dado** un huésped que solicita su salida sin ninguna reserva registrada
   - **Cuando** el recepcionista busca una reserva para iniciar el check-out
   - **Entonces** el sistema informa que no se encontró ninguna reserva hospedada y no permite
     iniciar el check-out

2. **Escenario**: La reserva existe pero nunca fue admitida
   - **Dado** una reserva en estado `ACTIVE` que aún no tiene check-in registrado
   - **Cuando** el recepcionista la selecciona para hacer el check-out
   - **Entonces** el sistema bloquea la salida, indica que la reserva no está hospedada, y no
     modifica el estado de la reserva ni de la habitación

3. **Escenario**: La reserva existe pero fue cancelada
   - **Dado** una reserva en estado `CANCELLED`
   - **Cuando** el recepcionista la selecciona para hacer el check-out
   - **Entonces** el sistema bloquea la salida, indica que la reserva está cancelada, y no
     modifica el estado de la reserva ni de la habitación

### Historia de Usuario 3 - Prevención de Check-Out Duplicado (Prioridad: P2)

Una vez que una reserva fue despedida (estado `CHECKED_OUT`), el sistema no debe permitir que se
registre un nuevo check-out sobre la misma reserva. Al recepcionista se le debe mostrar que la
reserva ya fue cerrada.

**Por qué esta prioridad**: Un segundo check-out sobre la misma reserva podría disparar una
segunda solicitud de limpieza de habitación, generar cargos adicionales duplicados y distorsionar
los reportes de facturación y ocupación.

**Prueba Independiente**: Se puede probar de forma completa haciendo el check-out de una reserva
con éxito y luego intentando el mismo check-out de nuevo, confirmando que el segundo intento es
rechazado, que no se crea un nuevo registro, y que no se envía una solicitud adicional de cambio
de estado de habitación.

**Escenarios de Aceptación**:

1. **Escenario**: Segundo intento de check-out sobre una reserva ya cerrada
   - **Dado** una reserva en estado `CHECKED_OUT` con el check-out ya registrado
   - **Cuando** el recepcionista intenta registrar el check-out nuevamente
   - **Entonces** el sistema rechaza el intento, muestra los datos del check-out existente, y no
     crea un nuevo registro ni envía otra solicitud de cambio de estado de habitación

2. **Escenario**: El recepcionista reabre una reserva cerrada solo para consultarla
   - **Dado** una reserva en estado `CHECKED_OUT`
   - **Cuando** el recepcionista la abre mediante "Check/View Reservation"
   - **Entonces** el sistema la muestra como `CHECKED_OUT` con el momento de salida y el monto
     final registrado, y solo ofrece acciones de consulta, no una nueva salida

### Historia de Usuario 4 - Check-Out Parcial en Reservas Grupales (Prioridad: P3)

Cuando una reserva grupal incluye varios huéspedes hospedados y solo algunos se retiran el mismo
día, el recepcionista puede despedir únicamente a los huéspedes que se van, dejando a los demás
hospedados sobre la misma reserva.

**Por qué esta prioridad**: Mejora la operación cuando los grupos no se retiran completos al
mismo tiempo, pero no es indispensable para que el negocio funcione: sin ella, el recepcionista
puede esperar a que todo el grupo esté listo para salir antes de iniciar el check-out.

**Prueba Independiente**: Se puede probar de forma completa registrando el check-out de dos de
tres huéspedes de una misma reserva grupal y confirmando que solo esos dos quedan despedidos, que
el tercero permanece hospedado, que la reserva se mantiene en `CHECKED_IN`, y que solo se solicita
poner en limpieza las habitaciones que quedaron completamente desocupadas.

**Escenarios de Aceptación**:

1. **Escenario**: Se despide parcialmente a un grupo
   - **Dado** una reserva grupal `CHECKED_IN` con tres huéspedes en tres habitaciones, de los
     cuales solo dos se retiran hoy
   - **Cuando** el recepcionista registra el check-out de los dos huéspedes que se retiran
   - **Entonces** el sistema los marca como despedidos, solicita al Módulo 1 poner en `CLEANING`
     únicamente las dos habitaciones que quedaron desocupadas, y mantiene la reserva en estado
     `CHECKED_IN` con el tercer huésped todavía hospedado

2. **Escenario**: Se completa el check-out del resto del grupo más tarde
   - **Dado** una reserva grupal con un huésped aún hospedado tras un check-out parcial previo
   - **Cuando** ese huésped se retira y el recepcionista registra su check-out
   - **Entonces** el sistema lo despide de forma independiente, cambia la reserva a
     `CHECKED_OUT` únicamente cuando el último huésped hospedado se ha retirado, y no afecta los
     check-outs ya realizados para el resto del grupo

### Casos Borde

- **Campo obligatorio vacío o ausente**: si el recepcionista intenta enviar el check-out sin una
  referencia de reserva o huésped válida, el sistema debe interceptar la validación y responder
  con un código **HTTP 400 (Bad Request)** controlado, indicando de forma amigable qué dato falta,
  sin exponer errores de infraestructura (HTTP 500).
- **Monto de cargo adicional con formato inválido**: si un cargo adicional se ingresa con un valor
  no numérico, negativo, o con más decimales de los permitidos, el sistema debe rechazar la
  operación con **HTTP 400** y un mensaje claro, sin incluirlo en el cálculo del monto final.
- **Caracteres inválidos o potencialmente maliciosos en texto libre**: si la descripción de un
  cargo adicional contiene caracteres extraños, símbolos no permitidos o patrones típicos de
  inyección, el sistema debe interceptar y rechazar la entrada con **HTTP 400** y un mensaje
  amigable, en lugar de procesarla o dejar que provoque un fallo interno.
- **Fecha de salida manual anterior a la fecha real de check-in**: si el recepcionista ajusta
  manualmente la fecha u hora de salida y esta resulta anterior al momento real de llegada
  registrado en el check-in, el sistema debe rechazar la operación con **HTTP 400** y un mensaje
  claro, sin crear el registro de check-out.
- **El cálculo de tarifa dinámica no está disponible**: si el Módulo 3 no responde o falla al
  ejecutar "Calculate Dynamic Rate", el sistema no debe completar el check-out ni asumir un monto
  por defecto; informa al recepcionista que debe reintentar el cálculo antes de continuar, sin
  propagar un error de infraestructura al usuario.
- **La solicitud de limpieza de habitación al Módulo 1 falla tras un check-out exitoso**: el
  check-out permanece válido y registrado; la actualización del estado de la habitación queda
  marcada como `PENDING` (en lugar de `COMPLETED`) y puede reintentarse de forma independiente,
  sin obligar a repetir la salida.
- **La habitación ya no está en un estado consistente con una salida (por ejemplo, ya está
  `OUT_OF_SERVICE`)**: el sistema completa el check-out de todas formas, ya que la reserva y el
  huésped son independientes del estado físico de la habitación, pero deja constancia de la
  incoherencia para que el Módulo 1 la revise.

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE exigir que el recepcionista ubique y valide una reserva mediante el
  caso de uso interno "Check/View Reservation" antes de poder iniciar cualquier check-out.
- **FR-002**: El sistema DEBE permitir el check-out únicamente cuando la reserva ubicada esté en
  estado `CHECKED_IN`.
- **FR-003**: El sistema DEBE permitir al recepcionista registrar cero o más cargos adicionales
  por consumos de la estadía, cada uno con una descripción y un monto.
- **FR-004**: El sistema DEBE validar que el monto de cada cargo adicional sea numérico y no
  negativo antes de incluirlo en cualquier cálculo.
- **FR-005**: El sistema DEBE calcular el monto final de la estadía mediante el caso de uso
  externo "Calculate Dynamic Rate" (Módulo 3), combinando la tarifa de la estadía y los cargos
  adicionales válidos registrados.
- **FR-006**: El sistema NO DEBE completar el check-out si "Calculate Dynamic Rate" falla o no
  está disponible, y DEBE permitir al recepcionista reintentar el cálculo.
- **FR-007**: El sistema DEBE registrar el check-out solo después de que el recepcionista confirme
  explícitamente un resumen con huésped, habitación, fechas de estadía, cargos adicionales y monto
  final.
- **FR-008**: El sistema DEBE, al completar un check-out con éxito, registrar el momento real de
  salida, el recepcionista responsable y el monto final, y cambiar el estado de la reserva a
  `CHECKED_OUT`.
- **FR-009**: El sistema DEBE, al completar un check-out con éxito, solicitar al Módulo 1 cambiar
  el estado físico de la habitación liberada a `CLEANING` mediante el caso de uso "Set Room
  State".
- **FR-010**: El sistema DEBE mantener válido un check-out ya completado aunque la solicitud de
  cambio de estado de habitación al Módulo 1 falle, marcando esa actualización como `PENDING` y
  permitiendo reintentarla sin repetir la salida.
- **FR-011**: El sistema DEBE rechazar cualquier intento de check-out sobre una reserva que no
  esté en estado `CHECKED_IN` (por ejemplo, `ACTIVE`, `CANCELLED` o `PENDING`), indicando la razón
  sin crear ningún registro ni efecto colateral.
- **FR-012**: El sistema DEBE rechazar cualquier intento de check-out sobre una reserva que ya
  esté en estado `CHECKED_OUT`, mostrando el registro de salida existente en lugar de crear uno
  nuevo.
- **FR-013**: El sistema DEBE permitir el check-out parcial de una reserva grupal, despidiendo
  solo a los huéspedes que se retiran y manteniendo hospedados a los demás sobre la misma reserva,
  la cual solo cambia a `CHECKED_OUT` cuando el último huésped hospedado se ha retirado.
- **FR-014**: El sistema DEBE, en un check-out parcial, solicitar al Módulo 1 el cambio de estado
  únicamente de las habitaciones que quedaron completamente desocupadas.
- **FR-015**: El sistema DEBE rechazar una fecha u hora de salida manual que sea anterior al
  momento real de llegada registrado en el check-in correspondiente.
- **FR-016**: El sistema DEBE interceptar cualquier error de validación de entrada (campos vacíos,
  montos o fechas inválidas, caracteres no permitidos) y responder con un código **HTTP 400 (Bad
  Request)** controlado y un mensaje amigable para el usuario; el sistema NO DEBE permitir que
  estos errores se propaguen como fallas de infraestructura (**HTTP 500**).
- **FR-017**: El sistema DEBE mantener un registro auditable de cada intento de check-out,
  incluyendo los intentos bloqueados o fallidos y la razón del bloqueo.
- **FR-018**: El sistema DEBE comunicar con claridad, en cada caso de rechazo, exactamente qué
  dato falta o es inválido para que el recepcionista pueda corregirlo.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **CheckOut**: Representa el cierre formal de la estadía de uno o más huéspedes de una reserva.
  Atributos clave: `reservationRef` (referencia a la `Reservation`), `guests` (huéspedes
  despedidos), `room` (habitación liberada), `departureTime` (momento real de salida),
  `receptionist` (recepcionista responsable), `extraCharges` (lista de cargos adicionales, cada
  uno con descripción y monto), `finalAmount` (monto final calculado), `status` (`COMPLETED`,
  único valor que esta funcionalidad asigna), y `roomStateRequestStatus` (`PENDING` |
  `COMPLETED`). Un `CheckOut` pertenece a exactamente una `Reservation` y cubre uno o más `Guest`
  hospedados de esa reserva.
- **Reservation**: Representa la estadía sobre la que opera el check-out. Atributos clave:
  `reservationRef` (referencia de reserva), `guestList` (lista de huéspedes), `assignedRoom`
  (habitación asignada), `startDate` y `endDate` (fecha de inicio y fin de estadía), `source`
  (origen: directa u OTA), y `status` con valores posibles: `PENDING`, `ACTIVE`, `CHECKED_IN`,
  `CHECKED_OUT`, `CANCELLED`. Se valida mediante "Check/View Reservation" y solo puede pasar a
  `CHECKED_OUT` cuando todos sus huéspedes fueron despedidos.
- **Guest**: Representa a una persona hospedada en el hotel. Atributos clave: `fullName` (nombre
  completo), `documentId` (documento de identidad), `nationality` (nacionalidad), y `type`
  (clasificación: `NATIONAL` | `FOREIGN`). Un `Guest` está vinculado a una o más `Reservation` y,
  a través de ellas, a un `CheckOut`.
- **Room**: Representa la unidad física ocupada por el huésped. Atributos clave: `roomId`
  (identificador de habitación), `roomType` (tipo de habitación), y `status` (subconjunto
  relevante para esta funcionalidad: `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`). El
  estado físico de `Room` es propiedad del Módulo 1 y se solicita cambiar a `CLEANING` como
  resultado de un `CheckOut` exitoso.
- **RateQuote**: Representa el resultado del cálculo de tarifa final ejecutado mediante "Calculate
  Dynamic Rate" (Módulo 3). Atributos clave: `reservationRef` (referencia a la `Reservation`),
  `baseAmount` (monto base de la estadía), `extraChargesAmount` (suma de los cargos adicionales
  válidos), `totalAmount` (monto final: base más adicionales), y `calculatedAt` (momento del
  cálculo). Es obligatoria para cada `CheckOut` antes de que pueda completarse, y queda asociada
  al `CheckOut` resultante como su `finalAmount`.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de los check-outs completados están vinculados a una reserva que estaba en
  estado `CHECKED_IN`; nunca se registra un check-out sin una reserva hospedada válida.
- **SC-002**: El 100% de los check-outs completados tienen un `RateQuote` con `totalAmount`
  calculado mediante "Calculate Dynamic Rate" antes de la confirmación.
- **SC-003**: El 100% de los check-outs exitosos generan una solicitud de limpieza al Módulo 1, y
  al menos el 99% de las habitaciones liberadas muestran `CLEANING` dentro del minuto siguiente a
  la finalización del check-out.
- **SC-004**: Cero registros de check-out duplicados existen para cualquier reserva individual en
  cualquier periodo de reporte.
- **SC-005**: Un recepcionista puede completar un check-out estándar sin cargos adicionales, desde
  ubicar la reserva hasta la solicitud de limpieza de la habitación, en menos de 2 minutos.
- **SC-006**: El 95% de los intentos de check-out bloqueados o fallidos se resuelven en la primera
  corrección del recepcionista, porque el sistema indicó con exactitud qué dato faltaba o era
  inválido.
- **SC-007**: El 100% de los errores de validación de entrada (campos vacíos, montos o fechas
  inválidas, caracteres no permitidos) se responden con **HTTP 400** y un mensaje amigable; cero
  errores de este tipo se propagan como **HTTP 500**.
- **SC-008**: Los tickets de soporte y correcciones manuales relacionados con montos de facturación
  incorrectos al momento de la salida se reducen en al menos un 80% tras el uso de esta
  funcionalidad.
