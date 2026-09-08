# Feature Specification: Generar Reservación por OTA

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Una parte importante de las ventas del hotel llega a través de agencias de viaje en línea (OTA)
como Booking o Expedia. Estas plataformas no operan sobre una pantalla del hotel: envían las
reservas de sistema a sistema, de forma asíncrona y en cualquier momento del día. Si el Módulo 2
no ofrece un punto de entrada confiable para recibirlas, el personal termina copiando reservas a
mano desde los portales de cada agencia, con retraso y con errores. Eso produce dos riesgos
graves. El primero es la sobreventa: mientras la reserva de la OTA no se registra, su cupo sigue
figurando como libre y puede venderse dos veces. El segundo es el descuadre financiero con el
canal: cada agencia cobra una comisión pactada sobre el valor del hospedaje, y si esa comisión no
se calcula y se asienta en el momento del registro, la conciliación posterior con la OTA se vuelve
imprecisa. El negocio necesita un endpoint de integración que reciba la reserva, descuente el cupo
de la categoría de forma local y confiable, y registre de inmediato la comisión del intermediario.

### Flujo de Integración de Alto Nivel

1. La **Ota** envía a la API del Módulo 2 una solicitud de reserva con su estructura JSON, que
   incluye las fechas de estadía, la categoría de `Habitation`, los datos del `Guest` titular, el
   valor bruto del hospedaje y el `externalConfirmationCode` de la agencia.
2. El sistema valida que la solicitud tenga la estructura JSON correcta y que estén presentes
   todos los campos obligatorios, incluido el `externalConfirmationCode`.
3. El sistema comprueba la disponibilidad de cupos para esa categoría y ese rango de fechas de
   forma **100% local** en la base de datos de reservas del Módulo 2, sin consultar al Módulo 1.
4. Si hay cupo, el sistema lo descuenta y ejecuta el caso de uso interno "Registrar confirmación y
   comisión de ota", que calcula el `commissionAmount` aplicando la fórmula del glosario:
   `totalAmount × commissionPercentage`, con el porcentaje configurado para esa agencia.
5. El sistema registra el valor bruto recibido tal cual, sin recalcular la tarifa: en este flujo
   no interviene el caso de uso "Calcular tarifa dinámica" del Módulo 3.
6. El sistema persiste la `Reservation` directamente en estado `ACTIVE`, ya que el acuerdo y la
   garantía de cobro fueron validados previamente por la plataforma de la OTA.
7. El sistema retorna una respuesta JSON de confirmación con el identificador interno generado.

La reserva no asigna un número físico de habitación: solo asegura y descuenta un cupo de la
categoría. La asignación de la `Habitation` real, con su `numberHabitation`, se posterga hasta el
momento del Check-In.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Procesamiento de Reservación por API Externa (Priority: P1)

Una **Ota** confirma una reserva en su plataforma y la transmite a la API del Módulo 2 mediante un
webhook. El sistema procesa esa solicitud de forma transaccional y asíncrona, sin ninguna
intervención humana ni pantalla: valida la estructura del payload y la presencia del
`externalConfirmationCode`, comprueba la disponibilidad de la categoría de `Habitation` de forma
local, descuenta el cupo, calcula y registra la comisión pactada con esa agencia, y persiste la
`Reservation` directamente en estado `ACTIVE` con el valor bruto enviado por la OTA. Por tratarse
de un único flujo de integración, tanto el camino de éxito como los rechazos controlados (sin
disponibilidad local, código de confirmación ausente, fechas o datos mal formados, concurrencia
por el último cupo) se consolidan en esta misma historia de usuario y no se modelan como flujos ni
historias separadas.

**Why this priority**: Es la funcionalidad que permite al hotel captar de forma automática las
ventas de los canales globales, sin transcripción manual y sin ventana de tiempo en la que el cupo
quede expuesto a doble venta. Además, al calcular y asentar la comisión en el mismo acto de
registro, deja la información financiera lista para la conciliación posterior con cada agencia.
Sin esta integración, el hotel no puede operar con OTAs de forma segura ni escalable.

