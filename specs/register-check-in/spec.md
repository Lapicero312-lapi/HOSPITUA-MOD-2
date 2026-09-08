# Especificación de Funcionalidad: Registro de Check-In

**Creado**: 2026-08-27

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Registro de Check-In permite al **Recepcionista** admitir formalmente a un
huésped en el hotel el día de su llegada. Toda la interacción ocurre en una única pantalla de
check-in que agrupa los siguientes pasos y validaciones internas, por lo que estas no se modelan
como historias de usuario independientes sino como pasos o escenarios de la misma historia:

- Antes de admitir a nadie, el sistema debe ubicar y validar una reserva activa mediante el caso
  de uso interno **"Check/View Reservation"** (Consultar / Ver Reserva).
- Cuando el huésped que llega es extranjero, el sistema debe completar adicionalmente el
  procesamiento de sus datos migratorios mediante el caso de uso interno **"Process Foreign Guest
  Data"** (Procesar Datos de Huéspedes Extranjeros) antes de poder confirmar el check-in. Este
  procesamiento únicamente valida y almacena localmente los datos migratorios del huésped en la
  base de datos; el check-in **no** dispara, programa ni depende en ninguna forma del envío de
  reportes al actor externo **Migración**. El caso de uso **"Export SIRE File"** (Exportar Archivo
  SIRE) es una funcionalidad completamente independiente y desacoplada, exclusiva del actor
  **Migración**, y está totalmente fuera del alcance de esta funcionalidad de check-in.
- Antes de finalizar, el sistema presenta un resumen de la reserva para confirmación explícita del
  recepcionista; esto es un paso dentro del mismo flujo, no una historia aparte.
- Una vez registrado el check-in, el sistema solicita al **Módulo 1** cambiar el estado físico de
  la habitación asignada mediante el caso de uso **"Set Room State"** (Establecer el Estado de la
  Habitación).

