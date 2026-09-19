# Feature Specification: Generar Reservación Directa

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

El hotel capta demanda directa por dos frentes: huéspedes que llaman o llegan a recepción y
huéspedes que reservan por su cuenta desde el portal web o la aplicación. El negocio necesita
registrar esas reservas de forma ágil, dejándolas confirmadas de inmediato, sin obligar al
huésped a pasar por una pasarela de pago al momento de reservar: en HOSPITUA el pago del 100% de
la estadía se realiza de forma exclusiva en el Check-Out. Si además cada canal se opera con reglas
distintas o si la disponibilidad se consulta contra sistemas externos, aparecen dos problemas
costosos. El primero es la sobreventa: dos solicitudes pueden tomar el mismo cupo y el hotel se
queda sin habitaciones para honrar una reserva ya confirmada. El segundo es un dato de precio poco
confiable: si el valor del hospedaje no proviene siempre de la misma fuente, o si se mezclan
impuestos que todavía no corresponden, la información que se le entrega al huésped y la auditoría
posterior quedan distorsionadas. El negocio necesita una única lógica de captura de reservas de
canal directo que descuente el inventario por categoría en tiempo real y de forma local, y que
cotice el valor de hospedaje bruto con el área de precios (Módulo 3) de forma puramente
informativa, sin impuestos ni comisiones.

### Flujo de Usuario de Alto Nivel

1. El solicitante (el **Recepcionista** desde el canal de recepción, o el **Huésped** desde el
   portal o la aplicación) indica las fechas de estadía y la categoría de `Habitation` deseada.
2. El sistema consulta la disponibilidad de cupos para esa categoría y ese rango de fechas de
   forma **100% local** en la base de datos de reservas del Módulo 2, sin llamar al Módulo 1.
3. Si hay cupo, el sistema solicita al Módulo 3 el cálculo del valor de hospedaje bruto mediante
   el caso de uso "Calcular tarifa dinámica" y obtiene un `RateQuote`, que se muestra al huésped
   de forma informativa.
4. El solicitante ingresa los datos de identidad del `Guest` titular.
5. El solicitante confirma la reserva; el sistema descuenta un cupo de la categoría y crea la
   `Reservation` directamente en estado `ACTIVE`, sin ningún paso de cobro.

En ambos canales, el sistema guarda el monto devuelto por el Módulo 3 bajo `grossAmount` (valor de
hospedaje bruto, suma de las tarifas dinámicas de todas las noches antes de comisión e impuestos),
con carácter informativo; registra `source` como `DIRECT`, la comisión (`commissionPercentage` y
`commissionAmount`) en `0` y el `externalConfirmationCode` como `null`. No se calcula ni se
almacena IVA en esta etapa: el glosario de HOSPITUA estipula que el IVA se fija e incorpora
únicamente al facturar en el Check-Out. La reserva tampoco asigna un número físico de habitación:
solo asegura un cupo de la categoría, y la `Habitation` real con su `numberHabitation` se asigna
en el Check-In.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Creación de Reservación Directa (Priority: P1)

Un solicitante necesita crear una reserva de canal directo para un rango de fechas y una categoría
de `Habitation`. El proceso es el mismo para los dos canales y ocurre sobre una única interfaz
visual de reserva: se consulta la disponibilidad de cupos de la categoría de forma local en el
Módulo 2, se obtiene el valor de hospedaje bruto del Módulo 3 mediante "Calcular tarifa dinámica"
y se muestra como información al huésped, se capturan los datos del `Guest` titular y se confirma.
Tanto si el origen es el **Recepcionista** como el **Huésped** de autoservicio, la `Reservation`
se crea directamente en estado `ACTIVE`: no hay pasarela de pago ni estado intermedio, porque el
pago del 100% de la estadía ocurre después, en el Check-Out. Por tratarse de un mismo flujo de
negocio, el camino de éxito de ambos canales y los bloqueos lógicos (sin disponibilidad local,
caída del Módulo 3, fechas o datos mal formados, concurrencia por el último cupo) se consolidan en
esta misma historia de usuario y no se modelan como pantallas ni historias separadas, para evitar
la sobre-atomización.

