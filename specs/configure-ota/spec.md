# Feature Specification: Configurar OTA

**Created**: 2026-10-16

## Use Case (Caso de Uso)

### Descripción del problema

El hotel vende sus habitaciones también por agencias de viajes en línea (OTA). En este proyecto la
única agencia es **Booking.com**, conectada a través de **Channex**, un intermediario que se usa en su
entorno de pruebas (`staging.channex.io`) con un hotel de prueba de Booking. Para que Booking muestre
el hotel y le envíe reservas, Channex necesita saber, por cada tipo de habitación y cada fecha,
**cuántas habitaciones hay libres** y **a qué precio**. Y para que el Módulo 2 entienda las reservas
que llegan, tiene que saber a qué categoría propia corresponde cada tipo de habitación de Channex.

Si esa configuración no existe, o la disponibilidad y las tarifas que ve Booking no coinciden con las
del hotel, Booking vende habitaciones que ya están ocupadas (sobreventa) o deja de vender las que
están libres. El negocio necesita una configuración única de la agencia y un envío automático de la
disponibilidad y las tarifas del Módulo 2 hacia Channex.

Este caso de uso **no recibe reservas**: la lectura de las reservas de Booking es de "Generar
reservación por OTA".

### Flujo de Usuario de Alto Nivel

**Configuración (una sola vez)**

1. En Channex staging se crean, a mano, la propiedad, sus tipos de habitación y sus planes de tarifa
   (en la moneda del hotel de prueba, GBP), y se conecta y activa el hotel de prueba de Booking. La
   propiedad es **una sola y fija**: el software no crea propiedades. Al crearla se configura con la zona
   horaria `America/Bogota`, la moneda GBP y las actualizaciones automáticas de disponibilidad por
   **modificación y por cancelación apagadas** (`allow_availability_autoupdate_on_modification` y
   `allow_availability_autoupdate_on_cancellation` en `false`): la disponibilidad la recalcula y la envía
   el Módulo 2, para no descontarla dos veces. Channex descuenta solo una reserva nueva, y eso no se
   puede apagar.
2. En la configuración del sistema se indican los datos de la conexión: la dirección de Channex, la
   clave de acceso (`user-api-key`), el identificador de la propiedad en Channex, el porcentaje de
   comisión de Booking y la tasa de conversión (`4000` COP por 1 GBP).
3. Al iniciar, el sistema registra la agencia **Booking.com** (`Ota`) con su porcentaje de comisión,
   si aún no existe.
4. El sistema guarda la **relación entre cada tipo de habitación de Channex y una categoría del
   Módulo 2** (`categoryRoom`), con el plan de tarifa de Channex que se usa para publicar su precio. La
   relación se carga como registro inicial al instalar el sistema, porque son pocos tipos y no cambian;
   si cambian en Channex, se actualiza ese registro.

**Envío de disponibilidad (cada vez que cambia)**

5. Cada vez que un cambio confirmado afecta la ocupación (una reserva creada, modificada o cancelada,
   un No-Show, un Check-Out o una habitación que no llegó), el sistema anota las categorías y las
   fechas afectadas.
6. Cada pocos segundos, el sistema agrupa lo anotado y calcula, por categoría y fecha, cuántas
   habitaciones quedan libres: las habitaciones vendibles de esa categoría (según el Módulo 1) menos
   las que ocupan las reservas del Módulo 2 en esa fecha.
7. El sistema envía esas cantidades a Channex para el tipo de habitación relacionado.

**Envío de tarifas (una vez al día)**

8. Cada día a las 03:00 (hora de Colombia), el sistema pide al Módulo 3 la tarifa de cada noche de los próximos 90 días para
   cada categoría relacionada, mediante "Calcular tarifa dinámica".
9. Convierte cada tarifa de COP a GBP con la tasa configurada y la envía a Channex para el plan de
   tarifa relacionado. En el mismo envío reenvía la disponibilidad completa de los próximos 90 días,
   para corregir cualquier diferencia que haya quedado.

**Fallos**

10. Si Channex o el Módulo 3 no responden, o Channex responde que se superó su límite de solicitudes,
    el sistema reintenta más tarde sin perder lo pendiente. Un fallo de envío **nunca** bloquea ni
    revierte una reserva.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configuración de Booking.com en Channex (Priority: P1)

El sistema queda configurado para trabajar con Booking.com a través de Channex: la agencia registrada
con su porcentaje de comisión y cada tipo de habitación de Channex relacionado con una categoría del
Módulo 2.

