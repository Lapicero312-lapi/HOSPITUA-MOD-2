# Implementation Plan: Base del Módulo 2 (plataforma compartida)

**Date**: 2026-09-26  
**Spec**: [diccionario.md](../diccionario.md) (contrato de integración) y los `spec.md` de las 13 features  
en `specs/*/`. Este plan no implementa una feature: deja lista la base que todos los planes de
feature reutilizan.

## Summary

El Módulo 2 (Operación de Reservas y Cumplimiento Legal) es el dueño del ciclo de vida de las
reservas (`Reservation.status`). Registra reservas directas (Recepcionista) y de OTA (API),
las modifica, las cancela, cierra el día (No-Show), recibe del Módulo 1 los avisos de Check-In y
Check-Out, y genera el reporte SIRE para Migración. Consulta al Módulo 1 (inventario y calendario de
mantenimientos) y al Módulo 3 (tarifa dinámica), y le ordena al Módulo 1 apartar (`Reserved`) o
liberar (`Available`) una habitación **solo cuando la llegada es el día operativo en curso**.

Este plan fija lo que comparten las 13 features: stack, estructura, modelo de datos, contratos de
integración (REST y colas), manejo uniforme de errores (siempre 4xx, nunca 500), tareas programadas y
pruebas. Cada plan de feature (`specs/[feature]/plan.md`) depende de este y solo describe lo propio.

## Technical Context

- **Language/Version**: Java 21
- **Primary Dependencies**: Spring Boot, Spring Web, Spring Data JPA, Bean Validation, Lombok, Spring AMQP, Spring Security, Flyway
- **Storage**: PostgreSQL
- **Build**: Maven
- **Messaging**: RabbitMQ
- **Testing**: JUnit 5, Mockito, Spring Boot Test, Testcontainers
- **Target Platform**: servidor Linux/Windows + navegador web
- **Project Type**: web application (`backend/` + `frontend/`)
- **API**: REST
- **Frontend**: React + Vite
- **Version Control**: Git + GitHub (Gitflow)
- **Performance Goals**: NEEDS CLARIFICATION (las specs fijan tiempos por operación: cancelación local
< 200 ms, Check-In/Check-Out < 500 ms, recotización < 3 s, exportación SIRE < 2 s para 500 huéspedes,
cierre del día < 1 min para 1000 reservas; falta un objetivo global de carga)
- **Constraints**: NEEDS CLARIFICATION
- **Scale/Scope**: NEEDS CLARIFICATION

### Dependencias y herramientas adicionales a la lista original (aprobadas)

| Necesidad | Propuesta | Por qué |
|---|---|---|
| Herramienta de build | Maven (aprobado) | Estándar con Spring Boot |
| Migraciones de esquema | Flyway (aprobado) | Versionar el esquema en `db/migration` |
| Autenticación y autorización | Spring Security (aprobado) | Las specs exigen interfaces "exclusivas y seguras" (Migración) y que cada Ota vea solo sus reservas |
| Tareas programadas | `@Scheduled` (viene con Spring) | Apartado del inicio del día, cierre del día y reintentos |
| Exclusión mutua de tareas con varias instancias | Bloqueo asesor de PostgreSQL (decisión C10) | Evitar que dos instancias ejecuten el mismo cierre del día |
| Timeouts y reintentos REST | `RestClient` con timeouts; Resilience4j opcional | No asumir disponibilidad ante caídas |
| Paquete base | `com.hospitua.reservas` (aprobado) | Convención |

## Comunicación entre módulos

Regla: **proactiva** (el módulo avisa un evento y no espera respuesta) → **cola RabbitMQ**;
**reactiva** (necesita un dato o confirmación inmediata) → **REST**.

