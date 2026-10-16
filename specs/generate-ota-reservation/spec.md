# Feature Specification: Generar Reservación por OTA

**Created**: 2026-09-23
**Updated**: 2026-10-16

## Use Case (Caso de Uso)

### Descripción del problema

Una parte importante de las ventas del hotel llega por agencias de viajes en línea (OTA). En este
proyecto la única agencia es **Booking.com**, conectada a través de **Channex** (entorno de pruebas
`staging.channex.io`). Booking no opera sobre una pantalla del hotel: las reservas llegan de sistema a
sistema, en cualquier momento del día, y pueden cambiar o cancelarse después. Si el Módulo 2 no las
lee y las registra de forma confiable, el personal termina copiándolas a mano desde el portal de la
agencia, con retraso y con errores. Eso produce dos riesgos graves: la **sobreventa**, porque mientras
la reserva de Booking no se registra su habitación sigue figurando como libre, y el **descuadre
financiero** con la agencia, porque la comisión pactada se calcula sobre el valor de cada reserva.

El negocio necesita un proceso automático que lea las reservas de Booking desde Channex, las registre
con su comisión, aplique sus cambios y cancelaciones, y deje cada reserva lista para la lista de
reservas del día del Módulo 1. La configuración de la agencia, la relación de tipos de habitación y el
envío de disponibilidad y tarifas a Channex son de "Configurar OTA". El Módulo 2 no aparta ni libera
habitaciones: el Módulo 1 decide qué hace con la lista del día.

### Flujo de Usuario de Alto Nivel

1. Cada 60 segundos, el sistema consulta a Channex las **revisiones de reserva** pendientes de la
   propiedad (el *feed*), de la más antigua a la más reciente. Cada revisión es una reserva nueva
   (`new`), un cambio (`modified`) o una cancelación (`cancelled`).
2. El sistema procesa cada revisión **una sola vez**: si ya procesó esa revisión, solo la confirma.
3. **Reserva nueva (`new`)**: el sistema relaciona cada habitación con su categoría (según
   "Configurar OTA"), asigna una `Room` disponible de esa categoría mediante "Verificar
   disponibilidades" (la de menor `roomNumber`), y registra la `Reservation` directamente en
   **`ACTIVE`** (Booking ya la confirmó), con `source` `OTA`, el código de Booking como
   `externalConfirmationCode` y el valor bruto y la moneda que envía Booking. Ejecuta "Registrar
   confirmación y comisión de ota" para calcular la comisión con el porcentaje de la agencia.
4. **Cambio (`modified`)**: el sistema aplica el cambio a la reserva mediante "Actualizar
   reservación" (fechas, habitaciones, personas, valor, observaciones y datos del titular).
5. **Cancelación (`cancelled`)**: el sistema cancela la reserva mediante "Cancelar reservación", por
   el canal `OTA_API`.
6. Booking ya aceptó la reserva o el cambio, así que el sistema **no los rechaza**: si no hay
   habitación disponible, si se supera la capacidad o si el cambio no se puede aplicar, registra la
   reserva y la marca **en conflicto** con su motivo, para que la Recepcionista lo resuelva. Si no hay
   ninguna habitación libre de la categoría, la habitación queda **sin asignar**.
7. Después de guardar, el sistema **confirma la revisión a Channex** (`ack`). Si el guardado falla por
   un problema temporal, no la confirma y la vuelve a procesar en la siguiente consulta.
8. Si la reserva llega hoy, la lista del día ya se envió y **ninguna habitación quedó sin asignar**, el
   sistema avisa al Módulo 1 mediante
   "Enviar reservas del día al Módulo 1" (`ADDED`, `UPDATED` o `REMOVED`). Una reserva con alguna
   habitación sin asignar **no se envía** al Módulo 1 hasta que se asigne. Cada cambio se anota para el
   envío de disponibilidad a Channex ("Configurar OTA").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recepción de Reservas Nuevas de Booking (Priority: P1)

El sistema lee del feed de Channex las reservas nuevas de Booking, les asigna habitación, las registra
en `ACTIVE` con su comisión y confirma cada revisión a Channex. Las reservas que no se pueden ubicar
se registran igual, marcadas en conflicto.

