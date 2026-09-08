# Feature Specification: Calcular Tarifa Dinámica

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Antes de confirmar una reserva de canal directo, o de recalcular su valor cuando el Módulo 3
regulariza una liquidación o el solicitante modifica fechas o categoría, el hotel necesita saber
cuánto vale exactamente el hospedaje. Si esa tarifa se calcula de manera manual o con reglas
distintas según quién la pida, el huésped recibe información inconsistente y el hotel arriesga
vender por debajo de la demanda real o por encima del mercado. El negocio necesita un único motor
de tarificación dinámica, con reglas de temporada, ocupación y anticipación, que devuelva siempre
el mismo `grossAmount` para las mismas condiciones de categoría y fechas, y que sea reutilizable
tanto por la creación de reservas directas como por los procesos internos del Módulo 3 que
necesitan una re-cotización.

### Flujo de Usuario de Alto Nivel

1. Un proceso solicitante interno del Módulo 3 (la creación de una reserva directa, o "Procesar
   liquidación y validación" durante una actualización o un Check-In) invoca "Calcular tarifa
   dinámica" enviando la categoría de `Habitation`, las fechas de estadía (`startDate` y
   `endDate`) y, si aplica, el `grossAmount` previo de la reserva.
2. El motor evalúa las reglas de temporada, nivel de ocupación del hotel y anticipación de la
   solicitud vigentes para esas fechas y esa categoría.
3. Si la estadía califica para una regla promocional o de larga estadía (siete noches o más), el
   motor aplica la deducción correspondiente sobre el subtotal.
4. El sistema emite el resultado en la entidad `RateQuote`, con el `grossAmount` calculado y, si la
   solicitud incluía un monto previo, el `amountDifference` resultante.
5. Si el rango de fechas es incoherente o el proceso interno de tarificación no está disponible, el
   sistema bloquea el cálculo y responde con un error de negocio controlado **HTTP 400 (Bad
   Request)**, sin asumir montos por defecto.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cálculo Síncrono de Tarifa Dinámica (Priority: P1)

Un proceso interno del Módulo 3 solicita calcular el valor de hospedaje bruto exacto para una
categoría de `Habitation` y un rango de fechas determinado. El sistema analiza las fechas, la
categoría, el nivel de ocupación y las reglas de temporada vigentes, y retorna una `RateQuote` con
el desglose detallado del importe. Esta historia es el flujo maestro (Happy Path).

**Why this priority**: Es la funcionalidad central que determina el valor de venta del inventario.
Sin ella no se puede cotizar una reserva directa nueva ni recalcular una tarifa cuando cambian las
condiciones de una estadía.

**Independent Test**: Se prueba enviando los datos de una estadía de tres noches en temporada media
para una categoría estándar. Se verifica que el motor retorne la `RateQuote` con el `grossAmount`
correcto y el desglose por noche. Se repite enviando una fecha de llegada posterior a la de salida,
confirmando el rechazo controlado.

**Acceptance Scenarios**:

1. **Scenario**: Cálculo exitoso de tarifa dinámica para una estadía estándar (Happy Path)
   - **Given** una solicitud de cotización con una categoría de `Habitation` válida y un rango de
     fechas coherente (`startDate` anterior a `endDate`)
   - **When** el proceso solicitante invoca "Calcular tarifa dinámica"
   - **Then** el sistema aplica las reglas de temporada y ocupación vigentes, genera una
     `RateQuote` con el desglose por noche, y retorna el `grossAmount` calculado

2. **Scenario**: Rechazo controlado por rango de fechas incoherente (Error)
   - **Given** una solicitud de tarifa dinámica
   - **When** el solicitante envía una fecha de llegada igual o posterior a la fecha de salida
   - **Then** el sistema detiene el proceso, no genera la `RateQuote`, y responde con **HTTP 400
     (Bad Request)** señalando la incoherencia de fechas

---

### User Story 2 - Evaluación de Reglas Promocionales y de Larga Estadía (Priority: P3)

El motor dinámico detecta estadías con una duración igual o superior a siete noches consecutivas y
aplica automáticamente la deducción autorizada sobre el subtotal de la tarifa diaria antes de
emitir la `RateQuote`.

**Why this priority**: Es una regla de optimización comercial que incrementa la ocupación mediante
incentivos de precio, pero no es indispensable para el cálculo estándar de una cotización.

**Independent Test**: Se solicita una cotización para una estadía de diez noches y se comprueba que
el motor aplique la deducción por larga estadía en el desglose de la `RateQuote`.

**Acceptance Scenarios**:

1. **Scenario**: Aplicación de descuento por larga estadía
   - **Given** una solicitud de tarifa dinámica para un rango de estadía igual o superior a siete
     noches
   - **When** el sistema procesa "Calcular tarifa dinámica"
   - **Then** el sistema aplica la deducción por larga estadía sobre el subtotal diario, detallando
     la bonificación en el desglose de la `RateQuote`

