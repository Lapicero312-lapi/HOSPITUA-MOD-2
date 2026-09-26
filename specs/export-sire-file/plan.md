# Implementation Plan: Exportar Archivo SIRE

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

El actor Migración, autenticado, elige un periodo y descarga un archivo `.TXT` con los huéspedes extranjeros
de reservas `IN_PROGRESS` o `COMPLETED`, en el formato de Migración Colombia. Los registros con datos
migratorios incompletos se excluyen del archivo y quedan en un reporte de exclusiones consultable por
`exportId`. La operación es 100% local del Módulo 2 (no llama a los Módulos 1 ni 3), registra cada
exportación en `SireExport` y limita las solicitudes simultáneas (429). Incluye el portal de Migración en React.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: PostgreSQL: `sire_export` y `sire_export_exclusion`; lee `migratory_movement`, `reservation` y `guest`.
- **Testing**: JUnit 5, Mockito, Testcontainers y una prueba de archivo de referencia (golden file).
- **Performance Goals**: generación < 2 s para hasta 500 huéspedes (NFR-001).
- **Constraints**: periodo máximo de 1 año; límite de solicitudes simultáneas; solo datos locales; el archivo se genera en memoria.
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Contrato REST (rol `MIGRATION`)

| Petición | Respuesta |
|---|---|
| `POST /api/sire/exports` con `{ startDate, endDate }` (`POST` porque registra un `SireExport`, decisión D9) | 200 con **solo** el `.TXT` (`Content-Disposition: attachment`) y la cabecera `Export-Id` |
| `GET /api/sire/exports/{exportId}/exclusions` | 200 con la lista de exclusiones: `reservationRef`, huésped (`fullName`, `documentNumber`), `missingFields` y `reason` ("Datos incompletos para extranjeros en la reserva X") |

La cabecera `Export-Id` se expone al navegador (`Access-Control-Expose-Headers`) para que el portal la lea.

Errores (400, salvo el 429):

| Caso | `errorCode` | Mensaje |
|---|---|---|
| Periodo invertido o formato inválido | `INVALID_PERIOD` | sin ejecutar ninguna consulta |
| Periodo mayor a 1 año | `PERIOD_TOO_LONG` | "El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos." |
| Sin huéspedes extranjeros en el periodo | `NO_MIGRATORY_RECORDS` | "No hay registros migratorios que reportar en ese periodo." |
| Todos los registros incompletos | `NO_VALID_RECORDS` | "No hay registros válidos para exportar; existen registros incompletos por corregir." |
| Caracteres que no se pueden codificar | `INVALID_CHARACTERS` | "Caracteres no válidos en el registro del huésped." |
| `exportId` inexistente | `EXPORT_NOT_FOUND` | "La exportación no existe." |
| Demasiadas exportaciones simultáneas | 429 `TOO_MANY_REQUESTS` | "Hay demasiadas exportaciones en curso. Intente de nuevo." |

### Flujo

1. Validar el periodo (obligatorio, `startDate` anterior a `endDate`, hasta 365 días) y tomar un permiso del
   limitador de concurrencia (`Semaphore` con `tryAcquire`, sin espera); sin permiso → 429.
2. `MigratoryRecordsProvider.findForPeriod` (de `process-foreign-guest-data`): movimientos del periodo, filtrando
   por `movementDate` (D7), huéspedes `FOREIGN` y reservas `IN_PROGRESS` o `COMPLETED`; se excluyen `CANCELLED` y `NO_SHOW`.
3. Separar `COMPLETE` de `INCOMPLETE`. Sin extranjeros → `NO_MIGRATORY_RECORDS`; sin completos → `NO_VALID_RECORDS`.
4. `SireFileBuilder` arma el archivo en memoria con las columnas, anchos y delimitadores oficiales y el
   juego de caracteres exigido; un carácter no codificable detiene el proceso (`INVALID_CHARACTERS`).
5. **Transacción**: guardar `SireExport` (`id` = `exportId`, fecha, periodo, `recordsCount`, `excludedCount`,
   `processedBy`) y una `SireExportExclusion` por cada registro excluido. Si algo falla antes, no se guarda nada.
6. Responder 200 con el archivo y `Export-Id`; liberar el permiso en un bloque `finally`.

### Componentes (`com.hospitua.reservas.migration`)

| Clase | Responsabilidad |
|---|---|
| `SireExportController` | Las dos rutas y el manejo de cabeceras |
| `SireExportService` | Orquesta el flujo |
| `SireFileBuilder` | Formato `.TXT` (aislado para poder cambiarlo sin tocar el resto) |
| `SireExportConcurrencyLimiter` | Límite de exportaciones simultáneas |
| `SireExport`, `SireExportExclusion` y repositorios | Histórico y exclusiones |
| `SireExportProperties` | `hospitua.sire.max-period-days`, `max-concurrent` y juego de caracteres |

### Datos

