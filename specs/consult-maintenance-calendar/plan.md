# Implementation Plan: Consultar Calendario de Mantenimientos

**Date**: 2026-09-26
**Spec**: [spec.md](./spec.md)
**Plan base**: [../base/plan.md](../base/plan.md)

## Summary

Consulta de solo lectura al calendario de mantenimientos del Módulo 1 (REST GET, reactiva, decisión C4 del
plan base) para saber si una habitación estará inhabilitada durante una estadía. Es un servicio interno
(`MaintenanceCalendarService`) que usa `Module1Client`, sin endpoint propio, y que "Verificar
disponibilidades" invoca antes de confirmar cualquier reserva. Si el Módulo 1 no responde, no se asume
que la habitación esté libre.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

**Storage**: ninguno.
**Testing**: JUnit 5; `MockRestServiceServer` para el Módulo 1; pruebas unitarias del cálculo de solapamiento.
**Performance Goals**: consulta < 1 s (NFR-001).
**Constraints**: solo lectura; sin reintentos; nunca asumir disponibilidad.
**Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Contrato hacia el Módulo 1

Ruta **propuesta**; el contrato real lo define el Módulo 1:

`GET {module1}/maintenance-calendar?roomId={roomId}&startDate={yyyy-MM-dd}&endDate={yyyy-MM-dd}`

Respuesta esperada: lista de `{ roomId, maintenanceStart, maintenanceEnd, reason }` de los mantenimientos
que el Módulo 1 considera cercanos al rango. El Módulo 2 **recalcula el cruce** localmente, sin fiarse
de que el filtro del Módulo 1 sea exacto.

### Componentes

| Clase | Ubicación | Responsabilidad |
|---|---|---|
| `Module1Client.getMaintenance(...)` | `integration/module1/` | Añade la llamada al cliente definido en `consult-room-inventory` |
| `MaintenanceEntryDto` | `integration/module1/` | `roomId`, `maintenanceStart`, `maintenanceEnd`, `reason` |
| `MaintenanceCalendarService` | `availability/` | Valida entrada, llama al cliente y calcula los cruces |
| `MaintenanceCheckResult` (record) | `availability/` | `blocked` y lista de cruces (`start`, `end`, `reason`) |
| `DateRangeValidator` | `common/` | Reutilizable: `endDate` posterior a `startDate` |

### Reglas (mapa a los requisitos)

- **FR-001 / FR-003**: se consulta por `roomId` y rango, y se informa si la `Room` queda inhabilitada con el
  periodo de cada cruce.
- **FR-002 (cruce total o parcial)**: la estadía ocupa las noches `startDate` hasta la anterior a
  `endDate`; un mantenimiento cruza si `maintenanceStart <= endDate - 1` y `maintenanceEnd >= startDate`
  (fechas inclusivas). Un mantenimiento que termina el día anterior a `startDate` **no** cruza
  (escenario 3). Regla provisional: ver Preguntas abiertas.
- **FR-004**: solo `GET`.
- **FR-005**: si el Módulo 1 no responde, se lanza `Module1UnavailableException` y el flujo invocador se
  detiene sin asumir disponibilidad.
- **FR-006 / errores** (mapeados a 400 por `GlobalExceptionHandler`):

| Caso | `errorCode` | Mensaje |
|---|---|---|
| Módulo 1 sin respuesta, timeout o error | `MODULE1_UNAVAILABLE` | "No es posible validar mantenimientos en este momento. Intente de nuevo." |
| `endDate` anterior o igual a `startDate`, o fecha inexistente | `INVALID_DATE_RANGE` | "Rango de fechas inválido. Verifique las fechas seleccionadas." |
| `roomId` vacío, con caracteres inválidos o desconocido | `INVALID_ROOM_ID` | "El identificador de la habitación es inválido." |

- **Consulta por categoría**: el spec y el contrato son por `roomId`. Para verificar una categoría, "Verificar
  disponibilidades" llamaría una vez por cada habitación candidata. Ver Preguntas abiertas.
- **Caso borde "mantenimiento programado después de reservar"**: fuera de alcance; lo gestiona el Módulo 1.

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/
├── integration/module1/MaintenanceEntryDto.java      # y método getMaintenance en Module1Client
├── availability/
│   ├── MaintenanceCalendarService.java
│   └── MaintenanceCheckResult.java
└── common/DateRangeValidator.java
backend/src/test/java/com/hospitua/reservas/
├── unit/availability/MaintenanceOverlapTest.java
└── contract/module1/Module1MaintenanceContractTest.java
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| Esc. 1: sin mantenimientos | `Module1MaintenanceContractTest`: `blocked = false` |
| Esc. 2: cruce total o parcial | `MaintenanceOverlapTest`: cruces total, parcial, interno y que envuelve la estadía; devuelve el periodo |
| Esc. 3: mantenimiento contiguo | `MaintenanceOverlapTest`: termina el día anterior a `startDate` → sin cruce; caso límite del mismo día |
| Caso borde: Módulo 1 sin respuesta o timeout | `Module1MaintenanceContractTest`: `MODULE1_UNAVAILABLE`, no se asume disponibilidad |
| Caso borde: fechas inválidas | `DateRangeValidator`: 400 sin llamar al Módulo 1 |
| Caso borde: `roomId` inválido | 400 `INVALID_ROOM_ID` |
| Filtro inexacto del Módulo 1 | El Módulo 1 devuelve un mantenimiento fuera del rango; el Módulo 2 no lo cuenta |

## Phase 3: User Story 1 - Detección de mantenimientos que cruzan una estadía (Priority: P1)

**Goal**: saber si una habitación estará inhabilitada durante la estadía y cuándo.
**Independent Test**: los tres escenarios del spec con el Módulo 1 simulado.

### Tests

- [ ] T-CMC-01 [P] [US1] `MaintenanceOverlapTest`: reglas de solapamiento y casos límite
- [ ] T-CMC-02 [P] [US1] `Module1MaintenanceContractTest`: escenarios 1 a 3, timeout, error y respuesta con datos fuera de rango
- [ ] T-CMC-03 [P] [US1] Pruebas de validación de fechas y de `roomId`

### Implementation

- [ ] T-CMC-04 [P] [US1] Crear `MaintenanceEntryDto` y `MaintenanceCheckResult`
- [ ] T-CMC-05 [US1] Agregar `getMaintenance` a `Module1Client` y `Module1RestClient` (depende de T-CRI-04)
- [ ] T-CMC-06 [P] [US1] Crear `DateRangeValidator` en `common/` y sus mensajes
- [ ] T-CMC-07 [US1] Implementar `MaintenanceCalendarService` con el cálculo de cruces (depende de T-CMC-04 a T-CMC-06)
- [ ] T-CMC-08 [US1] Registrar los `errorCode` en `GlobalExceptionHandler`

**Checkpoint**: `check-room-availability` puede descartar habitaciones con mantenimiento en el rango.

## Dependencies & Execution Order

- Depende de T009 y T012 del plan base y de `Module1Client` de `consult-room-inventory` (T-CRI-04).
- Lo consume `check-room-availability`.

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Granularidad y extremos de las fechas del calendario**: ¿`maintenanceStart` y `maintenanceEnd` son
   fechas o fecha y hora?, ¿el fin es inclusivo? La regla de cruce depende de ello; se usa fecha con fin
   inclusivo como suposición.
2. **Consulta por categoría**: se propone pedirle al Módulo 1 que acepte `categoryRoom` (o varios
   `roomId`) para evitar una llamada por habitación al verificar una categoría completa.
3. **Contrato real del Módulo 1** (rutas, campos, autenticación): igual que en `consult-room-inventory`.