| Interacción | Dirección | Mecanismo | Tipo | Feature |
|---|---|---|---|---|
| Notificación de check-in | M1 → M2 | Cola | Proactiva | `update-reservation` |
| Notificación de check-out | M1 → M2 | Cola | Proactiva | `update-reservation` |
| Datos de huéspedes extranjeros | M1 → M2 | Cola: dentro del mensaje `habitacion.checkin` | Proactiva | `process-foreign-guest-data` (decisión C2) |
| Consultar reservas | M1 → M2 | REST GET | Reactiva | `check-view-reservation` |
| Consultar inventario de habitaciones | M2 → M1 | REST GET | Reactiva | `consult-room-inventory` |
| Consultar calendario de mantenimientos | M2 → M1 | REST GET | Reactiva | `consult-maintenance-calendar` (decisión C4) |
| Marcar habitación como reservada / liberar | M2 → M1 | REST POST/PUT | Reactiva | `set-room-state` |
| Consultar % de comisión OTA | M3 → M2 | REST GET | Reactiva | `register-ota-information-commission` (decisión C3a) |
| Consultar tarifa dinámica | M2 → M3 | REST POST (cuerpo JSON) | Reactiva | `calculate-dynamic-rate` |

Las interacciones M1 ↔ M3 (liquidación, tarifa base, registrar check-out) no involucran al Módulo 2.

### Convenciones de colas

- Exchange compartido: `hospitua.events` (tipo topic).
- Routing keys: `habitacion.checkin`, `habitacion.checkout`. (`huesped.no-encontrado` queda fuera del plan: ver C3b.)
- Mensaje JSON con: `eventId`, `eventType`, `occurredAt`, `sourceModule`, `payload`.
- Consumidores idempotentes (se ignoran los `eventId` repetidos), con reintentos y dead-letter queue.

### Traducción de respuestas HTTP a cola (decisión C1)

Los specs describen "responde 200/400" para el Check-In y el Check-Out. Como el Módulo 1 los emite
por cola y no espera respuesta, el consumidor del Módulo 2 aplica estas reglas:

| Caso en el spec | Comportamiento del consumidor |
|---|---|
| Notificación válida | Procesa el cambio y confirma el mensaje |
| Duplicado (mismo `eventId`, o Check-Out sobre una reserva ya `COMPLETED`, o Check-In sobre una `IN_PROGRESS` sin datos migratorios nuevos) | Confirma sin efectos (el "200 idempotente") |
| Reserva inexistente o en un estado que no admite el evento | Registra un `ReconciliationIncident` (`CHECK_IN` o `CHECK_OUT`) y confirma el mensaje, sin reintentar (el "400 + incidencia") |
| Payload ilegible, sin `reservationRef` o con caracteres maliciosos | Envía el mensaje a la dead-letter queue, sin procesar (el "400" de payload inválido) |
| Datos migratorios inválidos con reserva válida | Cambia el estado, registra el `MigratoryMovement` como `INCOMPLETE` y confirma (el "200 + `INCOMPLETE`") |
| Fallo temporal (base de datos caída, por ejemplo) | Reintenta con espera creciente y, agotados los reintentos, a la dead-letter queue |

Contenido propuesto del `payload` (según las specs):

| Routing key | `payload` |
|---|---|
| `habitacion.checkin` | `reservationRef` y, si el huésped es extranjero, `ForeignGuestData` (tipo y fecha de movimiento, pasaporte, visa, nacionalidad, fecha de nacimiento, procedencia) |
| `habitacion.checkout` | `reservationRef` |

## Contratos REST

**El Módulo 2 expone** (rutas propuestas, se fijan en cada plan de feature):

| Recurso | Quién lo consume | Feature |
|---|---|---|
| `GET /api/reservations?reservationRef=|documentNumber=|fullName=` | Recepcionista, Módulo 1, procesos internos | `check-view-reservation` |
| `POST /api/reservations/direct/preview` y `POST /api/reservations/direct` (canal directo) | Recepcionista | `generate-direct-reservation` |
| `POST /api/reservations/{reservationRef}/modification-preview` y `PATCH /api/reservations/{reservationRef}` | Recepcionista, Ota | `update-reservation` |
| `POST /api/reservations/{reservationRef}/cancellation` | Recepcionista, Ota | `cancel-reservation` |
| `POST /api/ota/reservations` y `POST /api/ota/reservations/{reservationRef}/confirmation` (pago o garantía) | Ota | `generate-ota-reservation` |
| `POST /api/sire/exports` con cuerpo `startDate` y `endDate` (devuelve `.TXT` y cabecera `Export-Id`; es `POST` porque registra un `SireExport`, decisión D9) | Migración | `export-sire-file` |
| `GET /api/sire/exports/{exportId}/exclusions` | Migración | `export-sire-file` |
| `GET /api/otas/{otaId}` (devuelve `id`, `name`, `commissionPercentage`) | Módulo 3 | `register-ota-information-commission` |
| `POST /api/otas` y `PUT /api/otas/{otaId}` (alta y edición de agencias) | Recepcionista, Administrador | `register-ota-information-commission` |
| `POST /api/ota-commissions/reconciliations` (conciliación de comisiones) | Área financiera | `register-ota-information-commission` |

