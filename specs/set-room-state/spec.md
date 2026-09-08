# Especificación de Funcionalidad: Establecer el Estado de la Habitación

**Creado**: 2026-09-08

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Establecer el Estado de la Habitación (`Set Room State`) es el mecanismo de integración operativo que permite solicitar y actualizar el estado físico de una habitación (`Room`) en el **Módulo 1** (módulo propietario de la infraestructura física del hotel). Se invoca automáticamente durante los eventos de check-in (para cambiar a `OCCUPIED`), check-out (para cambiar a `CLEANING`), cancelación de reserva (para liberar a `AVAILABLE`), o mantenimiento manual por parte de la **Recepcionista**. Toda la interacción ocurre dentro de la consola operativa o como paso integrado de los procesos de admisión y salida:

- Al confirmarse un check-in o check-out, el sistema construye y transmite una solicitud de actualización con el identificador de la habitación (`roomId`), el nuevo estado deseado (`status`), y el evento que origina el cambio.
- Si el **Módulo 1** responde exitosamente, el estado de la habitación se actualiza físicamente y el registro local de la solicitud se marca como `COMPLETED`.
- Si la comunicación con el **Módulo 1** se interrumpe o falla, el sistema Módulo 2 **no** revierte el check-in ni el check-out ya realizados; en su lugar, marca el atributo `roomStateRequestStatus` como `PENDING` y habilita un mecanismo de reintento desacoplado.
- Si se intenta asignar un estado físicamente incoherente o sobre una habitación en mantenimiento (`OUT_OF_SERVICE`), el sistema bloquea la acción y responde con una alerta controlada **HTTP 400 (Bad Request)**.

