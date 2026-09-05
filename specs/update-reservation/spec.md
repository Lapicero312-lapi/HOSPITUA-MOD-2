# Especificación de Funcionalidad: Actualizar Reservación

**Creado**: 2026-09-05

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Actualizar Reservación permite modificar una reserva ya existente a través de
**tres canales distintos**, cada uno con sus propias reglas de negocio: la **Recepcionista** desde
la consola interna de recepción, el **Usuario** (el huésped autogestionado) desde el portal o la
aplicación de autogestión, y la **Ota** mediante integración asíncrona de sistema a sistema. Los
tres canales comparten el mismo caso de uso de negocio y las mismas validaciones internas, por lo
que no se modelan como historias de usuario independientes sino como variantes de la misma
historia:

- Antes de editar, el sistema debe ubicar y validar la reserva mediante el caso de uso interno
  **"Check/View Reservation"** (Consultar / Ver Reserva), sin importar el canal de origen de la
  solicitud.
- Cuando el cambio solicitado afecta las fechas de estadía o el tipo de habitación, el sistema
  debe verificar la disponibilidad física con el **Módulo 1** y ejecutar el caso de uso interno
  **"Procesar liquidación y validación"** (Módulo 3) para recalcular la tarifa correspondiente
  antes de poder confirmar el cambio, sin importar el canal de origen.
- Antes de finalizar un cambio de fechas u habitación, el sistema presenta un resumen con la
  tarifa anterior, la nueva tarifa y la diferencia resultante para confirmación explícita del
  solicitante; esto es un paso dentro del mismo flujo, no una historia aparte.
- Cuando el cambio solicitado solo afecta los datos personales del huésped o de sus acompañantes,
  el sistema no requiere recalcular la tarifa ni consultar disponibilidad con el Módulo 1; esto es
  igualmente un paso o escenario del mismo flujo, no una historia aparte.
- El canal de Usuario tiene una restricción adicional que no aplica a los otros dos canales: un
  Usuario solo puede actualizar la reserva de la cual es titular, y únicamente mientras esa
  reserva no haya alcanzado el estado `CHECKED_IN`; una vez hospedado, cualquier cambio debe
  solicitarse directamente en recepción.

