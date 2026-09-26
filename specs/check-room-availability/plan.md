# Implementation Plan: Verificar Disponibilidades

**Date**: 2026-09-26
**Spec**: [spec.md](./spec.md)
**Plan base**: [../base/plan.md](../base/plan.md)

## Summary

Verificación única de disponibilidad, reutilizada por generar reserva directa, generar reserva OTA y
actualizar reserva. Combina tres fuentes con la triple validación del diccionario: el calendario de
mantenimientos (Módulo 1), las reservas locales (Módulo 2) y, cuando la estadía incluye el día en
curso, el inventario físico (Módulo 1). Admite consulta por habitación (`roomId`) o por categoría
(`categoryRoom`) y excluye la propia reserva al modificar. Es un servicio interno
(`AvailabilityService`) que orquesta las tres features del grupo 1; no expone endpoint ni aparta nada.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

**Storage**: PostgreSQL, tabla `reservation` (consulta de solapamiento con índice `(room_id, start_date, end_date)`).
**Testing**: JUnit 5 + Mockito para la orquestación; Testcontainers (PostgreSQL) para la consulta de solapamiento.
**Performance Goals**: verificación completa < 2 s (NFR-001).
**Constraints**: solo lectura; no bloquea habitaciones; nunca asume disponibilidad si el Módulo 1 falla.
**Scale/Scope**: NEEDS CLARIFICATION (número de habitaciones por categoría).

## Diseño técnico

### Interfaz interna

```java
AvailabilityResult check(AvailabilityQuery query);
// AvailabilityQuery: roomId | categoryRoom (exactamente uno), startDate, endDate, reservationRef (opcional)
// AvailabilityResult: available, candidateRooms[(id, roomNumber, categoryRoom)], reasons[]
```

`reasons` (cuando no hay disponibilidad): `MAINTENANCE`, `LOCAL_RESERVATION_OVERLAP`, `ROOM_OCCUPIED`,
`ROOM_RESERVED_BY_OTHER`, `NO_ROOMS_IN_CATEGORY`.

### Algoritmo

1. **Validar** entrada: fechas (`DateRangeValidator`), un solo de `roomId` o `categoryRoom`, formato de
   identificadores. Sin llamar a nadie si es inválida (400).
2. **Habitaciones candidatas**: por `roomId`, la propia habitación; por `categoryRoom`, las habitaciones
   de la categoría que informa el Módulo 1, excluyendo las `Inactive`.
3. **Calendario** (Módulo 1): descartar las habitaciones con mantenimiento que cruza el rango
   (`MaintenanceCalendarService`).
4. **Reservas locales**: descartar las habitaciones con otra reserva en `PENDING`, `ACTIVE` o
   `IN_PROGRESS` que solape el rango, excluyendo la `reservationRef` recibida
   (`ReservationRepository.existsOverlap`). Las `COMPLETED`, `CANCELLED` y `NO_SHOW` no cuentan.
5. **Estado físico**, solo si la estadía incluye el día en curso (fecha según el reloj del hotel):
   se acepta `Available`, o `Reserved` cuyo `reservedByReservationRef` coincide con la `reservationRef`
   recibida; se descarta `Occupied` y `Reserved` por otra reserva. Para las estadías futuras el estado
   físico no se consulta.
6. **Resultado**: `available = candidateRooms no vacío`; si queda vacío se devuelven los motivos.

Consulta de solapamiento: `start_date < :end AND end_date > :start` (la estadía ocupa hasta la noche
anterior a `endDate`), `status IN (...)` y `reservation_ref <> :ref` cuando se recibe.

### Errores (400 mediante `GlobalExceptionHandler`)

| Caso | `errorCode` | Mensaje |
|---|---|---|
| Módulo 1 sin respuesta o timeout en el calendario o el inventario | `MODULE1_UNAVAILABLE` | "No es posible validar mantenimientos en este momento. Intente de nuevo." |
| Fechas inválidas | `INVALID_DATE_RANGE` | "Rango de fechas inválido. Verifique las fechas seleccionadas." |
| `roomId` inexistente o con caracteres inválidos | `INVALID_ROOM_ID` | "El identificador de la habitación es inválido." |

`AvailabilityService` captura las excepciones de los servicios de inventario y calendario y las
convierte en `MODULE1_UNAVAILABLE`, sin asumir disponibilidad (FR-005).

### Rendimiento

En el modo categoría, las consultas de calendario por habitación se hacen en paralelo con hilos
virtuales (Java 21) y un tope de concurrencia configurable (`hospitua.availability.max-parallel`),
para respetar los 2 s. Tope de candidatas por categoría: NEEDS CLARIFICATION.

### Concurrencia (fuera del alcance de esta feature, pero condiciona su diseño)

