# Feature Specification: Actualizar Reservación

**Created**: 2026-09-19
**Updated**: 2026-09-29

## Use Case (Caso de Uso)

### Descripción del problema

Los planes de viaje de un huésped cambian con frecuencia: adelanta o pospone su llegada, extiende la
estadía, cambia de categoría de habitación o corrige datos personales. Si el hotel no puede reflejar
esos cambios de forma ágil sobre una reserva, la fricción crece, se pierden ventas y el personal
termina llevando ajustes por fuera del sistema. El problema tiene tres caras: verificar que las
nuevas fechas estén disponibles, recalcular el valor cuando cambian las fechas o la categoría (lo
hace el Módulo 3, no el Módulo 2), y mantener un único punto donde se cambia el estado de la
reserva, que también usan el Check-In, el Check-Out y el proceso de No-Show. El negocio necesita una
única funcionalidad de actualización que valide la disponibilidad, delegue el recálculo y solo
persista tras la confirmación del solicitante.

Además de las ediciones del solicitante, el estado de la reserva cambia por eventos que ocurren
fuera del Módulo 2. El Check-In y el Check-Out son procesos presenciales que ejecuta el Módulo 1,
que es quien opera el hotel en persona: el Módulo 2 no debe duplicar una pantalla de ingreso ni de
salida, solo necesita enterarse para actualizar el estado de la reserva (`IN_PROGRESS` y
`COMPLETED`) y conservar los datos migratorios que exige el reporte a Migración. Si esas
notificaciones no se procesan, las reservas quedan desactualizadas o eternamente "en curso" y el
reporte SIRE queda incompleto. Del mismo modo, una reserva cuyo huésped nunca llega queda
"estancada" y distorsiona las métricas de ocupación. El negocio necesita un proceso automático de
cierre del día que identifique esas reservas y las marque como no presentadas. El Módulo 1, dueño del
estado de las habitaciones, libera las habitaciones por su cuenta. Todas estas transiciones comparten
las mismas reglas de transición y de concurrencia.

### Flujo de Usuario de Alto Nivel

1. La **Recepcionista** o la **Ota** localiza la reserva mediante "Consultar
   reservas" y valida que esté en `ACTIVE` o `PENDING`. La Recepcionista solo modifica reservas de
   canal `DIRECT`; una reserva de canal `OTA` solo la modifica la Ota por su API, porque sus datos
   los envía la agencia y no se editan en el hotel.
2. El solicitante edita uno o varios de estos datos:
   - Las fechas de la estadía (`startDate`, `endDate`), comunes a todas las habitaciones.
   - Las habitaciones de la reserva: agregar una habitación, quitar una habitación (la reserva
     debe conservar al menos una) o cambiar una habitación por otra, de la misma o de otra
     categoría.
   - La cantidad de personas de cada habitación (`guestCount` de la habitación).
   - Los datos personales del `Guest` titular, salvo `nationality`: el país de origen se fija al
     crear la reserva y no se edita desde "Actualizar reservación".
   - Las observaciones (`notes`).
3. Si cambian las fechas o se agrega o cambia una habitación, el sistema ejecuta "Verificar
   disponibilidades" para cada habitación que quedaría en la reserva, enviando la `reservationRef`
   de la reserva editada, para que esta no se cruce consigo misma.
4. Si cambia el `guestCount` de una habitación o cambian las habitaciones, el sistema valida que el
   `guestCount` de cada habitación sea al menos 1 y no supere su capacidad máxima (`maxCapacity`).
   El `guestCount` de la reserva es la suma de los de sus habitaciones.
5. Si cambian las fechas, se agrega una habitación o una habitación cambia de categoría, el sistema
   ejecuta "Calcular tarifa dinámica" en el Módulo 3 para cada habitación afectada (todas si cambian las
   fechas; solo la agregada o la de categoría distinta en los demás casos) y obtiene la nueva tarifa de
   cada una. Un cambio solo de `guestCount`, de datos personales o de `notes`, y
   también cambiar una habitación por otra de la misma categoría, no recotiza ni muestra tarifa: el
   precio depende de la categoría y de las fechas, no del número de habitación.
6. El solicitante revisa el resumen y confirma; el sistema persiste los cambios.
7. Si la reserva forma parte de la lista del día, el sistema avisa el cambio mediante
   "Enviar reservas del día al Módulo 1" (`UPDATED`, o `ADDED` / `REMOVED` si el cambio de fechas
   hace entrar o salir la reserva de la lista del día).

Adicionalmente, esta funcionalidad recibe el cambio de `status` que solicitan otros procesos:
"Generar reservación por OTA" (confirmación de pago o garantía), "Generar reservación directa" y
la notificación de Check-In, la notificación de Check-Out y
el cierre automático del día (No-Show), descritos a continuación. Todos ellos cambian el `status` de
la reserva a `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`, de modo que las reglas de
transición y de concurrencia vivan en un solo lugar. "Cancelar reservación" es la excepción: cambia
el `status` directamente a `CANCELLED`, de forma atómica dentro de su propia transacción.

**Notificación de Check-In del Módulo 1**

El Check-In se notifica **por habitación**: una reserva con varias habitaciones recibe una
notificación por cada habitación que ingresa, porque los huéspedes de un mismo grupo pueden llegar
en momentos distintos.

1. El **Módulo 1** ejecuta el Check-In físico de una habitación: cambia la `Room` a `Occupied` y la
   entrega al huésped.