**Independent Test**: Se puede probar de forma independiente enviando a la API un payload JSON de
reserva simulando a la OTA, con una categoría de `Habitation` que tiene cupos disponibles para el
rango de fechas. Se verifica que la `Reservation` se crea directamente en estado `ACTIVE`, que el
inventario local de la categoría queda descontado en un cupo, que se persiste el
`externalConfirmationCode` recibido, y que el `commissionAmount` almacenado es exactamente
`totalAmount × commissionPercentage` para esa agencia. La prueba se completa reenviando payloads
sin disponibilidad, sin `externalConfirmationCode` y con fechas incoherentes, confirmando que
ninguno crea una reserva y que todos devuelven una respuesta JSON de error estructurada, sin
interactuar con ninguna pantalla.

**Acceptance Scenarios**:

1. **Scenario**: Generación exitosa de reserva por OTA (Happy Path)
   - **Given** que existe disponibilidad de cupos para la categoría de `Habitation` seleccionada
     en las fechas solicitadas en la base de datos local del Módulo 2
   - **When** la **Ota** envía un payload JSON válido con todos los datos requeridos, incluyendo el
     `externalConfirmationCode` y el valor bruto de la estadía
   - **Then** el sistema descuenta un cupo de la categoría localmente, ejecuta el caso de uso
     "Registrar confirmación y comisión de ota" aplicando la fórmula del glosario para guardar el
     porcentaje y el importe de comisión, persiste la `Reservation` directamente en estado
     `ACTIVE` y retorna un código HTTP 201 (Created) con el ID interno generado

2. **Scenario**: Intento de reserva por OTA sin disponibilidad de cupos (Error)
   - **Given** que no existen cupos disponibles para la categoría seleccionada en las fechas
     enviadas en la base de datos local del Módulo 2
   - **When** la **Ota** envía la solicitud de reserva mediante el API
   - **Then** el sistema rechaza la transacción de forma controlada, no altera el inventario local
     y retorna un error JSON estructurado con código HTTP 409 (Conflict):
     `{"errorCode": "NO_AVAILABILITY", "message": "No hay disponibilidad local para la categoría seleccionada"}`

3. **Scenario**: Rechazo de reserva por ausencia de código de confirmación externo (Error)
   - **Given** que el canal de origen de la transacción es "OTA"
   - **When** la solicitud API no incluye el atributo obligatorio `externalConfirmationCode` o este
     se encuentra vacío
   - **Then** el sistema intercepta la validación localmente y rechaza el registro retornando un
     código de error de negocio controlado HTTP 400 (Bad Request) que detalla la obligatoriedad
     del campo

### Casos Borde

- ¿Qué sucede si un canal de OTA envía una solicitud de reserva con un formato de fecha inválido o
  lógicamente incoherente (por ejemplo, una fecha de salida anterior a la de llegada)? El sistema
  intercepta la validación en el controlador de la API del Módulo 2 y retorna una respuesta
  estructurada **HTTP 400**, sin descontar inventario ni permitir que la excepción escale a una
  falla de infraestructura **HTTP 500**.
- ¿Cómo maneja el sistema si se recibe una solicitud de reserva de la OTA con datos de huésped
  duplicados o con caracteres maliciosos en el texto libre? El sistema sanea y valida los datos
  del `Guest` antes de persistir: normaliza y deduplica al titular contra los registros
  existentes, rechaza cualquier contenido con patrones de inyección o caracteres no permitidos con
  una respuesta **HTTP 400** estructurada, y nunca almacena el valor crudo ni lo propaga a una
  falla interna.