La verificación no bloquea (caso borde del spec): dos verificaciones simultáneas pueden responder
disponible. La creación revalida al insertar. **Propuesta**: una restricción de exclusión en PostgreSQL
sobre `reservation` (`EXCLUDE USING gist (room_id WITH =, daterange(start_date, end_date) WITH &&)
WHERE (status IN ('PENDING','ACTIVE','IN_PROGRESS'))`, con la extensión `btree_gist`) hace imposible
que dos reservas activas se solapen en la misma habitación, incluso con concurrencia. Ver Preguntas abiertas.

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/availability/
├── AvailabilityService.java
├── AvailabilityQuery.java
├── AvailabilityResult.java
├── UnavailabilityReason.java
└── RoomCandidateResolver.java            # candidatas por roomId o por categoría
backend/src/main/java/com/hospitua/reservas/reservation/ReservationRepository.java   # existsOverlap
backend/src/test/java/com/hospitua/reservas/
├── unit/availability/AvailabilityServiceTest.java
└── integration/availability/ReservationOverlapIT.java
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| Esc. 1: libre | `AvailabilityServiceTest`: sin mantenimiento ni cruce → `available` con candidatas |
| Esc. 2: mantenimiento | Calendario con cruce → `MAINTENANCE` |
| Esc. 3: reserva cruzada | `ReservationOverlapIT` con PostgreSQL: cruce total, parcial y contiguo |
| Esc. 4: estadía que incluye hoy | Habitación `Occupied` o `Reserved` por otra → no disponible; reloj fijo con `Clock` de prueba |
| Esc. 5: modificación | `ReservationOverlapIT`: la propia reserva excluida por `reservationRef` |
| Esc. 6: reservas históricas | `COMPLETED`, `CANCELLED`, `NO_SHOW` no bloquean |
| Esc. 7: apartado propio de hoy | `Reserved` con `reservedByReservationRef` igual → disponible |
| Caso borde: Módulo 1 sin respuesta | Mockito lanza `Module1UnavailableException` → `MODULE1_UNAVAILABLE`, nunca `available` |
| Caso borde: fechas o `roomId` inválidos | 400 sin llamadas a otros servicios |
| Caso borde: verificaciones simultáneas | Ambas devuelven disponible, sin bloqueo |
| Estadía futura | No se llama al inventario en modo `roomId` |
| Modo categoría | Se descartan `Inactive`; varias candidatas; ninguna candidata → `NO_ROOMS_IN_CATEGORY` |
| NFR-001 | Prueba de humo con 50 candidatas y Módulo 1 simulado, umbral 2 s |

## Phase 3: User Story 1 - Consulta y validación de disponibilidad (Priority: P1)

**Goal**: saber si hay una habitación asignable para el rango, con la triple validación.
**Independent Test**: los siete escenarios del spec con el Módulo 1 simulado y PostgreSQL real.

### Tests

- [ ] T-CRA-01 [P] [US1] `ReservationOverlapIT`: solapamiento, exclusión de la propia reserva y estados que no bloquean
- [ ] T-CRA-02 [P] [US1] `AvailabilityServiceTest`: escenarios 1, 2, 4, 6 y 7 y los casos borde
- [ ] T-CRA-03 [P] [US1] Prueba de humo de rendimiento del modo categoría

### Implementation

- [ ] T-CRA-04 [US1] Agregar `existsOverlap` a `ReservationRepository` y el índice `(room_id, start_date, end_date)` al esquema base (T007)
- [ ] T-CRA-05 [P] [US1] Crear `AvailabilityQuery`, `AvailabilityResult` y `UnavailabilityReason`
- [ ] T-CRA-06 [US1] Implementar `RoomCandidateResolver` sobre `RoomInventoryService` (depende de T-CRI-06)
- [ ] T-CRA-07 [US1] Implementar `AvailabilityService` con el algoritmo de 6 pasos (depende de T-CMC-07, T-CRA-04 a T-CRA-06 y T010 del plan base)
- [ ] T-CRA-08 [US1] Paralelizar la consulta del calendario con hilos virtuales y tope configurable
- [ ] T-CRA-09 [US1] Registrar en `GlobalExceptionHandler` la conversión a `MODULE1_UNAVAILABLE`, `INVALID_DATE_RANGE` e `INVALID_ROOM_ID`

**Checkpoint**: los tres flujos de reserva pueden verificar disponibilidad con una sola llamada.

## Dependencies & Execution Order

- Depende de `check-view-reservation` (repositorio de reservas), `consult-room-inventory`,
  `consult-maintenance-calendar` y de T010 (reloj del hotel) y T009 (errores) del plan base.
- Lo consumen `generate-direct-reservation`, `generate-ota-reservation` y `update-reservation`.

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Inventario por categoría para estadías futuras**: `consult-room-inventory` devuelve por categoría
   **solo** las habitaciones `Available`, pero para una estadía futura hace falta el listado de **todas**
   las habitaciones de la categoría (una `Occupied` hoy puede estar libre dentro de un mes). Se propone
   que el Módulo 1 permita listar sin filtrar por estado. Esto afecta el spec de `consult-room-inventory`.
2. **Restricción de exclusión** en PostgreSQL para impedir reservas solapadas en la misma habitación
   (extensión `btree_gist`): ¿se adopta? Recomendada; simplifica la concurrencia de las features de creación.
3. **Habitaciones `Inactive`** se excluyen siempre (el spec no lo dice; el diccionario las define como dadas de baja).
4. **Tope de habitaciones candidatas** por categoría y valor de `hospitua.availability.max-parallel`.
