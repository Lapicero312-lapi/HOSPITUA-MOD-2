# Acuerdos a cerrar con el Módulo 1

**Date**: 2026-09-29  
**De**: equipo del Módulo 2 (Operación de Reservas y Cumplimiento Legal)  
**Para**: equipo del Módulo 1 (Gestión de Habitaciones e Inventario de Aforo)  
**Fuente**: [diccionario.md](../diccionario.md) y los specs de este repositorio. Las decisiones pendientes
están numeradas como en [decisiones-pendientes.md](./decisiones-pendientes.md).

## 1. Resumen

Los dos módulos comparten habitaciones, reservas, Check-In, Check-Out y datos de huéspedes extranjeros.
Para que la lógica sea la misma en ambos lados, necesitamos que el Módulo 1 confirme **cinco cosas**:

1. **Datos migratorios completos.** Los huéspedes extranjeros llegan ya procesados y completos, y el
   Módulo 2 da por hecho que llegan bien: no los valida ni los devuelve. Además de los
   campos anteriores, ahora se exige **procedencia y destino**.
2. **Check-In y Check-Out por habitación**, con el `roomId` y la lista de huéspedes extranjeros en la
   misma notificación.
3. **La lista de reservas del día llega por cola.** El Módulo 1 solo consulta al Módulo 2 las reservas entre una fecha de inicio y una de fin (y, si quiere, de una habitación) cuando registra un mantenimiento, para saber si cae sobre alguna reserva. La lógica sobre qué hacer con esa reserva la aplica el Módulo 1.
4. **El estado `Reserved`** debe existir en `Room.status`.
5. **El día operativo es fijo**: de 00:00 a 23:59, hora de Colombia (UTC-5).

## 2. Reglas que ambos módulos deben manejar igual

