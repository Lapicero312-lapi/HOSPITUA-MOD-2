# Feature Specification: Consultar Calendario de Mantenimientos

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Una categoría de habitación (`categoryRoom`) puede tener cupo de aforo disponible hoy y, aun así, no
poder reservarse para unas fechas futuras porque el hotel programó reparaciones o mantenimientos
sobre varias de sus habitaciones. Esa programación pertenece al Módulo 1, que es quien administra el
hotel en persona. Como en la etapa de reserva no existe un `numberRoom` físico individual asignado
al huésped —esa asignación ocurre únicamente en el Check-In, dentro del Módulo 1—, esta consulta no
se resuelve sobre una habitación puntual, sino sobre el conjunto de habitaciones inhabilitadas
dentro de una `categoryRoom` para un rango de fechas determinado.

Si el Módulo 2 aceptara reservas sin consultar esta información, el hotel terminaría comprometiendo
cupo de aforo sobre habitaciones que estarán inhabilitadas, y tendría que reubicar o cancelar
reservas en el último momento. El negocio necesita una consulta de solo lectura al calendario de
mantenimientos del Módulo 1, que el caso de uso "Verificar disponibilidades" invoque antes de
confirmar cualquier reserva, para descontar del aforo total de la `categoryRoom` la cantidad exacta
de habitaciones inhabilitadas en ese periodo.

### Flujo de Usuario de Alto Nivel

1. El caso de uso "Verificar disponibilidades" invoca "Consultar calendario de mantenimientos"
   enviando la `categoryRoom`, el `startDate` y el `endDate` de la estadía solicitada.
2. El sistema realiza una consulta síncrona al API del Módulo 1.
3. El Módulo 1 retorna la cantidad de habitaciones inhabilitadas, o la lista de mantenimientos
   programados, para esa `categoryRoom` dentro de ese periodo.
4. El Módulo 2 resta la cantidad de habitaciones inhabilitadas del aforo total de la `categoryRoom`.
5. Si ocurre una falla de red, un timeout o los datos de entrada son inválidos, el sistema interrumpe
   la validación de disponibilidad y responde con un error controlado **HTTP 400 (Bad Request)**.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Consulta de Mantenimientos por Categoría (Priority: P1)

**Plain Language**: Consulta de solo lectura al Módulo 1 que determina, para una `categoryRoom` y un
rango de fechas, cuántas habitaciones estarán inhabilitadas por mantenimiento, a fin de descontar
esa cantidad del aforo total antes de confirmar una reserva.

Antes de confirmar una reserva, el sistema consulta el calendario de mantenimientos del Módulo 1
para la `categoryRoom` y las fechas solicitadas, y determina cuántas habitaciones de esa categoría
estarán inhabilitadas. Por tratarse de una única consulta de lectura, el camino sin mantenimientos,
el bloqueo por habitaciones inhabilitadas, el caso de mantenimientos contiguos que no cruzan la
estadía y los fallos de integración con el Módulo 1 se consolidan en esta misma historia de usuario,
para evitar la sobre-atomización.

**Why this priority**: Evita que el hotel comprometa cupo de aforo de una `categoryRoom` cuyas
habitaciones estarán en reparación durante la estadía, protegiendo la experiencia del huésped y
evitando reubicaciones o cancelaciones de último momento.

**Independent Test**: Se consulta una `categoryRoom` sin mantenimientos programados en el rango y se
verifica que se informe cero habitaciones inhabilitadas; se consulta otra `categoryRoom` con
habitaciones bloqueadas por mantenimiento que se solapan con el rango y se verifica que se informe
la cantidad exacta inhabilitada; se consulta un mantenimiento contiguo que finaliza justo antes del
`checkInDate` y se verifica que no se contabilice como bloqueo; y se simula una falla de
comunicación con el Módulo 1, confirmando la respuesta controlada **HTTP 400**.

**Acceptance Scenarios**:

1. **Escenario 1**: Categoría sin mantenimientos programados en el rango de fechas (Happy Path)

   ```gherkin
   Given una categoryRoom sin mantenimientos programados en el rango de fechas solicitado
   When "Verificar disponibilidades" consulta el calendario de mantenimientos enviando categoryRoom, startDate y endDate
   Then el sistema consulta de forma síncrona al Módulo 1
   And retorna cero habitaciones inhabilitadas para esa categoryRoom en el periodo consultado
   ```

2. **Escenario 2**: Categoría con habitaciones bloqueadas por mantenimiento en el rango solicitado

   ```gherkin
   Given una categoryRoom con una o más habitaciones bajo mantenimiento programado que se solapa total o parcialmente con el rango solicitado
   When "Verificar disponibilidades" consulta el calendario de mantenimientos
   Then el sistema retorna la cantidad exacta de habitaciones inhabilitadas de esa categoryRoom en el periodo consultado
   ```

