# Feature Specification: Generar Reservación Directa

**Created**: 2026-09-23

## Use Case (Caso de Uso)

### Descripción del problema

El hotel capta demanda directa cuando los huéspedes llaman o llegan a recepción y la Recepcionista
registra su reserva. El negocio necesita
registrar esas reservas de forma ágil, dejándolas confirmadas de inmediato, sin obligar al huésped
a pasar por una pasarela de pago al momento de reservar: en HOSPITUA el pago del 100% de la estadía
se realiza de forma exclusiva en el Check-Out, un proceso presencial que ejecuta el Módulo 1. Si
además la disponibilidad no se valida contra el
calendario real de la habitación, aparecen dos problemas costosos. El primero es la sobreventa: dos
solicitudes pueden tomar la misma habitación o una que estará en mantenimiento. El segundo es un
dato de precio poco confiable: si el valor del hospedaje no proviene siempre de la misma fuente, la
información que se le entrega al huésped queda distorsionada. El negocio necesita una única lógica
de captura de reservas de canal directo que valide la disponibilidad antes de reservar, cotice el
valor de hospedaje bruto con el área de precios (Módulo 3) de forma informativa, y avise al Módulo 1
para apartar la habitación.

### Flujo de Usuario de Alto Nivel

1. La **Recepcionista** indica las fechas de estadía y la habitación o categoría de `Room`
   deseada.
2. El sistema ejecuta "Verificar disponibilidades": cruza las fechas contra las reservas locales del
   Módulo 2 y consulta al Módulo 1 el calendario de mantenimientos y el inventario en tiempo real.
3. Si la habitación está disponible, el sistema solicita al Módulo 3 el cálculo del valor de
   hospedaje bruto mediante "Calcular tarifa dinámica" y obtiene un `RateQuote`, que se muestra al
   huésped de forma informativa.
4. El solicitante ingresa los datos de identidad del `Guest` titular y confirma la reserva.
5. El sistema crea la `Reservation` directamente en estado `ACTIVE`, sin ningún paso de cobro.
6. El sistema ejecuta "Establecer estado de habitación" para ordenar al Módulo 1 marcar la `Room`
   como `RESERVED`, adjuntando el detalle de la reserva.
7. El sistema responde 201 (Created) con la reserva creada, indicando si la sincronización con el
   Módulo 1 quedó pendiente (`roomSyncStatus`).

El sistema guarda el monto devuelto por el Módulo 3 bajo `grossAmount` (valor de hospedaje bruto,
suma de las tarifas dinámicas de todas las noches, antes de comisión e impuestos), con carácter
informativo; registra `source` como `DIRECT`, la comisión (`commissionPercentage` y
`commissionAmount`) en `0` y el `externalConfirmationCode` como `null`. No se calcula ni se almacena
IVA en esta etapa: se fija al facturar en el Check-Out.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Creación de Reservación Directa (Priority: P1)

La Recepcionista necesita crear, a pedido del huésped, una reserva de canal directo para un rango de
fechas y una habitación. El proceso ocurre sobre una única interfaz: se verifica la
disponibilidad, se obtiene el valor de hospedaje bruto del Módulo 3 y se muestra como información,
se capturan los datos del `Guest` titular y se confirma. La `Reservation` se crea directamente en
estado `ACTIVE` y se
notifica al Módulo 1 para apartar la habitación. Por tratarse de un mismo flujo de negocio, el
camino de éxito y los bloqueos lógicos (sin disponibilidad, caída del Módulo 3,
fechas o datos mal formados, concurrencia por la última habitación) se consolidan en esta misma
historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Es la funcionalidad nuclear del negocio: sin ella el hotel no puede captar
ventas directas. Dejar la reserva confirmada en `ACTIVE` sin exigir cobro hace el proceso rápido y
sin fricción; validar la disponibilidad contra el Módulo 1 evita la sobreventa; y congelar el valor
bruto cotizado por el Módulo 3, sin impuestos, entrega al huésped un precio confiable.

**Independent Test**: Se puede probar seleccionando una habitación disponible para un rango de
fechas y simulando la respuesta del Módulo 3 con un valor bruto válido. Se verifica que la
`Reservation` se persiste en `ACTIVE` con `grossAmount` asignado, `commissionAmount` en `0`,
`externalConfirmationCode` en `null` y `source` en `DIRECT`, y que se emite al Módulo 1 la orden
`RESERVED` con el detalle de la reserva. La prueba se completa intentando reservar una habitación
no disponible y simulando una caída del Módulo 3, confirmando que en ambos casos no se crea ninguna
reserva y se devuelve un error controlado.

**Acceptance Scenarios**:

1. **Scenario**: Generación de reserva exitosa por la Recepcionista (Happy Path)
   - **Given** que la `Room` solicitada está disponible en las fechas indicadas según "Verificar
     disponibilidades"
   - **When** la Recepcionista ingresa los datos del huésped titular, cotiza el valor bruto con el
     Módulo 3 y confirma la reserva
   - **Then** el sistema persiste la `Reservation` directamente en `ACTIVE` con `grossAmount`
     asignado, comisión `0` y `externalConfirmationCode` `null`, asocia el `RateQuote` de forma
     informativa, y ordena al Módulo 1 marcar la `Room` como `RESERVED` con el detalle de la reserva

2. **Scenario**: Intento de reserva sobre una habitación no disponible (Error)
   - **Given** que la `Room` tiene un mantenimiento programado o una reserva cruzada en las fechas
     deseadas
   - **When** el solicitante intenta procesar la reserva directa
   - **Then** el sistema bloquea la reserva, impide avanzar a la cotización y arroja un error
     controlado HTTP 400: "Error 400: La habitación no está disponible para el rango de fechas
     solicitado"

