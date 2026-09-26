# Implementation Plan: Consultar Inventario de Habitaciones

**Date**: 2026-09-26
**Spec**: [spec.md](./spec.md)
**Plan base**: [../base/plan.md](../base/plan.md)

## Summary

Consulta de solo lectura, en tiempo real, al inventario físico del Módulo 1 (REST GET, reactiva). Sirve
de insumo a "Verificar disponibilidades". No expone un endpoint propio: es un servicio interno
(`RoomInventoryService`) respaldado por el cliente `Module1Client`. Devuelve una habitación puntual
(con su estado y, si está `Reserved`, la reserva que la mantiene) o las habitaciones `Available` de una
categoría. Ante cualquier fallo del Módulo 1, responde un error controlado (HTTP 400 al cliente final).

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

**Storage**: ninguno. No persiste el estado de las habitaciones (propiedad del Módulo 1).
**Testing**: JUnit 5 + Mockito; `MockRestServiceServer` (Spring Test) para simular al Módulo 1.
**Performance Goals**: consulta puntual < 1 s (NFR-001, SC-002).
**Constraints**: solo lectura; sin reintentos automáticos para no exceder 1 s; nunca asumir disponibilidad.
**Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Contrato hacia el Módulo 1 (lo consume el Módulo 2)

Rutas **propuestas**; el contrato real lo define el Módulo 1 (ver Preguntas abiertas):

| Operación | Petición al Módulo 1 | Respuesta esperada |
|---|---|---|
| Habitación puntual | `GET {module1}/rooms/{roomId}` | `{ id, roomNumber, categoryRoom, status, reservedByReservationRef? }` |
| Habitaciones por categoría | `GET {module1}/rooms?categoryRoom={categoryRoom}` y, opcional, `&status=Available` | lista de objetos `Room` (todas si no hay filtro) |

### Componentes

| Clase | Ubicación | Responsabilidad |
|---|---|---|
| `Module1Client` (interfaz) y `Module1RestClient` | `integration/module1/` | Llamadas REST con `RestClient`, timeouts configurables, traducción de errores |
| `RoomDto`, `RoomStatus` (enum) | `integration/module1/` | Contrato de `Room`; `RoomStatus` con los estados del diccionario (`Available`, `Reserved`, `Occupied`, `PendingCleaning`, `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`) |
| `Module1UnavailableException` | `integration/module1/` | Módulo 1 sin respuesta, timeout o error de servidor |
| `RoomInventoryService` | `availability/` | `getRoom(roomId)` y `listByCategory(categoryRoom, statusFilter)` (filtro opcional); valida entrada |
| `InvalidRoomIdentifierException` | `common/` | Identificador vacío o con caracteres inválidos |

### Reglas (mapa a los requisitos)

- **FR-001**: `getRoom` devuelve el estado y, si es `Reserved`, `reservedByReservationRef`.
- **FR-002**: `listByCategory` devuelve las habitaciones de la categoría con su `status`; con filtro `Available` devuelve
  solo esas (el filtro se reaplica en el Módulo 2 aunque el Módulo 1 ya filtre) y sin filtro devuelve todas. Categoría sin libres con el filtro `Available` → lista vacía (escenario 5).
- **FR-003**: no hay métodos de escritura; solo `GET`.
- **FR-004**: el resultado es un objeto de dominio que consume `check-room-availability`.
- **FR-005 / errores** (todos mapeados por `GlobalExceptionHandler` a 400):

| Caso | `errorCode` | Mensaje |
|---|---|---|
| Módulo 1 sin respuesta, timeout, error de servidor o de conexión | `MODULE1_UNAVAILABLE` | "No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo." |
| `roomId` vacío, con caracteres inválidos o que el Módulo 1 no reconoce | `INVALID_ROOM_ID` | "El identificador de la habitación es inválido." |

- **Estado desconocido**: si el Módulo 1 devuelve un valor que no está en `RoomStatus`, se registra en el
  log y la habitación se trata como no disponible (nunca como libre).
