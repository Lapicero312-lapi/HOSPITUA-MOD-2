# Feature Specification: Límites de Arquitectura - Gestión de Estado de Habitación

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Este documento declara una decisión de diseño arquitectónico, no un servicio transaccional: el
Módulo 2 no emite, bajo ninguna circunstancia, comandos de cambio de estado de habitación física
hacia el Módulo 1. Es obligatorio dejar esta decisión formalizada como límite del sistema, porque
versiones anteriores de esta especificación asumían un mecanismo de integración síncrono y
asíncrono (`RoomStateRequest`, órdenes `RESERVED`/`AVAILABLE`, `sequenceNumber` por habitación) que
acoplaba la creación, cancelación y modificación de reservas a la disponibilidad de red y a la
respuesta del Módulo 1. Ese acoplamiento generaba fallas en cascada: una caída del Módulo 1
bloqueaba la venta directa y la venta OTA del hotel completo, a pesar de que ambos módulos gestionan
dominios distintos y en principio independientes.

La corrección arquitectónica es la siguiente: el Módulo 2 gestiona la creación, modificación,
cancelación y el No-Show de reservas de forma 100% local, ajustando únicamente el aforo lógico de la
`categoryRoom` en su propia base de datos. El Módulo 1 es soberano y exclusivo sobre los 7 estados
físicos de la `Room` (`Available`, `Occupied`, `PendingCleaning`, `InCleaning`,
`DisabledForRepairs`, `TechnicalBlock` e `Inactive`), y los administra únicamente en función de
eventos físicos reales —Check-In, Check-Out, mantenimiento—, nunca a pedido del Módulo 2. La única
relación entre ambos módulos, en lo que respecta al estado de la reserva, es la recepción pasiva de
notificaciones informativas de Check-In y Check-Out, que el Módulo 2 usa exclusivamente para
transicionar `Reservation.state` a `IN_PROGRESS` y `COMPLETED` respectivamente.

### Flujo de Usuario de Alto Nivel

1. Al crearse, modificarse, cancelarse o marcarse como `NO_SHOW` una `Reservation`, el Módulo 2
   descuenta o restituye directamente el cupo del aforo lógico local de la `categoryRoom`
   correspondiente.
2. El Módulo 2 no emite ninguna llamada, síncrona ni asíncrona, hacia el Módulo 1 como parte de
   estas operaciones.
3. Durante el Check-In presencial en Recepción, el Módulo 1 asigna la `Room` física, decidiendo por
   sí mismo su transición a `Occupied`, y notifica al Módulo 2 para que este actualice
   `Reservation.state` a `IN_PROGRESS`. De forma simétrica, durante el Check-Out el Módulo 1
   gestiona la liberación física de la `Room` y notifica al Módulo 2 para que transicione
   `Reservation.state` a `COMPLETED`.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Garantía de Autonomía de Inventario Lógico (Priority: P1)

**Plain Language**: Declaración verificable de que toda operación del ciclo de vida de una reserva
(creación, cancelación, modificación, No-Show) se resuelve exclusivamente contra el aforo lógico
local de `categoryRoom`, sin emitir ninguna llamada de modificación hacia el Módulo 1, y de que
cualquier intento de solicitar un cambio de estado físico desde el Módulo 2 se rechaza de inmediato.

El Módulo 2 gestiona el aforo lógico de `categoryRoom` de forma enteramente local, sin depender de
la disponibilidad ni de la respuesta del Módulo 1 para completar ninguna operación de reserva. Por
tratarse de una declaración de límite arquitectónico verificable en todos los flujos del Módulo 2,
el camino de creación, el de cancelación con liberación de aforo, y el rechazo de cualquier intento
de alterar estados físicos se consolidan en esta misma historia de usuario.

**Why this priority**: Es el principio de diseño que sostiene la resiliencia de todo el Módulo 2:
sin esta autonomía, cualquier funcionalidad transaccional de reservas quedaría expuesta a fallar en
cascada ante una caída del Módulo 1, que gestiona un dominio operativo distinto y no relacionado con
el aforo comercial.