3. **Escenario 3**: Mantenimientos contiguos que finalizan justo antes del `checkInDate`

   ```gherkin
   Given una categoryRoom cuyo único mantenimiento programado finaliza justo antes del checkInDate solicitado
   When "Verificar disponibilidades" consulta el calendario de mantenimientos
   Then el sistema determina que ese mantenimiento no se solapa con el rango solicitado
   And retorna cero habitaciones inhabilitadas para el cálculo de aforo
   ```

4. **Escenario 4**: Fallo de respuesta o timeout del Módulo 1 (Error)

   ```gherkin
   Given una consulta al calendario de mantenimientos en curso
   When el Módulo 1 no responde o la conexión agota el tiempo de espera
   Then el sistema interrumpe la validación de disponibilidad
   And no asume disponibilidad por defecto
   And responde con un error controlado HTTP 400 (Bad Request) indicando: "Error 400: No fue posible consultar el calendario de mantenimientos del Módulo 1"
   And prohíbe estrictamente la propagación de una excepción HTTP 500
   ```

## 3. Casos Borde

- **Caso Borde 1**: Rango de fechas inválido. Si el `endDate` es anterior o igual al `startDate`, el
  sistema intercepta la solicitud antes de consultar al Módulo 1 y responde con un error controlado
  **HTTP 400 (Bad Request)**.
- **Caso Borde 2**: Consulta sobre una `categoryRoom` no registrada en el catálogo del hotel. El
  sistema responde con un error controlado **HTTP 400 (Bad Request)**, sin intentar consultar el
  calendario del Módulo 1.
- **Caso Borde 3**: Caída de red o timeout con el Módulo 1. El sistema intercepta la falla de forma
  limpia y responde con **HTTP 400 (Bad Request)**, sin propagar en ningún caso una excepción **HTTP
  500**.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe consultar el calendario de mantenimientos del Módulo 1 enviando la
  `categoryRoom`, el `startDate` y el `endDate` recibidos.
- **FR-002**: El sistema debe identificar como bloqueo cualquier mantenimiento que se solape, total
  o parcialmente, con el rango de la estadía solicitada.
- **FR-003**: El sistema debe retornar la cantidad de habitaciones de la `categoryRoom`
  inhabilitadas en el periodo consultado, para su uso en el cálculo de aforo de "Verificar
  disponibilidades".
- **FR-004**: El sistema debe mantener la propiedad de solo lectura de esta consulta: no debe crear,
  modificar ni eliminar registros de mantenimiento, ya que son propiedad exclusiva del Módulo 1.
- **FR-005**: El sistema debe interrumpir el flujo de verificación de disponibilidad sin asumir
  disponibilidad por defecto cuando el Módulo 1 no responda.
- **FR-006**: El sistema debe capturar cualquier fallo de integración o de validación de entrada, y
  responder en todos esos casos con un error controlado **HTTP 400 (Bad Request)**, quedando
  estrictamente prohibida la propagación de excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de respuesta de la consulta debe ser inferior a 1 segundo en condiciones
  normales.
- **NFR-002**: La operación debe ser idempotente, sin efectos colaterales sobre los datos del Módulo
  1 ni del Módulo 2 entre ejecuciones sucesivas.

## 5. Entidades Clave

- **MaintenanceSchedule** (del Módulo 1): Programación de mantenimiento, propiedad exclusiva del
  Módulo 1, consultada de forma síncrona por esta funcionalidad. Atributos leídos: `roomId`,
  `categoryRoom`, `maintenanceStart`, `maintenanceEnd` y `reason`.
- **Room**: Concepto de categoría de habitación (`categoryRoom`) sobre el que se calcula el bloqueo
  de aforo, identificada además por `roomId` y `numberRoom` a nivel físico dentro del Módulo 1. Sus
  estados físicos administrados por el Módulo 1 incluyen `Available`, `Occupied`,
  `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock` e `Inactive`.
- **Reservation**: Se referencia de forma informativa como la reserva que se intenta crear o
  modificar y que origina la consulta. Atributo de ciclo de vida: `Reservation.state` (`PENDING`,
  `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de los cálculos de aforo deducen correctamente la cantidad de habitaciones
  inhabilitadas por mantenimientos programados del Módulo 1.
- **SC-002**: Cero reservas confirmadas sobre categorías cuyo aforo disponible ya fue agotado por
  mantenimientos solapados con la estadía.
- **SC-003**: El 100% de las fallas de integración o entradas inválidas se responden con **HTTP
  400**, con cero excepciones **HTTP 500**.
