# Feature Specification: Consultar Reservas

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

Casi ninguna operación del Módulo 2 puede ejecutarse a ciegas: antes de cancelar, actualizar,
verificar disponibilidades o procesar un Check-In o Check-Out, el sistema necesita ubicar la reserva
exacta y conocer su estado vigente. Si cada funcionalidad implementara su propia búsqueda, los
criterios y las validaciones de acceso serían inconsistentes. El negocio necesita un único servicio
de consulta, reutilizado por el resto de funcionalidades y disponible también para el Módulo 1, que
localice reservas por referencia, documento o nombre, y que devuelva siempre el estado vigente de la reserva.

### Flujo de Usuario de Alto Nivel

1. La **Recepcionista** o el **Módulo 1** envían un criterio de
   búsqueda: la referencia de la reserva (`reservationRef`), el documento del huésped
   (`documentNumber`) o su nombre (`fullName`).
2. El sistema busca la `Reservation` coincidente en la base de datos local.
3. El sistema retorna el detalle completo: `status`, fechas, habitación, titular y origen.
4. Si no se envía criterio o no existe coincidencia, responde con una alerta controlada **HTTP 400
   (Bad Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consulta de Reservas por Recepción y por el Módulo 1 (Priority: P1)

La Recepcionista, o el Módulo 1 mediante su integración, necesita consultar el estado y el detalle
completo de una `Reservation` para verificar sus datos, confirmar su estado o dar paso a otra
operación. Esta historia es el flujo maestro de lectura y se consolida con la búsqueda por
documento o nombre y los rechazos por reserva inexistente.

**Why this priority**: Es la funcionalidad de lectura indispensable para cualquier actualización,
cancelación, verificación de disponibilidad o notificación de Check-In y Check-Out.

**Independent Test**: Se consulta una reserva existente en distintos estados y se verifica que se
retorne el detalle completo; se busca por documento y nombre; y se busca un código inexistente
confirmando la respuesta controlada **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Consulta exitosa por referencia (Happy Path)
   - **Given** una `Reservation` válida en la base de datos
   - **When** la Recepcionista o el Módulo 1 envía la `reservationRef` exacta
   - **Then** el sistema retorna el `status` explícito (por ejemplo `ACTIVE`), las fechas, la
     `Room` asociada y los datos del titular (`Guest`)

2. **Scenario**: Búsqueda por documento o nombre del huésped
   - **Given** un huésped con una o más reservas
   - **When** la Recepcionista ingresa su `documentNumber` o `fullName`
   - **Then** el sistema lista las reservas coincidentes con su `status` para su selección

3. **Scenario**: Consulta de una reserva inexistente (Error)
   - **Given** una referencia errónea o borrada
   - **When** se consulta la reserva
   - **Then** el sistema intercepta la excepción y responde con un error controlado **HTTP 400** indicando que la reserva no existe

### Casos Borde

- ¿Qué sucede si la consulta carece del identificador o viene con espacios? El sistema la intercepta
  con **HTTP 400 (Bad Request)** y el mensaje: "Debe proveer un identificador de reserva válido para
  la consulta."
- ¿Qué sucede si se envían caracteres especiales o intentos de inyección en el identificador? El
  sistema valida el formato, detiene la petición y responde **HTTP 400**, sin provocar caídas del
  servidor **HTTP 500**.
- ¿Cómo maneja el sistema una consulta sobre una reserva cuyo `status` cambia en ese instante? El
  sistema retorna el estado persistido más reciente, garantizando consistencia de lectura.
- ¿Qué sucede si una búsqueda por rango de fechas devuelve un volumen excesivo? El sistema limita el
  volumen y responde **HTTP 400** sugiriendo acotar el rango.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir a la Recepcionista y al Módulo 1 consultar el
  detalle de una `Reservation`.
- **FR-002**: El sistema debe soportar búsquedas por `reservationRef`, `documentNumber` o
  `fullName`.
- **FR-003**: El sistema debe retornar `reservationRef`, `guestRef`, `roomId`, `startDate`,
  `endDate`, `source` y el `status` unificado: `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`,
  `CANCELLED` o `NO_SHOW`.
- **FR-004**: El sistema debe ser de solo lectura e idempotente, sin modificar ninguna entidad.
- **FR-005**: El sistema debe interceptar las consultas inválidas y responder **HTTP 400 (Bad
  Request)**, prohibiendo la propagación a **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La consulta por `reservationRef` debe responder en menos de 500 milisegundos.

### Key Entities *(include if feature involves data)*

- **Reservation**: Entidad consultada. Atributos: `reservationRef`, `guestRef`, `roomId`,
  `startDate`, `endDate`, `source` (`DIRECT` | `OTA`) y `status` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `nationality`,
  `contactPhone`, `contactEmail`.
- **Room**: Habitación asociada. Atributos: `roomId`, `numberRoom`, `categoryRoom` y `status`
  (`AVAILABLE` | `RESERVED` | `OCCUPIED`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las consultas por `reservationRef` exacta retornan el detalle completo en
  menos de 500 milisegundos.
- **SC-002**: Cero errores **HTTP 500** ante identificadores vacíos, inválidos o inexistentes.
