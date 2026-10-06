# Implementation Plan: Base del Módulo 2 (plataforma compartida)

**Date**: 2026-10-03  
**Spec**: [diccionario.md](../diccionario.md) (contrato de integración) y los `spec.md` de las 13 features  
en `specs/*/`. Este plan no implementa una feature: deja lista la base que todos los planes de
feature reutilizan.

## Summary

El Módulo 2 (Operación de Reservas y Cumplimiento Legal) es el dueño del ciclo de vida de las
reservas (`Reservation.status`) y de `ReservationRoom.stayStatus`. Registra reservas directas
(Recepcionista) y recibe las de OTA por API, las modifica, las cancela, cierra el día (No-Show),
recibe del Módulo 1 los avisos de Check-In y Check-Out por habitación (con los huéspedes extranjeros
ya procesados), y genera el reporte SIRE.
Consulta al Módulo 1 (inventario y calendario de mantenimientos) y al Módulo 3 (tarifa dinámica), le
envía por cola la lista de reservas del día y le ordena apartar (`Reserved`) o liberar (`Available`)
una habitación **solo cuando la llegada es el día operativo en curso**.

Este plan fija lo que comparten las 13 features: stack, arquitectura hexagonal, estructura, modelo de
datos, contratos de integración (REST y colas), manejo uniforme de errores (siempre 4xx, nunca 500),
tareas programadas y pruebas. Cada plan de feature (`specs/[feature]/plan.md`) depende de este y solo
describe lo propio.

> **Estado de los planes de feature:** los `plan.md` de las 13 features se escribieron para Java y
> Spring. Hasta que se revisen, **este plan manda** en cualquier tema técnico (lenguaje, librerías,
> estructura de carpetas y pruebas).

## Technical Context

- **Language/Version**: TypeScript (modo `strict`), con la versión que fija el proyecto generado por
  Nest CLI; se deja con versión exacta en `package.json`. Node.js 22 LTS (`.nvmrc`)
- **Framework backend**: NestJS
- **Primary Dependencies**: `@nestjs/config`, `@nestjs/typeorm` + `typeorm` + `pg`, `class-validator`,
  `class-transformer`, `@golevelup/nestjs-rabbitmq`, `@nestjs/schedule`, `@nestjs/axios`,
  `@nestjs/passport` + `@nestjs/jwt`, `@nestjs/swagger`, `nestjs-pino`, `decimal.js`, `luxon`
- **Storage**: PostgreSQL
- **Messaging**: RabbitMQ
- **Architecture**: hexagonal (puertos y adaptadores), un módulo por dominio
- **Package manager**: pnpm (monorepo con `pnpm-workspace.yaml`)
- **Testing**: Jest, supertest, Testcontainers para Node; Vitest + Testing Library en el frontend
- **Target Platform**: servidor Linux/Windows + navegador web
- **Project Type**: web application (`backend/` + `frontend/`)
- **API**: REST, documentada con OpenAPI (`@nestjs/swagger`)
- **Frontend**: React + Vite + React Router + TanStack Query
- **Version Control**: Git + GitHub (Gitflow)
- **Performance Goals**: NEEDS CLARIFICATION (las specs fijan tiempos por operación: cancelación local
< 200 ms, Check-In/Check-Out < 500 ms, recotización < 3 s, exportación SIRE < 2 s para 500 huéspedes,
cierre del día < 1 min para 1000 reservas, página del listado < 1 s con hasta 50 000 reservas; falta un
objetivo global de carga)
- **Constraints**: NEEDS CLARIFICATION
- **Scale/Scope**: NEEDS CLARIFICATION

### Decisiones de stack

| Necesidad | Decisión | Por qué |
|---|---|---|
| Versión de TypeScript | La que trae el proyecto de `nest new`, fija y con `strict` | Es la combinación que Nest prueba; no se actualiza por separado |
| ORM | TypeORM (aprobado) | Permite escribir a mano el SQL propio de PostgreSQL (D3, bloqueo asesor, `FOR UPDATE`) dentro de las migraciones |
| Migraciones de esquema | Migraciones de TypeORM escritas en SQL, versionadas en `backend/src/migrations` | El esquema no se genera solo desde las clases: se revisa y se versiona |
| Librería de RabbitMQ | `@golevelup/nestjs-rabbitmq` (aprobado) | Exchange topic, reintentos con espera creciente y dead-letter sin armarlos a mano |
| Gestor de paquetes | pnpm (aprobado) | Instalación rápida, dependencias estrictas y filtros por paquete (`pnpm --filter backend test`) |
| Bloqueo optimista | `@VersionColumn` de TypeORM | Edición y cancelación simultáneas (`CONCURRENT_UPDATE`) |
| Dinero | `decimal.js`, columnas `numeric(14,2)`, redondeo `ROUND_HALF_UP`; **nunca `number`** | Comisión exacta |
| Fechas | Fechas puras `AAAA-MM-DD` (texto `date` en la base) y `luxon` para el día operativo en `America/Bogota` | Evita corrimientos por zona horaria. Se guardan e intercambian como `AAAA-MM-DD`; las pantallas las muestran como `dd/mm/aaaa` |
| Autenticación y autorización | Passport + JWT y guards por rol | Las specs exigen interfaces seguras y que cada Ota vea solo sus reservas |
| Tareas programadas | `@nestjs/schedule` con `timeZone: 'America/Bogota'` | Apartado del inicio del día, cierre del día y reintentos |
| Exclusión mutua de tareas con varias instancias | Bloqueo asesor de PostgreSQL (C10) | Evitar que dos instancias ejecuten el mismo cierre del día |
| Timeouts y reintentos REST | `@nestjs/axios` con timeout; `cockatiel` si se necesitan reintentos o corte de circuito | No asumir disponibilidad ante caídas |
| Logs y correlación | `nestjs-pino` + `AsyncLocalStorage` (identificador de correlación por solicitud) | Seguir un mensaje o una orden de punta a punta |

