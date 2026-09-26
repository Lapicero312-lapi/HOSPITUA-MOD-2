# Feature Specification: Actualizar Reservación

**Created**: 2026-09-19

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
"estancada": sigue ocupando una habitación apartada en el Módulo 1 y distorsiona las métricas de
ocupación. El negocio necesita un proceso automático de cierre del día que identifique esas
reservas, las marque como no presentadas y libere la habitación. Todas estas transiciones comparten
las mismas reglas de transición y de concurrencia.

### Flujo de Usuario de Alto Nivel

1. La **Recepcionista** o la **Ota** localiza la reserva mediante "Consultar
   reservas" y valida que esté en `ACTIVE` o `PENDING`.
2. El solicitante edita las fechas, la categoría de `Room`, los datos personales del `Guest` o
   registra el aviso de llegada tardía del huésped (`lateArrivalNotice`).
3. Si cambian las fechas o la habitación, el sistema ejecuta "Verificar disponibilidades" enviando
   la `reservationRef` de la reserva editada, para que esta no se cruce consigo misma.
4. Si cambian las fechas o la categoría, el sistema ejecuta "Calcular tarifa dinámica" en el Módulo
   3 para obtener el nuevo valor y la diferencia.
5. El solicitante revisa el resumen y confirma; el sistema persiste los cambios.

Adicionalmente, esta funcionalidad recibe el cambio de `status` que solicitan otros procesos:
"Generar reservación por OTA" (confirmación de pago o garantía), "Generar reservación directa" y
"Generar reservación por OTA" (cancelación compensatoria con el motivo `ROOM_REJECTED` cuando el
Módulo 1 rechaza apartar la habitación), la notificación de Check-In, la notificación de Check-Out y
el cierre automático del día (No-Show), descritos a continuación. Todos ellos cambian el `status` de
la reserva a `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`, de modo que las reglas de
transición y de concurrencia vivan en un solo lugar. "Cancelar reservación" es la excepción: cambia
el `status` directamente a `CANCELLED`, de forma atómica dentro de su propia transacción.

**Notificación de Check-In del Módulo 1**

1. El **Módulo 1** ejecuta el Check-In físico: cambia la `Room` a `Occupied` (desde `Reserved` si la
   reserva era para hoy) y entrega la habitación al huésped.
2. El Módulo 1 envía a la API del Módulo 2 una notificación con la `reservationRef` y, si el
   huésped es extranjero, sus datos migratorios (`ForeignGuestData`, de los que se toma el tipo de
   movimiento y la fecha).
3. El sistema localiza la reserva mediante "Consultar reservas" y valida que esté en `ACTIVE`.
4. El sistema cambia el `status` a `IN_PROGRESS`.
5. Si hay datos migratorios, el sistema ejecuta "Procesar datos de huéspedes extranjeros" para
   validarlos y registrarlos en un `MigratoryMovement` de esa reserva.

**Notificación de Check-Out del Módulo 1**

1. El **Módulo 1** ejecuta el Check-Out físico: libera la `Room` y cierra la estadía.
2. El Módulo 1 envía a la API del Módulo 2 una notificación con la `reservationRef`.
3. El sistema localiza la reserva mediante "Consultar reservas" y valida que esté en `IN_PROGRESS`.
4. El sistema cambia el `status` a `COMPLETED`.

**Cierre automático del día (No-Show)**

1. El sistema ejecuta un proceso automático al cierre del día operativo, según la zona horaria del
   hotel.
2. El sistema recorre las `Reservation` cuya `startDate` corresponde al día procesado.
3. Para cada una en `ACTIVE` o `PENDING` cuyo huésped no avisó una llegada tardía, cambia el
   `status`: a `NO_SHOW` si el `source` es `OTA`, o a `CANCELLED` si es `DIRECT`.
4. En ambos canales, el sistema ejecuta "Establecer estado de habitación" para ordenar al Módulo 1
   devolver la `Room` a `Available`.
5. Las reservas en `IN_PROGRESS`, en otros estados finales o con llegada tardía avisada se ignoran.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Modificación de Datos de Reservación (Priority: P1)