**Why this priority**: Es la funcionalidad nuclear del negocio: sin ella el hotel no puede captar
ventas directas por ningún canal. Al dejar la reserva confirmada en `ACTIVE` sin exigir un cobro
al momento de reservar, el proceso es rápido y sin fricción para el huésped y para el
recepcionista. Al resolver la disponibilidad de forma local y en tiempo real evita la sobreventa,
y al congelar el valor de hospedaje bruto cotizado por el Módulo 3, de forma informativa y sin
impuestos, entrega al huésped un precio confiable y deja el dato limpio para la facturación
posterior en el Check-Out.

**Independent Test**: Se puede probar de forma aislada seleccionando una categoría de `Habitation`
con cupos disponibles para un rango de fechas y simulando la respuesta del Módulo 3 ("Calcular
tarifa dinámica") con un valor de hospedaje bruto válido. Se verifica que la `Reservation` se
persiste directamente en estado `ACTIVE`, con su `RateQuote` asociado de forma informativa,
`grossAmount` asignado, `commissionAmount` en `0`, `externalConfirmationCode` en `null` y `source`
en `DIRECT`, y que el inventario local de la categoría queda descontado en un cupo sin que se
realice ninguna llamada al Módulo 1. La prueba se completa intentando reservar sobre una categoría
sin cupos y simulando una caída del Módulo 3, confirmando que en ambos casos no se crea ninguna
reserva y se devuelve un error controlado.

**Acceptance Scenarios**:

1. **Scenario**: Generación de reserva exitosa por Recepcionista o Huésped (Happy Path)
   - **Given** que existe disponibilidad de cupos para la categoría de habitación seleccionada en
     las fechas solicitadas en la base de datos de reservas del Módulo 2
   - **When** el solicitante ingresa los datos del huésped titular, cotiza el valor de hospedaje
     bruto con el Módulo 3 ("Calcular tarifa dinámica") y confirma la reserva
   - **Then** el sistema descuenta un cupo de la categoría localmente, persiste la `Reservation`
     directamente en estado `ACTIVE` con `grossAmount` asignado, guarda la comisión como `0`, el
     `externalConfirmationCode` como `null`, y asocia el `RateQuote` calculado por el Módulo 3 de
     forma puramente informativa

2. **Scenario**: Intento de reserva directa sin cupos de la categoría seleccionada (Error)
   - **Given** que los cupos para la categoría "Suite Presidencial" están completamente agotados en
     las fechas deseadas en la base de datos local del Módulo 2
   - **When** el solicitante intenta procesar la reserva directa
   - **Then** el sistema bloquea de inmediato la reserva, impide avanzar al paso de cotización y
     arroja un error controlado HTTP 400: "Error 400: No hay cupos disponibles de la categoría
     seleccionada para el rango de fechas solicitado"

3. **Scenario**: Bloqueo de reserva por caída de comunicación con Módulo 3 (Resiliencia - Bloqueo)
   - **Given** que existe disponibilidad local en la categoría de habitación solicitada
   - **When** el sistema intenta cotizar la tarifa y el Módulo 3 no responde (timeout o error de
     red)
   - **Then** el sistema cancela la transacción de forma segura, libera el cupo bloqueado
     preventivamente y devuelve un error de negocio controlado HTTP 400: "Error 400: El servicio de
     cotización de tarifas no se encuentra disponible. Por favor intente más tarde"

### Casos Borde

- ¿Qué sucede si un solicitante intenta reservar con un rango de fechas inválido o incoherente
  (por ejemplo, una fecha de salida anterior a la de llegada, o una fecha inexistente)? El sistema
  intercepta la validación de forma local y responde con un error **HTTP 400 (Bad Request)**
  amigable que indica cómo corregir las fechas, sin llegar a consultar disponibilidad ni a cotizar
  con el Módulo 3.
- ¿Qué sucede si dos clientes intentan reservar el último cupo disponible de la misma categoría de
  forma simultánea? El descuento del inventario de la categoría se realiza dentro de una
  transacción con control de concurrencia a nivel del cupo local en el Módulo 2, de modo que solo
  una de las dos solicitudes obtiene el cupo y se registra en `ACTIVE`; a la segunda en confirmar
  se le responde con un error controlado **HTTP 400** indicando que ya no hay disponibilidad, sin
  producir sobreventa.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir consultar la disponibilidad de cupos por fechas y categoría
  de habitación de forma local en la base de datos del Módulo 2.
- **FR-002**: El sistema debe exigir como requisito obligatorio invocar al Módulo 3 ("Calcular
  tarifa dinámica") para obtener el valor de hospedaje bruto antes de proceder con el registro de
  la reserva.
- **FR-003**: El sistema debe bloquear el flujo de reserva y rechazar el registro de forma
  controlada si la comunicación con el Módulo 3 falla, arrojando un error amigable HTTP 400.
- **FR-004**: El sistema debe crear y almacenar la reserva directamente en estado `ACTIVE` una vez
  confirmada la disponibilidad de cupos de forma local, sin ningún paso de cobro ni estado
  intermedio.
- **FR-005**: El sistema debe registrar obligatoriamente el canal de origen en el atributo
  `source` como `DIRECT`, el atributo `grossAmount` con la tarifa bruta devuelta por el Módulo 3,
  los atributos `commissionPercentage` y `commissionAmount` con valor `0`, y el
  `externalConfirmationCode` como `null`; el sistema no debe calcular ni almacenar ningún monto de
  IVA en esta etapa.
- **FR-006**: El sistema debe interceptar cualquier error de validación de campos, fechas o
  integraciones para responder con códigos de error amigables **HTTP 400 (Bad Request)**,
  prohibiendo explícitamente la propagación de excepciones que deriven en errores de
  infraestructura **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El procesamiento de verificación de cupos por categoría en la base de datos local
  del Módulo 2 debe completarse en un tiempo inferior a 200 milisegundos.

### Key Entities *(include if feature involves data)*

- **Reservation**: Representa el contrato de reserva de canal directo. Atributos: `id`, `guestRef`,
  `categoryHabitation` (categoría de habitación solicitada), `checkInDate`, `checkOutDate`,
  `grossAmount` (valor de hospedaje bruto calculado por el Módulo 3, informativo, sin comisión ni
  IVA), `commissionPercentage` (fijado en `0`), `commissionAmount` (fijado en `0`),
  `externalConfirmationCode` (fijado en `null`), `source` (`DIRECT`), `createdAt`, y `state` con
  estados permitidos en este flujo: `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Se crea
  siempre en `ACTIVE`; este flujo no utiliza el estado `PENDING`.
- **Guest**: Representa al huésped titular de la reserva. Atributos: `id`, `fullName`,
  `documentNumber`, `nationality`, `contactPhone` y `contactEmail`. Los datos de identidad del
  titular son obligatorios antes de cotizar y confirmar.
- **RateQuote**: Representa la cotización del valor de hospedaje bruto calculada por el Módulo 3
  mediante "Calcular tarifa dinámica" y asociada a la reserva con carácter informativo. Atributos:
  `reservationRef`, `grossAmount` (suma de las tarifas dinámicas de todas las noches, antes de
  comisión e impuestos), `currency` y `calculatedAt` (momento del cálculo). Es obligatoria antes
  de confirmar cualquier reserva.
- **Habitation**: Representa la habitación física, cuya gestión de estado es propiedad del
  Módulo 1. En este flujo solo se referencia su categoría para descontar el cupo local; no se
  realiza ninguna llamada al Módulo 1 ni se asigna un número físico. Atributos: `habitationId`,
  `numberHabitation` y `stateHabitation` con estados físicos permitidos: `AVAILABLE`, `OCCUPIED`,
  `CLEANING`, `OUT_OF_SERVICE`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El Huésped o el Recepcionista es capaz de completar una reserva de canal directo en
  menos de 1 minuto, al no requerir transacciones de pago en esta etapa.
- **SC-002**: El 100% de las reservas directas registradas cuentan con un valor de comisión de
  `0`, un código de confirmación externo nulo y el valor de hospedaje bruto almacenado
  correctamente.
- **SC-003**: Cero sobreventas de categorías de habitación ocurren en el hotel; el sistema bloquea
  estrictamente las transacciones si no hay cupos locales en la base de datos del Módulo 2 antes
  de la confirmación.
