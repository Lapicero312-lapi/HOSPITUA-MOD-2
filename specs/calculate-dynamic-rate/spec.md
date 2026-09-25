# Feature Specification: Calcular Tarifa Dinámica

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

Para captar una reserva de canal directo o para procesar la modificación de una estadía ya
existente, el Módulo 2 (Operación de Reservas) necesita conocer el valor exacto del hospedaje. Ese
valor no lo calcula el Módulo 2: lo produce el motor oficial de precios del hotel, expuesto por el
Módulo 3 (Pricing) mediante el servicio "Calcular tarifa dinámica", que concentra las reglas de
temporada, ocupación, anticipación y larga estadía. Si el Módulo 2 intentara replicar esa lógica de
forma local, el hotel terminaría con dos motores de tarificación que se contradicen entre sí: el
huésped recibiría un monto en la reserva y otro distinto en cualquier recálculo posterior, y se
vendería por encima o por debajo de la demanda real.

Esta especificación describe el caso de uso desde el punto de vista del **cliente que consume el
servicio**: el Módulo 2 actúa como orquestador. Reúne los parámetros de la estadía, verifica la
disponibilidad mediante "Verificar disponibilidades", invoca de forma síncrona el servicio externo
del Módulo 3,
recibe una cotización (`RateQuote`) y **congela el `grossAmount` retornado de manera estrictamente
informativa** en su reserva local. El Módulo 2 no asume ninguna responsabilidad financiera propia
sobre ese importe: no le agrega impuestos, no le aplica comisiones y no lo recalcula. El IVA lo fija
el Módulo 3 más adelante, al facturar; en esta etapa el número que viaja y se almacena es siempre
un precio bruto.

Reglas de la integración que enmarcan este caso de uso:

- **Contrato de entrada (lo que el Módulo 2 envía de forma síncrona)**: el identificador de
  categoría de habitación (`categoryRoom`), la fecha de llegada (`startDate`) y la fecha de
  salida (`endDate`). De forma opcional, y solo para flujos de actualización, el Módulo 2 envía
  además el monto bruto anterior de la reserva (`previousGrossAmount`) como valor de referencia.
- **Contrato de salida (lo que el Módulo 2 recibe del Módulo 3)**: una entidad de cotización
  `RateQuote` con el monto total calculado (`grossAmount`), la moneda (`currency`) y —únicamente
  cuando la solicitud incluyó un `previousGrossAmount`— la diferencia financiera calculada
  (`amountDifference`).
- **Sin impuestos ni comisiones en esta etapa**: el motor dinámico del Módulo 3 retorna el precio
  bruto y el Módulo 2 lo almacena tal cual en `Reservation.grossAmount`, sin transformarlo.
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
   tarifa dinámica" del Módulo 3, transmitiendo los parámetros obligatorios de la estadía y, en los
   flujos de actualización, el `previousGrossAmount`.
4. El Módulo 2 recibe la `RateQuote` calculada, la mapea a su modelo local y almacena el
   `grossAmount` de forma informativa en el atributo `grossAmount` de la reserva. En los flujos de
   actualización, presenta primero el `amountDifference` al solicitante y solo persiste el cambio
   tras su confirmación.

Este caso de uso nunca realiza llamadas al Módulo 1 ni verifica disponibilidad: su única integración
saliente es la llamada síncrona al servicio de tarificación del Módulo 3.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consumo de Cotización para Reservas Nuevas (Priority: P1)

Durante la creación de una reserva directa, una vez que el Módulo 2 ha
confirmado que la habitación está disponible para las fechas solicitadas, necesita
obtener el valor de la estadía. El Módulo 2 invoca de forma síncrona el servicio "Calcular tarifa
dinámica" del Módulo 3 enviando `categoryRoom`, `startDate` y `endDate`; recibe la `RateQuote`
con el `grossAmount` y la `currency`; y asocia ese monto de forma informativa a la reserva que nace
en estado `ACTIVE`. Si el Módulo 3 no responde, la creación de la reserva no puede completarse.

**Why this priority**: Sin este consumo no es posible cotizar ninguna reserva directa nueva. Es el
flujo de mayor frecuencia del caso de uso y la condición sin la cual el Módulo 2 no puede cerrar una
venta directa con un precio consistente con el motor oficial del hotel.

**Independent Test**: Se toma una categoría con cupo local disponible y un rango de fechas
coherente,
se ejecuta el flujo de reserva directa y se verifica que el Módulo 2 realiza exactamente una llamada
síncrona al Módulo 3 con los tres parámetros obligatorios, que mapea la `RateQuote` recibida y que
`Reservation.grossAmount` queda igual al `grossAmount` retornado. La prueba se completa simulando un
Módulo 3 no disponible y confirmando que la reserva no se crea y que la respuesta es un **HTTP 400
(Bad Request)** controlado, sin tarifas asumidas.

**Acceptance Scenarios**:

