# Feature Specification: Registro de Check-In

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

La llegada de un huésped al hotel es un momento sensible: el cliente quiere entrar a su habitación
cuanto antes y el hotel necesita, en ese mismo acto, dejar varias cosas resueltas. Primero, admitir
formalmente al huésped y, cuando es extranjero, verificar sus datos migratorios de forma local para
cumplir con la normativa sin frenar el ingreso ni disparar un reporte inmediato a Migración.
Segundo, disparar la ocupación física de la habitación en el Módulo 1, para que el inventario
refleje de inmediato que esa habitación ya no está disponible y no se produzca una sobreventa
física. Tercero, inicializar las cuentas financieras de la estancia en el Módulo 3, de modo que
todo consumo posterior tenga dónde registrarse y no se pierdan cobros. El sistema debe además
proteger la reserva frente a admisiones inválidas: una reserva que aún no llega a su fecha de
inicio no puede admitirse antes de tiempo así exista disponibilidad física, y una reserva ya
hospedada o cancelada no puede volver a procesarse. El negocio necesita un ingreso ágil, en una
sola pantalla, que deje la reserva en `CHECKED_IN`, la `Habitation` en `Occupied` y la liquidación
preliminar abierta.

### Flujo de Usuario de Alto Nivel

1. El **Recepcionista** ubica la reserva del huésped mediante el caso de uso interno "Consultar /
   ver reserva"; el sistema valida que se encuentre en estado `ACTIVE` y que la fecha de hoy esté
   dentro de la ventana de estadía reservada (ni antes de su inicio, ni después de su fin).
2. Si el huésped es extranjero (`FOREIGN`), el sistema exige y ejecuta "Procesar datos de huésped
   extranjero" para validar localmente sus datos migratorios (`MigratoryValidation`) antes de
   permitir la confirmación. Este procesamiento es puramente local: no dispara ni envía ningún
   reporte a Migración, cuya exportación mediante "Exportar archivo SIRE" es un caso de uso
   completamente independiente.
3. El sistema presenta un resumen de confirmación en pantalla con el huésped, la habitación
   asignada, las fechas de estadía y la referencia de la reserva; el Check-In solo se completa y
   persiste tras la confirmación explícita del Recepcionista.
4. Al confirmarse, el sistema cambia el estado de la reserva a `CHECKED_IN` de forma local y
   registra la hora real de llegada (`arrivalTime`) y el recepcionista responsable.
5. El sistema solicita de forma asíncrona al **Módulo 1**, mediante "Establecer el estado de la
   habitación" (`Set Habitation State`), transicionar la `Habitation` asignada a `Occupied`.