## Arquitectura hexagonal

El dominio no conoce ninguna tecnología. Las dependencias siempre apuntan hacia adentro:
`infrastructure` → `application` → `domain`.

| Capa | Contiene | Puede importar |
|---|---|---|
| `domain/` | Entidades y objetos de valor, reglas de negocio, tabla de transiciones de `status`, errores de negocio | Solo TypeScript puro (y `decimal.js` para dinero). **Nada de Nest, TypeORM ni RabbitMQ** |
| `application/` | Puertos de entrada (casos de uso), puertos de salida (lo que el módulo necesita) y los servicios que implementan los casos de uso | `domain/` |
| `infrastructure/in/` | Adaptadores de entrada: controladores REST, consumidores RabbitMQ, tareas programadas | `application/` (puertos de entrada) |
| `infrastructure/out/` | Adaptadores de salida: repositorios TypeORM, clientes HTTP del Módulo 1 y 3, publicadores RabbitMQ, reloj | `application/` (implementan los puertos de salida) |

Reglas:

1. Los controladores, consumidores y tareas programadas **solo llaman a un caso de uso**; no tienen
   reglas de negocio.
2. Las entidades del dominio no son las de TypeORM. El adaptador de persistencia tiene sus propias clases
   de tabla y las convierte con un mapeador.
3. Los módulos 1 y 3 se ven solo como puertos (`Module1Port`, `Module3Port`). Si cambia su API, solo se
   cambia el adaptador.
4. La inyección de dependencias de Nest une los puertos con sus adaptadores (símbolos como
   `RESERVATION_REPOSITORY`); el dominio nunca usa `@Injectable`.
5. Las dependencias entre capas y entre módulos se verifican en CI con `eslint-plugin-boundaries`
   (o `dependency-cruiser`).
6. Un módulo de dominio no importa las clases internas de otro: solo sus puertos de entrada.

## Comunicación entre módulos

Regla: **proactiva** (el módulo avisa un evento y no espera respuesta) → **cola RabbitMQ**;
**reactiva** (necesita un dato o confirmación inmediata) → **REST**.

| Interacción | Dirección | Mecanismo | Tipo | Feature |
|---|---|---|---|---|
| Check-In por habitación (con huéspedes extranjeros) | M1 → M2 | Cola `habitacion.checkin` | Proactiva | `update-reservation`, `process-foreign-guest-data` |
| Check-Out por habitación (con huéspedes extranjeros) | M1 → M2 | Cola `habitacion.checkout` | Proactiva | `update-reservation`, `process-foreign-guest-data` |
| Lista de reservas del día y sus actualizaciones | M2 → M1 | Cola | Proactiva | `check-view-reservation` |
| Consultar inventario de habitaciones | M2 → M1 | REST GET | Reactiva | `consult-room-inventory` |
| Consultar calendario de mantenimientos | M2 → M1 | REST GET | Reactiva | `consult-maintenance-calendar` |
| Marcar habitación como reservada / liberar | M2 → M1 | REST POST/PUT | Reactiva | `set-room-state` |
| Consultar % de comisión OTA | M3 → M2 | REST GET | Reactiva | `register-ota-information-commission` |
| Consultar tarifa dinámica (`POST /pricing/quotes`: `roomType`, `checkInDate`, `checkOutDate`; responde `quoteId`, `nightlyRates`, `lodgingAmount`) | M2 → M3 | REST POST (cuerpo JSON) | Reactiva | `calculate-dynamic-rate` |
| Consultar las reservas de un rango de fechas (y habitación) para validar un mantenimiento | M1 → M2 | REST GET | Reactiva | `check-view-reservation` (FR-023) |
| Consultar una reserva por su referencia (`quoteId` por habitación, canal y datos de la OTA) para liquidar en el Check-Out | M3 → M2 | REST GET | Reactiva | `check-view-reservation` (FR-022) |