1. **Scenario**: Cotización exitosa de una reserva directa nueva
   - **Given** que "Verificar disponibilidades" confirmó que la `Room` de la
     `categoryRoom` solicitada está disponible en el rango `startDate`–`endDate`, con fechas
     coherentes
   - **When** el Módulo 2 invoca de forma síncrona el servicio "Calcular tarifa dinámica" del
     Módulo 3 con `categoryRoom`, `startDate` y `endDate`
   - **Then** el Módulo 2 recibe una `RateQuote` con `grossAmount` y `currency`, la mapea a su
     modelo
     local, almacena el `grossAmount` de forma informativa en `Reservation.grossAmount`, y la
     reserva
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

Cuando la recepcionista modifica las fechas o la categoría
de una reserva `ACTIVE`, el Módulo 2 debe volver a consultar el valor de la estadía. En este flujo
el Módulo 2 consume el mismo servicio del Módulo 3 pero añade el `previousGrossAmount` de la reserva
como referencia. El Módulo 3 retorna la nueva `RateQuote` incluyendo el `amountDifference` (monto a
cobrar si es positivo, o a reembolsar si es negativo). El Módulo 2 presenta esa diferencia al
solicitante y solo persiste el cambio localmente tras la confirmación.

**Why this priority**: Las modificaciones de estadía son frecuentes y tienen impacto económico
directo. Recotizar contra el motor oficial y mostrar la diferencia antes de guardar evita que el
hotel absorba cambios de tarifa no informados o que el huésped sea sorprendido con un cargo.

**Independent Test**: Se toma una reserva `ACTIVE` con un `grossAmount` conocido, se modifican sus
fechas, y se verifica que el Módulo 2 invoca el servicio del Módulo 3 enviando también el
`previousGrossAmount`, que la `RateQuote` recibida contiene `amountDifference`, y que el nuevo
`grossAmount` solo se persiste en la reserva local tras la confirmación explícita del solicitante.
La prueba se completa con el Módulo 3 no disponible, verificando que el cambio no se aplica y que la
respuesta es un **HTTP 400** controlado.

**Acceptance Scenarios**:

1. **Scenario**: Recotización exitosa con diferencia a pagar
   - **Given** una reserva en estado `ACTIVE` con un `grossAmount` vigente, cuyas fechas se amplían
     a
     un rango más caro
   - **When** el Módulo 2 invoca "Calcular tarifa dinámica" del Módulo 3 enviando
     `categoryRoom`, las nuevas `startDate` y `endDate`, y el `previousGrossAmount`
   - **Then** el Módulo 2 recibe una `RateQuote` con el nuevo `grossAmount` y un `amountDifference`
     positivo, presenta la diferencia a pagar a la recepcionista, y solo tras la
     confirmación persiste el nuevo `grossAmount` en la reserva local, incrementando su `version`

2. **Scenario**: Recotización exitosa con diferencia a reembolsar
   - **Given** una reserva en estado `ACTIVE` cuyas fechas se reducen a un rango más económico
   - **When** el Módulo 2 recotiza contra el Módulo 3 enviando el `previousGrossAmount`
   - **Then** el Módulo 2 recibe una `RateQuote` con un `amountDifference` negativo, presenta el
     monto a reembolsar, y persiste el nuevo `grossAmount` en la reserva local únicamente tras la
     confirmación del solicitante

3. **Scenario**: El solicitante no confirma la diferencia
   - **Given** una `RateQuote` de recálculo ya recibida con un `amountDifference` distinto de cero
   - **When** la recepcionista no confirma el cambio
   - **Then** el Módulo 2 descarta la cotización, no modifica el `grossAmount` ni las fechas de la
     reserva, y la reserva permanece exactamente en su estado anterior

### Casos Borde

- ¿Qué sucede si el servicio de Pricing del Módulo 3 no responde durante la cotización de una
  reserva nueva? El sistema aplica un bloqueo seguro: cancela la transacción de forma local, no
  persiste ningún registro y responde **HTTP 400 (Bad Request)** con el mensaje "Error 400: El
  servicio de cotización de tarifas no se encuentra disponible". No se permite crear la reserva con
  una tarifa por defecto, estimada, heredada ni a cero.
- ¿Qué sucede si el Módulo 3 no responde mientras se recotiza una reserva `ACTIVE`? El sistema
  detiene la recotización: no aplica ningún cambio de fechas ni de categoría, conserva el
  `grossAmount` vigente, y responde **HTTP 400 (Bad Request)** con el mensaje "No se pudo calcular
  la nueva tarifa en este momento. Intente más tarde.". Es el mismo comportamiento que "Actualizar
  reservación".
- ¿Qué sucede si se intenta cotizar una `categoryRoom` que no existe en el catálogo? El sistema
  intercepta la petición o mapea el error del Módulo 3, y devuelve **HTTP 400** indicando que la
  categoría no es válida, sin propagar errores **HTTP 500**.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema (Módulo 2) debe invocar de forma síncrona el servicio externo "Calcular
  tarifa dinámica" del Módulo 3 enviando como parámetros obligatorios `categoryRoom`,
  `startDate` y `endDate`, y agregando `previousGrossAmount` cuando la invocación proviene de un
  flujo de actualización de reservación.