**Estados de la entidad `Reservation`** (deben usarse exactamente estos valores en todo el
sistema): `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `Room`** relevantes para esta funcionalidad (el estado físico completo es
propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

### Historia de Usuario 1 - Registro de Check-In de un Huésped (Prioridad: P)
Un recepcionista recibe a un huésped cuya reserva está en estado `ACTIVE` y cuyas fechas de
estadía incluyen el día de hoy. El recepcionista ubica la reserva, confirma la identidad y los
datos del huésped, y registra el check-in; si el huésped es extranjero, el sistema procesa
adicionalmente sus datos migratorios antes de confirmar. Esta historia es el flujo maestro de la
funcionalidad: en una sola pantalla cubre tanto el camino exitoso (huésped nacional o extranjero,
cada uno con su resumen de confirmación en pantalla antes de persistir el check-in) como el paso
operativo de apoyo (búsqueda de la reserva) y los caminos de error que impiden una admisión
inválida o duplicada (reserva no encontrada, cancelada, fuera de la ventana de estadía, o ya
realizada). Al finalizar con éxito, el sistema marca la reserva como `CHECKED_IN` y solicita al
Módulo 1 poner la habitación en estado `OCCUPIED`.

**Por qué esta prioridad**: Es el flujo principal y único de la funcionalidad de check-in. Sus
escenarios de éxito, operativos y de error ocurren todos en la misma pantalla y sobre la misma
operación de negocio, por lo que no se modelan como historias adicionales: separarlos
fragmentaría de forma artificial una única unidad de valor, incurriendo en la sobre-separación que
debe evitarse. Por sí sola esta historia entrega un MVP utilizable: el hotel puede operar su
recepción de llegadas de extremo a extremo, incluyendo el rechazo controlado de intentos
inválidos o repetidos.

**Prueba Independiente**: Se puede probar de forma completa tomando una reserva `ACTIVE` cuya
estadía incluya la fecha de hoy, ejecutando el check-in de un huésped nacional y de un huésped
extranjero con datos migratorios completos, y confirmando en ambos casos que la reserva pasa a
`CHECKED_IN` y que se emite una solicitud de ocupación de la habitación. La misma prueba se
completa intentando el check-in sobre una reserva inexistente, una `CANCELLED`, una cuya estadía
aún no inicia (llegada anticipada, bloqueada con **HTTP 400** e indicación de actualizar la
reserva), una cuya estadía ya finalizó, y una ya `CHECKED_IN`, confirmando que los cinco intentos
se bloquean con una razón clara y sin crear ningún registro ni efecto colateral. Entrega el valor
de una admisión completa, auditable y protegida contra datos inválidos o duplicados.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Huésped nacional con reserva activa válida es admitido
   - **Dado** que existe una reserva en estado `ACTIVE` para un huésped nacional cuya estadía
     incluye la fecha de hoy y tiene una habitación asignada
   - **Cuando** el recepcionista confirma la identidad y los datos personales del huésped y envía
     el check-in
   - **Entonces** el sistema presenta primero un resumen en pantalla con el huésped, la habitación
     asignada, las fechas de estadía y la referencia de la reserva; solo al recibir la confirmación
     explícita del recepcionista el check-in se completa y persiste, cambiando el estado de la
     reserva a `CHECKED_IN`, guardando el momento real de llegada y el recepcionista responsable, y
     solicitando al Módulo 1 cambiar el estado de la habitación a `OCCUPIED`

2. **Escenario**: Huésped extranjero con datos migratorios completos es admitido
   - **Dado** que una reserva `ACTIVE` para un huésped extranjero incluye documento de identidad,
     nacionalidad, tipo de visa y fechas de estadía, todos válidos
   - **Cuando** el recepcionista envía el check-in
   - **Entonces** el sistema ejecuta "Process Foreign Guest Data", y si resulta `PASSED`, presenta
     un resumen en pantalla con el huésped, la habitación asignada, las fechas de estadía y la
     referencia de la reserva; solo al recibir la confirmación explícita del recepcionista el
     check-in se completa y persiste, cambiando el estado de la reserva a `CHECKED_IN`, guardando
     los datos migratorios validados localmente en la base de datos, y solicitando al Módulo 1
     cambiar el estado de la habitación a `OCCUPIED` — la exportación de estos datos hacia
     Migración es un caso de uso independiente y exclusivo del actor Migración, completamente
     fuera del alcance de esta historia

*Escenarios de Flujo Operativo*

3. **Escenario**: La reserva se ubica antes de la admisión
   - **Dado** que el recepcionista solo cuenta con el nombre del huésped y la referencia de la
     reserva
   - **Cuando** el recepcionista busca la reserva mediante "Check/View Reservation"
   - **Entonces** el sistema devuelve la reserva coincidente con sus fechas de estadía, habitación,
     lista de huéspedes y estado actual, para que el recepcionista continúe con el check-in

*Escenarios de Error / Casos Espejo (Caminos Tristes)*

4. **Escenario**: No se encuentra reserva para el huésped
   - **Dado** un huésped que llega a recepción sin ninguna reserva registrada
   - **Cuando** el recepcionista busca una reserva para iniciar el check-in
   - **Entonces** el sistema informa que no se encontró ninguna reserva activa y no permite
     iniciar el check-in

5. **Escenario**: La reserva existe pero ya fue cancelada
   - **Dado** una reserva en estado `CANCELLED`
   - **Cuando** el recepcionista la selecciona para hacer el check-in del huésped
   - **Entonces** el sistema bloquea la admisión, indica que la reserva está cancelada, y no
     modifica el estado de la reserva ni de la habitación

6. **Escenario**: Llegada anticipada — la reserva aún no alcanza su fecha de inicio de estadía
   - **Dado** una reserva en estado `ACTIVE` o `PENDING` cuya fecha de inicio de estadía es
     posterior a la de hoy (por ejemplo, comienza mañana)
   - **Cuando** el solicitante intenta registrar el check-in hoy, antes de la fecha de llegada
     permitida por la reserva
   - **Entonces** el sistema bloquea la transacción con un error controlado **HTTP 400**, le indica
     al solicitante que primero debe actualizar la fecha de la reserva mediante la pantalla de
     "Actualizar Reservación" antes de poder hospedar al huésped, y no crea ningún registro de
     check-in ni modifica el estado de la reserva o de la habitación; esta restricción aplica sin
     importar si existe disponibilidad de habitación

7. **Escenario**: Llegada tardía — la estadía reservada ya finalizó
   - **Dado** una reserva cuya fecha de fin de estadía ya pasó
   - **Cuando** el recepcionista intenta hacer el check-in hoy
   - **Entonces** el sistema rechaza el check-in con **HTTP 400** y explica que la fecha de hoy
     está fuera de la ventana de estadía reservada

8. **Escenario**: Check-in ya realizado sobre la misma reserva
   - **Dado** una reserva en estado `CHECKED_IN` con el huésped ya hospedado
   - **Cuando** el recepcionista intenta registrar el check-in nuevamente
   - **Entonces** el sistema rechaza el intento, muestra los datos del check-in existente, y no
     crea un nuevo registro ni envía otra solicitud de cambio de estado de habitación

### Historia de Usuario 2 - Check-In Parcial en Reservas Grupales (Prioridad: P3)

Cuando una reserva grupal incluye varios huéspedes y solo algunos llegan el día previsto, el
recepcionista puede admitir únicamente a los huéspedes presentes, dejando a los demás en estado
pendiente sobre la misma reserva.

**Por qué esta prioridad**: Mejora la operación cuando los grupos no llegan completos al mismo
tiempo, pero no es indispensable para que el negocio funcione: sin ella, el recepcionista puede
esperar a que llegue todo el grupo antes de iniciar el check-in.

**Prueba Independiente**: Se puede probar de forma completa registrando el check-in de dos de
tres huéspedes de una misma reserva grupal y confirmando que solo esos dos quedan admitidos, que
el tercero permanece pendiente, y que solo se solicita la ocupación de las habitaciones que ya
tienen un huésped hospedado.

**Escenarios de Aceptación**:

1. **Escenario**: Se admite parcialmente a un grupo
   - **Dado** una reserva grupal `ACTIVE` con tres huéspedes y tres habitaciones asignadas, de los
     cuales solo dos huéspedes se presentan hoy
   - **Cuando** el recepcionista registra el check-in de los dos huéspedes presentes
   - **Entonces** el sistema los marca como hospedados, solicita al Módulo 1 poner en `OCCUPIED`
     únicamente las dos habitaciones correspondientes, y mantiene la reserva con el tercer
     huésped pendiente

2. **Escenario**: Se completa el check-in del resto del grupo más tarde
   - **Dado** una reserva grupal con un huésped aún pendiente de check-in
   - **Cuando** ese huésped llega y el recepcionista registra su check-in
   - **Entonces** el sistema lo admite de forma independiente sin afectar los check-ins ya
     realizados para el resto del grupo

### Casos Borde

- **Campo obligatorio vacío o ausente**: si el recepcionista intenta enviar el check-in con un
  campo obligatorio vacío (por ejemplo, documento de identidad o nombre del huésped), el sistema
  debe interceptar la validación y responder con un código **HTTP 400 (Bad Request)** controlado,
  indicando de forma amigable qué campo falta, sin exponer errores de infraestructura (HTTP 500).
- **Fecha inválida o lógicamente incoherente**: si se envía una fecha con formato inválido, una
  fecha inexistente (por ejemplo, 31 de febrero), o una fecha de estadía cuya fecha de salida es
  anterior a la de llegada, el sistema debe rechazar la operación con **HTTP 400** y un mensaje
  claro, sin dejar que la excepción se propague como un error de servidor.
- **Caracteres inválidos o potencialmente maliciosos en texto libre**: si campos como el nombre
  del huésped o el número de documento contienen caracteres extraños, símbolos no permitidos o
  patrones típicos de inyección, el sistema debe interceptar y rechazar la entrada con **HTTP
  400** y un mensaje amigable, en lugar de procesarla o dejar que provoque un fallo interno.
- **Check-in intentado fuera de la ventana de la reserva**: el sistema compara la fecha de hoy
  contra las fechas de estadía reservadas. Si hoy es **anterior** al inicio de la estadía (llegada
  anticipada), el sistema bloquea la operación con **HTTP 400** e indica que la reserva debe
  actualizarse primero desde la pantalla de "Actualizar Reservación"; el sistema nunca permite
  continuar con un check-in normal en este caso, sin importar si existe disponibilidad de
  habitación. Si hoy es posterior al fin de la estadía, la admisión se rechaza con una explicación.
  En ambos casos no se crea registro de check-in ni se cambia el estado de la reserva o la
  habitación.
- **Habitación asignada no está lista físicamente**: si la habitación asignada no está en un
  estado que permita ocupación (por ejemplo `CLEANING`), el sistema no marca el check-in como
  completado contra esa habitación; informa la condición bloqueante para que el recepcionista
  asigne una habitación equivalente disponible antes de finalizar.
- **La solicitud de ocupación de habitación al Módulo 1 falla tras un check-in exitoso**: el
  check-in permanece válido y registrado; la actualización del estado de la habitación queda
  marcada como `PENDING` (en lugar de `COMPLETED`) y puede reintentarse de forma independiente,
  sin obligar a repetir la admisión.
- **Huésped extranjero cuya visa o fechas de estadía vencen antes de la fecha de salida de la
  reserva**: el procesamiento de datos migratorios detecta la inconsistencia y bloquea el check-in
  hasta que el recepcionista confirme o corrija los datos con el huésped.

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE exigir que el recepcionista ubique y valide una reserva mediante el
  caso de uso interno "Check/View Reservation" antes de poder iniciar cualquier check-in.
- **FR-002**: El sistema DEBE permitir el check-in únicamente cuando la reserva ubicada esté en
  estado `ACTIVE` y sus fechas de estadía incluyan la fecha actual de llegada.
- **FR-003**: El sistema DEBE capturar y confirmar la identidad y los datos personales del huésped
  que llega, asociándolos a la reserva que se está admitiendo.
- **FR-004**: El sistema DEBE clasificar a cada huésped como `NATIONAL` o `FOREIGN` según su
  nacionalidad.
- **FR-005**: El sistema DEBE ejecutar, para cada huésped `FOREIGN`, el procesamiento de datos
  migratorios mediante el caso de uso "Process Foreign Guest Data" antes de completar el check-in.
- **FR-006**: El sistema DEBE tratar documento de identidad, nacionalidad, tipo de visa y fechas
  de estadía como campos obligatorios para huéspedes `FOREIGN`, y DEBE bloquear la finalización
  del check-in hasta que los cuatro estén presentes y sean válidos.
- **FR-007**: El sistema NO DEBE ejecutar el procesamiento de datos migratorios para huéspedes
  `NATIONAL`.
- **FR-008**: El sistema DEBE, cuando el procesamiento migratorio de un huésped `FOREIGN` resulte
  `PASSED`, almacenar localmente en la base de datos los datos migratorios validados. El check-in
  NO DEBE disparar, programar ni depender en ninguna forma del envío de esos datos a Migración: la
  exportación mediante el caso de uso "Export SIRE File" es una funcionalidad independiente,
  exclusiva del actor Migración, y completamente desacoplada de esta funcionalidad.
- **FR-009**: El sistema DEBE registrar el check-in solo después de que el recepcionista confirme
  explícitamente un resumen con huésped, habitación, fechas de estadía y referencia de la reserva.
- **FR-010**: El sistema DEBE, al completar un check-in con éxito, registrar el momento real de
  llegada, el recepcionista responsable y la habitación asignada, y cambiar el estado de la
  reserva a `CHECKED_IN`.
- **FR-011**: El sistema DEBE, al completar un check-in con éxito, solicitar al Módulo 1 cambiar
  el estado físico de la habitación asignada a `OCCUPIED` mediante el caso de uso "Set Room
  State".
- **FR-012**: El sistema DEBE mantener válido un check-in ya completado aunque la solicitud de
  cambio de estado de habitación al Módulo 1 falle, marcando esa actualización como `PENDING` y
  permitiendo reintentarla sin repetir la admisión.
- **FR-013**: El sistema DEBE rechazar cualquier intento de check-in sobre una reserva que ya esté
  en estado `CHECKED_IN`, mostrando el registro de llegada existente en lugar de crear uno nuevo.
- **FR-014**: El sistema DEBE rechazar un check-in cuando ninguna reserva `ACTIVE` aplique al
  huésped y a la fecha de llegada, indicando la razón sin crear ningún registro ni efecto
  colateral.
- **FR-015**: El sistema NO DEBE finalizar un check-in contra una habitación que no esté en un
  estado que permita ocupación, y DEBE permitir al recepcionista asignar una habitación
  equivalente disponible antes de finalizar.
- **FR-016**: El sistema DEBE permitir el check-in parcial de una reserva grupal, admitiendo solo
  a los huéspedes presentes y dejando pendientes a los demás sobre la misma reserva.
- **FR-017**: El sistema DEBE interceptar cualquier error de validación de entrada (campos vacíos,
  fechas inválidas, caracteres no permitidos) y responder con un código **HTTP 400 (Bad Request)**
  controlado y un mensaje amigable para el usuario; el sistema NO DEBE permitir que estos errores
  se propaguen como fallas de infraestructura (**HTTP 500**).
- **FR-018**: El sistema DEBE mantener un registro auditable de cada intento de check-in,
  incluyendo los intentos bloqueados o fallidos y la razón del bloqueo.
- **FR-019**: El sistema DEBE comunicar con claridad, en cada caso de rechazo, exactamente qué
  dato falta o es inválido para que el recepcionista pueda corregirlo.
- **FR-020**: El sistema DEBE rechazar con **HTTP 400** cualquier intento de check-in cuya fecha de
  hoy sea anterior a la fecha de inicio de la estadía reservada (llegada anticipada), indicando que
  la reserva debe actualizarse primero mediante el caso de uso "Actualizar Reservación"; el sistema
  NO DEBE permitir continuar con un check-in normal en este caso, sin importar si existe
  disponibilidad de habitación.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **CheckIn**: Representa la admisión formal de uno o más huéspedes en el hotel para una reserva
  específica. Atributos clave: `reservationRef` (referencia a la `Reservation`), `guests` (lista de
  uno o más `Guest` admitidos), `assignedRooms` (lista de una o más `Room` ocupadas por este
  check-in), `arrivalTime` (momento real de llegada), `receptionist` (recepcionista responsable),
  `status` (`IN_HOUSE`, único valor que esta funcionalidad asigna), y `roomStateRequestStatus`
  (`PENDING` | `COMPLETED`). Para huéspedes `FOREIGN` también referencia el resultado de su
  `MigratoryValidation`. Un `CheckIn` pertenece a exactamente una `Reservation` y cubre uno o más
  `Guest` de esa reserva.
- **Reservation**: Representa la estadía reservada sobre la que opera el check-in. Atributos
  clave: `reservationRef` (referencia de reserva), `guests` (lista de `Guest` de la reserva),
  `assignedRooms` (lista de una o más `Room` o tipos de habitación asignados, para soportar
  reservas grupales), `startDate` y `endDate` (fecha de inicio y fin de estadía), `source` (origen:
  directa u OTA), y `status` con valores posibles: `PENDING`, `ACTIVE`, `CHECKED_IN`,
  `CHECKED_OUT`, `CANCELLED`. Se valida mediante "Check/View Reservation" y puede tener como máximo
  un `CheckIn` activo.
- **Guest**: Representa a una persona que llega al hotel. Atributos clave: `fullName` (nombre
  completo), `documentId` (documento de identidad), `nationality` (nacionalidad), y `type`
  (clasificación: `NATIONAL` | `FOREIGN`). Para huéspedes `FOREIGN`, los atributos adicionales
  obligatorios son `visaType` (tipo de visa) y `stayDates` (fechas de estadía), que alimentan la
  `MigratoryValidation`. Un `Guest` está vinculado a una o más `Reservation` y, a través de ellas,
  a un `CheckIn`.
- **Room**: Representa la unidad física asignada al huésped. Atributos clave: `roomId`
  (identificador de habitación), `roomType` (tipo de habitación), y `status` (subconjunto
  relevante para esta funcionalidad: `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`). El
  estado físico de `Room` es propiedad del Módulo 1 y se solicita cambiar a `OCCUPIED` como
  resultado de un `CheckIn` exitoso.
- **MigratoryValidation**: Representa el procesamiento local de datos migratorios ejecutado para
  un `Guest` `FOREIGN` mediante "Process Foreign Guest Data". Atributos clave: `guestRef`
  (referencia al `Guest`), `submittedData` (datos obligatorios enviados: documento de identidad,
  nacionalidad, tipo de visa, fechas de estadía), `result` (`PASSED` | `FAILED`), y
  `missingFields` (lista de campos faltantes o inválidos). Los datos validados quedan almacenados
  localmente en la base de datos; su exportación hacia Migración mediante "Export SIRE File" es un
  caso de uso independiente y exclusivo del actor Migración, completamente desacoplado de esta
  funcionalidad. Es obligatoria para cada `Guest` `FOREIGN` antes de que su `CheckIn` pueda
  completarse.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de los check-ins completados están vinculados a una reserva en estado
  `ACTIVE` cuyas fechas de estadía incluyen la fecha de llegada; nunca se registra un check-in sin
  una reserva validada.
- **SC-002**: El 100% de los check-ins de huéspedes `FOREIGN` tienen una `MigratoryValidation` con
  resultado `PASSED`, con los cuatro campos obligatorios presentes antes de completar el check-in.
- **SC-003**: El 100% de los check-ins exitosos generan una solicitud de ocupación al Módulo 1, y
  al menos el 99% de las habitaciones asignadas muestran `OCCUPIED` dentro del minuto siguiente a
  la finalización del check-in.
- **SC-004**: Cero registros de check-in duplicados existen para cualquier reserva individual en
  cualquier periodo de reporte.
- **SC-005**: Un recepcionista puede completar un check-in estándar de un huésped nacional, desde
  ubicar la reserva hasta la solicitud de ocupación de la habitación, en menos de 2 minutos.
- **SC-006**: El 95% de los intentos de check-in bloqueados o fallidos se resuelven en la primera
  corrección del recepcionista, porque el sistema indicó con exactitud qué dato faltaba o era
  inválido.
- **SC-007**: El 100% de los errores de validación de entrada (campos vacíos, fechas inválidas,
  caracteres no permitidos) se responden con **HTTP 400** y un mensaje amigable; cero errores de
  este tipo se propagan como **HTTP 500**.
- **SC-008**: Los tickets de soporte y correcciones manuales relacionados con habitaciones
  mostradas como disponibles estando ocupadas se reducen en al menos un 80% tras el uso de esta
  funcionalidad.
- **SC-009**: Cero check-ins se completan sobre reservas cuya fecha de inicio de estadía aún no ha
  llegado; el 100% de esos intentos se bloquea con **HTTP 400** e indica que la reserva debe
  actualizarse primero mediante "Actualizar Reservación".
