# Implementation Plan: Establecer Estado de Habitación

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

El Módulo 2 le pide al Módulo 1 (REST POST/PUT, reactiva) que marque `Reserved` la habitación asignada
a una reserva **el día de su llegada**, y que la devuelva a `Available` al cancelar o en No-Show. Es
una integración con secuencia y reintentos: cada orden lleva un `sequenceNumber` creciente por
habitación, se envían de una en una, y las fallas de liberación se reintentan sin revertir la
cancelación. Incluye un proceso al inicio del día operativo que aparta las reservas de hoy. Es un
servicio interno (`RoomStateOrderService`) más tres procesos programados; sin endpoint público.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL, tablas `room_state_request` y `room_sequence` (esquema base). Reutiliza `reconciliation_incident`.
- **Testing**: JUnit 5, Mockito, `MockRestServiceServer` y Testcontainers (concurrencia de secuencias).
- **Performance Goals**: procesamiento local < 1 s (NFR-001); al menos 99% de las órdenes `Reserved` en `COMPLETED` en 60 s (SC-001); 95% de `PENDING` sincronizadas en el primer reintento (SC-005).
- **Constraints**: nada de llamadas al Módulo 1 dentro de una transacción de base de datos abierta; nunca liberar una habitación `Occupied`.
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Contrato hacia el Módulo 1 (propuesto; lo define el Módulo 1)

- `PUT {module1}/rooms/{roomId}/state`, cabecera `Idempotency-Key: {requestId}`, cuerpo:
  `{ requestId, requestedStatus, previousStatus, originEvent, reservationRef, sequenceNumber, reservation? }`.
  Respuestas: 200 aplicado; 200 ignorado por obsoleta (`OBSOLETE`); 409 habitación `Occupied` o ya no
  apartada por esa reserva (`ROOM_OCCUPIED`).
- `GET {module1}/room-state-requests/{requestId}` para resolver una orden ambigua (consulta idempotente).

### Componentes (`com.hospitua.reservas.roomstate`)

| Clase | Responsabilidad |
|---|---|
| `RoomStateRequest` (entidad) y `RoomStateRequestRepository` | Orden con los atributos del diccionario; único `(room_id, sequence_number)` |
| `RoomSequenceService` | Asigna `sequenceNumber` de forma atómica: bloquea la fila de `room_sequence` de esa habitación (`SELECT ... FOR UPDATE`) dentro de la misma transacción que inserta la orden |
| `RoomStateOrderService` | API para las features: `orderReserved(...)`, `orderAvailable(...)`, `changeRoom(...)`, `datesChanged(...)`; valida y registra |
| `RoomStateDispatcher` | Envía la orden que está a la cabeza de la cola de cada habitación; reclama la orden con una concesión (`locked_until`) para no enviar dos veces |
| `Module1RoomStateClient` | Método de `Module1Client`: `setRoomState(...)` y `getRequestResult(requestId)` |
| `RoomStateOutcome` (sellado) | `Completed`, `Rejected(reason)`, `Pending`, para que el flujo invocador compense |
| `jobs/DayStartRoomReservationJob` | Al inicio del día operativo, `Reserved` para las reservas `ACTIVE` o `PENDING` con llegada hoy (`RESERVATION_DUE_TODAY`) |
| `jobs/RoomStateRetryJob` | Reintenta `PENDING` y resuelve ambiguas; cada 15 s (configurable) |
| `jobs/JobLockService` | Bloqueo asesor de PostgreSQL (`pg_try_advisory_lock`), decisión C10; lo reutiliza el cierre del día de `update-reservation` |

### Matriz de comportamiento por origen (FR-005, FR-011, FR-015)

| `originEvent` | Orden | Falla o sin respuesta | Rechazo por `Occupied` |
|---|---|---|---|
| `RESERVATION_CREATED` (llegada hoy) | `Reserved` | `Rejected`, no se reintenta; el flujo cancela la reserva (`ROOM_UNCONFIRMED`) y, si fue ambiguo, se neutraliza con `Available` de mayor secuencia | El flujo cancela (`ROOM_REJECTED`) |
| `RESERVATION_DUE_TODAY` | `Reserved` | `Pending`, se reintenta; la reserva se conserva | Se conserva la reserva y se registra `ReconciliationIncident` |
| `RESERVATION_CANCELLED`, `RESERVATION_NO_SHOW` | `Available` (solo si estaba `Reserved` por esa reserva) | `Pending`, se reintenta; no se revierte la cancelación ni el No-Show | `Rejected`, sin efecto + incidencia |
| `ROOM_CHANGED` (llegada hoy) | `Reserved` nueva y, tras confirmar, `Available` anterior | Falla en la nueva: se aborta el cambio y se neutraliza; falla solo en la anterior: `Pending` y el cambio se conserva | Se aborta el cambio |
| `DATES_CHANGED` | `Reserved` si la llegada pasa a ser hoy; `Available` si dejaba de serlo | Igual que los anteriores | Igual |