**Why this priority**: Permite captar automáticamente las ventas de Booking, sin transcripción manual y
sin ventana de doble venta, con la comisión asentada en el mismo acto.

**Independent Test**: Se crea una reserva de prueba en el hotel de Booking conectado a Channex staging
y se verifica que, en menos de dos minutos, exista una `Reservation` en `ACTIVE` con el código de
Booking, el valor bruto, la moneda, la comisión calculada y la habitación asignada, y que la revisión
ya no aparezca en el feed.

**Acceptance Scenarios**:

1. **Scenario**: Registro de una reserva nueva (Happy Path)
   - **Given** una revisión `new` de Booking por una habitación de un tipo relacionado con la
     categoría `DOBLE`, con la `Room` 201 libre en esas fechas
   - **When** el sistema lee el feed
   - **Then** registra la `Reservation` en `ACTIVE` con `source` `OTA`, el `externalConfirmationCode`
     igual al código de Booking, el valor bruto y la moneda de Booking, la `Room` 201 en `EXPECTED` y
     la comisión `totalAmount × commissionPercentage / 100`; luego confirma la revisión a Channex

2. **Scenario**: Revisión repetida
   - **Given** una revisión ya procesada
   - **When** Channex la vuelve a entregar
   - **Then** el sistema no crea otra reserva y solo la confirma

3. **Scenario**: Varias habitaciones de la misma categoría
   - **Given** una revisión `new` con dos habitaciones del tipo relacionado con `DOBLE` y las `Room`
     201, 202 y 203 libres
   - **When** el sistema la procesa
   - **Then** asigna la 201 y la 202 y registra una sola `Reservation` con dos `ReservationRoom`

4. **Scenario**: Sin habitación disponible (conflicto)
   - **Given** una revisión `new` para la categoría `SUITE`, cuya única habitación ya está ocupada en
     esas fechas
   - **When** el sistema la procesa
   - **Then** registra la `Reservation` en `ACTIVE` con la habitación **sin asignar**, la marca en
     conflicto con el motivo `NO_ROOM_AVAILABLE` y confirma la revisión

5. **Scenario**: Capacidad superada (conflicto)
   - **Given** una revisión `new` con 3 personas para una categoría de capacidad máxima 2
   - **When** el sistema la procesa
   - **Then** registra la reserva, la marca en conflicto con el motivo `CAPACITY_EXCEEDED` y confirma
     la revisión

6. **Scenario**: Tipo de habitación sin relación
   - **Given** una revisión con un tipo de habitación de Channex que no está relacionado con ninguna
     categoría
   - **When** el sistema la procesa
   - **Then** no registra la reserva, lo deja en el log y **no** confirma la revisión, para volver a
     procesarla cuando se complete la relación en "Configurar OTA"

7. **Scenario**: Channex no responde (Error)
   - **Given** la consulta del feed
   - **When** Channex no responde o responde que se superó su límite de solicitudes
   - **Then** el sistema no registra nada en esa consulta y lo intenta de nuevo en la siguiente, con
     espera creciente si el problema sigue

---

### User Story 2 - Cambios y Cancelaciones de Booking (Priority: P1)

El sistema aplica a la reserva los cambios y las cancelaciones que Booking envía por el feed. Lo que
no se puede aplicar queda marcado en conflicto.

**Why this priority**: Booking es la fuente de verdad de sus reservas. Si un cambio o una cancelación
no llega, el hotel espera a un huésped que no vendrá, o le asigna una estadía distinta a la que pagó.

**Independent Test**: Se modifica en Booking la fecha de salida de una reserva de prueba y se verifica
que la `Reservation` cambie su `endDate`, su valor bruto y su comisión. Se cancela y se verifica que
pase a `CANCELLED` con una `Cancellation` del canal `OTA_API`.

**Acceptance Scenarios**:

1. **Scenario**: Cambio de fechas (Happy Path)
   - **Given** una `Reservation` OTA en `ACTIVE` del 10 al 12, con la `Room` 201 libre hasta el 13
   - **When** llega una revisión `modified` con salida el 13 y un valor bruto nuevo
   - **Then** el sistema cambia la `endDate`, el valor bruto y la comisión (con el porcentaje
     congelado de la reserva) mediante "Actualizar reservación", y confirma la revisión

