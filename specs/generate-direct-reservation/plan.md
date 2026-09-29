# Implementation Plan: Generar Reservación Directa

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

La Recepcionista registra una reserva de canal directo: verifica disponibilidad, obtiene la tarifa del
Módulo 3 de forma informativa, captura al huésped y confirma. La reserva nace `ACTIVE`, sin cobro, con
comisión 0. Si la llegada es hoy, pide `Reserved` al Módulo 1 y la creación es todo o nada; si es futura,
no depende del Módulo 1. Sigue el patrón "guardar primero, ordenar después y compensar si falla" (C9) y
usa la restricción de exclusión de PostgreSQL (D3) para resolver la última habitación.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL: `reservation`, `guest`.
- **Testing**: JUnit 5, Mockito, `MockRestServiceServer` (Módulos 1 y 3) y Testcontainers (PostgreSQL) para concurrencia.
- **Performance Goals**: verificación local de reservas cruzadas < 200 ms (NFR-001); flujo completo por Recepción < 1 minuto (SC-001).
- **Constraints**: nunca llamar al Módulo 1 dentro de una transacción abierta; nunca aceptar un importe enviado por el cliente (D1).
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Contrato REST (rol `RECEPTIONIST`)

| Petición | Uso |
|---|---|
| `POST /api/reservations/direct/preview` | Cuerpo: `startDate`, `endDate`, `categoryRoom` o `roomId`. Verifica disponibilidad y cotiza; devuelve la habitación propuesta y `grossAmount`. No persiste |
| `POST /api/reservations/direct` | Cuerpo: las mismas fechas y categoría o habitación, `guest`, `expectedGrossAmount`. Crea la reserva; responde 201 con el detalle |

Errores (400 mediante `GlobalExceptionHandler`):

| Caso | `errorCode` | Mensaje |
|---|---|---|
| Fechas o datos del huésped inválidos | `INVALID_REQUEST` | "amigable" por campo, sin consultar disponibilidad ni al Módulo 3 |
| Sin disponibilidad, o pérdida de la última habitación | `NO_AVAILABILITY` | "Error 400: La habitación no está disponible para el rango de fechas solicitado" |
| Módulo 3 sin respuesta | `PRICING_UNAVAILABLE` | "Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde" |
| La tarifa cambió entre la vista previa y la confirmación | `RATE_CHANGED` | "La tarifa cambió, vuelva a cotizar" |
| El Módulo 1 rechazó el apartado de hoy | `ROOM_REJECTED` | "La habitación ya no está disponible" |
| El Módulo 1 no respondió | `ROOM_UNCONFIRMED` | "No se pudo confirmar la habitación" |

### Flujo de la confirmación

1. Validar entrada (fechas, formatos, caracteres del huésped).
2. `AvailabilityService.check` (fresco); elegir la habitación: la indicada o la primera candidata.
3. `RateQuoteService.quoteNew` y comparar con `expectedGrossAmount` (D1).
4. **Transacción corta**: buscar o crear el `Guest`, crear la `Reservation` `ACTIVE` (`source = DIRECT`,
   `commission_* = 0`, `external_confirmation_code = null`, `gross_amount` y `gross_amount_currency`). Si la
   restricción de exclusión rechaza la habitación (D3), se prueba la siguiente candidata; sin candidatas → `NO_AVAILABILITY`.
5. Si la `startDate` es hoy: `RoomStateOrderService.orderReserved(RESERVATION_CREATED)` (fuera de transacción).
   - Confirmado → 201.
   - Rechazado por `Occupied` → cancelar con motivo `ROOM_REJECTED` → 400.
   - Sin respuesta → cancelar con `ROOM_UNCONFIRMED`, neutralizar con `Available` de mayor secuencia → 400.
6. Si la `startDate` es futura: 201 sin llamar al Módulo 1; la habitación se aparta al iniciar el día operativo.

La cancelación compensatoria usa `ReservationStatusService` (transición `ACTIVE` → `CANCELLED` con `status_reason`, D6);
queda la reserva `CANCELLED` como evidencia y el solicitante puede reintentar.

### Huésped

- Se reutiliza el `Guest` por `documentNumber`; si no existe, se crea con `fullName`, `nationality`,
  `contactPhone` y `contactEmail`, sanitizando el texto libre.
- `Guest.type`: `FOREIGN` si la nacionalidad no es la del país del hotel (`hospitua.hotel.country`), `NATIONAL` en otro caso.

### Componentes

