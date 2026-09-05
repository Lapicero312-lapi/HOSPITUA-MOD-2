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
  procesamiento solo valida y almacena localmente los datos migratorios del huésped; el check-in
  **no** dispara ni envía automáticamente ningún reporte al actor externo **Migración**. El envío
  del reporte hacia Migración mediante el caso de uso **"Export SIRE File"** (Exportar Archivo
  SIRE) es una acción manual y separada, fuera del alcance de esta funcionalidad de check-in.
- Antes de finalizar, el sistema presenta un resumen de la reserva para confirmación explícita del
  recepcionista; esto es un paso dentro del mismo flujo, no una historia aparte.
- Una vez registrado el check-in, el sistema solicita al **Módulo 1** cambiar el estado físico de
  la habitación asignada mediante el caso de uso **"Set Room State"** (Establecer el Estado de la
  Habitación).

**Estados de la entidad `Reservation`** (deben usarse exactamente estos valores en todo el
sistema): `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `Room`** relevantes para esta funcionalidad (el estado físico completo es
propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

### Historia de Usuario 1 - Registro de Check-In de un Huésped (Prioridad: P1)

Un recepcionista recibe a un huésped cuya reserva está en estado `ACTIVE` y cuyas fechas de
estadía incluyen el día de hoy. El recepcionista busca la reserva, confirma la identidad y los
datos del huésped, y registra el check-in. Si el huésped es extranjero, el sistema procesa
adicionalmente sus datos migratorios antes de confirmar. Al finalizar, el sistema marca la reserva
como `CHECKED_IN` y solicita al Módulo 1 poner la habitación en estado `OCCUPIED`.

**Por qué esta prioridad**: Es el flujo principal y de mayor frecuencia de la funcionalidad. Sin
él no es posible admitir huéspedes, y todos los demás escenarios son variaciones sobre este
camino. Por sí solo entrega un MVP utilizable: el hotel puede operar su recepción de llegadas de
extremo a extremo.

**Prueba Independiente**: Se puede probar de forma completa tomando una reserva `ACTIVE` cuya
estadía incluya la fecha de hoy, ejecutando el check-in de un huésped nacional con datos completos
y confirmando que la reserva pasa a `CHECKED_IN`, que se crea un registro de check-in con el
momento real de llegada, y que se emite una solicitud para ocupar la habitación. Repitiendo la
prueba con un huésped extranjero con datos migratorios completos se valida además el
procesamiento y almacenamiento local de los datos migratorios. Entrega el valor de una admisión
completa y auditable.

**Escenarios de Aceptación**:

1. **Escenario**: Huésped nacional con reserva activa válida es admitido
   - **Dado** que existe una reserva en estado `ACTIVE` para un huésped nacional cuya estadía
     incluye la fecha de hoy y tiene una habitación asignada
   - **Cuando** el recepcionista confirma la identidad y los datos personales del huésped y envía
     el check-in
   - **Entonces** el sistema registra el check-in, cambia el estado de la reserva a `CHECKED_IN`,
     guarda el momento real de llegada y el recepcionista responsable, y solicita al Módulo 1
     cambiar el estado de la habitación a `OCCUPIED`

2. **Escenario**: La reserva se ubica antes de la admisión
   - **Dado** que el recepcionista solo cuenta con el nombre del huésped y la referencia de la
     reserva
   - **Cuando** el recepcionista busca la reserva mediante "Check/View Reservation"
   - **Entonces** el sistema devuelve la reserva coincidente con sus fechas de estadía, habitación,
     lista de huéspedes y estado actual, para que el recepcionista continúe con el check-in

3. **Escenario**: Se muestra un resumen de confirmación antes de finalizar
   - **Dado** que el recepcionista ingresó toda la información requerida para el check-in
   - **Cuando** el recepcionista solicita finalizar
   - **Entonces** el sistema presenta un resumen con huésped, habitación, fechas de estadía y
     referencia de la reserva, y solo completa el check-in tras la confirmación explícita

4. **Escenario**: Huésped extranjero con datos migratorios completos es admitido
   - **Dado** que una reserva `ACTIVE` para un huésped extranjero incluye documento de identidad,
     nacionalidad, tipo de visa y fechas de estadía, todos válidos
   - **Cuando** el recepcionista envía el check-in
   - **Entonces** el sistema ejecuta "Process Foreign Guest Data", y si resulta `PASSED`,
     finaliza el check-in con éxito y guarda los datos migratorios validados localmente en la
     base de datos, sin enviarlos ni exportarlos a Migración de forma inmediata

### Historia de Usuario 2 - Bloqueo de Check-In sin Reserva Activa Válida (Prioridad: P2)

El sistema no debe permitir el check-in de un huésped que no tenga una reserva en estado `ACTIVE`
cuyas fechas de estadía cubran la fecha de llegada. El recepcionista debe ubicar y validar la
reserva mediante "Check/View Reservation"; si ninguna aplica, la admisión se rechaza.

**Por qué esta prioridad**: Es un flujo de error sobre el camino principal: protege la integridad
de los datos de ocupación, facturación y reportes ante intentos de check-in inválidos, pero el
negocio ya funciona sin él si se opera con disciplina manual.

**Prueba Independiente**: Se puede probar de forma completa intentando un check-in sin reserva
coincidente, con una reserva en estado `CANCELLED`, y con una reserva cuyas fechas no cubren hoy,
confirmando que cada intento se bloquea con una razón clara y que no se crea ningún registro de
check-in.

**Escenarios de Aceptación**:

1. **Escenario**: No se encuentra reserva para el huésped
   - **Dado** un huésped que llega a recepción sin ninguna reserva registrada
   - **Cuando** el recepcionista busca una reserva para iniciar el check-in
   - **Entonces** el sistema informa que no se encontró ninguna reserva activa y no permite
     iniciar el check-in

2. **Escenario**: La reserva existe pero ya fue cancelada
   - **Dado** una reserva en estado `CANCELLED`
   - **Cuando** el recepcionista la selecciona para hacer el check-in del huésped
   - **Entonces** el sistema bloquea la admisión, indica que la reserva está cancelada, y no
     modifica el estado de la reserva ni de la habitación

3. **Escenario**: La fecha de llegada no está dentro de la estadía reservada
   - **Dado** una reserva cuya estadía inicia dentro de tres días
   - **Cuando** el recepcionista intenta hacer el check-in hoy
   - **Entonces** el sistema rechaza el check-in y explica que la fecha de hoy está fuera de la
     ventana de estadía reservada

### Historia de Usuario 3 - Prevención de Check-In Duplicado (Prioridad: P2)

Una vez que una reserva fue admitida (estado `CHECKED_IN`), el sistema no debe permitir que se
registre un nuevo check-in sobre la misma reserva. Al recepcionista se le debe mostrar que el
huésped ya está hospedado.

**Por qué esta prioridad**: Un segundo check-in sobre la misma reserva generaría registros de
llegada duplicados, podría disparar una segunda solicitud de ocupación de habitación, y
distorsionaría los conteos de ocupación y los reportes migratorios.

**Prueba Independiente**: Se puede probar de forma completa haciendo el check-in de una reserva
con éxito y luego intentando el mismo check-in de nuevo, confirmando que el segundo intento es
rechazado, que no se crea un nuevo registro, y que no se envía una solicitud adicional de cambio
de estado de habitación.

**Escenarios de Aceptación**:

1. **Escenario**: Segundo intento de check-in sobre una reserva ya admitida
   - **Dado** una reserva en estado `CHECKED_IN` con el huésped hospedado
   - **Cuando** el recepcionista intenta registrar el check-in nuevamente
   - **Entonces** el sistema rechaza el intento, muestra los datos del check-in existente, y no
     crea un nuevo registro ni envía otra solicitud de cambio de estado de habitación

2. **Escenario**: El recepcionista reabre una reserva hospedada solo para consultarla
   - **Dado** una reserva en estado `CHECKED_IN`
   - **Cuando** el recepcionista la abre mediante "Check/View Reservation"
   - **Entonces** el sistema la muestra como `CHECKED_IN` con el momento de llegada y la
     habitación asignada, y solo ofrece acciones de consulta, no una nueva admisión

### Historia de Usuario 4 - Check-In Parcial en Reservas Grupales (Prioridad: P3)

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
  contra las fechas de estadía reservadas. Si hoy es anterior al inicio o posterior al fin, la
  admisión se rechaza con una explicación, sin crear registro de check-in ni cambiar el estado de
  la reserva o la habitación.
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
  `PASSED`, almacenar localmente los datos migratorios validados, dejándolos disponibles para su
  exportación manual posterior mediante el caso de uso "Export SIRE File"; el check-in NO DEBE
  disparar ni enviar automáticamente ese reporte a Migración.
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

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **CheckIn**: Representa la admisión formal de un huésped en el hotel para una reserva
  específica. Atributos clave: `reservationRef` (referencia a la `Reservation`), `guests`
  (referencia al/los `Guest` admitido(s)), `assignedRoom` (habitación asignada), `arrivalTime`
  (momento real de llegada), `receptionist` (recepcionista responsable), `status` (`IN_HOUSE`,
  único valor que esta funcionalidad asigna), y `roomStateRequestStatus` (`PENDING` |
  `COMPLETED`). Para huéspedes `FOREIGN` también referencia el resultado de su
  `MigratoryValidation`. Un `CheckIn` pertenece a exactamente una `Reservation` y cubre uno o más
  `Guest` de esa reserva.
- **Reservation**: Representa la estadía reservada sobre la que opera el check-in. Atributos
  clave: `reservationRef` (referencia de reserva), `guestList` (lista de huéspedes),
  `assignedRoom` (habitación o tipo de habitación asignada), `startDate` y `endDate` (fecha de
  inicio y fin de estadía), `source` (origen: directa u OTA), y `status` con valores posibles:
  `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Se valida mediante "Check/View
  Reservation" y puede tener como máximo un `CheckIn` activo.
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
  localmente, disponibles para una exportación manual y posterior a Migración mediante "Export
  SIRE File", la cual está fuera del alcance de esta funcionalidad. Es obligatoria para cada
  `Guest` `FOREIGN` antes de que su `CheckIn` pueda completarse.

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