6. El sistema notifica de forma asíncrona al **Módulo 3** ("Procesar liquidación y validación")
   para abrir la cuenta de la estancia en `Settlement` con estado `Preliminary`, fijar de manera
   inmutable el porcentaje de IVA vigente, y generar la `Prefactura` en borrador (`Draft`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registro de Check-In de un Huésped (Priority: P1)

El Recepcionista admite a un huésped cuya reserva está en estado `ACTIVE` y cuya estadía incluye el
día de hoy. En una sola pantalla ubica la reserva, confirma la identidad y los datos del huésped,
valida los datos migratorios si es extranjero, revisa el resumen y confirma el ingreso. Esta
historia es el flujo maestro de la funcionalidad: en una sola pantalla cubre tanto el camino
exitoso (huésped nacional o extranjero) como los pasos operativos de apoyo (búsqueda de la reserva)
y los caminos de error que impiden una admisión inválida o duplicada (reserva no encontrada,
cancelada, fuera de la ventana de estadía, habitación no lista físicamente, o ya realizada). Al
finalizar con éxito, la reserva queda en `CHECKED_IN`, se solicita a Módulo 1 pasar la `Habitation`
a `Occupied`, y se notifica a Módulo 3 para abrir la liquidación `Preliminary`, fijar el IVA y
generar la `Prefactura`. Por eso, estos caminos no se modelan como historias adicionales: separarlos
fragmentaría de forma artificial una única unidad de valor, incurriendo en la sobre-separación que
debe evitarse.

**Why this priority**: Es el flujo principal y de mayor frecuencia del módulo. Admitir formalmente
al huésped da inicio a la estadía; asegurar la ocupación en el Módulo 1 en el mismo acto evita
sobreventas físicas, e inicializar de inmediato las cuentas preliminares en el Módulo 3 garantiza
que ningún consumo posterior quede sin registrar. Sus escenarios de éxito, operativos y de error
ocurren todos en la misma pantalla y sobre la misma operación de negocio. Por sí sola esta historia
entrega un MVP utilizable: el hotel puede operar su recepción de llegadas de extremo a extremo,
incluyendo el rechazo controlado de intentos inválidos o repetidos.

**Independent Test**: Se puede probar de forma completa tomando una reserva `ACTIVE` cuya estadía
incluya la fecha de hoy, ejecutando el Check-In de un huésped nacional y de un huésped extranjero
con datos migratorios completos, y confirmando en ambos casos que la reserva pasa a `CHECKED_IN`,
que se emite la solicitud al Módulo 1 para poner la `Habitation` en `Occupied`, y que se notifica al
Módulo 3 para registrar la liquidación `Preliminary`, fijar el IVA y generar la `Prefactura`. La
misma prueba se completa intentando el Check-In sobre una reserva inexistente, una `CANCELLED`, una
cuya estadía aún no inicia, una cuya estadía ya finalizó, una ya `CHECKED_IN`, y una cuya habitación
asignada no está lista físicamente, confirmando que los seis intentos se bloquean con una razón
clara y sin crear ningún registro ni efecto colateral.

**Acceptance Scenarios**:

*Escenarios de Éxito (Happy Path)*

1. **Scenario**: Huésped nacional con reserva activa válida es admitido
   - **Given** que existe una reserva en estado `ACTIVE` para un huésped nacional cuya estadía
     incluye la fecha de hoy y tiene una `Habitation` asignada
   - **When** el Recepcionista confirma la identidad y los datos personales del huésped y envía el
     Check-In
   - **Then** el sistema presenta primero un resumen en pantalla con el huésped, la habitación
     asignada, las fechas de estadía y la referencia de la reserva; solo al recibir la confirmación
     explícita el Check-In se completa y persiste, cambiando el estado de la reserva a
     `CHECKED_IN`, guardando el `arrivalTime` y el recepcionista responsable, solicitando al
     Módulo 1 cambiar la `Habitation` a `Occupied` mediante `Set Habitation State`, y notificando
     al Módulo 3 para abrir la liquidación `Preliminary`, fijar el IVA y generar la `Prefactura`

2. **Scenario**: Huésped extranjero con datos migratorios completos es admitido
   - **Given** que una reserva `ACTIVE` para un huésped extranjero incluye documento, nacionalidad,
     tipo de visa y fechas de estadía, todos válidos
   - **When** el Recepcionista envía el Check-In
   - **Then** el sistema ejecuta "Procesar datos de huésped extranjero", y si el
     `MigratoryValidation` resulta `PASSED`, presenta el resumen en pantalla; solo al recibir la
     confirmación explícita el Check-In se completa y persiste igual que en el escenario anterior,
     guardando los datos migratorios validados localmente — la exportación de estos datos hacia
     Migración es un caso de uso independiente, completamente fuera del alcance de esta historia

*Escenarios de Flujo Operativo*

3. **Scenario**: Check-in tardío dentro de la misma ventana de estadía
   - **Given** una reserva `ACTIVE` cuya fecha de inicio de estadía ya pasó, pero cuya fecha de fin
     todavía no llega
   - **When** el Recepcionista intenta el Check-In hoy
   - **Then** el sistema permite el Check-In con normalidad, ya que la fecha de hoy sigue dentro de
     la ventana de estadía reservada; esta funcionalidad solo bloquea la admisión cuando hoy es
     anterior al inicio de la estadía (Escenario 6, llegada anticipada) o posterior a su fin
     (Escenario 7, llegada tardía), nunca por llegar después del primer día reservado

*Escenarios de Error / Casos Espejo (Caminos Tristes)*

4. **Scenario**: No se encuentra reserva para el huésped
   - **Given** un huésped que llega a recepción sin ninguna reserva registrada
   - **When** el Recepcionista busca una reserva para iniciar el Check-In
   - **Then** el sistema informa que no se encontró ninguna reserva activa y no permite iniciar el
     Check-In

5. **Scenario**: La reserva existe pero ya fue cancelada
   - **Given** una reserva en estado `CANCELLED`
   - **When** el Recepcionista la selecciona para hacer el Check-In del huésped
   - **Then** el sistema bloquea la admisión, indica que la reserva está cancelada, y no modifica
     el `state` de la reserva ni el `stateHabitation`

6. **Scenario**: Llegada anticipada — la reserva aún no alcanza su fecha de inicio de estadía
   - **Given** una reserva en estado `ACTIVE` cuya fecha de inicio de estadía es posterior a la de
     hoy (por ejemplo, comienza mañana)
   - **When** el Recepcionista intenta registrar el Check-In hoy, antes de la fecha de llegada
     permitida por la reserva
   - **Then** el sistema bloquea la transacción con un error controlado **HTTP 400**, indica que
     primero debe actualizarse la fecha de la reserva mediante "Actualizar Reservación" antes de
     poder hospedar al huésped, y no crea ningún registro de Check-In ni modifica el `state` de la
     reserva o el `stateHabitation`; esta restricción aplica sin importar si existe disponibilidad
     física de la habitación

7. **Scenario**: Llegada tardía — la estadía reservada ya finalizó
   - **Given** una reserva cuya fecha de fin de estadía ya pasó
   - **When** el Recepcionista intenta hacer el Check-In hoy
   - **Then** el sistema rechaza el Check-In con **HTTP 400** y explica que la fecha de hoy está
     fuera de la ventana de estadía reservada

8. **Scenario**: Check-In ya realizado sobre la misma reserva
   - **Given** una reserva en estado `CHECKED_IN` con el huésped ya hospedado
   - **When** el Recepcionista intenta registrar el Check-In nuevamente
   - **Then** el sistema rechaza el intento, muestra los datos del `CheckIn` existente, y no crea
     un nuevo registro ni envía otra solicitud al Módulo 1 o al Módulo 3

9. **Scenario**: Bloqueo de admisión si la habitación asignada no está lista físicamente
   - **Given** que la `Habitation` asignada en el Módulo 1 se encuentra en estado
     `PendingCleaning`, `InCleaning` o `DisabledForRepairs`
   - **When** el Recepcionista intenta realizar el Check-In
   - **Then** el sistema bloquea la admisión, informa la condición bloqueante de aseo o
     mantenimiento, y permite al Recepcionista reasignar una categoría equivalente disponible antes
     de continuar

---

### User Story 2 - Check-In Parcial en Reservas Grupales (Priority: P3)

Cuando una reserva grupal incluye varios huéspedes y solo algunos llegan el día previsto, el
Recepcionista puede admitir únicamente a los huéspedes presentes, dejando a los demás en estado
pendiente sobre la misma reserva.

**Why this priority**: Mejora la operación cuando los grupos no llegan completos al mismo tiempo,
pero no es indispensable para que el negocio funcione: sin ella, el Recepcionista puede esperar a
que llegue todo el grupo antes de iniciar el Check-In.

**Independent Test**: Se puede probar de forma completa registrando el Check-In de dos de tres
huéspedes de una misma reserva grupal y confirmando que solo esos dos quedan admitidos, que el
tercero permanece pendiente, y que solo se solicita la ocupación de las habitaciones que ya tienen
un huésped hospedado.

**Acceptance Scenarios**:

1. **Scenario**: Se admite parcialmente a un grupo
   - **Given** una reserva grupal `ACTIVE` con tres huéspedes y tres `Habitation` asignadas, de las
     cuales solo dos huéspedes se presentan hoy
   - **When** el Recepcionista registra el Check-In de los dos huéspedes presentes
   - **Then** el sistema los marca como hospedados, solicita al Módulo 1 poner en `Occupied`
     únicamente las dos habitaciones correspondientes, notifica al Módulo 3 para abrir la
     liquidación `Preliminary` por la porción ya ocupada, y mantiene la reserva con el tercer
     huésped pendiente

2. **Scenario**: Se completa el Check-In del resto del grupo más tarde
   - **Given** una reserva grupal con un huésped aún pendiente de Check-In
   - **When** ese huésped llega y el Recepcionista registra su Check-In
   - **Then** el sistema lo admite de forma independiente sin afectar los Check-In ya realizados
     para el resto del grupo

### Casos Borde

- ¿Qué sucede si el Recepcionista intenta enviar el Check-In con un campo obligatorio vacío (por
  ejemplo, documento o nombre del huésped)? El sistema intercepta la validación y responde con
  **HTTP 400 (Bad Request)** controlado, indicando de forma amigable qué campo falta, sin exponer
  errores de infraestructura **HTTP 500**.
- ¿Qué sucede si se envía una fecha con formato inválido, una fecha inexistente, o una estadía
  cuya fecha de salida es anterior a la de llegada? El sistema rechaza la operación con **HTTP 400**
  y un mensaje claro, sin dejar que la excepción se propague como un error de servidor.
- ¿Qué sucede si campos como el nombre del huésped o el documento contienen caracteres extraños o
  patrones de inyección? El sistema intercepta y rechaza la entrada con **HTTP 400** y un mensaje
  amigable.
- ¿Qué sucede si la solicitud de ocupación al Módulo 1 falla tras un Check-In exitoso? El Check-In
  permanece válido y registrado; el `habitationRequestStatus` queda marcado como `PENDING` (en
  lugar de `COMPLETED`) y puede reintentarse de forma independiente, sin obligar a repetir la
  admisión.
- ¿Qué sucede si la notificación de liquidación al Módulo 3 falla tras un Check-In exitoso? El
  Check-In permanece válido; el `billingRequestStatus` queda marcado como `PENDING`, y la apertura
  del `Settlement` y la generación de la `Prefactura` se reintentan de forma asíncrona en cuanto el
  Módulo 3 se recupere, sin bloquear al huésped en recepción.
- ¿Qué sucede si un huésped extranjero tiene la visa o las fechas de estadía vencidas antes de la
  fecha de salida de la reserva? "Procesar datos de huésped extranjero" detecta la inconsistencia y
  bloquea el Check-In hasta que el Recepcionista confirme o corrija los datos con el huésped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe exigir que el Recepcionista ubique y valide una reserva mediante el
  caso de uso interno "Consultar / ver reserva" antes de poder iniciar cualquier Check-In.
- **FR-002**: El sistema debe permitir el Check-In únicamente cuando la reserva ubicada esté en
  estado `ACTIVE` y la fecha de hoy esté dentro de su ventana de estadía.
- **FR-003**: El sistema debe capturar y confirmar la identidad y los datos personales del huésped
  que llega, asociándolos a la reserva que se está admitiendo.
- **FR-004**: El sistema debe clasificar a cada huésped como `NATIONAL` o `FOREIGN` según su
  nacionalidad.
- **FR-005**: El sistema debe ejecutar, para cada huésped `FOREIGN`, "Procesar datos de huésped
  extranjero" antes de completar el Check-In, y no debe ejecutarlo para huéspedes `NATIONAL`.
- **FR-006**: El sistema debe, cuando el `MigratoryValidation` de un huésped `FOREIGN` resulte
  `PASSED`, almacenar localmente los datos migratorios validados sin disparar ni enviar
  automáticamente ningún reporte a Migración; esa exportación mediante "Exportar archivo SIRE" es
  un caso de uso independiente y desacoplado.
- **FR-007**: El sistema debe registrar el Check-In solo después de presentar un resumen con
  huésped, habitación, fechas de estadía y referencia de la reserva, y de que el Recepcionista lo
  confirme explícitamente.
- **FR-008**: El sistema debe, al completar un Check-In con éxito, registrar el `arrivalTime`, el
  recepcionista responsable, y cambiar el `state` de la reserva a `CHECKED_IN`.
- **FR-009**: El sistema debe, al completar un Check-In con éxito, solicitar de forma asíncrona al
  Módulo 1 cambiar el `stateHabitation` de la `Habitation` asignada a `Occupied` mediante
  "Establecer el estado de la habitación".
- **FR-010**: El sistema debe, al completar un Check-In con éxito, notificar de forma asíncrona al
  Módulo 3 para abrir el `Settlement` en estado `Preliminary`, fijar de manera inmutable el
  porcentaje de IVA vigente, y generar la `Prefactura` en `Draft`.
- **FR-011**: El sistema debe mantener válido un Check-In ya completado aunque las solicitudes
  asíncronas al Módulo 1 o al Módulo 3 fallen, marcando `habitationRequestStatus` o
  `billingRequestStatus` como `PENDING` y permitiendo reintentarlas sin repetir la admisión.
- **FR-012**: El sistema debe rechazar con **HTTP 400 (Bad Request)** cualquier intento de Check-In
  cuya fecha de hoy sea anterior a la fecha de inicio de la estadía reservada (llegada anticipada),
  indicando que la reserva debe actualizarse primero mediante "Actualizar Reservación"; esta
  restricción aplica sin importar si existe disponibilidad física de la habitación.
- **FR-013**: El sistema debe rechazar con **HTTP 400** cualquier intento de Check-In cuya fecha de
  hoy sea posterior a la fecha de fin de la estadía reservada (llegada tardía).
- **FR-014**: El sistema debe rechazar cualquier intento de Check-In sobre una reserva que ya esté
  en estado `CHECKED_IN`, mostrando el registro existente en lugar de crear uno nuevo.
- **FR-015**: El sistema debe rechazar un Check-In cuando ninguna reserva `ACTIVE` aplique al
  huésped y a la fecha de llegada, indicando la razón sin crear ningún registro ni efecto
  colateral.
- **FR-016**: El sistema no debe finalizar un Check-In contra una `Habitation` que no esté en
  `Available`, y debe permitir al Recepcionista asignar una categoría equivalente disponible antes
  de finalizar.
- **FR-017**: El sistema debe permitir el Check-In parcial de una reserva grupal, admitiendo solo a
  los huéspedes presentes y dejando pendientes a los demás sobre la misma reserva.
- **FR-018**: El sistema debe interceptar cualquier error de validación de entrada (campos vacíos,
  fechas inválidas, caracteres no permitidos) y responder con **HTTP 400 (Bad Request)** controlado,
  prohibiendo que estos errores se propaguen como fallas de infraestructura **HTTP 500**.
- **FR-019**: El sistema debe mantener un registro auditable de cada intento de Check-In, incluyendo
  los intentos bloqueados o fallidos y la razón del bloqueo.
- **FR-020**: El sistema debe comunicar con claridad, en cada caso de rechazo, exactamente qué dato
  falta o es inválido para que el Recepcionista pueda corregirlo.

### Non-Functional Requirements

- **NFR-001**: El tiempo para validar los datos locales de la reserva no debe superar los 200
  milisegundos en el Módulo 2.
- **NFR-002**: El Recepcionista debe poder completar el ingreso de un huésped nacional, desde
  ubicar la reserva hasta el envío asíncrono de las notificaciones al Módulo 1 y al Módulo 3, en
  menos de 1.5 minutos.

### Key Entities *(include if feature involves data)*

- **CheckIn**: Representa la admisión formal de uno o más huéspedes en el hotel para una reserva
  específica. Atributos: `id`, `reservationRef`, `guests` (lista de uno o más `Guest` admitidos),
  `assignedHabitations` (lista de una o más `Habitation` ocupadas por este Check-In),
  `arrivalTime`, `receptionist`, `status` (`IN_HOUSE`, único valor que esta funcionalidad asigna),
  `habitationRequestStatus` (`PENDING` | `COMPLETED`, seguimiento del cambio de estado enviado al
  Módulo 1), y `billingRequestStatus` (`PENDING` | `COMPLETED`, seguimiento de la notificación
  enviada al Módulo 3). Para huéspedes `FOREIGN` también referencia el resultado de su
  `MigratoryValidation`. Un `CheckIn` pertenece a exactamente una `Reservation`.
- **Reservation**: Representa la estadía reservada sobre la que opera el Check-In. Atributos:
  `reservationRef`, `guests` (lista de `Guest` de la reserva), `categoryHabitation` (categoría
  reservada antes del Check-In), `assignedHabitations` (lista de `Habitation` físicas asignadas
  desde el Check-In en adelante), `startDate`, `endDate`, `source` (`DIRECT` | `OTA`), y `state`
  con estados permitidos: `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. El estado `PENDING`
  queda inhabilitado en los flujos estándar: toda reserva nace directamente en `ACTIVE`. Solo puede
  pasar a `CHECKED_IN` desde `ACTIVE`.
- **Habitation**: Representa la habitación física, cuya gestión de estado es propiedad del
  Módulo 1. Atributos: `habitationId`, `numberHabitation`, `categoryHabitation`, y
  `stateHabitation` con los siete estados oficiales del glosario: `Available`, `Occupied`,
  `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`. El Check-In
  solo puede finalizarse contra una `Habitation` en `Available`, y como resultado se solicita su
  transición a `Occupied`.
- **Guest**: Representa a una persona que llega al hotel. Atributos: `id`, `fullName`,
  `documentNumber`, `nationality`, `contactPhone`, `contactEmail`, y `type` (`NATIONAL` |
  `FOREIGN`).
- **MigratoryValidation**: Representa el procesamiento local de datos migratorios de un `Guest`
  `FOREIGN` mediante "Procesar datos de huésped extranjero". Atributos: `guestRef`,
  `submittedData` (documento, nacionalidad, tipo de visa, fechas de estadía), `result` (`PASSED` |
  `FAILED`), `missingFields`, y `sireExportStatus` (`PENDING` | `EXPORTED`), que esta funcionalidad
  inicializa en `PENDING` al validar con éxito. Los datos validados quedan almacenados localmente;
  su exportación hacia Migración mediante "Exportar archivo SIRE" es un caso de uso independiente y
  desacoplado. Es obligatoria para cada `Guest` `FOREIGN` antes de que su `CheckIn` pueda
  completarse.
- **Settlement**: Se referencia únicamente como resultado de la notificación al Módulo 3. Atributos
  relevantes: `reservationRef`, `ivaPercentage` (fijado de forma inmutable en este Check-In), y
  `status` (`Preliminary` en este flujo). Es generado y gestionado por "Procesar liquidación y
  validación", fuera del alcance de esta funcionalidad.
- **Prefactura**: Se referencia únicamente como resultado de la notificación al Módulo 3. Atributos
  relevantes: `id`, `reservationRef`, y `status` (`Draft` en este flujo).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los Check-In completados están vinculados a una reserva en estado
  `ACTIVE` cuya ventana de estadía incluye la fecha de llegada; nunca se registra un Check-In sin
  una reserva validada.
- **SC-002**: El 100% de los Check-In de huéspedes `FOREIGN` tienen un `MigratoryValidation` con
  resultado `PASSED` antes de completar el Check-In.
- **SC-003**: El 100% de los Check-In exitosos generan una solicitud de ocupación al Módulo 1, y al
  menos el 99% de las `Habitation` asignadas muestran `Occupied` dentro del minuto siguiente a la
  finalización del Check-In.
- **SC-004**: El 100% de los Check-In exitosos generan una notificación al Módulo 3 que abre un
  `Settlement` en `Preliminary` con el IVA fijado y una `Prefactura` en `Draft`.
- **SC-005**: Cero registros de Check-In duplicados existen para cualquier reserva individual en
  cualquier periodo de reporte.
- **SC-006**: Un Recepcionista puede completar un Check-In estándar de un huésped nacional, desde
  ubicar la reserva hasta el envío asíncrono de las notificaciones al Módulo 1 y al Módulo 3, en
  menos de 1.5 minutos.
- **SC-007**: El 95% de los intentos de Check-In bloqueados o fallidos se resuelven en la primera
  corrección del Recepcionista, porque el sistema indicó con exactitud qué dato faltaba o era
  inválido.
- **SC-008**: El 100% de los errores de validación de entrada se responden con **HTTP 400** y un
  mensaje amigable; cero errores de este tipo se propagan como **HTTP 500**.
- **SC-009**: Cero Check-In se completan sobre reservas cuya fecha de inicio de estadía aún no ha
  llegado; el 100% de esos intentos se bloquea con **HTTP 400** e indica que la reserva debe
  actualizarse primero mediante "Actualizar Reservación".