- **FR-002**: El sistema debe mapear el objeto `RateQuote` retornado por el Módulo 3 e incorporar su
  `grossAmount` de forma estrictamente informativa en el atributo `grossAmount` de la reserva local
  del Módulo 2, conservando además la `currency` y, cuando exista, el `amountDifference`.
- **FR-003**: El sistema debe interrumpir la creación de una reserva directa cuando el servicio del
  Módulo 3 no responde, agota el tiempo de espera o retorna un error de disponibilidad, devolviendo
  un error controlado **HTTP 400 (Bad Request)** y sin persistir ninguna reserva ni asumir tarifas
  por defecto o a cero.
- **FR-004**: El sistema debe detener la recotización de una actualización de fechas o categoría
  cuando el servicio de Pricing no responde, sin aplicar ningún cambio, conservando el `grossAmount`
  vigente y respondiendo **HTTP 400 (Bad Request)**.
- **FR-005**: El sistema debe garantizar que no se calcule IVA ni comisiones sobre el `grossAmount`
  bruto retornado por la `RateQuote` en esta etapa; el IVA lo fija exclusivamente el Módulo 3 al
  facturar.
- **FR-006**: El sistema no debe verificar disponibilidad ni realizar llamadas al Módulo 1 dentro de
  este caso de uso: el flujo invocador (generar reservación directa o actualizar reservación)
  ejecuta "Verificar disponibilidades" antes de solicitar la cotización, y este caso solo consume el
  servicio de Pricing del Módulo 3.
- **FR-007**: El sistema debe presentar el `amountDifference` a la recepcionista en los flujos de
  recotización y persistir el nuevo `grossAmount` en la reserva local únicamente tras la
  confirmación explícita del solicitante, incrementando la `version` de la reserva.
- **FR-008**: El sistema debe interceptar los errores de validación de entrada y las respuestas de
  error del Módulo 3 (rango de fechas incoherente, categoría inexistente, parámetros ausentes) y
  mapearlos a respuestas **HTTP 400 (Bad Request)** estructuradas, quedando prohibida la propagación
  de excepciones que deriven en **HTTP 500 (Internal Server Error)**.

### Non-Functional Requirements

- **NFR-001**: El tiempo de procesamiento de la llamada e integración síncrona con el Módulo 3,
  medido desde que el Módulo 2 emite la solicitud hasta que persiste la `RateQuote` mapeada, debe
  ser inferior a 1.5 segundos.
- **NFR-002**: El Módulo 2 debe manejar el `grossAmount` y el `amountDifference` recibidos con
  precisión decimal exacta, sin redondeos propios que alteren el valor calculado por el Módulo 3.

### Key Entities *(include if feature involves data)*

- **Reservation** (entidad local del Módulo 2): Representa la reserva sobre la que se congela el
  valor informativo de la estadía. Atributos: `id`, `guestRef`, `categoryRoom`, `startDate`,
  `endDate`, `grossAmount` (almacena de forma informativa el valor retornado por la `RateQuote` del
  Módulo 3), `version` (control de
  concurrencia optimista), `source` (`DIRECT` | `OTA`), y `status` con estados permitidos:
  `PENDING`,
  `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. Las reservas directas nacen en
  `ACTIVE` y las de OTA en `PENDING`.
- **RateQuote** (entidad de paso / contrato consumido del Módulo 3): Representa la cotización que el
  Módulo 2 recibe y mapea, sin ser su propietario. Atributos: `grossAmount` (precio bruto total
  calculado por el motor dinámico), `amountDifference` (diferencia respecto al `previousGrossAmount`
  enviado; presente solo en recotizaciones), `currency` (moneda del importe), y `calculatedAt`
  (marca temporal en la que el Módulo 3 calculó la tarifa). El Módulo 2 no persiste esta entidad
  como registro propio: extrae sus valores hacia la `Reservation` y hacia la vista de confirmación
  de diferencia.
- **Room**: Se referencia únicamente a través de su categoría (`categoryRoom`) para construir el
  contrato de entrada del servicio de tarificación. Sus estados en el Módulo 1 son `AVAILABLE`,
  `RESERVED` y `OCCUPIED`. Este caso de uso no consulta ni modifica el `status` de ninguna `Room`:
  la tarificación opera sobre la categoría y la disponibilidad se verifica antes mediante
  "Verificar disponibilidades".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las cotizaciones informativas de reservas directas del Módulo 2
  corresponden exactamente al monto bruto (`grossAmount`) retornado por la `RateQuote` del Módulo 3,
  sin diferencias introducidas por el Módulo 2.
- **SC-002**: El 100% de las caídas del servicio de Pricing durante la cotización de reservas nuevas
  resultan en respuestas controladas **HTTP 400 (Bad Request)**, con cero excepciones **HTTP 500**
  propagadas en producción y cero reservas creadas con tarifa asumida.
- **SC-003**: El 100% de las caídas del servicio de Pricing durante modificaciones de reservas
  activas se resuelven sin aplicar cambios y con respuestas controladas **HTTP 400**, sin dejar
  montos desactualizados.