**Estados de la entidad `Reservation`**: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `Room`** (definidos y coordinados con el Módulo 1):
- `status`: `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

**Estados del requerimiento de integración `RoomStateRequest`**:
- `roomStateRequestStatus`: `PENDING`, `COMPLETED`, `FAILED`.

---

### Historia de Usuario 1 - Solicitud y Actualización del Estado de Habitación (Prioridad: P1)

La Recepcionista (o el proceso automatizado de admisión/salida) solicita cambiar el estado físico de una habitación en el Módulo 1 al finalizar un check-in (`OCCUPIED`) o un check-out (`CLEANING`). El sistema valida la solicitud, transmite la actualización al Módulo 1 y registra el estado resultante en la entidad `RoomStateRequest` como `COMPLETED`. Esta historia es el flujo principal (Happy Path) que sincroniza el inventario físico con las operaciones de recepción.

**Por qué esta prioridad**: Es la funcionalidad básica requerida para mantener actualizado el mapa de ocupación del hotel. Sin ella, las habitaciones permanecerían con estados inconsistentes, provocando sobreventas o demoras en la preparación de cuartos para nuevos huéspedes.

**Prueba Independiente**: Se prueba enviando una solicitud para cambiar una habitación en estado `AVAILABLE` a `OCCUPIED` tras un check-in. Se verifica que el Módulo 1 reciba la orden, la `Room` pase a `OCCUPIED` y el `RoomStateRequest` se registre en `COMPLETED`. Se repite la prueba para check-out cambiando de `OCCUPIED` a `CLEANING`, confirmando la respuesta exitosa sin errores.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Cambiar estado de habitación a OCCUPIED tras Check-In exitoso
   - **Dado** una admisión de check-in confirmada para una reserva en estado `CHECKED_IN` con la habitación en estado `AVAILABLE`
   - **Cuando** la Recepcionista o el sistema envía la actualización mediante "Set Room State"
   - **Entonces** el sistema comunica la solicitud al Módulo 1, cambia el estado físico de la `Room` a `OCCUPIED`, y registra el `roomStateRequestStatus` como `COMPLETED`

2. **Escenario**: Cambiar estado de habitación a CLEANING tras Check-Out exitoso
   - **Dado** una salida de check-out confirmada para una reserva en estado `CHECKED_OUT` con la habitación en `OCCUPIED`
   - **Cuando** la Recepcionista o el sistema solicita la liberación mediante "Set Room State"
   - **Entonces** el sistema solicita al Módulo 1 cambiar la `Room` al estado `CLEANING`, actualizando el registro de la solicitud a `COMPLETED`

*Escenarios de Error / Caminos Tristes*

3. **Escenario**: Rechazo de cambio a estado no reconocido o inválido
   - **Dado** una habitación registrada en el sistema
   - **Cuando** se solicita cambiar el estado enviando un valor no perteneciente a la enumeración (`AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`)
   - **Entonces** el sistema intercepta la solicitud, responde con un código **HTTP 400 (Bad Request)** indicando que el estado es inválido, y no emite ninguna orden al Módulo 1

4. **Escenario**: Rechazo de ocupación directa para habitación en mantenimiento
   - **Dado** una habitación cuyo estado físico actual en el Módulo 1 es `OUT_OF_SERVICE`
   - **Cuando** la Recepcionista intenta forzar el cambio de estado directamente a `OCCUPIED` sin haber pasado por limpieza o reparación
   - **Entonces** el sistema bloquea la transacción con un error controlado **HTTP 400 (Bad Request)** indicando que la habitación requiere habilitación previa por mantenimiento

---

### Historia de Usuario 2 - Manejo de Reintentos por Fallo de Comunicación con Módulo 1 (Prioridad: P2)

Cuando la llamada de integración para establecer el estado de la habitación falla por desconexión de red o indisponibilidad temporal del Módulo 1, el sistema Módulo 2 mantiene la validez de la reserva/check-in, registra la actualización como `PENDING` en `RoomStateRequest`, y permite reintentar la sincronización sin afectar al huésped.

**Por qué esta prioridad**: Es un flujo de resiliencia operacional crítico para asegurar que los problemas de infraestructura o red del Módulo 1 no impidan la atención al cliente en recepción ni cancelen admisiones ya pagadas.

**Prueba Independiente**: Se simula una caída de conexión con el Módulo 1 durante un check-out. Se comprueba que el check-out en Módulo 2 se registre como `CHECKED_OUT` correctamente, mientras que el `roomStateRequestStatus` pase a `PENDING`. Se ejecuta posteriormente la función de reintento con la red restablecida, verificando que la `Room` pase finalmente a `CLEANING` y la solicitud cambie a `COMPLETED`.

**Escenarios de Aceptación**:

1. **Escenario**: Registro en estado PENDING tras falla de red con el Módulo 1
   - **Dado** un check-in o check-out registrado con éxito en el Módulo 2
   - **Cuando** el envío del cambio de estado al Módulo 1 experimenta un fallo de conexión o tiempo de espera agotado
   - **Entonces** el sistema preserva la admisión o salida en el Módulo 2, guarda la solicitud en `roomStateRequestStatus` como `PENDING`, y notifica la pendiente a la Recepcionista mediante una advertencia controlada

2. **Escenario**: Reintento exitoso de sincronización del estado de habitación
   - **Dado** una solicitud registrada con `roomStateRequestStatus` en estado `PENDING`
   - **Cuando** la Recepcionista o el servicio en segundo plano ejecuta el reintento tras restablecer la comunicación con el Módulo 1
   - **Entonces** el Módulo 1 procesa la orden, actualiza el estado de la `Room` al valor solicitado (`OCCUPIED` o `CLEANING`), y actualiza el `roomStateRequestStatus` local a `COMPLETED`

---

### Historia de Usuario 3 - Liberación Manual de Habitación para Mantenimiento (Prioridad: P3)

La Recepcionista cambia el estado de una habitación sin ocupante activo a `OUT_OF_SERVICE` para reportar un daño físico, o a `AVAILABLE` tras la inspección de limpieza completada.

**Por qué esta prioridad**: Es un flujo secundario de gestión interna que permite coordinar con el personal de aseo y mantenimiento, pero no interviene directamente en la admisión síncrona de reservas en recepción.

**Prueba Independiente**: Se selecciona una habitación en estado `CLEANING`, se envía una solicitud para cambiarla a `AVAILABLE` tras finalizar el aseo, y se comprueba que el Módulo 1 acepte el cambio y la registre como disponible para asignación.

**Escenarios de Aceptación**:

1. **Escenario**: Habilitación manual de habitación de CLEANING a AVAILABLE
   - **Dado** una habitación liberada previamente en estado `CLEANING`
   - **Cuando** la Recepcionista confirma la finalización del aseo y solicita cambiar el estado a `AVAILABLE`
   - **Entonces** el sistema envía la solicitud al Módulo 1, actualiza la `Room` a `AVAILABLE`, y confirma que la habitación puede recibir nuevas reservas

2. **Escenario**: Bloqueo por intento de cambiar a OUT_OF_SERVICE una habitación con huésped hospedado
   - **Dado** una habitación con una reserva en estado `CHECKED_IN` y estado físico `OCCUPIED`
   - **Cuando** la Recepcionista intenta marcar manualmente la habitación como `OUT_OF_SERVICE` sin reasignar al huésped
   - **Entonces** el sistema rechaza el cambio con un código **HTTP 400 (Bad Request)** indicando que no se puede poner fuera de servicio una habitación con ocupación activa

---

### Casos Borde

- **Identificador de habitación inexistente o nulo**: si se envía una solicitud con el atributo `roomId` vacío, nulo o inexistente en la base de datos, el sistema debe interceptar la solicitud y retornar un código **HTTP 400 (Bad Request)** amigable, sin emitir peticiones erróneas al Módulo 1 ni generar fallos **HTTP 500**.
- **Concurrencia al modificar el estado de la misma habitación**: si dos usuarios intentan cambiar el estado de la misma `Room` de forma simultánea, la primera solicitud válida actualiza el estado a `COMPLETED`, mientras la segunda es informada mediante una respuesta controlada **HTTP 400 (Bad Request)** del cambio de estado previo.
- **Formato de datos de solicitud corruptos o caracteres especiales**: si los datos de la solicitud contienen caracteres extraños o scripts maliciosos, el sistema los sanitiza, rechaza la operación con **HTTP 400 (Bad Request)** y registra el evento en la auditoría sin afectar los servidores.
- **Respuestas ambiguas o con códigos de error desconocidos del Módulo 1**: si el Módulo 1 responde con un mensaje inesperado, el sistema Módulo 2 marca la solicitud como `PENDING` para revisión, evitando asunciones de estado no verificadas y prohibiendo errores **HTTP 500**.

---

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE permitir a la `Receptionist` o al proceso automatizado de Módulo 2 enviar solicitudes para actualizar el estado físico de una `Room` en el Módulo 1.
- **FR-002**: El sistema DEBE requerir los atributos `roomId`, `requestedStatus` y `originEvent` en toda solicitud de cambio de estado de habitación.
- **FR-003**: El sistema DEBE validar que el `requestedStatus` pertenezca exclusivamente a la enumeración oficial de estados: `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.
- **FR-004**: El sistema DEBE enviar una solicitud de cambio a `OCCUPIED` al Módulo 1 de forma síncrona al confirmarse un check-in de una reserva en estado `CHECKED_IN`.
- **FR-005**: El sistema DEBE enviar una solicitud de cambio a `CLEANING` al Módulo 1 de forma síncrona al confirmarse un check-out de una reserva en estado `CHECKED_OUT`.
- **FR-006**: El sistema DEBE registrar la entidad `RoomStateRequest` con el atributo `roomStateRequestStatus` en `COMPLETED` cuando el Módulo 1 confirme exitosamente la actualización.
- **FR-007**: El sistema DEBE registrar la entidad `RoomStateRequest` en `PENDING` cuando la comunicación con el Módulo 1 falle, sin revocar el evento de admisión o salida en Módulo 2.
- **FR-008**: El sistema DEBE proveer una función de reintento para procesar solicitudes de cambio de estado en estado `PENDING`.
- **FR-009**: El sistema DEBE rechazar cualquier intento de cambiar directamente el estado a `OCCUPIED` para habitaciones registradas en `OUT_OF_SERVICE`.
- **FR-010**: El sistema DEBE rechazar el cambio a `OUT_OF_SERVICE` para habitaciones en estado `OCCUPIED` sin previa reasignación de la reserva hospedada.
- **FR-011**: El sistema DEBE interceptar cualquier error de validación de entrada (campos nulos, estados no reconocidos, identificadores inexistentes) y responder con **HTTP 400 (Bad Request)**, prohibiendo fallas de infraestructura **HTTP 500**.
- **FR-012**: El sistema DEBE mantener un registro auditable de cada solicitud de cambio de estado, registrando fecha, actor, habitación, estado anterior, estado solicitado y resultado de integración.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de procesamiento de la solicitud de cambio de estado en la API del Módulo 2 DEBE ser inferior a 1 segundo.
- **NFR-002**: El mecanismo de integración DEBE implementar patrones de tolerancia a fallos para garantizar la consistencia eventual entre el Módulo 2 y el Módulo 1.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **RoomStateRequest**: Representa la orden de actualización de estado enviada al Módulo 1. Atributos clave: `requestId` (identificador único), `roomId` (referencia a la `Room`), `requestedStatus` (`AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`), `previousStatus`, `originEvent` (`CHECK_IN`, `CHECK_OUT`, `CANCELLATION`, `MAINTENANCE`), `requestedAt` (fecha y hora), `requestedBy` (`Receptionist` o `System`), y `roomStateRequestStatus` (`PENDING`, `COMPLETED`, `FAILED`).
- **Room**: Representa la unidad física de alojamiento (definida en Módulo 1). Atributos clave: `roomId`, `roomType`, y `status` (`AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`).
- **Reservation**: Representa la reserva asociada al evento. Atributos clave: `reservationRef`, `assignedRoom`, y `status` (`PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`).
- **CheckIn**: Evento de admisión relacionado. Atributos clave: `reservationRef`, `assignedRoom`, y `status` (`IN_HOUSE`).
- **CheckOut**: Evento de salida relacionado. Atributos clave: `reservationRef`, `room`, y `status` (`COMPLETED`).

---

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de los check-ins exitosos generan una solicitud de cambio de estado a `OCCUPIED`, y al menos el 99% se confirman como `COMPLETED` en el Módulo 1 dentro de los 60 segundos posteriores.
- **SC-002**: El 100% de los check-outs exitosos generan una solicitud de cambio de estado a `CLEANING`.
- **SC-003**: Cero errores de servidor **HTTP 500** son provocados por solicitudes con estados o identificadores de habitación inválidos; el 100% es respondido con **HTTP 400 (Bad Request)**.
- **SC-004**: El 100% de las fallas temporales de comunicación con el Módulo 1 registran la solicitud como `PENDING` sin corromper la admisión o salida en el Módulo 2.
- **SC-005**: El 95% de las solicitudes en estado `PENDING` se sincronizan correctamente a `COMPLETED` en el primer reintento tras el restablecimiento de la conexión.