3. **Scenario**: Bloqueo de reserva por caída de comunicación con Módulo 3 (Error)
   - **Given** que la habitación está disponible
   - **When** el sistema intenta cotizar la tarifa y el Módulo 3 no responde (timeout o error de
     red)
   - **Then** el sistema cancela la transacción de forma segura y devuelve un error controlado HTTP
     400: "Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor
     intente más tarde"

### Casos Borde

- ¿Qué sucede si un solicitante intenta reservar con un rango de fechas inválido o incoherente (por
  ejemplo, una fecha de salida anterior a la de llegada, o una fecha inexistente)? El sistema
  intercepta la validación de forma local y responde con un error **HTTP 400 (Bad Request)**
  amigable, sin llegar a consultar disponibilidad ni a cotizar con el Módulo 3.
- ¿Qué sucede si dos clientes intentan reservar la misma habitación de forma simultánea? La creación
  se realiza dentro de una transacción con control de concurrencia, de modo que solo una de las dos
  solicitudes se registra en `ACTIVE`; a la segunda se le responde con **HTTP 400** indicando que ya
  no hay disponibilidad, sin producir sobreventa.
- ¿Qué sucede si la reserva se crea pero el Módulo 1 no responde a la orden `RESERVED`? La reserva
  permanece registrada en `ACTIVE` con `roomSyncStatus` `PENDING`, la orden se reintenta en segundo
  plano y el sistema responde **201 (Created)** con esa advertencia. No responde 400, porque la
  reserva sí existe y un reintento del consumidor la duplicaría.
- ¿Qué sucede si el Módulo 1 rechaza la orden `RESERVED` porque la `Room` ya está `OCCUPIED`? El
  sistema compensa: cancela la reserva recién creada mediante "Actualizar reservación" con el motivo
  `ROOM_REJECTED`, y responde **HTTP 400** indicando que la habitación ya no está disponible. Como
  no queda ninguna reserva, el consumidor puede reintentar con seguridad.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe verificar la disponibilidad de la `Room` mediante "Verificar
  disponibilidades" antes de cotizar o registrar cualquier reserva.
- **FR-002**: El sistema debe exigir como requisito obligatorio invocar al Módulo 3 ("Calcular
  tarifa dinámica") para obtener el valor de hospedaje bruto antes de registrar la reserva.
- **FR-003**: El sistema debe bloquear el flujo y rechazar el registro de forma controlada si la
  comunicación con el Módulo 3 falla, arrojando un error amigable HTTP 400.
- **FR-004**: El sistema debe crear y almacenar la reserva directamente en estado `ACTIVE`, sin
  ningún paso de cobro ni estado intermedio.
- **FR-005**: El sistema debe registrar `source` como `DIRECT`, `grossAmount` con la tarifa bruta
  devuelta por el Módulo 3, `commissionPercentage` y `commissionAmount` con valor `0` y
  `externalConfirmationCode` como `null`; no debe calcular ni almacenar IVA en esta etapa.
- **FR-006**: El sistema debe ordenar al Módulo 1, mediante "Establecer estado de habitación",
  marcar la `Room` como `RESERVED` con el detalle de la reserva. Si la orden falla por comunicación,
  debe conservar la reserva con `roomSyncStatus` `PENDING`, reintentar y responder 201 (Created) con
  la advertencia.
- **FR-007**: El sistema debe compensar el rechazo explícito del Módulo 1 (`Room` ya `OCCUPIED`)
  cancelando la reserva creada con el motivo `ROOM_REJECTED` y respondiendo **HTTP 400**.
- **FR-008**: El sistema debe interceptar cualquier error de validación de campos, fechas o
  integraciones y responder con **HTTP 400 (Bad Request)**, prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El procesamiento de la verificación local de reservas cruzadas debe completarse en
  menos de 200 milisegundos.

### Key Entities *(include if feature involves data)*

- **Reservation**: Contrato de reserva de canal directo. Atributos: `id`, `guestRef`, `roomId`,
  `categoryRoom`, `startDate`, `endDate`, `grossAmount` (valor bruto calculado por el Módulo 3,
  informativo), `commissionPercentage` (`0`), `commissionAmount` (`0`), `externalConfirmationCode`
  (`null`), `source` (`DIRECT`), `createdAt`, `roomSyncStatus` (`SYNCED` | `PENDING`, estado de la
  orden `RESERVED` al Módulo 1), y `status` con estados permitidos:
  `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. En este flujo se crea
  siempre en `ACTIVE`.
- **Guest**: Huésped titular. Atributos: `id`, `fullName`, `documentNumber`, `nationality`,
  `contactPhone`, `contactEmail`.
- **RateQuote**: Cotización del valor bruto calculada por el Módulo 3, con carácter informativo.
  Atributos: `reservationRef`, `grossAmount`, `currency`, `calculatedAt`.
- **Room**: Habitación física, cuyo estado es propiedad del Módulo 1. Atributos: `roomId`,
  `numberRoom`, `categoryRoom` y `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La Recepcionista completa una reserva de canal directo en menos de 1
  minuto, al no requerir transacciones de pago en esta etapa.
- **SC-002**: El 100% de las reservas directas cuentan con comisión `0`, código de confirmación
  externo nulo y valor bruto almacenado correctamente.
- **SC-003**: Cero sobreventas de habitaciones; el sistema bloquea las transacciones sobre una
  habitación no disponible antes de confirmar.
- **SC-004**: El 100% de las reservas creadas generan la orden `RESERVED` hacia el Módulo 1.
