# Feature Specification: Consultar Calendario de Mantenimientos

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

Una habitación puede estar libre hoy y, aun así, no poder reservarse para unas fechas futuras porque
el hotel programó una reparación o un mantenimiento. Esa programación pertenece al Módulo 1, que es
quien administra el hotel en persona. Si el Módulo 2 aceptara reservas sin consultarla, el hotel
terminaría comprometiendo a un huésped en una habitación que estará inhabilitada, y tendría que
reubicarlo o cancelarle en el último momento. El negocio necesita una consulta de solo lectura al
calendario de mantenimientos del Módulo 1 que "Verificar disponibilidades" use antes de confirmar
cualquier reserva.

### Flujo de Usuario de Alto Nivel

1. El caso de uso "Verificar disponibilidades" invoca "Consultar calendario de mantenimientos"
   enviando el `roomId` y el rango de fechas (`startDate` y `endDate`) de la estadía solicitada.
2. El sistema consulta de forma síncrona el calendario de mantenimientos del **Módulo 1**.
3. El Módulo 1 retorna los mantenimientos programados que se cruzan con el rango, si existen.
4. Si existe algún cruce, el sistema informa que la `Room` estará inhabilitada en esas fechas; si no
   existe, informa que no hay mantenimientos que impidan la reserva.
5. Si el Módulo 1 no responde o los datos enviados son inválidos, el sistema informa el fallo con un
   error de negocio controlado **HTTP 400 (Bad Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Detección de Mantenimientos que Cruzan una Estadía (Priority: P1)

Antes de confirmar una reserva, el sistema consulta el calendario de mantenimientos del Módulo 1
para el `roomId` y las fechas solicitadas, y determina si la habitación estará disponible o
inhabilitada. Por tratarse de una única consulta de lectura, el camino sin mantenimientos, el cruce
con un mantenimiento y los fallos de integración se consolidan en esta misma historia de usuario.

**Why this priority**: Evita que el hotel reserve habitaciones que estarán en reparación durante la
estadía, protegiendo la experiencia del huésped y evitando reubicaciones de último momento.

**Independent Test**: Se consulta una `Room` sin mantenimientos programados y se verifica que se
informe como libre; se consulta otra con un mantenimiento que se cruza con el rango y se verifica
que
se informe como inhabilitada, indicando las fechas del cruce.

**Acceptance Scenarios**:

1. **Scenario**: Habitación sin mantenimientos en el rango (Happy Path)
   - **Given** una `Room` que no tiene mantenimientos programados en el rango de fechas solicitado
   - **When** el sistema consulta el calendario del Módulo 1
   - **Then** el sistema informa que no existen mantenimientos que impidan la reserva

2. **Scenario**: Mantenimiento programado que cruza la estadía
   - **Given** una `Room` con un mantenimiento programado que se solapa total o parcialmente con el
     rango solicitado
   - **When** el sistema consulta el calendario del Módulo 1
   - **Then** el sistema informa que la habitación estará inhabilitada por mantenimiento en esas
     fechas y devuelve el periodo del cruce

3. **Scenario**: Mantenimiento contiguo que no cruza la estadía
   - **Given** una `Room` cuyo mantenimiento termina justo antes de la fecha de llegada solicitada
   - **When** el sistema consulta el calendario del Módulo 1
   - **Then** el sistema informa que no hay cruce y la habitación puede reservarse

### Casos Borde

- ¿Qué sucede si el Módulo 1 no responde o agota el tiempo de espera? El sistema intercepta la
  falla, prohíbe la propagación del error y retorna **HTTP 400 (Bad Request)** con el mensaje: "No
  es posible validar mantenimientos en este momento. Intente de nuevo." No asume que la habitación
  esté libre.
- ¿Qué sucede si las fechas son inválidas (por ejemplo, salida anterior a la llegada)? El sistema
  detecta la inconsistencia y retorna **HTTP 400** con el mensaje: "Rango de fechas inválido.
  Verifique las fechas seleccionadas."
- ¿Qué sucede si el `roomId` no existe o tiene caracteres inválidos? El sistema retorna **HTTP 400**
  con el mensaje: "El identificador de la habitación es inválido."
- ¿Qué sucede si un mantenimiento se programa después de crear la reserva? Esta consulta solo valida
  el momento de la reserva; el Módulo 1 gestiona la reubicación operativa de las reservas
  afectadas por mantenimientos posteriores.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe consultar el calendario de mantenimientos del Módulo 1 para el
  `roomId` y el rango de fechas recibidos.
- **FR-002**: El sistema debe considerar cruce cualquier mantenimiento que se solape, total o
  parcialmente, con el rango de la estadía solicitada.
- **FR-003**: El sistema debe informar a "Verificar disponibilidades" si la `Room` estará
  inhabilitada, incluyendo el periodo del cruce.
- **FR-004**: El sistema debe ser de solo lectura: no debe crear, modificar ni cancelar
  mantenimientos, que son propiedad del Módulo 1.
- **FR-005**: El sistema no debe asumir disponibilidad cuando el Módulo 1 no responda: debe
  bloquear la validación y responder con un error controlado.
- **FR-006**: El sistema debe interceptar fechas inválidas, identificadores inválidos y fallos de
  integración, respondiendo con **HTTP 400 (Bad Request)** y prohibiendo **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La consulta al calendario del Módulo 1 debe completarse en menos de 1 segundo en
  condiciones normales.

### Key Entities *(include if feature involves data)*

- **MaintenanceSchedule**: Programación de mantenimiento, propiedad del Módulo 1. Atributos:
  `roomId`, `maintenanceStart`, `maintenanceEnd` y `reason`. Esta funcionalidad solo la consulta.
- **Room**: Habitación física. Atributos: `roomId`, `roomNumber`, `categoryRoom` y `status`
  (`AVAILABLE` | `RESERVED` | `OCCUPIED`).
- **Reservation**: Se referencia de forma informativa: es la reserva que se intenta crear o
  modificar. Atributos: `roomId`, `startDate`, `endDate`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas nuevas o modificadas pasan por la consulta del calendario de
  mantenimientos antes de confirmarse.
- **SC-002**: Cero reservas se confirman sobre una `Room` con un mantenimiento programado que cruce
  su estadía.
- **SC-003**: Cero errores **HTTP 500** por fallos del Módulo 1, fechas o identificadores
  inválidos; el 100% se responde con **HTTP 400**.
