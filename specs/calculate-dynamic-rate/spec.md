# Especificación de Funcionalidad: Calcular Tarifa Dinámica

**Creado**: 2026-09-08

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Calcular Tarifa Dinámica (`Calculate Dynamic Rate`) es el motor de tarificación variable e inteligencia de precios de la plataforma hotelera (integrado funcionalmente con el **Módulo 3**). Su propósito es calcular y re-cotizar el valor de la estadía en función del tipo de habitación (`roomType`), fechas de llegada y salida (`startDate`, `endDate`), nivel de ocupación actual del hotel, temporada (alta/baja), duración del hospedaje, cargos adicionales (`ExtraCharge`) y reglas promocionales, emitiendo un desglose financiero en la entidad `RateQuote`. Toda la interacción ocurre de forma transparente desde las interfaces de reserva, check-out o actualización:

- Al solicitar un cálculo, el sistema consulta las reglas tarifarias dinámicas del **Módulo 3**, ponderando la demanda y la anticipación de la solicitud.
- Genera una propuesta de tarifa formal representada por la entidad `RateQuote`, asignándole un periodo de vigencia (`validUntil`) y el estado `ACTIVE`.
- Cuando se invoca durante una modificación de reserva, el sistema compara el valor previo (`previousAmount`) contra la tarifa recalculada (`newAmount`), determinando la diferencia diferencial en `differenceAmount`.
- Durante el evento de **Check-Out**, el motor combina la tarifa diaria dinámica con los consumos e impuestos registrados para emitir el importe total definitivo a cobrar al huésped.
- Si el servicio de Módulo 3 no responde o se envían parámetros incoherentes, el sistema bloquea el cálculo y retorna un error de negocio controlado **HTTP 400 (Bad Request)**.

**Estados de la entidad `Reservation`**: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `RateQuote`**:
- `status`: `ACTIVE`, `EXPIRED`, `SUPERSEDED`.

