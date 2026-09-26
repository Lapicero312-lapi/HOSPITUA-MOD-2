# Feature Specification: Actualizar Reservación

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Los planes de viaje de un huésped cambian con frecuencia: adelanta o pospone su llegada, extiende la
estadía, cambia de `categoryRoom` o corrige datos personales. Si el hotel no puede reflejar esos
cambios de forma ágil sobre una reserva, la fricción crece, se pierden ventas y el personal termina
llevando ajustes por fuera del sistema. El problema tiene dos caras: verificar que exista cupo de
aforo lógico disponible para las nuevas fechas o categoría, y recalcular el valor bruto cuando
cambian las fechas o la categoría (lo hace el Módulo 3, no el Módulo 2, y de forma informativa).

Durante la etapa de reserva no existe ningún `numberRoom` ni `roomId` físico asignado al huésped —esa
asignación ocurre únicamente en el Check-In, dentro del Módulo 1—, por lo que esta funcionalidad
nunca invoca al Módulo 1 para intentar cambiar el estado de ninguna habitación física. El negocio
necesita una única funcionalidad de actualización que valide el aforo lógico local, delegue el
recálculo informativo en el Módulo 3, y solo persista los cambios tras la confirmación del
solicitante.

### Flujo de Usuario de Alto Nivel

1. La Recepcionista busca la reserva por `reservationRef` o por el documento del titular.
2. El sistema valida que la `Reservation` se encuentre en `Reservation.state` `PENDING` o `ACTIVE`.
3. La Recepcionista ajusta las fechas, la `categoryRoom` o los datos personales del `Guest`.
4. Si cambian las fechas o la `categoryRoom`, el sistema ejecuta "Verificar disponibilidades" sobre
   el aforo lógico local, enviando la `reservationRef` de la reserva editada para que esta no se
   cruce consigo misma, y solicita al Módulo 3 ("Calcular tarifa dinámica") el nuevo `grossAmount`
   de carácter informativo.
5. La Recepcionista revisa el resumen financiero (diferencia a pagar o saldo a favor) y confirma los
   cambios; el sistema persiste la `Reservation` y el `Guest` de forma local y genera un registro de
   auditoría.
6. El sistema responde con **HTTP 200 (OK)**.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Modificación de Reservación Existente (Priority: P1)

**Plain Language**: Actualización ágil de fechas, `categoryRoom` o datos de huéspedes sobre reservas
en `PENDING` o `ACTIVE`, validando el aforo lógico local y recalculando el valor bruto de forma
informativa con el Módulo 3, sin ninguna llamada hacia el Módulo 1.

Un solicitante —la Recepcionista— modifica una reserva que aún no ha iniciado su estadía. Puede
cambiar fechas, `categoryRoom` o datos personales. Cuando el cambio afecta fechas o categoría, el
sistema valida el aforo lógico local y delega el recálculo en el Módulo 3, mostrando la diferencia
antes de confirmar; cuando solo toca datos personales, guarda directamente sin recotización ni
validación de inventario. Por tratarse de una única funcionalidad, el camino exitoso y los bloqueos
lógicos (estado no modificable, falta de aforo) se consolidan en esta misma historia de usuario,
para evitar la sobre-atomización.

**Why this priority**: Da al hotel la flexibilidad de acomodar los cambios del cliente sin fricción
y sin gestiones por fuera del sistema, garantizando la consistencia del aforo lógico y del valor de
la estadía antes de la llegada, sin acoplar la actualización a la disponibilidad ni a la respuesta
del Módulo 1.