### Reglas

- **FR-001 / FR-002 / FR-014**: solo se emite orden si la llegada es hoy (reloj del hotel). `Available` solo
  si el registro local muestra que esa reserva quedó apartada (una orden `Reserved` en `COMPLETED` sin `Available`
  posterior); si nunca se apartó no se emite nada. El proceso del inicio del día no repite órdenes ya `COMPLETED` o `PENDING`.
- **FR-003 / FR-004**: `requestedStatus` solo `Reserved` o `Available`; cualquier otro (`Occupied`,
  limpieza) → 400 `INVALID_ROOM_STATE_REQUEST`: "Los cambios a Occupied los ejecuta exclusivamente el Módulo 1."
  `roomId` vacío, nulo o inexistente → 400 sin llamar al Módulo 1.
- **FR-009 (cola por habitación)**: el `RoomStateDispatcher` solo envía la orden de menor secuencia no
  terminal de cada habitación; la siguiente espera a que esa quede `COMPLETED` o `REJECTED`.
- **FR-010**: toda orden `Available` lleva `previousStatus = Reserved` y `reservationRef`; el Módulo 1 la
  rechaza si la habitación está `Occupied` o ya no la apartó esa reserva → `REJECTED` sin efecto + incidencia.
- **FR-012 (ambiguas)**: ante respuesta ambigua o timeout se consulta el resultado por `requestId` con
  intentos acotados (propuesta: 3 intentos en 2 minutos); sin respuesta concluyente → `REJECTED` con
  `UNRESOLVED`, `ReconciliationIncident` y se libera la cola.
- **FR-013**: cada orden registra fecha, actor (`requested_by`), habitación, estado anterior, estado solicitado y resultado.
- **Copia tardía**: una respuesta `OBSOLETE` del Módulo 1 deja la orden `REJECTED` con `OBSOLETE`.
- **Errores** (400 mediante `GlobalExceptionHandler`): `INVALID_ROOM_STATE_REQUEST`, y para el flujo
  invocador `ROOM_UNAVAILABLE` ("la habitación no está disponible").

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/
├── roomstate/
│   ├── RoomStateRequest.java
│   ├── RoomStateRequestRepository.java
│   ├── RoomSequenceService.java
│   ├── RoomStateOrderService.java
│   ├── RoomStateDispatcher.java
│   └── RoomStateOutcome.java
├── integration/module1/                     # setRoomState y getRequestResult en Module1Client
└── jobs/
    ├── JobLockService.java
    ├── DayStartRoomReservationJob.java
    └── RoomStateRetryJob.java
backend/src/main/resources/db/migration/     # room_state_request y room_sequence (con T007)
backend/src/test/java/com/hospitua/reservas/
├── unit/roomstate/RoomStateOrderServiceTest.java
├── integration/roomstate/RoomSequenceConcurrencyIT.java
├── integration/roomstate/RoomStateDispatcherIT.java
└── contract/module1/Module1RoomStateContractTest.java
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| US1 Esc. 1: apartado al crear con llegada hoy | `RoomStateOrderServiceTest` + contrato: orden `Reserved` con detalle; queda `COMPLETED` |
| US1 Esc. 2: liberación al cancelar el mismo día | Solo emite si estaba apartada; queda `COMPLETED` |
| US1 Esc. 3 y 5: rechazo por `Occupied` (apartado y liberación) | Contrato con 409: `REJECTED`, sin efecto, incidencia |
| US1 Esc. 4: estado no permitido | 400 `INVALID_ROOM_STATE_REQUEST`, sin orden |
| US1 Esc. 5 (spec): rechazo de la habitación nueva en `ROOM_CHANGED` | Se aborta el cambio |
| US1 Esc. 7: llegada futura no envía orden | Cero llamadas al Módulo 1 |
| US1 Esc. 8: apartado al inicio del día | `DayStartRoomReservationJob`: idempotente, no repite |
| US2 Esc. 1 y 2: `PENDING` y reintento | `RoomStateDispatcherIT` con caída y recuperación del Módulo 1 |
| US2 Esc. 3: copia tardía ignorada | Respuesta `OBSOLETE` → `REJECTED` |
| US2 Esc. 4: dos órdenes simultáneas | `RoomSequenceConcurrencyIT`: N hilos, secuencias únicas, consecutivas y sin saltos |
| US2 Esc. 5: orden ambigua | Resolución por `requestId`; sin respuesta → `UNRESOLVED` + incidencia |
| Cancelar con `Reserved` en `PENDING` | La `Available` queda en cola detrás de la `Reserved` |
| `roomId` vacío o inexistente | 400 sin llamar al Módulo 1 |
| Ningún HTTP dentro de transacción abierta | Prueba de arquitectura o de integración que verifica la transacción durante la llamada |

