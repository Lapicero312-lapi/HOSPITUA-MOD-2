# Feature Specification: Consultar / Ver Reserva

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Casi ninguna operación del Módulo 2 puede ejecutarse a ciegas: antes de cancelar, actualizar,
registrar un Check-In o un Check-Out, el sistema necesita ubicar la reserva exacta y conocer su
estado vigente. Si cada funcionalidad implementara su propia búsqueda, aparecerían criterios de
localización inconsistentes y validaciones de acceso distintas según la pantalla. El negocio
necesita un único servicio de consulta, reutilizado como paso previo obligatorio por el resto de
las funcionalidades, que localice una reserva por su referencia, por el documento del huésped o por
su nombre, y que respete los límites de visibilidad de cada canal: mientras la Recepcionista ve
cualquier reserva, el Huésped en el portal de autogestión solo puede ver la suya.

### Flujo de Usuario de Alto Nivel

1. El **Recepcionista** (con visibilidad global), el **Huésped** (desde el portal de autogestión,
   restringido a su propia reserva) o la **Ota** (mediante su integración) envían un criterio de
   búsqueda: la referencia de la reserva (`reservationRef`), el documento del huésped
   (`documentNumber`) o su nombre (`fullName`).
2. El sistema busca la `Reservation` coincidente en la base de datos local del Módulo 2.
3. Si el canal es el del Huésped, el sistema verifica que el usuario autenticado sea el titular
   (`guestRef`) antes de mostrar cualquier dato.
4. El sistema retorna el detalle completo: estado (`state`), fechas de estadía, categoría o
   habitación asignada, huésped titular y origen (`source`).
