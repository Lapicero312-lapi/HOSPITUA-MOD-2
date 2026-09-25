# Feature Specification: Registrar Check-Out (Notificación)

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

El Check-Out es un proceso presencial: se recibe la habitación, se libera físicamente y se cierra la
cuenta. Ese proceso pertenece al Módulo 1, que opera el hotel en persona. El Módulo 2 no debe
duplicar una pantalla de salida ni asumir la liberación de la habitación: solo necesita saber que el
huésped ya salió para cerrar el ciclo de vida de su reserva. Si esa notificación no se procesa, las
reservas quedan eternamente "en curso", distorsionando la ocupación y los reportes.

### Flujo de Usuario de Alto Nivel

1. El **Módulo 1** ejecuta el Check-Out físico: libera la `Room` y cierra la estadía.
2. El Módulo 1 envía a la API del Módulo 2 una notificación con la referencia de la reserva.
3. El sistema localiza la reserva mediante "Consultar reservas" y valida que esté en `IN_PROGRESS`.
4. El sistema ejecuta "Actualizar reservación" para cambiar el `status` a `COMPLETED`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sincronización de Salida y Finalización de Reserva (Priority: P2)

El Módulo 2 recibe la notificación de Check-Out ejecutado en el Módulo 1 para marcar la estadía de
la `Reservation` como terminada, sin duplicar procesos de salida. Por tratarse de una única
notificación, el camino exitoso y los rechazos por estado inválido o duplicado se consolidan en esta
misma historia de usuario.

**Why this priority**: Es el paso final del ciclo de vida de una reserva utilizada. Deja un
historial limpio y finalizado, y deja la liberación física de la habitación a cargo del Módulo 1.

**Independent Test**: Se envía una notificación simulada del Módulo 1 para una reserva en curso y se
valida que el estado cambie a `COMPLETED` sin afectar la disponibilidad que gestiona el Módulo 1.

**Acceptance Scenarios**:

1. **Scenario**: Finalización exitosa por notificación de Check-Out (Happy Path)
   - **Given** una `Reservation` en `IN_PROGRESS`
   - **When** el sistema recibe la notificación del Módulo 1 indicando que el Check-Out finalizó
   - **Then** el sistema actualiza la `Reservation` a `COMPLETED`

2. **Scenario**: Rechazo de notificación para reservas sin ingreso (Error)
   - **Given** una `Reservation` en `ACTIVE` o `PENDING`
   - **When** el Módulo 1 envía una notificación de Check-Out
   - **Then** el sistema prohíbe el cambio de estado, responde **HTTP 400 (Bad Request)** informando que la reserva aún no registra un ingreso, y registra una incidencia de conciliación con el Módulo 1

3. **Scenario**: Notificación duplicada (idempotente)
   - **Given** una `Reservation` en `COMPLETED`
   - **When** el sistema recibe de nuevo una notificación de Check-Out
   - **Then** el sistema responde 200 sin efectos nuevos, porque la salida ya fue registrada

### Casos Borde

- ¿Qué sucede si el payload llega vacío o incompleto? El sistema bloquea el procesamiento y responde
  **HTTP 400** con el mensaje: "Petición inválida. Faltan datos requeridos para procesar la
  notificación de Check-Out."
- ¿Qué sucede si la notificación llega con horas de retraso por un problema de red? El sistema la
  procesa normalmente si la reserva sigue `IN_PROGRESS`, actualizándola a `COMPLETED` de forma
  transaccional.
- ¿Qué sucede si la reserva notificada no existe? El sistema responde **HTTP 400** con el mensaje:
  "Referencia de reserva no encontrada", evitando un error **HTTP 500**.
- ¿Qué sucede si la reserva está `CANCELLED` o `NO_SHOW`? El sistema la rechaza con **HTTP 400**,
  porque nunca tuvo un ingreso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema no debe ofrecer una interfaz para el Check-Out físico: debe limitarse a
  exponer un servicio para recibir la notificación del Módulo 1.
- **FR-002**: El sistema debe validar que la `Reservation` esté en `IN_PROGRESS` antes de procesar la salida; si ya está en `COMPLETED` debe responder 200 sin efectos (idempotencia), y en cualquier otro estado debe responder **HTTP 400** y registrar una incidencia de conciliación.
- **FR-003**: El sistema debe actualizar el `status` a `COMPLETED` mediante "Actualizar reservación"
  tras una notificación válida.
- **FR-004**: El sistema no debe modificar el estado de la `Room`, que gestiona el Módulo 1.
- **FR-005**: El sistema debe responder **HTTP 400 (Bad Request)** ante cualquier inconsistencia de
  negocio o de datos, prohibiendo errores **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El procesamiento de la notificación debe completarse en menos de 500 milisegundos.

### Key Entities *(include if feature involves data)*

- **Reservation**: Reserva que transiciona de `IN_PROGRESS` a `COMPLETED`. Atributos:
  `reservationRef`, `roomId` y `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`,
  `CANCELLED`, `NO_SHOW`).
- **Room**: Habitación física controlada por el Módulo 1, que la libera en el Check-Out. Atributos:
  `roomId`, `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las notificaciones de Check-Out válidas cambian la reserva a `COMPLETED`.
- **SC-002**: El 100% de los intentos sobre reservas sin ingreso responden **HTTP 400** con incidencia registrada, y los duplicados sobre reservas ya finalizadas responden 200 sin efectos, sin generar errores de sistema.