## Phase 3: User Story 1 - Orden de cambio de estado por reserva del día o cancelación (Priority: P1)

**Goal**: que el Módulo 1 tenga apartadas las habitaciones de las reservas de hoy y las libere al cancelarse.  
**Independent Test**: escenarios 1 a 8 con el Módulo 1 simulado.

### Tests

- [ ] T-RSS-01 [P] [US1] `Module1RoomStateContractTest`: 200 aplicado, 200 obsoleta, 409, timeout y respuesta ambigua
- [ ] T-RSS-02 [P] [US1] `RoomStateOrderServiceTest`: validaciones, matriz por `originEvent` y no emitir para llegadas futuras
- [ ] T-RSS-03 [P] [US1] Prueba de `DayStartRoomReservationJob` con reloj fijo e idempotencia

### Implementation

- [ ] T-RSS-04 [US1] Crear las tablas `room_state_request` y `room_sequence` en el esquema base (coordinado con T007)
- [ ] T-RSS-05 [P] [US1] Crear `RoomStateRequest`, su repositorio y `RoomStateOutcome`
- [ ] T-RSS-06 [US1] Implementar `RoomSequenceService` con bloqueo por habitación
- [ ] T-RSS-07 [US1] Agregar `setRoomState` y `getRequestResult` a `Module1Client` (depende de T-CRI-04)
- [ ] T-RSS-08 [US1] Implementar `RoomStateOrderService` (depende de T-RSS-05 a T-RSS-07 y de T015 del plan base)
- [ ] T-RSS-09 [P] [US1] Crear `JobLockService` con `pg_try_advisory_lock`
- [ ] T-RSS-10 [US1] Implementar `DayStartRoomReservationJob` (depende de T-RSS-08, T-RSS-09 y T010)

**Checkpoint**: una reserva con llegada hoy queda apartada en el Módulo 1 y se libera al cancelarse.

## Phase 4: User Story 2 - Reintento por fallo de comunicación con el Módulo 1 (Priority: P2)

**Goal**: que un fallo de red no impida cancelar y que las órdenes lleguen en orden.  
**Independent Test**: escenarios 1 a 5 de la Historia 2.

### Tests

- [ ] T-RSS-11 [P] [US2] `RoomSequenceConcurrencyIT`: secuencias únicas bajo concurrencia
- [ ] T-RSS-12 [P] [US2] `RoomStateDispatcherIT`: cola por habitación, concesión y reintento con caída del Módulo 1

### Implementation

- [ ] T-RSS-13 [US2] Implementar `RoomStateDispatcher` (concesión `locked_until`, una orden a la vez por habitación)
- [ ] T-RSS-14 [US2] Implementar `RoomStateRetryJob`: reintentos, resolución por `requestId` y `UNRESOLVED` con incidencia
- [ ] T-RSS-15 [US2] Configurar `hospitua.roomstate.*` (intervalo, intentos y plazo de resolución)

**Checkpoint**: las liberaciones pendientes se sincronizan solas al volver el Módulo 1.

## Dependencies & Execution Order

- Depende de: T007, T008, T010, T015 del plan base y `Module1Client` de `consult-room-inventory` (T-CRI-04).
- Lo consumen `generate-direct-reservation`, `generate-ota-reservation`, `update-reservation` y `cancel-reservation`.
- `JobLockService` (T-RSS-09) lo reutilizará el cierre del día de `update-reservation`.

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Contrato real del Módulo 1** (rutas, idempotencia por `requestId`, consulta del resultado): debe acordarse con su equipo, igual que el estado `Reserved` (C8).
2. **Valores de reintento**: intervalo del job (15 s), 3 intentos de resolución en 2 minutos; a validar con el Módulo 1.
3. **Hora del inicio del día operativo** y zona horaria del hotel: configurables; falta el valor.
4. **`reservation` en el cuerpo de la orden**: el spec pide "el detalle completo de la reserva"; falta definir los campos que el Módulo 1 necesita.
