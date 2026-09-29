# Implementation Plan: Registrar Confirmación y Comisión de OTA

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

Caso de uso interno que calcula y asienta la comisión de cada reserva de canal OTA en el momento de
registrarla, la ajusta a cero cuando la reserva se cancela y permite conciliarla cada mes
(`RECONCILED` o `PAID`). Además administra las agencias (`Ota`: nombre y porcentaje contractual) y las
expone al Módulo 3 (`GET /api/otas/{otaId}`, decisión C3a). Fórmula decidida (C7):
`commissionAmount = grossAmount × commissionPercentage / 100`, con `BigDecimal`, 2 decimales y `HALF_UP`.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL: `ota`, `commission_audit` y las columnas de comisión de `reservation`.
- **Testing**: JUnit 5, Mockito y Testcontainers (PostgreSQL).
- **Performance Goals**: cálculo y registro < 1 s (NFR-001).
- **Constraints**: precisión decimal exacta (NFR-002); solo reservas de `source = OTA`; el porcentaje aplicado queda congelado en cada reserva.
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Componentes (`com.hospitua.reservas.ota`)

| Clase | Responsabilidad |
|---|---|
| `Ota`, `OtaRepository` | Agencia: `id`, `name`, `commissionPercentage` |
| `OtaAdminController` | Alta y actualización de agencias (`POST /api/otas`, `PUT /api/otas/{otaId}`); roles `RECEPTIONIST` y `ADMIN` |
| `OtaQueryController` | `GET /api/otas/{otaId}` para el Módulo 3 (rol `MODULE3`): devuelve `id`, `name`, `commissionPercentage` |
| `CommissionCalculator` | Cálculo puro con `BigDecimal` |
| `CommissionService` | `registerOnCreation`, `zeroOnCancellation`, `reconcile` |
| `CommissionReconciliationController` | `POST /api/ota-commissions/reconciliations` (periodo, agencia y acción `RECONCILED` o `PAID`) |
| `CommissionAuditRepository` + tabla `commission_audit` | Registro auditable (FR-010): fecha, canal, importes y acción |

### Reglas (mapa a los requisitos)

- **FR-001 / FR-002 / NFR-002**: `registerOnCreation(otaId, grossAmount, externalConfirmationCode)` lee el `commissionPercentage`
  de la `Ota` y calcula el importe. Lo invoca `generate-ota-reservation` **antes** de persistir la reserva y en
  la misma transacción.
- **FR-003**: `commissionStatus` inicial `CALCULATED`.
- **FR-004**: porcentaje menor a 0 o mayor a 100 → 400 `INVALID_COMMISSION_PERCENTAGE` y la reserva no se persiste.
  La misma validación se aplica al configurar la `Ota` (FR-008).
- **FR-005**: `externalConfirmationCode` repetido para la misma `Ota` → 400 `DUPLICATE_CONFIRMATION_CODE`; lo garantiza la
  restricción única `(ota_id, external_confirmation_code)` y se traduce la violación.
- **FR-006 (conciliación)**: `reconcile` cambia `CALCULATED` a `RECONCILED` o `PAID` en las reservas OTA del periodo
  (las `COMPLETED`, y las canceladas con importe cero) y registra la auditoría; es idempotente.
- **FR-007**: `zeroOnCancellation` pone `commission_amount = 0` y guarda el importe original en la auditoría.
  Lo invoca el servicio de transiciones cuando una reserva OTA pasa a `CANCELLED`, en la misma transacción.
  Una reserva `NO_SHOW` **conserva** su comisión (se necesita para conciliar con la agencia, según el diccionario).
- **Cambio de porcentaje de la agencia**: solo afecta reservas futuras; cada reserva guarda su `commission_percentage`.
- **Concurrencia**: las actualizaciones usan `version` de `Reservation`; un conflicto se reintenta una vez y, si persiste, 400.
- **Errores** (400 mediante `GlobalExceptionHandler`): `INVALID_COMMISSION_PERCENTAGE`, `DUPLICATE_CONFIRMATION_CODE`,
  `INVALID_OTA` (nombre vacío o campos obligatorios: "especificando los campos requeridos faltantes").

### Datos