**Independent Test**: Se crea una reserva y se verifica que el aforo lógico local de su
`categoryRoom` se descuenta sin que se registre ninguna llamada saliente hacia el Módulo 1. Se
cancela una reserva y se verifica que el aforo se restituye de la misma forma, exclusivamente local.
Se intenta invocar, desde dentro del Módulo 2, cualquier operación que intente fijar un estado
físico de `Room`, confirmando que la solicitud se rechaza de inmediato con un error controlado.

**Acceptance Scenarios**:

1. **Escenario 1**: Creación de reserva sin llamada a Módulo 1

   ```gherkin
   Given una categoryRoom con cupo de aforo lógico disponible
   When se crea una nueva Reservation sobre esa categoryRoom
   Then el sistema descuenta de inmediato el cupo de aforo lógico local de la categoryRoom
   And no se registra ninguna llamada, síncrona ni asíncrona, hacia el Módulo 1
   ```

2. **Escenario 2**: Cancelación de reserva con liberación exclusiva de aforo en `categoryRoom`

   ```gherkin
   Given una Reservation activa que comprometía un cupo de aforo lógico de su categoryRoom
   When la reserva se cancela
   Then el sistema restituye de inmediato ese cupo en el aforo lógico local de la categoryRoom
   And no se emite ninguna orden de cambio de estado físico hacia el Módulo 1
   ```

3. **Escenario 3**: Rechazo inmediato de peticiones que intenten alterar estados físicos desde Módulo 2 (Error)

   ```gherkin
   Given cualquier intento, interno o externo, de solicitar un cambio de estado físico de Room desde el Módulo 2
   When esa solicitud se procesa
   Then el sistema la rechaza de inmediato sin emitir ninguna orden hacia el Módulo 1
   And responde con un error controlado HTTP 400 (Bad Request)
   ```

## 3. Casos Borde

- **Caso Borde 1**: Intento de invocación directa a un endpoint de cambio de estado físico no
  expuesto por el Módulo 2. El sistema responde con un error controlado **HTTP 400 (Bad Request)**,
  quedando estrictamente prohibida la propagación de excepciones de infraestructura **HTTP 500**.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: Queda estrictamente prohibido que el sistema realice cualquier llamado saliente, ya
  sea síncrono o asíncrono, desde el Módulo 2 hacia el Módulo 1 para modificar el estado físico de
  una `Room`.
- **FR-002**: El sistema debe gestionar la creación, modificación, cancelación y el No-Show de
  reservas de forma 100% local, ajustando exclusivamente el aforo lógico de la `categoryRoom` en la
  base de datos del Módulo 2.
- **FR-003**: El sistema debe limitar su relación con el Módulo 1, en lo relativo al estado de la
  reserva, a la recepción pasiva de notificaciones informativas de Check-In y Check-Out.
- **FR-004**: El sistema debe interceptar cualquier intento no autorizado de solicitar un cambio de
  estado físico de `Room` y responder con **HTTP 400 (Bad Request)**, quedando estrictamente
  prohibida la propagación de excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: La operación de ajuste de aforo lógico debe ser enteramente local y transaccional,
  con un tiempo de respuesta inferior a 100 milisegundos.

## 5. Entidades Clave

- **Reservation**: Entidad cuyo ciclo de vida se gestiona de forma 100% local. Atributo de ciclo de
  vida: `Reservation.state` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`,
  `NO_SHOW`).
- **Room**: Concepto de categoría de habitación (`categoryRoom`) y su cupo de aforo lógico local,
  administrado exclusivamente dentro del Módulo 2. Los 7 estados físicos de la `Room`
  (`Available`, `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`,
  `TechnicalBlock` e `Inactive`) son propiedad exclusiva y soberana del Módulo 1; el Módulo 2 nunca
  los consulta de forma prescriptiva ni intenta modificarlos.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: Cero llamadas de modificación emitidas desde el Módulo 2 hacia el Módulo 1 en
  cualquier operación del ciclo de vida de una reserva.
- **SC-002**: El 100% de la gestión de disponibilidad de reservas se resuelve mediante el aforo
  lógico local de `categoryRoom`.
- **SC-003**: Cero errores **HTTP 500** en producción por intentos de alterar estados físicos desde
  el Módulo 2.