- ¿Qué sucede si dos solicitudes API de diferentes OTAs intentan descontar simultáneamente el
  último cupo disponible de la misma categoría? El descuento del inventario se realiza dentro de
  una transacción con bloqueo a nivel de la base de datos de reservas del Módulo 2, de modo que
  solo una de las dos solicitudes obtiene el cupo y se registra en `ACTIVE`; la otra recibe una
  respuesta **HTTP 409 (Conflict)** con `errorCode` `NO_AVAILABILITY` y no produce sobreventa.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe proveer un endpoint de API REST seguro para la recepción de
  solicitudes de reservas de canales externos (`Ota`).
- **FR-002**: El sistema debe exigir como parámetro obligatorio en el canal OTA la presencia del
  atributo de texto `externalConfirmationCode`.
- **FR-003**: El sistema debe validar la disponibilidad de cupos para la categoría de `Habitation`
  seleccionada de forma interna en la base de datos local del Módulo 2.
- **FR-004**: Al persistir la reserva, el sistema debe registrar el canal de origen en el campo
  `source` como `OTA` y calcular la comisión pactada (`commissionAmount`) basándose en el
  porcentaje de comisión configurado para ese canal, aplicando estrictamente la fórmula:
  `totalAmount × commissionPercentage`.
- **FR-005**: El sistema debe registrar el valor bruto del hospedaje enviado por la OTA en
  `totalAmount` sin recalcularlo, sin invocar el caso de uso "Calcular tarifa dinámica" del
  Módulo 3.
- **FR-006**: El sistema debe guardar la reserva directamente en estado `ACTIVE` una vez validada
  la disponibilidad local y completados los datos obligatorios.
- **FR-007**: El sistema debe interceptar cualquier inconsistencia de datos o fallo de validación
  en la API para retornar respuestas de error JSON estructuradas con código **HTTP 400 (Bad
  Request)** o **HTTP 409 (Conflict)**, prohibiendo rigurosamente la generación de códigos **HTTP
  500 (Internal Server Error)**.

### Non-Functional Requirements

- **NFR-001**: El endpoint de la API de reservas por OTA debe procesar y responder a la solicitud
  transaccional en un tiempo inferior a 1.5 segundos en condiciones normales de carga.

### Key Entities *(include if feature involves data)*

- **Reservation**: Representa el contrato de reserva registrado desde el canal externo. Atributos:
  `id`, `guestRef`, `categoryHabitation` (categoría de habitación reservada), `startDate`,
  `endDate`, `totalAmount` (valor bruto enviado por la OTA), `commissionAmount` (comisión
  calculada localmente), `externalConfirmationCode` (código de confirmación de la agencia),
  `source` (`OTA` en este flujo), `createdAt`, y `state` con estados permitidos: `PENDING`,
  `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. En este flujo se persiste siempre en
  `ACTIVE`.
- **Guest**: Representa al huésped titular de la reserva. Atributos: `id`, `fullName`,
  `documentNumber`, `nationality`, `contactPhone` y `contactEmail`, extraídos del payload de la
  OTA.
- **Ota**: Representa al intermediario externo que origina la reserva. Atributos: `id`, `name`
  (nombre de la agencia) y `commissionPercentage` (porcentaje de comisión pactado, aplicado sobre
  `totalAmount` para obtener `commissionAmount`).
- **Habitation**: Representa la habitación física, cuya gestión de estado es propiedad del
  Módulo 1. En este flujo solo se referencia su categoría para descontar el cupo local; no se
  realiza ninguna llamada al Módulo 1 ni se asigna un número físico. Atributos: `habitationId`,
  `numberHabitation` y `stateHabitation` con estados físicos permitidos: `AVAILABLE`, `OCCUPIED`,
  `CLEANING`, `OUT_OF_SERVICE`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas registradas a través de la API externa cuentan con un
  `externalConfirmationCode` y con el porcentaje e importe de comisión calculados y almacenados de
  manera exacta en la base de datos local.
- **SC-002**: El 100% de los rechazos por falta de disponibilidad o por formato inválido devuelven
  payloads JSON estructurados con respuestas HTTP 400 o HTTP 409, con cero propagaciones de
  errores de infraestructura HTTP 500.
