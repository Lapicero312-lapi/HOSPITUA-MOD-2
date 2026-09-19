# Feature Specification: Actualizar Reservación

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Los planes de viaje de un huésped cambian con frecuencia: adelanta o pospone su llegada, extiende
la estadía, sube o baja la categoría de la habitación o corrige datos personales que registró con
un error. Si el hotel no puede reflejar esos cambios de forma flexible y ágil sobre una reserva
`PENDING` o `ACTIVE`, la fricción con el huésped crece, se pierden ventas por rigidez y el
personal termina llevando ajustes en anotaciones paralelas que nunca llegan al sistema. El
problema tiene dos caras. Por un lado, el control del inventario de cupos por categoría: debe
resolverse de forma inmediata y local, sin depender de sistemas externos, para que el solicitante
sepa al instante si el cambio es posible. Por otro lado, la consistencia financiera: cualquier
cambio de fechas o de categoría altera el Valor de hospedaje (bruto), y ese recálculo debe hacerlo
el área responsable de precios (Módulo 3), no el Módulo 2. El negocio necesita una única pantalla
de edición que valide la disponibilidad de cupos localmente, delegue el recálculo del monto bruto
cuando corresponda y solo persista los cambios tras la confirmación explícita del solicitante.

### Flujo de Usuario de Alto Nivel

1. El **Recepcionista**, el **Huésped** titular o la **OTA** localiza la reserva mediante el caso
   de uso interno "Consultar / ver reserva".
2. El sistema valida que la reserva esté en un estado modificable (`PENDING` o `ACTIVE`).
3. El solicitante edita los datos en el formulario unificado: fechas de estadía, datos personales
   del `Guest` o categoría de `Habitation`.
4. El sistema valida la disponibilidad de cupos para el rango de fechas y la categoría contra la
   tabla de reservas local del Módulo 2, sin consultar al Módulo 1.
5. Si el cambio altera las fechas o la categoría de habitación, el sistema envía los datos al
   Módulo 3 ("Procesar liquidación y validación") para recalcular la cotización y obtener un
   `RateQuote` con el nuevo Valor de hospedaje (bruto) y la diferencia resultante.
6. El solicitante revisa el resumen de la diferencia financiera y confirma la actualización; los
   datos se persisten de forma local en la base de datos de reservas del Módulo 2.

El Módulo 1 no participa en este flujo: solo conocerá el estado físico de la habitación en el
momento del Check-In y del Check-Out.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Modificación de Reservación (Priority: P1)

Un solicitante —el **Recepcionista** desde la consola interna, el **Huésped** titular desde el
portal de autogestión, o la **OTA** que originó la reserva mediante su API— necesita modificar una
reserva que aún no ha completado su ciclo (`PENDING` o `ACTIVE`). En una sola pantalla, y sobre el
mismo formulario unificado, puede cambiar las fechas de estadía, cambiar la categoría de
`Habitation` o corregir los datos personales del `Guest` titular y sus acompañantes. Cuando el
cambio afecta fechas o categoría, el sistema valida la disponibilidad de cupos de forma local
contra el inventario del Módulo 2 y delega el recálculo del Valor de hospedaje (bruto) en el
Módulo 3, mostrando la diferencia financiera antes de confirmar. Cuando el cambio solo toca datos
personales, se guarda directamente sin recálculo. Por tratarse de una única vista, tanto el camino
feliz como los bloqueos lógicos (reserva con ciclo de vida finalizado, falta de disponibilidad
local de cupos, edición concurrente, referencia de reserva vacía, o un Huésped intentando editar
una reserva ya hospedada) se consolidan en esta misma historia de usuario y no se modelan como
pantallas ni historias separadas, para evitar la sobre-atomización.

**Why this priority**: Es el flujo principal y único de la funcionalidad. Da al hotel la
flexibilidad de acomodar los cambios del cliente sin fricción y sin gestiones por fuera del
sistema, y a la vez garantiza la consistencia de los datos antes de la llegada del huésped: la
disponibilidad de cupos se resuelve de forma local e inmediata, y toda variación del monto bruto
queda congelada por el recálculo del Módulo 3. Sin esta historia, cualquier ajuste de reserva se
haría de forma manual, con riesgo de sobreventa en el inventario local de categorías y de
descuadres entre lo informado y el valor real de la estadía.