**Estados de la entidad `Reservation`** (deben usarse exactamente estos valores en todo el
sistema): `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Esta funcionalidad no
permite editar una reserva cuyo estado sea `CHECKED_OUT` o `CANCELLED`, y restringe además la
edición por el canal de Usuario a reservas que aún no estén en estado `CHECKED_IN`.

**Estados de la entidad `Room`** relevantes para esta funcionalidad (el estado físico completo es
propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

### Historia de Usuario 1 - Actualización de una Reservación (Prioridad: P1)

Un solicitante —que puede ser la Recepcionista, el Usuario titular de la reserva, o la Ota que la
originó— necesita modificar una reserva existente: puede tratarse de un cambio en las fechas de
estadía o en el tipo de habitación, o de una corrección en los datos personales del huésped
titular o de sus acompañantes. El solicitante ubica la reserva y, si el cambio afecta fechas o
habitación, el sistema verifica disponibilidad con el Módulo 1 y recalcula la tarifa con el
Módulo 3 antes de confirmar, sin importar el canal de origen; si el cambio solo afecta datos
personales, el sistema lo aplica directamente sin recotizar. El canal de Usuario opera bajo una
regla adicional: solo puede modificar la reserva de la que es titular, y únicamente mientras esta
no haya alcanzado el estado `CHECKED_IN`. Esta historia es el flujo maestro de la funcionalidad:
en una sola interacción cubre tanto los caminos exitosos (recálculo de tarifa, y edición de datos
personales) como el paso operativo de confirmación de la diferencia tarifaria, y los caminos de
error que impiden una actualización inválida (reserva `CANCELLED` o `CHECKED_OUT`, fechas sin
disponibilidad, o un Usuario intentando modificar una reserva ya hospedada).

**Por qué esta prioridad**: Es el flujo principal y único de la funcionalidad de actualización.
Todos sus escenarios de éxito, operativos y de error ocurren en la misma pantalla y sobre la misma
operación de negocio, por lo que no se modelan como historias adicionales: separarlos
fragmentaría de forma artificial una única unidad de valor, incurriendo en la sobre-separación que
debe evitarse. Sin esta historia, cualquier cambio de fechas, habitación o datos del huésped
tendría que gestionarse de forma manual y fuera del sistema, generando descuadres entre lo cobrado
y la tarifa real de la estadía, además de riesgo de sobreventa si la disponibilidad no se revalida
contra el Módulo 1. Por sí sola entrega un MVP utilizable: el hotel puede reflejar cualquier
cambio de reserva sin perder trazabilidad financiera ni de inventario.

**Prueba Independiente**: Se puede probar de forma completa tomando una reserva `ACTIVE`,
modificando su fecha de salida o su tipo de habitación desde cualquiera de los tres canales, y
verificando que el sistema solicita una nueva cotización, muestra la diferencia financiera
resultante, y solo aplica el cambio tras la confirmación explícita. La misma prueba se completa
modificando únicamente los datos personales del huésped o de un acompañante, confirmando que no se
dispara ninguna recotización ni consulta de disponibilidad. Se completa además intentando
modificar una reserva `CANCELLED`, una `CHECKED_OUT`, y una cuyas nuevas fechas no tienen
disponibilidad en el Módulo 1, confirmando que los tres intentos se bloquean con una razón clara y
sin alterar la reserva original. Finalmente, se completa intentando modificar, desde el portal de
Usuario, una reserva que ya está en estado `CHECKED_IN`, confirmando que el sistema la bloquea
localmente e indica que el cambio debe solicitarse en recepción. Entrega el valor de una reserva
siempre actualizada, correctamente tarifada y protegida contra cambios inválidos sin importar el
canal de origen.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Actualización de fechas o tipo de habitación con recálculo exitoso
   - **Dado** una reserva en estado `ACTIVE` con una habitación disponible confirmada en el
     Módulo 1 para el nuevo rango de fechas solicitado
   - **Cuando** el solicitante (Recepcionista, Usuario o Ota) modifica las fechas de estadía o el
     tipo de habitación y solicita guardar el cambio
   - **Entonces** el sistema solicita la cotización al Módulo 3 mediante "Procesar liquidación y
     validación", actualiza la reserva con los nuevos valores, y muestra el resumen de la
     diferencia financiera (a favor o en contra) antes de completar la operación

2. **Escenario**: Modificación exclusiva de datos personales sin afectación financiera
   - **Dado** una reserva existente con datos personales del huésped titular o de sus
     acompañantes
   - **Cuando** el solicitante (Recepcionista, Usuario o Ota) corrige un dato personal del
     huésped, o agrega o elimina un acompañante, sin modificar fechas ni habitación
   - **Entonces** el sistema persiste la información del `Guest` y de la lista de huéspedes de la
     `Reservation` sin recalcular tarifa, sin consultar disponibilidad en el Módulo 1, y sin
     alterar el estado financiero de la reserva

*Escenarios de Flujo Operativo*

3. **Escenario**: Confirmación explícita de la diferencia tarifaria en pantalla
   - **Dado** que el sistema ya calculó una nueva tarifa distinta a la tarifa vigente de la
     reserva, y el canal de origen cuenta con una interfaz interactiva (Recepcionista o Usuario)
   - **Cuando** el solicitante revisa el resumen con la tarifa anterior, la nueva tarifa y la
     diferencia resultante
   - **Entonces** el sistema solo persiste el cambio de fechas o de habitación sobre la
     `Reservation` después de la confirmación explícita del solicitante, sin aplicar la
     actualización de forma automática; para el canal de la Ota, esta confirmación viene implícita
     en la propia solicitud recibida por la API, sin pantalla intermedia

*Escenarios de Error / Casos Espejo (Caminos Tristes)*

4. **Escenario**: Intento de modificar una reserva cancelada o ya cerrada
   - **Dado** una reserva en estado `CANCELLED` o en estado `CHECKED_OUT`
   - **Cuando** el solicitante (Recepcionista, Usuario o Ota) intenta modificar sus fechas, su
     habitación o sus datos personales
   - **Entonces** el sistema rechaza la edición, indica que la reserva no admite modificaciones en
     su estado actual, y no altera ningún dato de la reserva

5. **Escenario**: Intento de modificar fechas sin disponibilidad en el Módulo 1
   - **Dado** una reserva `ACTIVE` para la que el solicitante pide un nuevo rango de fechas o un
     nuevo tipo de habitación
   - **Cuando** el Módulo 1 responde que no existe disponibilidad para esa combinación
   - **Entonces** el sistema rechaza el cambio, informa que no hay disponibilidad para las fechas
     u habitación solicitadas, y mantiene la reserva con sus fechas y habitación originales

6. **Escenario**: Intento de modificación por parte de un Usuario sobre una reserva ya hospedada
   - **Dado** un Usuario autenticado en el portal web con una reserva de la cual es titular, ya en
     estado `CHECKED_IN`
   - **Cuando** el Usuario intenta modificar las fechas o la habitación desde su portal
   - **Entonces** el sistema bloquea la operación localmente, le indica que debe solicitar el
     cambio directamente en la recepción del hotel, y no altera la reserva

### Casos Borde

- **Campo obligatorio vacío o ausente**: si el solicitante, sin importar el canal, intenta enviar
  la actualización sin una referencia de reserva válida, el sistema debe interceptar la validación
  y responder con un código **HTTP 400 (Bad Request)** controlado, indicando de forma amigable qué
  dato falta, sin exponer errores de infraestructura (HTTP 500).
- **¿Qué sucede cuando se intenta modificar una habitación y el Módulo 1 reporta que no hay
  disponibilidad para las nuevas fechas?**: el sistema rechaza el cambio con **HTTP 400** y un
  mensaje claro, sin aplicar ninguna modificación sobre la reserva original.
- **¿Cómo maneja el sistema una fecha de estadía vacía, con formato inválido, o inexistente (por
  ejemplo, una fecha de salida anterior a la de llegada)?**: el sistema rechaza la operación con
  **HTTP 400** y un mensaje claro, sin dejar que la excepción se propague como un error de
  servidor.
- **¿Cómo maneja el sistema caracteres inválidos o potencialmente maliciosos en un campo de texto
  libre (nombre del huésped, documento de identidad)?**: el sistema debe interceptar y rechazar la
  entrada con **HTTP 400** y un mensaje amigable, en lugar de procesarla o dejar que provoque un
  fallo interno.
- **¿Qué sucede cuando el solicitante intenta modificar una reserva que ya tiene estado
  `CHECKED_OUT` o `CANCELLED`?**: el sistema bloquea la edición, indica que la reserva no admite
  modificaciones en su estado actual, y no altera ningún dato de la reserva.
- **¿Cómo maneja el sistema una caída o un error del Módulo 3 (Pricing) durante el cálculo de la
  nueva tarifa?**: el sistema no completa la actualización ni asume un monto por defecto; informa
  al solicitante que debe reintentar el cálculo antes de continuar, sin propagar un error de
  infraestructura al usuario.
- **¿Qué sucede cuando un Usuario intenta modificar una reserva de la cual no es titular?**: el
  sistema rechaza la operación con **HTTP 400**, sin revelar información de la reserva ajena, ya
  que el canal de Usuario solo tiene autorización sobre su propia reserva.

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE permitir al solicitante autorizado, sin importar el canal
  correspondiente (Recepcionista, Usuario u Ota), buscar y consultar la reserva por su ID o por el
  documento del huésped antes de editarla.
- **FR-002**: El sistema DEBE validar que la reserva no esté en estado `CHECKED_OUT` ni
  `CANCELLED` para habilitar su edición.
- **FR-003**: El sistema DEBE consultar al Módulo 1 la disponibilidad de habitaciones físicas
  antes de confirmar cualquier cambio de fechas o de tipo de habitación.
- **FR-004**: El sistema DEBE enviar una solicitud al Módulo 3 para procesar la liquidación y
  validación de la tarifa cuando la actualización altera fechas o tipo de habitación.
- **FR-005**: El sistema DEBE reflejar en la reserva cualquier saldo a favor o en contra derivado
  de la recotización.
- **FR-006**: El sistema DEBE permitir al solicitante autorizado modificar los datos personales del
  huésped titular y la lista de acompañantes sin exigir disponibilidad ni recotización, siempre
  que el cambio no afecte fechas ni habitación.
- **FR-007**: Para los canales con interfaz interactiva (Recepcionista y Usuario), el sistema DEBE
  presentar un resumen de confirmación (tarifa anterior, tarifa nueva y diferencia) antes de
  aplicar cualquier cambio de fechas o de tipo de habitación, y no debe persistir el cambio hasta
  que el solicitante confirme explícitamente; para el canal de la Ota, la confirmación se
  considera implícita en la propia solicitud recibida por la API.
- **FR-008**: El sistema NO DEBE aplicar ningún cambio de fechas o de habitación cuando el Módulo
  1 reporte que no existe disponibilidad para el nuevo rango solicitado.
- **FR-009**: El sistema NO DEBE completar una actualización que dependa de una recotización si el
  Módulo 3 falla o no responde, y DEBE permitir al solicitante reintentar el cálculo.
- **FR-010**: El sistema DEBE interceptar cualquier error de validación de entrada (campos vacíos,
  fechas inválidas, caracteres no permitidos) y responder con un código **HTTP 400 (Bad Request)**
  controlado y un mensaje amigable para el usuario; el sistema NO DEBE permitir que estos errores
  se propaguen como fallas de infraestructura (**HTTP 500**).
- **FR-011**: El sistema DEBE mantener un registro auditable de cada actualización aplicada a una
  reserva, incluyendo los intentos bloqueados o fallidos y la razón del bloqueo.
- **FR-012**: El sistema DEBE comunicar con claridad, en cada caso de rechazo, exactamente qué
  dato falta o es inválido, adaptando el formato del mensaje al canal correspondiente: en pantalla
  para Recepcionista y Usuario, y como una respuesta estructurada para la integración de la Ota.
- **FR-013**: El sistema DEBE permitir al canal de Usuario actualizar exclusivamente la reserva de
  la cual es titular, rechazando cualquier intento de modificar una reserva ajena.
- **FR-014**: El sistema DEBE rechazar cualquier intento de actualización proveniente del canal de
  Usuario cuando la reserva ya haya alcanzado el estado `CHECKED_IN`, indicando que el cambio debe
  solicitarse directamente en recepción.

### Requisitos No Funcionales

- **NFR-001**: El sistema DEBE controlar la concurrencia, impidiendo que dos solicitantes —sin
  importar su canal— actualicen la misma reservación de forma simultánea.
- **NFR-002**: El tiempo de respuesta del cálculo de la tarifa dinámica integrado con el Módulo 3
  DEBE ser menor a 3 segundos bajo condiciones normales.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Reservation**: Representa la estadía reservada sobre la que opera la actualización. Atributos
  clave: `reservationRef` (referencia de reserva), `guestList` (lista de huéspedes),
  `assignedRoom` (habitación o tipo de habitación asignada), `startDate` y `endDate` (fecha de
  inicio y fin de estadía), `source` (origen: directa u OTA), y `status` con valores posibles:
  `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Se localiza mediante "Check/View
  Reservation" y solo admite actualización cuando su `status` es distinto de `CHECKED_OUT` y de
  `CANCELLED`; para el canal de Usuario, la actualización solo se admite además cuando su `status`
  todavía no es `CHECKED_IN`.