- `sire_export(id uuid, export_date, records_count, excluded_count, date_range_start, date_range_end, processed_by)`.
- `sire_export_exclusion(id, export_id → sire_export.id, reservation_ref, guest_ref, missing_fields, reason)`.

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/migration/
├── SireExportController.java
├── SireExportService.java
├── SireFileBuilder.java
├── SireExportConcurrencyLimiter.java
├── SireExportProperties.java
├── SireExport.java
├── SireExportExclusion.java
└── SireExportRepository.java, SireExportExclusionRepository.java
backend/src/test/java/com/hospitua/reservas/
├── unit/migration/SireFileBuilderTest.java
└── integration/migration/SireExportIT.java
backend/src/test/resources/sire/expected-export.txt        # archivo de referencia
frontend/src/pages/SireExportPage.tsx                       # portal de Migración
frontend/src/services/sireExportService.ts
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| Esc. 1: exportación con extranjeros completos | `SireExportIT` y `SireFileBuilderTest` contra el archivo de referencia |
| Esc. 2: reservas `CANCELLED` y `NO_SHOW` | No aparecen en el archivo |
| Esc. 3: registros incompletos | Excluidos del archivo, 200 solo con archivo y `Export-Id`, exclusiones guardadas |
| Esc. 4: periodo sin extranjeros | 400, sin archivo ni registro |
| Esc. 5: reporte de exclusiones | Lista correcta; `exportId` inexistente → 400 |
| Caso borde: todos incompletos | 400 `NO_VALID_RECORDS` |
| Caso borde: más de 1 año, invertido, formato inválido | 400 sin consultas |
| Caso borde: caracteres no codificables | 400 y nada guardado |
| Caso borde: solicitudes simultáneas | Con el límite en 1, la segunda recibe 429; el permiso se libera aun con error |
| Trazabilidad | Cada exportación exitosa crea un `SireExport` con `processedBy` |
| NFR-001 | 500 huéspedes < 2 s |
| Solo datos locales | Cero llamadas a los Módulos 1 y 3 |
| Portal | Prueba de componente: descarga del archivo, lectura de `Export-Id` y tabla de exclusiones |

## Phase 3: User Story 1 - Generación y exportación de SIRE (Priority: P2)

**Goal**: entregar a Migración el archivo válido y el reporte de exclusiones.  
**Independent Test**: los cinco escenarios del spec y los casos borde.

### Tests

- [ ] T-SIR-01 [P] [US1] `SireFileBuilderTest`: columnas, anchos, delimitadores, juego de caracteres y archivo de referencia
- [ ] T-SIR-02 [P] [US1] `SireExportIT`: escenarios 1 a 5 y casos borde
- [ ] T-SIR-03 [P] [US1] Prueba del límite de solicitudes simultáneas (429)

### Implementation

- [ ] T-SIR-04 [US1] Crear las tablas `sire_export` y `sire_export_exclusion` en el esquema base (coordinado con T007)
- [ ] T-SIR-05 [P] [US1] Crear las entidades, repositorios y `SireExportProperties`
- [ ] T-SIR-06 [US1] Implementar `SireFileBuilder` con el formato oficial (depende de la definición del formato, ver Preguntas abiertas)
- [ ] T-SIR-07 [P] [US1] Implementar `SireExportConcurrencyLimiter`
- [ ] T-SIR-08 [US1] Implementar `SireExportService` (depende de T-PFG-08, T-SIR-05 a T-SIR-07 y T010)
- [ ] T-SIR-09 [US1] Implementar `SireExportController` con el rol `MIGRATION` y `Export-Id` expuesto (depende de T018)
- [ ] T-SIR-10 [US1] Crear `SireExportPage` y `sireExportService.ts` en el frontend (periodo, descarga y exclusiones)

**Checkpoint**: Migración descarga el archivo y consulta las exclusiones sin intermediación de la Recepcionista.

## Dependencies & Execution Order

- Depende de `process-foreign-guest-data` (T-PFG-08), de las entidades `Reservation` y `Guest`, y de T007, T010 y T018 del plan base.
- **Bloqueada por la definición del formato oficial** del archivo (T-SIR-06).

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Formato oficial del archivo SIRE** (columnas, anchos, delimitadores, orden y juego de caracteres): no está en ningún documento del repositorio y es imprescindible para T-SIR-06 y el archivo de referencia.
2. **Mapeo de `movementType`** (`ENTRY` o `DEPARTURE`) a los códigos que exige Migración Colombia.
3. **Límite de exportaciones simultáneas** (`max-concurrent`) y su alcance por instancia.
4. **Autenticación del actor Migración** (Spring Security): mecanismo y expiración de la sesión.
5. **Doble reporte**: cómo evitar exportar dos veces al mismo huésped en periodos que se solapan; el spec lo menciona como riesgo pero no define la regla (el diccionario actual ya no incluye `sireExportStatus`).
