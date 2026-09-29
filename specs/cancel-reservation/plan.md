# Implementation Plan: Cancelación de Reservación

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

La Recepcionista o la Ota cancelan una reserva `ACTIVE` o `PENDING`, sin cobro ni llamada al Módulo 3.
El cambio a `CANCELLED` se hace de forma atómica dentro de la propia transacción de cancelación
(con las mismas transiciones y el mismo control de concurrencia que `update-reservation`). Si la
cancelación es el día de la llegada y la habitación ya estaba `Reserved`, se notifica de inmediato al
Módulo 1 para devolverla a `Available` sin revertir la cancelación si falla. Cada cancelación deja un
registro de auditoría (`Cancellation`).

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL: `reservation` y `cancellation`.
- **Testing**: JUnit 5, Mockito, `MockRestServiceServer` (Módulo 1) y Testcontainers (PostgreSQL).
- **Performance Goals**: procesamiento local < 200 ms, sin contar la respuesta del Módulo 1 (NFR-001).
- **Constraints**: nunca llamar al Módulo 1 dentro de la transacción; nunca invocar al Módulo 3.
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Contrato REST

`POST /api/reservations/{reservationRef}/cancellation`, cuerpo opcional `{ "reason": "..." }`.

- Roles: `RECEPTIONIST` (canal `RECEPTION`) y `OTA` (canal `OTA_API`, solo sus propias reservas).
- 200 con el resumen de la cancelación. Errores (400 mediante `GlobalExceptionHandler`):

| Caso | `errorCode` | Mensaje |
|---|---|---|
| Referencia vacía o nula | `INVALID_REFERENCE` | "La referencia de la reserva es obligatoria." |
| Reserva inexistente (o de otra agencia) | `RESERVATION_NOT_FOUND` | "La reserva no existe." |
| Estado que no admite cancelación | `INVALID_STATUS` | "El estado actual de la reserva no admite cancelación." |
| Versión desactualizada o cancelación simultánea | `CONCURRENT_UPDATE` | "Esta reserva ya fue actualizada o cancelada recientemente" |
| Falla al notificar la liberación (la cancelación se conserva) | `ROOM_RELEASE_PENDING` | "Reserva cancelada, pero hubo un fallo al notificar la liberación de la habitación. Se reintentará automáticamente." |

### Flujo

1. Localizar con `ReservationQueryService` y validar que esté `ACTIVE` o `PENDING`.
2. **Transacción corta** (con control de `version`): transición a `CANCELLED` mediante `ReservationStatusService`
   dentro de esta misma transacción; insertar `Cancellation` (`COMPLETED`, `channel`, `processedBy`); si
   la reserva es OTA, `CommissionService.zeroOnCancellation`.
3. Confirmada la transacción: si la `startDate` es hoy y el registro local muestra la `Room` apartada por esa
   reserva → `RoomStateOrderService.orderAvailable(RESERVATION_CANCELLED)` de inmediato (fuera de transacción).
   - Confirmada → 200.
   - Falla o sin respuesta → orden `PENDING` para reintento; la cancelación se conserva; respuesta 400 `ROOM_RELEASE_PENDING`.
   - Rechazada por `Occupied` → orden `REJECTED` sin efecto e incidencia; 200.
4. Llegada futura: no se emite ninguna orden.

Solo se cambia el estado dentro de esta transacción; este flujo no pasa por el flujo de modificación de
`update-reservation` (spec), pero comparte `ReservationStatusService`, así que las reglas de transición son las mismas.

### Componentes

| Clase | Ubicación | Responsabilidad |
|---|---|---|
| `CancellationController` | `cancellation/` | Recibe la solicitud y arma la respuesta |
| `CancellationService` | `cancellation/` | Orquesta el flujo |
| `Cancellation`, `CancellationRepository` | `cancellation/` | Auditoría inmutable |
| `CancellationResponse` | `cancellation/dto/` | Resumen de la cancelación |

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/cancellation/
├── CancellationController.java
├── CancellationService.java
├── Cancellation.java
├── CancellationRepository.java
└── dto/CancellationResponse.java
backend/src/test/java/com/hospitua/reservas/
├── unit/cancellation/CancellationServiceTest.java
└── integration/cancellation/CancellationIT.java
frontend/src/pages/CancelReservationDialog.tsx     # cancelación desde la búsqueda de reservas
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| Esc. 1: Recepcionista cancela con llegada hoy y `Room` `Reserved` | `CancellationIT`: `CANCELLED`, `Cancellation` `RECEPTION`, orden `Available` |
| Esc. 2: Ota cancela una reserva suya | Canal `OTA_API`, 200 |
| Esc. 3: llegada futura | Sin orden al Módulo 1 |
| Esc. 4: `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW` | 400 `INVALID_STATUS`, sin órdenes |
| Caso borde: el Módulo 1 no responde | Cancelación conservada, orden `PENDING`, 400 con el mensaje del spec |
| Caso borde: referencia vacía | 400 antes de tocar la lógica |
| Caso borde: dos cancelaciones simultáneas | Una aplica; la otra 400 `CONCURRENT_UPDATE`; un solo `Cancellation` y una sola orden |
| Ota cancela reserva de otra agencia | 400 `RESERVATION_NOT_FOUND` |
| Comisión OTA al cancelar | Importe en cero en la misma transacción |
| Ninguna llamada al Módulo 3 ni al Módulo 1 dentro de la transacción | Verificación en la prueba |

## Phase 3: User Story 1 - Cancelación de reservación y liberación de habitación (Priority: P1)

**Goal**: cancelar sin costo y liberar la habitación el día de la llegada.  
**Independent Test**: los cuatro escenarios del spec y los casos borde.

### Tests

- [ ] T-CAN-01 [P] [US1] `CancellationServiceTest`: flujo y decisiones de emitir o no la orden
- [ ] T-CAN-02 [P] [US1] `CancellationIT`: escenarios 1 a 4 y casos borde, incluida la concurrencia

### Implementation

- [ ] T-CAN-03 [US1] Crear la tabla `cancellation` en el esquema base (coordinado con T007)
- [ ] T-CAN-04 [P] [US1] Crear `Cancellation`, su repositorio y `CancellationResponse`
- [ ] T-CAN-05 [US1] Implementar `CancellationService` (depende de T-UPD-04, T-RSS-08, T-ROC-09 y T-CAN-04)
- [ ] T-CAN-06 [US1] Implementar `CancellationController` con los roles `RECEPTIONIST` y `OTA` y la propiedad de la agencia (depende de T018)
- [ ] T-CAN-07 [P] [US1] Crear `CancelReservationDialog` en el frontend, enlazado desde la búsqueda de reservas

**Checkpoint**: se cancela por ambos canales y la habitación se libera el día de la llegada.

## Dependencies & Execution Order

- Depende de `check-view-reservation`, `set-room-state`, el servicio de transiciones de `update-reservation` (T-UPD-04)
  y de `register-ota-information-commission` (T-ROC-09), y de T007 y T018 del plan base.

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **`processedBy`**: se toma del usuario autenticado (Recepcionista) o de la agencia; falta definir su formato.
2. **Cancelación de una reserva `PENDING` de OTA** antes de que la agencia confirme: el spec la admite; se aplica igual que a `ACTIVE`.
3. **Respuesta 400 cuando la cancelación sí se aplicó** (`ROOM_RELEASE_PENDING`): la pide el spec; el cliente debe distinguirla por `errorCode`.
