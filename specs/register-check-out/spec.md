# Feature Specification: Registrar Check-Out (Notificación)

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

El Check-Out es un proceso presencial: se recibe la habitación, se libera físicamente y se cierra la
cuenta. Ese proceso pertenece al Módulo 1, que opera el hotel en persona y es el propietario
exclusivo del estado físico de la `Room`. El Módulo 2 no debe duplicar una pantalla de salida ni
asumir la liberación de la habitación: solo necesita saber que el huésped ya salió para cerrar
formalmente el ciclo de vida de su reserva. Si esa notificación no se procesa, las reservas quedan
eternamente "en curso", distorsionando la ocupación y los reportes.

### Flujo de Usuario de Alto Nivel

1. El Módulo 1 ejecuta el Check-Out físico de forma presencial: libera la `Room` correspondiente y
   cierra la cuenta de la estadía.
2. El Módulo 1 envía a la API del Módulo 2 una notificación con la `reservationRef`.
3. El sistema valida que la `Reservation` se encuentre en `Reservation.state` `IN_PROGRESS`.
4. El sistema transiciona la `Reservation` a `Reservation.state` `COMPLETED`.
5. El sistema responde con **HTTP 200**, sin realizar ninguna modificación sobre el estado físico de
   la `Room`.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Sincronización de Salida y Finalización de Reserva (Priority: P2)

**Plain Language**: Recepción de la notificación de Check-Out del Módulo 1 para cerrar formalmente
la `Reservation` en `COMPLETED`, sin exponer ninguna pantalla de salida propia ni interferir en la
liberación física de la `Room`, que es responsabilidad exclusiva del Módulo 1.

El Módulo 2 recibe la notificación de Check-Out ejecutado en el Módulo 1 para marcar la estadía de
la `Reservation` como terminada, sin duplicar procesos de salida. Por tratarse de una única
notificación, el camino exitoso, los rechazos por estado inválido y la notificación duplicada
idempotente se consolidan en esta misma historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Es el paso final del ciclo de vida de una reserva utilizada. Deja un
historial limpio y finalizado, y deja la liberación física de la habitación a cargo exclusivo del
Módulo 1. Se prioriza como P2 por tratarse de una notificación de sincronización, no del flujo
transaccional de venta.

**Independent Test**: Se envía una notificación simulada del Módulo 1 para una reserva en
`IN_PROGRESS` y se valida que el estado cambie a `COMPLETED` sin afectar el estado físico de la
`Room`. La prueba se completa enviando notificaciones sobre reservas que nunca registraron ingreso,
confirmando el rechazo y el registro de la incidencia de conciliación, y reenviando la notificación
sobre una reserva ya `COMPLETED`, confirmando el comportamiento idempotente.

**Acceptance Scenarios**:

1. **Escenario 1**: Finalización exitosa por notificación válida (Happy Path - `COMPLETED`)

   ```gherkin
   Given una Reservation en Reservation.state IN_PROGRESS
   When el sistema recibe la notificación del Módulo 1 indicando que el Check-Out finalizó
   Then el sistema transiciona la Reservation a Reservation.state COMPLETED
   And no realiza ninguna modificación sobre el estado físico de la Room
   And responde HTTP 200
   ```

2. **Escenario 2**: Rechazo de notificación para reservas que no registraron ingreso (Error)

   ```gherkin
   Given una Reservation en Reservation.state PENDING, ACTIVE, CANCELLED o NO_SHOW
   When el Módulo 1 envía una notificación de Check-Out
   Then el sistema no modifica el Reservation.state
   And registra un ReconciliationIncident con origin CHECK_OUT
   And responde con un error controlado HTTP 400 (Bad Request) indicando que la reserva no registra un ingreso previo
   ```

3. **Escenario 3**: Notificación duplicada recibida en estado `COMPLETED` (Respuesta idempotente)

   ```gherkin
   Given una Reservation en Reservation.state COMPLETED
   When el sistema recibe nuevamente una notificación de Check-Out para esa misma reserva
   Then el sistema no modifica el Reservation.state
   And responde HTTP 200 sin efectos nuevos
   ```

## 3. Casos Borde

- **Caso Borde 1**: Payload vacío o sin `reservationRef`. El sistema bloquea el procesamiento y
  responde con un error controlado **HTTP 400 (Bad Request)**.
- **Caso Borde 2**: Reserva no encontrada en el Módulo 2. El sistema responde con **HTTP 400 (Bad
  Request)** y registra un `ReconciliationIncident` con `origin` `CHECK_OUT`.
- **Caso Borde 3**: Notificación tardía por retraso de red. El sistema la procesa normalmente si la
  reserva sigue en `Reservation.state` `IN_PROGRESS`, transicionándola a `COMPLETED` de forma
  transaccional.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe limitarse a exponer un servicio de API para recibir la notificación
  del Módulo 1, sin ofrecer ninguna interfaz propia de Check-Out presencial.
- **FR-002**: El sistema debe validar que la `Reservation` se encuentre en `Reservation.state`
  `IN_PROGRESS` antes de procesar el cierre.
- **FR-003**: El sistema debe transicionar la `Reservation` a `Reservation.state` `COMPLETED` tras
  recibir una notificación válida.
- **FR-004**: Queda estrictamente prohibido que el sistema realice cualquier modificación directa
  sobre el estado físico de la `Room`, que es responsabilidad exclusiva del Módulo 1.
- **FR-005**: El sistema debe interceptar las inconsistencias o los estados inválidos, respondiendo
  con **HTTP 400 (Bad Request)** y registrando un `ReconciliationIncident`, quedando estrictamente
  prohibida la propagación de excepciones de infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El procesamiento de la notificación debe completarse en menos de 500 milisegundos.

## 5. Entidades Clave

- **Reservation**: Reserva que transiciona de `IN_PROGRESS` a `COMPLETED`. Atributos:
  `reservationRef`, `guestRef`, `categoryRoom` y `Reservation.state` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **ReconciliationIncident**: Registro de una discrepancia entre el Módulo 1 y el Módulo 2 que una
  persona debe resolver. Atributos: `incidentId`, `origin` (`CHECK_OUT`), `reservationRef`,
  `reason`, `createdAt` y `resolutionStatus`.
- **Room**: Habitación física controlada por el Módulo 1, que la libera durante el Check-Out.
  Atributos: `categoryRoom`, `roomId` y `numberRoom`. Estados físicos administrados por el Módulo
  1: `Available`, `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`,
  `TechnicalBlock` e `Inactive`.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las notificaciones válidas transicionan la reserva a `COMPLETED`.
- **SC-002**: Cero errores **HTTP 500**; el 100% de los rechazos generan un
  `ReconciliationIncident` y responden **HTTP 400**.
