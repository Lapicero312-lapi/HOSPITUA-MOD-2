# Implementation Plan: Generar Reservación por OTA

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

Endpoint de integración por el que una agencia (OTA) envía sus reservas de sistema a sistema. Valida
la estructura y el `externalConfirmationCode`, verifica disponibilidad, calcula la comisión y guarda
la reserva en `PENDING` con el valor que envía la agencia (no se cotiza con el Módulo 3, decisión C5). Si
la llegada es hoy, pide `Reserved` al Módulo 1 y la creación es todo o nada (C9). Cuando la agencia
confirma el pago o la garantía, la reserva pasa a `ACTIVE`. Usa la restricción de exclusión (D3) para
la última habitación.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL: `reservation`, `guest`, `ota`.
- **Testing**: JUnit 5, Mockito, `MockRestServiceServer` (Módulo 1) y Testcontainers (PostgreSQL).
- **Performance Goals**: procesamiento transaccional < 1,5 s (NFR-001).
- **Constraints**: respuestas JSON siempre 4xx en error (400 y 409); la Ota solo opera con su propio canal; nunca llamar al Módulo 3.
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Contrato REST (rol `OTA`; la agencia se toma de la credencial)

| Petición | Uso |
|---|---|
| `POST /api/ota/reservations` | Crea la reserva. Cuerpo: `startDate`, `endDate`, `categoryRoom` o `roomId`, `guest`, `totalAmount`, `currency`, `externalConfirmationCode`. 201 con el identificador interno |
| `POST /api/ota/reservations/{reservationRef}/confirmation` | La agencia confirma pago o garantía: `PENDING` → `ACTIVE`. 200; idempotente si ya está `ACTIVE` |

Errores (cuerpo JSON `{ errorCode, message }`):

| Caso | HTTP | `errorCode` |
|---|---|---|
| Estructura inválida, campos obligatorios ausentes, fechas incoherentes, caracteres maliciosos | 400 | `INVALID_REQUEST` |
| `externalConfirmationCode` ausente o vacío | 400 | `MISSING_CONFIRMATION_CODE` |
| Código repetido para la misma agencia | 400 | `DUPLICATE_CONFIRMATION_CODE` |
| Porcentaje de comisión inválido | 400 | `INVALID_COMMISSION_PERCENTAGE` |
| Sin disponibilidad o pérdida de la última habitación | 409 | `NO_AVAILABILITY` ("No hay disponibilidad para la habitación seleccionada") |
| El Módulo 1 rechazó el apartado de hoy | 409 | `NO_AVAILABILITY` |
| El Módulo 1 no respondió | 400 | `ROOM_UNCONFIRMED` |

### Flujo de la creación

1. Validar estructura y `externalConfirmationCode`; sanear el huésped. Sin llamar a nadie si es inválida.
2. `AvailabilityService.check` (fresco); elegir la habitación (la indicada o la primera candidata).
3. `CommissionService.registerOnCreation(otaId, totalAmount, externalConfirmationCode)` (de `register-ota-information-commission`).
4. **Transacción corta**: buscar o crear el `Guest`, crear la `Reservation` `PENDING` (`source = OTA`,
   `gross_amount = totalAmount`, `gross_amount_currency`, comisión, código). La restricción de exclusión
   (D3) o la de código único rechazan las condiciones de carrera; sin candidatas → 409.
5. Si la `startDate` es hoy: `RoomStateOrderService.orderReserved(RESERVATION_CREATED)` fuera de transacción.
   Rechazo → cancelar (`ROOM_REJECTED`) y 409; sin respuesta → cancelar (`ROOM_UNCONFIRMED`), neutralizar con
   `Available` de mayor secuencia y 400. Con llegada futura no se llama al Módulo 1.
6. 201 con el identificador interno.

Confirmación de pago o garantía: la reserva debe pertenecer a la agencia; se usa `ReservationStatusService`
(`PENDING` → `ACTIVE`). Si la agencia nunca confirma, la reserva sigue `PENDING` y puede cancelarse o pasar a
`NO_SHOW` en el cierre del día.

### Componentes