| Tema | Regla común |
|---|---|
| Día operativo | Día calendario de Colombia, 00:00 a 23:59 (UTC-5). La lista del día sale a las 00:00; el cierre del día (No-Show y habitaciones no llegadas) ocurre al terminar las 23:59. No es configurable. |
| Fechas | Fecha sin hora, formato `AAAA-MM-DD`, en hora de Colombia. `movementDate` es `checkInDate` en la entrada y `checkOutDate` en la salida. |
| Identificadores | `reservationRef` identifica la reserva en los dos módulos. `roomId` es el `Room.id` del Módulo 1. |
| Quién manda sobre qué | El Módulo 1 es dueño de `Room.status`, del calendario de mantenimientos, del Check-In y Check-Out físicos y de los datos migratorios. El Módulo 2 es dueño de `Reservation.status` y de `ReservationRoom.stayStatus`. |
| Estado de la reserva | `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. No hay otros valores ni alias. |
| Estado de cada habitación en la reserva | `EXPECTED`, `CHECKED_IN`, `CHECKED_OUT`, `NOT_ARRIVED`. No es el estado físico de la `Room`. |
| Estados de `Room` | `Available`, `Reserved` (por aprobar), `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`. |
| Reserva con varias habitaciones | Entre 1 y 10 habitaciones, mismas fechas. Cada Check-In y Check-Out se notifica **por habitación**. |
| Duplicados y orden | Todo mensaje lleva un identificador único (`messageId` o `requestId`) y un `sequenceNumber` creciente. Quien recibe descarta duplicados y aplica en orden. |

## 3. Lo que el Módulo 1 nos envía

### 3.1 Check-In y Check-Out (`habitacion.checkin` y `habitacion.checkout`) — B9, B13, B15

Una notificación por habitación. Cada una debe traer:

- `reservationRef` y `roomId` (obligatorios los dos; el `roomId` debe pertenecer a la reserva).
- `foreignGuests`: la lista de huéspedes **extranjeros** que ingresan (Check-In) o salen (Check-Out) por esa
  habitación. Incluye a los acompañantes, no solo al titular.

Cada huésped de `foreignGuests` debe traer **los diez campos**:

| Campo | Detalle |
|---|---|
| `firstName`, `lastName` | Nombres y apellidos. |
| `documentType`, `documentNumber` | Tipo y número de documento. |
| `birthDate` | Fecha de nacimiento, pasada. |
| `nationality` | El Módulo 1 identifica al extranjero por nacionalidad distinta de Colombia. |
| `movementType` | `ENTRY` en el Check-In, `DEPARTURE` en el Check-Out. Lo asigna el Módulo 1, no la Recepcionista. |
| `movementDate` | Fecha de llegada o de salida. No puede ser futura. |
| `originPlace`, `destinationPlace` | **Nuevo:** procedencia y destino. SIRE los exige y rechaza el registro si vienen vacíos. |

Reglas:

- **Ya procesados y completos.** El Módulo 1 no arma ni envía el huésped si le falta un dato.
- **Sin devoluciones.** El Módulo 2 registra los datos tal como llegan. Es idempotente: recibir de nuevo un
  huésped ya registrado no lo duplica.
- Un huésped tiene, por reserva, un solo `ENTRY` y un solo `DEPARTURE`, aunque cambie de habitación.
- Una reserva de titular colombiano puede tener acompañantes extranjeros: se registran igual.
- Una notificación duplicada de una habitación ya en `CHECKED_IN` o `CHECKED_OUT` se responde 200 sin
  cambiar estados.
- Si la reserva no existe, o está en `CANCELLED`, `NO_SHOW`, `PENDING` o `COMPLETED` al llegar un
  Check-In, el Módulo 2 responde error y registra una incidencia de conciliación: la habitación quedó
  ocupada sin una reserva vigente y una persona debe resolverlo con el Módulo 1.
- Si llega el Check-In de una habitación ya marcada `NOT_ARRIVED` (llegó después del cierre del día), se
  rechaza con la misma incidencia.

### 3.2 Respuesta a las órdenes de estado de habitación — B7, B8

Cuando el Módulo 2 ordena `Reserved` o `Available` (ver 4.2), el Módulo 1 debe:

- Confirmar el cambio, o **rechazarlo** con motivo (`ROOM_OCCUPIED` si la habitación está ocupada).
- Aplicar una orden **solo si su `sequenceNumber` es mayor que el de la última aplicada** para esa
  habitación; las obsoletas se rechazan (`OBSOLETE`).
- Ser idempotente por `requestId`: repetir una orden no la aplica dos veces.
- Permitir **consultar el resultado de una orden por `requestId`**, para que el Módulo 2 resuelva las
  órdenes cuyo resultado quedó ambiguo (timeout, falla de red).

## 4. Lo que el Módulo 1 recibe del Módulo 2

### 4.1 Lista de reservas del día y sus actualizaciones — B14

- **Lista (`DailyReservationList`)**: se envía **una vez por día operativo, a las 00:00**, por cola y sin
  respuesta. Trae las reservas `ACTIVE` con llegada ese día. Se envía aunque no haya reservas (totales en
  `0`) y no se reenvía si el proceso corre de nuevo el mismo día.
  - Cabecera: `messageId`, `operationalDate`, `generatedAt`, `sequenceNumber` (siempre `1`),
    `totalReservations`, `totalRooms`, `totalGuests`.
- **Actualizaciones (`DailyReservationUpdate`)**: una por cada cambio confirmado que afecte esa lista.
  - `ADDED`: entra una reserva (creación directa para hoy, confirmación OTA con llegada hoy, cambio de
    llegada a hoy).
  - `UPDATED`: cambia un dato de la reserva de la lista.
  - `REMOVED`: sale, con motivo `CANCELLED`, `DATE_CHANGED` o `NO_SHOW`.
  - Llevan `messageId` y `sequenceNumber` creciente dentro del día.
- **Por cada reserva**: `reservationRef`, `status`, `source`, `externalConfirmationCode` (solo OTA),
  `startDate`, `endDate`, noches, `guestCount`, `lateArrivalNotice` (siempre `false` en las OTA), `notes` y `updatedAt`; por cada
  habitación `roomId`, `roomNumber` y `categoryRoom`; y el titular con `guestRef`, `fullName`,
  `documentType`, `documentNumber`, `nationality`, `contactPhone` y `contactEmail`.
- **Sin datos financieros** (ni tarifas ni comisión). Es **informativa**: no aparta ni libera
  habitaciones y no cambia estados.
- No se envían actualizaciones por el Check-In, el Check-Out ni por cambios de reservas cuya llegada no es
  hoy.
- **Cambia para el Módulo 1:** deja de consultar `GET /api/reservations`. La Recepcionista y los procesos
  internos son los únicos que consultan reservas en el Módulo 2.

### 4.2 Órdenes de estado de habitación (`RoomStateRequest`) — B1, B7

- Solo dos valores: `Reserved` y `Available`. El Módulo 2 **nunca** ordena `Occupied` ni estados de
  limpieza: los cambia el Módulo 1 en el Check-In y el Check-Out.
- `Reserved`: solo cuando la llegada es el día operativo en curso (al crear una reserva para hoy, o a las
  00:00 para las reservas con llegada hoy). Trae el detalle de la reserva. Una orden por habitación.
- `Available`: de inmediato, cuando se cancela una reserva o hay No-Show, o cuando una habitación pasa a
  `NOT_ARRIVED` o se quita de una reserva con llegada hoy. Solo si la habitación sigue apartada por esa
  misma reserva (`previousStatus` `Reserved` y `reservationRef` coincidente).
- Cada orden lleva: `requestId`, `roomId`, `requestedStatus`, `previousStatus`, `originEvent`,
  `reservationRef`, `sequenceNumber` (creciente y único por habitación), `requestedAt` y `requestedBy`.
- El Módulo 2 envía las órdenes de una misma habitación **de una en una, en orden**: no envía la N+1
  hasta que la N esté `COMPLETED` o `REJECTED`.
- Si el Módulo 1 rechaza un `Reserved` de una reserva recién creada, esa reserva se cancela (todo o
  nada). Si rechaza el de un cambio de habitación, el cambio se aborta y la reserva original se conserva.
- **Requisito:** el estado `Reserved` debe existir en `Room.status`. Sin él, las reservas con llegada hoy
  fallan y se cancelan (B1).

## 5. Lo que el Módulo 1 expone (consultas del Módulo 2) — B2, B3, B4, B5, B6, B12

El Módulo 2 consulta antes de crear o modificar cualquier reserva, **una vez por habitación**.

| Consulta | Datos que necesitamos | A acordar |
|---|---|---|
| **Inventario de habitaciones** | `id`, `roomNumber`, `categoryRoom`, **`maxCapacity`**, `status` y `reservedByReservationRef` (solo en `Reserved`). | Rutas y campos. No enviamos fechas: el estado físico es del instante actual (B2). Necesitamos consulta puntual **y listado por categoría, completo o filtrado por estado** (B3). Una categoría inexistente debe devolver lista vacía, no error (B4). `maxCapacity` es obligatorio: sin él no se valida la cantidad de personas (B12). |
| **Calendario de mantenimientos** | `roomId`, `maintenanceStart`, `maintenanceEnd`, `reason`. | Si las fechas son fecha o fecha y hora, y si el fin es inclusivo. Propuesta: fecha, con fin inclusivo (B5). Que acepte `categoryRoom` o varios `roomId`, para no hacer una llamada por habitación (B6). |

### 5.1 Comparación con el spec "Consultar inventario de habitaciones" del Módulo 1 (2026-09-07)

Su spec ya cubre gran parte de lo que pedimos. Esto es lo que coincide y lo que falta:

**Coincide**
- Los **8 estados** de `Room`, incluido `Reserved`, aparecen en su entidad `Room`.
- Incluye la **capacidad máxima** de personas (B12).
- Consulta **por ID** (devuelve como máximo una habitación; un ID inexistente devuelve resultado vacío, no
  error), **por tipo y por estado**, combinables (B3, B4).
- **No filtra por fechas**: el estado es el del instante actual (B2).
- Es de **solo lectura**: no cambia datos ni estados.
- Rinde en menos de 5 segundos hasta con 5000 habitaciones.

**Falta o hay que alinear**

| # | Tema | Situación | Qué pedimos |
|---|---|---|---|
| B16 | **Qué reserva mantiene apartada una habitación** | Su entidad no tiene `reservedByReservationRef`. Lo necesitamos para saber si un `Reserved` es de la propia reserva que se edita (no es conflicto) o de otra, y para liberar solo la habitación apartada por esa reserva. | Agregar `reservedByReservationRef` (solo cuando `status` es `Reserved`) a la consulta. |
| B17 | **Nombres de los campos** | Su spec dice ID (UUID), número, tipo, capacidad máxima, piso/ala y tarifa base; el diccionario del sistema usa `id`, `roomNumber`, `categoryRoom`, `maxCapacity`. | Confirmar los nombres exactos de los campos en la respuesta. |
| B18 | **Excluir habitaciones `Inactive`** | Por defecto el listado **incluye** las `Inactive`. Una habitación dada de baja nunca debe ofrecerse para una reserva. | Confirmar que se puede excluirlas al filtrar, y si se puede pedir "varios estados" o "todos menos estos". |
| B19 | **Estados que impiden reservar** | Ahora hay 8 estados y nuestros specs de disponibilidad solo listaban 3. **Decidido:** `PendingCleaning` e `InCleaning` no bloquean una reserva. | Confirmar cuáles de los demás estados bloquean (`Occupied`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`). Ver E3 y E4. |