2. **Scenario**: Cambio sin disponibilidad (conflicto)
   - **Given** una `Reservation` OTA en `ACTIVE` cuya habitación está ocupada en las fechas nuevas y
     sin otra habitación libre de su categoría
   - **When** llega la revisión `modified`
   - **Then** el sistema aplica las fechas nuevas con la habitación sin asignar, marca la reserva en
     conflicto con `NO_ROOM_AVAILABLE` y confirma la revisión

3. **Scenario**: Cancelación (Happy Path)
   - **Given** una `Reservation` OTA en `ACTIVE`
   - **When** llega una revisión `cancelled`
   - **Then** el sistema la cancela mediante "Cancelar reservación" (canal `OTA_API`), sin tocar la
     comisión, y confirma la revisión

4. **Scenario**: Cambio o cancelación que no se puede aplicar (conflicto)
   - **Given** una `Reservation` OTA en `IN_PROGRESS`, `COMPLETED` o `NO_SHOW`
   - **When** llega una revisión `modified` o `cancelled`
   - **Then** el sistema no cambia la reserva, la marca en conflicto con el motivo
     `CHANGE_NOT_APPLICABLE` y confirma la revisión

5. **Scenario**: Cancelación de una reserva ya cancelada
   - **Given** una `Reservation` OTA en `CANCELLED`
   - **When** llega otra revisión `cancelled`
   - **Then** el sistema no hace nada más y confirma la revisión

### Casos Borde

- ¿Qué datos del titular llegan? Nombre, apellido, correo, teléfono y país. Booking **no envía el
  documento**: el tipo y el número quedan vacíos hasta el Check-In, donde el Módulo 1 registra los
  documentos de todos los huéspedes.
- ¿Cómo se guarda el país? Channex lo envía como código de dos letras (`CO`, `US`); el sistema lo
  convierte al nombre del país (`Colombia`, `Estados Unidos`) con una tabla fija y lo guarda como
  nacionalidad **informativa** del titular. Si el código no está en la tabla, la nacionalidad queda
  vacía. La nacionalidad que decide el reporte SIRE es la de cada huésped en el Check-In.
- ¿Cuántas personas tiene cada habitación? La suma de adultos y niños de esa habitación; los bebés no
  se cuentan.
- ¿Qué pasa si las observaciones superan los 500 caracteres o traen caracteres no válidos? Se sanean y
  se recortan a 500 caracteres; la reserva no se rechaza.
- ¿Qué pasa si llega un cambio de una reserva que el sistema no tiene (por ejemplo, creada antes de
  conectar Channex)? Se registra como una reserva nueva. Si es una cancelación, solo se confirma y se
  deja en el log.
- ¿Qué pasa si dos revisiones de la misma reserva llegan juntas? Se procesan en orden, de la más
  antigua a la más reciente.
- ¿Qué pasa si el guardado de una revisión falla? No se confirma a Channex y se procesa en la siguiente
  consulta. Las demás revisiones de esa consulta se procesan igual.
- ¿Qué pasa con una reserva de Booking que la agencia nunca confirma? No existe ese caso: Booking envía
  las reservas ya confirmadas. El estado `PENDING` se conserva sin uso, por si en el futuro se agrega
  una agencia que lo necesite.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe consultar cada 60 segundos el feed de revisiones de reserva de Channex
  para la propiedad configurada y procesarlas de la más antigua a la más reciente.
- **FR-002**: El sistema debe procesar cada revisión una sola vez (por su identificador) y confirmarla
  a Channex después de guardar el resultado. Si el guardado falla por un problema temporal, o si el
  tipo de habitación no tiene relación, no debe confirmarla.
- **FR-003**: Ante una revisión `new`, el sistema debe registrar la `Reservation` en `ACTIVE` con
  `source` `OTA`, la agencia Booking.com, el código de Booking como `externalConfirmationCode`, el
  valor bruto (`totalAmount`) y la moneda (`currency`) de Booking sin recalcularlos, y una
  `ReservationRoom` en `EXPECTED` por cada habitación, con su categoría (según "Configurar OTA") y la
  `Room` asignada mediante "Verificar disponibilidades".
- **FR-004**: El sistema debe calcular la comisión con "Registrar confirmación y comisión de ota":
  `totalAmount × commissionPercentage / 100`, con el porcentaje de la agencia, que queda congelado en
  la reserva.
