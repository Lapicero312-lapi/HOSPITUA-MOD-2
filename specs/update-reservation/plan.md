# Implementation Plan: Actualizar Reservación

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

Feature con tres responsabilidades que comparten las reglas de transición de `Reservation.status` y de
concurrencia: (1) **modificar** una reserva `ACTIVE` o `PENDING` (fechas, categoría, habitación, datos del
huésped y aviso de llegada tardía), con verificación de disponibilidad, recotización con el Módulo 3 y
confirmación previa; (2) **sincronizar el estado** con los avisos de Check-In y Check-Out del Módulo 1
(colas); y (3) el **cierre automático del día** (No-Show). Además provee el servicio de transiciones que
usan las demás features (confirmación OTA, cancelación compensatoria).

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL: `reservation`, `guest`, `reservation_audit`, `reconciliation_incident`, `processed_event`.
- **Testing**: JUnit 5, Mockito, `MockRestServiceServer` (Módulos 1 y 3) y Testcontainers (PostgreSQL y RabbitMQ).
- **Performance Goals**: recotización < 3 s (NFR-001); cada aviso de Check-In o Check-Out < 500 ms (NFR-002); cierre del día con 1000 reservas < 1 min (NFR-003).
- **Constraints**: control de concurrencia optimista con `version`; ninguna llamada al Módulo 1 dentro de una transacción abierta; procesos idempotentes.
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Servicio de transiciones (`ReservationStatusService`, tarea T011 del plan base)

Tabla de transiciones permitidas: `PENDING`→`ACTIVE`, `ACTIVE`→`IN_PROGRESS`, `IN_PROGRESS`→`COMPLETED`,
`ACTIVE` o `PENDING`→`CANCELLED`, `ACTIVE` o `PENDING`→`NO_SHOW`. Cualquier otra → 400. Lo usan este
plan (Check-In, Check-Out, No-Show), `generate-ota-reservation` (confirmación y cancelación
compensatoria) y `cancel-reservation` (dentro de su transacción). Guarda el motivo en una columna
`status_reason` (por ejemplo `ROOM_REJECTED`, `ROOM_UNCONFIRMED`).

### Contrato REST (modificación)

| Petición | Uso |
|---|---|
| `POST /api/reservations/{reservationRef}/modification-preview` | Valida estado y disponibilidad (con `reservationRef` para excluirse), recotiza y devuelve `grossAmount` nuevo y `amountDifference`; **no persiste** |
| `PATCH /api/reservations/{reservationRef}` | Confirma y persiste. Cuerpo: `version`, cambios (`startDate`, `endDate`, `categoryRoom`, `roomId`, datos del `Guest`, `lateArrivalNotice`) y, si cambia el precio, `expectedGrossAmount` |

- Roles: `RECEPTIONIST` (cualquier reserva editable) y `OTA` (solo las de su canal).
- **Confirmación revalidada (D1)**: al confirmar, el servidor vuelve a cotizar y compara con
  `expectedGrossAmount`; si difiere → 400 "La tarifa cambió, vuelva a cotizar". Si solo cambian datos
  personales o `lateArrivalNotice` no se llama al Módulo 3 ni a disponibilidad.