**Independent Test**: Se puede probar de forma aislada tomando una reserva en estado `ACTIVE`,
modificando sus fechas o su categoría de `Habitation` y validando que el sistema resuelve la
disponibilidad de cupos contra la tabla local del Módulo 2. Se simula la respuesta del Módulo 3
("Procesar liquidación y validación") con un Valor de hospedaje (bruto) recalculado, se verifica
que el sistema muestra el resumen con la diferencia a pagar o reembolsar, y que solo tras la
confirmación explícita del solicitante los cambios se guardan en la base de datos local, sin que
se realice ninguna llamada síncrona al Módulo 1. La prueba se repite modificando únicamente datos
del `Guest`, confirmando que no se invoca al Módulo 3, y sobre reservas `CHECKED_OUT` y
`CANCELLED`, confirmando que la edición se bloquea con un error controlado.

**Acceptance Scenarios**:

1. **Scenario**: Actualización de fechas o categoría con recálculo exitoso (Happy Path -
   Financiero)
   - **Given** que existe disponibilidad de cupos para la categoría de `Habitation` seleccionada
     en las fechas solicitadas en la base de datos local del Módulo 2
   - **When** el solicitante modifica las fechas de estadía o la categoría, y el Módulo 3
     ("Procesar liquidación y validación") devuelve la cotización de tarifa dinámica recalculada
     exitosamente
   - **Then** el sistema presenta el resumen en pantalla con la diferencia a pagar o reembolsar;
     tras la confirmación explícita del solicitante, se actualizan los datos locales en la entidad
     `Reservation` manteniendo el estado `ACTIVE`

2. **Scenario**: Modificación exclusiva de datos de Guest sin afectación financiera
   - **Given** una reserva existente en estado `ACTIVE` o `PENDING`
   - **When** el solicitante modifica datos de contacto o de acompañantes en el registro del
     `Guest`
   - **Then** el sistema guarda localmente la información modificada en las entidades `Guest` sin
     ejecutar llamados al Módulo 3 ni alterar las fechas ni la categoría de la reserva

3. **Scenario**: Bloqueo de modificación para reservas con ciclo de vida finalizado (Error)
   - **Given** una reserva en estado `CHECKED_OUT` o `CANCELLED`
   - **When** se intenta iniciar un proceso de actualización sobre dicha reserva
   - **Then** el sistema bloquea inmediatamente la edición, retornando un error de negocio
     controlado HTTP 400 y deshabilitando el formulario

4. **Scenario**: Intento de cambio de fechas sin disponibilidad local de cupos (Error)
   - **Given** que los cupos de la categoría seleccionada se encuentran completamente agotados en
     las fechas deseadas en la base de datos local del Módulo 2
   - **When** el solicitante intenta modificar las fechas de la reserva hacia ese período
   - **Then** el sistema bloquea la acción de confirmación y arroja un error controlado HTTP 400 en
     pantalla indicando la falta de disponibilidad de cupos locales

5. **Scenario**: Intento de modificación por parte de un Huésped sobre una reserva ya hospedada
   (Error)
   - **Given** un Huésped autenticado con una reserva de la cual es titular, que ya se encuentra en
     estado `CHECKED_IN`
   - **When** el Huésped intenta modificar las fechas o la categoría desde su portal de
     autogestión
   - **Then** el sistema bloquea la operación localmente, le indica que debe solicitar el cambio
     directamente en la recepción del hotel y no altera la reserva

### Casos Borde

- ¿Qué sucede si el Módulo 3 (Pricing) no responde o devuelve un error durante el recálculo de la
  tarifa dinámica? El sistema aplica un fallback resiliente: la reserva actualiza sus fechas de
  forma local, pero su estado financiero queda marcado como `PENDING_RECALCULATION` para
  regularizarse de forma asíncrona en cuanto el Módulo 3 vuelva a estar disponible; el Módulo 2 no
  calcula ni asume ningún monto por su cuenta.
- ¿Cómo maneja el sistema si dos Recepcionistas intentan guardar cambios sobre la misma reserva de
  forma simultánea? El sistema usa control de concurrencia optimista mediante el atributo
  `version` de `Reservation`: al confirmar, compara la versión cargada con la versión vigente y,
  si no coinciden, rechaza la escritura con un error de colisión controlado HTTP 400 e indica al
  solicitante que debe recargar la pantalla para trabajar sobre los datos más recientes.
- ¿Qué sucede si se intenta actualizar una reserva enviando una referencia de reserva vacía o
  nula? El sistema intercepta la validación en el controlador y responde de forma inmediata con un
  error **HTTP 400 (Bad Request)** amigable, sin permitir que la excepción escale a un error de
  infraestructura **HTTP 500**.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe exigir que se ubique y valide la existencia y el estado de la
  reserva mediante el caso de uso interno "Consultar / ver reserva" de forma local en el Módulo 2
  antes de habilitar la pantalla de edición.