El Módulo 1 **ya no consulta la lista de reservas** al Módulo 2 por REST: la recibe por cola. Solo
consulta las reservas entre una fecha de inicio y una de fin al registrar un mantenimiento (`check-view-reservation`,
FR-023); la lógica sobre esas reservas la aplica el Módulo 1. Las
interacciones M1 ↔ M3 (liquidación, tarifa base, registrar check-out) no involucran al Módulo 2.

### Convenciones de colas

- Exchange compartido: `hospitua.events` (tipo topic).
- Routing keys que **recibe** el Módulo 2: `habitacion.checkin`, `habitacion.checkout`.
- Routing keys que **envía** el Módulo 2 (nombres propuestos, a acordar con el Módulo 1):
  `reservas.lista-diaria`, `reservas.actualizacion-diaria`, `huesped.datos-devueltos`.
- Mensaje JSON con: `eventId`, `eventType`, `occurredAt`, `sourceModule`, `payload`. Los mensajes del Módulo 2
  al Módulo 1 llevan además `messageId` y `sequenceNumber` (creciente dentro del día, según el diccionario).
- Consumidores idempotentes (se ignoran los `eventId` repetidos), con reintentos y dead-letter queue.
- La publicación de la lista del día y de sus actualizaciones respeta el orden: las actualizaciones
  esperan detrás de la lista (ver `check-view-reservation`).

### Traducción de respuestas HTTP a cola (decisión C1)

Los specs describen "responde 200/400" para el Check-In y el Check-Out. Como el Módulo 1 los emite
por cola y no espera respuesta, el consumidor del Módulo 2 aplica estas reglas:

| Caso en el spec | Comportamiento del consumidor |
|---|---|
| Notificación válida | Procesa el cambio de la habitación y confirma el mensaje |
| Duplicado (mismo `eventId`, o habitación ya en `CHECKED_IN`/`CHECKED_OUT`) | Confirma sin efectos (el "200 idempotente") |
| Reserva inexistente, o en un estado que no admite el evento, o habitación ya `NOT_ARRIVED` | Registra un `ReconciliationIncident` y confirma el mensaje, sin reintentar (el "400 + incidencia") |
| Payload ilegible, sin `reservationRef` o `roomId`, o con caracteres maliciosos | Envía el mensaje a la dead-letter queue, sin procesar (el "400" de payload inválido) |
| Fallo temporal (base de datos caída, por ejemplo) | Reintenta con espera creciente y, agotados los reintentos, a la dead-letter queue |

Contenido del `payload` (según el diccionario y los specs):

| Routing key | `payload` |
|---|---|
| `habitacion.checkin` | `reservationRef`, `roomId` y `foreignGuests` (lista de huéspedes extranjeros, cada uno con los 10 campos: nombres, apellidos, tipo y número de documento, fecha de nacimiento, nacionalidad, `movementType`, `movementDate`, `originPlace`, `destinationPlace`) |
| `habitacion.checkout` | `reservationRef`, `roomId` y `foreignGuests` (misma forma, con `movementType` `DEPARTURE`) |

## Contratos REST

**El Módulo 2 expone** (rutas propuestas, se fijan en cada plan de feature):

| Recurso | Quién lo consume | Feature |
|---|---|---|
| `GET /api/reservations` con paginación de 10, filtros (búsqueda por `reservationRef`, documento o nombre; estado; canal; agencia; tipo de fecha `ARRIVAL`/`DEPARTURE`/`STAY` con `from` y `to`) y orden por `startDate` | Recepcionista, procesos internos | `check-view-reservation` |
| `GET /api/reservations/{reservationRef}` (detalle) | Recepcionista; Módulo 3 con credencial de servicio (devuelve `quoteId` por habitación, canal y datos de la OTA; 404 si no existe) | `check-view-reservation` |
| `POST /api/reservations/direct/preview` y `POST /api/reservations/direct` (canal directo) | Recepcionista | `generate-direct-reservation` |
| `POST /api/reservations/{reservationRef}/modification-preview` y `PATCH /api/reservations/{reservationRef}` | Recepcionista (solo directas); la OTA modifica las suyas por su canal | `update-reservation` |
| `POST /api/reservations/{reservationRef}/cancellation` | Recepcionista (solo directas); la OTA cancela las suyas por su canal | `cancel-reservation` |
| `POST /api/ota/reservations` y `POST /api/ota/reservations/{reservationRef}/confirmation` (pago o garantía) | Ota | `generate-ota-reservation` |
| `POST /api/sire/exports` (periodo o movimiento individual; devuelve `.TXT` y cabecera `Export-Id`; es `POST` porque registra un `SireExport`, decisión D9) | Recepcionista | `export-sire-file` |
| `GET /api/sire/exports/{exportId}/exclusions` | Recepcionista | `export-sire-file` |
| `GET /api/otas` y `GET /api/otas/{otaId}` (solo lectura; devuelve `id`, `name`, `commissionPercentage`, estado de conexión) | Recepcionista, Módulo 3 | `register-ota-information-commission` |
| `POST /api/ota-commissions/reconciliations` (conciliación de comisiones) | Módulo 3 (finanzas) | `register-ota-information-commission` |