**Independent Test**: Se modifica una `Reservation` en `ACTIVE` cambiando fechas y `categoryRoom`, y
se verifica que el sistema valide el aforo lógico local, muestre la diferencia calculada por el
Módulo 3 y solo tras la confirmación persista los cambios. Se repite modificando únicamente datos
personales del `Guest`, confirmando que no se invoca al Módulo 3 ni se valida aforo. La prueba se
completa intentando modificar reservas en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` y `NO_SHOW`, y
solicitando un cambio sobre una `categoryRoom` sin aforo disponible, confirmando el bloqueo
controlado en ambos casos.

**Acceptance Scenarios**:

1. **Escenario 1**: Actualización exitosa de fechas/categoría con recálculo tarifario (Happy Path)

   ```gherkin
   Given una Reservation en Reservation.state ACTIVE con cupo de aforo lógico disponible para las nuevas fechas o categoryRoom
   When el solicitante modifica las fechas o la categoryRoom y confirma los cambios
   Then el sistema verifica el aforo lógico local excluyendo la propia reservationRef
   And solicita al Módulo 3 el grossAmount recalculado de forma informativa
   And muestra el resumen con la diferencia a pagar o reembolsar antes de confirmar
   And, tras la confirmación, persiste los cambios sobre la Reservation
   And registra la auditoría de la modificación
   ```

2. **Escenario 2**: Modificación exclusiva de datos personales de `Guest` sin afectación financiera ni recotización

   ```gherkin
   Given una Reservation en Reservation.state ACTIVE o PENDING
   When el solicitante corrige únicamente los datos personales del Guest
   Then el sistema guarda los cambios directamente
   And no invoca al Módulo 3 ni verifica el aforo lógico
   ```

3. **Escenario 3**: Intento de modificación sobre reserva en estado no modificable (Error)

   ```gherkin
   Given una Reservation en Reservation.state IN_PROGRESS, COMPLETED, CANCELLED o NO_SHOW
   When un solicitante intenta editarla
   Then el sistema bloquea la edición
   And responde con un error controlado HTTP 400 (Bad Request) indicando que el estado actual no admite modificaciones
   ```

4. **Escenario 4**: Rechazo por falta de aforo en la nueva `categoryRoom` o fechas solicitadas (Error)

   ```gherkin
   Given que "Verificar disponibilidades" indica que no hay cupo de aforo disponible para la categoryRoom y fechas solicitadas
   When el solicitante intenta confirmar la modificación
   Then el sistema bloquea la confirmación sin invocar al Módulo 3
   And responde con un error controlado HTTP 400 (Bad Request) indicando la falta de disponibilidad
   ```

## 3. Casos Borde

- **Caso Borde 1**: Rango de fechas incoherente. Si el `checkOutDate` es anterior o igual al
  `checkInDate`, el sistema responde con un error controlado **HTTP 400 (Bad Request)**, sin
  consultar el aforo ni el Módulo 3.
- **Caso Borde 2**: Modificación simultánea por dos usuarios. El sistema aplica control de
  concurrencia optimista mediante el atributo `version` de `Reservation`: la segunda solicitud es
  rechazada con un error controlado **HTTP 400**, indicando que debe recargar la reserva.
- **Caso Borde 3**: Caída de comunicación con el Módulo 3 durante el recálculo. El sistema
  interrumpe la confirmación de forma limpia, sin persistir ningún cambio parcial, y responde con
  un error controlado **HTTP 400 (Bad Request)**.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe permitir la localización de la reserva por `reservationRef` o por el
  documento de identidad del titular.
- **FR-002**: El sistema debe validar que la `Reservation` se encuentre en `Reservation.state`
  `PENDING` o `ACTIVE` antes de autorizar cualquier edición.
- **FR-003**: El sistema debe verificar el aforo lógico local de la `categoryRoom` mediante
  "Verificar disponibilidades" cuando cambien las fechas o la categoría, excluyendo la propia
  `reservationRef` del cálculo.
- **FR-004**: El sistema debe invocar al Módulo 3 ("Calcular tarifa dinámica") para recalcular el
  `grossAmount` de carácter informativo únicamente cuando cambien las fechas o la `categoryRoom`.
- **FR-005**: El sistema debe persistir localmente los cambios sobre `Reservation` y `Guest` solo
  tras la confirmación manual del solicitante.
- **FR-006**: El sistema debe registrar una bitácora de auditoría inmutable con el `processedBy`,
  la marca de tiempo y el detalle de los cambios aplicados.
- **FR-007**: Queda estrictamente prohibido que el sistema realice cualquier llamada de
  modificación de estado hacia el Módulo 1 durante este proceso.
- **FR-008**: El sistema debe interceptar cualquier error de validación, de aforo, de concurrencia o
  de integración con el Módulo 3, y responder obligatoriamente con **HTTP 400 (Bad Request)**,
  quedando estrictamente prohibida la propagación de excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El sistema debe aplicar control de concurrencia optimista mediante el atributo
  `version` de `Reservation`.
- **NFR-002**: El tiempo de respuesta total de la actualización, incluyendo la recotización con el
  Módulo 3 cuando aplique, debe ser inferior a 1.5 segundos.

## 5. Entidades Clave

- **Reservation**: Entidad principal actualizada. Atributos: `id`, `guestRef`, `categoryRoom`,
  `checkInDate`, `checkOutDate`, `grossAmount`, `commissionPercentage`, `commissionAmount`,
  `externalConfirmationCode`, `source` (`DIRECT` | `OTA`), `version` (control de concurrencia
  optimista) y `Reservation.state` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`,
  `NO_SHOW`).
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `documentType`,
  `email`, `phone` y `nationality`.
- **Room**: Concepto de categoría de habitación (`categoryRoom`) y su cupo de aforo lógico local,
  administrado dentro del Módulo 2. No representa aquí ninguna habitación física individual, ya que
  el `numberRoom` y el `roomId` no se asignan sino hasta el Check-In, dentro del Módulo 1. Estados
  físicos administrados por el Módulo 1: `Available`, `Occupied`, `PendingCleaning`, `InCleaning`,
  `DisabledForRepairs`, `TechnicalBlock` e `Inactive`.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las modificaciones de fechas o categoría recalculan su `grossAmount` con el
  Módulo 3 y verifican el aforo lógico local antes de confirmarse.
- **SC-002**: Cero llamadas de modificación de estado realizadas hacia el Módulo 1 durante todo el
  proceso de actualización.
- **SC-003**: El 100% de los intentos sobre estados no modificables o sin aforo disponible se
  rechazan con **HTTP 400**, con cero excepciones **HTTP 500**.
- **SC-004**: El 100% de las actualizaciones exitosas generan un registro de auditoría.
