# Especificación de Funcionalidad: Consultar Disponibilidad de Habitaciones

**Creado**: 2026-09-08

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Consultar Disponibilidad de Habitaciones (`Check Room Availability`) es el servicio de búsqueda y verificación de inventario físico de habitaciones (coordinado con el **Módulo 1**). Su objetivo es determinar en tiempo real qué unidades físicas o tipos de habitación (`Room`) se encuentran en estado `AVAILABLE` dentro de un rango de fechas determinado (`startDate` a `endDate`), considerando la capacidad de ocupación y características requeridas. Toda la interacción ocurre dentro de los flujos de creación de reservas, actualización de estadías o consulta de recepción:

- Al ingresar las fechas deseadas y el tipo de habitación, el sistema consulta el estado del inventario en el **Módulo 1**, descontando las unidades ocupadas por reservas activas (`ACTIVE` o `CHECKED_IN`) y aquellas bloqueadas por aseo o mantenimiento (`CLEANING` o `OUT_OF_SERVICE`).
- Si existen unidades disponibles, el sistema presenta las opciones con su categoría, tarifa base recomendada y capacidad.
- Esta funcionalidad es una validación previa obligatoria antes de confirmar la creación de una reserva o la modificación de fechas/habitación en una reserva existente.
- Si no hay disponibilidad para el periodo o se ingresan fechas incoherentes, el sistema informa la falta de vacantes o responde con una alerta amigable **HTTP 400 (Bad Request)**.

