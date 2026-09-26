# Implementation Plan: Consultar Reservas

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

Servicio maestro de solo lectura que localiza `Reservation` por `reservationRef`, `documentNumber` o
`fullName`. Lo usan la Recepcionista, el Módulo 1 (por REST GET, reactivo) y el resto de features del
Módulo 2 (cancelar, actualizar, verificar disponibilidades, Check-In y Check-Out). Enfoque: un
endpoint REST `GET /api/reservations` y un `ReservationQueryService` reutilizable internamente; consultas
JPA parametrizadas; validación estricta de entrada; respuestas siempre 200 o 400.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL, tablas `reservation` y `guest` (definidas en la Fase 2 del plan base). No llama a otros módulos.
- **Testing**: Spring Boot Test + Testcontainers (PostgreSQL); pruebas unitarias del validador.
- **Performance Goals**: consulta por `reservationRef` < 500 ms (NFR-001, SC-001).
- **Constraints**: solo lectura e idempotente (FR-004); cero HTTP 500 (FR-005).
- **Scale/Scope**: NEEDS CLARIFICATION (volumen de reservas y huéspedes).

## Diseño técnico

### Contrato REST

`GET /api/reservations?reservationRef=|documentNumber=|fullName=`

- Exige **exactamente un** criterio; ninguno o más de uno → 400.
- Respuesta 200 con lista (una reserva si es por `reservationRef`):

```json
{
  "total": 1,
  "items": [{
    "reservationRef": "...", "status": "ACTIVE", "source": "DIRECT",
    "startDate": "2026-10-01", "endDate": "2026-10-04",
    "categoryRoom": "...", "roomId": "...",
    "guest": { "id": "...", "fullName": "...", "documentNumber": "...", "nationality": "...",
               "contactPhone": "...", "contactEmail": "..." }
  }]
}
```

- La respuesta REST incluye solo lo que pide el spec (FR-003 y el flujo). Los datos financieros
  (`grossAmount`, comisión), `version` y `lateArrivalNotice` **no** salen por REST: los otros
  planes los leen por `ReservationQueryService`, que devuelve la entidad completa.
- Errores (cuerpo `ApiError` del plan base), siempre 400:

| Caso | `errorCode` | Mensaje |
|---|---|---|
| Criterio ausente, vacío o solo espacios | `INVALID_IDENTIFIER` | "Debe proveer un identificador de reserva válido para la consulta." |
| Formato inválido o caracteres especiales | `INVALID_IDENTIFIER` | el mismo mensaje |
| Más de un criterio | `INVALID_IDENTIFIER` | el mismo mensaje |
| Sin coincidencias | `RESERVATION_NOT_FOUND` | "La reserva no existe." |
| Demasiados resultados | `TOO_MANY_RESULTS` | "La búsqueda devuelve demasiados resultados. Acótela." |

### Componentes (`com.hospitua.reservas.reservation`)

| Clase | Responsabilidad |
|---|---|
| `ReservationController` | Recibe el GET, delega y arma la respuesta |
| `ReservationSearchRequest` + `ReservationSearchValidator` | Recorta espacios, exige un criterio y valida formato con una lista blanca de caracteres |
| `ReservationQueryService` | `findByReservationRef` (uso interno) y `search`; anotado `@Transactional(readOnly = true)` |
| `ReservationRepository`, `GuestRepository` | Consultas JPA parametrizadas (sin concatenar SQL) |
| `ReservationDetailResponse`, `ReservationMapper` | DTO y mapeo entidad → respuesta |

### Reglas (mapa a los requisitos)

- **FR-002 / FR-003**: tres criterios; por `documentNumber` coincidencia exacta; por `fullName`
  coincidencia sin distinguir mayúsculas ni acentos (regla propuesta; ver Preguntas abiertas).
- **FR-004**: transacción de solo lectura; ningún método de escritura en el servicio ni en el controlador.
- **FR-005**: `GlobalExceptionHandler` (plan base) convierte toda excepción en 400.
- **Consistencia de lectura**: nivel de aislamiento por defecto de PostgreSQL (`READ COMMITTED`), sin
  bloqueos de lectura; cada consulta ve el último estado confirmado.
- **Límite de resultados**: máximo de 50 coincidencias por búsqueda; si hay más, `TOO_MANY_RESULTS`.
- **Seguridad**: roles `RECEPTIONIST` y `MODULE1`; la Ota no accede a esta ruta. Sin datos personales en logs.

### Datos

Tablas del plan base, con estos índices (se agregan con Flyway junto al esquema base, tarea T007):

