# Feature Specification: Calcular Tarifa Dinámica

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

Para captar una reserva de canal directo o para procesar la modificación de una estadía ya
existente, el Módulo 2 (Operación de Reservas) necesita conocer la tarifa de cada habitación. Esa
tarifa no la calcula el Módulo 2: la produce el motor oficial de precios del hotel, expuesto por el
Módulo 3 (Pricing) mediante el servicio "Calcular tarifa dinámica", que concentra las reglas de
temporada, ocupación, anticipación y larga estadía. Si el Módulo 2 intentara replicar esa lógica de
forma local, el hotel terminaría con dos motores de tarificación que se contradicen entre sí.

Esta especificación describe el caso de uso desde el punto de vista del **cliente que consume el
servicio**: el Módulo 2 verifica la disponibilidad mediante "Verificar disponibilidades", invoca de
forma síncrona el servicio externo del Módulo 3, recibe una cotización (`RateQuote`) y
**relaciona la tarifa recibida con la habitación de la reserva** (`ReservationRoom.roomGrossAmount`),
de manera estrictamente informativa. El Módulo 2 **no calcula nada** con ese importe: no suma las
tarifas de las habitaciones, no calcula diferencias, no agrega impuestos y no aplica comisiones.
Lo único que hace con la tarifa es guardarla junto a su habitación. El IVA lo fija el Módulo 3 más adelante, al facturar.

Reglas de la integración que enmarcan este caso de uso:

- **Contrato de entrada (lo que el Módulo 2 envía de forma síncrona)**: la invocación se realiza
  mediante una petición **REST con el método HTTP POST** al servicio del Módulo 3, con un cuerpo en
  formato JSON (JSON Body) que contiene el identificador de categoría de habitación
  (`categoryRoom`), la fecha de llegada (`startDate`) y la fecha de salida (`endDate`).
- **Contrato de salida (lo que el Módulo 2 recibe del Módulo 3)**: una entidad de cotización
  `RateQuote` con la tarifa de la habitación (`grossAmount`), la moneda (`currency`) y la marca de
  tiempo del cálculo (`calculatedAt`).
- **Sin cálculos en el Módulo 2**: el Módulo 2 almacena la tarifa tal cual la recibe, sin
  transformarla, sin sumarla y sin compararla con tarifas anteriores.
- **Separación de responsabilidades**: la disponibilidad de la habitación se verifica **antes** de
  invocar al Módulo 3 mediante "Verificar disponibilidades" (reservas locales y calendario del
  Módulo 1). El Módulo 3 calcula el precio sobre la categoría y nunca verifica ni modifica el estado
  de ninguna `Room`.

### Flujo de Usuario de Alto Nivel

1. El Módulo 2, desde el flujo de generación de reserva directa o desde el flujo de actualización de
   reservación, recopila la categoría de `Room` y las fechas deseadas de la estadía
   (`startDate` y `endDate`).
2. El flujo invocador ya verificó la disponibilidad mediante "Verificar disponibilidades"; esa
   verificación no forma parte de este caso de uso.
3. Con la disponibilidad confirmada, el Módulo 2 invoca de forma síncrona el servicio "Calcular
   tarifa dinámica" del Módulo 3, transmitiendo los parámetros de la estadía.
4. El Módulo 2 recibe la `RateQuote`, la mapea a su modelo local y guarda su `grossAmount` en el
   `roomGrossAmount` de la habitación cotizada. En los flujos de actualización, muestra primero al
   solicitante la tarifa nueva de cada habitación afectada y solo persiste el cambio tras su
   confirmación.

Este caso de uso nunca realiza llamadas al Módulo 1 ni verifica disponibilidad: su única integración
saliente es la llamada síncrona al servicio de tarificación del Módulo 3.

**Pantalla de referencia "Tarifas" (solo lectura, fuera del flujo de reserva):** además del consumo
síncrono descrito arriba, la Recepcionista tiene una pantalla de solo lectura que lista, por
categoría, una tarifa base y un ajuste de temporada ilustrativo, para darle una idea aproximada antes
de cotizar. Esta pantalla **no sustituye ni anticipa** la cotización real: es una referencia local,
construida en el Módulo 2 con una regla fija de ejemplo (un mismo porcentaje de ajuste para todas las
categorías), sin ninguna llamada al Módulo 3. La tarifa que realmente queda en el `roomGrossAmount` de
una reserva siempre se obtiene en el momento de reservar o recotizar, mediante la llamada síncrona de
este caso de uso — nunca desde los valores mostrados en esta pantalla de referencia. La tarifa se
fija por categoría y fechas, no por cantidad de personas, así que esta pantalla no muestra la
capacidad de las habitaciones (esa información está en la pantalla "Habitaciones").