- **FR-002**: El sistema debe validar que el estado de la reserva sea únicamente `PENDING` o
  `ACTIVE` para autorizar cualquier flujo de actualización.
- **FR-003**: El sistema debe validar la disponibilidad del rango de fechas y de las categorías de
  `Habitation` de forma interna y local consultando la base de datos de reservas del Módulo 2, sin
  realizar consultas externas de disponibilidad al Módulo 1.
- **FR-004**: El sistema debe enviar los datos modificados al Módulo 3 ("Procesar liquidación y
  validación") para recalcular la tarifa dinámica (`RateQuote`) cuando la actualización altera
  fechas o categorías de la reserva.
- **FR-005**: Para los canales con interfaz interactiva (Recepcionista y Huésped), el sistema debe
  presentar en pantalla el resumen de cobros con la tarifa anterior, la nueva y la diferencia,
  exigiendo la confirmación manual del Recepcionista o del Huésped antes de persistir los cambios;
  en el canal OTA, la confirmación viene implícita en la solicitud recibida por la API.
- **FR-006**: El sistema debe permitir modificar los datos personales del `Guest` titular y de sus
  acompañantes de forma directa, sin exigir disponibilidad de cupos ni invocar la recotización del
  Módulo 3.
- **FR-007**: El sistema debe implementar control de versiones (concurrencia optimista) para
  evitar inconsistencias si dos usuarios editan simultáneamente el mismo registro de reserva.
- **FR-008**: El sistema debe interceptar cualquier inconsistencia de fechas o problema de
  integración para responder con errores de negocio controlados **HTTP 400 (Bad Request)**,
  prohibiendo explícitamente la propagación de fallas técnicas que deriven en errores de
  infraestructura **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El tiempo de respuesta de la recotización integrada con el Módulo 3 debe ser
  inferior a 3 segundos bajo condiciones normales de red.
- **NFR-002**: El cálculo de disponibilidad local de cupos en la base de datos del Módulo 2 debe
  responder en un tiempo inferior a 200 milisegundos.

### Key Entities *(include if feature involves data)*

- **Reservation**: Representa el estado y la asignación de la estadía en el Módulo 2. Atributos:
  `id`, `guestRef`, `categoryHabitation` (categoría de habitación seleccionada), `checkInDate`,
  `checkOutDate`, `grossAmount` (Valor de hospedaje bruto informativo calculado por el Módulo 3),
  `version` (control de concurrencia optimista), `source` (`DIRECT` | `OTA`), `createdAt`, y
  `state` con estados permitidos: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.
  Solo admite edición en estados `PENDING` o `ACTIVE`.
- **Guest**: Representa al cliente titular de la reserva y a sus acompañantes. Atributos: `id`,
  `fullName`, `documentNumber`, `nationality`, `contactPhone` y `contactEmail`. Sus datos pueden
  actualizarse de forma independiente a las fechas, la categoría o la tarifa de la `Reservation`.
- **Habitation**: Representa la habitación física mapeada en el Módulo 1. En este flujo solo se
  referencia su categoría para la validación local de disponibilidad de cupos; no se realiza
  ninguna llamada al Módulo 1. Atributos: `habitationId`, `numberHabitation` y `stateHabitation`
  con los siete estados oficiales del glosario: `Available`, `Occupied`, `PendingCleaning`,
  `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`.
- **RateQuote**: Representa el recálculo de cotización ejecutado por el Módulo 3 mediante "Procesar
  liquidación y validación" cuando el cambio afecta fechas o categoría. Atributos: `reservationRef`,
  `previousGrossAmount` (Valor de hospedaje bruto vigente antes del cambio), `grossAmount` (Valor
  de hospedaje bruto recalculado), `amountDifference` (diferencia a pagar o a reembolsar) y
  `calculatedAt` (momento del cálculo). Es obligatoria antes de confirmar cualquier actualización
  que altere fechas o categoría.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El solicitante puede completar la actualización de fechas y tarifas de una reserva
  en menos de 1 minuto una vez recibida la cotización del Módulo 3.
- **SC-002**: El 100% de los intentos de modificación sobre estados finalizados se bloquean de
  manera local y controlada respondiendo con errores HTTP 400 estructurados, con cero errores de
  infraestructura HTTP 500 en producción.
- **SC-003**: Cero llamadas síncronas de disponibilidad se realizan hacia el Módulo 1 durante la
  actualización; toda la disponibilidad se calcula de manera local y segura en la base de datos
  del Módulo 2.