**El Módulo 2 consume** (a través de `Module1Client` y `Module3Client`):

| Servicio | Método | Feature |
|---|---|---|
| Inventario de habitaciones por `categoryRoom` (o `roomId`) | M1 GET | `consult-room-inventory` |
| Calendario de mantenimientos por categoría y rango | M1 GET | `consult-maintenance-calendar` |
| Establecer estado de habitación (`Reserved` o `Available`, con `sequenceNumber`, `originEvent`, `reservationRef`) y consulta del resultado por `requestId` | M1 POST/PUT | `set-room-state` |
| Tarifa dinámica: cuerpo `categoryRoom`, `startDate`, `endDate`, `previousGrossAmount` (opcional); respuesta `grossAmount`, `amountDifference`, `currency`, `calculatedAt` | M3 POST | `calculate-dynamic-rate` |

**Errores**: cuerpo `{ "errorCode", "message", "timestamp", "path" }` con HTTP 400 (por defecto, también
para recursos inexistentes, como piden los specs), 409 (conflicto de disponibilidad) o 429 (exportación
SIRE). Ningún spec usa 404. El diccionario prohíbe 500 y cualquier 2xx o 3xx para un error.

## Project Structure

### Documentation (this feature)

```text
specs/
├── diccionario.md
├── base/
│   └── plan.md                  # Este archivo
└── [feature]/
    ├── spec.md
    └── plan.md                  # Referencia a specs/base/plan.md
```

### Source Code (repository root)

```text
backend/
├── pom.xml
├── Dockerfile
└── src/
    ├── main/
    │   ├── java/com/hospitua/reservas/
    │   │   ├── config/               # RabbitConfig, RestClientConfig, HotelClockConfig, SecurityConfig
    │   │   ├── common/               # ApiError, excepciones de negocio, GlobalExceptionHandler
    │   │   ├── reservation/          # Reservation, ReservationStatus, ReservationStatusService, consulta
    │   │   ├── guest/                # Guest
    │   │   ├── availability/         # Verificar disponibilidades (M1 + reservas locales)
    │   │   ├── pricing/              # RateQuote y cliente del Módulo 3
    │   │   ├── roomstate/            # RoomStateRequest, cola por Room, reintentos
    │   │   ├── cancellation/         # Cancellation
    │   │   ├── ota/                  # Ota, comisión OTA
    │   │   ├── migration/            # MigratoryMovement, SireExport, SireExportExclusion
    │   │   ├── reconciliation/       # ReconciliationIncident
    │   │   ├── jobs/                 # apartado del inicio del día, cierre del día, reintentos
    │   │   ├── integration/
    │   │   │   ├── module1/          # Module1Client (REST) y DTOs
    │   │   │   └── module3/          # Module3Client (REST) y DTOs
    │   │   └── messaging/            # consumidores RabbitMQ, EventEnvelope, idempotencia
    │   └── resources/
    │       ├── application.yml
    │       └── db/migration/         # V1__esquema_base.sql 
    └── test/java/com/hospitua/reservas/
        ├── unit/
        ├── integration/              # Spring Boot Test + Testcontainers (PostgreSQL, RabbitMQ)
        └── contract/                 # contratos REST y de mensajes

frontend/
├── package.json
├── vite.config.ts
└── src/
    ├── components/
    ├── pages/                        # pantallas de la Recepcionista y portal de Migración
    ├── services/                     # clientes de la API del backend
    └── test/
```