**Estados de la entidad `Reservation`**: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `Room`** (propiedad del Módulo 1):
- `status`: `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

**Clasificación de la entidad `Guest`**: `NATIONAL`, `FOREIGN`.

---

### Historia de Usuario 1 - Búsqueda de Disponibilidad de Habitaciones para Reservación (Prioridad: P1)

La Recepcionista (o el Huésped en portal web) consulta la disponibilidad de habitaciones ingresando la fecha de llegada (`startDate`), la fecha de salida (`endDate`) y el tipo de habitación (`roomType`). El sistema consulta el inventario físico en el Módulo 1 y presenta la lista de habitaciones disponibles en estado `AVAILABLE`. Esta historia es el flujo maestro (Happy Path) que habilita el proceso de reserva.

**Por qué esta prioridad**: Es la funcionalidad primaria del negocio para la captación de reservas. Sin la capacidad de verificar qué habitaciones están libres en un rango de fechas, el hotel no puede ofrecer alojamiento ni concretar reservaciones de forma segura.

**Prueba Independiente**: Se prueba enviando una consulta para un rango de 2 noches en una fecha futura con disponibilidad confirmada en el Módulo 1. Se comprueba que el sistema retorne la lista de categorías o números de `Room` con estado `AVAILABLE`. Se repite la prueba para una fecha con ocupación del 100%, comprobando que el sistema reporte cero unidades disponibles y sugiera fechas o categorías alternativas.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Búsqueda exitosa con habitaciones libres disponibles
   - **Dado** un rango de fechas válido (`startDate` a `endDate`) en el que existen unidades físicas en estado `AVAILABLE` en el Módulo 1
   - **Cuando** la Recepcionista o el Huésped invoca "Check Room Availability"
   - **Entonces** el sistema retorna la lista de opciones de `Room` libres coincidentes con la categoría seleccionada y su capacidad de ocupación

2. **Escenario**: Notificación clara ante ocupación completa en la categoría deseada
   - **Dado** un rango de fechas en el cual todas las habitaciones de una categoría están asignadas a reservas en `ACTIVE` o `CHECKED_IN`
   - **Cuando** se solicita consultar la disponibilidad para esa categoría
   - **Entonces** el sistema informa que la disponibilidad es cero para las fechas seleccionadas y presenta las categorías alternativas que sí cuentan con unidades `AVAILABLE`

*Escenarios de Error / Caminos Tristes*

3. **Escenario**: Rechazo controlado por rango de fechas invertido o incoherente
   - **Dado** la pantalla de consulta de disponibilidad
   - **Cuando** el usuario ingresa una fecha de llegada posterior o igual a la fecha de salida (`startDate >= endDate`)
   - **Entonces** el sistema detiene la consulta, responde con un código **HTTP 400 (Bad Request)** amigable indicando la incoherencia de fechas, y no realiza peticiones innecesarias al Módulo 1

4. **Escenario**: Rechazo por consulta sobre fechas pasadas
   - **Dado** una solicitud de disponibilidad
   - **Cuando** el usuario ingresa una fecha de llegada anterior a la fecha actual del sistema
   - **Entonces** el sistema rechaza la búsqueda con una alerta **HTTP 400 (Bad Request)** informando que solo se puede consultar disponibilidad para la fecha de hoy en adelante

---

### Historia de Usuario 2 - Verificación de Disponibilidad para Modificación de Reservas (Prioridad: P2)

Al solicitar la actualización de fechas o categoría de una reserva existente en estado `ACTIVE`, el sistema ejecuta "Check Room Availability" para verificar si existe espacio físico libre en el nuevo rango solicitado antes de autorizar el cambio.

**Por qué esta prioridad**: Es un flujo alternativo esencial que protege al hotel contra la sobreventa de habitaciones durante las modificaciones de reserva por parte de recepcionistas, usuarios o canales OTA.

**Prueba Independiente**: Se toma una reserva `ACTIVE` y se solicita cambiar sus fechas a un periodo con cupo libre. Se verifica que "Check Room Availability" retorne confirmación favorable y permita avanzar hacia la recotización. Se intenta el mismo cambio hacia un periodo sin vacantes, confirmando que la consulta bloquee la actualización con una respuesta **HTTP 400 (Bad Request)**.

**Escenarios de Aceptación**:

1. **Escenario**: Disponibilidad confirmada para modificación de fechas de reserva
   - **Dado** una reserva en estado `ACTIVE` para la cual se solicita un nuevo rango de fechas
   - **Cuando** el sistema invoca "Check Room Availability" sobre las nuevas fechas
   - **Entonces** el sistema confirma la presencia de habitaciones libres en estado `AVAILABLE` en el Módulo 1 y autoriza continuar con el proceso de actualización

2. **Escenario**: Bloqueo de modificación por falta de disponibilidad en las nuevas fechas
   - **Dado** una reserva en estado `ACTIVE`
   - **Cuando** el solicitante intenta cambiar las fechas a un rango que no posee unidades disponibles en la categoría asignada
   - **Entonces** el sistema bloquea el cambio, responde con una alerta **HTTP 400 (Bad Request)** indicando la falta de disponibilidad, y mantiene la reserva original con sus fechas e inventario intactos

---

### Historia de Usuario 3 - Filtro Avanzado por Capacidad y Amenidades de Habitación (Prioridad: P3)

La Recepcionista filtra las habitaciones disponibles especificando el número de huéspedes (adultos/niños) o características requeridas (por ejemplo, cama matrimonial, vista al mar o accesibilidad).

**Por qué esta prioridad**: Mejora la experiencia de atención al cliente en recepción al permitir recomendaciones personalizadas, pero no impide la búsqueda de disponibilidad estándar por categoría.

**Prueba Independiente**: Se consulta disponibilidad filtrando por capacidad para 4 personas. Se verifica que el sistema retorne únicamente las habitaciones `AVAILABLE` cuya capacidad máxima sea igual o superior a 4.

**Escenarios de Aceptación**:

1. **Escenario**: Filtrado exitoso por capacidad de huéspedes
   - **Dado** una consulta de disponibilidad
   - **Cuando** la Recepcionista ingresa una capacidad requerida de 4 personas
   - **Entonces** el sistema filtra el inventario del Módulo 1 y presenta únicamente las unidades de `Room` disponibles que satisfacen o superan dicha capacidad

2. **Escenario**: Notificación amigable cuando no existen habitaciones con las amenidades solicitadas
   - **Dado** una búsqueda con filtros específicos de amenidades
   - **Cuando** no existen habitaciones en estado `AVAILABLE` que cumplan todos los filtros para las fechas seleccionadas
   - **Entonces** el sistema notifica de forma clara la falta de coincidencias exactas y ofrece las opciones disponibles más cercanas

---

### Casos Borde

- **Indisponibilidad o fallo de comunicación con el servicio de inventario (Módulo 1)**: si el Módulo 1 no responde durante la consulta de disponibilidad, el sistema no debe asumir disponibilidad infinita ni responder cero arbitrariamente; debe responder con un error **HTTP 400 (Bad Request)** controlado indicando la indisponibilidad temporal del servicio e invitando a reintentar.
- **Consultas con formatos de fecha corruptos o texto no válido**: si se envían fechas con caracteres extraños o formatos no reconocidos, el sistema intercepta la entrada y retorna un código **HTTP 400 (Bad Request)** sin propagar excepciones al servidor (HTTP 500).
- **Concurrencia en la reserva de la última habitación disponible**: si dos usuarios consultan y reservan la última unidad `AVAILABLE` de forma simultánea, la primera reserva en confirmarse bloquea el inventario, mientras que la segunda es notificada inmediatamente de la falta de disponibilidad mediante **HTTP 400 (Bad Request)**.
- **Consultas sobre habitaciones marcadas en `CLEANING` o `OUT_OF_SERVICE`**: el sistema descuenta automáticamente estas unidades de la disponibilidad ofertada, garantizando que solo habitaciones en estado real `AVAILABLE` sean comprometidas.

---

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE permitir a la `Receptionist`, al `Guest` y a la `Ota` consultar la disponibilidad de habitaciones en tiempo real.
- **FR-002**: El sistema DEBE exigir la fecha de entrada (`startDate`) y la fecha de salida (`endDate`) como parámetros obligatorios para cualquier consulta de disponibilidad.
- **FR-003**: El sistema DEBE consultar el estado físico del inventario de habitaciones (`Room`) en el **Módulo 1**.
- **FR-004**: El sistema DEBE descontar del inventario disponible las habitaciones asociadas a reservas en estado `ACTIVE` o `CHECKED_IN` para el periodo consultado.
- **FR-005**: El sistema DEBE excluir de la oferta de disponibilidad aquellas habitaciones cuyo estado en el Módulo 1 sea `CLEANING` o `OUT_OF_SERVICE`.
- **FR-006**: El sistema DEBE permitir filtrar la disponibilidad por tipo de habitación (`roomType`), capacidad de ocupación y características requeridas.
- **FR-007**: El sistema DEBE validar la disponibilidad de inventario de forma síncrona antes de autorizar la creación de una nueva reserva o la modificación de fechas de una existente.
- **FR-008**: El sistema DEBE sugerir categorías de habitación alternativas cuando la categoría solicitada tenga disponibilidad cero.
- **FR-009**: El sistema DEBE rechazar cualquier consulta de disponibilidad cuyos parámetros de fecha estén invertidos (`startDate >= endDate`) o pertenezcan al pasado.
- **FR-010**: El sistema DEBE interceptar cualquier fallo de validación de entrada o error de integración con Módulo 1 y responder con códigos **HTTP 400 (Bad Request)** amigables, prohibiendo que se originen errores **HTTP 500**.
- **FR-011**: El sistema DEBE asegurar que la consulta de disponibilidad sea de solo lectura y no altere el estado físico de las habitaciones.
- **FR-012**: El sistema DEBE mantener un registro auditable de las consultas de disponibilidad masivas para control de carga del servidor.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de respuesta de la consulta de disponibilidad DEBE ser inferior a 800 milisegundos en condiciones normales.
- **NFR-002**: El servicio de disponibilidad DEBE garantizar consistencia en tiempo real con el inventario físico gestionado por el Módulo 1.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Room**: Unidad física de alojamiento consultada (propiedad del Módulo 1). Atributos clave: `roomId`, `roomType`, `capacity`, `amenities`, y `status` (`AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`).
- **Reservation**: Reservas que comprometen el inventario. Atributos clave: `reservationRef`, `assignedRoom`, `startDate`, `endDate`, y `status` (`PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`).
- **Guest**: Cliente solicitante. Atributos clave: `fullName`, `documentId`, `type` (`NATIONAL` | `FOREIGN`).

---

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de las respuestas de disponibilidad reflejan con precisión exacta el estado del inventario del Módulo 1 en el momento de la consulta.
- **SC-002**: Cero reservas duplicadas o sobreventas se confirman para el mismo número de habitación y rango de fechas.
- **SC-003**: Cero errores de servidor **HTTP 500** son provocados por búsquedas con fechas pasadas, invertidas o caracteres no válidos; el 100% es respondido con **HTTP 400 (Bad Request)**.
- **SC-004**: El tiempo de respuesta de la consulta de disponibilidad es inferior a 800 milisegundos en el 99% de las solicitudes.
- **SC-005**: El 100% de los intentos de modificación de reservas a periodos sin vacantes son bloqueados de forma segura informando la falta de disponibilidad.