**Why this priority**: Sin la agencia y sin la relación de tipos de habitación, el Módulo 2 no puede
calcular la comisión de las reservas de Booking ni saber qué categoría reservó el huésped.

**Independent Test**: Se arranca el sistema con la configuración de Channex y se verifica que exista
una sola `Ota` "Booking.com" con el porcentaje configurado y que cada tipo de habitación de Channex
tenga su categoría y su plan de tarifa.

**Acceptance Scenarios**:

1. **Scenario**: Registro de la agencia al iniciar (Happy Path)
   - **Given** la configuración de Channex con un porcentaje de comisión de `15`
   - **When** el sistema inicia y no existe la agencia Booking.com
   - **Then** el sistema registra la `Ota` "Booking.com" con `commissionPercentage` `15` y
     `connectionStatus` `CONNECTED`

2. **Scenario**: Reinicio sin duplicar la agencia
   - **Given** la `Ota` "Booking.com" ya registrada
   - **When** el sistema inicia de nuevo
   - **Then** no crea otra agencia; si el porcentaje configurado cambió, lo actualiza y el cambio
     solo aplica a las reservas futuras

3. **Scenario**: Relación de tipos de habitación
   - **Given** los tipos de habitación de la propiedad en Channex
   - **When** se configura la relación con las categorías del Módulo 2
   - **Then** cada tipo de habitación de Channex queda ligado a una sola `categoryRoom` y a un plan de
     tarifa de Channex

4. **Scenario**: Configuración incompleta (Error)
   - **Given** una configuración sin la clave de acceso, sin la propiedad, con una propiedad que no
     existe en Channex o con una tasa de conversión menor o igual a cero
   - **When** el sistema inicia
   - **Then** el sistema registra el error en el log y no envía nada a Channex, sin afectar el resto
     del Módulo 2

---

### User Story 2 - Envío de la Disponibilidad a Channex (Priority: P1)

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
   - **Given** cinco reservas creadas en el mismo minuto para la misma categoría
   - **When** el sistema hace el envío
   - **Then** envía los valores finales agrupados, sin superar el límite de solicitudes de Channex

4. **Scenario**: Channex no responde o limita las solicitudes (Error)
   - **Given** un envío pendiente
   - **When** Channex no responde o responde que se superó el límite (`429`)
   - **Then** el sistema conserva el envío pendiente y lo reintenta más tarde; las reservas no se
     afectan

---

### User Story 3 - Envío de las Tarifas a Channex (Priority: P2)

Una vez al día, el sistema publica en Channex la tarifa de cada noche de los próximos 90 días de cada
categoría, calculada por el Módulo 3 y convertida a la moneda del hotel de prueba.

**Why this priority**: Booking necesita un precio para vender. Las tarifas cambian con menos frecuencia
que la disponibilidad, por eso basta un envío diario.

**Independent Test**: Se simula una cotización del Módulo 3 de `400000` COP por noche para una
categoría y se verifica que Channex reciba `100.00` GBP para cada noche de los próximos 90 días.

**Acceptance Scenarios**:

1. **Scenario**: Envío diario de tarifas (Happy Path)
   - **Given** una categoría relacionada con un plan de tarifa de Channex
   - **When** se ejecuta el envío diario
   - **Then** el sistema pide al Módulo 3 la tarifa de cada noche de los próximos 90 días y envía a
     Channex cada una dividida entre la tasa configurada (`400000` COP → `100.00` GBP)

2. **Scenario**: El Módulo 3 no responde (Error)
   - **Given** el envío diario
   - **When** el Módulo 3 no responde para una categoría
   - **Then** el sistema no envía tarifas de esa categoría, conserva las que Channex ya tenía, lo
     registra en el log y lo reintenta en el siguiente envío; las demás categorías se envían igual

### Casos Borde

- ¿Qué pasa con los mantenimientos? El Módulo 2 no se entera de cuándo el Módulo 1 registra un
  mantenimiento, así que la disponibilidad enviada **no los descuenta**. Es una limitación conocida: si
  Booking vende una habitación en mantenimiento, la reserva llega y se trata como un conflicto en
  "Generar reservación por OTA".
- ¿Qué pasa si una categoría del Módulo 2 no tiene tipo de habitación relacionado en Channex? No se
  publica en Booking: no se envía ni disponibilidad ni tarifa para ella.
- ¿Qué pasa si la cantidad calculada es negativa (más reservas que habitaciones, por un conflicto)? Se
  envía `0`.
- ¿Qué pasa si el Módulo 1 no responde al calcular las habitaciones vendibles? El envío de esa
  categoría queda pendiente y se reintenta; no se asume ninguna cantidad.