- `reservation(reservation_ref)` único.
- `guest(document_number)`.
- `guest(lower(full_name))` para la búsqueda por nombre.

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/reservation/
├── ReservationController.java
├── ReservationQueryService.java
├── ReservationSearchRequest.java
├── ReservationSearchValidator.java
├── ReservationDetailResponse.java
└── ReservationMapper.java
backend/src/test/java/com/hospitua/reservas/
├── unit/reservation/ReservationSearchValidatorTest.java
└── integration/reservation/ReservationQueryIT.java
```

## Estrategia de testing (cobertura de los escenarios del spec)

| Escenario / caso | Prueba |
|---|---|
| Esc. 1: consulta por `reservationRef` | `ReservationQueryIT`: devuelve estado, fechas, `roomId` y titular |
| Esc. 2: por `documentNumber` y por `fullName` con varias coincidencias | `ReservationQueryIT`: lista con el `status` de cada una |
| Esc. 3: reserva inexistente | `ReservationQueryIT`: 400 `RESERVATION_NOT_FOUND` |
| Caso borde: vacío o solo espacios | `ReservationSearchValidatorTest` y `ReservationQueryIT`: 400 |
| Caso borde: caracteres especiales o inyección | `ReservationSearchValidatorTest`: 400; el repositorio nunca recibe la cadena |
| Caso borde: estado que cambia en ese instante | `ReservationQueryIT`: lee el último estado confirmado |
| Volumen excesivo | `ReservationQueryIT`: más de 50 coincidencias → 400 `TOO_MANY_RESULTS` |
| NFR-001 | Prueba de humo con datos de ejemplo y umbral de 500 ms |
| Solo lectura | Verifica que el conteo de filas y `version` no cambian tras consultar |

## Phase 3: User Story 1 - Búsqueda y consulta de reservas (Priority: P1)

**Goal**: localizar una reserva por referencia, documento o nombre, sin modificar nada.  
**Independent Test**: los escenarios 1 a 3 del spec contra PostgreSQL real.

### Tests

- [ ] T-CVR-01 [P] [US1] `ReservationSearchValidatorTest`: criterio único, espacios, formato y caracteres inválidos
- [ ] T-CVR-02 [P] [US1] `ReservationQueryIT`: escenarios 1, 2 y 3
- [ ] T-CVR-03 [P] [US1] `ReservationQueryIT`: límite de resultados y consistencia de lectura
- [ ] T-CVR-04 [P] [US1] `ReservationQueryIT`: solo lectura y tiempo de respuesta

### Implementation

- [ ] T-CVR-05 [US1] Agregar los índices al esquema base (coordinado con T007)
- [ ] T-CVR-06 [P] [US1] Crear las consultas en `ReservationRepository` y `GuestRepository`
- [ ] T-CVR-07 [P] [US1] Crear `ReservationSearchRequest` y `ReservationSearchValidator`
- [ ] T-CVR-08 [US1] Implementar `ReservationQueryService` (depende de T-CVR-06)
- [ ] T-CVR-09 [P] [US1] Crear `ReservationDetailResponse` y `ReservationMapper`
- [ ] T-CVR-10 [US1] Implementar `ReservationController` con `GET /api/reservations` (depende de T-CVR-07 a T-CVR-09)
- [ ] T-CVR-11 [US1] Configurar la autorización de la ruta para `RECEPTIONIST` y `MODULE1` (depende de T018 del plan base)
- [ ] T-CVR-12 [US1] Verificar que el `GlobalExceptionHandler` devuelva los `errorCode` y mensajes de la tabla
- [ ] T-CVR-13 [P] [US1] Crear `ReservationSearchPage` en el frontend (búsqueda por referencia, documento o nombre, y detalle), reutilizada por cancelar y modificar

**Checkpoint**: el servicio responde a Recepción y al Módulo 1 y es reutilizable por las demás features.

## Dependencies & Execution Order

- Depende de la Fase 2 del plan base: T008 (entidades), T009 (errores), T018 (seguridad).
- Es requisito de: `update-reservation`, `cancel-reservation`, `check-room-availability` (usa la búsqueda
  interna para cruzar reservas locales) y el consumidor de Check-In y Check-Out.
- Dentro de la feature: repositorio y validador → servicio → controlador → seguridad.

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Formato de `reservationRef`** (longitud y caracteres): no está definido; se propone letras, dígitos y guion, hasta 40 caracteres.
2. **Búsqueda por `fullName`**: exacta o parcial. Se propone parcial, sin distinguir mayúsculas ni acentos, con mínimo de 3 caracteres.
3. **`roomNumber` en la respuesta**: el spec habla de "la `Room` asociada", pero `roomNumber` lo tiene el Módulo 1. Se propone devolver solo `roomId`; alternativa: guardar una copia de `roomNumber` al asignar la habitación.
4. **Límite de resultados**: el spec lo menciona para "rango de fechas", pero los criterios definidos no incluyen fechas. Se propone 50 por búsqueda.
5. **Credenciales del Módulo 1** para llamar a esta API (clave de API u OAuth2 de cliente): NEEDS CLARIFICATION.
