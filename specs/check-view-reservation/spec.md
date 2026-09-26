# Feature Specification: Consultar Reservas

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Casi ninguna operación del Módulo 2 puede ejecutarse a ciegas: antes de cancelar, actualizar,
verificar disponibilidades o procesar un Check-In, un Check-Out o el envío al SIRE, el sistema
necesita ubicar la reserva exacta y conocer su estado vigente. Si cada funcionalidad implementara su
propia búsqueda, los criterios y las validaciones de acceso serían inconsistentes entre sí. El
negocio necesita un único servicio maestro de lectura, tratado como la fuente única de verdad sobre
el estado de una reserva, reutilizado internamente por el resto de funcionalidades del Módulo 2 y
expuesto también mediante API REST para que el Módulo 1 (Front Desk) pueda verificar los datos de la
reserva antes de iniciar un Check-In o un Check-Out.

Es importante precisar que, en la etapa de reserva, la entidad `Reservation` retornada contiene
únicamente la categoría solicitada (`categoryRoom`), ya que ningún `numberRoom` ni `roomId` físico
está asignado todavía: esa asignación ocurre de forma operativa recién en el Check-In, dentro del
Módulo 1. Por ser un servicio de solo lectura, esta funcionalidad es idempotente e inmutable: bajo
ninguna circunstancia altera datos en la base de datos de reservas del Módulo 2.

### Flujo de Usuario de Alto Nivel

1. El solicitante (la Recepcionista desde el Módulo 2 o el Módulo 1, el Huésped, o un sistema
   integrado) envía un criterio de búsqueda: el código de referencia de la reserva
   (`reservationRef`), el documento de identidad del titular (`documentNumber`) o su nombre completo
   (`fullName`).
2. El sistema valida el formato y la no vacuidad del criterio de entrada recibido.
3. El sistema consulta la base de datos local de reservas del Módulo 2, sin alterar ningún registro.
4. El sistema retorna la entidad `Reservation` consolidada con los datos del titular (`Guest`), la
   categoría reservada (`categoryRoom`), las fechas de hospedaje (`checkInDate` / `checkOutDate`),
   el estado actual (`Reservation.state`) y el costo bruto (`grossAmount`).

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Búsqueda y Lectura de Reservaciones (Priority: P1)

**Plain Language**: Servicio maestro de solo lectura que localiza una `Reservation` por
`reservationRef`, `documentNumber` o `fullName`, y devuelve su detalle consolidado tanto a los
flujos internos del Módulo 2 como al Módulo 1 (Front Desk) vía API REST, sin modificar ningún dato.

La Recepcionista, el Huésped o el Módulo 1 mediante su integración necesitan consultar el estado y
el detalle completo de una `Reservation` para verificar sus datos, confirmar su estado vigente o dar
paso a otra operación (actualización, cancelación, verificación de disponibilidad, Check-In,
Check-Out o envío al SIRE). Esta historia es el flujo maestro de lectura y se consolida con la
búsqueda por documento o nombre, la respuesta con múltiples coincidencias y los rechazos por reserva
inexistente o por entrada inválida, para evitar la sobre-atomización.

**Why this priority**: Es la funcionalidad de lectura indispensable para cualquier actualización,
cancelación, verificación de disponibilidad, Check-In o Check-Out. Ningún otro flujo del Módulo 2
puede operar de forma confiable sin antes ubicar la reserva exacta y su estado vigente.

**Independent Test**: Se consulta una reserva existente por `reservationRef`, por `documentNumber` y
por `fullName`, verificando que se retorne el detalle consolidado completo en cada caso; se realiza
una búsqueda por nombre con múltiples coincidencias, verificando que se retorne la lista
estructurada; y se realizan búsquedas con un código inexistente y con parámetros nulos o inválidos,
confirmando las respuestas controladas **HTTP 404** y **HTTP 400** respectivamente.

**Acceptance Scenarios**:

1. **Escenario 1**: Consulta exitosa por código de referencia único `reservationRef` (Happy Path)

   ```gherkin
   Given una Reservation válida registrada en la base de datos local del Módulo 2
   When el solicitante envía la reservationRef exacta
   Then el sistema retorna la Reservation consolidada con Guest, categoryRoom, checkInDate, checkOutDate, Reservation.state y grossAmount
   And no realiza ninguna modificación sobre los datos consultados
   ```

2. **Escenario 2**: Consulta exitosa por documento de identidad `documentNumber` del titular

   ```gherkin
   Given un Guest con una o más Reservation asociadas a su documentNumber
   When el solicitante envía el documentNumber del titular
   Then el sistema retorna la Reservation o las Reservation coincidentes con su detalle consolidado
   ```