2. El Módulo 1 envía al Módulo 2 una notificación con la `reservationRef`, el `roomId` de la
   habitación que ingresó y, por cada huésped extranjero que ingresó a esa habitación (no solo el
   titular), sus datos migratorios (`ForeignGuestData`, con `movementType` `ENTRY` y su
   `movementDate`).
3. El sistema localiza la reserva mediante "Consultar reservas", valida que el `roomId` pertenezca a
   la reserva y que la reserva esté en `ACTIVE` o `IN_PROGRESS`.
4. El sistema cambia el `stayStatus` de esa habitación (`ReservationRoom`) de `EXPECTED` a
   `CHECKED_IN`.
5. Si es la primera habitación de la reserva que ingresa, el sistema cambia el `status` de la
   reserva de `ACTIVE` a `IN_PROGRESS`. Si la reserva ya estaba en `IN_PROGRESS` (otra habitación
   ya ingresó), el `status` no cambia.
6. Si hay huéspedes extranjeros, o si el titular es extranjero, el sistema ejecuta "Procesar datos
   de huéspedes extranjeros" para validarlos y registrar un `MigratoryMovement` de entrada por cada
   huésped.

**Notificación de Check-Out del Módulo 1**

El Check-Out también se notifica **por habitación**.

1. El **Módulo 1** ejecuta el Check-Out físico de una habitación: la libera y cierra su estadía.
2. El Módulo 1 envía al Módulo 2 una notificación con la `reservationRef`, el `roomId` y, por cada
   huésped extranjero que salió de esa habitación, sus datos migratorios (`ForeignGuestData`, con
   `movementType` `DEPARTURE` y su `movementDate`).
3. El sistema localiza la reserva mediante "Consultar reservas", valida que el `roomId` pertenezca a
   la reserva, que la reserva esté en `IN_PROGRESS` y que esa habitación esté en `CHECKED_IN`.
4. El sistema cambia el `stayStatus` de esa habitación a `CHECKED_OUT`.
5. Si ya no queda ninguna habitación de la reserva en `CHECKED_IN` ni en `EXPECTED` (todas están en
   `CHECKED_OUT` o `NOT_ARRIVED`), el sistema cambia el `status` de la reserva a `COMPLETED`. Si
   todavía queda alguna, la reserva sigue en `IN_PROGRESS`.
6. Si hay huéspedes extranjeros, o si el titular es extranjero, el sistema ejecuta "Procesar datos
   de huéspedes extranjeros" para validarlos y registrar un `MigratoryMovement` de salida por cada
   huésped.

**Cierre automático del día (No-Show)**

1. El sistema ejecuta un proceso automático al cierre del día operativo. El día operativo es el día
   calendario de Colombia, fijo: va de las 00:00 a las 23:59 (zona horaria de Colombia, UTC-5) y el
   cierre ocurre al terminar las 23:59.
2. El sistema recorre las `Reservation` cuya `startDate` corresponde al día procesado.
3. **No-Show total**: para cada una en `ACTIVE` o `PENDING` (ninguna habitación ingresó) cambia el
   `status` a `NO_SHOW`, sea cual sea el canal, y marca todas sus habitaciones como `NOT_ARRIVED`.
4. **Habitaciones no llegadas**: para cada una en `IN_PROGRESS` que tenga habitaciones todavía en
   `EXPECTED`, marca esas habitaciones como `NOT_ARRIVED`, sin cambiar el `status` de la reserva. Si con eso ya no queda ninguna habitación
   en `CHECKED_IN` (todas las que ingresaron ya salieron), cambia la reserva a `COMPLETED`.
5. En el No-Show total, el sistema avisa al Módulo 1 mediante "Enviar reservas del día al Módulo 1"
   (`REMOVED` con motivo `NO_SHOW`).
6. Se ignoran las reservas en estados finales y las habitaciones ya ingresadas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Modificación de Datos de Reservación (Priority: P1)

Un solicitante —la Recepcionista para las reservas directas, o la Ota por su API para las suyas—
modifica una reserva que aún no ha iniciado su estadía. Puede cambiar fechas, agregar, quitar o cambiar habitaciones, cambiar la
cantidad de personas, corregir datos personales, o editar las observaciones. Cuando el cambio afecta fechas o habitaciones, el sistema valida disponibilidad y delega el
recálculo en el Módulo 3, mostrando la tarifa de cada habitación afectada, como al crear la reserva, antes de
confirmar; cuando solo toca datos que no afectan el precio, o cambia una habitación por otra de la misma
categoría, guarda directamente. Por tratarse de una única vista, el camino feliz y los
bloqueos lógicos se consolidan en esta misma historia de usuario.

**Why this priority**: Da al hotel la flexibilidad de acomodar los cambios del cliente sin fricción
y sin gestiones por fuera del sistema, garantizando la consistencia de la disponibilidad y del valor
de la estadía antes de la llegada.

**Independent Test**: Se modifica una reserva `ACTIVE` y se verifica que el sistema valide la
disponibilidad, muestre la tarifa nueva calculada por el Módulo 3 y solo tras la confirmación guarde
los cambios. Se repite con datos personales (sin recálculo) y sobre reservas `IN_PROGRESS`,
`COMPLETED`, `CANCELLED` y `NO_SHOW`, confirmando el bloqueo.

**Acceptance Scenarios**:

1. **Scenario**: Actualización de fechas o categoría con recálculo exitoso (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` con disponibilidad validada para las nuevas fechas
   - **When** el solicitante modifica las fechas o la categoría y el Módulo 3 devuelve la tarifa
     recalculada
   - **Then** el sistema muestra la tarifa de cada habitación afectada, como al crear la
     reserva, y, tras la confirmación, actualiza la reserva

2. **Scenario**: Modificación de datos personales sin afectación financiera
   - **Given** una `Reservation` en `ACTIVE` o `PENDING`
   - **When** el solicitante corrige datos del `Guest`
   - **Then** el sistema guarda los cambios sin invocar al Módulo 3 ni alterar fechas o categoría

3. **Scenario**: Cambio de estado solicitado por un proceso interno
   - **Given** una confirmación de pago OTA o una notificación de Check-In, Check-Out o No-Show válida
   - **When** el proceso correspondiente ejecuta "Actualizar reservación"
   - **Then** el sistema cambia el `status` a `CANCELLED`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED` o
     `NO_SHOW` según la transición permitida

4. **Scenario**: Bloqueo por falta de disponibilidad (Error)
   - **Given** que "Verificar disponibilidades" indica que la `Room` no está disponible en las
     nuevas fechas
   - **When** el solicitante intenta modificar las fechas
   - **Then** el sistema bloquea la confirmación y responde **HTTP 400 (Bad Request)** indicando la
     falta de disponibilidad

5. **Scenario**: Bloqueo de edición sobre reservas finalizadas o en curso (Error)
   - **Given** una `Reservation` en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`
   - **When** un solicitante intenta editarla
   - **Then** el sistema bloquea la edición con **HTTP 400** indicando que el estado actual no
     admite modificaciones

6. **Scenario**: Cambio de habitación con llegada hoy
   - **Given** una `Reservation` en `ACTIVE` con llegada hoy, con la `Room` A, y la `Room` B
     disponible en sus fechas
   - **When** el solicitante cambia la reserva a la `Room` B y confirma
   - **Then** el sistema actualiza la reserva a la `Room` B y avisa al Módulo 1 con una actualización
     `UPDATED` de la lista del día; el Módulo 1 decide qué hace con las habitaciones

7. **Scenario**: Cambio de habitación en una reserva con llegada futura
   - **Given** una `Reservation` en `ACTIVE` con llegada dentro de varias semanas y la `Room` B
     disponible en sus fechas
   - **When** el solicitante cambia la reserva a la `Room` B y confirma
   - **Then** el sistema actualiza la reserva a la `Room` B sin avisar al Módulo 1

8. **Scenario**: Agregar una habitación a la reserva
   - **Given** una `Reservation` en `ACTIVE` con la `Room` A y 2 personas, y la `Room` C disponible en
     sus fechas
   - **When** el solicitante agrega la `Room` C, indica 2 personas para la `Room` C y confirma la tarifa
     calculada por el Módulo 3 para la `Room` C
   - **Then** el sistema agrega la `Room` C a la reserva en `EXPECTED` con sus 2 personas, actualiza el total y guarda
     el `roomGrossAmount` de la `Room` C; si la llegada es hoy, avisa
     al Módulo 1 con una actualización `UPDATED` de la lista del día

9. **Scenario**: Quitar una habitación de la reserva
   - **Given** una `Reservation` en `ACTIVE` con las `Room` A y C y 4 personas
   - **When** el solicitante quita la `Room` C y confirma
   - **Then** el sistema quita la `Room` C (con su tarifa y sus personas) y actualiza el total; si la llegada es
     hoy, avisa al Módulo 1 con una actualización `UPDATED` de la lista del día

10. **Scenario**: Intento de quitar la única habitación (Error)
    - **Given** una `Reservation` con una sola habitación
    - **When** el solicitante intenta quitarla
    - **Then** el sistema responde **HTTP 400** con el mensaje "La reserva debe conservar al menos
      una habitación."

11. **Scenario**: Cambio solo de la cantidad de personas
    - **Given** una `Reservation` en `ACTIVE` con 2 habitaciones de capacidad máxima 2 cada una y
      3 personas
    - **When** el solicitante cambia a 2 las personas de la segunda habitación
    - **Then** el sistema guarda el cambio sin invocar al Módulo 3 ni verificar disponibilidad; si la
      llegada es hoy, avisa al Módulo 1 con una actualización `UPDATED`

12. **Scenario**: Cantidad de personas fuera de la capacidad (Error)
    - **Given** una `Reservation` con 2 habitaciones de capacidad máxima 2 cada una
    - **When** el solicitante cambia a 3 las personas de una habitación, o a 0
    - **Then** el sistema responde **HTTP 400** con el mensaje "La cantidad de personas supera la
      capacidad de la habitación." (3) o "Cada habitación debe tener al menos una persona." (0), sin
      guardar nada

---

### User Story 2 - Sincronización del Estado por Notificaciones de Check-In y Check-Out (Priority: P2)

El Módulo 1 registra el Check-In y el Check-Out de cada habitación y notifica al Módulo 2 para que
cambie el estado de la habitación dentro de la reserva (`stayStatus`) y el estado de la
`Reservation` (`IN_PROGRESS` y `COMPLETED`) y, en el Check-In de un huésped extranjero, consolide
sus datos migratorios mediante "Procesar datos de huéspedes extranjeros", sin duplicar el proceso
presencial en pantallas diferentes. Por tratarse de notificaciones de una misma naturaleza, los
caminos exitosos, las reservas con varias habitaciones, los duplicados y los rechazos por estado
inválido se consolidan en esta misma historia de usuario.

**Why this priority**: Es vital para mantener la coherencia del estado de la reserva y cerrar su
ciclo de vida sin duplicar la operación física, que pertenece al Módulo 1. Sin ella las reservas
quedan desactualizadas o eternamente "en curso" y el reporte gubernamental incompleto.

**Independent Test**: Con una reserva de dos habitaciones, se envía la notificación de Check-In de
la primera y se valida que la reserva pase a `IN_PROGRESS` y esa habitación a `CHECKED_IN`; se envía
la de la segunda y se valida que la reserva siga en `IN_PROGRESS`. Se envía el Check-Out de la
primera y se valida que la reserva siga en `IN_PROGRESS`; se envía el de la segunda y se valida que
pase a `COMPLETED`, sin afectar el estado de las `Room`, que gestiona el Módulo 1.

**Acceptance Scenarios**:

1. **Scenario**: Check-In de la primera habitación (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` con sus habitaciones en `EXPECTED`
   - **When** el sistema recibe la notificación del Módulo 1 con la `reservationRef` y el `roomId`
     de una de ellas, indicando que el Check-In se completó
   - **Then** el sistema cambia esa habitación a `CHECKED_IN` y la `Reservation` a `IN_PROGRESS`

2. **Scenario**: Check-In de otra habitación de la misma reserva
   - **Given** una `Reservation` en `IN_PROGRESS` con la `Room` A en `CHECKED_IN` y la `Room` B en
     `EXPECTED`
   - **When** el sistema recibe la notificación de Check-In de la `Room` B
   - **Then** el sistema cambia la `Room` B a `CHECKED_IN` y la reserva sigue en `IN_PROGRESS`

3. **Scenario**: Recepción de datos de huéspedes extranjeros en el Check-In
   - **Given** una `Reservation` con dos huéspedes extranjeros en proceso de Check-In
   - **When** la notificación incluye los datos migratorios de los dos, con `movementType` `ENTRY`
     y la fecha de ingreso
   - **Then** el sistema los valida y registra, mediante "Procesar datos de huéspedes extranjeros",
     un `MigratoryMovement` de entrada por cada uno, para su futura exportación SIRE

3a. **Scenario**: Recepción de datos de huéspedes extranjeros en el Check-Out
   - **Given** una habitación en `CHECKED_IN` con dos huéspedes extranjeros
   - **When** la notificación de Check-Out incluye los datos de los dos con `movementType`
     `DEPARTURE` y la fecha de salida
   - **Then** el sistema registra un `MigratoryMovement` de salida por cada uno, sin modificar sus
     movimientos de entrada

4. **Scenario**: Check-In duplicado (idempotente)
   - **Given** una habitación de la reserva ya en `CHECKED_IN`
   - **When** el sistema recibe de nuevo la notificación de Check-In de esa habitación
   - **Then** el sistema responde 200 sin cambiar estados

5. **Scenario**: Rechazo de Check-In con estado inválido (Error)
   - **Given** una `Reservation` en `PENDING`, `COMPLETED`, `CANCELLED` o `NO_SHOW`
   - **When** el Módulo 1 envía una notificación de Check-In retrasada o prematura
   - **Then** el sistema no cambia el estado, responde **HTTP 400 (Bad Request)** indicando que la
     reserva no admite un Check-In en su estado actual y deja el caso en el log

6. **Scenario**: Check-In de una habitación que no pertenece a la reserva (Error)
   - **Given** una `Reservation` en `ACTIVE` con las `Room` A y B
   - **When** el Módulo 1 notifica el Check-In de la reserva con la `Room` D
   - **Then** el sistema no cambia nada, responde **HTTP 400** con el mensaje "La habitación
     notificada no pertenece a la reserva." y lo deja en el log

7. **Scenario**: Check-Out de la última habitación (Happy Path)
   - **Given** una `Reservation` en `IN_PROGRESS` cuya única habitación en `CHECKED_IN` es la `Room`
     A, y las demás en `CHECKED_OUT` o `NOT_ARRIVED`
   - **When** el sistema recibe la notificación del Módulo 1 con la `reservationRef` y el `roomId`
     de la `Room` A indicando que el Check-Out finalizó
   - **Then** el sistema cambia la `Room` A a `CHECKED_OUT` y la `Reservation` a `COMPLETED`

8. **Scenario**: Check-Out parcial de una reserva con varias habitaciones
   - **Given** una `Reservation` en `IN_PROGRESS` con las `Room` A y B en `CHECKED_IN`
   - **When** el sistema recibe el Check-Out de la `Room` A
   - **Then** el sistema cambia la `Room` A a `CHECKED_OUT` y la reserva sigue en `IN_PROGRESS`;
     cuando llegue el Check-Out de la `Room` B, la reserva pasa a `COMPLETED`

9. **Scenario**: Check-Out de una habitación que no ha ingresado (Error)
   - **Given** una `Reservation` en `IN_PROGRESS` con la `Room` A en `CHECKED_IN` y la `Room` B en
     `EXPECTED`
   - **When** el Módulo 1 notifica el Check-Out de la `Room` B
   - **Then** el sistema no cambia nada, responde **HTTP 400** con el mensaje "La habitación
     notificada aún no registra un ingreso." y lo deja en el log

10. **Scenario**: Rechazo de Check-Out para reservas sin ingreso (Error)
    - **Given** una `Reservation` en `ACTIVE` o `PENDING`
    - **When** el Módulo 1 envía una notificación de Check-Out
    - **Then** el sistema prohíbe el cambio de estado, responde **HTTP 400** informando que la
      reserva aún no registra un ingreso, y lo deja en el log

11. **Scenario**: Check-Out duplicado (idempotente)
    - **Given** una habitación de la reserva ya en `CHECKED_OUT`
    - **When** el sistema recibe de nuevo la notificación de Check-Out de esa habitación
    - **Then** el sistema responde 200 sin efectos nuevos, porque la salida ya fue registrada

---

### User Story 3 - Cierre Automático del Día: No-Show (Priority: P2)

El sistema, sin intervención humana, identifica al cierre del día las reservas esperadas que no
registraron ingreso físico (una reserva que no se presentó), las marca como `NO_SHOW`, sea OTA o
directa. En las reservas con varias habitaciones donde
solo llegó una parte del grupo, marca como `NOT_ARRIVED` las habitaciones que no ingresaron, sin
cambiar el estado de la reserva. El Módulo 1 libera las habitaciones por su cuenta. Por tratarse de un único proceso automático en lote, el
camino exitoso, las llegadas parciales y el manejo de fallos individuales se consolidan en esta misma historia de usuario.

**Why this priority**: Es una automatización necesaria para mantener la salud del inventario y las
métricas de ocupación, aunque no bloquea la operación diaria de reservas.

**Independent Test**: Se simula el cierre del día y se verifica que el proceso recorra las reservas
del día, marque como `NO_SHOW` las reservas, de cualquier canal, que no
tuvieron ingreso, marque `NOT_ARRIVED` las habitaciones sin ingreso de las reservas `IN_PROGRESS`,
sin enviar ninguna orden de liberación al Módulo 1.

**Acceptance Scenarios**:

1. **Scenario**: Cambio automático a No-Show de una reserva que no se presentó (Happy Path)
   - **Given** una `Reservation`, de canal `OTA` o `DIRECT`, con `startDate` de hoy, que sigue en
     `ACTIVE` o `PENDING`
   - **When** el sistema ejecuta el proceso de fin de día
   - **Then** el sistema cambia la reserva a `NO_SHOW`, marca todas sus habitaciones como
     `NOT_ARRIVED` y avisa `REMOVED` (motivo `NO_SHOW`) en la lista del día

3. **Scenario**: Llegada parcial de un grupo
   - **Given** una `Reservation` de hoy en `IN_PROGRESS` con la `Room` A en `CHECKED_IN` y la `Room`
     B en `EXPECTED`
   - **When** se ejecuta el proceso de fin de día
   - **Then** el sistema marca la `Room` B como `NOT_ARRIVED` y la reserva sigue en `IN_PROGRESS` por la `Room` A

4. **Scenario**: Reserva en curso con todas sus habitaciones ingresadas
   - **Given** una `Reservation` de hoy en `IN_PROGRESS` con todas sus habitaciones en `CHECKED_IN`
   - **When** se ejecuta el proceso de fin de día
   - **Then** el sistema la ignora y mantiene su estado, porque todo el grupo ingresó

5. **Scenario**: Fallo aislado dentro del lote (Error)
   - **Given** un lote de reservas donde una presenta datos corruptos
   - **When** el sistema las procesa una por una
   - **Then** el sistema captura el error del registro corrupto, deja un log de advertencia
     controlado, y continúa con el resto sin interrumpir el proceso

### Casos Borde

**Modificación**

- ¿Qué sucede cuando el Módulo 3 no responde durante el recálculo? El sistema detiene la
  confirmación financiera y responde **HTTP 400** con el mensaje: "No se pudo calcular la nueva
  tarifa en este momento. Intente más tarde." Si la reserva tiene varias habitaciones y falla la
  cotización de una sola, no se aplica ningún cambio.
- ¿Qué sucede si se envían fechas inválidas (salida antes de llegada, o vacías)? El sistema rechaza
  la solicitud con **HTTP 400**: "La fecha de salida debe ser posterior a la de entrada.", sin
  consultar al Módulo 3.
- ¿Qué sucede si la nueva fecha de entrada es anterior a hoy? El sistema rechaza la solicitud con
  **HTTP 400**: "La fecha de entrada no puede ser anterior a hoy.", sin consultar disponibilidad ni al
  Módulo 3. "Hoy" es el día operativo en el momento de modificar la reserva, no una fecha fija: la
  fecha mínima de entrada avanza cada día, igual que al crear la reserva.
- ¿Qué sucede si se ingresan caracteres extraños en los datos del huésped o en `notes`? El sistema
  los rechaza antes de guardar con **HTTP 400**: "El formato de los datos contiene caracteres no
  válidos."
- ¿Qué sucede si `notes` supera los 500 caracteres? El sistema responde **HTTP 400**: "Las
  observaciones no pueden superar 500 caracteres."
- ¿Qué sucede si se intenta agregar una habitación que ya está en la reserva? El sistema responde
  **HTTP 400**: "La habitación ya forma parte de la reserva."
- ¿Qué sucede si al agregar habitaciones la reserva supera el máximo de 10 habitaciones? El sistema
  responde **HTTP 400**: "Una reserva lleva entre 1 y 10 habitaciones."
- ¿Qué sucede si al cambiar las fechas una sola de las habitaciones no está disponible? El cambio
  completo se rechaza con **HTTP 400** indicando qué habitación no está disponible; no se aplican
  cambios parciales.
- ¿Qué sucede si se agregan o cambian habitaciones y el `guestCount` de alguna supera su capacidad? El
  sistema responde **HTTP 400** con el mensaje de capacidad y no guarda nada; el solicitante debe
  ajustar las personas en la misma modificación.
- ¿Cómo maneja el sistema dos ediciones simultáneas de la misma reserva? Usa control de concurrencia
  optimista con el atributo `updatedAt`: la segunda recibe **HTTP 400** indicando que debe recargar.
- ¿Qué sucede con el Módulo 1 cuando solo cambian las fechas? Por lo general nada. Las únicas
  excepciones son las que cruzan el día actual: si la nueva llegada es hoy, el sistema avisa `ADDED`
  en la lista del día; si la llegada era hoy y deja de serlo, avisa `REMOVED` (motivo
  `DATE_CHANGED`). Un cambio de habitaciones en una reserva con llegada futura tampoco se avisa.
- ¿Cómo se coordina con el Módulo 1 un cambio, la adición o la eliminación de una habitación en una
  reserva con llegada hoy? El cambio se aplica en el Módulo 2 y se avisa con una actualización
  `UPDATED` de la lista del día. El Módulo 2 no le ordena nada al Módulo 1: él decide qué hace con
  las habitaciones.

**Check-In y Check-Out**

- ¿Qué sucede si la notificación de Check-In o de Check-Out llega vacía, sin la `reservationRef` o
  sin el `roomId`? El sistema intercepta el error de inmediato y responde **HTTP 400** con el
  mensaje: "El payload de notificación es inválido. Falta el identificador de la reserva o de la
  habitación.", sin producir errores **HTTP 500**.
- ¿Qué sucede en una reserva con varias habitaciones? Cada notificación trae solo los huéspedes de
  su habitación; los movimientos se identifican por reserva, huésped y tipo de movimiento, según
  "Procesar datos de huéspedes extranjeros".
- ¿Qué sucede si la reserva notificada no existe en el Módulo 2? El sistema responde **HTTP 400**
  con el mensaje "La reserva notificada no existe en el sistema de reservas." (Check-In) o
  "Referencia de reserva no encontrada" (Check-Out), y lo deja en el log;
  el Módulo 1 ya ejecutó físicamente el proceso.
- ¿Qué sucede si la reserva está en `CANCELLED`, `NO_SHOW`, `PENDING` o `COMPLETED` al llegar un
  Check-In? Responde **HTTP 400** sin cambiar el estado y lo deja en el log: la
  habitación quedó ocupada en el Módulo 1 sin una reserva vigente, y la Recepcionista decide qué hacer
  (por ejemplo, crear una reserva nueva).
- ¿Qué sucede si llega el Check-In de una habitación marcada `NOT_ARRIVED` (el huésped llegó
  después del cierre del día)? El sistema responde **HTTP 400** sin cambiar estados y lo deja en el log,
  porque la habitación ya fue liberada y la reserva de esa habitación se perdió.
- ¿Qué sucede si la notificación de Check-In llega antes de la fecha de inicio de la estadía? El
  sistema la procesa normalmente, porque el Check-In físico ya ocurrió en el Módulo 1, que es quien
  valida las fechas de ingreso.
- ¿Qué sucede si la notificación de Check-Out llega con horas de retraso por un problema de red? El
  sistema la procesa normalmente si la habitación sigue `CHECKED_IN`, de forma transaccional.
- ¿Qué sucede si se notifica el Check-Out de una reserva `CANCELLED` o `NO_SHOW`? El sistema la
  rechaza con **HTTP 400** y lo deja en el log, porque nunca tuvo un ingreso.
- ¿Qué sucede si todas las habitaciones que ingresaron ya salieron pero queda alguna en
  `EXPECTED`? La reserva sigue en `IN_PROGRESS` hasta el cierre del día de su llegada, que marca
  esas habitaciones como `NOT_ARRIVED` y pasa la reserva a `COMPLETED`.

**Cierre del día**

- ¿Qué sucede si el proceso de cierre del día se ejecuta dos veces el mismo día? El sistema es
  idempotente: ignora las reservas que ya no están en `ACTIVE` o `PENDING` y las habitaciones que ya
  no están en `EXPECTED`, y responde exitosamente, sin errores.
- ¿Qué sucede si la zona horaria del servidor difiere de la de Colombia? El sistema usa siempre la
  zona horaria de Colombia (UTC-5), evitando marcar como no presentadas reservas cuyo día aún no
  termina, y emite una alerta de negocio si las zonas son inconsistentes.
- ¿Qué ocurre si la base de datos pierde conexión durante el procesamiento masivo del cierre del
  día? El sistema detiene el proceso de forma transaccional, sin marcar reservas a medias, y emite
  alertas controladas sin exponer detalles de infraestructura.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir, sobre una `Reservation` en `ACTIVE` o `PENDING`, editar las
  fechas, agregar, quitar o cambiar habitaciones, cambiar el `guestCount` de cada habitación, corregir los datos
  personales del `Guest` titular (`firstName`, `lastName`, `documentType`, `documentNumber`, `contactPhone`,
  `contactEmail` — no `nationality`), y editar `notes` (máximo 500 caracteres).
- **FR-001a**: El sistema debe rechazar con **HTTP 400** que la Recepcionista modifique una reserva
  de canal `OTA`: esas reservas solo las modifica la Ota que las originó, por su API.

- **FR-002**: El sistema debe validar la disponibilidad mediante "Verificar disponibilidades" de
  cada habitación que quedaría en la reserva cuando cambien las fechas, y de cada habitación nueva
  cuando se agregue o cambie una habitación, enviando la `reservationRef` de la reserva editada para
  excluirla del cruce de solapamientos. Si una sola habitación no está disponible, debe rechazar el
  cambio completo.
- **FR-003**: El sistema debe invocar "Calcular tarifa dinámica" del Módulo 3 por cada habitación
  afectada cuando cambien las fechas, se agregue una habitación o una habitación cambie de categoría,
  mostrar la tarifa de cada una con el mismo detalle de la cotización que al crear la reserva, sin
  mostrar la tarifa nueva, sin calcular diferencias (el Módulo 2 no calcula
  nada financiero: el valor a pagar lo calcula el Módulo 3 al recibir el Check-Out del Módulo 1), y exigir
  la confirmación del solicitante antes de persistir. Cambiar una habitación por otra de la misma categoría, sin cambiar
  las fechas, no recotiza ni muestra tarifa.
- **FR-004**: El sistema debe permitir modificar el `guestCount` de las habitaciones, los datos personales del `Guest`
  y `notes` sin invocar al Módulo 3 ni exigir disponibilidad.
- **FR-004a**: El sistema debe exigir que las fechas de una reserva modificada cumplan que la fecha
  de entrada sea igual o posterior al día operativo en curso en el momento de modificarla (no a una
  fecha fija) y que la fecha de salida sea posterior a la de entrada, respondiendo **HTTP 400** con el
  mensaje correspondiente en caso contrario.
- **FR-005**: El sistema debe validar, al crear o cambiar habitaciones o su `guestCount`, que la
  reserva conserve entre 1 y 10 habitaciones, sin habitaciones repetidas, y que el `guestCount` de
  cada habitación sea al menos 1 y no supere su `maxCapacity` (el de la reserva es la suma),
  respondiendo **HTTP 400** con el mensaje correspondiente en caso contrario.
- **FR-006**: El sistema debe ser el punto de cambio de `status` de la reserva para la confirmación
  OTA, el Check-In, el Check-Out y el No-Show, aceptando las
  transiciones `PENDING`→`ACTIVE`, `ACTIVE`→`IN_PROGRESS`, `IN_PROGRESS`→`COMPLETED`, `ACTIVE` o
  `PENDING`→`NO_SHOW` (No-Show de cualquier canal); cualquier otra transición debe rechazarse con **HTTP
  400**. La cancelación explícita la ejecuta "Cancelar reservación" directamente, con las mismas
  transiciones y el mismo control de concurrencia.
- **FR-007**: El sistema debe llevar el `stayStatus` de cada `ReservationRoom` con las transiciones
  `EXPECTED`→`CHECKED_IN` (Check-In de la habitación), `CHECKED_IN`→`CHECKED_OUT` (Check-Out de la
  habitación) y `EXPECTED`→`NOT_ARRIVED` (cierre del día); cualquier otra transición debe
  rechazarse.
- **FR-008**: El sistema debe aplicar control de concurrencia optimista mediante `updatedAt`.
- **FR-009**: El sistema no debe ordenar al Módulo 1 que aparte o libere habitaciones por cambios,
  adiciones o eliminaciones de habitaciones: el cambio se aplica en el Módulo 2 y se avisa con
  `UPDATED` en la lista del día.
- **FR-010**: El sistema debe interceptar excepciones de validación, concurrencia e integración,
  respondiendo **HTTP 400 (Bad Request)** y prohibiendo errores **HTTP 500**.
- **FR-011**: El sistema no debe avisar al Módulo 1 por cambios de habitaciones en una reserva con
  llegada futura, y solo debe avisar un cambio de fechas (`ADDED` o `REMOVED`) cuando este haga que
  la llegada pase a ser hoy o deje de serlo.
- **FR-012**: El sistema debe avisar al Módulo 1, mediante "Enviar reservas del día al Módulo 1",
  cada modificación confirmada de una reserva que forme parte de la lista del día (`UPDATED`), que
  entre en ella (`ADDED`) o que salga de ella (`REMOVED`), y cada No-Show total del cierre del día
  (`REMOVED` con motivo `NO_SHOW`).
- **FR-013**: El sistema no debe ofrecer una interfaz para el Check-In ni el Check-Out físicos: debe
  limitarse a exponer servicios que reciban las notificaciones del Módulo 1.
- **FR-014**: El sistema debe exigir en cada notificación de Check-In y de Check-Out la
  `reservationRef` y el `roomId`, y validar que el `roomId` pertenezca a la reserva.
- **FR-015**: Al procesar un Check-In, el sistema debe validar que la `Reservation` esté en
  `ACTIVE` o `IN_PROGRESS` y que la habitación esté en `EXPECTED`; debe cambiar la habitación a
  `CHECKED_IN` y, si es la primera en ingresar, la reserva a `IN_PROGRESS`. Si la habitación ya está
  en `CHECKED_IN`, la notificación es un duplicado idempotente (200 sin efectos). En cualquier otro caso (reserva inexistente o en otro
  estado, habitación ajena o `NOT_ARRIVED`) debe responder **HTTP 400** sin cambiar estados y
  dejarlo en el log, porque el efecto físico ya ocurrió en el Módulo 1.
- **FR-016**: El sistema debe recibir y validar, en la misma notificación de Check-In y de
  Check-Out, los datos migratorios de cada huésped extranjero de la habitación (`ENTRY` en el
  Check-In, `DEPARTURE` en el Check-Out), registrándolos mediante "Procesar datos de huéspedes
  extranjeros". Da por hecho que esos datos llegan completos y correctos del Módulo 1, y responde 200.
- **FR-017**: Al procesar un Check-Out, el sistema debe validar que la `Reservation` esté en
  `IN_PROGRESS` y la habitación en `CHECKED_IN`; debe cambiar la habitación a `CHECKED_OUT` y, si ya
  no queda ninguna habitación en `CHECKED_IN` ni en `EXPECTED`, la reserva a `COMPLETED`. Si la
  habitación ya está en `CHECKED_OUT` debe responder 200 sin efectos (idempotencia), y en cualquier
  otro caso debe responder **HTTP 400** y dejarlo en el log. No debe
  modificar el estado de la `Room`, que gestiona el Módulo 1.
- **FR-018**: El sistema debe ejecutar un proceso automático al cierre del día operativo (día
  calendario de Colombia, 00:00 a 23:59, UTC-5), que recorra las `Reservation` cuya `startDate` corresponda al día
  procesado.
- **FR-019**: En ese proceso, para cada reserva en `ACTIVE` o `PENDING`, el sistema debe cambiar el
  `status` a `NO_SHOW` (sea cual sea el canal) y marcar
  todas sus habitaciones como `NOT_ARRIVED`; para cada reserva en `IN_PROGRESS`, debe marcar como
  `NOT_ARRIVED` las habitaciones en `EXPECTED` y pasar la reserva a `COMPLETED` si ya no queda
  ninguna en `CHECKED_IN`.
- **FR-020**: El sistema no debe ordenar al Módulo 1 que libere habitaciones: las habitaciones marcadas
  `NOT_ARRIVED` y las reservas `NO_SHOW` se quitan de la lista del día (`REMOVED`) y el Módulo 1 decide
  qué hace con ellas.
- **FR-021**: El sistema no debe registrar una `Cancellation` por un No-Show: la reserva queda en
  `NO_SHOW`, no en `CANCELLED`.
- **FR-022**: El sistema debe procesar cada registro del lote del cierre del día con manejo
  individual de excepciones, de modo que un error de validación no interrumpa el lote ni exponga
  errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La recotización integrada con el Módulo 3 debe completarse en menos de 3 segundos en
  condiciones normales, para reservas de hasta 10 habitaciones.
- **NFR-002**: El procesamiento de cada notificación de Check-In o de Check-Out debe completarse en
  menos de 500 milisegundos.
- **NFR-003**: El proceso del cierre del día debe ser idempotente y completar un lote de hasta 1000
  reservas en menos de 1 minuto.

### Key Entities *(include if feature involves data)*

- **Reservation**: Entidad principal actualizada. Atributos: `reservationRef`, `guestRef`,
  `guestCount` (suma de los de sus habitaciones), `startDate`, `endDate`, `updatedAt`,
  `source` (`DIRECT` | `OTA`), `notes` y `status` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **ReservationRoom**: Habitación de la reserva. Atributos: `reservationRef`, `roomId`,
  `roomNumber`, `categoryRoom`, `roomGrossAmount` (tarifa de la habitación, solo canal `DIRECT`),
  `quoteId` (cotización que dio esa tarifa, solo canal `DIRECT`) y `stayStatus`
  (`EXPECTED` | `CHECKED_IN` | `CHECKED_OUT` | `NOT_ARRIVED`).
- **Guest**: Titular de la reserva. Atributos: `id`, `firstName`, `lastName`, `documentType`, `documentNumber`, `nationality`,
  `contactPhone`, `contactEmail`.
- **Room**: Habitación física controlada por el Módulo 1, referenciada para la disponibilidad: el
  Módulo 1 la pasa a `Occupied` en el Check-In y la libera en el Check-Out, y maneja `Reserved` y
  `Available` por su cuenta. Atributos: `id`, `roomNumber`, `categoryRoom`, `maxCapacity` y `status`
  (`Available` | `Reserved` | `Occupied`).
- **RateQuote**: Cotización del Módulo 3 para cada habitación afectada por la modificación.
  Atributos: `quoteId`, `nightlyRates` (lista de `date` y `rate`) y `lodgingAmount`. Al confirmar, el
  `quoteId` nuevo reemplaza al anterior en la habitación.
- **MigratoryMovement**: Movimiento migratorio de entrada o salida de un huésped extranjero,
  registrado en el Check-In y en el Check-Out mediante "Procesar datos de huéspedes extranjeros".
  Atributos: `movementId`, `reservationRef`, `movementType` (`ENTRY` | `DEPARTURE`), `movementDate`,
  los datos migratorios del huésped. El
  detalle de sus atributos está en "Procesar datos de huéspedes extranjeros".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El solicitante completa la actualización de fechas y tarifa en menos de 1 minuto una
  vez recibida la cotización del Módulo 3.
- **SC-002**: El 100% de los cambios de `status` y de `stayStatus` cumplen con las transiciones
  permitidas y con la nomenclatura unificada de estados.
- **SC-003**: El 100% de los intentos inválidos (fechas pasadas, falta de disponibilidad, capacidad
  excedida, reservas finalizadas) responden **HTTP 400**, con cero errores **HTTP 500**.
- **SC-004**: Cero discrepancias financieras entre el Módulo 2 y el Módulo 3 tras actualizaciones
  exitosas.
- **SC-005**: El 100% de las notificaciones de Check-In y de Check-Out válidas del Módulo 1
  actualizan la habitación y la reserva según FR-015 y FR-017, y el 100% de la información
  migratoria completa enviada en el Check-In y en el Check-Out se registra en `MigratoryMovement` sin
  intervención manual.
- **SC-006**: El 100% de las notificaciones que no pueden aplicarse quedan en el log, con cero errores **HTTP 500** ante payloads mal formados o reservas
  inexistentes.
- **SC-007**: El 100% de las reservas y habitaciones sin ingreso al
  finalizar el día quedan marcadas (`NO_SHOW` la reserva, `NOT_ARRIVED` la
  habitación), y ninguna reserva queda en `ACTIVE` más allá del cierre
  de su día de llegada.
- **SC-008**: El 100% de las modificaciones de reservas de la lista del día llegan al Módulo 1 como
  actualización de la lista.