**Estados de la entidad `Room`** (propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

---

### Historia de Usuario 1 - Cálculo Síncrono de Tarifa Dinámica para Estadías y Salidas (Prioridad: P1)

La Recepcionista (o el Sistema en canal automatizado) solicita calcular la tarifa exacta para una reserva nueva o para el cierre de un check-out. El sistema analiza las fechas, la categoría de la habitación, los cargos adicionales de consumos y las reglas de temporada del Módulo 3, retornando una cotización en la entidad `RateQuote` con estado `ACTIVE` y el desglose detallado de importes. Esta historia es el flujo maestro (Happy Path).

**Por qué esta prioridad**: Es la funcionalidad central que determina el valor de venta del inventario y la facturación de salidas. Sin ella no se pueden liquidar cobros de estadía ni cotizar reservaciones ajustadas al mercado.

**Prueba Independiente**: Se prueba enviando los datos de una estadía de 3 noches en temporada media para una habitación de categoría estándar. Se verifica que el motor dinámico Módulo 3 retorne la cotización, cree la `RateQuote` en estado `ACTIVE`, y detalle la tarifa por noche y los impuestos. Se repite para un check-out incluyendo un `ExtraCharge` válido, comprobando el cálculo del monto final.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Cálculo exitoso de tarifa dinámica para estadía estándar
   - **Dado** una solicitud de cotización con un tipo de habitación válido, rango de fechas coherente (`startDate` a `endDate`) y número de huéspedes
   - **Cuando** el sistema procesa "Calculate Dynamic Rate" en comunicación con el Módulo 3
   - **Entonces** el sistema aplica las tarifas dinámicas vigentes, genera una `RateQuote` en estado `ACTIVE` con el desglose de tarifas e impuestos, y retorna el total recalculado

2. **Escenario**: Cálculo dinámico final para Check-Out con consumos adicionales
   - **Dado** una reserva en estado `CHECKED_IN` con cargos adicionales registrados por la estadía
   - **Cuando** la Recepcionista invoca "Calculate Dynamic Rate" para liquidar la salida del huésped
   - **Entonces** el sistema suma la tarifa diaria dinámica de la habitación más la totalidad de los `ExtraCharge` válidos, emitiendo la `RateQuote` en `ACTIVE` lista para el pago

*Escenarios de Error / Caminos Tristes*

3. **Escenario**: Rechazo controlado por rango de fechas invertido o incoherente
   - **Dado** una solicitud de tarifa dinámica
   - **Cuando** el solicitante envía una fecha de llegada posterior a la fecha de salida (`startDate >= endDate`)
   - **Entonces** el sistema detiene el proceso, no genera la `RateQuote`, y responde con una alerta controlada **HTTP 400 (Bad Request)** señalando la incoherencia de fechas

4. **Escenario**: Notificación controlada por indisponibilidad del servicio de tarifas (Módulo 3)
   - **Dado** una solicitud de cotización o salida de check-out
   - **Cuando** el motor dinámico del Módulo 3 no responde o se encuentra fuera de servicio
   - **Entonces** el sistema no aplica montos a cero ni cotizaciones erróneas, responde con una alerta **HTTP 400 (Bad Request)** indicando que se debe reintentar el cálculo tarifario, e impide la confirmación hasta su restablecimiento

---

### Historia de Usuario 2 - Recálculo Tarifario Diferencial por Modificación de Reserva (Prioridad: P2)

Cuando un solicitante modifica el rango de fechas o el tipo de habitación de una reserva en estado `ACTIVE`, el sistema ejecuta "Calculate Dynamic Rate" para evaluar la nueva tarifa. El sistema compara el monto previo (`previousAmount`) contra el nuevo monto (`newAmount`) y registra la diferencia financiera (`differenceAmount`) en la `RateQuote`.

**Por qué esta prioridad**: Es un flujo alternativo fundamental para la actualización de reservas. Garantiza que el hotel cobre o acredite exactamente la diferencia tarifaria correspondiente según el nuevo rango o categoría elegida.

**Prueba Independiente**: Se toma una reserva `ACTIVE` con un monto previo de \$300 USD y se extiende dos noches adicionales. Se ejecuta "Calculate Dynamic Rate", verificando que la `RateQuote` resultante en estado `ACTIVE` registre `previousAmount` (\$300), `newAmount` (\$500) y `differenceAmount` (\$200 a cobrar), dejando la cotización lista para confirmación.

**Escenarios de Aceptación**:

1. **Escenario**: Recálculo dinámico exitoso con saldo a cobrar por extensión de estadía
   - **Dado** una reserva `ACTIVE` cuya fecha de salida se extiende dos días en temporada alta
   - **Cuando** el solicitante invoca "Calculate Dynamic Rate"
   - **Entonces** el sistema evalúa el nuevo rango de fechas, genera la `RateQuote` en estado `ACTIVE` con el `newAmount` actualizado, y refleja la diferencia a pagar por el huésped en `differenceAmount`

2. **Escenario**: Recálculo dinámico con saldo a favor por reducción de estadía o cambio de categoría
   - **Dado** una reserva `ACTIVE` cuya cantidad de noches se reduce
   - **Cuando** se procesa la cotización dinámica para la modificación
   - **Entonces** el sistema recalcula la tarifa, genera la `RateQuote` registrando la diferencia a favor del huésped en `differenceAmount`, y actualiza el desglose financiero

---

### Historia de Usuario 3 - Evaluación Automática de Reglas Promocionales y Larga Estadía (Prioridad: P3)

El motor dinámico detecta reservaciones con una duración superior a 7 noches consecutivas o pertenecientes a campañas vigentes, aplicando automáticamente descuentos autorizados en el desglose de la tarifa diaria.

**Por qué esta prioridad**: Es una regla de optimización comercial que incrementa la ocupación mediante incentivos de precio, pero no bloquea la cotización estándar de reservas individuales.

**Prueba Independiente**: Se solicita una cotización para una estadía de 10 noches. Se comprueba que el motor dinámico aplique la regla de descuento por larga estadía en la `RateQuote` y reduzca proporcionalmente la tarifa media diaria.

**Escenarios de Aceptación**:

1. **Escenario**: Aplicación de descuento por larga estadía en el cálculo dinámico
   - **Dado** una solicitud de tarifa dinámica para un rango de estadía igual o superior a 7 noches
   - **Cuando** el sistema procesa "Calculate Dynamic Rate"
   - **Entonces** el sistema aplica la deducción por larga estadía sobre el subtotal diario, detallando la bonificación en el desglose de la `RateQuote` en estado `ACTIVE`

2. **Escenario**: Rechazo de tarifa promocional vencida o fuera de temporada
   - **Dado** una solicitud que incluye una regla promocional expirada
   - **Cuando** el motor dinámico valida las fechas de vigencia
   - **Entonces** el sistema descarta la regla vencida, cotiza la estadía con la tarifa estándar vigente, y responde con una nota explicativa en la respuesta

---

### Casos Borde

- **Envío de valores negativos o no numéricos en cargos adicionales**: si durante un check-out se envían consumos adicionales con valores negativos o texto no numérico para ser calculados por la tarifa dinámica, el sistema intercepta la entrada, rechaza el cálculo con un código **HTTP 400 (Bad Request)** amigable, e impide la generación de la `RateQuote` sin provocar fallos **HTTP 500**.
- **Cotización sobre una habitación en estado no disponible o fuera de servicio**: si se intenta cotizar una tarifa dinámica asignando una `roomId` que el Módulo 1 reporta como `OUT_OF_SERVICE`, el sistema rechaza la solicitud con **HTTP 400 (Bad Request)**.
- **Expiración de la vigencia de la cotización (`RateQuote.validUntil`)**: si una cotización en estado `ACTIVE` supera su tiempo de validez sin ser confirmada por el usuario, el sistema cambia automáticamente su estado a `EXPIRED` y exige un nuevo cálculo antes de permitir guardar la reserva.
- **Concurrencia en la recotización de una misma reserva**: si dos usuarios solicitan recotizar la misma reserva simultáneamente, el sistema procesa la última solicitud válida y marca las cotizaciones previas como `SUPERSEDED`.

---

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE permitir a la `Receptionist`, al `Guest` y a la `Ota` invocar el caso de uso "Calculate Dynamic Rate" para obtener cotizaciones tarifarias.
- **FR-002**: El sistema DEBE requerir el tipo de habitación (`roomType`), la fecha de entrada (`startDate`) y la fecha de salida (`endDate`) como parámetros obligatorios de entrada.
- **FR-003**: El sistema DEBE comunicar los parámetros de entrada al **Módulo 3** para evaluar las reglas de tarificación dinámica, estacionalidad y demanda.
- **FR-004**: El sistema DEBE emitir el resultado del cálculo en una entidad `RateQuote` en estado `ACTIVE`.
- **FR-005**: El sistema DEBE asignar un tiempo de vigencia (`validUntil`) a cada `RateQuote` generada.
- **FR-006**: El sistema DEBE sumar los cargos adicionales (`ExtraCharge`) válidos al subtotal de la tarifa diaria durante la liquidación de un check-out.
- **FR-007**: El sistema DEBE calcular el `previousAmount`, `newAmount` y `differenceAmount` en la `RateQuote` cuando el cálculo sea motivado por una actualización de reserva.
- **FR-008**: El sistema DEBE cambiar el estado de una `RateQuote` a `EXPIRED` cuando transcurra su tiempo de vigencia sin confirmación.
- **FR-009**: El sistema DEBE cambiar el estado de una `RateQuote` anterior a `SUPERSEDED` cuando se genere una nueva cotización sobre la misma reserva.
- **FR-010**: El sistema DEBE interceptar cualquier fallo de validación de entrada (fechas incoherentes, valores negativos, parámetros vacíos) y responder con **HTTP 400 (Bad Request)**, prohibiendo fallas de infraestructura **HTTP 500**.
- **FR-011**: El sistema DEBE notificar de forma segura mediante **HTTP 400 (Bad Request)** cuando el servicio dinámico del Módulo 3 no esté disponible, sin aplicar tarifas asumidas.
- **FR-012**: El sistema DEBE mantener un registro auditable de cada cotización emitida, almacenando la fecha de cálculo, la reserva asociada, los desgloses de tarifa e impuestos y el actor responsable.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de procesamiento y generación de la cotización dinámica DEBE ser inferior a 1.5 segundos.
- **NFR-002**: Todos los importes y cálculos tarifarios DEBEN manejarse con precisión decimal exacta para garantizar un 100% de consistencia financiera.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **RateQuote**: Resultado del cálculo tarifario dinámico. Atributos clave: `quoteId` (identificador único), `reservationRef` (referencia a la `Reservation`), `previousAmount`, `newAmount`, `differenceAmount`, `breakdown` (detalle por noche, impuestos y consumos), `validUntil` (expiración), y `status` (`ACTIVE`, `EXPIRED`, `SUPERSEDED`).
- **Reservation**: Reserva asociada. Atributos clave: `reservationRef`, `startDate`, `endDate`, `assignedRoom`, `source`, y `status` (`PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`).
- **ExtraCharge**: Cargos por consumos agregados al cálculo en check-out. Atributos clave: `chargeId`, `description`, `amount`, `registeredAt`.
- **Room**: Unidad física o tipo de habitación. Atributos clave: `roomId`, `roomType`, `status` (`AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`).
- **Guest**: Huésped asociado. Atributos clave: `fullName`, `documentId`, `type` (`NATIONAL` | `FOREIGN`).

---

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de las `RateQuote` generadas en estado `ACTIVE` contienen un desglose tarifario dinámico matemáticamente exacto entre noches, consumos e impuestos.
- **SC-002**: El 100% de las modificaciones de fechas u habitación cuentan con una `RateQuote` en `ACTIVE` con `differenceAmount` calculado antes de su confirmación.
- **SC-003**: Cero errores de servidor **HTTP 500** se producen ante solicitudes con fechas incoherentes o valores no numéricos; el 100% es respondido con **HTTP 400 (Bad Request)**.
- **SC-004**: El tiempo de respuesta de la cotización dinámica es menor a 1.5 segundos en el 98% de las peticiones.
- **SC-005**: El 100% de las cotizaciones no confirmadas que superen su plazo cambian automáticamente su estado a `EXPIRED` para evitar reservas con precios desactualizados.