- Errores (400 mediante `GlobalExceptionHandler`): estado no editable, falta de disponibilidad,
  fechas inválidas ("Las nuevas fechas de reserva son inválidas"), caracteres no válidos ("El formato
  de los datos contiene caracteres no válidos."), versión desactualizada ("...debe recargar"), Módulo 3
  sin respuesta ("No se pudo calcular la nueva tarifa en este momento. Intente más tarde."),
  Módulo 1 rechaza o no responde el cambio de habitación.

### Componentes

| Clase | Ubicación | Responsabilidad |
|---|---|---|
| `ReservationModificationController` | `reservation/` | Preview y confirmación |
| `ReservationUpdateService` | `reservation/` | Orquesta la modificación (ver flujo) |
| `ReservationAuditService` + `reservation_audit` | `reservation/` | Bitácora inmutable: quién, cuándo y qué cambió |
| `CheckInEventConsumer`, `CheckOutEventConsumer` | `messaging/` | Escuchan `habitacion.checkin` y `habitacion.checkout` |
| `EndOfDayNoShowJob` | `jobs/` | Cierre del día; usa `JobLockService` (de `set-room-state`) |

### Flujo de la modificación

1. Cargar la reserva (`ReservationQueryService`) y validar que esté `ACTIVE` o `PENDING`.
2. Validar entrada (fechas, formatos, caracteres).
3. Si cambian fechas, categoría o habitación: `AvailabilityService.check(..., reservationRef)`.
4. Si cambian fechas o categoría: `RateQuoteService.requote(...)` con `previousGrossAmount`.
5. Preview termina aquí. La confirmación revalida (D1) y sigue.
6. Si hay cambio de habitación con llegada hoy: `RoomStateOrderService.changeRoom` pide `Reserved` a la nueva
   (fuera de transacción); si el Módulo 1 rechaza o no responde, se aborta y se neutraliza si fue ambiguo.
7. Transacción corta: aplicar cambios con control de `version`, guardar auditoría. Si la versión falla
   después de haber apartado la habitación nueva, se compensa con `Available` de mayor secuencia.
8. Si el cambio movió la llegada hacia o desde hoy (`DATES_CHANGED`), o cambió la habitación: ordenar
   `Available` para la anterior; si falla solo esta, el cambio se conserva, la orden queda `PENDING` y se
   responde 400 "La reserva se actualizó, pero la liberación de la habitación anterior quedó pendiente".

### Avisos del Módulo 1 (traducción de C1)

| Caso | Comportamiento |
|---|---|
| Check-In válido con la reserva en `ACTIVE` | `→ IN_PROGRESS`; si es extranjero, `MigratoryMovementService.register`; confirma |
| Check-In con la reserva ya en `IN_PROGRESS` | Idempotente; solo completa un movimiento `INCOMPLETE` si trae datos completos |
| Check-In con la reserva inexistente o en `PENDING`, `COMPLETED`, `CANCELLED`, `NO_SHOW` | `ReconciliationIncident` (`CHECK_IN`), sin cambiar estado, confirma |
| Check-In antes de la `startDate` | Se procesa normalmente |
| Check-Out válido con la reserva en `IN_PROGRESS` | `→ COMPLETED`; no toca la `Room`; confirma |
| Check-Out con la reserva ya `COMPLETED` | Idempotente |
| Check-Out con la reserva inexistente o en otro estado | `ReconciliationIncident` (`CHECK_OUT`), confirma |
| Payload vacío o sin `reservationRef` | Dead-letter queue |
| Falla temporal | Reintentos y dead-letter (plan base) |

### Cierre del día (No-Show)

- Se ejecuta al cierre del día operativo con la zona horaria del hotel, con bloqueo asesor (C10).
- Recorre las reservas con `startDate` de hoy en `ACTIVE` o `PENDING` y **sin** `lateArrivalNotice`.
- Cada reserva se procesa en su propia transacción: `NO_SHOW` si `source = OTA`; `CANCELLED` si `DIRECT`
  (sin `Cancellation` ni comisión). Después `RoomStateOrderService.orderAvailable` (solo si estaba `Reserved`).
- Un error en un registro se captura, se registra y el lote continúa; la ejecución repetida no cambia nada.

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/
├── reservation/
│   ├── ReservationStatusService.java             # T011 del plan base
│   ├── ReservationModificationController.java
│   ├── ReservationUpdateService.java
│   ├── ReservationAuditService.java
│   └── dto/ModificationPreviewResponse.java, ModificationRequest.java
├── messaging/
│   ├── CheckInEventConsumer.java
│   └── CheckOutEventConsumer.java
└── jobs/EndOfDayNoShowJob.java
backend/src/test/java/com/hospitua/reservas/
├── unit/reservation/ReservationStatusServiceTest.java
├── integration/reservation/ReservationUpdateIT.java
├── integration/messaging/CheckInCheckOutConsumersIT.java
└── integration/jobs/EndOfDayNoShowJobIT.java
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| US1 Esc. 1: fechas o categoría con recálculo | `ReservationUpdateIT`: preview con diferencia, confirmación, `version` incrementada, auditoría |
| US1 Esc. 2: solo datos personales | Sin llamada al Módulo 3 ni a disponibilidad |
| US1 Esc. 3: cambio de estado por proceso interno | `ReservationStatusServiceTest`: todas las transiciones y las rechazadas |
| US1 Esc. 4: sin disponibilidad | 400 |
| US1 Esc. 5: estado no editable | 400 en `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| US1 Esc. 6 y 7: cambio de habitación hoy y futura | Órdenes en el orden correcto; la futura no envía ninguna |
| Casos borde: Módulo 3 caído, fechas, caracteres, ediciones simultáneas | 400 y `version` |
| Casos borde: `DATES_CHANGED` y fallo solo en la liberación | Orden `PENDING` y mensaje de liberación pendiente |
| D1: la tarifa cambia entre preview y confirmación | 400 "La tarifa cambió" |
| US2 Esc. 1 a 6: Check-In y Check-Out | `CheckInCheckOutConsumersIT` con RabbitMQ real: transiciones, incidencias, duplicados |
| Idempotencia y dead-letter | Mismo `eventId` dos veces; mensaje inválido a la dead-letter queue |
| US3 Esc. 1 a 5: cierre del día | `EndOfDayNoShowJobIT`: OTA `NO_SHOW`, directa `CANCELLED`, ignora `IN_PROGRESS` y llegada tardía, fallo aislado |
| Cierre del día repetido y otra zona horaria | Idempotente; reloj del hotel |
| NFR-003 | Lote de 1000 reservas < 1 min |

## Phase 3: User Story 1 - Modificación de datos de reservación (Priority: P1)

**Goal**: modificar fechas, categoría, habitación o datos con disponibilidad y tarifa validadas.  
**Independent Test**: los siete escenarios de la Historia 1.

### Tests

- [ ] T-UPD-01 [P] [US1] `ReservationStatusServiceTest`: tabla de transiciones y motivo
- [ ] T-UPD-02 [P] [US1] `ReservationUpdateIT`: escenarios 1, 2, 4, 5, 6 y 7 y los casos borde

### Implementation

- [ ] T-UPD-03 [US1] Agregar `status_reason`, `late_arrival_notice` y `reservation_audit` al esquema base (T007)
- [ ] T-UPD-04 [US1] Completar `ReservationStatusService` (T011) con el motivo y la auditoría
- [ ] T-UPD-05 [P] [US1] Crear `ReservationAuditService`
- [ ] T-UPD-06 [US1] Implementar `ReservationUpdateService` (depende de T-CRA-07, T-CDR-10, T-RSS-08 y T-UPD-04)
- [ ] T-UPD-07 [US1] Implementar `ReservationModificationController` con preview y confirmación, roles y propiedad de la Ota (depende de T018)
- [ ] T-UPD-08 [US1] Aplicar la confirmación revalidada (D1)
- [ ] T-UPD-16 [P] [US1] Crear `ModifyReservationPage` en el frontend (edición, vista previa con la diferencia, aviso de llegada tardía y confirmación)

**Checkpoint**: la Recepcionista y la Ota modifican reservas con la diferencia visible antes de confirmar.

## Phase 4: User Story 2 - Sincronización por avisos de Check-In y Check-Out (Priority: P2)

**Goal**: que el estado de la reserva siga al del Módulo 1.  
**Independent Test**: los seis escenarios de la Historia 2 con RabbitMQ real.

### Tests

- [ ] T-UPD-09 [P] [US2] `CheckInCheckOutConsumersIT`: transiciones, incidencias, duplicados y dead-letter

### Implementation

- [ ] T-UPD-10 [P] [US2] Implementar `CheckInEventConsumer` (usa `MigratoryMovementService`, T-PFG-06)
- [ ] T-UPD-11 [P] [US2] Implementar `CheckOutEventConsumer`
- [ ] T-UPD-12 [US2] Configurar las colas, reintentos y dead-letter de `habitacion.checkin` y `habitacion.checkout` (T013)

**Checkpoint**: Check-In y Check-Out del Módulo 1 se reflejan en la reserva con incidencias para lo que no se puede aplicar.

## Phase 5: User Story 3 - Cierre automático del día: No-Show (Priority: P2)

**Goal**: cerrar las reservas no presentadas según su canal y liberar la habitación.  
**Independent Test**: los cinco escenarios de la Historia 3.

### Tests

- [ ] T-UPD-13 [P] [US3] `EndOfDayNoShowJobIT`: canales, exclusiones, fallo aislado, idempotencia y rendimiento

### Implementation

- [ ] T-UPD-14 [US3] Implementar `EndOfDayNoShowJob` con transacción por reserva (depende de T-RSS-09, T-RSS-08 y T010)
- [ ] T-UPD-15 [US3] Configurar la hora de cierre del día y la zona horaria

**Checkpoint**: al cierre del día las reservas sin ingreso quedan cerradas y sus habitaciones liberadas.

## Dependencies & Execution Order

- Depende de `check-view-reservation`, `check-room-availability`, `calculate-dynamic-rate`, `set-room-state`
  y `process-foreign-guest-data`, y de T007, T011, T013, T015 y T018 del plan base.
- Lo consumen `generate-ota-reservation` y `cancel-reservation` (servicio de transiciones).
- Dentro de la feature: transiciones y auditoría → modificación → consumidores → cierre del día.

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Motivo de las transiciones** (decidido: D6) (`ROOM_REJECTED`, `ROOM_UNCONFIRMED`): se propone la columna `status_reason`; falta agregarla al diccionario.
2. **Identidad de la Ota**: cómo se autentica y cómo se asocia a `ota_id` para restringirla a sus reservas.
3. **Campos que puede editar la Ota**: el spec dice que la Recepcionista o la Ota modifican; falta precisar si la Ota puede cambiar datos del huésped.
4. **Forma de la API de modificación** (decidido: D8) (preview y confirmación con `PATCH`): propuesta propia, no viene en el spec.
5. **Hora del cierre del día operativo** y del inicio del día: configurables, sin valor definido.
6. **Reintentos de los consumidores** (cuántos y con qué espera): NEEDS CLARIFICATION.