## 6. Tabla de decisiones para cerrar con el Módulo 1

| # | Qué hay que confirmar | Propuesta del Módulo 2 | Estado |
|---|---|---|---|
| B1 | Agregar el estado `Reserved` a `Room.status` | Que lo aprueben e incorporen | Aparece en su spec de inventario; falta confirmar que lo aplican en las órdenes del Módulo 2 |
| B2 | Contrato REST del inventario: rutas, campos y si acepta fechas | No enviar fechas | Cubierto por su spec (sin fechas); faltan rutas y nombres de campos (B17) |
| B3 | Listado por categoría: completo o filtrado por estado | Ofrecer ambos modos | Cubierto por su spec (filtra por tipo y estado, combinables) |
| B4 | Categoría inexistente | Lista vacía, no error | Cubierto por su spec (sin resultados devuelve lista vacía) |
| B5 | Calendario: fecha o fecha y hora, y fin inclusivo o no | Fecha, con fin inclusivo | Pendiente |
| B6 | Calendario por categoría o por varios `roomId` | Sí, para evitar una llamada por habitación | Pendiente |
| B7 | Órdenes de estado: ruta, idempotencia por `requestId`, consulta del resultado por `requestId`, campos del detalle de la reserva | Por acordar la ruta | Pendiente |
| B8 | Valores de reintento de las órdenes | Cada 15 s y 3 intentos de resolución en 2 minutos | Pendiente |
| B9 | Mensajes de Check-In y Check-Out con la lista `foreignGuests` | Dentro de cada mensaje (incluye Check-Out) | Pendiente |
| B11 | Hora de inicio del día operativo y zona horaria | **Decidido:** 00:00 a 23:59, Colombia (UTC-5) | Decidido, falta que lo confirmen |
| B12 | `maxCapacity` en el inventario | Agregarlo a la consulta puntual y por categoría | Cubierto por su spec (incluye capacidad máxima) |
| B13 | Check-In y Check-Out con `roomId` además de `reservationRef` | Obligatorio en ambos | Pendiente |
| B14 | El Módulo 1 consume por cola la lista del día y sus actualizaciones y deja de consultar `GET /api/reservations` | Routing keys propuestas: `reserva.lista-del-dia` y `reserva.lista-del-dia.actualizacion` | Pendiente |
| B15 | Campos de `ForeignGuestData` | Los diez campos de la sección 3.1, con procedencia y destino | Pendiente |
| B16 | Agregar `reservedByReservationRef` al inventario | Solo cuando el estado es `Reserved` | Pendiente |
| B17 | Nombres exactos de los campos del inventario | `id`, `roomNumber`, `categoryRoom`, `maxCapacity`, `status` | Pendiente |
| B18 | Poder excluir habitaciones `Inactive` y filtrar por varios estados | Sí | Pendiente |
| B19 | Qué estados impiden reservar una estadía futura | `PendingCleaning` e `InCleaning` no bloquean (decidido); confirmar los demás | Parcial |
| B20 | Tipo de documento del titular (`documentType`) en la lista del día | Valores `CC`, `CE`, `PASSPORT` y `OTHER` | Pendiente: confirmar la lista de valores |

