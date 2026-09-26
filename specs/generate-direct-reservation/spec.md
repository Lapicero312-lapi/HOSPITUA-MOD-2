# Feature Specification: Generar Reservación Directa

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

El hotel capta demanda directa cuando los huéspedes llaman, escriben por el portal web o llegan a
recepción y la Recepcionista registra su reserva. El negocio necesita registrar esas reservas de
forma ágil, dejándolas confirmadas de inmediato, sin obligar al huésped a pasar por una pasarela de
pago al momento de reservar: en HOSPITUA el pago del 100% de la estadía se realiza de forma
exclusiva en el Check-Out, un proceso presencial que ejecuta el Módulo 1.

Durante la etapa de reserva no se asigna ningún `numberRoom` ni `roomId` físico: esa asignación
ocurre únicamente en el Check-In, dentro del Módulo 1 / Front Desk. Por lo tanto, la reserva se
registra siempre bajo una `categoryRoom`, y su confirmación descuenta de inmediato un cupo del
aforo lógico de esa categoría, calculado 100% de forma local dentro del Módulo 2 mediante "Verificar
disponibilidades". Queda estrictamente prohibido que este flujo invoque al Módulo 1 para marcar
ningún cuarto como apartado, porque el Módulo 1 no administra ni conoce ningún concepto de reserva:
solo informa el estado físico real de sus habitaciones y solo participa de forma activa cuando el
huésped se presenta al Check-In.

Si además el valor del hospedaje no proviene siempre de la misma fuente, la información que se le
entrega al huésped queda distorsionada. El negocio necesita una única lógica de captura de reservas
de canal directo que valide el aforo lógico local antes de reservar, y cotice el valor de hospedaje
bruto con el área de precios (Módulo 3) de forma informativa, sin ningún cobro ni integración hacia
el Módulo 1.

### Flujo de Usuario de Alto Nivel

1. La Recepcionista o el Huésped selecciona la `categoryRoom`, el `checkInDate` y el `checkOutDate`
   deseados.
2. El sistema ejecuta internamente "Verificar disponibilidades" sobre la `categoryRoom` solicitada,
   validando el aforo lógico local del Módulo 2.