- `ota(id, name, commission_percentage numeric(5,2))` con restricción `0 <= commission_percentage <= 100`.
- `reservation`: `commission_percentage`, `commission_amount numeric(19,2)`, `commission_status`, `external_confirmation_code`, `ota_id`.
- `commission_audit(id, reservation_ref, ota_id, action, previous_amount, new_amount, performed_by, performed_at)`.

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/ota/
├── Ota.java
├── OtaRepository.java
├── OtaAdminController.java
├── OtaQueryController.java
├── CommissionCalculator.java
├── CommissionService.java
├── CommissionReconciliationController.java
└── CommissionAuditRepository.java
backend/src/test/java/com/hospitua/reservas/
├── unit/ota/CommissionCalculatorTest.java
└── integration/ota/CommissionIT.java
frontend/src/pages/OtaAdminPage.tsx              # alta y edición de agencias
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| US1 Esc. 1: comisión de $400 al 15% = $60 | `CommissionCalculatorTest` (y casos con decimales y redondeo `HALF_UP`) y `CommissionIT`: persiste y marca `CALCULATED` |
| US1 Esc. 2: porcentaje inválido | 400 y no se persiste la reserva |
| US2 Esc. 1: conciliación de `COMPLETED` | `CommissionIT`: pasa a `RECONCILED`; idempotente |
| US2 Esc. 2: anulación por cancelación | Importe en cero, auditoría con el importe original |
| US3 Esc. 1 y 2: alta de agencia y nombre vacío | 201 y 400 con los campos faltantes |
| Caso borde: cambio de porcentaje con reservas existentes | Las reservas previas conservan su importe |
| Caso borde: código duplicado de la misma agencia | 400; otra agencia con el mismo código sí se acepta |
| Caso borde: cancelación tardía | Sin penalidad; importe en cero |
| Caso borde: `NO_SHOW` OTA | Conserva la comisión |
| Caso borde: actualizaciones simultáneas | `version`; estado final coherente |
| Consulta del Módulo 3 | `GET /api/otas/{otaId}` con y sin rol `MODULE3`; agencia inexistente → 400 |

## Phase 3: User Story 1 - Cálculo y registro de comisión al registrar la reserva (Priority: P1)

**Goal**: dejar la comisión asentada, exacta y auditable en cada reserva OTA.  
**Independent Test**: los dos escenarios de la Historia 1.

### Tests

- [ ] T-ROC-01 [P] [US1] `CommissionCalculatorTest`: fórmula, decimales, redondeo y extremos 0% y 100%
- [ ] T-ROC-02 [P] [US1] `CommissionIT`: registro, porcentaje inválido, código duplicado y auditoría

### Implementation

- [ ] T-ROC-03 [US1] Crear `ota` y `commission_audit` y las columnas de comisión en el esquema base (T007)
- [ ] T-ROC-04 [P] [US1] Crear `Ota`, `OtaRepository` y `CommissionCalculator`
- [ ] T-ROC-05 [US1] Implementar `CommissionService.registerOnCreation` con auditoría (depende de T-ROC-03, T-ROC-04)
- [ ] T-ROC-06 [US1] Traducir las violaciones de restricción a `DUPLICATE_CONFIRMATION_CODE` en `GlobalExceptionHandler`
- [ ] T-ROC-07 [US1] Implementar `OtaQueryController` (`GET /api/otas/{otaId}`) para el Módulo 3 con el rol `MODULE3`

**Checkpoint**: `generate-ota-reservation` puede asentar la comisión y el Módulo 3 puede consultar el porcentaje.

## Phase 4: User Story 2 - Conciliación financiera mensual (Priority: P2)

**Goal**: conciliar las comisiones y ajustar a cero las de reservas canceladas.  
**Independent Test**: los dos escenarios de la Historia 2.

### Tests

- [ ] T-ROC-08 [P] [US2] `CommissionIT`: conciliación del periodo, idempotencia, cancelación y `NO_SHOW`

### Implementation

- [ ] T-ROC-09 [US2] Implementar `CommissionService.zeroOnCancellation` y engancharlo a la transición a `CANCELLED` (T011 del plan base)
- [ ] T-ROC-10 [US2] Implementar `CommissionService.reconcile` y `CommissionReconciliationController`

**Checkpoint**: el área financiera concilia el periodo y las cancelaciones no generan deuda con la agencia.

## Phase 5: User Story 3 - Configuración del porcentaje por agencia (Priority: P3)

**Goal**: dar de alta y actualizar agencias con su porcentaje.  
**Independent Test**: los dos escenarios de la Historia 3.

### Tests

- [ ] T-ROC-11 [P] [US3] `CommissionIT`: alta válida, nombre vacío y porcentaje fuera de rango

### Implementation

- [ ] T-ROC-12 [US3] Implementar `OtaAdminController` con validaciones y roles `RECEPTIONIST` y `ADMIN`
- [ ] T-ROC-13 [P] [US3] Crear `OtaAdminPage` en el frontend

**Checkpoint**: se pueden incorporar canales nuevos sin tocar código.

## Dependencies & Execution Order

- Depende de T007, T008, T009 y T011 del plan base.
- Lo invoca `generate-ota-reservation`; lo dispara `cancel-reservation` y las cancelaciones compensatorias (transición a `CANCELLED`).
- Debe implementarse **antes** que `generate-ota-reservation`.

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Roles de la conciliación y de la configuración**: el spec dice "la Recepcionista o el analista financiero" y "un Administrador"; falta definir los roles `FINANCE` y `ADMIN` y su autenticación (Spring Security).
2. **Estado tras una cancelación**: US2 dice que la cancelación deja la comisión `RECONCILED`; FR-007 dice ajustar el importe al cancelar. Se propone ajustar el importe al cancelar y pasar a `RECONCILED` en la conciliación.
3. **Estado `DISPUTED`**: existe en el diccionario y el spec, pero ningún escenario lo usa; se deja fuera de este plan.
4. **Nombre del campo** `totalAmount` (JSON de la OTA) frente a `grossAmount` (dominio): decidido en C6.