**Structure Decision**: aplicación web `backend/` + `frontend/`. El backend se organiza por dominio
porque cada feature de las specs toca un concepto concreto. El frontend cubre a la Recepcionista y a
Migración; la Ota solo usa la API y el Módulo 1 tiene su propia interfaz.

## Diseño técnico base

### Modelo de datos base (PostgreSQL)

| Tabla | Entidad | Notas |
|---|---|---|
| `reservation` | `Reservation` | `reservation_ref` único; `guest_id`, `category_room`, `start_date`, `end_date`, `source`, `status`, `status_reason` (D6), `created_at`; `room_id` (referencia a `Room.id` del Módulo 1); `late_arrival_notice`; `version` (`@Version`); `gross_amount` y `gross_amount_currency` (decisión D2); `commission_percentage`, `commission_amount`, `commission_status`; único `(ota_id, external_confirmation_code)` |
| `guest` | `Guest` | `type` `NATIONAL` o `FOREIGN` |
| `ota` | `Ota` | `commission_percentage` |
| `cancellation` | `Cancellation` | Inmutable; `channel` `RECEPTION` u `OTA_API` |
| `room_state_request` | `RoomStateRequest` | Único `(room_id, sequence_number)`; secuencia asignada de forma atómica por `Room` |
| `reconciliation_incident` | `ReconciliationIncident` | `origin`: `CHECK_IN`, `CHECK_OUT` o `ROOM_STATE` |
| `migratory_movement` | `MigratoryMovement` | Uno por reserva |
| `sire_export`, `sire_export_exclusion` | `SireExport`, `SireExportExclusion` | `exportId` = `SireExport.id` |
| `reservation_audit` | auditoría de actualizaciones | Inmutable |
| `room_sequence` | último `sequenceNumber` por habitación | Una fila por `room_id`; se bloquea (`FOR UPDATE`) al asignar la secuencia |
| `commission_audit` | auditoría de comisiones OTA | Inmutable: reserva, agencia, acción, importes y actor |
| `processed_event` | idempotencia de colas | Clave `event_id` |

`Reservation.status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`) se
guarda como texto. `Room`, `ForeignGuestData`, `MaintenanceCalendar` y `RateQuote` son del Módulo 1 o
3: **no se persisten** en el Módulo 2; solo viajan en DTO de integración.

### Reglas transversales que todos los planes de feature heredan

1. **Transiciones de `status` en un solo lugar.** `ReservationStatusService` valida la tabla de
   transiciones (`PENDING`→`ACTIVE`, `ACTIVE`→`IN_PROGRESS`, `IN_PROGRESS`→`COMPLETED`,
   `ACTIVE`/`PENDING`→`CANCELLED`, `ACTIVE`/`PENDING`→`NO_SHOW`) y el bloqueo optimista. La feature
   `update-reservation` lo usa para confirmación OTA, Check-In, Check-Out, No-Show y cancelación
   compensatoria; `cancel-reservation` lo invoca dentro de su propia transacción, con las mismas
   reglas.
2. **Saga para reservas con llegada hoy.** Crear la reserva, ordenar `Reserved` al Módulo 1 y, si
   este rechaza o no responde, compensar cancelándola (`ROOM_REJECTED` o `ROOM_UNCONFIRMED`) y
   neutralizando con `Available` de mayor `sequenceNumber` si el resultado fue ambiguo. **La
   llamada REST al Módulo 1 no se hace dentro de una transacción de base de datos abierta.**
3. **Órdenes al Módulo 1 con secuencia.** Toda orden pasa por `roomstate/`: `sequenceNumber` atómico
   por `Room`, envío de una en una, estados `PENDING`/`COMPLETED`/`REJECTED`, consulta idempotente
   del resultado por `requestId` y `ReconciliationIncident` si queda `UNRESOLVED`.
4. **Tareas programadas** (zona horaria del hotel, idempotentes): apartado del inicio del día
   (`RESERVATION_DUE_TODAY`), cierre del día (No-Show: `NO_SHOW` en OTA, `CANCELLED` en directa, sin
   `Cancellation`, ignorando `lateArrivalNotice`) y reintento de órdenes `PENDING`.