3. **Escenario 3**: Consulta por nombre completo `fullName` con múltiples coincidencias

   ```gherkin
   Given varios Guest cuyo fullName coincide total o parcialmente con el criterio enviado
   When el solicitante envía el fullName como criterio de búsqueda
   Then el sistema retorna una lista estructurada con todas las Reservation coincidentes y su Reservation.state
   ```

4. **Escenario 4**: Búsqueda sin coincidencias en el sistema (Error)

   ```gherkin
   Given un criterio de búsqueda con formato válido que no coincide con ninguna Reservation registrada
   When el solicitante ejecuta la consulta
   Then el sistema responde con un error controlado HTTP 404 (Not Found) indicando que la reserva no existe
   ```

5. **Escenario 5**: Solicitud con parámetros nulos o caracteres inválidos (Error)

   ```gherkin
   Given una solicitud de consulta sin criterio de búsqueda o con caracteres inválidos
   When el solicitante ejecuta la consulta
   Then el sistema intercepta la entrada antes de tocar la base de datos
   And responde con un error controlado HTTP 400 (Bad Request)
   ```

## 3. Casos Borde

- **Caso Borde 1**: Búsqueda con cadenas vacías o compuestas únicamente por espacios en blanco. El
  sistema la intercepta en el controlador, antes de tocar la lógica de negocio, y responde con un
  error controlado **HTTP 400 (Bad Request)**.
- **Caso Borde 2**: Búsqueda de una reserva cuyo ciclo de vida esté finalizado (`CHECKED_OUT`,
  `CANCELLED` o `NO_SHOW`). El sistema retorna la información completa con su `Reservation.state`
  histórico correspondiente, sin bloquear ni restringir la lectura por tratarse de un estado
  finalizado.
- **Caso Borde 3**: Peticiones concurrentes masivas de consulta sobre el mismo registro. El sistema
  garantiza un manejo seguro de lecturas sin bloqueos de base de datos, bajo un nivel de aislamiento
  Read-Committed, de modo que múltiples lecturas simultáneas no generen contención ni errores.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe permitir la búsqueda de una `Reservation` mediante `reservationRef`,
  `documentNumber` o `fullName`.
- **FR-002**: El sistema debe validar la sintaxis y la no vacuidad de los filtros de entrada antes
  de ejecutar cualquier consulta contra la base de datos.
- **FR-003**: El sistema debe devolver la estructura consolidada de la `Reservation`, incluyendo
  `Guest`, `categoryRoom`, `checkInDate`, `checkOutDate`, `Reservation.state` y `grossAmount`.
- **FR-004**: El sistema debe garantizar que la operación sea exclusivamente de solo lectura,
  quedando prohibida cualquier alteración de datos en la base de datos del Módulo 2 durante su
  ejecución.
- **FR-005**: El sistema debe exponer un endpoint seguro mediante API REST (GET) para su consumo por
  parte del Módulo 1 (Front Desk), además de su uso interno por los flujos del Módulo 2.
- **FR-006**: El sistema debe capturar los fallos de validación o las búsquedas sin coincidencias, y
  responder respectivamente con **HTTP 400 (Bad Request)** o **HTTP 404 (Not Found)**, quedando
  estrictamente prohibida la propagación de excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de respuesta de la consulta debe ser inferior a 100 milisegundos.
- **NFR-002**: El servicio debe garantizar alta disponibilidad e idempotencia total, sin efectos
  colaterales entre ejecuciones sucesivas.

## 5. Entidades Clave

- **Reservation**: Entidad consultada, fuente única de verdad sobre el estado de una estadía.
  Atributos: `id`, `reservationRef`, `categoryRoom`, `checkInDate`, `checkOutDate`, `grossAmount`,
  `source` (`DIRECT` | `OTA`) y `state` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`,
  `CANCELLED`, `NO_SHOW`).
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `documentType`,
  `email`, `phone` y `nationality`.
- **Room**: Concepto de categoría de habitación (`categoryRoom`) referenciado por la reserva,
  administrado por el Módulo 1. Durante la etapa de reserva no existe ninguna asignación física de
  `numberRoom` ni `roomId`; dicha asignación ocurre únicamente en el Check-In.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las consultas retornan la información exacta de la reserva en menos de 100
  milisegundos.
- **SC-002**: Garantía de cero escrituras o modificaciones accidentales en la base de datos durante
  operaciones de consulta.
- **SC-003**: El 100% de las búsquedas inválidas o fallidas se responden con estructuras de error
  **HTTP 400** o **HTTP 404**, con cero excepciones **HTTP 500**.
