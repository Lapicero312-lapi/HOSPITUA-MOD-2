# Implementation Plan: Procesar Datos de Huéspedes Extranjeros

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

El Módulo 1 captura los datos migratorios del huésped extranjero en el Check-In y los envía **dentro**
del mensaje `habitacion.checkin` (decisión C2 del plan base). El Módulo 2 los valida y los registra en
un `MigratoryMovement` por reserva, con estado `COMPLETE` o `INCOMPLETE`, y los deja como insumo de
`export-sire-file`. Nunca bloquea el Check-In por datos migratorios malos: los marca `INCOMPLETE` y el
Módulo 1 los corrige reenviando el mensaje. Es un servicio interno (`MigratoryMovementService`) que
invoca el consumidor del Check-In de `update-reservation`, y un proveedor de lectura para la exportación.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL, tabla `migratory_movement` (una fila por reserva).
- **Testing**: JUnit 5, Mockito y Testcontainers (PostgreSQL) para la idempotencia y el proveedor de lectura.
- **Performance Goals**: validar y registrar una notificación < 500 ms (NFR-001).
- **Constraints**: no persistir pasaporte, visa, fecha de nacimiento ni procedencia (solo el tipo y la fecha del movimiento); sin datos personales en logs.
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Entrada (mensaje `habitacion.checkin`)

El `payload` ya definido en el plan base lleva `reservationRef` y, si el huésped es extranjero,
`foreignGuestData`. Contenido que el Módulo 2 usa (propuesto; lo confirma el Módulo 1):

```json
{ "reservationRef": "...",
  "foreignGuestData": { "movementType": "ENTRY", "movementDate": "2026-10-01" } }
```

El Módulo 2 ignora cualquier otro campo de `ForeignGuestData` (pasaporte, visa, nacionalidad, fecha de
nacimiento, procedencia): esa información es del Módulo 1 y el Módulo 2 no la modifica ni la guarda.

### Componentes

| Clase | Ubicación | Responsabilidad |
|---|---|---|
| `MigratoryMovement` (entidad) y `MigratoryMovementRepository` | `migration/` | Movimiento por reserva; único `reservation_ref` |
| `ForeignGuestDataDto` | `messaging/` | Datos migratorios del mensaje |
| `MigratoryDataValidator` | `migration/` | Presencia, formato y fecha no futura (reloj del hotel); detecta caracteres no válidos |
| `MigratoryMovementService` | `migration/` | `register(reservationRef, ForeignGuestDataDto)` y `MigratoryOutcome` |
| `MigratoryRecordsProvider` | `migration/` | `findForPeriod(startDate, endDate)`: registros `COMPLETE` y `INCOMPLETE` del periodo para `export-sire-file` |

### Reglas (mapa a los requisitos)

- **FR-001 / FR-002**: solo se procesa si `Guest.type = FOREIGN`; si es `NATIONAL` no se exige ni se registra nada (escenario 3).
- **FR-003**: valida que `movementType` (`ENTRY` o `DEPARTURE`) y `movementDate` existan, con formato correcto y una fecha que no sea futura.
- **FR-004**: un solo `MigratoryMovement` por reserva; una nueva estadía del mismo huésped es otra reserva y otro movimiento, nunca se sobrescribe.
- **FR-005 (`INCOMPLETE`)**: datos ausentes o inválidos → se registra `INCOMPLETE` con `missingFields` y `validationReason` (por ejemplo "La fecha de movimiento migratorio no puede ser futura"), se conserva el Check-In y se confirma el mensaje.
- **Corrección idempotente**: un reenvío con datos completos actualiza **solo** ese movimiento a `COMPLETE`; si ya estaba `COMPLETE`, se ignora; si sigue incompleto, se actualizan `missingFields` y `validationReason`.
- **FR-006 / US2**: `MigratoryRecordsProvider` entrega los `COMPLETE` con nacionalidad, documento, tipo y fecha, y señala los `INCOMPLETE` con la reserva y el huésped que requieren corrección.
- **FR-007**: no existe pantalla ni endpoint de captura en el Módulo 2.
- **FR-008 (traducción de errores a cola, decisión C1)**:

| Caso | Comportamiento |
|---|---|
| Payload sin `reservationRef` o con caracteres maliciosos | El mensaje va a la dead-letter queue; no se registra nada |
| Datos migratorios inválidos o ausentes con reserva válida | `INCOMPLETE` y confirmación (el "200 + `INCOMPLETE`") |
| Mensaje repetido (`eventId`) | Confirmado sin efectos |
| Reserva inexistente o en un estado que no admite Check-In | Lo resuelve el consumidor del Check-In de `update-reservation`: incidencia de conciliación |

### Datos