**Reservas con varias habitaciones**: el servicio del Módulo 3 cotiza una categoría para un rango de
fechas. Por eso el Módulo 2 lo invoca **una vez por cada habitación** de la reserva (con la
`categoryRoom` de esa habitación y las fechas comunes de la reserva) y guarda cada resultado en el
`roomGrossAmount` de su `ReservationRoom`. La reserva no tiene un total: cada habitación lleva su
tarifa. En una recotización, solo invoca al Módulo 3 por las habitaciones afectadas (todas si
cambian las fechas; solo las nuevas o cambiadas si cambian las habitaciones); una habitación quitada
se va con su tarifa, sin invocar al Módulo 3. Si falla la cotización de una sola habitación, no se
aplica nada. La cantidad de personas (`guestCount`) no se envía al Módulo 3: el precio depende de la
categoría y de las fechas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consumo de Cotización para Reservas Nuevas (Priority: P1)

Durante la creación de una reserva directa, una vez que el Módulo 2 ha confirmado que la habitación
está disponible para las fechas solicitadas, necesita obtener la tarifa. El Módulo 2 invoca de forma
síncrona el servicio "Calcular tarifa dinámica" del Módulo 3 enviando `categoryRoom`, `startDate` y
`endDate`; recibe la `RateQuote` con el `grossAmount` y la `currency`; y relaciona esa tarifa, de
forma informativa, con la habitación de la reserva que nace en estado `ACTIVE`. Si el Módulo 3 no
responde, la creación de la reserva no puede completarse.

**Why this priority**: Sin este consumo no es posible cotizar ninguna reserva directa nueva. Es el
flujo de mayor frecuencia del caso de uso y la condición sin la cual el Módulo 2 no puede cerrar una
venta directa con un precio consistente con el motor oficial del hotel.

**Independent Test**: Se toma una categoría con cupo local disponible y un rango de fechas
coherente, se ejecuta el flujo de reserva directa y se verifica que el Módulo 2 realiza exactamente
una llamada síncrona al Módulo 3 por habitación con los tres parámetros, que mapea la `RateQuote`
recibida y que `ReservationRoom.roomGrossAmount` queda igual al `grossAmount` retornado. La prueba se
completa simulando un Módulo 3 no disponible y confirmando que la reserva no se crea y que la
respuesta es un **HTTP 400 (Bad Request)** controlado, sin tarifas asumidas.

**Acceptance Scenarios**:

1. **Scenario**: Cotización exitosa de una reserva directa nueva
   - **Given** que "Verificar disponibilidades" confirmó que la `Room` de la `categoryRoom`
     solicitada está disponible en el rango `startDate`–`endDate`, con fechas coherentes
   - **When** el Módulo 2 invoca de forma síncrona el servicio "Calcular tarifa dinámica" del
     Módulo 3 con `categoryRoom`, `startDate` y `endDate`
   - **Then** el Módulo 2 recibe una `RateQuote` con `grossAmount` y `currency`, la mapea a su
     modelo local, guarda el `grossAmount` en el `roomGrossAmount` de la habitación, y la reserva
     queda registrada en estado `ACTIVE`

2. **Scenario**: El servicio de Pricing del Módulo 3 no responde durante la cotización
   - **Given** una solicitud de reserva directa con cupo local disponible
   - **When** el Módulo 2 invoca el servicio del Módulo 3 y este no responde, agota el tiempo de
     espera o devuelve un error de disponibilidad
   - **Then** el Módulo 2 aplica un bloqueo seguro, no crea la reserva, no asume ninguna tarifa por
     defecto ni a cero, y responde con **HTTP 400 (Bad Request)** con el mensaje "Error 400: El
     servicio de cotización de tarifas no se encuentra disponible"

3. **Scenario**: Sin disponibilidad, no se invoca al Módulo 3
   - **Given** que "Verificar disponibilidades" indica que no hay disponibilidad para la
     habitación y las fechas solicitadas
   - **When** se intenta continuar con la reserva directa
   - **Then** el Módulo 2 detiene el flujo localmente, responde con **HTTP 400 (Bad Request)** por
     falta de disponibilidad, y no realiza ninguna llamada al servicio de tarificación del Módulo 3

---

### User Story 2 - Recotización por Modificación de Estadía (Priority: P1)

Cuando la recepcionista modifica las fechas o la categoría de una reserva `ACTIVE`, el Módulo 2 debe
volver a consultar la tarifa de las habitaciones afectadas. Consume el mismo servicio del Módulo 3,
con los mismos tres parámetros, y recibe la nueva `RateQuote` de cada habitación. El Módulo 2
muestra al solicitante la tarifa nueva de cada habitación (junto a la vigente, sin calcular la
diferencia entre ambas) y solo persiste el cambio localmente tras la confirmación.

