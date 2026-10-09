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
envía por cola la lista de reservas del día y sus actualizaciones. **No le ordena apartar ni liberar
habitaciones**: el Módulo 1, dueño del estado de las habitaciones, decide qué hace con esa lista.

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

El backend tiene **un solo dominio general** (`src/domain/`), compartido por todas las features. No hay
un dominio por módulo: las entidades del Módulo 2 (`Reservation`, `Guest`, `Ota`, `MigratoryMovement`...)
están relacionadas entre sí y sus reglas se cruzan (una cancelación cambia el estado de la reserva y
genera avisos al Módulo 1; un Check-In cambia la reserva y registra movimientos migratorios), así
que viven juntas. Las dependencias siempre apuntan hacia adentro:
`infrastructure` → `application` → `domain`.

| Capa | Contiene | Puede importar |
|---|---|---|
| `domain/` | **Todas** las entidades y objetos de valor del Módulo 2, sus relaciones, los enumerados, las reglas de negocio (invariantes y tabla de transiciones de `status`) y los errores de negocio. Ver "Modelo de dominio" | Solo TypeScript puro (y `decimal.js` para dinero). **Nada de Nest, TypeORM ni RabbitMQ** |
| `application/` | Un caso de uso por feature de las specs (puertos de entrada y servicios) y los puertos de salida (repositorios, Módulo 1, Módulo 3, publicador de eventos, reloj) | `domain/` |
| `infrastructure/in/` | Adaptadores de entrada: controladores REST, consumidores RabbitMQ, tareas programadas | `application/` (puertos de entrada) |
| `infrastructure/out/` | Adaptadores de salida: repositorios TypeORM, clientes HTTP del Módulo 1 y 3, publicadores RabbitMQ, reloj | `application/` (implementan los puertos de salida) |

Reglas:

1. Los controladores, consumidores y tareas programadas **solo llaman a un caso de uso**; no tienen
   reglas de negocio.
2. Las entidades del dominio no son las de TypeORM. El adaptador de persistencia tiene sus propias clases
   de tabla y las convierte con un mapeador.
3. Los módulos 1 y 3 se ven solo como puertos (`Module1Port`, `Module3Port`). Si cambia su API, solo se
   cambia el adaptador. Sus datos (`Room`, `MaintenanceCalendar`, `RateQuote`, `ForeignGuestData`) son
   objetos de integración en `application/`, no entidades del dominio.
4. La inyección de dependencias de Nest une los puertos con sus adaptadores (símbolos como
   `RESERVATION_REPOSITORY`); el dominio nunca usa `@Injectable`.
5. Las dependencias entre capas se verifican en CI con `eslint-plugin-boundaries` (o
   `dependency-cruiser`): `domain/` no importa nada de `application/` ni de `infrastructure/`.
6. Los casos de uso no se llaman entre sí por sus clases internas: si uno necesita a otro (por ejemplo,
   cancelar y modificar usan "Consultar y buscar reservas"), lo usa por su puerto de entrada.

## Modelo de dominio

Todas las entidades viven en `src/domain/`. Los tipos son los del dominio (TypeScript); las tablas
están en "Modelo de datos base".

### Entidades y atributos

**Reservation** (raíz del agregado de la reserva)

| Atributo | Tipo | Regla |
|---|---|---|
| `reservationRef` | texto, único | Identificador con el que los demás módulos la referencian |
| `guestRef` | referencia a `Guest` | Titular, obligatorio |
| `guestCount` | entero | Total de personas: suma de los `guestCount` de sus habitaciones |
| `rooms` | lista de `ReservationRoom` | Entre 1 y 10, sin repetir `roomId` |
| `startDate`, `endDate` | fecha sin hora | `endDate` > `startDate`; comunes a todas las habitaciones |
| `source` | `ReservationSource` | `DIRECT` u `OTA` |
| `otaId` | referencia a `Ota` | Solo si `source` es `OTA` |
| `externalConfirmationCode` | texto | Solo `OTA`; único por agencia |
| `grossAmount`, `currency` | dinero | Solo `OTA`: valor bruto que envía la agencia (`totalAmount` en su JSON); base de la comisión |
| `commissionPercentage`, `commissionAmount` | decimal | `0` en `DIRECT`; en `OTA`, `grossAmount × commissionPercentage / 100` |
| `commissionStatus` | `CommissionStatus` | Solo `OTA` |
| `notes` | texto | Opcional, máximo 500 caracteres |
| `status` | `ReservationStatus` | Solo cambia por la tabla de transiciones |
| `statusReason` | texto | Motivo de la última transición (D6) |
| `createdAt`, `updatedAt` | fecha y hora | `updatedAt` es el control de concurrencia optimista |