- ¿Qué pasa con fechas pasadas? No se envían: Channex no las acepta.
- ¿Qué pasa si la conversión deja una tarifa con más de dos decimales? Se redondea a dos decimales
  (`ROUND_HALF_UP`).
- ¿Qué pasa si se agrega una agencia nueva en el futuro (por ejemplo, Airbnb)? Se configura igual, con
  su propio porcentaje; este caso de uso no cambia de forma.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe tomar de la configuración (variables de entorno) la dirección de
  Channex, la clave de acceso, el identificador de la propiedad, el porcentaje de comisión de Booking y
  la tasa de conversión de COP a GBP. La clave de acceso nunca se guarda en la base de datos ni se
  escribe en los logs. Al iniciar debe verificar en Channex que la propiedad configurada existe; si no
  existe, no envía nada a Channex ni lee reservas, sin afectar el resto del Módulo 2.
- **FR-002**: El sistema debe registrar al iniciar la `Ota` "Booking.com" con el porcentaje
  configurado, sin duplicarla, y actualizar el porcentaje si cambió, solo para las reservas futuras.
- **FR-003**: El sistema debe guardar la relación entre cada tipo de habitación de Channex
  (`room_type_id`) y una sola categoría del Módulo 2 (`categoryRoom`), junto con el plan de tarifa de
  Channex (`rate_plan_id`) que publica su precio. La relación se carga como registro inicial al
  instalar el sistema.
- **FR-004**: Después de cada cambio confirmado que afecte la ocupación, el sistema debe anotar las
  categorías y las fechas afectadas, sin esperar a Channex ni depender de él para confirmar el cambio.
- **FR-005**: El sistema debe calcular la disponibilidad de cada categoría y fecha como las
  habitaciones vendibles de esa categoría (Módulo 1, "Consultar inventario de habitaciones") menos las
  habitaciones de esa categoría que ocupan las reservas del Módulo 2 en esa fecha (las mismas que
  bloquean en "Verificar disponibilidades"). Si el resultado es negativo, envía `0`.
- **FR-006**: El sistema debe agrupar los envíos de disponibilidad y de tarifas para no superar el
  límite de Channex (10 solicitudes por minuto por propiedad para cada tipo de envío), y reintentar con
  espera creciente ante un `429` o una falla.
- **FR-007**: El sistema debe enviar todos los días a las 03:00 (hora de Colombia) las tarifas de los próximos 90 días de cada
  categoría relacionada: pide al Módulo 3 la tarifa de cada noche mediante "Calcular tarifa dinámica",
  la divide entre la tasa configurada, la redondea a dos decimales y la envía al plan de tarifa
  relacionado. En el mismo envío debe reenviar la disponibilidad completa de los próximos 90 días.
- **FR-008**: El sistema no debe enviar fechas pasadas ni categorías sin relación con Channex.
- **FR-009**: Un fallo de Channex, del Módulo 1 o del Módulo 3 en estos envíos no debe bloquear ni
  revertir ninguna reserva: el envío queda pendiente y se reintenta.

### Non-Functional Requirements

- **NFR-001**: Un cambio de disponibilidad debe llegar a Channex en menos de 1 minuto en condiciones
  normales.
- **NFR-002**: La clave de acceso a Channex no debe aparecer en logs, respuestas ni en la base de
  datos.

### Key Entities *(include if feature involves data)*

- **Ota**: La agencia Booking.com. Atributos: `id`, `name`, `hotelAccountId` (el id del hotel de prueba
  de Booking), `commissionPercentage`, `connectionStatus` y `linkedAt`.
- **OtaRoomTypeMapping**: Relación entre un tipo de habitación de Channex y una categoría del Módulo 2.
  Atributos: `otaId`, `channexRoomTypeId`, `channexRatePlanId` y `categoryRoom`.
- **AriPendingChange**: Categoría y rango de fechas cuya disponibilidad hay que enviar a Channex.
  Atributos: `categoryRoom`, `dateFrom`, `dateTo` y `createdAt`.
- **Room**: Habitación vendible del Módulo 1. Se usa para contar las habitaciones de cada categoría.
- **RateQuote**: Cotización del Módulo 3, de la que se toma la tarifa de cada noche (`nightlyRates`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los cambios confirmados que afectan la ocupación se reflejan en Channex.
- **SC-002**: Cero reservas del Módulo 2 se bloquean o revierten por una falla de Channex.
- **SC-003**: Las tarifas publicadas en Channex son exactamente las del Módulo 3 convertidas con la tasa
  configurada.