Tabla `migratory_movement` (esquema base, T007): `movement_id`, `reservation_ref` (único, FK),
`guest_ref`, `movement_type`, `movement_date`, `validation_status`, `missing_fields` (arreglo de texto),
`validation_reason`, `created_at`, `updated_at`. Índice por `movement_date` y `validation_status` para la exportación.

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/
├── migration/
│   ├── MigratoryMovement.java
│   ├── MigratoryMovementRepository.java
│   ├── MigratoryDataValidator.java
│   ├── MigratoryMovementService.java
│   ├── MigratoryOutcome.java
│   └── MigratoryRecordsProvider.java
└── messaging/ForeignGuestDataDto.java
backend/src/test/java/com/hospitua/reservas/
├── unit/migration/MigratoryDataValidatorTest.java
└── integration/migration/MigratoryMovementIT.java
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| US1 Esc. 1: datos completos | `MigratoryMovementIT`: `COMPLETE` con tipo y fecha |
| US1 Esc. 2: datos incompletos | Sin tipo o sin fecha → `INCOMPLETE` con `missingFields`; el Check-In se conserva |
| US1 Esc. 3: huésped nacional | No crea movimiento ni exige datos |
| US1 Esc. 4: corrección por reenvío | `INCOMPLETE` → `COMPLETE`; segundo reenvío sin efectos; el estado de la reserva no cambia |
| Caso borde: fecha futura | `MigratoryDataValidatorTest`: `INCOMPLETE` con el motivo del spec (reloj de prueba) |
| Caso borde: caracteres no válidos | Se rechaza sin registrar (dead-letter en el consumidor) |
| Caso borde: payload vacío o sin `reservationRef` | Igual |
| Caso borde: varias estadías del mismo huésped | Un movimiento por reserva, sin sobrescribir |
| US2 Esc. 1 y 2: entrega para SIRE | `MigratoryMovementIT`: completos con nacionalidad y documento; incompletos señalados con reserva y huésped |
| Privacidad | Ningún campo distinto de tipo y fecha se persiste ni se escribe en logs |

## Phase 3: User Story 1 - Recepción y validación de datos migratorios (Priority: P1)

**Goal**: registrar el movimiento migratorio de cada estadía extranjera sin bloquear el Check-In.  
**Independent Test**: los cuatro escenarios de la Historia 1 con PostgreSQL real.

### Tests

- [ ] T-PFG-01 [P] [US1] `MigratoryDataValidatorTest`: presencia, formato, fecha futura y caracteres no válidos
- [ ] T-PFG-02 [P] [US1] `MigratoryMovementIT`: escenarios 1 a 4 y varias estadías del mismo huésped

### Implementation

- [ ] T-PFG-03 [US1] Crear la tabla `migratory_movement` en el esquema base (coordinado con T007)
- [ ] T-PFG-04 [P] [US1] Crear `MigratoryMovement`, su repositorio y `MigratoryOutcome`
- [ ] T-PFG-05 [P] [US1] Crear `ForeignGuestDataDto` y `MigratoryDataValidator` (usa T010 del plan base)
- [ ] T-PFG-06 [US1] Implementar `MigratoryMovementService.register` con el alta y la corrección idempotente (depende de T-PFG-04, T-PFG-05)

**Checkpoint**: el consumidor del Check-In puede registrar el movimiento y nunca rechaza un Check-In por datos migratorios.

## Phase 4: User Story 2 - Entrega de registros migratorios a la exportación SIRE (Priority: P2)

**Goal**: entregar a `export-sire-file` los movimientos completos y señalar los incompletos.  
**Independent Test**: los dos escenarios de la Historia 2.

### Tests

- [ ] T-PFG-07 [P] [US2] `MigratoryMovementIT`: `findForPeriod` con completos e incompletos, y con datos de nacionalidad y documento

### Implementation

- [ ] T-PFG-08 [US2] Implementar `MigratoryRecordsProvider.findForPeriod` con los índices de la tabla

**Checkpoint**: `export-sire-file` puede generar el archivo y su reporte de exclusiones.

## Dependencies & Execution Order

- Depende de T007, T008, T010, T014 (idempotencia de colas) del plan base y de `check-view-reservation`
  (entidades `Reservation` y `Guest`).
- Lo consume el consumidor de Check-In de `update-reservation` (US2 de ese plan) y `export-sire-file`.
- **Debe implementarse antes** que `update-reservation` (el Check-In registra el movimiento).

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Contrato del mensaje**: nombres y formato de `movementType` y `movementDate` dentro de `habitacion.checkin`; el diccionario no los lista en `ForeignGuestData`.
2. **Filtro del periodo de la exportación**: si `findForPeriod` filtra por la fecha del movimiento o por las fechas de la estadía; el spec de exportación dice "reservas del periodo". Se propone la fecha del movimiento.
3. **Extranjero sin datos**: si hay Check-In de un huésped `FOREIGN` y el mensaje no trae `foreignGuestData`, se propone registrar el movimiento `INCOMPLETE` con `missingFields = [movementType, movementDate]` (el spec solo define datos "ausentes" dentro de un mensaje que sí los trae).
4. **Conflicto entre `Guest.type` y el mensaje**: si el mensaje trae datos migratorios de un huésped `NATIONAL`, se propone ignorarlos y registrar una incidencia.