5. **Errores uniformes.** Un `@RestControllerAdvice` traduce toda excepción a `ApiError` 4xx; un conflicto de `version` (ediciones o cancelaciones simultáneas) es siempre 400 `CONCURRENT_UPDATE`. Ningún
   error no controlado sale como 500; el manejador genérico registra el detalle en el log y responde
   un error controlado sin datos de infraestructura.
6. **Clientes de otros módulos** detrás de interfaces (`Module1Client`, `Module3Client`) con timeout.
   Ante fallo, cada feature decide, pero nunca se asume disponibilidad ni tarifa por defecto o a cero.
7. **Mensajería.** `EventEnvelope` con `eventId`, `eventType`, `occurredAt`, `sourceModule`,
   `payload`. El consumidor registra el `eventId` en `processed_event` dentro de la misma
   transacción que el cambio. Reintentos con backoff y dead-letter queue.
8. **Nomenclatura del diccionario**: `Reservation.status`, `roomNumber`, `startDate`/`endDate`,
   `externalConfirmationCode`, `grossAmount`, `categoryRoom`, `reservationRef`; estados del Módulo 1
   en PascalCase (`Available`, `Reserved`, `Occupied`, ...).

### Decisiones de diseño tomadas al escribir los planes de feature

| # | Decisión | Origen |
|---|---|---|
| D1 | **La confirmación de una cotización no confía en el importe de la pantalla.** Al confirmar, el servidor vuelve a cotizar con el Módulo 3 y lo compara con el importe que vio el solicitante; si difiere, responde 400 "La tarifa cambió, vuelva a cotizar". Nunca se guarda un monto enviado por el cliente y la `RateQuote` sigue sin persistirse. Lo aplican `generate-direct-reservation` y `update-reservation`. | `calculate-dynamic-rate` |
| D2 | **`Reservation` guarda la moneda del importe:** columna `gross_amount_currency` junto a `gross_amount`, porque FR-002 pide conservar la `currency` y el diccionario no la lista. Pendiente agregarla al diccionario. | `calculate-dynamic-rate` |
| D3 | **Restricción de exclusión en PostgreSQL** sobre `reservation`: `EXCLUDE USING gist (room_id WITH =, daterange(start_date, end_date) WITH &&) WHERE (status IN ('PENDING','ACTIVE','IN_PROGRESS'))`, con la extensión `btree_gist` creada en la migración base (T007). Impide dos reservas activas solapadas en la misma habitación aun con concurrencia; una violación se traduce en 409 `NO_AVAILABILITY` (o en probar la siguiente habitación candidata). | `check-room-availability` |
| D4 | **El spec `consult-room-inventory` se ajustó**: la consulta por categoría admite listado completo o filtrado por estado, porque las estadías futuras necesitan todas las habitaciones de la categoría. Pendiente acordar con el Módulo 1 que su API permita ambos modos. | `check-room-availability` |
| D5 | **Extranjero sin datos migratorios:** si llega el Check-In de un huésped `FOREIGN` sin `foreignGuestData`, se registra el `MigratoryMovement` como `INCOMPLETE` con `missingFields = [movementType, movementDate]`. | `process-foreign-guest-data` |
| D6 | **Motivo de las transiciones:** columna `status_reason` en `reservation` (`ROOM_REJECTED`, `ROOM_UNCONFIRMED`). Pendiente agregarla al diccionario. | `update-reservation` |
| D7 | **Periodo de la exportación SIRE:** se filtra por la `movementDate` del movimiento migratorio. | `process-foreign-guest-data`, `export-sire-file` |
| D8 | **API de modificación en dos pasos:** `POST .../modification-preview` (no persiste) y `PATCH` (confirma, con `version` y `expectedGrossAmount`). Propuesta de los planes; el spec no define su forma. | `update-reservation` |
| D9 | **La exportación SIRE es `POST`**, no `GET`, porque crea un registro `SireExport` (un `GET` no debe tener efectos). | `export-sire-file` |

## Estrategia de testing base

