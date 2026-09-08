# Feature Specification: Consultar Inventario y Estado de Habitaciones

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Casi todas las operaciones de recepción dependen de saber, en el instante, en qué estado físico se
encuentra una habitación: un Check-In solo puede completarse contra una `Habitation` que esté
realmente `Available`, un Check-Out solo tiene sentido sobre una que esté `Occupied`, y ofrecer una
alternativa a un huésped sin habitación predefinida exige ver de un vistazo cuáles están libres.
Ese estado físico es propiedad exclusiva del Módulo 1: si el Módulo 2 asumiera valores propios o
guardara una copia desactualizada, aparecerían sobreventas físicas o bloqueos de check-in
innecesarios sobre habitaciones que en realidad ya están listas. El negocio necesita una consulta
puntual y confiable, en tiempo real, contra la fuente de verdad del Módulo 1, tanto para validar
una habitación específica como para listar las que están disponibles. Esta consulta síncrona es
exclusiva de los momentos en que ya existe una `Habitation` física concreta que validar —el
Check-In y el Check-Out—; la creación o actualización de una reserva nunca la invoca, ya que esa
etapa resuelve la disponibilidad mediante aforo lógico, de forma 100% local en la base de datos del
Módulo 2, sin depender del Módulo 1.

### Flujo de Usuario de Alto Nivel

1. El **Recepcionista**, o un proceso interno del Módulo 2 como Check-In o Check-Out, solicita el
   estado físico de una `Habitation` puntual mediante su `habitationId`, o solicita el listado
   general de habitaciones filtrado por el estado `Available`.
2. El sistema consulta de forma síncrona el inventario del **Módulo 1**, fuente de verdad exclusiva
   del estado físico de la `Habitation`.
3. Si la consulta es puntual, el sistema retorna el `stateHabitation` actual y autoriza o bloquea la
   operación dependiente: el Check-In exige `Available`, el Check-Out exige `Occupied`.
4. Si la consulta es de listado, el sistema filtra y retorna únicamente las habitaciones en estado
   `Available`, con sus atributos completos (`numberHabitation`, `categoryHabitation`, tarifa
   base).
5. Si el Módulo 1 no responde, agota el tiempo de espera, o el identificador consultado no existe,
   el sistema bloquea la operación dependiente y responde con un error de negocio controlado
   **HTTP 400 (Bad Request)**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validación Puntual del Estado de una Habitación (Priority: P1)

El Recepcionista, o el propio sistema durante un Check-In o un Check-Out, necesita confirmar el
estado físico exacto de una `Habitation` específica antes de continuar con la operación. El sistema
consulta el `habitationId` contra el Módulo 1 y, según el `stateHabitation` retornado, autoriza o
bloquea el siguiente paso. Por tratarse de una única consulta de lectura reutilizada por varios
flujos, el camino de éxito para Check-In, para Check-Out y los bloqueos por habitación no apta se
consolidan en esta misma historia de usuario y no se modelan como historias separadas.

**Why this priority**: Es la base de los flujos de Check-In y Check-Out. Ninguna admisión o salida
sobre una habitación física específica puede confirmarse sin esta validación puntual contra la
fuente de verdad del Módulo 1; omitirla expondría al hotel a sobreventas físicas o a admisiones
sobre habitaciones que aún no están listas. La etapa previa de reserva no depende de esta consulta:
resuelve la disponibilidad por categoría de forma local mediante aforo lógico.

**Independent Test**: Se puede probar enviando una consulta con un `habitationId` conocido en
estado `Available` y verificando que el sistema autorice el Check-In; se repite con una habitación
en `Occupied` verificando que autorice el Check-Out; y se repite con una habitación en
`PendingCleaning` o `InCleaning` verificando que el sistema bloquee el Check-In con una advertencia
clara.

**Acceptance Scenarios**:

1. **Scenario**: Validación exitosa de habitación Available para Check-In (Happy Path)
   - **Given** el `habitationId` de una habitación asignada a una reserva
   - **When** el sistema consulta puntualmente su estado en el Módulo 1 y este retorna `Available`
   - **Then** el sistema autoriza y permite proceder con el flujo de Check-In del huésped

2. **Scenario**: Validación exitosa de habitación Occupied para Check-Out (Happy Path)
   - **Given** el `habitationId` de la habitación actual de un huésped hospedado
   - **When** el sistema consulta puntualmente su estado en el Módulo 1 y este retorna `Occupied`
   - **Then** el sistema autoriza iniciar el proceso de Check-Out y de liquidación

3. **Scenario**: Bloqueo de Check-In sobre habitación no apta (Error)
   - **Given** el `habitationId` de una habitación que se intenta asignar
   - **When** el sistema consulta el estado y este retorna `PendingCleaning` o `InCleaning`
   - **Then** el sistema bloquea el registro del Check-In y devuelve una advertencia controlada
     **HTTP 400 (Bad Request)** indicando que la habitación no está lista para ser ocupada

---

### User Story 2 - Listado de Habitaciones Disponibles para Asignación (Priority: P2)

El Recepcionista necesita consultar el inventario general del Módulo 1 para obtener un listado
filtrado únicamente con las habitaciones en estado `Available`, con el fin de ofrecer alternativas
a un huésped que llega sin una `Habitation` predefinida.

