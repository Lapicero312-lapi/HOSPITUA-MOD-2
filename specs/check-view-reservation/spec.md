# Especificación de Funcionalidad: Consultar / Ver Reserva

**Creado**: 2026-09-08

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Consultar / Ver Reserva (`Check/View Reservation`) es el servicio interno de localización y auditoría de reservas que sirve de base para todas las operaciones del ciclo de vida del huésped en el hotel. Permite a la **Recepcionista** (en consola interna), al **Huésped** (en portal web de autogestión) y a la **Ota** (vía integración) buscar, filtrar y examinar los detalles completos de una reserva (`Reservation`) a través del código de referencia (`reservationRef`), documento de identidad (`documentId`), nombre del huésped (`fullName`) o rango de fechas. Toda la interacción ocurre dentro de la misma pantalla o barra de consulta:

- Al ingresar un parámetro de búsqueda válido, el sistema ubica la reserva coincidente y presenta su estado actual, fechas de estadía, lista de huéspedes asociados (`Guest`), habitación o categoría asignada (`assignedRoom`), origen (`source`), y desglose financiero o tarifa.
- Esta funcionalidad es un paso operativo previo obligatorio para invocar los casos de uso de **Check-In**, **Check-Out**, **Actualizar Reservación**, y **Cancelar Reservación**.
- El sistema valida los permisos de acceso del canal solicitante: mientras la Recepcionista cuenta con visibilidad global, el Huésped en el portal web solo puede consultar reservas de las que sea titular explícito.
- Si no se ingresan parámetros o se busca una reserva inexistente, el sistema responde con una alerta amigable **HTTP 400 (Bad Request)**.

