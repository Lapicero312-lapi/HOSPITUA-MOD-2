# Feature Specification: Configurar OTA

**Created**: 2026-10-16
**Updated**: 2026-10-17

## Use Case (Caso de Uso)

### Descripción del problema

El hotel vende sus habitaciones también por agencias de viajes en línea (OTA). En este proyecto la
única agencia es **Booking.com**, conectada a través de **Channex**, un intermediario que se usa en su
entorno de pruebas (`staging.channex.io`) con un hotel de prueba de Booking. Para que Booking muestre
el hotel y le envíe reservas, Channex necesita los **tipos de habitación** del hotel, **cuántas
habitaciones hay libres** de cada tipo por fecha y **a qué precio**. Y para que el Módulo 2 entienda
las reservas que llegan, tiene que saber a qué categoría propia corresponde cada tipo de habitación de
Channex.

Las habitaciones vendibles son del Módulo 1, y los precios, del Módulo 3. El Módulo 2 traduce las
habitaciones vendibles del Módulo 1 a **tipos de habitación de Channex** y mantiene su
**disponibilidad**. Los **planes de tarifa y los precios** los crea y los envía a Channex directamente
el **Módulo 3**.

Si esa configuración no existe, o la disponibilidad que ve Booking no coincide con la del hotel,
Booking vende habitaciones que ya están ocupadas (sobreventa) o deja de vender las que están libres.

Este caso de uso **no recibe reservas** (eso es de "Generar reservación por OTA") y **no envía
precios** (eso es del Módulo 3).

### Flujo de Usuario de Alto Nivel

**Configuración inicial (una sola vez, a mano)**

1. En Channex staging se crea, a mano, **la propiedad**, que es **una sola y fija**: el software no crea
   propiedades. Se configura con la zona horaria `America/Bogota`, la moneda GBP y las
   actualizaciones automáticas de disponibilidad por **modificación y por cancelación apagadas**
   (`allow_availability_autoupdate_on_modification` y `allow_availability_autoupdate_on_cancellation`
   en `false`): la disponibilidad la recalcula y la envía el Módulo 2, para no descontarla dos veces.
   Channex descuenta solo una reserva nueva, y eso no se puede apagar.
2. En la configuración del sistema se indican la dirección de Channex, la clave de acceso
   (`user-api-key`), el identificador de la propiedad y el porcentaje de comisión de Booking.
3. Al iniciar, el sistema verifica que la propiedad exista en Channex y registra la agencia
   **Booking.com** (`Ota`) con su porcentaje de comisión, si aún no existe.

**Tipos de habitación (al iniciar y cada día)**