5. Si no se ingresa ningún criterio o no existe ninguna reserva coincidente, el sistema responde con
   una alerta controlada **HTTP 400 (Bad Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta y Búsqueda de Reservas en Recepción (Priority: P1)

Una Recepcionista necesita ubicar una reserva existente para verificar sus datos, confirmar su
estado actual o dar paso a un Check-In, un Check-Out, una actualización o una cancelación. La
Recepcionista ingresa la `reservationRef`, el `documentNumber` o el `fullName` del huésped, y el
sistema retorna el resumen completo de la `Reservation` coincidente. Esta historia es el flujo
maestro de la funcionalidad (Happy Path).

**Why this priority**: Es la funcionalidad primaria de consulta del sistema. Sin la capacidad de
ubicar y visualizar reservas de manera rápida y precisa, la recepción no puede procesar
admisiones, modificaciones ni salidas de huéspedes.

**Independent Test**: Se puede probar ingresando el código exacto de una reserva en cualquier
estado y verificando que el sistema devuelva sus atributos exactos, incluyendo el huésped
vinculado, las fechas de estadía, la categoría asignada y el `state` actual. Se completa buscando
por un código inexistente y confirmando la respuesta controlada **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Consulta exitosa por referencia exacta de reserva (Happy Path)
   - **Given** que existe una reserva en el sistema en cualquiera de sus estados oficiales
   - **When** la Recepcionista ingresa la `reservationRef` exacta y ejecuta la búsqueda
   - **Then** el sistema devuelve y presenta los detalles completos de la `Reservation`, incluyendo
     fechas, huésped asociado, categoría o habitación asignada, `state` actual y origen (`source`)

2. **Scenario**: Búsqueda exitosa por documento o nombre del huésped
   - **Given** un huésped con una o más reservas registradas
   - **When** la Recepcionista ingresa el `documentNumber` o el `fullName` del huésped
   - **Then** el sistema presenta el listado de reservas coincidentes asociadas a esa persona,
     indicando el `state` de cada una para su selección

3. **Scenario**: Notificación amigable ante reserva no encontrada (Error)
   - **Given** que no existe ninguna reserva en el sistema que coincida con el criterio ingresado
   - **When** la Recepcionista realiza la búsqueda por referencia o documento
   - **Then** el sistema responde con una alerta controlada **HTTP 400 (Bad Request)** informando
     que no se encontró ninguna reserva coincidente

---

### User Story 2 - Consulta Restringida de Reserva desde el Portal del Huésped (Priority: P2)

Un Huésped autenticado en el portal web de autogestión consulta los detalles de su propia reserva
ingresando su `reservationRef`. El sistema verifica que sea el titular legítimo antes de mostrar
cualquier información de la estadía.

**Why this priority**: Es un flujo importante para la autogestión del cliente, que le permite
revisar su reserva y preparar su llegada, protegiendo la confidencialidad de los datos de otros
huéspedes.

**Independent Test**: Se prueba autenticando a un `Guest` y consultando su propia
`reservationRef`. Se comprueba que el portal muestre la información correcta, y luego se intenta
consultar una `reservationRef` de otro titular, confirmando el rechazo con **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Consulta exitosa de reserva propia desde el portal (Happy Path)
   - **Given** un `Guest` autenticado en el portal web que es titular de una reserva
   - **When** el Huésped ingresa el código de su `reservationRef`
   - **Then** el sistema valida la titularidad y presenta el resumen de su estadía, fechas,
     categoría o habitación y `state` actual

2. **Scenario**: Rechazo de consulta sobre una reserva ajena (Error)
   - **Given** un `Guest` autenticado en el portal web
   - **When** el Huésped intenta consultar la `reservationRef` de una reserva que pertenece a otra
     persona
   - **Then** el sistema rechaza la consulta con **HTTP 400 (Bad Request)**, indicando que la
     reserva no corresponde a su usuario, y no revela ningún dato privado

### Casos Borde

- ¿Qué sucede si se ejecuta la búsqueda con el criterio vacío o solo con espacios? El sistema
  intercepta la solicitud y responde con **HTTP 400 (Bad Request)** indicando que debe
  proporcionarse un criterio de búsqueda válido, sin ejecutar consultas innecesarias.
- ¿Qué sucede si se envían caracteres especiales o patrones de inyección en el campo de búsqueda?
  El sistema sanitiza la entrada y responde con **HTTP 400**, evitando la ejecución de código no
  autorizado o una falla de infraestructura **HTTP 500**.
- ¿Cómo maneja el sistema una búsqueda concurrente sobre una reserva cuyo `state` cambia en el
  mismo instante (por ejemplo, se confirma su Check-In desde otro canal)? El sistema retorna el
  `state` más reciente persistido, garantizando consistencia de lectura.
- ¿Qué sucede si la búsqueda por rango de fechas es excesivamente amplia y produce un volumen
  inusual de resultados? El sistema delimita el volumen retornado y responde con **HTTP 400**
  sugiriendo acotar el rango de fechas.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir a la Recepcionista, al Huésped y a la Ota buscar y visualizar
  la información completa de una `Reservation`.
- **FR-002**: El sistema debe soportar búsquedas por `reservationRef` exacta, `documentNumber` o
  `fullName` del huésped.
- **FR-003**: El sistema debe retornar los atributos clave de la reserva encontrada:
  `reservationRef`, `guestRef`, categoría o habitación asignada, `startDate`, `endDate`, `source` y
  `state`.
- **FR-004**: El sistema debe verificar, en el canal del Huésped, que el usuario autenticado sea el
  titular (`guestRef`) de la `Reservation` antes de mostrar sus datos.
- **FR-005**: El sistema debe indicar con claridad cuando una reserva consultada ya completó su
  Check-In (`CHECKED_IN`) o su Check-Out (`CHECKED_OUT`).
- **FR-006**: El sistema debe retornar una respuesta de no encontrado amigable cuando no existan
  coincidencias para el criterio de búsqueda enviado.
- **FR-007**: El sistema debe rechazar cualquier solicitud de consulta con parámetros vacíos, nulos
  o con caracteres no permitidos.
- **FR-008**: El sistema debe interceptar cualquier error de validación de entrada y responder con
  códigos **HTTP 400 (Bad Request)** controlados, prohibiendo que se generen errores **HTTP 500**.
- **FR-009**: El sistema debe asegurar que la información mostrada corresponda al `state`
  persistido más reciente en la base de datos.

### Non-Functional Requirements

- **NFR-001**: El tiempo de respuesta del servidor para resolver una consulta por `reservationRef`
  debe ser inferior a 500 milisegundos.
- **NFR-002**: El servicio de consulta debe ser de solo lectura e idempotente, sin producir
  modificaciones de estado en las entidades consultadas.

### Key Entities *(include if feature involves data)*

- **Reservation**: Entidad principal consultada. Atributos: `reservationRef`, `guestRef`,
  categoría o habitación asignada, `startDate`, `endDate`, `source` (`DIRECT` | `OTA`), y `state`
  con estados permitidos: `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. El estado `PENDING`
  queda inhabilitado en los flujos estándar: toda reserva, sin importar su canal de origen, nace
  directamente en `ACTIVE`.
- **Guest**: Titular y acompañantes de la reserva. Atributos: `id`, `fullName`, `documentNumber`,
  `nationality`, `contactPhone`, `contactEmail`.
- **Habitation**: Unidad física o categoría asociada. Atributos: `habitationId`,
  `numberHabitation`, y `stateHabitation` con los siete estados oficiales del glosario:
  `Available`, `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`,
  `Inactive`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las búsquedas por `reservationRef` exacta retornan los datos completos de
  la reserva en menos de 500 milisegundos.
- **SC-002**: El 100% de los intentos de consulta desde el portal del Huésped sobre reservas ajenas
  son bloqueados con **HTTP 400 (Bad Request)** sin revelar datos privados.
- **SC-003**: Cero errores de servidor **HTTP 500** se generan ante consultas con texto vacío o
  caracteres no permitidos; el 100% se responde con **HTTP 400**.
- **SC-004**: Una Recepcionista puede ubicar cualquier reserva activa por el nombre o documento del
  huésped en menos de 10 segundos.