**Why this priority**: Es un flujo complementario relevante para la asignación dinámica en el
mostrador; la consulta puntual por `habitationId` (P1) resuelve la mayoría de las reservas ya
estructuradas, pero este listado es indispensable cuando aún no existe una habitación asignada.

**Independent Test**: Se puede probar listando las opciones disponibles y comprobando que no
aparezca ninguna habitación con un `stateHabitation` distinto de `Available`.

**Acceptance Scenarios**:

1. **Scenario**: Listado de habitaciones aptas para asignación
   - **Given** que el Módulo 1 expone el inventario general de `Habitation`
   - **When** el Recepcionista solicita ver las opciones para asignar a un huésped sin habitación
   - **Then** el sistema filtra y muestra únicamente las habitaciones cuyo `stateHabitation` es
     `Available`, con sus atributos completos (`numberHabitation`, `categoryHabitation`, tarifa
     base)

2. **Scenario**: Ausencia total de disponibilidad
   - **Given** que el inventario del Módulo 1 reporta un 100% de ocupación o mantenimiento (ninguna
     `Available`)
   - **When** el Recepcionista intenta buscar alternativas para asignación
   - **Then** el sistema presenta un listado vacío con el mensaje "No hay habitaciones disponibles
     en este momento"

### Casos Borde

- ¿Qué sucede si el Módulo 1 no responde, agota el tiempo de espera o devuelve un error al
  consultar por el `habitationId`? El sistema intercepta la falla, evita que se propague como un
  error de servidor, y retorna un código **HTTP 400 (Bad Request)** con el mensaje "No se pudo
  validar el estado de la habitación en el inventario".
- ¿Qué sucede si se consulta un `habitationId` que no existe en el Módulo 1? El sistema detecta el
  resultado vacío y retorna **HTTP 400** indicando "El identificador de la habitación es inválido o
  no existe".
- ¿Qué sucede si el Recepcionista intenta forzar la asignación de una habitación que el Módulo 1
  reporta en `TechnicalBlock`? La validación estricta de negocio lo bloquea de inmediato, retornando
  **HTTP 400** con el mensaje "La habitación seleccionada se encuentra bloqueada técnicamente y no
  admite Check-In".
- ¿Se consulta el Módulo 1 durante la creación o la actualización de una reserva? No: en esa etapa
  la disponibilidad se resuelve mediante aforo lógico, por categoría (`categoryHabitation`) y de
  forma 100% local en la base de datos del Módulo 2, sin ninguna llamada síncrona a este servicio.
  Esta consulta puntual al Módulo 1 ocurre exclusivamente en el Check-In y el Check-Out, cuando ya
  existe una habitación física concreta que validar.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe consultar puntualmente el `stateHabitation` de una `Habitation` por
  su `habitationId` directamente en el Módulo 1.
- **FR-002**: El sistema debe autorizar el proceso de Check-In únicamente si el `stateHabitation`
  consultado es `Available`.
- **FR-003**: El sistema debe autorizar el proceso de Check-Out únicamente si el `stateHabitation`
  consultado es `Occupied`.
- **FR-004**: El sistema debe permitir consultar y filtrar el inventario general del Módulo 1 para
  obtener listados de `Habitation` exclusivamente en estado `Available`.
- **FR-005**: El sistema no debe modificar los datos de la `Habitation`; esta funcionalidad es
  estrictamente de solo lectura.
- **FR-006**: El sistema debe interceptar cualquier error de integración con el Módulo 1 o
  identificador inexistente y responder con **HTTP 400 (Bad Request)** controlado, prohibiendo que
  la falla escale a un error de infraestructura **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: La validación puntual por `habitationId` antes de un Check-In o Check-Out debe
  ejecutarse en menos de 1 segundo.

### Key Entities *(include if feature involves data)*

- **Habitation**: Unidad física provista por el Módulo 1. Atributos: `habitationId`,
  `numberHabitation`, `categoryHabitation`, tarifa base, y `stateHabitation` con los siete estados
  oficiales del glosario: `Available`, `Occupied`, `PendingCleaning`, `InCleaning`,
  `DisabledForRepairs`, `TechnicalBlock`, `Inactive`. Su gestión de estado es propiedad exclusiva
  del Módulo 1; esta funcionalidad solo la consulta.
- **Reservation**: Se referencia únicamente de forma informativa, como contexto de la consulta.
  Atributos: `reservationRef` y `state` con estados permitidos: `ACTIVE`, `CHECKED_IN`,
  `CHECKED_OUT`, `CANCELLED`. El estado `PENDING` queda inhabilitado en los flujos estándar: toda
  reserva nace directamente en `ACTIVE`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La validación puntual por `habitationId` de una habitación antes de un Check-In o
  Check-Out se ejecuta en menos de 1 segundo.
- **SC-002**: El 100% de los Check-In se realizan sobre habitaciones validadas como `Available`, y
  el 100% de los Check-Out sobre habitaciones validadas como `Occupied`.
- **SC-003**: Cero errores de tipo **HTTP 500** se registran por fallos de consulta al inventario
  por `habitationId`; el 100% se resuelve con respuestas controladas **HTTP 400**.