- **Unitarios** (JUnit 5 + Mockito): reglas de negocio, tabla de transiciones, cálculo de comisión.
- **Integración** (Spring Boot Test + Testcontainers): PostgreSQL y RabbitMQ reales; concurrencia
  optimista, unicidad de `(room_id, sequence_number)`, idempotencia de consumidores, dead-letter.
- **Contrato**: `Module1Client` y `Module3Client` contra respuestas simuladas (por ejemplo
  `MockRestServiceServer`, parte de Spring Test): éxito, rechazo, timeout y respuesta ambigua.
- **Cada escenario Gherkin** de un `spec.md` debe tener al menos una prueba de integración en el plan
  de su feature.
- **Frontend**: pruebas de componentes de pantallas críticas; herramienta NEEDS CLARIFICATION.

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Crear la estructura `backend/` y `frontend/` según Project Structure
- [ ] T002 Inicializar `backend/pom.xml` con Java 21 y las dependencias de Technical Context
- [ ] T003 Inicializar `frontend/` con React + Vite
- [ ] T004 [P] Configurar formato y análisis estático en backend y frontend
- [ ] T005 [P] Crear `docker-compose.yml` con PostgreSQL y RabbitMQ para desarrollo
- [ ] T006 Configurar `application.yml` por perfil (dev, test) con variables de entorno

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRÍTICO**: Ninguna feature puede empezar hasta terminar esta fase.

- [ ] T007 Definir el esquema base (tablas de Diseño técnico base), la extensión `btree_gist` y la restricción de exclusión de `reservation` (D3), con migraciones Flyway
- [ ] T008 [P] Crear `Reservation`, `Guest`, `Ota` y sus repositorios
- [ ] T009 [P] Crear `ApiError`, las excepciones de negocio y `GlobalExceptionHandler` en `common/`
- [ ] T010 [P] Configurar el bean `Clock` de la zona horaria del hotel
- [ ] T011 Implementar `ReservationStatusService` con la tabla de transiciones y bloqueo optimista
  (depende de T008, T009)
- [ ] T012 [P] Implementar `Module1Client` y `Module3Client` con timeouts y sus DTO
- [ ] T013 Configurar RabbitMQ: exchange `hospitua.events`, colas, routing keys, reintentos y
  dead-letter en `config/RabbitConfig`
- [ ] T014 Crear `EventEnvelope`, `processed_event` y la idempotencia en `messaging/`
- [ ] T015 [P] Crear `ReconciliationIncident` y su servicio de registro
- [ ] T016 Configurar la infraestructura de pruebas (Testcontainers de PostgreSQL y RabbitMQ)
- [ ] T017 [P] Esqueleto del frontend: enrutamiento, cliente HTTP y manejo de errores de API
- [ ] T018 Configurar autenticación y autorización con los roles `RECEPTIONIST`, `OTA`, `MIGRATION`, `ADMIN`, `FINANCE`, `MODULE1` y `MODULE3` (los dos últimos, de servicio a servicio),
  con Spring Security
- [ ] T019 Configurar logs y correlación de solicitudes

**Checkpoint**: Base lista; los planes de feature pueden implementarse.

---

## Orden recomendado de los 13 planes de feature

1. **Consultas y servicios base**: `check-view-reservation`, `consult-room-inventory`,
   `consult-maintenance-calendar`, `calculate-dynamic-rate`.
2. **Disponibilidad**: `check-room-availability` (usa las tres consultas anteriores).
3. **Integración con el Módulo 1**: `set-room-state`.
4. **Datos migratorios y punto de estado**: primero `process-foreign-guest-data`, y después `update-reservation`
   (modificación, Check-In, Check-Out y cierre del día; depende de disponibilidad, tarifa, `set-room-state`
   y del registro del movimiento migratorio).
5. **Creación de reservas y comisión**: `generate-direct-reservation`, `register-ota-information-commission` (antes que la de OTA) y
   `generate-ota-reservation`.
6. **Cancelación**: `cancel-reservation`.
7. **Cumplimiento legal**: `export-sire-file` (depende de `process-foreign-guest-data`).

## Dependencies & Execution Order

- **Setup (Fase 1)**: sin dependencias. **Foundational (Fase 2)**: depende de Setup y bloquea a todos
  los planes de feature.