Las agencias OTA se registran **automáticamente** al vincular la cuenta por API: el Módulo 2 no tiene
rutas de alta ni edición manual (`POST`/`PUT /api/otas` quedan fuera).

**El Módulo 2 consume** (a través de los puertos `Module1Port` y `Module3Port`):

| Servicio | Método | Feature |
|---|---|---|
| Inventario de habitaciones por `categoryRoom` (o `roomId`) | M1 GET | `consult-room-inventory` |
| Calendario de mantenimientos por categoría y rango | M1 GET | `consult-maintenance-calendar` |
| Establecer estado de habitación (`Reserved` o `Available`, con `requestId`, `sequenceNumber`, `originEvent`, `reservationRef`) y consulta del resultado por `requestId` | M1 POST/PUT | `set-room-state` |
| Tarifa dinámica: `POST /pricing/quotes` con `roomType`, `checkInDate`, `checkOutDate` (equivalen a `categoryRoom`, `startDate`, `endDate`); respuesta `quoteId`, `nightlyRates`, `lodgingAmount` | M3 POST | `calculate-dynamic-rate` |

**Errores**: cuerpo `{ "errorCode", "message", "timestamp", "path" }` con HTTP 400 (por defecto, también
para recursos inexistentes, como piden los specs), 409 (conflicto de disponibilidad) o 429 (exportación
SIRE). La única excepción es la consulta de una reserva por referencia para el Módulo 3, que
responde 404 si no existe, como lo espera ese módulo. El diccionario prohíbe 500 y cualquier 2xx o 3xx
para un error.

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
package.json                      # scripts del monorepo
pnpm-workspace.yaml               # backend y frontend
.nvmrc                            # Node 22 LTS
docker-compose.yml                # PostgreSQL y RabbitMQ para desarrollo

backend/
├── package.json
├── nest-cli.json
├── tsconfig.json                 # strict
├── Dockerfile
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── shared/                   # ApiError, filtro global de excepciones, EventEnvelope,
    │                             #   reloj del hotel (America/Bogota), correlación de logs, dinero (decimal.js)
    ├── config/                   # configuración por entorno (@nestjs/config), RabbitMQ, TypeORM
    ├── security/                 # JWT, guards y roles
    ├── migrations/               # migraciones SQL de TypeORM
    ├── reservation/              # un módulo por dominio, todos con la misma forma:
    │   ├── domain/               #   agregado Reservation (con sus ReservationRoom dentro), ReservationStatus, transiciones
    │   ├── application/
    │   │   ├── ports/in/         #   casos de uso (crear, consultar, modificar, cancelar, check-in...)
    │   │   ├── ports/out/        #   ReservationRepository, Module1Port, Module3Port, EventPublisher
    │   │   └── services/
    │   └── infrastructure/
    │       ├── in/               #   controladores REST, consumidores RabbitMQ, tareas programadas
    │       └── out/              #   repositorios TypeORM, clientes HTTP, publicadores
    ├── guest/                    # Guest, GuestRef
    ├── availability/             # verificar disponibilidad (M1 + reservas locales)
    ├── pricing/                  # RateQuote y cliente del Módulo 3
    ├── roomstate/                # RoomStateRequest, cola por Room, reintentos
    ├── cancellation/             # Cancellation
    ├── ota/                      # Ota (solo lectura), comisión OTA
    ├── migration/                # MigratoryMovement, SireExport, SireExportExclusion, datos devueltos
    ├── reconciliation/           # ReconciliationIncident
    ├── jobs/                     # lista del día (00:00), cierre del día (23:59), reintentos
    └── messaging/                # configuración de RabbitMQ, idempotencia (processed_event)
test/
    ├── unit/                     # dominio y casos de uso, sin base de datos ni cola
    ├── integration/              # Testcontainers (PostgreSQL, RabbitMQ)
    └── contract/                 # contratos REST y de mensajes

frontend/
├── package.json
├── vite.config.ts
└── src/
    ├── components/
    ├── pages/                    # pantallas de la Recepcionista (única vista del Módulo 2)
    ├── services/                 # clientes de la API del backend
    └── test/