**ReservationRoom** (parte del agregado `Reservation`; no existe sin su reserva)

| Atributo | Tipo | Regla |
|---|---|---|
| `roomId` | id externo | `Room.id` del Módulo 1 |
| `roomNumber` | texto | Copia del número del Módulo 1, guardada al asignarla |
| `guestCount` | entero | Personas de esa habitación: ≥ 1 y ≤ `maxCapacity` |
| `checkInForeignGuestCount`, `checkOutForeignGuestCount` | entero | Extranjeros que el Módulo 1 informó en el Check-In y en el Check-Out; solo informativos, se muestran a la Recepcionista |
| `categoryRoom` | texto | Categoría de la habitación |
| `roomGrossAmount`, `currency` | dinero | Solo `DIRECT`: el `lodgingAmount` y la moneda de la cotización del Módulo 3, sin cálculos |
| `quoteId` | texto | Solo `DIRECT`: identificador de la cotización; el Módulo 3 lo usa para cobrar en el Check-Out |
| `stayStatus` | `StayStatus` | Estado de esa habitación dentro de la reserva |

**Guest** (titular de reservas)

| Atributo | Tipo | Regla |
|---|---|---|
| `id` (`guestRef`) | id | |
| `firstName`, `lastName` | texto | Obligatorios; el nombre completo (`fullName`) se arma uniéndolos |
| `documentType` | `DocumentType` | Obligatorio |
| `documentNumber` | texto | Obligatorio; identifica al huésped existente |
| `nationality` | texto | Si no es Colombia, el huésped es extranjero (se deduce, no se guarda) |
| `contactPhone`, `contactEmail` | texto | Opcionales |

**Ota** (agencia; se registra sola por su API)

| Atributo | Tipo | Regla |
|---|---|---|
| `id`, `name`, `hotelAccountId` | texto | Enviados por la OTA |
| `commissionPercentage` | decimal de 0 a 100 | Porcentaje pactado por defecto |
| `connectionStatus` | `CONNECTED` o `DISCONNECTED` | |
| `linkedAt`, `lastSyncAt` | fecha y hora | |

**Cancellation** (registro inmutable de la anulación): `cancellationId`, `reservationRef`,
`cancellationDate`, `reason` (opcional), `channel` (`RECEPTION` | `OTA_API`), `processedBy`, `status`
(`COMPLETED`).

**GuestData** (datos de cada huésped, colombiano o extranjero, guardados una sola vez por reserva):
`reservationRef`, `firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`,
`nationality`, `originPlace`, `destinationPlace`. Identidad única: (`reservationRef`, `documentNumber`).
Se crea en el Check-In y no se modifica; el Check-Out solo agrega el `DEPARTURE`.

**MigratoryMovement** (entrada o salida de un huésped): `movementId`, `reservationRef`,
`documentNumber` (referencia a su `GuestData`), `guestRef` (solo si es el titular), `movementType`
(`ENTRY` | `DEPARTURE`), `movementDate`. Sin datos personales copiados. Identidad única:
(`reservationRef`, `documentNumber`, `movementType`).

**SireExport** (histórico de descargas del archivo SIRE): `id`, `exportDate`, `exportKind` (`PERIOD` |
`SINGLE_MOVEMENT`), `recordsCount`, `dateRangeStart`, `dateRangeEnd`, `processedBy`. No marca los
movimientos.

**DailyReservationList** y **DailyReservationUpdate** (mensajes al Módulo 1): ver
`check-view-reservation`. Se guardan en `daily_list_message` para no reenviar la lista y respetar el
`sequenceNumber`.

### Enumerados (objetos de valor)