- Los planes de feature dependen de este plan base y entre sí según el orden anterior.
- Dentro de cada feature: modelos, servicios, endpoints y pruebas de integración por escenario.

## Contradicciones detectadas y decisiones tomadas

Las 10 contradicciones entre la especificación técnica, los specs, el diccionario y los diagramas
quedaron decididas. La tabla registra cada decisión y lo que falta ajustar en otros documentos.

| # | Contradicción | Decisión |
|---|---|---|
| C1 | Los specs dicen que el Módulo 1 "envía a la API del Módulo 2" el Check-In y el Check-Out y que este "responde HTTP 200/400". La especificación técnica y el diagrama de integración los definen como **cola**, donde no hay respuesta HTTP al Módulo 1. | **DECIDIDO: solo cola.** Reglas en "Traducción de respuestas HTTP a cola". Los specs se ajustarán después. |
| C2 | El diagrama de integración muestra "Datos de huéspedes extranjeros" como **cola separada**; la especificación técnica no la incluye entre las routing keys y los specs los reciben **dentro** de la notificación de Check-In. | **DECIDIDO: dentro de `habitacion.checkin`** (según los specs, sin routing key nueva). Pendiente acordar con el Módulo 1 y actualizar `mod-1-2-3.drawio` (quitar la flecha aparte y anotar los datos en la del check-in). |
| C3 | (a) "Consultar estado de canales OTA" (M3 → M2) no existe en los specs; el diagrama de integración tiene "Consultar % de comisión OTA" (M3 → M2, REST GET). (b) "Error de huésped no encontrado" (M1 → M2) no aparece en ningún spec, diccionario ni diagrama. | **DECIDIDO (a): se adopta como "Consultar % de comisión OTA"**, REST GET; el Módulo 2 expone `GET /api/otas/{otaId}`; falta agregar esa línea al spec de comisión OTA. **DECIDIDO (b): fuera del plan** hasta que el Módulo 1 confirme su función y exista un spec. |
| C4 | "Consultar calendario de mantenimientos" no está en la especificación técnica ni en el diagrama de integración, pero sí en los specs, el diccionario y el diagrama de casos de uso. | **DECIDIDO: REST GET reactiva (M2 → M1)**, igual que el inventario. Pendiente agregarla a `mod-1-2-3.drawio`. |
| C5 | El diagrama de casos de uso muestra que "Generar reservación por OTA" incluye "Calcular tarifa dinámica"; el spec (FR-005) y el diccionario dicen que **no** se recalcula: usa el valor bruto que envía la OTA. | **DECIDIDO: según el spec y el diccionario.** La OTA envía su valor y el Módulo 2 lo usa; no llama al Módulo 3 en la reserva OTA, para que la comisión cuadre con lo que cobró la agencia. Pendiente quitar del diagrama de casos de uso la línea "Generar reservación por OTA" → "Calcular tarifa dinámica" (lo aprueba el equipo). |
| C6 | El diccionario nombra `grossAmount` en `Reservation`; el spec de OTA y el de comisión usan `totalAmount`. | **DECIDIDO: un solo nombre interno, `grossAmount`** (columna `gross_amount`). `totalAmount` queda solo como nombre del campo en el JSON que envía la OTA. Pendiente corregir los specs `generate-ota-reservation` y `register-ota-information-commission` para que la entidad diga `grossAmount`. |
| C7 | Fórmula de comisión `totalAmount × commissionPercentage` sin `/100`, con ejemplo 15% de $400 = $60, validación 0–100% y, en el diccionario, `-(Valor × %)` para el Módulo 3. | **DECIDIDO: porcentaje de 0 a 100 y se divide entre 100.** `commissionAmount = grossAmount × commissionPercentage / 100`, con `BigDecimal`, 2 decimales y redondeo `HALF_UP`; el valor queda positivo en el Módulo 2 (el signo lo aplica el Módulo 3). Pendiente confirmar con el Módulo 3 cómo expresa el porcentaje que recibe por `GET /api/otas/{otaId}`. |
| C8 | El estado `Reserved` del Módulo 1 es una solicitud pendiente de aprobación por su equipo (diccionario), pero todo el flujo del día de llegada depende de él. | **DECIDIDO: se implementa según los specs, sin interruptor.** Las reservas con llegada hoy generan la orden `Reserved` al Módulo 1 (que es quien guarda ese estado en la habitación). Hasta que el Módulo 1 lo agregue, esas reservas fallarán y se cancelarán por compensación; el equipo lo acordará con el Módulo 1. |
| C9 | Para reservas con llegada hoy, el spec exige "todo o nada" con la respuesta del Módulo 1 y, a la vez, que la compensación cancele la reserva recién creada mediante `update-reservation`. | **DECIDIDO: guardar primero, ordenar después y compensar si falla** (regla transversal 2). La reserva guardada bloquea la habitación en la verificación de disponibilidad mientras se espera al Módulo 1, y los intentos fallidos quedan como `CANCELLED` con su motivo. La llamada al Módulo 1 no se hace dentro de una transacción de base de datos abierta. |
| C10 | Las tareas programadas (apartado del inicio del día, cierre del día, reintentos) no tienen mecanismo definido y con varias instancias podrían ejecutarse dos veces. | **DECIDIDO: `@Scheduled` con bloqueo asesor de PostgreSQL** (`pg_try_advisory_lock`, consulta nativa, sin dependencias nuevas). Si otra instancia tiene el bloqueo, se salta esa ejecución. Zona horaria y horas de inicio y cierre del día configurables (`hospitua.hotel.timezone` y horas del día operativo). La idempotencia que piden los specs sigue siendo la garantía principal. |