| Clase | Ubicación | Responsabilidad |
|---|---|---|
| `DirectReservationController` | `reservation/` | Vista previa y confirmación |
| `DirectReservationService` | `reservation/` | Orquesta el flujo de arriba |
| `ReservationRefGenerator` | `reservation/` | Genera el `reservationRef` único |
| `GuestService` | `guest/` | Buscar o crear, sanitizar, determinar `type` |
| `CreateReservationRequest`, `DirectReservationPreviewResponse` | `reservation/dto/` | Contratos |

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/
├── reservation/
│   ├── DirectReservationController.java
│   ├── DirectReservationService.java
│   ├── ReservationRefGenerator.java
│   └── dto/CreateReservationRequest.java, DirectReservationPreviewResponse.java
└── guest/GuestService.java
backend/src/test/java/com/hospitua/reservas/
├── unit/reservation/DirectReservationServiceTest.java
└── integration/reservation/DirectReservationIT.java
frontend/src/pages/NewDirectReservationPage.tsx      # formulario de la Recepcionista
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| Esc. 1: reserva exitosa | `DirectReservationIT`: `ACTIVE`, `grossAmount`, comisión 0, `source DIRECT`, código nulo |
| Esc. 2: sin disponibilidad | 400 antes de cotizar; cero llamadas al Módulo 3 |
| Esc. 3: Módulo 3 caído | 400, no se persiste ninguna reserva |
| Esc. 4: llegada futura | 201 sin llamar al Módulo 1 |
| Llegada hoy: Módulo 1 confirma | Orden `Reserved` con el detalle; 201 |
| Caso borde: rechazo `Occupied` | Reserva `CANCELLED` con `ROOM_REJECTED` y 400 |
| Caso borde: Módulo 1 sin respuesta | `ROOM_UNCONFIRMED`, orden `Available` de mayor secuencia y 400 |
| Caso borde: fechas incoherentes | 400 sin consultar disponibilidad ni tarifa |
| Caso borde: dos solicitudes por la última habitación | `DirectReservationIT` con dos hilos: una `ACTIVE` y la otra 400 `NO_AVAILABILITY` |
| D1: la tarifa cambia | 400 `RATE_CHANGED` |
| Ninguna transacción abierta durante la llamada al Módulo 1 | Verificación en la prueba de integración |
| Huésped existente y nuevo, y caracteres no válidos | `GuestService` |

## Phase 3: User Story 1 - Creación de reservación directa (Priority: P1)

**Goal**: registrar una reserva directa confirmada, con tarifa informativa y apartado el día de la llegada.  
**Independent Test**: los cuatro escenarios del spec y los casos borde.

### Tests

- [ ] T-GDR-01 [P] [US1] `DirectReservationServiceTest`: orden del flujo, compensaciones y D1
- [ ] T-GDR-02 [P] [US1] `DirectReservationIT`: escenarios 1 a 4 y casos borde
- [ ] T-GDR-03 [P] [US1] `DirectReservationIT`: concurrencia por la última habitación (D3)

### Implementation

- [ ] T-GDR-04 [P] [US1] Crear `ReservationRefGenerator` y `GuestService`
- [ ] T-GDR-05 [P] [US1] Crear los contratos `CreateReservationRequest` y `DirectReservationPreviewResponse`
- [ ] T-GDR-06 [US1] Implementar `DirectReservationService` (depende de T-CRA-07, T-CDR-06, T-RSS-08, T-UPD-04 y T-GDR-04)
- [ ] T-GDR-07 [US1] Implementar `DirectReservationController` con vista previa y confirmación, y el rol `RECEPTIONIST` (depende de T018)
- [ ] T-GDR-08 [US1] Traducir la violación de la restricción de exclusión a la siguiente candidata o a `NO_AVAILABILITY`
- [ ] T-GDR-09 [US1] Crear `NewDirectReservationPage` en el frontend con vista previa, datos del huésped y confirmación

**Checkpoint**: la Recepcionista crea reservas directas en menos de 1 minuto, sin sobreventas.

## Dependencies & Execution Order

- Depende de `check-view-reservation`, `check-room-availability`, `calculate-dynamic-rate`, `set-room-state`
  y del servicio de transiciones de `update-reservation` (T-UPD-04), y de T007, T008, T010 y T018 del plan base.
- Lo consume el resto del ciclo de vida (modificación, cancelación, Check-In).

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Formato del `reservationRef`**: longitud y estructura (propuesta: prefijo, año y consecutivo o UUID corto).
2. **Cómo elegir la habitación** cuando la Recepcionista indica solo la categoría: se propone la de menor `roomNumber` entre las candidatas.
3. **País del hotel** para determinar `Guest.type` (`hospitua.hotel.country`): NEEDS CLARIFICATION.
4. **Búsqueda del huésped existente**: por `documentNumber`; falta definir si el tipo de documento también identifica.
5. **Datos que el spec pide del huésped**: `fullName`, `documentNumber`, `nationality`, `contactPhone`, `contactEmail`; falta cuáles son obligatorios.