**Why this priority**: Las modificaciones de estadía son frecuentes y tienen impacto económico
directo. Recotizar contra el motor oficial y mostrar la tarifa nueva antes de guardar evita que el
hotel absorba cambios de tarifa no informados o que el huésped sea sorprendido con un cargo.

**Independent Test**: Se toma una reserva `ACTIVE` con tarifas conocidas, se modifican sus fechas, y
se verifica que el Módulo 2 invoca el servicio del Módulo 3 por cada habitación, que muestra la
tarifa nueva de cada una, y que los nuevos `roomGrossAmount` solo se persisten tras la confirmación
explícita del solicitante. La prueba se completa con el Módulo 3 no disponible, verificando que el
cambio no se aplica y que la respuesta es un **HTTP 400** controlado.

**Acceptance Scenarios**:

1. **Scenario**: Recotización exitosa por cambio de fechas
   - **Given** una reserva en estado `ACTIVE` con dos habitaciones y tarifas vigentes, cuyas fechas
     se amplían
   - **When** el Módulo 2 invoca "Calcular tarifa dinámica" del Módulo 3 una vez por habitación,
     enviando `categoryRoom` y las nuevas `startDate` y `endDate`
   - **Then** el Módulo 2 recibe una `RateQuote` por habitación, muestra a la recepcionista la tarifa
     nueva de cada una, y solo tras la confirmación persiste los nuevos `roomGrossAmount`,
     actualizando el `updatedAt` de la reserva

2. **Scenario**: El solicitante no confirma
   - **Given** las `RateQuote` de recálculo ya recibidas
   - **When** la recepcionista no confirma el cambio
   - **Then** el Módulo 2 descarta las cotizaciones, no modifica las tarifas ni las fechas de la
     reserva, y la reserva permanece exactamente en su estado anterior

### Casos Borde

- ¿Qué sucede si el servicio de Pricing del Módulo 3 no responde durante la cotización de una
  reserva nueva? El sistema aplica un bloqueo seguro: cancela la transacción de forma local, no
  persiste ningún registro y responde **HTTP 400 (Bad Request)** con el mensaje "Error 400: El
  servicio de cotización de tarifas no se encuentra disponible". No se permite crear la reserva con
  una tarifa por defecto, estimada, heredada ni a cero.
- ¿Qué sucede si el Módulo 3 no responde mientras se recotiza una reserva `ACTIVE`? El sistema
  detiene la recotización: no aplica ningún cambio de fechas ni de categoría, conserva las tarifas
  vigentes, y responde **HTTP 400 (Bad Request)** con el mensaje "No se pudo calcular la nueva
  tarifa en este momento. Intente más tarde.". Es el mismo comportamiento que "Actualizar
  reservación".
- ¿Qué sucede si se intenta cotizar una `categoryRoom` que no existe en el catálogo? El sistema
  intercepta la petición o mapea el error del Módulo 3, y devuelve **HTTP 400** indicando que la
  categoría no es válida, sin propagar errores **HTTP 500**.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema (Módulo 2) debe invocar de forma síncrona el servicio externo "Calcular
  tarifa dinámica" del Módulo 3 mediante una petición REST con el método HTTP `POST`, enviando en el
  cuerpo JSON (JSON Body) los parámetros `categoryRoom`, `startDate` y `endDate`.
- **FR-002**: El sistema debe mapear el objeto `RateQuote` retornado por el Módulo 3 y guardar su
  `grossAmount` y su `currency`, de forma estrictamente informativa, en el `roomGrossAmount` de la
  habitación cotizada. El sistema no debe sumar las tarifas de las habitaciones ni guardar un total
  en la reserva.
- **FR-002a**: El sistema debe invocar el servicio una vez por cada habitación que necesite
  cotización (todas en una reserva nueva o en un cambio de fechas; las nuevas o cambiadas en un
  cambio de habitaciones) y tratar la cotización de la reserva como todo o nada: si una sola
  invocación falla, no debe persistir ninguna tarifa.
- **FR-003**: El sistema debe interrumpir la creación de una reserva directa cuando el servicio del
  Módulo 3 no responde, agota el tiempo de espera o retorna un error de disponibilidad, devolviendo
  un error controlado **HTTP 400 (Bad Request)** y sin persistir ninguna reserva ni asumir tarifas
  por defecto o a cero.
- **FR-004**: El sistema debe detener la recotización de una actualización de fechas o categoría
  cuando el servicio de Pricing no responde, sin aplicar ningún cambio, conservando las tarifas
  vigentes y respondiendo **HTTP 400 (Bad Request)**.