### Cambios pendientes en otros documentos (consecuencia de las decisiones)

Estos ajustes **no** están hechos; los specs y los diagramas son del equipo y se acuerdan aparte.

| Documento | Cambio | Decisión |
|---|---|---|
| `update-reservation/spec.md`, `process-foreign-guest-data/spec.md` | Cambiar "envía a la API del Módulo 2 / responde 200 o 400" por las reglas de cola (confirmar, incidencia, dead-letter) | C1 |
| `mod-1-2-3.drawio` | Quitar la flecha aparte "Datos de huéspedes extranjeros" y anotar los datos en la flecha de "Notificación de check-in"; agregar la flecha de "Consultar calendario de mantenimientos" (M2 → M1, REST GET); confirmar la flecha "Consultar % de comisión OTA" (M3 → M2) | C2, C4, C3a |
| `register-ota-information-commission/spec.md` | Agregar que el Módulo 2 expone `GET /api/otas/{otaId}` al Módulo 3; usar `grossAmount` en la entidad; documentar el porcentaje de 0 a 100 y el redondeo `HALF_UP` a 2 decimales | C3a, C6, C7 |
| `generate-ota-reservation/spec.md` | Usar `grossAmount` en la entidad (el campo del JSON de la OTA sigue siendo `totalAmount`) | C6 |
| `DIAGRAMA.drawio` (casos de uso) | Quitar la línea "Generar reservación por OTA" → "Calcular tarifa dinámica" | C5 |
| Equipo del Módulo 1 | Agregar el estado `Reserved`; confirmar que los datos migratorios viajan dentro de `habitacion.checkin`; confirmar el origen del tipo y la fecha del movimiento migratorio | C8, C2 |
| Equipo del Módulo 3 | Confirmar cómo expresa el porcentaje de comisión (0 a 100) | C7 |
| `diccionario.md` | Agregar `gross_amount_currency` (moneda del importe) y `status_reason` (motivo de la transición) a `Reservation`; agregar el modo de consulta del inventario por categoría con o sin filtro | D2, D6, D4 |
| `export-sire-file/spec.md` | Cambiar `GET` a `POST` en la generación (registra un `SireExport`) y definir el formato oficial del archivo | D9 |

## Notes

- `[P]` marca tareas paralelizables; `[US1]` (en los planes de feature) las liga a su historia de usuario.
- Cada plan de feature debe indicar en su encabezado: `Plan base: ../base/plan.md`.
- No se programa una feature hasta que su SPEC esté validado y su PLAN revisado (`sdd-guide.MD`).
- Commit por tarea o grupo lógico, con Gitflow.