| Clase | Ubicación | Responsabilidad |
|---|---|---|
| `OtaReservationController` | `ota/` | Creación y confirmación |
| `OtaReservationService` | `ota/` | Orquesta el flujo de arriba |
| `OtaReservationRequest` | `ota/dto/` | Contrato con validación (Bean Validation) |
| `OtaPrincipalResolver` | `ota/` | Obtiene la `Ota` de la credencial |

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/ota/
├── OtaReservationController.java
├── OtaReservationService.java
├── OtaPrincipalResolver.java
└── dto/OtaReservationRequest.java
backend/src/test/java/com/hospitua/reservas/
├── unit/ota/OtaReservationServiceTest.java
└── integration/ota/OtaReservationIT.java
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| Esc. 1: reserva exitosa | `OtaReservationIT`: `PENDING`, código y comisión persistidos, 201 |
| Esc. 2: confirmación de pago | `PENDING` → `ACTIVE`, 200; repetida, idempotente |
| Esc. 3: sin disponibilidad | 409 `NO_AVAILABILITY`, sin reserva |
| Esc. 4: código ausente o vacío | 400 antes de verificar disponibilidad |
| Esc. 5: llegada futura | 201 sin llamar al Módulo 1 |
| Llegada hoy: confirmado, rechazado y sin respuesta | Órdenes y compensaciones; 201, 409 y 400 |
| Caso borde: fechas inválidas | 400 |
| Caso borde: caracteres maliciosos en el huésped | 400 y nada almacenado |
| Caso borde: dos agencias por la última habitación | Una gana; la otra 409 |
| Caso borde: agencia que no confirma | Sigue `PENDING`; se puede cancelar |
| Ninguna llamada al Módulo 3 | Verificación en la prueba |
| Confirmación de una reserva de otra agencia | 400 (tratada como inexistente) |

## Phase 3: User Story 1 - Procesamiento de reservación por API externa (Priority: P1)

**Goal**: recibir la reserva de una agencia con disponibilidad y comisión, en `PENDING` hasta su confirmación.  
**Independent Test**: los cinco escenarios del spec y los casos borde.

### Tests

- [ ] T-GOR-01 [P] [US1] `OtaReservationServiceTest`: orden del flujo y compensaciones
- [ ] T-GOR-02 [P] [US1] `OtaReservationIT`: escenarios 1 a 5 y casos borde
- [ ] T-GOR-03 [P] [US1] `OtaReservationIT`: concurrencia por la última habitación (D3)

### Implementation

- [ ] T-GOR-04 [P] [US1] Crear `OtaReservationRequest` con las validaciones y `OtaPrincipalResolver`
- [ ] T-GOR-05 [US1] Implementar `OtaReservationService` (depende de T-CRA-07, T-ROC-05, T-RSS-08, T-UPD-04 y T-GDR-04)
- [ ] T-GOR-06 [US1] Implementar `OtaReservationController` con creación y confirmación, y el rol `OTA` (depende de T018)
- [ ] T-GOR-07 [US1] Registrar en `GlobalExceptionHandler` los códigos y el 409 de disponibilidad

**Checkpoint**: una agencia crea y confirma reservas sin transcripción manual y sin doble venta.

## Dependencies & Execution Order

- Depende de `check-room-availability`, `set-room-state`, `register-ota-information-commission` (debe ir antes),
  del servicio de transiciones de `update-reservation` y de `GuestService` de `generate-direct-reservation`.
- **No** depende de `calculate-dynamic-rate` (decisión C5).

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Autenticación de la Ota** (clave de API, OAuth2 de cliente) y cómo se liga a `ota_id`.
2. **`currency`**: el spec no la incluye en el payload de la agencia; D2 la exige en la reserva. Se propone que la agencia la envíe.
3. **Reintento de la agencia tras un timeout**: el spec rechaza el código repetido con 400; una respuesta idempotente (devolver la reserva ya creada) sería más amable. Se sigue el spec.
4. **Cómo elige habitación una OTA**: el spec dice "habitación o categoría"; se aplica la misma regla que en la reserva directa.
5. **Cómo notifica la agencia el pago o la garantía**: propuesta `POST .../confirmation`, no definida en el spec.