- **FR-005**: El sistema no debe realizar ningún cálculo con la tarifa recibida: ni sumas, ni
  diferencias, ni IVA, ni comisiones. Los cálculos que se necesiten con la tarifa no son
  del Módulo 2; el IVA lo fija exclusivamente el Módulo 3 al facturar.
- **FR-006**: El sistema no debe verificar disponibilidad ni realizar llamadas al Módulo 1 dentro de
  este caso de uso: el flujo invocador (generar reservación directa o actualizar reservación)
  ejecuta "Verificar disponibilidades" antes de solicitar la cotización, y este caso solo consume el
  servicio de Pricing del Módulo 3.
- **FR-007**: El sistema debe mostrar a la recepcionista, en los flujos de recotización, la tarifa
  nueva de cada habitación afectada y persistir los nuevos `roomGrossAmount` únicamente tras la
  confirmación explícita del solicitante, actualizando el `updatedAt` de la reserva.
- **FR-008**: El sistema debe interceptar los errores de validación de entrada y las respuestas de
  error del Módulo 3 (rango de fechas incoherente, categoría inexistente, parámetros ausentes) y
  mapearlos a respuestas **HTTP 400 (Bad Request)** estructuradas, quedando prohibida la propagación
  de excepciones que deriven en **HTTP 500 (Internal Server Error)**.
- **FR-009**: El sistema debe ofrecer a la Recepcionista una pantalla de solo lectura con una tarifa
  de referencia por categoría (tarifa base, ajuste de temporada ilustrativo y tarifa efectiva
  resultante), sin capacidad de las habitaciones, separada del flujo de reserva, sin invocar al
  Módulo 3 y sin que sus valores se persistan ni se usen como `roomGrossAmount` de ninguna reserva.

### Non-Functional Requirements

- **NFR-001**: El tiempo de procesamiento de la llamada e integración síncrona con el Módulo 3,
  medido desde que el Módulo 2 emite la solicitud hasta que persiste la `RateQuote` mapeada, debe
  ser inferior a 1.5 segundos.
- **NFR-002**: El Módulo 2 debe manejar el `grossAmount` recibido con precisión decimal exacta, sin
  redondeos propios que alteren el valor calculado por el Módulo 3.

### Key Entities *(include if feature involves data)*

- **Reservation** (entidad local del Módulo 2): Reserva cuyas habitaciones llevan la tarifa
  informativa. Atributos: `reservationRef`, `guestRef`, `startDate`, `endDate`, `updatedAt` (control
  de concurrencia optimista), `source` (`DIRECT` | `OTA`), y `status` con estados permitidos:
  `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. Las reservas directas
  nacen en `ACTIVE` y las de OTA en `PENDING`. No guarda un total de las tarifas de sus habitaciones.
- **ReservationRoom** (entidad local del Módulo 2): Habitación de la reserva. Atributos relevantes:
  `roomId`, `categoryRoom` (se envía al Módulo 3), `roomGrossAmount` (tarifa retornada por la
  `RateQuote` de esa habitación) y `currency`.
- **RateQuote** (entidad de paso / contrato consumido del Módulo 3): Representa la cotización que el
  Módulo 2 recibe y mapea, sin ser su propietario. Atributos: `grossAmount` (tarifa bruta de la
  habitación calculada por el motor dinámico), `currency` (moneda del importe) y `calculatedAt`
  (marca temporal en la que el Módulo 3 calculó la tarifa). El Módulo 2 no persiste esta entidad
  como registro propio: extrae sus valores hacia la `ReservationRoom`.
- **Room**: Se referencia únicamente a través de su categoría (`categoryRoom`) para construir el
  contrato de entrada del servicio de tarificación. Sus estados en el Módulo 1 son `Available`,
  `Reserved` y `Occupied`. Este caso de uso no consulta ni modifica el `status` de ninguna `Room`:
  la tarificación opera sobre la categoría y la disponibilidad se verifica antes mediante
  "Verificar disponibilidades".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las tarifas guardadas en las habitaciones corresponden exactamente al
  `grossAmount` retornado por la `RateQuote` del Módulo 3, sin diferencias introducidas por el
  Módulo 2.
- **SC-002**: El 100% de las caídas del servicio de Pricing durante la cotización de reservas nuevas
  resultan en respuestas controladas **HTTP 400 (Bad Request)**, con cero excepciones **HTTP 500**
  propagadas en producción y cero reservas creadas con tarifa asumida.
- **SC-003**: El 100% de las caídas del servicio de Pricing durante modificaciones de reservas
  activas se resuelven sin aplicar cambios y con respuestas controladas **HTTP 400**, sin dejar
  tarifas desactualizadas.