- **FR-005**: Ante una revisión `modified`, el sistema debe aplicar el cambio mediante "Actualizar
  reservación" y recalcular la comisión con el porcentaje congelado de la reserva.
- **FR-006**: Ante una revisión `cancelled`, el sistema debe cancelar la reserva mediante "Cancelar
  reservación", por el canal `OTA_API`, sin modificar la comisión.
- **FR-007**: El sistema no debe rechazar una reserva ni un cambio que Booking ya aceptó: si no hay
  habitación disponible, si se supera la capacidad o si el cambio no se puede aplicar por el estado de
  la reserva, debe registrar lo que corresponda y marcar la reserva en conflicto con el motivo
  (`NO_ROOM_AVAILABLE`, `CAPACITY_EXCEEDED` o `CHANGE_NOT_APPLICABLE`). Sin habitación libre de la
  categoría, la habitación queda sin asignar.
- **FR-008**: El sistema debe tomar del titular el nombre, el apellido, el correo y el teléfono, y
  convertir el código de país al nombre del país como nacionalidad informativa. El tipo y el número de
  documento quedan vacíos.
- **FR-009**: El sistema no debe ordenar al Módulo 1 que aparte o libere habitaciones. Debe avisar al
  Módulo 1, mediante "Enviar reservas del día al Módulo 1", cada reserva nueva, cambiada o cancelada
  con llegada hoy después de enviada la lista del día, y anotar cada cambio para el envío de
  disponibilidad de "Configurar OTA".
- **FR-010**: Una falla de Channex no debe dejar reservas a medias: cada revisión se guarda en una sola
  transacción, y las que fallan se procesan en la siguiente consulta, con espera creciente ante
  respuestas `429` o fallas repetidas.

### Non-Functional Requirements

- **NFR-001**: Una reserva creada en Booking debe quedar registrada en el Módulo 2 en menos de 2 minutos
  en condiciones normales.
- **NFR-002**: Los datos personales del titular no deben escribirse en los logs.

### Key Entities *(include if feature involves data)*

- **Reservation**: Reserva registrada desde Booking. Atributos: `reservationRef`, `guestRef`,
  `guestCount` (suma de los de sus habitaciones), `startDate`, `endDate`, `totalAmount` (valor bruto
  total enviado por Booking), `currency`, `commissionPercentage`, `commissionAmount`,
  `externalConfirmationCode` (código de Booking), `notes`, `source` (`OTA`), `createdAt`, `status` (en
  este flujo nace en `ACTIVE`), `conflictReason` (vacío si no hay conflicto) y `conflictDetectedAt`.
- **ReservationRoom**: Cada habitación de la reserva. Atributos: `reservationRef`, `roomId` (vacío si
  quedó sin asignar), `roomNumber`, `categoryRoom`, `guestCount` y `stayStatus` (nace en `EXPECTED`).
  En canal OTA no tiene valor por habitación: el valor es el `totalAmount` de la reserva.
- **Guest**: Titular de la reserva. Atributos: `firstName`, `lastName`, `contactEmail`,
  `contactPhone`, `nationality` (informativa) y `documentType` y `documentNumber` (vacíos en reservas
  de Booking).
- **Ota**: La agencia Booking.com, con su `commissionPercentage` (ver "Configurar OTA").
- **BookingRevision**: Revisión de reserva de Channex. Atributos usados: `id`, `status` (`new`,
  `modified`, `cancelled`), `ota_reservation_code`, `arrival_date`, `departure_date`, `amount`,
  `currency`, `customer` (`name`, `surname`, `mail`, `phone`, `country`), `rooms` (`room_type_id`,
  `occupancy`) y `notes`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las revisiones de Booking se procesan una sola vez y se confirman a Channex.
- **SC-002**: El 100% de las reservas de Booking quedan registradas con su `externalConfirmationCode` y
  su comisión exacta.
- **SC-003**: Cero reservas de Booking se pierden por falta de disponibilidad: todas quedan registradas,
  en conflicto si no se pudieron ubicar.
- **SC-004**: El 100% de las reservas de Booking con llegada hoy llegan al Módulo 1 en la lista del
  día, y ninguna con llegada futura se avisa antes de su día.