- **Room**: Representa la unidad física que se solicita mantener o reasignar en la actualización.
  Atributos clave: `roomId` (identificador de habitación), `roomType` (tipo de habitación), y
  `status` (subconjunto relevante para esta funcionalidad: `AVAILABLE`, `OCCUPIED`, `CLEANING`,
  `OUT_OF_SERVICE`). El estado físico y la disponibilidad de `Room` son propiedad del Módulo 1 y
  se consultan antes de confirmar cualquier cambio de fechas o de tipo de habitación.
- **RateQuote**: Representa el resultado de la recotización ejecutada mediante "Procesar
  liquidación y validación" (Módulo 3) cuando la actualización afecta fechas o tipo de habitación.
  Atributos clave: `reservationRef` (referencia a la `Reservation`), `previousAmount` (monto
  vigente antes del cambio), `totalAmount` (monto recalculado tras el cambio), `amountDifference`
  (diferencia a favor o en contra del huésped), y `calculatedAt` (momento del cálculo). Es
  obligatoria antes de poder confirmar cualquier actualización que altere fechas o habitación.
- **Guest**: Representa al huésped titular o a un acompañante vinculado a la reserva. Atributos
  clave: `fullName` (nombre completo), `documentId` (documento de identidad), `nationality`
  (nacionalidad), y `type` (clasificación: `NATIONAL` | `FOREIGN`). Sus datos pueden actualizarse
  de forma independiente a las fechas, la habitación o la tarifa de la `Reservation` a la que
  pertenece. En el canal de Usuario, el sistema usa esta referencia para verificar que quien
  solicita la actualización es el titular de la reserva.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: Un solicitante, sin importar el canal, puede completar la actualización de fechas de
  una reserva con recotización en menos de 1.5 minutos.