2. **Scenario**: Rechazo de regla promocional vencida (Error)
   - **Given** una solicitud que referencia una regla promocional expirada
   - **When** el motor dinámico valida las fechas de vigencia
   - **Then** el sistema descarta la regla vencida y cotiza la estadía con la tarifa estándar
     vigente, sin bloquear el cálculo

### Casos Borde

- ¿Qué sucede si el proceso interno de tarificación del Módulo 3 no responde o falla al ser
  consultado? El sistema no asume montos a cero ni cotizaciones erróneas; responde con **HTTP 400
  (Bad Request)** indicando que debe reintentarse el cálculo tarifario, e impide la confirmación de
  la reserva o del recálculo hasta su restablecimiento.
- ¿Qué sucede si se solicita cotizar una categoría de `Habitation` inexistente? El sistema
  intercepta la validación y responde con **HTTP 400** indicando que la categoría no existe.
- ¿Cómo maneja el sistema una solicitud de recálculo que no incluye un `grossAmount` previo? El
  sistema calcula el `grossAmount` normalmente y omite el atributo `amountDifference` en la
  `RateQuote` resultante, sin bloquear el cálculo.
- ¿Debe el motor de tarifa dinámica verificar el estado físico de una habitación individual
  (`stateHabitation`) antes de cotizar? No: el Módulo 3 solo recibe la `categoryHabitation`
  solicitada y las fechas de estadía; la cotización se calcula sobre categorías lógicas de
  habitación, no sobre cuartos físicos concretos. Validar si existe cupo disponible de aforo para
  esa categoría y esas fechas es responsabilidad exclusiva y local del Módulo 2, antes de invocar
  este caso de uso; el motor de tarifas nunca bloquea un cálculo de precios por el estado de
  limpieza o mantenimiento de una habitación puntual.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe requerir la categoría de `Habitation`, la fecha de entrada
  (`startDate`) y la fecha de salida (`endDate`) como parámetros obligatorios de entrada.
- **FR-002**: El sistema debe evaluar las reglas de tarificación dinámica, estacionalidad, demanda
  y anticipación vigentes para la categoría y fechas recibidas.
- **FR-003**: El sistema debe emitir el resultado del cálculo en una entidad `RateQuote` con el
  `grossAmount` calculado y su `currency`.
- **FR-004**: El sistema debe calcular el `amountDifference` en la `RateQuote` cuando la solicitud
  incluya un `previousGrossAmount` de referencia.
- **FR-005**: El sistema debe aplicar automáticamente la deducción por larga estadía cuando el
  rango de fechas solicitado sea igual o superior a siete noches.
- **FR-006**: El sistema debe descartar cualquier regla promocional cuya vigencia haya expirado,
  cotizando la estadía con la tarifa estándar sin bloquear el cálculo.
- **FR-007**: El sistema debe interceptar cualquier fallo de validación de entrada (fechas
  incoherentes, categoría inexistente) y responder con **HTTP 400 (Bad Request)**, prohibiendo
  fallas de infraestructura **HTTP 500**.
- **FR-008**: El sistema debe notificar de forma segura mediante **HTTP 400 (Bad Request)** cuando
  el proceso interno de tarificación no esté disponible, sin aplicar tarifas asumidas.

### Non-Functional Requirements

- **NFR-001**: El tiempo de procesamiento y generación de la cotización dinámica debe ser inferior
  a 1.5 segundos.
- **NFR-002**: Todos los importes y cálculos tarifarios deben manejarse con precisión decimal exacta
  para garantizar consistencia financiera.

### Key Entities *(include if feature involves data)*

- **RateQuote**: Resultado del cálculo tarifario dinámico. Atributos: `reservationRef`,
  `previousGrossAmount` (monto de referencia previo, solo en recálculos), `grossAmount` (valor de
  hospedaje bruto calculado), `amountDifference` (diferencia respecto al monto previo, solo en
  recálculos), `currency`, y `calculatedAt` (momento del cálculo).
- **Habitation**: Se referencia únicamente por su categoría para el cálculo; no se realiza ninguna
  llamada al Módulo 1. Atributos relevantes: `categoryHabitation`.
- **Reservation**: Reserva asociada a la cotización, si existe. Atributos: `reservationRef`,
  `categoryHabitation`, `startDate`, `endDate`, y `state` con estados permitidos: `PENDING`,
  `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las `RateQuote` generadas contienen un `grossAmount` matemáticamente
  exacto y trazable a las reglas de temporada y ocupación aplicadas.
- **SC-002**: Cero errores de servidor **HTTP 500** se producen ante solicitudes con fechas
  incoherentes; el 100% se responde con **HTTP 400 (Bad Request)**.
- **SC-003**: El tiempo de respuesta de la cotización dinámica es menor a 1.5 segundos en el 98% de
  las peticiones.