| Enumerado | Valores |
|---|---|
| `ReservationStatus` | `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| `StayStatus` | `EXPECTED`, `CHECKED_IN`, `CHECKED_OUT`, `NOT_ARRIVED` |
| `ReservationSource` | `DIRECT`, `OTA` |
| `CommissionStatus` | `CALCULATED`, `RECONCILED`, `PAID`, `DISPUTED` |
| `DocumentType` | `RC`, `TI`, `CC`, `CE`, `PAS`, `NIT` |
| `MovementType` | `ENTRY`, `DEPARTURE` |
| `MigrationStatus` (derivado, no se guarda) | `AWAITING_CHECK_IN`, `COMPLETE`, `NOT_REQUIRED`, `NO_CHECK_IN` |

### Relaciones

| Relación | Cardinalidad | Notas |
|---|---|---|
| `Guest` → `Reservation` | 1 a N | Un huésped puede ser titular de varias reservas; cada reserva tiene un solo titular |
| `Reservation` → `ReservationRoom` | 1 a 1..10 | Composición: las habitaciones se crean, cambian y borran solo a través de su reserva |
| `Ota` → `Reservation` | 1 a N | Solo reservas `OTA`; `(otaId, externalConfirmationCode)` es único |
| `Reservation` → `Cancellation` | 1 a 0..1 | Solo cancelaciones explícitas (Recepcionista u OTA); el No-Show no crea `Cancellation` |
| `Reservation` → `GuestData` | 1 a N | Un `GuestData` por huésped de la reserva, único por `documentNumber` |
| `GuestData` → `MigratoryMovement` | 1 a 1..2 | Máximo un `ENTRY` y un `DEPARTURE` por huésped |
| `Reservation` → `MigratoryMovement` | 1 a N | Los movimientos de todos sus huéspedes |
| `Guest` → `MigratoryMovement` | 1 a 0..N | Solo cuando el titular es extranjero; los acompañantes no son `Guest` |
| `SireExport` y `MigratoryMovement` | sin relación guardada | La exportación solo filtra por `movementDate` |
| `ReservationRoom` → `Room` (Módulo 1) | N a 1, externa | Por `roomId`; el estado físico es del Módulo 1 |

```mermaid
erDiagram
    GUEST ||--o{ RESERVATION : "es titular de"
    OTA |o--o{ RESERVATION : "origina"
    RESERVATION ||--|{ RESERVATION_ROOM : "tiene (1..10)"
    RESERVATION ||--o| CANCELLATION : "se anula con"
    RESERVATION ||--o{ MIGRATORY_MOVEMENT : "tiene"
    GUEST |o--o{ MIGRATORY_MOVEMENT : "titular extranjero"
    RESERVATION_ROOM }o--|| ROOM_M1 : "referencia (externa)"
```

### Agregados e invariantes

- **Agregado `Reservation`** (raíz `Reservation`, con sus `ReservationRoom`). Todo cambio pasa por la
  raíz y se guarda en una sola transacción. Invariantes:
  - Entre 1 y 10 habitaciones, sin repetir `roomId`; el `guestCount` de cada habitación es ≥ 1 y ≤ su
    `maxCapacity`, y el de la reserva es la suma.
  - `status` y `stayStatus` solo cambian por la tabla de transiciones:
    - Primera habitación en `CHECKED_IN` → la reserva pasa a `IN_PROGRESS`.
    - Ninguna habitación en `EXPECTED` ni en `CHECKED_IN`, y al menos una `CHECKED_OUT` → `COMPLETED`.
    - Cierre del día sin ningún Check-In → `NO_SHOW` (sea OTA o directa); sus habitaciones pasan a
      `NOT_ARRIVED`.
  - Solo se modifican o cancelan reservas en `ACTIVE` o `PENDING`; las `OTA` solo por su API.
  - Las reservas `DIRECT` no guardan un total (se calcula al mostrarlo) y no tienen comisión; las `OTA` no tienen tarifa ni cotización por habitación.
- **`Guest`** y **`Ota`**: agregados propios; la reserva los referencia por id.
- **`Cancellation`**, **`MigratoryMovement`**, **`SireExport`**: registros propios que referencian a la reserva por `reservationRef`. Son inmutables una
  vez creados.

### Datos externos (no son entidades del dominio)

`Room` y `MaintenanceCalendar` (Módulo 1), `RateQuote` (Módulo 3) y `ForeignGuestData` (lo envía el Módulo 1 en el Check-In y el Check-Out) son objetos de integración de los puertos. No se persisten:
de `ForeignGuestData` se copian los datos al `MigratoryMovement`, y de `RateQuote` el `lodgingAmount`, el `quoteId` y la moneda a
`ReservationRoom`.

## Comunicación entre módulos

Regla: **proactiva** (el módulo avisa un evento y no espera respuesta) → **cola RabbitMQ**;
**reactiva** (necesita un dato o confirmación inmediata) → **REST**.

| Interacción | Dirección | Mecanismo | Tipo | Feature |
|---|---|---|---|---|
| Check-In por habitación | M1 → M2 | Cola `m2.habitacion.checkin.queue` | Proactiva | `update-reservation` |
| Check-Out por habitación | M1 → M2 | Cola `m2.habitacion.checkout.queue` | Proactiva | `update-reservation` |
| Huéspedes extranjeros (un mensaje por huésped) | M1 → M2 | Cola `m2.huespedes.extranjeros.queue` | Proactiva | `process-guest-data` |
| Lista de reservas del día y sus actualizaciones | M2 → M1 | Cola `m1.reservas.diarias.queue` | Proactiva | `check-view-reservation` |
| Consultar inventario de habitaciones | M2 → M1 | REST GET | Reactiva | `consult-room-inventory` |
| Consultar calendario de mantenimientos | M2 → M1 | REST GET | Reactiva | `consult-maintenance-calendar` |
| Consultar % de comisión OTA | M3 → M2 | REST GET | Reactiva | `register-ota-information-commission` |
| Consultar tarifa dinámica (`POST /pricing/quotes`: `roomType`, `checkInDate`, `checkOutDate`; responde `quoteId`, `currency`, `nightlyRates`, `lodgingAmount`) | M2 → M3 | REST POST (cuerpo JSON) | Reactiva | `calculate-dynamic-rate` |
| Consultar las reservas de un rango de fechas (y habitación) para validar un mantenimiento o dar de baja una habitación | M1 → M2 | REST GET | Reactiva | `check-view-reservation` (FR-023) |
| Consultar una reserva por su referencia (`quoteIds`, canal y datos de la OTA) para liquidar en el Check-Out | M3 → M2 | REST GET | Reactiva | `check-view-reservation` (FR-022) |

El Módulo 1 **ya no consulta la lista de reservas** al Módulo 2 por REST: la recibe por cola. Solo
consulta las reservas entre una fecha de inicio y una de fin al registrar un mantenimiento o dar de baja una habitación (`check-view-reservation`,
FR-023); la lógica sobre esas reservas la aplica el Módulo 1. Las
interacciones M1 ↔ M3 (liquidación, tarifa base, registrar check-out) no involucran al Módulo 2.

### Convenciones de colas

- Exchange compartido: `hospitua.events` (tipo topic). Convención de nombres de cola:
  `m<módulo destino>.<recurso>.<evento>.queue`.
- Colas que **recibe** el Módulo 2 (las publica el Módulo 1):

| Cola | Routing key | Mensaje |
|---|---|---|
| `m2.habitacion.checkin.queue` | `habitacion.checkin` | Una por habitación que ingresa |
| `m2.habitacion.checkout.queue` | `habitacion.checkout` | Una por habitación que sale |
| `m2.huespedes.extranjeros.queue` | `huesped.extranjero` | Una por huésped extranjero y movimiento |

- Cola que **envía** el Módulo 2 (la consume el Módulo 1): `m1.reservas.diarias.queue`, con dos routing
  keys que se publican por el mismo canal y proceso, para conservar el orden:

| Routing key | Mensaje | `sequenceNumber` |
|---|---|---|
| `reserva.lista-del-dia` | `DailyReservationList`, una vez al día a las 00:00 | Siempre `1` |
| `reserva.lista-del-dia.actualizacion` | `DailyReservationUpdate` (`ADDED`, `UPDATED`, `REMOVED`) | Creciente dentro del día operativo |

- Mensaje JSON con: `eventId`, `eventType`, `occurredAt`, `sourceModule`, `payload`. Todo mensaje, en
  los dos sentidos, lleva además `messageId` único y `sequenceNumber` creciente; quien recibe descarta
  los `messageId` repetidos y aplica en orden. El `sequenceNumber` es global por cola y por día operativo.
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
| Reserva inexistente, o en un estado que no admite el evento, o habitación ya `NOT_ARRIVED` | Lo deja en el log (sin datos personales) y confirma el mensaje, sin reintentar (el "400") |
| Payload ilegible, sin `reservationRef` o `roomId`, o con caracteres maliciosos | Envía el mensaje a la dead-letter queue, sin procesar (el "400" de payload inválido) |
| Fallo temporal (base de datos caída, por ejemplo) | Reintenta con espera creciente y, agotados los reintentos, a la dead-letter queue |

Contenido del `payload` (según el diccionario y los specs):

| Routing key | `payload` |
|---|---|
| `habitacion.checkin` | `reservationRef`, `roomId` y `foreignGuestCount` (cuántos extranjeros ingresan a esa habitación; solo informativo) |
| `habitacion.checkout` | `reservationRef`, `roomId` y `foreignGuestCount` (cuántos extranjeros salen de esa habitación; solo informativo) |
| `huesped.extranjero` | `reservationRef`, `roomId` y los 10 campos del huésped: `firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`, `nationality`, `movementType` (`ENTRY` o `DEPARTURE`), `movementDate`, `originPlace`, `destinationPlace` |

Los extranjeros viajan en su propia cola para que el Check-In y el Check-Out nunca esperen por datos
migratorios; el mensaje de un huésped puede llegar antes o después de la notificación de su habitación
y se asocia por `reservationRef`. La lista del día y sus actualizaciones llevan el detalle de
`check-view-reservation` (FR-014): `source` viaja como `DIRECTA` o con el nombre de la agencia (por
ejemplo `BOOKING`).

## Contratos REST

**El Módulo 2 expone** (rutas propuestas, se fijan en cada plan de feature):

| Recurso | Quién lo consume | Feature |
|---|---|---|
| `GET /api/reservations` con paginación de 10, filtros (búsqueda por `reservationRef`, documento o nombre; estado; canal; agencia; tipo de fecha `ARRIVAL`/`DEPARTURE`/`STAY` con `from` y `to`) y orden por `startDate` | Recepcionista, procesos internos | `check-view-reservation` |
| `GET /api/reservations/{reservationRef}` (detalle) | Recepcionista; Módulo 3 con credencial de servicio (devuelve `quoteIds`, canal y, solo si es OTA, `otaId`, `otaConfirmationCode` y `otaCommissionPercentage`; 404 si no existe) | `check-view-reservation` |
| `POST /api/reservations/direct/preview` y `POST /api/reservations/direct` (canal directo) | Recepcionista | `generate-direct-reservation` |
| `POST /api/reservations/{reservationRef}/modification-preview` y `PATCH /api/reservations/{reservationRef}` | Recepcionista (solo directas); la OTA modifica las suyas por su canal | `update-reservation` |
| `POST /api/reservations/{reservationRef}/cancellation` | Recepcionista (solo directas); la OTA cancela las suyas por su canal | `cancel-reservation` |
| `POST /api/ota/reservations` y `POST /api/ota/reservations/{reservationRef}/confirmation` (pago o garantía) | Ota | `generate-ota-reservation` |
| `GET /api/guest-stays` (vista de huéspedes alojados: paginación de 10, filtros de nacionalidad, situación y periodo, búsqueda por documento o nombre) y `GET /api/reservations/{reservationRef}/guests/{documentNumber}` (detalle de un huésped) | Recepcionista | `process-guest-data` |
| `POST /api/sire/exports` (periodo o movimiento individual; devuelve `.TXT` y cabecera `Export-Id`; es `POST` porque registra un `SireExport`, decisión D9) | Recepcionista | `export-sire-file` |
| `GET /api/otas` y `GET /api/otas/{otaId}` (solo lectura; devuelve `id`, `name`, `commissionPercentage`, estado de conexión) | Recepcionista, Módulo 3 | `register-ota-information-commission` |
| `POST /api/ota-commissions/reconciliations` (conciliación de comisiones) | Módulo 3 (finanzas) | `register-ota-information-commission` |

Las agencias OTA se registran **automáticamente** al vincular la cuenta por API: el Módulo 2 no tiene
rutas de alta ni edición manual (`POST`/`PUT /api/otas` quedan fuera).

**El Módulo 2 consume** (a través de los puertos `Module1Port` y `Module3Port`):

| Servicio | Método | Feature |
|---|---|---|
| Inventario de habitaciones por `categoryRoom` (o `roomId`) | M1 GET | `consult-room-inventory` |
| Calendario de mantenimientos por categoría y rango | M1 GET | `consult-maintenance-calendar` |
| Tarifa dinámica: `POST /pricing/quotes` con `roomType`, `checkInDate`, `checkOutDate` (equivalen a `categoryRoom`, `startDate`, `endDate`); respuesta `quoteId`, `currency`, `nightlyRates`, `lodgingAmount` | M3 POST | `calculate-dynamic-rate` |

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
    ├── domain/                   # DOMINIO GENERAL, único para todo el Módulo 2 (TypeScript puro)
    │   ├── reservation/          #   Reservation (raíz), ReservationRoom, transiciones de status y stayStatus
    │   ├── guest/                #   Guest
    │   ├── ota/                  #   Ota, regla de comisión
    │   ├── cancellation/         #   Cancellation
    │   ├── migration/            #   MigratoryMovement, SireExport, MigrationStatus (derivado)
    │   ├── shared/               #   enumerados, Money (decimal.js), día operativo, errores de negocio
    │   └── index.ts              #   API pública del dominio
    ├── application/
    │   ├── ports/out/            # ReservationRepository, GuestRepository, ..., Module1Port, Module3Port,
    │   │                         #   EventPublisher, Clock
    │   ├── integration/          # objetos de integración: Room, MaintenanceCalendar, RateQuote, ForeignGuestData
    │   └── use-cases/            # un caso de uso por feature de las specs (puerto de entrada + servicio):
    │       ├── generate-direct-reservation/
    │       ├── generate-ota-reservation/
    │       ├── check-view-reservation/       # incluye la lista del día al Módulo 1
    │       ├── update-reservation/           # incluye Check-In, Check-Out y cierre del día
    │       ├── cancel-reservation/
    │       ├── check-room-availability/
    │       ├── consult-room-inventory/
    │       ├── consult-maintenance-calendar/
    │       ├── calculate-dynamic-rate/
    │       ├── register-ota-information-commission/
    │       ├── process-guest-data/
    │       └── export-sire-file/
    ├── infrastructure/
    │   ├── in/
    │   │   ├── rest/             # controladores REST
    │   │   ├── messaging/        # consumidores RabbitMQ (Check-In y Check-Out)
    │   │   └── jobs/             # lista del día (00:00), cierre del día (23:59), reintentos
    │   ├── out/
    │   │   ├── persistence/      # clases de tabla TypeORM, mapeadores y repositorios
    │   │   ├── module1/          # cliente HTTP del Módulo 1
    │   │   ├── module3/          # cliente HTTP del Módulo 3
    │   │   ├── messaging/        # publicadores RabbitMQ, idempotencia (processed_event)
    │   │   └── clock/            # reloj del hotel (America/Bogota)
    │   ├── config/               # configuración por entorno (@nestjs/config), RabbitMQ, TypeORM
    │   ├── security/             # JWT, guards y roles
    │   └── shared/               # ApiError, filtro global de excepciones, EventEnvelope, correlación de logs
    └── migrations/               # migraciones SQL de TypeORM
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
organiza **por capas hexagonales**, con un solo `domain/` general para todo el Módulo 2: las entidades
están relacionadas y sus reglas se cruzan entre features, así que separarlas por módulo duplicaría
reglas. Las features de las specs se reflejan en `application/use-cases/`. El frontend cubre solo a la
Recepcionista; la Ota solo usa la API y el Módulo 1 tiene su propia interfaz.

## Diseño técnico base

### Modelo de datos base (PostgreSQL)

| Tabla | Entidad | Clave y relaciones | Notas |
|---|---|---|---|
| `guest` | `Guest` | PK `id`; único `(document_type, document_number)` | `first_name`, `last_name`, `nationality`, `contact_phone`, `contact_email`. Es extranjero si su `nationality` no es Colombia; no se guarda un tipo |
| `ota` | `Ota` | PK `id`; único `hotel_account_id` | `name`, `linked_at`, `commission_percentage`, `connection_status` (`CONNECTED`/`DISCONNECTED`), `last_sync_at`; se llena por la vinculación automática |
| `reservation` | `Reservation` | PK `id`; único `reservation_ref`; FK `guest_id` → `guest`; FK `ota_id` → `ota` (nulo en directas); único `(ota_id, external_confirmation_code)` | `start_date`, `end_date`, `guest_count` (total), `source`, `status`, `status_reason` (D6), `notes`, `created_at`, `updated_at` (`@UpdateDateColumn`); `gross_amount` y `currency` (solo OTA); `commission_percentage`, `commission_amount`, `commission_status` |
| `reservation_room` | `ReservationRoom` | PK `id`; FK `reservation_id` → `reservation` (borrado en cascada); único `(reservation_id, room_id)` | Entre 1 y 10 por reserva; `room_id` (`Room.id` del Módulo 1, sin FK), `room_number`, `category_room`, `guest_count`, `room_gross_amount`, `quote_id` y `currency` (solo `DIRECT`, D2), `stay_status`, `check_in_foreign_guest_count`, `check_out_foreign_guest_count` |
| `cancellation` | `Cancellation` | PK `id`; FK `reservation_id` → `reservation`, único (0..1 por reserva) | Inmutable; `channel` `RECEPTION` u `OTA_API` |
| `guest_data` | `GuestData` | PK `id`; FK `reservation_id` → `reservation`; único `(reservation_id, document_number)` | Datos de todos los huéspedes que envía el Módulo 1, guardados una vez, en el Check-In; no se actualizan |
| `migratory_movement` | `MigratoryMovement` | PK `id`; FK `guest_data_id` → `guest_data`; FK `reservation_id` → `reservation`; FK `guest_id` → `guest` (nulo para acompañantes); único `(reservation_id, document_number, movement_type)` | Solo tipo y fecha. La vista de huéspedes alojados y el SIRE unen esta tabla con `guest_data` |
| `sire_export` | `SireExport` | PK `id` | `export_kind` `PERIOD` o `SINGLE_MOVEMENT`; `exportId` = `SireExport.id`; sin relación con los movimientos |
| `reservation_audit` | auditoría de actualizaciones | PK `id`; FK `reservation_id` | Inmutable |
| `commission_audit` | auditoría de comisiones OTA | PK `id`; FK `reservation_id`; FK `ota_id` | Inmutable: acción, importes y actor |
| `daily_list_message` | mensajes al Módulo 1 | PK `message_id`; único `(operational_date, sequence_number)` | Evita reenviar la lista el mismo día |
| `processed_event` | idempotencia de colas | PK `event_id` | |

`Reservation.status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`) se
guarda como texto. `migrationStatus` es solo un dato de pantalla: se calcula, no se guarda. `Room`,
`ForeignGuestData`, `MaintenanceCalendar` y `RateQuote` son del Módulo 1 o 3: **no se persisten** en el
Módulo 2; solo viajan en objetos de integración.

### Reglas transversales que todos los planes de feature heredan

1. **Transiciones de `status` en un solo lugar.** La tabla de transiciones vive en el dominio
   (`PENDING`→`ACTIVE`, `ACTIVE`→`IN_PROGRESS`, `IN_PROGRESS`→`COMPLETED`, `ACTIVE`/`PENDING`→`CANCELLED`,
   `ACTIVE`/`PENDING`→`NO_SHOW`) y un único servicio de aplicación (`ReservationStatusService`) la
   aplica con bloqueo optimista. `update-reservation` lo usa para confirmación OTA, Check-In, Check-Out,
   y No-Show; `cancel-reservation` lo invoca dentro de su propia transacción.
2. **Sin órdenes de estado al Módulo 1.** El Módulo 2 no aparta ni libera habitaciones: crear,
   modificar o cancelar una reserva solo se refleja en la lista del día (`ADDED`, `UPDATED`,
   `REMOVED`) y la reserva nunca depende de una respuesta del Módulo 1. No hay saga ni compensación.
3. **Avisos al Módulo 1 con orden.** Todo aviso lleva `messageId` y `sequenceNumber` creciente dentro
   del día operativo, se publica después de confirmar el cambio y, si falla, queda pendiente y se
   reintenta en orden.
4. **Tareas programadas** (zona horaria `America/Bogota`, idempotentes, con bloqueo asesor): envío de la
   lista del día a las 00:00; cierre del día al terminar las 23:59 (No-Show:
   `NO_SHOW` para cualquier canal, sin `Cancellation`; habitaciones no llegadas pasan a
   `NOT_ARRIVED`); y reintento de los avisos pendientes. El día operativo es fijo y no es configurable.
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
| D2 | **La tarifa se guarda por habitación, sin total guardado:** `reservation_room` guarda `room_gross_amount` (el `lodgingAmount`), `quote_id` y `currency` tal como las entrega el Módulo 3 (FR-002); el `quote_id` permite al Módulo 3 cobrar en el Check-Out exactamente el valor cotizado. Su única operación con ellas es sumarlas para mostrar el total de la reserva, que no se guarda. | `calculate-dynamic-rate` |
| D3 | **Restricción de exclusión en PostgreSQL** sobre `reservation_room` y las fechas de su reserva (o sobre una tabla de ocupación equivalente): `EXCLUDE USING gist (room_id WITH =, daterange(start_date, end_date) WITH &&) WHERE (status IN ('PENDING','ACTIVE','IN_PROGRESS'))`, con la extensión `btree_gist` creada en la migración base. Impide dos reservas activas solapadas en la misma habitación aun con concurrencia; una violación se traduce en 409 `NO_AVAILABILITY` (o en probar la siguiente habitación candidata). El diseño exacto (copiar fechas y estado a la tabla de ocupación) se cierra en el plan de `check-room-availability`. | `check-room-availability` |
| D4 | **El spec `consult-room-inventory` se ajustó**: la consulta por categoría admite listado completo o filtrado por estado, porque las estadías futuras necesitan todas las habitaciones de la categoría. Pendiente acordar con el Módulo 1 que su API permita ambos modos. | `check-room-availability` |
| D5 | **Datos migratorios completos:** el Módulo 2 da por hecho que el Módulo 1 los envía completos y correctos; no los valida ni los devuelve. | `process-guest-data` |
| D6 | **Motivo de las transiciones:** columna `status_reason` en `reservation`. | `update-reservation` |
| D7 | **Periodo de la exportación SIRE:** se filtra por la `movementDate` del movimiento migratorio. | `process-guest-data`, `export-sire-file` |
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
3. **Datos migratorios y punto de estado**: primero `process-guest-data`, y después `update-reservation`
   (modificación, Check-In, Check-Out y cierre del día; depende de disponibilidad, tarifa
   y del registro del movimiento migratorio).
5. **Creación de reservas y comisión**: `generate-direct-reservation`, `register-ota-information-commission` (antes que la de OTA) y
   `generate-ota-reservation`.
6. **Cancelación**: `cancel-reservation`.
7. **Cumplimiento legal**: `export-sire-file` (depende de `process-guest-data`).

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
| C2 | El diagrama de integración muestra "Datos de huéspedes extranjeros" como **cola separada**; los specs los recibían **dentro** de la notificación de Check-In y de Check-Out. | **DECIDIDO: cola separada** (`m2.huespedes.extranjeros.queue`, un mensaje por huésped); el Check-In y el Check-Out solo traen `foreignGuestCount`. |
| C3 | (a) "Consultar estado de canales OTA" (M3 → M2) no existe en los specs; el diagrama tiene "Consultar % de comisión OTA" (M3 → M2, REST GET). (b) "Error de huésped no encontrado" (M1 → M2) no aparece en ningún spec. | **DECIDIDO (a): se adopta como "Consultar % de comisión OTA"**, REST GET; el Módulo 2 expone `GET /api/otas/{otaId}`. **DECIDIDO (b): fuera del plan** hasta que el Módulo 1 confirme su función y exista un spec. |
| C4 | "Consultar calendario de mantenimientos" no está en la especificación técnica ni en el diagrama de integración, pero sí en los specs y el diccionario. | **DECIDIDO: REST GET reactiva (M2 → M1)**, igual que el inventario. |
| C5 | El diagrama de casos de uso muestra que "Generar reservación por OTA" incluye "Calcular tarifa dinámica"; el spec y el diccionario dicen que **no** se recalcula: usa el valor bruto que envía la OTA. | **DECIDIDO: según el spec y el diccionario.** El Módulo 2 no llama al Módulo 3 en la reserva OTA, para que la comisión cuadre con lo que cobró la agencia. |
| C6 | El diccionario nombra `grossAmount` en `Reservation`; algunos specs usaban `totalAmount`. | **DECIDIDO: un solo nombre interno, `grossAmount`** (columna `gross_amount`, solo en reservas OTA: las directas guardan la tarifa por habitación, D2). `totalAmount` queda solo como nombre del campo en el JSON que envía la OTA. |
| C7 | Fórmula de comisión sin `/100`, con validación 0–100%. | **DECIDIDO: porcentaje de 0 a 100 y se divide entre 100.** `commissionAmount = grossAmount × commissionPercentage / 100`, con `decimal.js`, 2 decimales y redondeo `ROUND_HALF_UP`; el valor queda positivo en el Módulo 2 (el signo lo aplica el Módulo 3). Pendiente confirmar con el Módulo 3 cómo expresa el porcentaje. |
| C8 | El estado `Reserved` del Módulo 1 es una solicitud pendiente de aprobación por su equipo. | **REEMPLAZADO:** el Módulo 1 maneja `Reserved` y `Available` por su cuenta al recibir la lista del día; el Módulo 2 ya no depende de ese estado. |
| C9 | Para reservas con llegada hoy, el spec exigía "todo o nada" con la respuesta del Módulo 1 y compensación. | **REEMPLAZADO:** ya no hay órdenes ni compensación; la reserva se crea sin depender del Módulo 1 (regla transversal 2). |
| C10 | Las tareas programadas no tienen mecanismo definido y con varias instancias podrían ejecutarse dos veces. | **DECIDIDO: `@nestjs/schedule` con bloqueo asesor de PostgreSQL** (`pg_try_advisory_lock`, consulta nativa). Si otra instancia tiene el bloqueo, se salta esa ejecución. El día operativo es fijo (00:00–23:59, Colombia). La idempotencia que piden los specs sigue siendo la garantía principal. |
| C11 | El plan estaba escrito para Java y Spring Boot. | **DECIDIDO: NestJS, TypeScript, TypeORM, `@golevelup/nestjs-rabbitmq`, pnpm y arquitectura hexagonal.** Se eliminó el proyecto Spring/Gradle del repositorio. |

### Cambios pendientes en otros documentos

Estos ajustes **no** están hechos; los specs y los diagramas son del equipo y se acuerdan aparte.

| Documento | Cambio | Decisión |
|---|---|---|
| Los 13 `plan.md` de las features | Quitar las referencias a Java, Spring, JPA, Flyway, JUnit y Maven; usar la arquitectura hexagonal y el stack de este plan | C11, D10 |
| `mod-1-2-3.drawio` | Reflejar la lista del día por cola (M2 → M1), los extranjeros en su propia cola y la consulta del calendario (M2 → M1) | C2, C4 |
| `DIAGRAMA.drawio` (casos de uso) | Quitar la línea "Generar reservación por OTA" → "Calcular tarifa dinámica" | C5 |
| Equipo del Módulo 1 | Cambiar `Reserved` y `Available` por su cuenta con la lista del día; las colas ya están definidas en "Convenciones de colas" | C8, C2 |
| Equipo del Módulo 3 | Confirmar cómo expresa el porcentaje de comisión (0 a 100) | C7 |

## Notes

- `[P]` marca tareas paralelizables; `[US1]` (en los planes de feature) las liga a su historia de usuario.
- Cada plan de feature debe indicar en su encabezado: `Plan base: ../base/plan.md`.
- No se programa una feature hasta que su SPEC esté validado y su PLAN revisado (`sdd-guide.MD`).
- Commit por tarea o grupo lógico, con Gitflow.