3. Si existe cupo disponible, el sistema invoca síncronamente al Módulo 3 ("Calcular tarifa
   dinámica") y obtiene el `grossAmount` de carácter informativo.
4. El solicitante ingresa los datos de identidad del `Guest` titular y confirma la reserva.
5. El sistema persiste la `Reservation` localmente en estado `ACTIVE` (`source`: `DIRECT`,
   `commissionPercentage` y `commissionAmount` en `0`, `externalConfirmationCode` en `null`),
   descontando de inmediato un cupo del aforo lógico local de la `categoryRoom`.
6. El sistema responde con **HTTP 201 (Created)** junto con la reserva confirmada, sin realizar
   ninguna llamada hacia el Módulo 1.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Creación de Reservación Directa (Priority: P1)

**Plain Language**: Registro ágil y gratuito de reservas de canal directo, confirmadas de inmediato
en `ACTIVE` contra el aforo lógico local de una `categoryRoom`, con cotización informativa del
Módulo 3 y sin ninguna llamada de modificación hacia el Módulo 1.

La Recepcionista o el Huésped necesitan crear una reserva de canal directo para un rango de fechas y
una `categoryRoom`. El proceso ocurre sobre una única interfaz: se verifica el aforo lógico local, se
obtiene el valor de hospedaje bruto del Módulo 3 y se muestra como información, se capturan los
datos del `Guest` titular y se confirma. La `Reservation` se crea directamente en estado `ACTIVE`,
descontando el cupo de aforo local, sin ninguna orden hacia el Módulo 1. Por tratarse de un mismo
flujo de negocio, el camino de éxito y los bloqueos lógicos (sin aforo disponible, caída del Módulo
3, fechas o datos mal formados, concurrencia por el último cupo) se consolidan en esta misma
historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Es la funcionalidad nuclear del negocio: sin ella el hotel no puede captar
ventas directas. Dejar la reserva confirmada en `ACTIVE` sin exigir cobro hace el proceso rápido y
sin fricción; validar el aforo lógico local evita la sobreventa de cupo sin acoplar la creación de la
reserva a la disponibilidad ni a la respuesta del Módulo 1; y congelar el valor bruto cotizado por el
Módulo 3, sin impuestos, entrega al huésped un precio confiable.

**Independent Test**: Se registra una reserva directa para una `categoryRoom` con cupo disponible,
simulando la respuesta del Módulo 3 con un valor bruto válido, y se verifica que la `Reservation` se
persiste en `ACTIVE` con `grossAmount` asignado, `commissionAmount` en `0`,
`externalConfirmationCode` en `null`, `source` en `DIRECT`, y que el aforo lógico local de la
`categoryRoom` se descuenta en 1, sin registrar ninguna llamada hacia el Módulo 1. La prueba se
completa intentando reservar una `categoryRoom` sin cupo disponible y simulando una caída del Módulo
3, confirmando que en ambos casos no se crea ninguna reserva y se devuelve un error controlado.

**Acceptance Scenarios**:

1. **Escenario 1**: Creación exitosa de reserva directa (Happy Path)

   ```gherkin
   Given una categoryRoom con cupo de aforo lógico disponible según "Verificar disponibilidades" para el rango solicitado
   When el solicitante ingresa los datos del Guest titular, cotiza el grossAmount con el Módulo 3 y confirma la reserva
   Then el sistema persiste la Reservation directamente en state ACTIVE con source DIRECT, comisión 0 y externalConfirmationCode null
   And descuenta de inmediato un cupo del aforo lógico local de la categoryRoom
   And responde HTTP 201 (Created) sin emitir ninguna llamada hacia el Módulo 1
   ```

2. **Escenario 2**: Bloqueo por falta de aforo en la `categoryRoom` solicitada (Error)

   ```gherkin
   Given una categoryRoom cuyo aforo lógico local está agotado para el rango de fechas solicitado
   When el solicitante intenta procesar la reserva directa
   Then el sistema bloquea la reserva antes de cotizar con el Módulo 3
   And responde con un error controlado HTTP 400 (Bad Request) indicando que no hay cupo disponible en la categoryRoom
   ```

3. **Escenario 3**: Bloqueo por falla de comunicación o timeout con el Módulo 3 (Error)

   ```gherkin
   Given una categoryRoom con cupo de aforo disponible
   When el sistema intenta cotizar la tarifa y el Módulo 3 no responde o agota el tiempo de espera
   Then el sistema cancela la transacción de forma segura sin persistir ninguna Reservation
   And responde con un error controlado HTTP 400 (Bad Request) indicando que el servicio de cotización de tarifas no está disponible
   ```

4. **Escenario 4**: Intento de reserva con fechas o datos del `Guest` inválidos (Error)

   ```gherkin
   Given una solicitud de reserva directa con un rango de fechas incoherente o con datos del Guest incompletos o mal formados
   When el solicitante intenta procesar la reserva
   Then el sistema intercepta la validación localmente antes de consultar el aforo o cotizar con el Módulo 3
   And responde con un error controlado HTTP 400 (Bad Request)
   ```

## 3. Casos Borde

- **Caso Borde 1**: Rango de fechas incoherente. Si el `checkOutDate` es anterior o igual al
  `checkInDate`, el sistema responde con un error controlado **HTTP 400 (Bad Request)**, sin
  consultar el aforo ni el Módulo 3.
- **Caso Borde 2**: Concurrencia por el último cupo del aforo. Si dos solicitudes intentan tomar el
  último cupo disponible de la misma `categoryRoom` de forma simultánea, el sistema aplica control
  de concurrencia optimista mediante el atributo `version` de `Reservation`, de modo que solo una de
  las dos solicitudes se confirma en `ACTIVE`; a la segunda se le responde con **HTTP 400**
  indicando que ya no hay cupo disponible, sin producir sobreventa.
- **Caso Borde 3**: Caída del Módulo 3 durante la cotización. El sistema cancela la transacción de
  forma limpia, sin persistir ninguna `Reservation` parcial, y responde con **HTTP 400 (Bad
  Request)**.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe validar el aforo lógico local disponible de la `categoryRoom`
  mediante "Verificar disponibilidades" antes de proceder con la cotización o el registro.
- **FR-002**: El sistema debe invocar obligatoriamente al Módulo 3 ("Calcular tarifa dinámica") para
  congelar el `grossAmount` de carácter informativo, antes de registrar la reserva.
- **FR-003**: El sistema debe persistir la reserva localmente en estado `ACTIVE`, con `source`
  `DIRECT`, `commissionPercentage` y `commissionAmount` en `0`, y `externalConfirmationCode` en
  `null`; no debe calcular ni almacenar IVA en esta etapa.
- **FR-004**: Queda estrictamente prohibido que el sistema realice cualquier llamada de
  modificación de estado hacia el Módulo 1 (incluyendo el caso de uso "Establecer estado de
  habitación") durante este proceso.
- **FR-005**: El sistema debe registrar los datos completos del titular en `Guest`.
- **FR-006**: El sistema debe descontar de inmediato un cupo del aforo lógico de la `categoryRoom`
  en la base de datos local del Módulo 2, al confirmarse la reserva.
- **FR-007**: El sistema debe interceptar cualquier fallo de validación o de integración con el
  Módulo 3, y responder obligatoriamente con **HTTP 400 (Bad Request)**, quedando estrictamente
  prohibida la propagación de excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de respuesta total del proceso, incluyendo la verificación de aforo local y
  la cotización del Módulo 3, debe ser inferior a 1.5 segundos.
- **NFR-002**: La creación de la reserva y el descuento del cupo de aforo deben ejecutarse dentro de
  una transacción atómica local, de modo que ninguna reserva quede persistida sin su
  correspondiente descuento de aforo, ni viceversa.

## 5. Entidades Clave

- **Reservation**: Contrato de reserva de canal directo. Atributos: `id`, `guestRef`,
  `categoryRoom`, `checkInDate`, `checkOutDate`, `grossAmount` (valor bruto calculado por el Módulo
  3, informativo), `commissionPercentage` (`0`), `commissionAmount` (`0`),
  `externalConfirmationCode` (`null`), `source` (`DIRECT`), `version` (control de concurrencia
  optimista) y `state` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`). En
  este flujo se crea siempre en `ACTIVE`.
- **Guest**: Huésped titular. Atributos: `id`, `fullName`, `documentNumber`, `documentType`,
  `email`, `phone` y `nationality`.
- **Room**: Concepto de categoría de habitación (`categoryRoom`) y su cupo de aforo lógico local,
  administrado dentro del Módulo 2. No representa aquí ninguna habitación física individual, ya que
  el `numberRoom` y el `roomId` no se asignan sino hasta el Check-In, dentro del Módulo 1.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las reservas directas confirmadas quedan en estado `ACTIVE` con comisión
  `0` y `grossAmount` congelado.
- **SC-002**: Cero llamadas de modificación de estado realizadas hacia el Módulo 1 durante todo el
  proceso de creación de la reserva.
- **SC-003**: Cero sobreventas de cupo; el sistema bloquea la creación de reservas cuando el aforo
  lógico local de la `categoryRoom` se agota.
- **SC-004**: El 100% de las fallas de integración con el Módulo 3 o de validación de datos se
  responden con **HTTP 400**, con cero excepciones **HTTP 500**.