- **SC-002**: El 100% de los intentos de modificación sobre reservas `CHECKED_OUT` o `CANCELLED`
  son rechazados de forma controlada con un error **HTTP 400** amigable, sin fallas de
  infraestructura **HTTP 500**.
- **SC-003**: El 100% de las actualizaciones de fechas u habitación completadas tienen un
  `RateQuote` asociado calculado antes de la confirmación; ninguna actualización financiera se
  aplica sin recotización previa.
- **SC-004**: Cero actualizaciones de fechas u habitación se confirman contra una habitación sin
  disponibilidad verificada en el Módulo 1 al momento del cambio.
- **SC-005**: Un solicitante, sin importar el canal, puede completar una modificación de datos
  personales o de acompañantes, sin afectación financiera, en menos de 1 minuto.
- **SC-006**: El 100% de los errores de validación de entrada (campos vacíos, fechas inválidas,
  caracteres no permitidos) se responden con **HTTP 400** y un mensaje amigable; cero errores de
  este tipo se propagan como **HTTP 500**.
- **SC-007**: Cero actualizaciones desde el canal de Usuario se aplican sobre una reserva de la
  cual no es titular, o que ya alcanzó el estado `CHECKED_IN`.
- **SC-008**: Los tickets de soporte relacionados con diferencias de cobro tras un cambio de
  fechas u habitación se reducen en al menos un 80% tras el uso de esta funcionalidad.