4. El sistema pide al Módulo 1 las habitaciones vendibles de todas las categorías ("Consultar
   inventario de habitaciones").
5. Por cada categoría con habitaciones vendibles, el sistema **crea en Channex un tipo de habitación**
   si no existe, con el nombre de la categoría, la cantidad de habitaciones vendibles y la capacidad
   máxima de la categoría, y guarda la relación entre el tipo de Channex y la categoría.
6. Si una categoría ya tiene su tipo en Channex y cambió su cantidad de habitaciones o su capacidad, el
   sistema **actualiza** el tipo. El sistema **no borra** tipos en Channex: si una categoría deja de
   tener habitaciones vendibles, lo registra para revisión.
7. Cuando ya existen los tipos de habitación, el **Módulo 3** crea en Channex un plan de tarifa por
   tipo y le envía los precios; después se conecta y se mapea el hotel de prueba de Booking (a mano,
   en Channex).

**Disponibilidad (cada vez que cambia y cada día)**

8. Cada vez que un cambio confirmado afecta la ocupación (una reserva creada, modificada o cancelada,
   un No-Show, un Check-Out o una habitación que no llegó), el sistema anota las categorías y las
   fechas afectadas.
9. Cada 30 segundos, el sistema agrupa lo anotado y calcula, por categoría y fecha, cuántas
   habitaciones quedan libres: las habitaciones vendibles de esa categoría (según el Módulo 1) menos
   las que ocupan las reservas del Módulo 2 en esa fecha. Envía esas cantidades a Channex para el tipo
   de habitación relacionado.
10. Cada día a las 03:00 (hora de Colombia), el sistema sincroniza los tipos de habitación (pasos 4 a 6)
    y reenvía la disponibilidad completa de los próximos 90 días, para corregir cualquier diferencia.

**Fallos**

11. Si Channex o el Módulo 1 no responden, o Channex responde que se superó su límite de solicitudes,
    el sistema reintenta más tarde sin perder lo pendiente. Un fallo **nunca** bloquea ni revierte una
    reserva.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configuración de Booking.com en Channex (Priority: P1)

El sistema queda configurado para trabajar con Booking.com a través de Channex: la propiedad
verificada y la agencia registrada con su porcentaje de comisión.

**Why this priority**: Sin la agencia, el Módulo 2 no puede calcular la comisión de las reservas de
Booking.

**Independent Test**: Se arranca el sistema con la configuración de Channex y se verifica que exista
una sola `Ota` "Booking.com" con el porcentaje configurado. Se arranca con una propiedad que no existe y
se verifica que no se envíe nada a Channex.

**Acceptance Scenarios**:

1. **Scenario**: Registro de la agencia al iniciar (Happy Path)
   - **Given** la configuración de Channex con un porcentaje de comisión de `15` y una propiedad que
     existe en Channex
   - **When** el sistema inicia y no existe la agencia Booking.com
   - **Then** el sistema registra la `Ota` "Booking.com" con `commissionPercentage` `15` y
     `connectionStatus` `CONNECTED`

2. **Scenario**: Reinicio sin duplicar la agencia
   - **Given** la `Ota` "Booking.com" ya registrada
   - **When** el sistema inicia de nuevo
   - **Then** no crea otra agencia; si el porcentaje configurado cambió, lo actualiza y el cambio
     solo aplica a las reservas futuras

3. **Scenario**: Configuración incompleta o propiedad inexistente (Error)
   - **Given** una configuración sin la clave de acceso o sin la propiedad, o con una propiedad que no
     existe en Channex
   - **When** el sistema inicia
   - **Then** el sistema registra el error en el log y no envía nada a Channex ni lee reservas, sin
     afectar el resto del Módulo 2

---

### User Story 2 - Tipos de Habitación desde las Habitaciones Vendibles (Priority: P1)

El sistema traduce las habitaciones vendibles que informa el Módulo 1 a tipos de habitación de
Channex: uno por categoría, con su cantidad de habitaciones y su capacidad, y los mantiene al día.

**Why this priority**: Sin tipos de habitación en Channex no se puede enviar disponibilidad, el Módulo
3 no puede crear sus planes de tarifa y Booking no puede vender.

**Independent Test**: Con un Módulo 1 simulado que informa 3 habitaciones `DOBLE` de capacidad 2 y 1
`SUITE` de capacidad 4, se arranca el sistema y se verifica que Channex reciba dos tipos de habitación
con esas cantidades y capacidades, y que el Módulo 2 guarde su relación con las categorías. Se agrega
una habitación `DOBLE` en el Módulo 1 y se verifica que la sincronización diaria actualice el tipo a 4.

**Acceptance Scenarios**:

1. **Scenario**: Creación de los tipos de habitación (Happy Path)
   - **Given** el Módulo 1 informa 3 habitaciones vendibles `DOBLE` de capacidad máxima 2
   - **When** el sistema sincroniza los tipos de habitación y la categoría no tiene tipo en Channex
   - **Then** crea en Channex el tipo "DOBLE" con 3 habitaciones y ocupación de 2 adultos, y guarda la
     relación entre ese tipo y la categoría `DOBLE`

2. **Scenario**: Cambio en la cantidad de habitaciones
   - **Given** la categoría `DOBLE` con su tipo en Channex de 3 habitaciones
   - **When** el Módulo 1 informa 4 habitaciones vendibles `DOBLE` y el sistema sincroniza
   - **Then** el sistema actualiza el tipo en Channex a 4 habitaciones

3. **Scenario**: Categoría sin habitaciones vendibles
   - **Given** una categoría con su tipo en Channex
   - **When** el Módulo 1 ya no informa habitaciones vendibles de esa categoría
   - **Then** el sistema no borra el tipo en Channex, envía disponibilidad `0` para esa categoría y lo
     registra para revisión

4. **Scenario**: El Módulo 1 o Channex no responden (Error)
   - **Given** la sincronización de los tipos de habitación
   - **When** el Módulo 1 o Channex no responden
   - **Then** el sistema no cambia nada en Channex, conserva los tipos que ya existen y lo reintenta en
     la siguiente sincronización

---

### User Story 3 - Envío de la Disponibilidad a Channex (Priority: P1)

Cada cambio confirmado que afecta la ocupación de una categoría actualiza en Channex la cantidad de
habitaciones libres de esa categoría en las fechas afectadas.

**Why this priority**: Es lo que evita que Booking venda una habitación que ya está ocupada por una
reserva directa, o que deje de vender una que se liberó.

**Independent Test**: Con una categoría de 3 habitaciones vendibles, se crea una reserva directa de una
habitación para dos noches y se verifica que Channex reciba disponibilidad `2` para esas dos fechas. Se
cancela la reserva y se verifica que reciba `3`.

**Acceptance Scenarios**:

1. **Scenario**: Una reserva nueva baja la disponibilidad (Happy Path)
   - **Given** una categoría con 3 habitaciones vendibles y ninguna reserva en las fechas pedidas
   - **When** se crea una reserva de una habitación de esa categoría del 10 al 12
   - **Then** el sistema envía a Channex disponibilidad `2` para el 10 y el 11 (la noche del 12 no
     se ocupa: es el día de salida)

2. **Scenario**: Una cancelación sube la disponibilidad
   - **Given** la reserva anterior
   - **When** se cancela
   - **Then** el sistema envía disponibilidad `3` para el 10 y el 11

3. **Scenario**: Varios cambios seguidos se agrupan
   - **Given** cinco reservas creadas en el mismo intervalo de 30 segundos para la misma categoría
   - **When** el sistema hace el envío
   - **Then** envía los valores finales agrupados, sin superar el límite de solicitudes de Channex

4. **Scenario**: Channex no responde o limita las solicitudes (Error)
   - **Given** un envío pendiente
   - **When** Channex no responde o responde que se superó el límite (`429`)
   - **Then** el sistema conserva el envío pendiente y lo reintenta más tarde; las reservas no se
     afectan

### Casos Borde

- ¿Quién crea los planes de tarifa y envía los precios? El **Módulo 3**, directamente a Channex, con su
  propia clave de acceso. El Módulo 2 no cotiza para Channex ni convierte monedas. El Módulo 3 encuentra
  los tipos de habitación en Channex por su nombre, que es el de la categoría.
- ¿Qué pasa con los mantenimientos? El Módulo 2 no se entera de cuándo el Módulo 1 registra un
  mantenimiento, así que la disponibilidad enviada **no los descuenta**. Es una limitación conocida: si
  Booking vende una habitación en mantenimiento, la reserva llega y se trata como un conflicto en
  "Generar reservación por OTA".
- ¿Qué capacidad se usa si las habitaciones de una categoría tienen capacidades distintas? La mayor de
  la categoría. Si una reserva de Booking supera la capacidad de la habitación asignada, se trata como
  un conflicto en "Generar reservación por OTA".
- ¿Qué pasa si la cantidad calculada es negativa (más reservas que habitaciones, por un conflicto)? Se
  envía `0`.
- ¿Qué pasa con fechas pasadas? No se envían: Channex no las acepta.
- ¿Qué pasa si se agrega una agencia nueva en el futuro (por ejemplo, Airbnb)? Los tipos de habitación y
  la disponibilidad son de la propiedad, no de la agencia, así que no cambian.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe tomar de la configuración (variables de entorno) la dirección de
  Channex, la clave de acceso, el identificador de la propiedad y el porcentaje de comisión de Booking.
  La clave de acceso nunca se guarda en la base de datos ni se escribe en los logs. Al iniciar debe
  verificar en Channex que la propiedad configurada existe; si no existe, no envía nada a Channex ni lee
  reservas, sin afectar el resto del Módulo 2.
- **FR-002**: El sistema debe registrar al iniciar la `Ota` "Booking.com" con el porcentaje
  configurado, sin duplicarla, y actualizar el porcentaje si cambió, solo para las reservas futuras.
- **FR-003**: El sistema debe crear en Channex un tipo de habitación por cada categoría con habitaciones
  vendibles según el Módulo 1, con el nombre de la categoría, la cantidad de habitaciones vendibles y la
  capacidad máxima de la categoría, y guardar la relación entre el tipo de Channex (`room_type_id`) y la
  categoría (`categoryRoom`).
- **FR-004**: El sistema debe sincronizar los tipos de habitación al iniciar y todos los días a las 03:00
  (hora de Colombia): crear los que falten y actualizar la cantidad de habitaciones o la capacidad que
  hayan cambiado. No debe borrar tipos en Channex.
- **FR-005**: Después de cada cambio confirmado que afecte la ocupación, el sistema debe anotar las
  categorías y las fechas afectadas, sin esperar a Channex ni depender de él para confirmar el cambio.
- **FR-006**: El sistema debe calcular la disponibilidad de cada categoría y fecha como las
  habitaciones vendibles de esa categoría (Módulo 1) menos las habitaciones de esa categoría que ocupan
  las reservas del Módulo 2 en esa fecha (las mismas que bloquean en "Verificar disponibilidades"). Si el
  resultado es negativo, envía `0`.
- **FR-007**: El sistema debe agrupar los envíos de disponibilidad cada 30 segundos, sin superar el
  límite de Channex (10 solicitudes por minuto por propiedad), y reintentar con espera creciente ante un
  `429` o una falla. Todos los días a las 03:00 debe reenviar la disponibilidad completa de los próximos
  90 días.
- **FR-008**: El sistema no debe enviar fechas pasadas ni categorías sin tipo de habitación en Channex.
  No debe enviar precios ni crear planes de tarifa: eso es del Módulo 3.
- **FR-009**: Un fallo de Channex o del Módulo 1 en estos procesos no debe bloquear ni revertir ninguna
  reserva: lo pendiente se conserva y se reintenta.

### Non-Functional Requirements

- **NFR-001**: Un cambio de disponibilidad debe llegar a Channex en menos de 1 minuto en condiciones
  normales.
- **NFR-002**: La clave de acceso a Channex no debe aparecer en logs, respuestas ni en la base de
  datos.

### Key Entities *(include if feature involves data)*

- **Ota**: La agencia Booking.com. Atributos: `id`, `name`, `hotelAccountId` (el id del hotel de prueba
  de Booking), `commissionPercentage`, `connectionStatus` y `linkedAt`.
- **OtaRoomTypeMapping**: Relación entre un tipo de habitación de Channex y una categoría del Módulo 2.
  Atributos: `channexRoomTypeId`, `categoryRoom`, `countOfRooms` y `occupancy` (los últimos valores
  enviados a Channex, para saber si hay que actualizarlos).
- **AriPendingChange**: Categoría y rango de fechas cuya disponibilidad hay que enviar a Channex.
  Atributos: `categoryRoom`, `dateFrom`, `dateTo` y `createdAt`.
- **Room**: Habitación vendible del Módulo 1. Se usa para contar las habitaciones de cada categoría y
  su capacidad máxima.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las categorías con habitaciones vendibles tienen su tipo de habitación en
  Channex, con la cantidad y la capacidad del Módulo 1.
- **SC-002**: El 100% de los cambios confirmados que afectan la ocupación se reflejan en Channex.
- **SC-003**: Cero reservas del Módulo 2 se bloquean o revierten por una falla de Channex.