- **Configuración**: `hospitua.module1.base-url`, `hospitua.module1.connect-timeout` y
  `hospitua.module1.read-timeout` (por defecto 800 ms de lectura, para respetar el límite de 1 s).
- **Caso borde "el estado cambia entre la consulta y la reserva"**: esta feature no aparta nada; la
  confirmación final la revalida el flujo que crea la reserva.

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/
├── integration/module1/
│   ├── Module1Client.java
│   ├── Module1RestClient.java
│   ├── RoomDto.java
│   ├── RoomStatus.java
│   └── Module1UnavailableException.java
├── availability/RoomInventoryService.java
└── common/InvalidRoomIdentifierException.java
backend/src/test/java/com/hospitua/reservas/
├── unit/availability/RoomInventoryServiceTest.java
└── contract/module1/Module1RoomContractTest.java
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| Esc. 1: puntual `Available` | `RoomInventoryServiceTest` con cliente simulado |
| Esc. 2: puntual `Reserved` u `Occupied` | Igual; verifica `reservedByReservationRef` en `Reserved` |
| Esc. 3: por categoría sin filtro | `Module1RoomContractTest`: lista mezclada, se devuelven todas con su `status` |
| Esc. 4: por categoría con filtro `Available` | Lista mezclada, se devuelven solo las `Available` |
| Esc. 5: categoría sin libres con filtro `Available` | Lista vacía |
| Caso borde: Módulo 1 sin respuesta o timeout | `Module1RoomContractTest`: `MODULE1_UNAVAILABLE`, sin propagar 500 |
| Caso borde: `roomId` inválido | `RoomInventoryServiceTest`: `INVALID_ROOM_ID` sin llamar al Módulo 1 |
| Estado desconocido | `Module1RoomContractTest`: tratado como no disponible |
| Solo lectura | Verifica que el cliente solo usa `GET` |

## Phase 3: User Story 1 - Consulta del inventario físico (Priority: P1)

**Goal**: obtener el estado físico vigente de una habitación o las libres de una categoría.
**Independent Test**: los cuatro escenarios del spec con el Módulo 1 simulado.

### Tests

- [ ] T-CRI-01 [P] [US1] `Module1RoomContractTest`: escenarios 1 a 5, timeout, error de servidor y estado desconocido
- [ ] T-CRI-02 [P] [US1] `RoomInventoryServiceTest`: validación de `roomId` y filtro por estado

### Implementation

- [ ] T-CRI-03 [P] [US1] Crear `RoomStatus` y `RoomDto`
- [ ] T-CRI-04 [US1] Implementar `Module1Client` y `Module1RestClient` para `GET` de habitación y de categoría (usa T012 del plan base)
- [ ] T-CRI-05 [P] [US1] Crear `Module1UnavailableException` e `InvalidRoomIdentifierException` y su traducción en `GlobalExceptionHandler`
- [ ] T-CRI-06 [US1] Implementar `RoomInventoryService` (depende de T-CRI-04, T-CRI-05)
- [ ] T-CRI-07 [US1] Agregar las propiedades `hospitua.module1.*` a `application.yml`

**Checkpoint**: `check-room-availability` puede consultar el inventario sin conocer el contrato REST.

## Dependencies & Execution Order

- Depende de T009 (errores) y T012 (clientes) del plan base.
- Lo consume `check-room-availability`; comparte `Module1Client` con `consult-maintenance-calendar`
  y `set-room-state`.
- Sin dependencias con otras features de este grupo, por lo que puede desarrollarse en paralelo.

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Contrato real del Módulo 1**: rutas, nombres de campos, si acepta el rango de fechas y cómo se
   autentica el Módulo 2. El spec dice que la consulta se invoca "junto con el rango de fechas", pero el
   estado físico es del instante actual; se propone no enviar fechas.
2. **Categoría inexistente**: el spec solo define `roomId` inexistente. Se propone que el Módulo 1
   devuelva una lista vacía y no un error.
3. **Estado `Reserved`** aún no existe en el Módulo 1 (decisión C8 del plan base).