**Estados de la entidad `Reservation`** (deben mantenerse en estricta concordancia en todo el sistema):
- `status`: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `Room`** (propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

**Clasificación de la entidad `Guest`**:
- `type`: `NATIONAL`, `FOREIGN`.

---

### Historia de Usuario 1 - Consulta y Búsqueda Detallada de Reservas en Recepción (Prioridad: P1)

Una Recepcionista necesita ubicar una reserva existente para verificar sus datos, confirmar el estado actual o iniciar una admisión de check-in o salida de check-out. La Recepcionista ingresa el código de referencia (`reservationRef`), el número de documento de identidad (`documentId`) o el nombre del huésped (`fullName`). El sistema realiza la búsqueda y presenta el resumen completo de la `Reservation` con sus huéspedes, habitación y estado actual. Esta historia es el flujo maestro de la funcionalidad (Happy Path).

**Por qué esta prioridad**: Es la funcionalidad primaria de consulta del sistema. Sin la capacidad de ubicar y visualizar reservas de manera rápida y precisa, la recepción no puede procesar admisiones, modificaciones ni salidas de huéspedes.

**Prueba Independiente**: Se puede probar ingresando el código exacto de una reserva `ACTIVE` o `CHECKED_IN`. Se verifica que el sistema devuelva los atributos exactos de la `Reservation`, incluyendo la lista de `Guest` vinculados, las fechas `startDate` y `endDate`, la `assignedRoom` y el `status` actual. Se complementa buscando por un código inexistente y confirmando la respuesta amigable **HTTP 400 (Bad Request)**.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Consulta exitosa por código de referencia exacto de reserva
   - **Dado** que existe una reserva en el sistema en estado `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT` o `CANCELLED`
   - **Cuando** la Recepcionista ingresa el `reservationRef` exacto y ejecuta la búsqueda
   - **Entonces** el sistema devuelve y presenta los detalles completos de la `Reservation`, incluyendo fechas, huéspedes asociados, habitación asignada, estado actual y desglose tarifario

2. **Escenario**: Búsqueda exitosa por documento de identidad o nombre del huésped
   - **Dado** un huésped con una o más reservas registradas
   - **Cuando** la Recepcionista ingresa el `documentId` o el `fullName` del huésped
   - **Entonces** el sistema presenta el listado de reservas coincidentes asociadas a esa persona, indicando el estado de cada una para su selección

*Escenarios de Error / Caminos Tristes*

3. **Escenario**: Rechazo controlado por parámetro de búsqueda vacío o ausente
   - **Dado** la pantalla de consulta de reservas
   - **Cuando** la Recepcionista intenta ejecutar la búsqueda con el campo de texto vacío o solo espacios
   - **Entonces** el sistema intercepta la solicitud, responde con un código **HTTP 400 (Bad Request)** amigable indicando que debe proporcionar un criterio de búsqueda válido, y no ejecuta consultas innecesarias

4. **Escenario**: Notificación amigable ante reserva no encontrada
   - **Dado** que no existe ninguna reserva en el sistema que coincida con el criterio ingresado
   - **Cuando** la Recepcionista realiza la búsqueda por código o documento
   - **Entonces** el sistema responde con una alerta controlada **HTTP 400 (Bad Request)** informando de manera clara que no se encontró ninguna reserva coincidente

---

### Historia de Usuario 2 - Consulta Restringida de Reserva desde Portal Web de Autogestión (Prioridad: P2)

Un Huésped autenticado en el portal web de autogestión consulta los detalles de su propia reserva ingresando el código de referencia. El sistema verifica que el Huésped sea el titular legítimo de la reserva antes de mostrar la información de la estadía.

**Por qué esta prioridad**: Es un flujo alternativo importante para la autogestión del cliente. Permite al huésped revisar las fechas de su reserva y preparar su llegada, protegiendo la confidencialidad de los datos personales.

**Prueba Independiente**: Se prueba autenticando a un **Guest** e ingresando el `reservationRef` de su reserva `ACTIVE`. Se comprueba que el portal muestre la información correcta. A continuación, se intenta consultar una `reservationRef` perteneciente a otro titular, confirmando que el sistema rechace el acceso con un error controlado **HTTP 400 (Bad Request)**.

**Escenarios de Aceptación**:

1. **Escenario**: Consulta exitosa de reserva propia desde el portal de autogestión
   - **Dado** un **Guest** autenticado en el portal web con una reserva confirmada en estado `ACTIVE` o `CHECKED_IN`
   - **Cuando** el Huésped ingresa el código de su `reservationRef`
   - **Entonces** el sistema valida la titularidad del usuario y presenta el resumen de su estadía, fechas, habitación y estado actual

2. **Escenario**: Rechazo de consulta por falta de autorización sobre una reserva ajena
   - **Dado** un **Guest** autenticado en el portal web
   - **Cuando** el Huésped intenta consultar el código de una `Reservation` que pertenece a otra persona
   - **Entonces** el sistema rechaza la consulta, responde con un código **HTTP 400 (Bad Request)** especificando que la reserva no corresponde a su usuario, y no revela ningún dato privado

---

### Historia de Usuario 3 - Filtrado de Reservas por Estado y Ventana de Estadía (Prioridad: P3)

La Recepcionista filtra las reservas del día seleccionando un rango de fechas y un estado específico (por ejemplo, reservas `ACTIVE` con llegada hoy o reservas `CHECKED_IN` hospedadas actualmente).

**Por qué esta prioridad**: Es una herramienta de soporte operativo para la gestión diaria del inventario y la planificación de recepción, pero no bloquea la consulta individual directa de reservas.

**Prueba Independiente**: Se aplica un filtro seleccionando el estado `ACTIVE` para la fecha actual. Se verifica que el sistema devuelva únicamente las reservas que cumplen ambos criterios, ordenadas por hora estimada de llegada.

**Escenarios de Aceptación**:

1. **Escenario**: Filtrado exitoso de reservas activas para la fecha actual
   - **Dado** la consola de gestión de recepción
   - **Cuando** la Recepcionista filtra por el estado `ACTIVE` y la fecha de hoy
   - **Entonces** el sistema retorna la lista de reservas programadas para ingresar el día de hoy, ocultando aquellas en estado `CHECKED_OUT` o `CANCELLED`

2. **Escenario**: Rechazo de filtrado por rango de fechas invertido o inválido
   - **Dado** el panel de filtros de consulta
   - **Cuando** la Recepcionista ingresa una fecha de inicio posterior a la fecha de fin del rango
   - **Entonces** el sistema rechaza la búsqueda con una alerta **HTTP 400 (Bad Request)** indicando que el rango de fechas es incoherente

---

### Casos Borde

- **Envío de caracteres especiales o patrones maliciosos en el campo de búsqueda**: si se ingresan secuencias de caracteres no permitidos o intentos de inyección en el campo de búsqueda de `reservationRef` o nombre del huésped, el sistema sanitiza la entrada y responde con un error de negocio **HTTP 400 (Bad Request)**, evitando la ejecución de código no autorizado o fallos de infraestructura **HTTP 500**.
- **Formato de código de reserva inválido**: si se busca un código de reserva con un formato de texto o longitud fuera de la especificación oficial, el sistema intercepta la petición y responde con **HTTP 400 (Bad Request)**.
- **Búsqueda concurrente sobre una reserva cuyo estado cambia en el instante de la consulta**: si la Recepcionista consulta una reserva en el mismo instante en que se confirma su check-in o cancelación desde otro canal, el sistema retorna el estado actualizado más reciente garantizando consistencia de lectura.
- **Búsqueda por rango de fechas excesivamente amplio**: si la consulta intenta recuperar reservas sobre un rango de años sin paginación, el sistema delimita el volumen y responde con **HTTP 400 (Bad Request)** sugiriendo acotar el rango de fechas.

---

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE permitir a la `Receptionist`, al `Guest` y a la `Ota` buscar y visualizar la información completa de una `Reservation`.
- **FR-002**: El sistema DEBE soportar búsquedas por código exacto de `reservationRef`, número de documento del huésped (`documentId`), nombre del huésped (`fullName`) o rango de fechas de estadía (`startDate`, `endDate`).
- **FR-003**: El sistema DEBE retornar todos los atributos clave de la reserva encontrada: `reservationRef`, lista de `Guest` asociados, `assignedRoom`, `startDate`, `endDate`, `source`, `status` y desglose tarifario.
- **FR-004**: El sistema DEBE incluir la clasificación del huésped (`type`: `NATIONAL` | `FOREIGN`) y el estado de sus validaciones migratorias en la información consultada.
- **FR-005**: El sistema DEBE verificar en el canal del `Guest` que el usuario autenticado sea el titular de la `Reservation` antes de mostrar sus datos.
- **FR-006**: El sistema DEBE permitir filtrar el listado de reservas por cualquiera de sus estados oficiales: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.
- **FR-007**: El sistema DEBE indicar claramente cuando una reserva consultada ya ha completado su check-in (`CHECKED_IN`) o su check-out (`CHECKED_OUT`), mostrando las marcas de tiempo reales de ingreso o salida.
- **FR-008**: El sistema DEBE retornar una respuesta de no encontrado amigable cuando no existan coincidencias para el criterio de búsqueda enviado.
- **FR-009**: El sistema DEBE rechazar cualquier solicitud de consulta con parámetros vacíos, nulos o con formatos de fecha incoherentes.
- **FR-010**: El sistema DEBE interceptar cualquier error de validación de entrada o búsqueda y responder con códigos **HTTP 400 (Bad Request)** controlados, prohibiendo que se generen errores **HTTP 500**.
- **FR-011**: El sistema DEBE registrar cada consulta realizada en la auditoría de acceso cuando se trate de datos personales sensibles de los huéspedes.
- **FR-012**: El sistema DEBE asegurar que la información mostrada corresponda al estado persistido más reciente en la base de datos.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de respuesta del servidor para resolver una consulta de reserva por `reservationRef` DEBE ser inferior a 500 milisegundos.
- **NFR-002**: El servicio de consulta DEBE ser de solo lectura e idempotente, sin producir modificaciones de estado en las entidades consultadas.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Reservation**: Entidad principal consultada. Atributos clave: `reservationRef` (código único), `guests` (lista de `Guest`), `assignedRoom` (habitación o categoría), `startDate` (fecha de inicio), `endDate` (fecha de fin), `source` (origen: directa o OTA), y `status` (`PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`).
- **Guest**: Personas asociadas a la reserva. Atributos clave: `fullName`, `documentId`, `nationality`, y `type` (`NATIONAL` | `FOREIGN`).
- **Room**: Unidad física asociada. Atributos clave: `roomId`, `roomType`, y `status` (`AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`).
- **CheckIn**: Registro de admisión (si aplica). Atributos clave: `arrivalTime`, `receptionist`, `status` (`IN_HOUSE`).
- **CheckOut**: Registro de salida (si aplica). Atributos clave: `departureTime`, `finalAmount`, `status` (`COMPLETED`).

---

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de las búsquedas por `reservationRef` exacto retornan los datos completos de la reserva en menos de 500 milisegundos.
- **SC-002**: El 100% de los intentos de consulta por el canal web de autogestión sobre reservas ajenas son bloqueados con respuestas **HTTP 400 (Bad Request)** sin revelar datos privados.
- **SC-003**: Cero errores de servidor **HTTP 500** se generan ante consultas con texto vacío, fechas invertidas o caracteres no permitidos; el 100% es respondido de forma controlada con **HTTP 400 (Bad Request)**.
- **SC-004**: Una Recepcionista puede ubicar cualquier reserva activa por el nombre o documento del huésped en menos de 10 segundos.
- **SC-005**: El 100% de los casos de uso del sistema (**Check-In**, **Check-Out**, **Actualizar**, **Cancelar**) obtienen el estado más reciente de la reserva a través de esta funcionalidad antes de aplicar modificaciones.