```

**Structure Decision**: aplicación web `backend/` + `frontend/` en un monorepo pnpm. El backend se
organiza por dominio, y dentro de cada dominio por capas hexagonales, porque cada feature de las specs
toca un concepto concreto. El frontend cubre solo a la Recepcionista; la Ota solo usa la API y el
Módulo 1 tiene su propia interfaz.

## Diseño técnico base

### Modelo de datos base (PostgreSQL)

| Tabla | Entidad | Notas |
|---|---|---|
| `reservation` | `Reservation` | `reservation_ref` único; `guest_id`, `start_date`, `end_date`, `source`, `status`, `status_reason` (D6), `created_at`; `updated_at` (`@UpdateDateColumn`); `gross_amount` y `gross_amount_currency` (solo reservas OTA: el `totalAmount` que envía la agencia, base de la comisión; vacíos en las directas, que no tienen total); `commission_percentage`, `commission_amount`, `commission_status`; único `(ota_id, external_confirmation_code)` |
| `reservation_room` | `ReservationRoom` | Entre 1 y 10 por reserva; `room_id` (`Room.id` del Módulo 1), `category_room`, `room_gross_amount`, `quote_id` y `currency` (tarifa de la habitación recibida del Módulo 3 y el identificador de su cotización, D2; solo canal `DIRECT`), `stay_status` (`EXPECTED`, `CHECKED_IN`, `CHECKED_OUT`, `NOT_ARRIVED`) |
| `guest` | `Guest` | Es extranjero si su `nationality` no es Colombia; no se guarda un tipo |
| `ota` | `Ota` | `name`, `hotel_account_id`, `linked_at`, `commission_percentage`, `connection_status` (`CONNECTED`/`DISCONNECTED`), `last_sync_at`; se llena por la vinculación automática |
| `cancellation` | `Cancellation` | Inmutable; `channel` `RECEPTION` u `OTA_API` |
| `room_state_request` | `RoomStateRequest` | Único `(room_id, sequence_number)`; secuencia asignada de forma atómica por `Room` |
| `reconciliation_incident` | `ReconciliationIncident` | `origin`: `CHECK_IN`, `CHECK_OUT` o `ROOM_STATE` |
| `migratory_movement` | `MigratoryMovement` | Un `ENTRY` y un `DEPARTURE` por huésped y reserva; solo existen movimientos completos |
| `sire_export`, `sire_export_exclusion` | `SireExport`, `SireExportExclusion` | `exportKind` `PERIOD` o `SINGLE_MOVEMENT`; `exportId` = `SireExport.id` |
| `reservation_audit` | auditoría de actualizaciones | Inmutable |
| `room_sequence` | último `sequenceNumber` por habitación | Una fila por `room_id`; se bloquea (`FOR UPDATE`) al asignar la secuencia |
| `daily_list_message` | mensajes enviados al Módulo 1 | `messageId`, día operativo y `sequenceNumber`; evita reenviar la lista el mismo día |
| `commission_audit` | auditoría de comisiones OTA | Inmutable: reserva, agencia, acción, importes y actor |
| `processed_event` | idempotencia de colas | Clave `event_id` |

`Reservation.status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`) se
guarda como texto. `migrationStatus` es solo un dato de pantalla: se calcula, no se guarda. `Room`,
`ForeignGuestData`, `MaintenanceCalendar` y `RateQuote` son del Módulo 1 o 3: **no se persisten** en el
Módulo 2; solo viajan en objetos de integración.

### Reglas transversales que todos los planes de feature heredan

1. **Transiciones de `status` en un solo lugar.** La tabla de transiciones vive en el dominio
   (`PENDING`→`ACTIVE`, `ACTIVE`→`IN_PROGRESS`, `IN_PROGRESS`→`COMPLETED`, `ACTIVE`/`PENDING`→`CANCELLED`,
   `ACTIVE`/`PENDING`→`NO_SHOW`) y un único servicio de aplicación (`ReservationStatusService`) la
   aplica con bloqueo optimista. `update-reservation` lo usa para confirmación OTA, Check-In, Check-Out,
   No-Show y cancelación compensatoria; `cancel-reservation` lo invoca dentro de su propia transacción.
2. **Saga para reservas con llegada hoy.** Crear la reserva, ordenar `Reserved` al Módulo 1 y, si
   este rechaza o no responde, compensar cancelándola (`ROOM_REJECTED` o `ROOM_UNCONFIRMED`) y
   neutralizando con `Available` de mayor `sequenceNumber` si el resultado fue ambiguo. **La
   llamada al Módulo 1 no se hace dentro de una transacción de base de datos abierta.**
3. **Órdenes al Módulo 1 con secuencia.** Toda orden pasa por `roomstate/`: `sequenceNumber` atómico
   por `Room`, envío de una en una, estados `PENDING`/`COMPLETED`/`REJECTED`, consulta idempotente
   del resultado por `requestId` y `ReconciliationIncident` si queda `UNRESOLVED`.
4. **Tareas programadas** (zona horaria `America/Bogota`, idempotentes, con bloqueo asesor): envío de la
   lista del día y apartado de habitaciones a las 00:00; cierre del día al terminar las 23:59 (No-Show:
   `NO_SHOW` en OTA, `CANCELLED` en directa, sin `Cancellation`; las directas con `lateArrivalNotice`
   se aplazan al cierre del día siguiente; habitaciones no llegadas pasan a
   `NOT_ARRIVED`); y reintento de órdenes `PENDING`. El día operativo es fijo y no es configurable.
5. **Errores uniformes.** Un filtro global de excepciones traduce toda excepción a `ApiError` 4xx; un
   conflicto de `updatedAt` (ediciones o cancelaciones simultáneas) es siempre 400 `CONCURRENT_UPDATE`.
   Ningún error no controlado sale como 500; el filtro genérico registra el detalle en el log y responde
   un error controlado sin datos de infraestructura.
6. **Clientes de otros módulos** detrás de puertos (`Module1Port`, `Module3Port`) con timeout.
   Ante fallo, cada feature decide, pero nunca se asume disponibilidad ni tarifa por defecto o a cero.
7. **Mensajería.** `EventEnvelope` con `eventId`, `eventType`, `occurredAt`, `sourceModule`,
   `payload`. El consumidor registra el `eventId` en `processed_event` dentro de la misma
   transacción que el cambio. Reintentos con backoff y dead-letter queue.
8. **Nomenclatura del diccionario**: `Reservation.status`, `roomNumber`, `startDate`/`endDate`,
   `externalConfirmationCode`, `grossAmount`, `categoryRoom`, `reservationRef`; estados del Módulo 1
   en PascalCase (`Available`, `Reserved`, `Occupied`, ...).
9. **OTA solo lectura.** Las reservas de canal OTA solo las cambian o cancelan la propia OTA (canal
   `OTA_API`); la Recepcionista no puede. Cancelar una reserva OTA no toca la comisión.

### Decisiones de diseño tomadas al escribir los planes de feature

| # | Decisión | Origen |
|---|---|---|
| D1 | **La confirmación de una cotización no confía en el importe de la pantalla.** Al confirmar, el servidor vuelve a cotizar con el Módulo 3 y lo compara con las tarifas por habitación que vio el solicitante; si difiere, responde 400 "La tarifa cambió, vuelva a cotizar". Nunca se guarda un monto enviado por el cliente; de la `RateQuote` solo se guardan `lodgingAmount` y `quoteId` en la habitación. Lo aplican `generate-direct-reservation` y `update-reservation`. | `calculate-dynamic-rate` |
| D2 | **La tarifa se guarda por habitación, sin total:** `reservation_room` guarda `room_gross_amount` (el `lodgingAmount`), `quote_id` y `currency` tal como las entrega el Módulo 3 (FR-002); el `quote_id` permite al Módulo 3 cobrar en el Check-Out exactamente el valor cotizado. El Módulo 2 no suma ni calcula nada con ellas. | `calculate-dynamic-rate` |
| D3 | **Restricción de exclusión en PostgreSQL** sobre `reservation_room` y las fechas de su reserva (o sobre una tabla de ocupación equivalente): `EXCLUDE USING gist (room_id WITH =, daterange(start_date, end_date) WITH &&) WHERE (status IN ('PENDING','ACTIVE','IN_PROGRESS'))`, con la extensión `btree_gist` creada en la migración base. Impide dos reservas activas solapadas en la misma habitación aun con concurrencia; una violación se traduce en 409 `NO_AVAILABILITY` (o en probar la siguiente habitación candidata). El diseño exacto (copiar fechas y estado a la tabla de ocupación) se cierra en el plan de `check-room-availability`. | `check-room-availability` |
| D4 | **El spec `consult-room-inventory` se ajustó**: la consulta por categoría admite listado completo o filtrado por estado, porque las estadías futuras necesitan todas las habitaciones de la categoría. Pendiente acordar con el Módulo 1 que su API permita ambos modos. | `check-room-availability` |
| D5 | **Datos migratorios completos:** el Módulo 2 da por hecho que el Módulo 1 los envía completos y correctos; no los valida ni los devuelve. | `process-foreign-guest-data` |
| D6 | **Motivo de las transiciones:** columna `status_reason` en `reservation` (`ROOM_REJECTED`, `ROOM_UNCONFIRMED`). | `update-reservation` |
| D7 | **Periodo de la exportación SIRE:** se filtra por la `movementDate` del movimiento migratorio. | `process-foreign-guest-data`, `export-sire-file` |
| D8 | **API de modificación en dos pasos:** `POST .../modification-preview` (no persiste) y `PATCH` (confirma, con `updatedAt` y las tarifas esperadas por habitación). Propuesta de los planes; el spec no define su forma. | `update-reservation` |
| D9 | **La exportación SIRE es `POST`**, no `GET`, porque crea un registro `SireExport` (un `GET` no debe tener efectos). | `export-sire-file` |
| D10 | **Arquitectura hexagonal** con un módulo Nest por dominio y las capas `domain`, `application` e `infrastructure` (in/out). Verificada en CI. | Este plan |
| D11 | **Migraciones escritas en SQL**, no generadas desde las clases de TypeORM, para controlar `EXCLUDE`, índices parciales y bloqueos. | Este plan |

## Estrategia de testing base

- **Unitarios** (Jest): dominio y casos de uso sin base de datos ni cola; reglas de negocio, tabla de
  transiciones, cálculo de comisión (`decimal.js`), reglas del día operativo.
- **Integración** (Jest + Testcontainers): PostgreSQL y RabbitMQ reales; concurrencia optimista,
  unicidad de `(room_id, sequence_number)`, restricción anti-solape, idempotencia de consumidores,
  dead-letter.
- **Contrato**: adaptadores de `Module1Port` y `Module3Port` contra respuestas simuladas (por ejemplo
  `nock` o `msw`): éxito, rechazo, timeout y respuesta ambigua; y forma de los mensajes de cola.
- **API** (supertest): controladores con los casos de uso reales y el filtro global de errores.
- **Arquitectura**: la verificación de dependencias entre capas corre como parte de las pruebas.
- **Cada escenario Gherkin** de un `spec.md` debe tener al menos una prueba de integración en el plan
  de su feature.
- **Frontend**: Vitest + Testing Library en pantallas críticas (listado con filtros, paginación,
  modificar, cancelar, exportación SIRE).

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Crear el monorepo pnpm: `pnpm-workspace.yaml`, `package.json` raíz, `.nvmrc` (Node 22 LTS) y las carpetas `backend/` y `frontend/`
- [ ] T002 Generar `backend/` con Nest CLI (TypeScript `strict`, versión fija) e instalar las dependencias de Technical Context
- [ ] T003 Inicializar `frontend/` con React + Vite + TypeScript
- [ ] T004 [P] Configurar ESLint, Prettier y `eslint-plugin-boundaries` (capas hexagonales) en backend y frontend
- [ ] T005 [P] Crear `docker-compose.yml` con PostgreSQL y RabbitMQ para desarrollo
- [ ] T006 Configurar `@nestjs/config` por entorno (dev, test) con variables de entorno validadas

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRÍTICO**: Ninguna feature puede empezar hasta terminar esta fase.

- [ ] T007 Definir el esquema base (tablas de Diseño técnico base), la extensión `btree_gist` y la restricción de exclusión (D3) con migraciones SQL de TypeORM
- [ ] T008 [P] Crear el dominio y la persistencia de `Reservation`, `ReservationRoom`, `Guest` y `Ota` (entidades de dominio, clases de tabla TypeORM, mapeadores y repositorios)
- [ ] T009 [P] Crear `ApiError`, los errores de negocio y el filtro global de excepciones en `shared/`
- [ ] T010 [P] Crear el reloj del hotel (`America/Bogota`, día operativo 00:00–23:59) y el módulo de dinero con `decimal.js`
- [ ] T011 Implementar `ReservationStatusService` con la tabla de transiciones en el dominio y bloqueo optimista (depende de T008, T009)
- [ ] T012 [P] Implementar los puertos `Module1Port` y `Module3Port` con sus adaptadores HTTP (timeouts) y objetos de integración
- [ ] T013 Configurar RabbitMQ con `@golevelup/nestjs-rabbitmq`: exchange `hospitua.events`, colas, routing keys, reintentos y dead-letter
- [ ] T014 Crear `EventEnvelope`, `processed_event` y la idempotencia en `messaging/`
- [ ] T015 [P] Crear `ReconciliationIncident` y su servicio de registro
- [ ] T016 Configurar la infraestructura de pruebas (Jest, supertest y Testcontainers de PostgreSQL y RabbitMQ)
- [ ] T017 [P] Esqueleto del frontend: enrutamiento, cliente HTTP, TanStack Query y manejo de errores de API
- [ ] T018 Configurar autenticación y autorización (Passport + JWT, guards) con los roles `RECEPTIONIST`, `OTA`, `FINANCE`, `MODULE1` y `MODULE3` (los dos últimos, de servicio a servicio)
- [ ] T019 Configurar logs (`nestjs-pino`) y correlación de solicitudes
- [ ] T020 Configurar el bloqueo asesor de PostgreSQL y el planificador (`@nestjs/schedule`, `America/Bogota`) para las tareas programadas
- [ ] T021 Configurar OpenAPI (`@nestjs/swagger`) y la verificación de dependencias entre capas en CI

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
- Dentro de cada feature: dominio, casos de uso, adaptadores, endpoints y pruebas de integración por escenario.

## Contradicciones detectadas y decisiones tomadas

Las contradicciones entre la especificación técnica, los specs, el diccionario y los diagramas
quedaron decididas. La tabla registra cada decisión y lo que falta ajustar en otros documentos.

| # | Contradicción | Decisión |
|---|---|---|
| C1 | Los specs dicen que el Módulo 1 "envía a la API del Módulo 2" el Check-In y el Check-Out y que este "responde HTTP 200/400". La especificación técnica y el diagrama de integración los definen como **cola**, donde no hay respuesta HTTP al Módulo 1. | **DECIDIDO: solo cola.** Reglas en "Traducción de respuestas HTTP a cola". |
| C2 | El diagrama de integración muestra "Datos de huéspedes extranjeros" como **cola separada**; los specs los reciben **dentro** de la notificación de Check-In y de Check-Out. | **DECIDIDO: dentro de `habitacion.checkin` y `habitacion.checkout`** (lista `foreignGuests`), sin routing key nueva. |
| C3 | (a) "Consultar estado de canales OTA" (M3 → M2) no existe en los specs; el diagrama tiene "Consultar % de comisión OTA" (M3 → M2, REST GET). (b) "Error de huésped no encontrado" (M1 → M2) no aparece en ningún spec. | **DECIDIDO (a): se adopta como "Consultar % de comisión OTA"**, REST GET; el Módulo 2 expone `GET /api/otas/{otaId}`. **DECIDIDO (b): fuera del plan** hasta que el Módulo 1 confirme su función y exista un spec. |
| C4 | "Consultar calendario de mantenimientos" no está en la especificación técnica ni en el diagrama de integración, pero sí en los specs y el diccionario. | **DECIDIDO: REST GET reactiva (M2 → M1)**, igual que el inventario. |
| C5 | El diagrama de casos de uso muestra que "Generar reservación por OTA" incluye "Calcular tarifa dinámica"; el spec y el diccionario dicen que **no** se recalcula: usa el valor bruto que envía la OTA. | **DECIDIDO: según el spec y el diccionario.** El Módulo 2 no llama al Módulo 3 en la reserva OTA, para que la comisión cuadre con lo que cobró la agencia. |
| C6 | El diccionario nombra `grossAmount` en `Reservation`; algunos specs usaban `totalAmount`. | **DECIDIDO: un solo nombre interno, `grossAmount`** (columna `gross_amount`, solo en reservas OTA: las directas guardan la tarifa por habitación, D2). `totalAmount` queda solo como nombre del campo en el JSON que envía la OTA. |
| C7 | Fórmula de comisión sin `/100`, con validación 0–100%. | **DECIDIDO: porcentaje de 0 a 100 y se divide entre 100.** `commissionAmount = grossAmount × commissionPercentage / 100`, con `decimal.js`, 2 decimales y redondeo `ROUND_HALF_UP`; el valor queda positivo en el Módulo 2 (el signo lo aplica el Módulo 3). Pendiente confirmar con el Módulo 3 cómo expresa el porcentaje. |
| C8 | El estado `Reserved` del Módulo 1 es una solicitud pendiente de aprobación por su equipo, pero todo el flujo del día de llegada depende de él. | **DECIDIDO: se implementa según los specs, sin interruptor.** Hasta que el Módulo 1 lo agregue, esas reservas fallarán y se cancelarán por compensación. |
| C9 | Para reservas con llegada hoy, el spec exige "todo o nada" con la respuesta del Módulo 1 y, a la vez, que la compensación cancele la reserva recién creada. | **DECIDIDO: guardar primero, ordenar después y compensar si falla** (regla transversal 2). |
| C10 | Las tareas programadas no tienen mecanismo definido y con varias instancias podrían ejecutarse dos veces. | **DECIDIDO: `@nestjs/schedule` con bloqueo asesor de PostgreSQL** (`pg_try_advisory_lock`, consulta nativa). Si otra instancia tiene el bloqueo, se salta esa ejecución. El día operativo es fijo (00:00–23:59, Colombia). La idempotencia que piden los specs sigue siendo la garantía principal. |
| C11 | El plan estaba escrito para Java y Spring Boot. | **DECIDIDO: NestJS, TypeScript, TypeORM, `@golevelup/nestjs-rabbitmq`, pnpm y arquitectura hexagonal.** Se eliminó el proyecto Spring/Gradle del repositorio. |

### Cambios pendientes en otros documentos

Estos ajustes **no** están hechos; los specs y los diagramas son del equipo y se acuerdan aparte.

| Documento | Cambio | Decisión |
|---|---|---|
| Los 13 `plan.md` de las features | Quitar las referencias a Java, Spring, JPA, Flyway, JUnit y Maven; usar la arquitectura hexagonal y el stack de este plan | C11, D10 |
| `mod-1-2-3.drawio` | Reflejar la lista del día por cola (M2 → M1), los datos dentro de `habitacion.checkin`/`checkout` y la consulta del calendario (M2 → M1) | C2, C4 |
| `DIAGRAMA.drawio` (casos de uso) | Quitar la línea "Generar reservación por OTA" → "Calcular tarifa dinámica" | C5 |
| Equipo del Módulo 1 | Agregar el estado `Reserved`; acordar los nombres de las colas que envía el Módulo 2; ver [acuerdos-con-modulo-1.md](./acuerdos-con-modulo-1.md) | C8, C2 |
| Equipo del Módulo 3 | Confirmar cómo expresa el porcentaje de comisión (0 a 100) | C7 |

## Notes

- `[P]` marca tareas paralelizables; `[US1]` (en los planes de feature) las liga a su historia de usuario.
- Cada plan de feature debe indicar en su encabezado: `Plan base: ../base/plan.md`.
- No se programa una feature hasta que su SPEC esté validado y su PLAN revisado (`sdd-guide.MD`).
- Commit por tarea o grupo lógico, con Gitflow.