## 6.1 Preguntas para el Módulo 1

Queremos que el Módulo 1 decida cómo lo maneja. Con sus respuestas el Módulo 2 ajusta sus specs. Por
favor respondan con datos concretos (nombres, valores, ejemplos); si algo no existe, digan "no existe".

### A. Inventario de habitaciones (su spec "Consultar inventario de habitaciones")

1. ¿Cómo se llaman exactamente los campos que devuelve cada habitación (id, número, tipo, capacidad
   máxima, estado)? Un ejemplo de respuesta real ayuda.
2. ¿Cómo se consulta? Necesitamos pedir una habitación por su ID y todas las de una categoría, con o sin
   filtro de estado. ¿Cuáles son las rutas o servicios y los nombres de los filtros?
3. ¿Pueden excluir las habitaciones `Inactive`, o pedir varios estados a la vez (por ejemplo, "todos
   menos `Inactive`")? Si no, ¿cómo lo resolverían?
4. ¿Pueden incluir en la respuesta **qué reserva mantiene apartada una habitación** cuando está
   `Reserved`? Necesitamos saber si el apartado es de la reserva que estamos editando o de otra.
   ¿Cómo lo devolverían?
5. ¿Hay un tope o paginación en el listado? ¿Cuál es el tiempo de respuesta esperado?

### B. Estado `Reserved`

6. ¿Ya incorporaron `Reserved` a los estados de la habitación? ¿Desde cuándo?
7. ¿Qué transiciones tiene? En particular: ¿qué pasa con una habitación `Reserved` cuando se hace el
   Check-In, cuando el huésped no llega, y cuando la reserva se cancela?
8. ¿Alguna parte de su sistema cambia una habitación `Reserved` por su cuenta (por ejemplo, un cierre de
   día)?

### C. Órdenes de estado de habitación (`Reserved` y `Available`)

9. ¿Cómo prefieren recibir la orden (servicio, ruta, campos)? Nosotros enviamos: identificador de la
   orden, habitación, estado pedido, estado anterior, reserva, número de secuencia y detalle de la
   reserva.
10. ¿Pueden garantizar que repetir la misma orden no se aplique dos veces? ¿Con qué identificador?
11. ¿Pueden ignorar una orden más vieja que otra ya aplicada para la misma habitación? ¿Cómo lo
    detectarían?
12. ¿Se puede consultar después el resultado de una orden ya enviada? ¿Cómo?
13. ¿Qué motivos de rechazo pueden devolver y con qué nombres? (Nosotros contemplamos "habitación
    ocupada" y "orden obsoleta".)
14. ¿En cuánto tiempo responden normalmente y cuál es su tiempo máximo? ¿Cuántas veces y cada cuánto
    toleran que reintentemos?

### D. Calendario de mantenimientos

15. ¿Las fechas de un mantenimiento son solo fecha o fecha y hora? ¿La fecha de fin es el último día
    bloqueado o el día en que la habitación vuelve a estar disponible?
16. ¿Se puede consultar por varias habitaciones o por una categoría en una sola llamada? ¿Cómo?
17. ¿Qué campos devuelve cada mantenimiento? ¿Existen mantenimientos sin fecha de fin?
18. ¿Qué pasa con las reservas que ya existen cuando programan un mantenimiento que se les cruza? ¿Nos
    avisan?

### E. Qué estados impiden vender una habitación

19. Para cada estado (`Available`, `Reserved`, `Occupied`, `PendingCleaning`, `InCleaning`,
    `DisabledForRepairs`, `TechnicalBlock`, `Inactive`): ¿la habitación se puede **reservar hoy**? ¿Y se
    puede **reservar para una fecha futura**? (Ya decidimos, de nuestro lado, que `PendingCleaning` e
    `InCleaning` no impiden una reserva.)

### F. Check-In y Check-Out

20. ¿Cómo nos notifican el Check-In y el Check-Out (cola, nombre del mensaje)? ¿Uno por habitación?
    ¿Incluyen el identificador de la habitación además de la reserva?
21. ¿Pueden incluir, en la misma notificación, la lista de huéspedes extranjeros de esa habitación (los
    acompañantes también)? ¿Cómo identifican que un huésped es extranjero?
22. Por cada extranjero necesitamos: nombres, apellidos, tipo y número de documento, fecha de
    nacimiento, nacionalidad, tipo de movimiento (entrada o salida), fecha del movimiento, **lugar de
    procedencia y lugar de destino**. ¿Los capturan todos hoy? ¿Cuáles no y por qué?
23. Si un huésped les llega con un dato faltante, ¿lo dejan pasar o no arman el mensaje? ¿Pueden
    garantizar que solo nos envían huéspedes completos? (El Módulo 2 no los valida ni los devuelve.)
24. ¿Qué formato y zona horaria tienen las fechas de Check-In y Check-Out?
25. Si un huésped cambia de habitación dentro de la misma reserva, ¿qué mensajes envían?

### G. Lista de reservas del día

26. ¿Pueden recibir por cola la lista de reservas del día y sus actualizaciones (alta, cambio, baja)?
    ¿Cuál es el nombre de la cola o del canal?
27. La lista trae, por reserva: referencia, estado, canal, código de la agencia (si es OTA), fechas,
    noches, personas, observaciones, fecha de última actualización, habitaciones (identificador,
    número y categoría) y datos del titular (nombre, tipo y número de documento, nacionalidad, teléfono, correo).
    ¿Les falta algún dato? ¿Sobra alguno?
28. ¿Cómo manejan un mensaje repetido o fuera de orden? (Cada mensaje lleva identificador y número de
    secuencia.)
29. Hoy consultan las reservas al Módulo 2. ¿Pueden dejar de hacerlo y usar solo la lista?

### H. Día operativo

30. Vamos a usar el día calendario de Colombia, de 00:00 a 23:59, con la lista del día a las 00:00. ¿Su
    sistema opera igual? ¿Qué zona horaria usa su servidor?

## 7. Cambios recientes que afectan al Módulo 1

- **Procedencia y destino** son ahora obligatorios por huésped extranjero (antes se habían quitado).
- **El Módulo 2 ya no devuelve datos migratorios.** Da por hecho que el Módulo 1 los envía completos y correctos.
- **La lista del día sale a las 00:00**, no a una hora configurable.
- **El Módulo 1 ya no consulta la lista de reservas**: solo consulta las reservas entre una fecha de inicio y una de fin (y, si quiere, de una habitación) al registrar un mantenimiento o al dar de baja una habitación.
- **La lista del día trae el tipo de documento del titular** (`documentType`) y la fecha de última actualización de la reserva (`updatedAt`, que reemplaza al antiguo `version`). Ya no se envía el tipo `NATIONAL`/`FOREIGN`: el extranjero se identifica por nacionalidad distinta de Colombia.
- **El aviso de llegada tardía vuelve, solo para reservas directas.** La Recepcionista puede marcar `lateArrivalNotice` en una reserva directa y la lista del día (y sus actualizaciones `UPDATED`) lo lleva para que el Módulo 1 sepa que el huésped llegará tarde. En el cierre del día, la reserva directa con aviso no se cancela: queda protegida hasta el cierre del día siguiente a su llegada; si sigue sin Check-In, pasa a `CANCELLED` y el Módulo 2 ordena `Available` para sus habitaciones. Las reservas OTA no tienen este aviso: el cierre del día las marca `NO_SHOW` el mismo día de llegada si no tuvieron Check-In.
- Las tarifas de las habitaciones se quedan en el Módulo 2: la lista no las incluye.
- Las reservas OTA las modifica y cancela solo la propia OTA por su API; no afecta el contrato con el
  Módulo 1, pero explica que una cancelación OTA llega como `REMOVED` con motivo `CANCELLED`.

## 8. Lo que el Módulo 2 no hace (para que no se espere)

- No captura ni completa datos migratorios: no tiene pantalla para eso.
- No cambia el estado físico de la habitación, salvo pedir `Reserved` o `Available`.
- No envía nada a Migración Colombia: la Recepcionista descarga el archivo SIRE y lo envía por su cuenta.
- No envía datos financieros al Módulo 1.