Un solicitante —la Recepcionista o la Ota— modifica una reserva que aún no ha
iniciado su estadía. Puede cambiar fechas, categoría o datos personales. Cuando el cambio afecta
fechas o categoría, el sistema valida disponibilidad y delega el recálculo en el Módulo 3, mostrando
la diferencia antes de confirmar; cuando solo toca datos personales, guarda directamente. Por
tratarse de una única vista, el camino feliz y los bloqueos lógicos se consolidan en esta misma
historia de usuario.

**Why this priority**: Da al hotel la flexibilidad de acomodar los cambios del cliente sin fricción
y sin gestiones por fuera del sistema, garantizando la consistencia de la disponibilidad y del valor
de la estadía antes de la llegada.

**Independent Test**: Se modifica una reserva `ACTIVE` y se verifica que el sistema valide la
disponibilidad, muestre la diferencia calculada por el Módulo 3 y solo tras la confirmación guarde
los cambios. Se repite con datos personales (sin recálculo) y sobre reservas `IN_PROGRESS`,
`COMPLETED`, `CANCELLED` y `NO_SHOW`, confirmando el bloqueo.

**Acceptance Scenarios**:

1. **Scenario**: Actualización de fechas o categoría con recálculo exitoso (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` con disponibilidad validada para las nuevas fechas
   - **When** el solicitante modifica las fechas o la categoría y el Módulo 3 devuelve la tarifa
     recalculada
   - **Then** el sistema muestra el resumen con la diferencia a pagar o reembolsar y, tras la
     confirmación, actualiza la reserva

2. **Scenario**: Modificación de datos personales sin afectación financiera
   - **Given** una `Reservation` en `ACTIVE` o `PENDING`
   - **When** el solicitante corrige datos del `Guest`
   - **Then** el sistema guarda los cambios sin invocar al Módulo 3 ni alterar fechas o categoría

3. **Scenario**: Cambio de estado solicitado por un proceso interno
   - **Given** una confirmación de pago OTA, una cancelación compensatoria por `ROOM_REJECTED`, o
     una notificación de Check-In, Check-Out o No-Show válida
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

6. **Scenario**: Cambio de habitación coordinado con el Módulo 1
   - **Given** una `Reservation` en `ACTIVE` con llegada hoy, con la `Room` A en `Reserved`, y la
     `Room` B disponible en sus fechas
   - **When** el solicitante cambia la reserva a la `Room` B y confirma
   - **Then** el sistema ordena al Módulo 1 `Reserved` para la `Room` B y, tras su confirmación,
     ordena `Available` para la `Room` A, y actualiza la reserva

7. **Scenario**: Cambio de habitación en una reserva con llegada futura
   - **Given** una `Reservation` en `ACTIVE` con llegada dentro de varias semanas, cuya `Room` A no
     está apartada en el Módulo 1, y la `Room` B disponible en sus fechas
   - **When** el solicitante cambia la reserva a la `Room` B y confirma
   - **Then** el sistema actualiza la reserva a la `Room` B sin enviar ninguna orden al Módulo 1

---

### User Story 2 - Sincronización del Estado por Notificaciones de Check-In y Check-Out (Priority: P2)

El Módulo 2 recibe la notificación del Check-In o del Check-Out ejecutados en el Módulo 1 para
actualizar el estado de la `Reservation` (`IN_PROGRESS` y `COMPLETED`) y, en el Check-In de un
huésped extranjero, consolidar sus datos migratorios mediante "Procesar datos de huéspedes
extranjeros", sin duplicar el proceso presencial en pantallas diferentes. Por tratarse de
notificaciones de una misma naturaleza, los caminos exitosos, los duplicados y los rechazos por
estado inválido se consolidan en esta misma historia de usuario.

**Why this priority**: Es vital para mantener la coherencia del estado de la reserva y cerrar su
ciclo de vida sin duplicar la operación física, que pertenece al Módulo 1. Sin ella las reservas
quedan desactualizadas o eternamente "en curso" y el reporte gubernamental incompleto.

**Independent Test**: Se envía una notificación simulada de Check-In del Módulo 1 con la
`reservationRef` y datos migratorios opcionales, y se valida que la reserva pase a `IN_PROGRESS` y
que los datos queden registrados en un `MigratoryMovement`. Luego se envía la notificación de
Check-Out y se valida que la reserva pase a `COMPLETED` sin afectar el estado de la `Room`, que
gestiona el Módulo 1.

**Acceptance Scenarios**:

1. **Scenario**: Actualización de estado por notificación de Check-In (Happy Path)
   - **Given** una `Reservation` en estado `ACTIVE`
   - **When** el sistema recibe la notificación del Módulo 1 indicando que el Check-In se completó
   - **Then** el sistema actualiza la `Reservation` a `IN_PROGRESS`

2. **Scenario**: Recepción de datos de un huésped extranjero en el Check-In
   - **Given** una `Reservation` de un `Guest` `FOREIGN` en proceso de Check-In
   - **When** la notificación incluye el tipo de movimiento migratorio y la fecha de ingreso
   - **Then** el sistema los valida y los registra, mediante "Procesar datos de huéspedes
     extranjeros", en un `MigratoryMovement` asociado a esa reserva, para su futura exportación SIRE

3. **Scenario**: Rechazo de Check-In con estado inválido (Error)
   - **Given** una `Reservation` en `PENDING`, `COMPLETED`, `CANCELLED` o `NO_SHOW`
   - **When** el Módulo 1 envía una notificación de Check-In retrasada o prematura
   - **Then** el sistema no cambia el estado, responde **HTTP 400 (Bad Request)** indicando que la
     reserva no admite un Check-In en su estado actual, y registra una incidencia de conciliación
     con el Módulo 1

4. **Scenario**: Finalización exitosa por notificación de Check-Out (Happy Path)
   - **Given** una `Reservation` en `IN_PROGRESS`
   - **When** el sistema recibe la notificación del Módulo 1 indicando que el Check-Out finalizó
   - **Then** el sistema actualiza la `Reservation` a `COMPLETED`

5. **Scenario**: Rechazo de Check-Out para reservas sin ingreso (Error)
   - **Given** una `Reservation` en `ACTIVE` o `PENDING`
   - **When** el Módulo 1 envía una notificación de Check-Out
   - **Then** el sistema prohíbe el cambio de estado, responde **HTTP 400** informando que la
     reserva aún no registra un ingreso, y registra una incidencia de conciliación con el Módulo 1

6. **Scenario**: Check-Out duplicado (idempotente)
   - **Given** una `Reservation` en `COMPLETED`
   - **When** el sistema recibe de nuevo una notificación de Check-Out
   - **Then** el sistema responde 200 sin efectos nuevos, porque la salida ya fue registrada

---

### User Story 3 - Cierre Automático del Día: No-Show (Priority: P2)

El sistema, sin intervención humana, identifica al cierre del día las reservas esperadas que no
registraron ingreso físico ni avisaron una llegada tardía, las marca como `NO_SHOW` (canal OTA) o
`CANCELLED` (canal directo) y libera su habitación. Por tratarse de un único proceso automático en
lote, el camino exitoso por canal, la exclusión de reservas en curso o con llegada tardía y el
manejo de fallos individuales se consolidan en esta misma historia de usuario.

**Why this priority**: Es una automatización necesaria para mantener la salud del inventario y las
métricas de ocupación, aunque no bloquea la operación diaria de reservas. La distinción por canal
conserva el registro de las reservas OTA para conciliar comisiones con la agencia.

**Independent Test**: Se simula el cierre del día y se verifica que el proceso recorra las reservas
del día, marque como `NO_SHOW` las de canal OTA y como `CANCELLED` las de canal directo que no
tuvieron ingreso, ignore las `IN_PROGRESS` y las de llegada tardía avisada, y libere las
habitaciones correspondientes.

**Acceptance Scenarios**:

1. **Scenario**: Cambio automático a No-Show de una reserva OTA (Happy Path)
   - **Given** una `Reservation` con `source` `OTA`, con `startDate` de hoy, que sigue en `ACTIVE` o
     `PENDING`
   - **When** el sistema ejecuta el proceso de fin de día
   - **Then** el sistema cambia la reserva a `NO_SHOW`, la conserva para la conciliación de
     comisiones y ordena al Módulo 1 devolver la `Room` a `Available`

2. **Scenario**: Cancelación automática de una reserva directa sin presentarse (Happy Path)
   - **Given** una `Reservation` con `source` `DIRECT`, con `startDate` de hoy, que sigue en
     `ACTIVE` y cuyo huésped no avisó una llegada tardía
   - **When** el sistema ejecuta el proceso de fin de día
   - **Then** el sistema cambia la reserva a `CANCELLED`, sin generar comisión ni registro de
     `Cancellation`, y ordena al Módulo 1 devolver la `Room` a `Available`

3. **Scenario**: Exclusión de reservas en curso
   - **Given** una `Reservation` de hoy en `IN_PROGRESS`
   - **When** se ejecuta el proceso de fin de día
   - **Then** el sistema la ignora y mantiene su estado, porque el huésped ingresó

4. **Scenario**: Exclusión de reservas con llegada tardía avisada
   - **Given** una `Reservation` de hoy en `ACTIVE` cuyo huésped avisó una llegada tardía
   - **When** se ejecuta el proceso de fin de día
   - **Then** el sistema la ignora y la mantiene en `ACTIVE`, sin liberar la `Room`

5. **Scenario**: Fallo aislado dentro del lote (Error)
   - **Given** un lote de reservas donde una presenta datos corruptos
   - **When** el sistema las procesa una por una
   - **Then** el sistema captura el error del registro corrupto, deja un log de advertencia
     controlado, y continúa con el resto sin interrumpir el proceso

### Casos Borde

- ¿Qué sucede cuando el Módulo 3 no responde durante el recálculo? El sistema detiene la
  confirmación financiera y responde **HTTP 400** con el mensaje: "No se pudo calcular la nueva
  tarifa en este momento. Intente más tarde."
- ¿Qué sucede si se envían fechas inválidas (salida antes de llegada)? El sistema rechaza la
  solicitud con **HTTP 400**: "Las nuevas fechas de reserva son inválidas", sin consultar al Módulo
  3.
- ¿Qué sucede si se ingresan caracteres extraños en los datos del huésped? El sistema los rechaza
  antes de guardar con **HTTP 400**: "El formato de los datos contiene caracteres no válidos."
- ¿Cómo maneja el sistema dos ediciones simultáneas de la misma reserva? Usa control de concurrencia
  optimista con el atributo `version`: la segunda recibe **HTTP 400** indicando que debe recargar.
- ¿Qué sucede con el Módulo 1 cuando solo cambian las fechas? Por lo general nada: un cambio de
  fechas sin cambio de `Room` no genera órdenes al Módulo 1. Las únicas excepciones son las que
  cruzan el día actual: si la nueva llegada es hoy, el sistema ordena `Reserved` para la `Room`
  (`originEvent` `DATES_CHANGED`), y si la llegada era hoy y deja de serlo, ordena `Available`. Un
  cambio de habitación en una reserva con llegada futura tampoco genera órdenes, porque ninguna de
  las dos `Room` está apartada.
- ¿Cómo se coordina el cambio de habitación con el Módulo 1 cuando la llegada es hoy? El sistema
  ejecuta "Establecer estado de habitación" en este orden: primero ordena `Reserved` para la `Room`
  nueva y, solo si el Módulo
  1 la confirma, ordena `Available` para la anterior. Si el Módulo 1 rechaza la `Room` nueva, el
  cambio no se aplica, la reserva conserva su `Room` original y se responde **HTTP 400**. Si no
  responde, como el resultado es ambiguo y el Módulo 1 pudo haber apartado la `Room` nueva, el
  cambio tampoco se aplica y el sistema neutraliza esa posible reserva emitiendo una orden
  `Available` para la `Room` nueva con un `sequenceNumber` mayor, secuenciada por "Establecer estado
  de habitación" y reintentada desde `PENDING` si falla; la reserva conserva su `Room` original y se
  responde **HTTP 400**, de modo que nunca queden apartadas la `Room` original y la nueva por la
  misma reserva. Si falla únicamente la liberación de la `Room` anterior, el cambio ya quedó
  aplicado y esa
  orden queda en `PENDING` para reintentarse; el sistema responde **HTTP 400** con el mensaje "La
  reserva se actualizó, pero la liberación de la habitación anterior quedó pendiente", y reenviar la
  misma solicitud no repite el cambio.
- ¿Qué sucede si la notificación de Check-In o de Check-Out llega vacía o sin la `reservationRef`?
  El
  sistema intercepta el error de inmediato y responde **HTTP 400** con el mensaje: "El payload de
  notificación es inválido. Falta el identificador de la reserva.", sin producir errores **HTTP
  500**.
- ¿Qué sucede si los datos migratorios del Check-In tienen formato inválido o fechas futuras? El
  Check-In físico ya ocurrió en el Módulo 1, así que el sistema no lo rechaza: actualiza la reserva
  a `IN_PROGRESS`, registra el `MigratoryMovement` como `INCOMPLETE` y responde 200. Ese movimiento
  queda excluido de la exportación SIRE hasta que el Módulo 1 reenvíe los datos completos.
- ¿Qué sucede si la reserva notificada no existe en el Módulo 2? El sistema responde **HTTP 400**
  con
  el mensaje "La reserva notificada no existe en el sistema de reservas." (Check-In) o "Referencia
  de reserva no encontrada" (Check-Out), y registra la incidencia de conciliación, porque el Módulo
  1 ya ejecutó físicamente el proceso.
- ¿Qué sucede si la notificación de Check-In llega duplicada o la reserva ya no está en `ACTIVE`? Si
  la reserva ya está en `IN_PROGRESS`, la notificación es idempotente: responde 200 sin cambiar el
  estado ni duplicar el Check-In; solo si trae datos migratorios completos y el `MigratoryMovement`
  de esa reserva está `INCOMPLETE`, lo actualiza a `COMPLETE`. Si está en `CANCELLED`, `NO_SHOW`,
  `PENDING` o `COMPLETED`, responde **HTTP 400** sin cambiar el estado y registra una incidencia de
  conciliación, para que una persona resuelva la discrepancia con el Módulo 1 (la habitación quedó
  ocupada sin una reserva vigente).
- ¿Qué sucede si la notificación de Check-In llega antes de la fecha de inicio de la estadía? El
  sistema la procesa normalmente, porque el Check-In físico ya ocurrió en el Módulo 1, que es quien
  valida las fechas de ingreso.
- ¿Qué sucede si la notificación de Check-Out llega con horas de retraso por un problema de red? El
  sistema la procesa normalmente si la reserva sigue `IN_PROGRESS`, actualizándola a `COMPLETED` de
  forma transaccional.
- ¿Qué sucede si se notifica el Check-Out de una reserva `CANCELLED` o `NO_SHOW`? El sistema la
  rechaza con **HTTP 400** y registra la incidencia, porque nunca tuvo un ingreso.
- ¿Qué sucede si el proceso de cierre del día se ejecuta dos veces el mismo día? El sistema es
  idempotente: ignora las reservas que ya no están en `ACTIVE` o `PENDING` (por ejemplo, las que ya
  pasaron a `NO_SHOW` o `CANCELLED`) y responde exitosamente, sin errores.
- ¿Qué sucede si la zona horaria del servidor difiere de la del hotel? El sistema usa siempre la
  zona horaria configurada del hotel, evitando marcar como no presentadas reservas cuyo día aún no
  termina, y emite una alerta de negocio si las zonas son inconsistentes.
- ¿Qué ocurre si la base de datos pierde conexión durante el procesamiento masivo del cierre del
  día? El sistema detiene el proceso de forma transaccional, sin marcar reservas a medias, y emite
  alertas controladas sin exponer detalles de infraestructura.
- ¿Qué sucede si el Módulo 1 no responde al liberar una habitación en el cierre del día? La reserva
  queda en su nuevo estado (`NO_SHOW` o `CANCELLED`), la orden queda en `PENDING` para reintentarse,
  y el lote continúa.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir editar los datos de estadía y los datos personales de una
  `Reservation` en `ACTIVE` o `PENDING`, así como registrar el aviso de llegada tardía del huésped
  (`lateArrivalNotice`).
- **FR-002**: El sistema debe validar la disponibilidad mediante "Verificar disponibilidades" cuando
  cambien las fechas o la habitación, enviando la `reservationRef` de la reserva editada para
  excluirla del cruce de solapamientos.
- **FR-003**: El sistema debe invocar "Calcular tarifa dinámica" del Módulo 3 cuando el cambio
  afecte fechas o categoría, y exigir la confirmación del solicitante antes de persistir.
- **FR-004**: El sistema debe permitir modificar los datos personales del `Guest` sin invocar al
  Módulo 3 ni exigir disponibilidad.
- **FR-005**: El sistema debe ser el punto de cambio de `status` de la reserva para la confirmación
  OTA, la cancelación compensatoria, el Check-In, el Check-Out y el No-Show, aceptando las
  transiciones `PENDING`→`ACTIVE`, `ACTIVE`→`IN_PROGRESS`, `IN_PROGRESS`→`COMPLETED`, `ACTIVE` o
  `PENDING`→`CANCELLED` (cancelación compensatoria o No-Show de canal directo), y `ACTIVE` o
  `PENDING`→`NO_SHOW` (No-Show de canal OTA); cualquier otra transición debe rechazarse con **HTTP
  400**. La cancelación explícita la ejecuta "Cancelar reservación" directamente, con las mismas
  transiciones y el mismo control de concurrencia.
- **FR-006**: El sistema debe aplicar control de concurrencia optimista mediante `version`.
- **FR-007**: Cuando la modificación cambie la `Room` de una reserva con llegada hoy, el sistema
  debe ordenar primero `Reserved`
  para la nueva y solo después `Available` para la anterior, abortando el cambio si el Módulo 1
  rechaza la nueva o no responde; en el caso de falta de respuesta debe neutralizar la posible
  reserva de la `Room` nueva con una orden `Available` de mayor `sequenceNumber`, reintentada desde
  `PENDING` si falla. Si falla únicamente la liberación de la anterior, el cambio debe
  conservarse, la orden debe reintentarse desde `PENDING` y la respuesta debe ser **HTTP 400** con
  el aviso de liberación pendiente.
- **FR-008**: El sistema debe interceptar excepciones de validación, concurrencia e integración,
  respondiendo **HTTP 400 (Bad Request)** y prohibiendo errores **HTTP 500**; en el caso de la
  liberación pendiente de FR-007, la respuesta 400 no implica que el cambio se haya revertido: el
  cambio ya está aplicado y solo la liberación queda por reintentar.
- **FR-009**: El sistema no debe emitir órdenes al Módulo 1 por un cambio de `Room` en una reserva
  con llegada futura, y solo debe ordenar `Reserved` o `Available` por un cambio de fechas
  (`DATES_CHANGED`) cuando este haga que la llegada pase a ser hoy o deje de serlo.
- **FR-010**: El sistema no debe ofrecer una interfaz para el Check-In ni el Check-Out físicos: debe
  limitarse a exponer servicios que reciban las notificaciones del Módulo 1.
- **FR-011**: El sistema debe validar que la `Reservation` esté en `ACTIVE` antes de procesar la
  notificación de Check-In y cambiar su `status` a `IN_PROGRESS`. Si ya está en `IN_PROGRESS`, la
  notificación es un duplicado idempotente (200 sin efectos, salvo completar un movimiento
  migratorio `INCOMPLETE`); si no está en `ACTIVE` ni en `IN_PROGRESS`, o no existe, debe responder
  **HTTP 400** sin cambiar el estado y registrar una incidencia de conciliación con el Módulo 1,
  porque el efecto físico ya ocurrió allá.
- **FR-012**: El sistema debe recibir y validar en la misma petición de Check-In los datos
  migratorios de huéspedes `FOREIGN`, registrándolos en un `MigratoryMovement` de esa reserva
  mediante "Procesar datos de huéspedes extranjeros"; si son inválidos, debe conservar el Check-In y
  marcar el movimiento como `INCOMPLETE`, respondiendo 200 sin advertencias mezcladas.
- **FR-013**: El sistema debe validar que la `Reservation` esté en `IN_PROGRESS` antes de procesar
  la notificación de Check-Out y cambiar su `status` a `COMPLETED`; si ya está en `COMPLETED` debe
  responder 200 sin efectos (idempotencia), y en cualquier otro estado debe responder **HTTP 400** y
  registrar una incidencia de conciliación. No debe modificar el estado de la `Room`, que gestiona
  el Módulo 1.
- **FR-014**: El sistema debe ejecutar un proceso automático al cierre del día operativo, usando la
  zona horaria del hotel, que recorra las `Reservation` cuya `startDate` corresponda al día
  procesado y procese únicamente las que estén en `ACTIVE` o `PENDING` y cuyo huésped no haya
  avisado una llegada tardía, ignorando `IN_PROGRESS`, los estados finales y las de llegada tardía
  avisada.
- **FR-015**: El sistema debe cambiar el `status` en ese proceso según el canal: a `NO_SHOW` si el
  `source` es `OTA` y a `CANCELLED` si es `DIRECT`, y en ambos casos debe ordenar al Módulo 1,
  mediante "Establecer estado de habitación", devolver la `Room` a `Available` solo si sigue
  apartada por esa reserva; si el Módulo 1 la reporta `Occupied`, la orden se trata como sin efecto
  y se registra la incidencia.
- **FR-016**: El sistema debe conservar en el Módulo 2 las reservas OTA marcadas como `NO_SHOW` para
  la conciliación de comisiones con la agencia, y no debe registrar una `Cancellation` para las
  reservas directas que pasan a `CANCELLED` por el cierre del día.
- **FR-017**: El sistema debe procesar cada registro del lote del cierre del día con manejo
  individual de excepciones, de modo que un error de validación no interrumpa el lote ni exponga
  errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La recotización integrada con el Módulo 3 debe completarse en menos de 3 segundos en
  condiciones normales.
- **NFR-002**: El procesamiento de cada notificación de Check-In o de Check-Out debe completarse en
  menos de 500 milisegundos.
- **NFR-003**: El proceso del cierre del día debe ser idempotente y completar un lote de hasta 1000
  reservas en menos de 1 minuto.
### Key Entities *(include if feature involves data)*

- **Reservation**: Entidad principal actualizada. Atributos: `reservationRef`, `guestRef`, `roomId`,
  `categoryRoom`, `startDate`, `endDate`, `grossAmount`, `version`, `source` (`DIRECT` | `OTA`),
  `lateArrivalNotice` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `nationality`,
  `contactPhone`, `contactEmail`.
- **Room**: Habitación física controlada por el Módulo 1, referenciada para la disponibilidad: el
  Módulo 1 la pasa a `Occupied` en el Check-In y la libera en el Check-Out, y vuelve de `Reserved` a
  `Available` en el No-Show. Atributos: `id`,
  `roomNumber`, `categoryRoom` y `status` (`Available` | `Reserved` | `Occupied`).
- **RateQuote**: Cotización del Módulo 3 para la modificación. Atributos: `reservationRef`,
  `previousGrossAmount`, `grossAmount`, `amountDifference`, `currency`, `calculatedAt`.
- **MigratoryMovement**: Movimiento migratorio de la estadía de un huésped `FOREIGN`, registrado en
  el Check-In mediante "Procesar datos de huéspedes extranjeros". Atributos: `movementId`,
  `reservationRef`, `guestRef`, `movementType`, `movementDate`, `validationStatus` (`COMPLETE` |
  `INCOMPLETE`), `missingFields` y `validationReason` (estos dos últimos, solo cuando es
  `INCOMPLETE`).
- **ReconciliationIncident**: Registro de una discrepancia entre el Módulo 1 y el Módulo 2 que una
  persona debe resolver (por ejemplo, una habitación ocupada sin una reserva vigente). Atributos:
  `incidentId`, `origin` (`CHECK_IN` | `CHECK_OUT` | `ROOM_STATE`), `reservationRef`, `roomId`,
  `reason`, `createdAt` y `resolutionStatus` (`OPEN` | `RESOLVED`).
## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El solicitante completa la actualización de fechas y tarifa en menos de 1 minuto una
  vez recibida la cotización del Módulo 3.
- **SC-002**: El 100% de los cambios de estado cumplen con las transiciones permitidas y con la
  nomenclatura unificada de estados.
- **SC-003**: El 100% de los intentos inválidos (fechas pasadas, falta de disponibilidad, reservas
  finalizadas) responden **HTTP 400**, con cero errores **HTTP 500**.
- **SC-004**: Cero discrepancias financieras entre el Módulo 2 y el Módulo 3 tras actualizaciones
  exitosas.
- **SC-005**: El 100% de las notificaciones de Check-In y de Check-Out válidas del Módulo 1
  actualizan la reserva a `IN_PROGRESS` o `COMPLETED`, y el 100% de la información migratoria
  enviada en el Check-In se registra en el `MigratoryMovement` sin intervención manual, o queda
  marcada como `INCOMPLETE`.
- **SC-006**: El 100% de las notificaciones que no pueden aplicarse dejan una incidencia de
  conciliación registrada, con cero errores **HTTP 500** ante payloads mal formados o reservas
  inexistentes.
- **SC-007**: El 100% de las reservas sin ingreso ni aviso de llegada tardía al finalizar el día
  quedan marcadas como `NO_SHOW` (canal OTA) o `CANCELLED` (canal directo), con su habitación
  liberada, y sin interrupciones del proceso por un registro con formato inválido.
