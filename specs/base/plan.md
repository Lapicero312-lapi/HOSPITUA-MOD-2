# Implementation Plan: Base del Módulo 2 (plataforma compartida)

**Date**: 2026-10-09  
**Spec**: [diccionario.md](../diccionario.md) (contrato de integración) y los `spec.md` de los 13 casos de uso  
en `specs/*/`. Este plan no implementa un caso de uso: deja lista la base que todos los planes de
caso de uso reutilizan.

## Summary

El Módulo 2 (Operación de Reservas y Cumplimiento Legal) es el dueño del ciclo de vida de las
reservas (`Reservation.status`) y de `ReservationRoom.stayStatus`. Registra reservas directas
(Recepcionista) y lee las de Booking.com desde el feed de Channex, le envía los tipos de habitación
y la disponibilidad, las modifica, las cancela, cierra el día (No-Show),
recibe del Módulo 1 los avisos de Check-In y Check-Out por habitación (con los datos de todos los
huéspedes de la habitación) y los de mantenimiento e inventario, reporta a Channex los no-shows de
Booking y genera el reporte SIRE.
Consulta al Módulo 1 (inventario y calendario de mantenimientos) y al Módulo 3 (tarifa dinámica), le
envía por cola la lista de reservas del día y sus actualizaciones. **No le ordena apartar ni liberar
habitaciones**: el Módulo 1, dueño del estado de las habitaciones, decide qué hace con esa lista.

Este plan fija lo que comparten los 13 casos de uso: stack, arquitectura hexagonal, estructura, modelo de
datos, contratos de integración (REST y colas), manejo uniforme de errores (siempre 4xx, nunca 500),
tareas programadas y pruebas. Cada plan de caso de uso (`specs/[caso-de-uso]/plan.md`) depende de este y solo
describe lo propio.

## Technical Context

- **Language/Version**: TypeScript (modo `strict`), con la versión que fija el proyecto generado por
  Nest CLI; se deja con versión exacta en `package.json`. Node.js 22 LTS (`.nvmrc`)
- **Framework backend**: NestJS
- **Primary Dependencies**: `@nestjs/config`, `@nestjs/typeorm` + `typeorm` + `pg`, `class-validator`,
  `class-transformer`, `@golevelup/nestjs-rabbitmq`, `@nestjs/schedule`, `@nestjs/axios`,
  `@nestjs/swagger`, `nestjs-pino`, `decimal.js`, `luxon`
- **Storage**: PostgreSQL
- **Messaging**: RabbitMQ
- **Architecture**: hexagonal (puertos y adaptadores), con un solo dominio general (`src/domain/`)
- **Package manager**: pnpm (monorepo con `pnpm-workspace.yaml`)
- **Testing**: Vitest, supertest y Testcontainers en el backend; Vitest + Testing Library en el frontend
- **Target Platform**: servidor Linux/Windows + navegador web
- **Project Type**: web application (`backend/` + `frontend/`)
- **API**: REST, documentada con OpenAPI (`@nestjs/swagger`)
- **Frontend**: React + Vite + React Router + TanStack Query
- **Version Control**: Git + GitHub (Gitflow)
- **Performance Goals**: cualquier llamada REST responde en menos de 1 segundo en el 95 % de los
  casos, con 5 recepcionistas a la vez, salvo que la spec
  del caso de uso fije otro tiempo. Se mantienen los tiempos de cada spec: cancelación local
  < 200 ms, Check-In/Check-Out < 500 ms, recotización < 3 s, exportación SIRE < 2 s para 500
  huéspedes, cierre del día < 1 min para 1000 reservas, página del listado < 1 s con hasta 50 000
  reservas. Una reserva de Booking queda registrada en menos de 2 minutos y un cambio de
  disponibilidad llega a Channex en menos de 1 minuto.
- **Constraints**: tiempo máximo de espera de 1 s al Módulo 1 y de 3 s al Módulo 3 (si no responden,
  nunca se asume disponibilidad ni tarifa); ningún error sale como 500; no se escriben datos
  personales en los logs; el día operativo es el de Colombia (`America/Bogota`); disponible 24/7,
  porque Booking reserva a cualquier hora; límite de Channex de 10 solicitudes por minuto por propiedad
  para disponibilidad.
- **Scale/Scope**: hasta 100 habitaciones en hasta 10 categorías, 5 recepcionistas a la vez, 1
  agencia OTA (Booking.com, por Channex staging), 300 reservas nuevas por día y 50 000 reservas guardadas en total.
- **Configuración de Channex** (variables de entorno, nunca en la base de datos): `CHANNEX_BASE_URL`
  (`https://staging.channex.io`), `CHANNEX_API_KEY`, `CHANNEX_PROPERTY_ID`, `BOOKING_HOTEL_ID`,
  `BOOKING_COMMISSION_PERCENTAGE`, `CHANNEX_SYNC_INTERVAL_SECONDS` (`30`) y `CHANNEX_ARI_DAYS` (`90`).

### Decisiones de stack

| Necesidad | Decisión | Por qué |
|---|---|---|
| Versión de TypeScript | La que trae el proyecto de `nest new`, fija y con `strict` | Es la combinación que Nest prueba; no se actualiza por separado |
| ORM | TypeORM (aprobado) | Permite escribir a mano el SQL propio de PostgreSQL (D3, bloqueo asesor, `FOR UPDATE`) dentro de las migraciones |
| Migraciones de esquema | Migraciones de TypeORM escritas en SQL, versionadas en `backend/src/migrations` | El esquema no se genera solo desde las clases: se revisa y se versiona |
| Librería de RabbitMQ | `@golevelup/nestjs-rabbitmq` (aprobado) | Exchange topic, reintentos con espera creciente y dead-letter sin armarlos a mano |
| Gestor de paquetes | pnpm (aprobado) | Instalación rápida, dependencias estrictas y filtros por paquete (`pnpm --filter backend test`) |
| Control de concurrencia | Comparación de `updatedAt` al guardar (`UPDATE … WHERE updated_at = :leído`), con precisión de microsegundos. No se usa `@UpdateDateColumn`: TypeORM convierte la columna a `Date` y JavaScript solo guarda milisegundos, así que la comparación nunca coincidiría. El repositorio lee `updated_at` como texto y lo actualiza con `now()` en cada cambio | Edición y cancelación simultáneas (`CONCURRENT_UPDATE`) |
| Dinero | `decimal.js`, columnas `numeric(14,2)`, redondeo `ROUND_HALF_UP`; **nunca `number`** | Comisión exacta |
| Fechas | Fechas puras `AAAA-MM-DD` (texto `date` en la base) y `luxon` para el día operativo en `America/Bogota` | Evita corrimientos por zona horaria. Se guardan e intercambian como `AAAA-MM-DD`; las pantallas las muestran como `dd/mm/aaaa` |
| Seguridad | **No se implementa en el Módulo 2**: es una capa aparte del sistema de microservicios. El frontend simula el login. Quién llama se indica con la cabecera `X-Client` (`RECEPTIONIST`, `MODULE1`, `MODULE3`) y quién hizo la acción con `X-User`; ninguna se valida | Ver la regla transversal 10 |
| Integración con Booking.com | **Channex** (entorno de pruebas `staging.channex.io`), por REST con la cabecera `user-api-key`. Las reservas se leen del *feed* (`GET /api/v1/booking_revisions/feed`) y se confirman con `ack`; el Módulo 2 crea los tipos de habitación (`POST`/`PUT /api/v1/room_types`) y envía la disponibilidad (`POST /api/v1/availability`). Los planes de tarifa y los precios los envía el **Módulo 3** directamente a Channex. La propiedad es fija y la crea un administrador en Channex | Booking no llama al Módulo 2: el Módulo 2 consulta a Channex, así que no necesita una URL pública (D12) |
| Tareas programadas | `@nestjs/schedule` con `timeZone: 'America/Bogota'` | Envío de la lista del día (00:00), cierre del día (al terminar las 23:59: se ejecuta a las 00:00:30), reintento de avisos pendientes (cada 10 s), lectura del feed de Channex y envío de la disponibilidad (cada 30 s) y sincronización con Channex (03:00) |
| Exclusión mutua de tareas con varias instancias | Bloqueo asesor de PostgreSQL (C10) | Evitar que dos instancias ejecuten el mismo cierre del día |
| Timeouts y reintentos REST | `@nestjs/axios` con timeout; `cockatiel` si se necesitan reintentos o corte de circuito | No asumir disponibilidad ante caídas |
| Logs y correlación | `nestjs-pino` + `AsyncLocalStorage`. Cada solicitud lleva un `correlationId`: se reutiliza la cabecera `X-Correlation-Id` si cumple `^[\w-]{1,100}$`; si no, se genera un UUID, y se devuelve en la respuesta. De la solicitud solo se registran el método, el patrón de la ruta y `X-Client`; nunca cabeceras, cuerpo ni consulta. Los errores controlados (de negocio o de la solicitud) van con nivel `warn`; los no controlados, que el filtro también responde como 4xx, van con `error` y su detalle, sin datos de la solicitud | Seguir un mensaje o una solicitud de punta a punta |

## Arquitectura hexagonal

El backend tiene **un solo dominio general** (`src/domain/`), compartido por todos los casos de uso. No hay
un dominio por módulo: las entidades del Módulo 2 (`Reservation`, `Guest`, `Ota`, `MigratoryMovement`...)
están relacionadas entre sí y sus reglas se cruzan (una cancelación cambia el estado de la reserva y
genera avisos al Módulo 1; un Check-In cambia la reserva y registra movimientos migratorios), así
que viven juntas. Las dependencias siempre apuntan hacia adentro:
`infrastructure` → `application` → `domain`.

| Capa | Contiene | Puede importar |
|---|---|---|
| `domain/` | **Todas** las entidades y objetos de valor del Módulo 2, sus relaciones, los enumerados, las reglas de negocio (invariantes y tabla de transiciones de `status`) y los errores de negocio. Ver "Modelo de dominio" | Solo TypeScript puro (y `decimal.js` para dinero). **Nada de Nest, TypeORM ni RabbitMQ** |
| `application/` | Un caso de uso por cada spec (puertos de entrada y servicios) y los puertos de salida (repositorios, Módulo 1, Módulo 3, publicador de eventos, reloj) | `domain/` |
| `infrastructure/in/` | Adaptadores de entrada: controladores REST, consumidores RabbitMQ, tareas programadas | `application/` (puertos de entrada) |
| `infrastructure/out/` | Adaptadores de salida: repositorios TypeORM, clientes HTTP del Módulo 1 y 3, publicadores RabbitMQ, reloj | `application/` (implementan los puertos de salida) |

Reglas:

1. Los controladores, consumidores y tareas programadas **solo llaman a un caso de uso**; no tienen
   reglas de negocio.
2. Las entidades del dominio no son las de TypeORM. El adaptador de persistencia tiene sus propias clases
   de tabla y las convierte con un mapeador.
3. Los módulos 1 y 3 se ven solo como puertos (`Module1Port`, `Module3Port`). Si cambia su API, solo se
   cambia el adaptador. Sus datos (`Room`, `MaintenanceCalendar`, `RateQuote`) son
   objetos de integración en `application/`, no entidades del dominio.
4. La inyección de dependencias de Nest une los puertos con sus adaptadores (símbolos como
   `RESERVATION_REPOSITORY` o `CLOCK`); el dominio nunca usa `@Injectable`.
5. Las dependencias entre capas se verifican en CI con `dependency-cruiser`
   (`backend/.dependency-cruiser.cjs`, dentro de `pnpm lint`): `domain/` no importa nada de `application/`
   ni de `infrastructure/`.
6. Los casos de uso no se llaman entre sí por sus clases internas: si uno necesita a otro (por ejemplo,
   cancelar y modificar usan "Consultar y buscar reservas"), lo usa por su puerto de entrada.

## Modelo de dominio

Todas las entidades viven en `src/domain/`. Los tipos son los del dominio (TypeScript); las tablas
están en "Modelo de datos base".

### Entidades y atributos

**Reservation** (raíz del agregado de la reserva)

| Atributo | Tipo | Regla |
|---|---|---|
| `reservationRef` | texto, único | Formato `RSV-` + 8 caracteres hexadecimales en mayúscula (por ejemplo `RSV-3F9A1C7B`). Lo genera el Módulo 2 al crear la reserva; si el generado ya existe, genera otro. Es el identificador con el que los demás módulos la referencian |
| `guestRef` | referencia a `Guest` | Titular, obligatorio |
| `conflictReason`, `conflictDetectedAt` | texto, fecha y hora | Solo reservas de Booking en conflicto: `NO_ROOM_AVAILABLE`, `CAPACITY_EXCEEDED` o `CHANGE_NOT_APPLICABLE` (D13); vacíos si no hay conflicto |
| `guestCount` | entero | Total de personas: suma de los `guestCount` de sus habitaciones |
| `rooms` | lista de `ReservationRoom` | Entre 1 y 10, sin repetir `roomId` |
| `startDate`, `endDate` | fecha sin hora | `endDate` > `startDate`; comunes a todas las habitaciones |
| `source` | `ReservationSource` | `DIRECT` u `OTA` |
| `otaId` | referencia a `Ota` | Solo si `source` es `OTA` |
| `externalConfirmationCode` | texto | Solo `OTA`; único por agencia |
| `grossAmount`, `currency` | dinero | Solo `OTA`: valor bruto que envía la agencia (`amount` en la revisión de Channex); base de la comisión |
| `commissionPercentage`, `commissionAmount` | decimal | `0` en `DIRECT`; en `OTA`, `grossAmount × commissionPercentage / 100` |
| `commissionStatus` | `CommissionStatus` | Solo `OTA` |
| `notes` | texto | Opcional, máximo 500 caracteres |
| `status` | `ReservationStatus` | Solo cambia por la tabla de transiciones |
| `statusReason` | texto | Motivo de la última transición (D6) |
| `createdAt`, `updatedAt` | fecha y hora | `updatedAt` es el control de concurrencia optimista |

**ReservationRoom** (parte del agregado `Reservation`; no existe sin su reserva)

| Atributo | Tipo | Regla |
|---|---|---|
| `roomId` | id externo | `Room.id` del Módulo 1; vacío solo si una reserva de Booking quedó sin habitación (D13) |
| `roomNumber` | texto | Copia del número del Módulo 1, guardada al asignarla; vacío si no hay habitación |
| `guestCount` | entero | Personas de esa habitación: ≥ 1 y ≤ `maxCapacity` |
| `categoryRoom` | texto | Categoría de la habitación |
| `roomGrossAmount`, `currency` | dinero | Solo `DIRECT`: el `lodgingAmount` y la moneda de la cotización del Módulo 3, sin cálculos |
| `quoteId` | texto | Solo `DIRECT`: identificador de la cotización; el Módulo 3 lo usa para cobrar en el Check-Out |
| `stayStatus` | `StayStatus` | Estado de esa habitación dentro de la reserva |

**Guest** (titular de reservas)

| Atributo | Tipo | Regla |
|---|---|---|
| `id` (`guestRef`) | id | |
| `firstName`, `lastName` | texto | Obligatorios; el nombre completo (`fullName`) se arma uniéndolos |
| `documentType` | `DocumentType` | Obligatorio, salvo en reservas de Booking: Booking no lo envía |
| `documentNumber` | texto | Obligatorio, salvo en reservas de Booking |
| `nationality` | texto | Nombre del país; si no es Colombia, el huésped es extranjero (se deduce, no se guarda). En reservas de Booking es informativa: se convierte del código de país de Channex y puede quedar vacía |
| `contactPhone`, `contactEmail` | texto | Opcionales |

**Ota** (agencia; se registra por configuración, `configure-ota`)

| Atributo | Tipo | Regla |
|---|---|---|
| `id`, `name`, `hotelAccountId` | texto | De la configuración: `Booking.com` y el id del hotel en Booking (`BOOKING_HOTEL_ID`) |
| `commissionPercentage` | decimal de 0 a 100 | Porcentaje pactado por defecto |
| `connectionStatus` | `CONNECTED` o `DISCONNECTED` | |
| `linkedAt`, `lastSyncAt` | fecha y hora | `lastSyncAt`: última lectura del feed de Channex que terminó bien |

**OtaRoomTypeMapping** (relación de tipos de habitación, `configure-ota`): `channexRoomTypeId`,
`categoryRoom`, `countOfRooms` y `occupancy` (los últimos enviados a Channex). Un tipo de habitación de
Channex por categoría, y viceversa; el Módulo 2 lo crea a partir de las habitaciones vendibles del
Módulo 1. Es de la propiedad, no de la agencia: una agencia nueva conectada por Channex usaría los
mismos tipos.

**OtaBookingRevision** (revisión de Channex ya procesada, `generate-ota-reservation`): `revisionId`,
`otaId`, `bookingId`, `status` (`new`, `modified`, `cancelled`), la reserva afectada, el resultado y
cuándo se confirmó a Channex (`ack`).

**AriPendingChange** (disponibilidad pendiente de enviar a Channex, `configure-ota`): `categoryRoom`,
`dateFrom` y `dateTo`.

**OtaNoShowReport** (no-show de Booking pendiente o ya reportado a Channex, `generate-ota-reservation`):
la reserva, su `bookingId` de Channex, el resultado (`PENDING`, `REPORTED` o `REJECTED`) y los intentos.

**IdempotencyKey** (creación de reserva directa ya atendida, `generate-direct-reservation`): la clave
`Idempotency-Key`, el resumen del cuerpo y la reserva creada; vale 24 horas.

**Cancellation** (registro inmutable de la anulación): `cancellationId`, `reservationRef`,
`cancellationDate`, `reason` (opcional), `channel` (`RECEPTION` | `OTA_API`), `processedBy`, `status`
(`COMPLETED`).

**GuestData** (datos de cada huésped, colombiano o extranjero, guardados una sola vez por reserva):
`reservationRef`, `firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`,
`nationality`, `originPlace`, `destinationPlace` (estos dos solo son obligatorios para extranjeros;
para colombianos pueden estar vacíos). Identidad única: (`reservationRef`, `documentNumber`).
Se crea en el Check-In y no se modifica; el Check-Out solo agrega el `DEPARTURE`.

**MigratoryMovement** (entrada o salida de un huésped): `movementId`, su `GuestData`, `movementType`
(`ENTRY` | `DEPARTURE`) y `movementDate`. Sin datos personales copiados: la reserva (`reservationRef`),
el documento (`documentNumber`) y el titular (`guestRef`) se obtienen de su `GuestData`. Identidad
única: un movimiento de cada tipo por `GuestData`.

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
| `CommissionStatus` | `CALCULATED`, `RECONCILED`, `PAID` |
| `DocumentType` | `RC`, `TI`, `CC`, `CE`, `PAS`, `NIT` |
| `MovementType` | `ENTRY`, `DEPARTURE` |
| `MigrationStatus` (derivado, no se guarda) | `AWAITING_CHECK_IN`, `COMPLETE`, `NOT_REQUIRED`, `NO_CHECK_IN` |

### Relaciones

| Relación | Cardinalidad | Notas |
|---|---|---|
| `Reservation` → `Guest` | 1 a 1 | Cada reserva guarda su propio titular. Si la misma persona tiene varias reservas, tiene un `Guest` en cada una; corregir sus datos en una reserva no cambia las demás |
| `Reservation` → `ReservationRoom` | 1 a 1..10 | Composición: las habitaciones se crean, cambian y borran solo a través de su reserva |
| `Ota` → `Reservation` | 1 a N | Solo reservas `OTA`; `(otaId, externalConfirmationCode)` es único |
| `Ota` → `OtaBookingRevision` | 1 a N | Una fila por revisión procesada; evita procesarla dos veces |
| `Reservation` → `Cancellation` | 1 a 0..1 | Solo cancelaciones explícitas (Recepcionista o Booking); el No-Show no crea `Cancellation` |
| `Reservation` → `GuestData` | 1 a N | Un `GuestData` por huésped de la reserva, único por `documentNumber` |
| `GuestData` → `MigratoryMovement` | 1 a 1..2 | Máximo un `ENTRY` y un `DEPARTURE` por huésped |
| `Reservation` → `MigratoryMovement` | 1 a N | Los movimientos de todos sus huéspedes |
| `Guest` → `MigratoryMovement` | 1 a 0..N | Cuando el huésped es el titular de la reserva; los acompañantes no son `Guest` |
| `SireExport` y `MigratoryMovement` | sin relación guardada | La exportación solo filtra por `movementDate` |
| `ReservationRoom` → `Room` (Módulo 1) | N a 1, externa | Por `roomId`; el estado físico es del Módulo 1 |

El diagrama con las tablas, sus columnas y sus relaciones está en "Modelo de datos base (PostgreSQL)".

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
  - Solo se modifican o cancelan reservas en `ACTIVE` o `PENDING`; las `OTA` solo cuando Booking lo envía
    por el feed de Channex. La Recepcionista solo puede asignar la habitación de una reserva OTA en
    conflicto.
  - Una habitación sin asignar (`roomId` vacío) no bloquea inventario, deja la reserva en conflicto y
    hace que la reserva **no viaje en la lista del día** hasta que se asigne (`ROOM_UNASSIGNED`).
  - `PENDING` se conserva sin uso: las reservas directas y las de Booking nacen en `ACTIVE`.
  - Las reservas `DIRECT` no guardan un total (se calcula al mostrarlo) y no tienen comisión; las `OTA` no tienen tarifa ni cotización por habitación.
- **`Guest`**: parte del agregado `Reservation` (su titular); se crea y se corrige solo a través de su reserva.
- **`Ota`**: agregado propio; la reserva la referencia por id. `OtaRoomTypeMapping` es un registro aparte,
  de la propiedad y no de la agencia.
- **`Cancellation`**, **`GuestData`**, **`MigratoryMovement`**, **`SireExport`**: registros propios que referencian a la reserva por `reservationRef`. Son inmutables una
  vez creados.

### Datos externos (no son entidades del dominio)

`Room` y `MaintenanceCalendar` (Módulo 1) y `RateQuote` (Módulo 3) son objetos de integración de los
puertos. No se persisten: de `RateQuote` se copian el `lodgingAmount`, el `quoteId` y la moneda a
`ReservationRoom`. La lista `guests` del Check-In se guarda en `GuestData`. La revisión de reserva de
Channex (`BookingRevision`) es también un objeto de integración: de ella se crea o cambia la
`Reservation`, y solo se guarda su identificador en `OtaBookingRevision`.

## Comunicación entre módulos

Regla: **proactiva** (el módulo avisa un evento y no espera respuesta) → **cola RabbitMQ**;
**reactiva** (necesita un dato o confirmación inmediata) → **REST**.

| Interacción | Dirección | Mecanismo | Tipo | Caso de uso |
|---|---|---|---|---|
| Check-In por habitación (con la lista de huéspedes) | M1 → M2 | Cola `m2.habitacion.checkin.queue` | Proactiva | `update-reservation` |
| Check-Out por habitación (con la lista de huéspedes) | M1 → M2 | Cola `m2.habitacion.checkout.queue` | Proactiva | `update-reservation` |
| Mantenimiento registrado, cambiado o cancelado | M1 → M2 | Cola `m2.habitacion.mantenimiento.queue` | Proactiva | `configure-ota` |
| Habitación agregada, dada de baja o cambiada | M1 → M2 | Cola `m2.habitacion.inventario.queue` | Proactiva | `configure-ota` |
| Lista de reservas del día y sus actualizaciones | M2 → M1 | Cola `m1.reservas.diarias.queue` | Proactiva | `check-view-reservation` |
| Consultar inventario de habitaciones | M2 → M1 | REST GET | Reactiva | `consult-room-inventory` |
| Consultar calendario de mantenimientos | M2 → M1 | REST GET | Reactiva | `consult-maintenance-calendar` |
| Consultar % de comisión OTA | M3 → M2 | REST GET | Reactiva | `register-ota-information-commission` |
| Consultar tarifa dinámica | M2 → M3 | REST POST (cuerpo JSON) | Reactiva | `calculate-dynamic-rate` |
| Consultar las reservas de un rango de fechas (y habitación) para validar un mantenimiento o dar de baja una habitación | M1 → M2 | REST GET | Reactiva | `check-view-reservation` (FR-023) |
| Consultar una reserva por su referencia (`quoteIds`, canal y datos de la OTA) para liquidar en el Check-Out | M3 → M2 | REST GET | Reactiva | `check-view-reservation` (FR-022) |
| Leer las reservas de Booking (feed de revisiones) y confirmarlas (`ack`) | M2 → Channex | REST GET y POST, cada 30 s, antes de enviar la disponibilidad | El Módulo 2 pregunta | `generate-ota-reservation` |
| Crear y actualizar tipos de habitación (al iniciar y 03:00) y enviar disponibilidad (al cambiar y 03:00) | M2 → Channex | REST GET, POST y PUT | Proactiva | `configure-ota` |
| Reportar el no-show de una reserva de Booking (`POST /api/v1/bookings/{booking_id}/no_show`) | M2 → Channex | REST POST, después del cierre del día | Proactiva | `generate-ota-reservation` |
| Crear planes de tarifa y enviar precios | M3 → Channex | REST (fuera del Módulo 2) | Proactiva | Módulo 3 |

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
| `m2.habitacion.mantenimiento.queue` | `habitacion.mantenimiento` | Uno por mantenimiento registrado, cambiado o cancelado (`configure-ota`) |
| `m2.habitacion.inventario.queue` | `habitacion.inventario` | Uno por habitación agregada, dada de baja o cambiada (`configure-ota`) |

- Cola que **envía** el Módulo 2 (la consume el Módulo 1): `m1.reservas.diarias.queue`, con dos routing
  keys que se publican por el mismo canal y proceso, para conservar el orden:

| Routing key | Mensaje | `sequenceNumber` |
|---|---|---|
| `reserva.lista-del-dia` | `DailyReservationList`, una vez al día a las 00:00 | Siempre `1` |
| `reserva.lista-del-dia.actualizacion` | `DailyReservationUpdate` (`ADDED`, `UPDATED`, `REMOVED`) | Creciente dentro del día operativo |

- Mensajes JSON **planos**, sin envoltura: los campos van en la raíz y el tipo de mensaje lo da la
  routing key. Todo mensaje, en los dos sentidos, lleva `messageId` (UUID que se genera una sola vez,
  cuando ocurre el hecho, se guarda con el envío pendiente y se repite igual en los reintentos) y
  `sequenceNumber`. Las reglas de cada lado están en las specs: `check-view-reservation` (FR-018) para
  la lista del día y `update-reservation` (FR-023) para el Check-In y el Check-Out.
- Consumidores idempotentes (se ignoran los `messageId` repetidos), con reintentos y dead-letter queue.
- La publicación de la lista del día y de sus actualizaciones respeta el orden: las actualizaciones
  esperan detrás de la lista (ver `check-view-reservation`).

### Traducción de respuestas HTTP a cola (decisión C1)

Los specs describen "responde 200/400" para el Check-In y el Check-Out. Como el Módulo 1 los emite
por cola y no espera respuesta, el consumidor del Módulo 2 aplica estas reglas:

| Caso en el spec | Comportamiento del consumidor |
|---|---|
| Notificación válida | Procesa el cambio de la habitación y confirma el mensaje |
| Duplicado (mismo `messageId`, o habitación ya en `CHECKED_IN`/`CHECKED_OUT`) | Confirma sin efectos (el "200 idempotente") |
| Reserva inexistente, o en un estado que no admite el evento, o habitación ya `NOT_ARRIVED` | Lo deja en el log (sin datos personales) y confirma el mensaje, sin reintentar (el "400") |
| Payload ilegible, sin `reservationRef` o `roomId`, o con caracteres maliciosos | Envía el mensaje a la dead-letter queue, sin procesar (el "400" de payload inválido) |
| Fallo temporal (base de datos caída, por ejemplo) | Reintenta con espera creciente y, agotados los reintentos, a la dead-letter queue |

El contenido exacto de cada mensaje está en el plan de su caso de uso:

- Check-In y Check-Out: [`update-reservation/plan.md`](../update-reservation/plan.md).
- Avisos de mantenimiento e inventario: [`configure-ota/plan.md`](../configure-ota/plan.md).
- Lista del día y sus actualizaciones: [`check-view-reservation/plan.md`](../check-view-reservation/plan.md).

## Contratos REST

Todas las rutas del Módulo 2 cuelgan del prefijo global `/api` (`app.setGlobalPrefix('api')`); los
controladores declaran su ruta sin él. La documentación OpenAPI está en `/api/docs` y también queda visible
en producción. El cuerpo de error se documenta en OpenAPI como clase, y cada ruta declara los errores que
puede responder.

**El Módulo 2 expone** (rutas propuestas, se fijan en cada plan de caso de uso):

| Recurso | Quién lo consume | Caso de uso |
|---|---|---|
| `GET /api/reservations` con paginación de 10, filtros (`search` por código, documento o nombre; `status`; `source`; `otaId`; rango de estadía `dateFrom` y `dateTo`) y `order` por `startDate`. Con `X-Client: MODULE1` es la consulta por fechas de FR-023 | Recepcionista, procesos internos; Módulo 1 | `check-view-reservation` |
| `GET /api/reservations/day-summary` (llegadas y salidas esperadas hoy) | Recepcionista | `check-view-reservation` |
| `GET /api/reservations/{reservationRef}` (detalle) | Recepcionista; Módulo 3 con `X-Client: MODULE3` (devuelve `quoteIds`, canal y, solo si es OTA, `otaId`, `otaConfirmationCode` y `otaCommissionPercentage`; 404 si no existe) | `check-view-reservation` |
| `POST /api/reservations/direct/preview` y `POST /api/reservations/direct` (canal directo; la creación exige la cabecera `Idempotency-Key`) | Recepcionista | `generate-direct-reservation` |
| `POST /api/reservations/{reservationRef}/modification-preview` y `PATCH /api/reservations/{reservationRef}` | Recepcionista (solo directas); los cambios de Booking llegan por el feed de Channex | `update-reservation` |
| `PATCH /api/reservations/{reservationRef}/room-assignment` (asignar habitación a una reserva de Booking en conflicto) | Recepcionista | `update-reservation` |
| `POST /api/reservations/{reservationRef}/cancellation` | Recepcionista (solo directas); las cancelaciones de Booking llegan por el feed de Channex | `cancel-reservation` |
| `GET /api/guest-stays` (vista de huéspedes alojados: paginación de 10, filtros de nacionalidad, situación y periodo, búsqueda por documento o nombre) y `GET /api/reservations/{reservationRef}/guests/{documentNumber}` (detalle de un huésped) | Recepcionista | `process-guest-data` |
| `GET /api/guests/lookup` (precarga del titular por tipo y número de documento: datos de su reserva más reciente; solo lectura) | Recepcionista | `generate-direct-reservation` |
| `POST /api/sire/exports` (periodo o movimiento individual; devuelve `.TXT` y cabecera `Export-Id`; es `POST` porque registra un `SireExport`, decisión D9) | Recepcionista | `export-sire-file` |
| `GET /api/otas` y `GET /api/otas/{otaId}` (solo lectura; devuelve `id`, `name`, `commissionPercentage`, estado de conexión) | Recepcionista, Módulo 3 | `register-ota-information-commission` |
| `GET /api/ota-commissions` (comisiones de Booking) y `POST /api/ota-commissions/reconciliations` (conciliación de comisiones) | Módulo 3 (finanzas) | `register-ota-information-commission` |

**Booking.com no llama al Módulo 2**: no hay rutas para la OTA. El Módulo 2 lee sus reservas del feed de
Channex (`generate-ota-reservation`) y le envía los tipos de habitación y la disponibilidad
(`configure-ota`); los precios los envía el Módulo 3. La
agencia se registra por configuración; no hay rutas de alta ni edición manual (`POST`/`PUT /api/otas`
quedan fuera).

**El Módulo 2 consume** (a través de los puertos `Module1Port`, `Module3Port` y `ChannexPort`):

| Servicio | Método | Caso de uso |
|---|---|---|
| Habitaciones vendibles por `categoryRoom`, por `roomId` o todas (contrato en [`consult-room-inventory/plan.md`](../consult-room-inventory/plan.md)) | M1 GET | `consult-room-inventory` |
| Calendario de mantenimientos por `roomId` y rango de fechas (contrato en [`consult-maintenance-calendar/plan.md`](../consult-maintenance-calendar/plan.md)) | M1 GET | `consult-maintenance-calendar` |
| Tarifa dinámica por habitación (contrato en [`calculate-dynamic-rate/plan.md`](../calculate-dynamic-rate/plan.md)) | M3 POST | `calculate-dynamic-rate` |
| Feed de revisiones de reserva y `ack` (`/api/v1/booking_revisions/feed`, `/api/v1/booking_revisions/{id}/ack`) | Channex GET y POST | `generate-ota-reservation` |
| Propiedades (`/api/v1/properties/options`), tipos de habitación (`/api/v1/room_types`) y disponibilidad (`/api/v1/availability`) | Channex GET, POST y PUT | `configure-ota` |

**Errores**: cuerpo `{ "errorCode", "message", "timestamp", "path" }` con HTTP 400 (por defecto, también
para recursos inexistentes, como piden los specs, y para la falta de disponibilidad) o 429 (exportación
SIRE). La única excepción es la consulta de una reserva por referencia para el Módulo 3, que
responde 404 si no existe, como lo espera ese módulo. El diccionario prohíbe 500 y cualquier 2xx o 3xx
para un error.

## Project Structure

### Documentation (este caso de uso)

```text
specs/
├── diccionario.md
├── base/
│   ├── plan.md                           # Este archivo
│   └── guia-planes-por-caso-de-uso.md    # Cómo escribir el plan de cada caso de uso
├── template/                             # Plantillas de spec y de plan
└── [caso-de-uso]/                        # Uno por cada uno de los 13 casos de uso
    ├── spec.md
    └── plan.md                           # Plan del caso de uso; referencia a ../base/plan.md
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
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── domain/                   # DOMINIO GENERAL, único para todo el Módulo 2 (TypeScript puro)
    │   ├── reservation/          #   Reservation (raíz), ReservationRoom, transiciones de status y stayStatus
    │   ├── guest/                #   Guest
    │   ├── ota/                  #   Ota, OtaRoomTypeMapping, regla de comisión
    │   ├── cancellation/         #   Cancellation
    │   ├── migration/            #   GuestData, MigratoryMovement, SireExport, MigrationStatus (derivado)
    │   ├── shared/               #   enumerados, Money (decimal.js), errores de negocio
    │   └── index.ts              #   API pública del dominio
    ├── application/
    │   ├── ports/out/            # ReservationRepository, GuestRepository, ..., Module1Port, Module3Port, ChannexPort,
    │   │                         #   EventPublisher, Clock
    │   ├── integration/          # objetos de integración: Room, MaintenanceCalendar, RateQuote, BookingRevision
    │   └── use-cases/            # un caso de uso por cada spec (puerto de entrada + servicio):
    │       ├── generate-direct-reservation/
    │       ├── configure-ota/                # agencia, tipos de habitación y disponibilidad en Channex
    │       ├── generate-ota-reservation/     # lectura del feed de Channex
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
    │   │   ├── messaging/        # consumidores RabbitMQ (Check-In, Check-Out, mantenimiento e inventario)
    │   │   └── jobs/             # lista del día (00:00), cierre del día (00:00:30), reintentos, feed de
    │   │                         #   Channex, disponibilidad y no-shows pendientes (30 s), tipos y disponibilidad completa (03:00)
    │   ├── out/
    │   │   ├── persistence/      # clases de tabla TypeORM, mapeadores y repositorios
    │   │   ├── module1/          # cliente HTTP del Módulo 1
    │   │   ├── module3/          # cliente HTTP del Módulo 3
    │   │   ├── channex/          # cliente HTTP de Channex (user-api-key, manejo de 429)
    │   │   ├── messaging/        # publicadores RabbitMQ, idempotencia (processed_message)
    │   │   └── clock/            # reloj del hotel y día operativo, con luxon (America/Bogota)
    │   ├── config/               # configuración por entorno (@nestjs/config), RabbitMQ, TypeORM
    │   └── shared/               # ApiError, filtro global de excepciones, correlación de logs
    └── migrations/               # migraciones SQL de TypeORM
backend/test/
    ├── unit/                     # dominio, casos de uso e infraestructura sin base de datos ni cola (espejo de src/)
    ├── integration/              # Testcontainers (PostgreSQL, RabbitMQ)
    ├── contract/                 # contratos REST y de mensajes
    └── e2e/                      # API con supertest (*.e2e-spec.ts)

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
están relacionadas y sus reglas se cruzan entre casos de uso, así que separarlas por módulo duplicaría
reglas. Los casos de uso de las specs se reflejan en `application/use-cases/`. El frontend cubre solo a la
Recepcionista; Booking no usa ninguna pantalla ni ruta del Módulo 2, y el Módulo 1 tiene su propia
interfaz.

## Diseño técnico base

### Modelo de datos base (PostgreSQL)

**Convenciones**

- Nombres de tablas y columnas en `snake_case`. Cada tabla tiene clave primaria `id uuid`
  (`gen_random_uuid()`), salvo donde se indica otra.
- Fechas sin hora: `date`. Fechas con hora: `timestamptz` (`updated_at` con precisión de
  microsegundos, porque es el control de concurrencia).
- Dinero: `numeric(14,2)`. Porcentajes: `numeric(5,2)` de 0 a 100 (`30.00` es el 30 %). Moneda:
  `char(3)` (código ISO 4217, por ejemplo `COP`).
- Estados y tipos: texto con un `CHECK` de los valores permitidos (no se usan tipos `enum` de
  PostgreSQL, para poder agregar valores con una migración simple).
- `nationality` guarda el nombre del país tal como llega (`Colombia`, `Venezuela`, `Estados Unidos`);
  el huésped es extranjero si no es exactamente `Colombia`. Al SIRE se exportan tal cual la nacionalidad
  (nombre del país) y el tipo de documento (`CC`, `PAS`, ...), sin tablas de códigos.
- Extensiones creadas en la migración base: `btree_gist` (anti-solape, D3), `pg_trgm` y `unaccent`
  (búsqueda por nombre sin distinguir mayúsculas ni tildes). Como PostgreSQL no acepta `unaccent` en un
  índice, la migración crea también `immutable_unaccent(text)`, un envoltorio `IMMUTABLE` que usan los
  índices de nombre y las búsquedas.
- Datos que **no** se guardan en tablas: `Room` y `MaintenanceCalendar` (Módulo 1) y `RateQuote`
  (Módulo 3) viajan solo en objetos de integración; el código del hotel en SIRE (`hotelSireCode`) y el
  código de la ciudad (`hotelCityCode`) van en la configuración del sistema (variables de entorno).

```mermaid
erDiagram
    guest {
        uuid id PK
        uuid reservation_id FK, UK "un titular por reserva"
        varchar first_name
        varchar last_name
        varchar document_type "RC TI CC CE PAS NIT; nulo en Booking"
        varchar document_number "nulo en Booking"
        varchar nationality "nombre del pais; nulo si no se conoce"
        varchar contact_phone "nulo"
        varchar contact_email "nulo"
        timestamptz created_at
        timestamptz updated_at
    }
    ota {
        uuid id PK
        varchar name UK
        varchar hotel_account_id UK
        numeric commission_percentage "0 a 100"
        varchar connection_status "CONNECTED DISCONNECTED"
        timestamptz linked_at
        timestamptz last_sync_at
        timestamptz created_at
        timestamptz updated_at
    }
    reservation {
        uuid id PK
        char reservation_ref UK "RSV- mas 8 hex"
        varchar source "DIRECT OTA"
        uuid ota_id FK "nulo en DIRECT"
        varchar external_confirmation_code "UK con ota_id; solo OTA"
        date start_date
        date end_date
        smallint guest_count
        varchar status "6 estados"
        varchar status_reason "nulo"
        varchar notes "nulo; max 500"
        numeric gross_amount "solo OTA"
        char currency "solo OTA"
        numeric commission_percentage
        numeric commission_amount
        varchar commission_status "solo OTA"
        varchar conflict_reason "nulo si no hay conflicto"
        timestamptz conflict_detected_at "nulo si no hay conflicto"
        timestamptz created_at
        timestamptz updated_at "concurrencia"
    }
    reservation_room {
        uuid id PK
        uuid reservation_id FK "UK con room_id"
        uuid room_id "Room del Modulo 1, sin FK; nulo si sin asignar"
        varchar room_number "nulo si sin asignar"
        varchar category_room
        smallint guest_count
        numeric room_gross_amount "solo DIRECT"
        varchar quote_id "solo DIRECT"
        char currency "solo DIRECT"
        varchar stay_status "4 estados"
        date start_date "copia para D3"
        date end_date "copia para D3"
        boolean blocks_inventory "D3"
    }
    cancellation {
        uuid id PK
        uuid reservation_id FK, UK
        timestamptz cancellation_date
        varchar reason "nulo"
        varchar channel "RECEPTION OTA_API"
        varchar processed_by
        varchar status "COMPLETED"
    }
    guest_data {
        uuid id PK
        uuid reservation_id FK "UK con document_number"
        varchar document_type
        varchar document_number
        varchar first_name
        varchar last_name
        date birth_date
        varchar nationality "nombre del pais"
        varchar origin_place "nulo en colombianos"
        varchar destination_place "nulo en colombianos"
        timestamptz created_at
    }
    migratory_movement {
        uuid id PK
        uuid guest_data_id FK "UK con movement_type"
        varchar movement_type "ENTRY DEPARTURE"
        date movement_date
        timestamptz created_at
    }
    sire_export {
        uuid id PK
        timestamptz export_date
        varchar export_kind "PERIOD SINGLE_MOVEMENT"
        integer records_count
        date date_range_start "nulo si SINGLE_MOVEMENT"
        date date_range_end "nulo si SINGLE_MOVEMENT"
        varchar processed_by
    }
    commission_audit {
        uuid id PK
        uuid reservation_id FK
        uuid ota_id FK
        varchar action "CALCULATED RECONCILED PAID"
        varchar previous_status "nulo"
        numeric gross_amount
        numeric commission_percentage
        numeric commission_amount
        varchar channel "OTA_API MODULE3"
        varchar performed_by
        timestamptz occurred_at
    }
    daily_list_message {
        uuid message_id PK
        date operational_date "UK con sequence_number"
        integer sequence_number
        varchar message_kind "LIST UPDATE"
        varchar update_type "nulo en LIST"
        uuid reservation_id FK "nulo en LIST"
        varchar removal_reason "solo REMOVED"
        jsonb payload
        varchar publish_status "PENDING PUBLISHED FAILED"
        smallint attempts
        timestamptz next_attempt_at "nulo"
        timestamptz created_at
        timestamptz published_at "nulo"
    }
    daily_sequence {
        date operational_date PK
        integer last_sequence
        boolean list_generated
    }
    processed_message {
        uuid message_id PK
        varchar queue
        bigint sequence_number
        timestamptz processed_at
    }
    ota_room_type_mapping {
        uuid id PK
        uuid channex_room_type_id UK
        varchar category_room UK
        integer count_of_rooms "ultimo enviado; minimo 1"
        smallint occupancy "ultima enviada"
    }
    ota_booking_revision {
        uuid revision_id PK "id de Channex"
        uuid ota_id FK
        uuid booking_id "id de Channex"
        varchar status "new modified cancelled"
        uuid reservation_id FK "nulo si no se aplico"
        varchar result "APPLIED CONFLICT IGNORED"
        timestamptz processed_at
        timestamptz acked_at "nulo hasta confirmar"
    }
    ari_pending_change {
        uuid id PK
        varchar category_room
        date date_from
        date date_to
        timestamptz created_at
    }
    ota_no_show_report {
        uuid reservation_id PK "FK"
        uuid booking_id "id de Channex"
        varchar result "PENDING REPORTED REJECTED"
        smallint attempts
        timestamptz created_at
        timestamptz reported_at "nulo"
    }
    idempotency_key {
        uuid key PK
        varchar request_hash
        uuid reservation_id FK
        timestamptz created_at
    }

    reservation ||--|| guest : "reservation_id"
    ota |o--o{ reservation : "ota_id"
    reservation ||--|{ reservation_room : "reservation_id"
    reservation ||--o| cancellation : "reservation_id"
    reservation ||--o{ guest_data : "reservation_id"
    guest_data ||--|{ migratory_movement : "guest_data_id"
    reservation ||--o{ commission_audit : "reservation_id"
    ota ||--o{ commission_audit : "ota_id"
    reservation |o--o{ daily_list_message : "reservation_id"
    ota ||--o{ ota_booking_revision : "ota_id"
    reservation |o--o{ ota_booking_revision : "reservation_id"
    reservation ||--o| ota_no_show_report : "reservation_id"
    reservation ||--o| idempotency_key : "reservation_id"
```

**Normalización.** El modelo está en tercera forma normal: cada dato se guarda en una sola tabla y las
tablas se unen por sus claves. Hay cuatro excepciones a propósito:

- `reservation_room.start_date`, `end_date` y `blocks_inventory` copian datos de la reserva para que
  la base de datos impida el solape (D3).
- `reservation_room.room_number` y `category_room` copian datos del Módulo 1, que no está en esta base.
- `commission_audit` guarda los importes de cada acción, porque es un historial y no debe cambiar si
  la reserva cambia después.
- `ota_no_show_report.booking_id` copia el de `ota_booking_revision`, para que el envío a Channex no
  tenga que unir tablas.

**`guest`** — titular de una reserva (cada reserva tiene el suyo)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK (`guestRef`) |
| `reservation_id` | `uuid` | no | FK → `reservation`, borrado en cascada; único (un titular por reserva) |
| `first_name`, `last_name` | `varchar(100)` | no | |
| `document_type` | `varchar(3)` | sí | `RC`, `TI`, `CC`, `CE`, `PAS`, `NIT`; obligatorio en reservas directas, vacío en las de Booking (no lo envía) |
| `document_number` | `varchar(30)` | sí | Obligatorio en reservas directas, vacío en las de Booking; los dos van juntos o ninguno |
| `nationality` | `varchar(60)` | sí | Nombre del país; obligatorio en reservas directas. En las de Booking es informativa y queda vacía si el código de país no está en la tabla de conversión |
| `contact_phone` | `varchar(30)` | sí | |
| `contact_email` | `varchar(254)` | sí | |
| `created_at`, `updated_at` | `timestamptz` | no | |

- `CHECK`: `document_type` y `document_number` van los dos o ninguno. Que sean obligatorios en las
  reservas directas lo valida la aplicación, porque el canal está en `reservation`.
- Índices: `(document_number)` para la búsqueda por documento y trigram (`gin_trgm_ops`) sobre `immutable_unaccent(lower(first_name || ' ' || last_name))`. No es único por documento: la misma persona puede ser titular de varias reservas, con sus datos en cada una (corregirlos en una reserva no cambia las demás).

**`ota`** — agencia; se registra por configuración (`configure-ota`)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `name` | `varchar(100)` | no | Único; `Booking.com` |
| `hotel_account_id` | `varchar(100)` | no | Único; id del hotel en Booking (`10485037`) |
| `commission_percentage` | `numeric(5,2)` | no | De 0 a 100 |
| `connection_status` | `varchar(12)` | no | `CONNECTED`, `DISCONNECTED` |
| `linked_at` | `timestamptz` | no | Fecha de la primera vinculación; no cambia al volver a vincular |
| `last_sync_at` | `timestamptz` | no | Al registrar la agencia, igual a `linked_at`; después se actualiza con cada lectura del feed de Channex que termina bien |
| `created_at`, `updated_at` | `timestamptz` | no | |

**`reservation`** — raíz del agregado

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `reservation_ref` | `char(12)` | no | Único; `CHECK (reservation_ref ~ '^RSV-[0-9A-F]{8}$')`; si el generado ya existe, se genera otro |
| `source` | `varchar(6)` | no | `DIRECT`, `OTA` |
| `ota_id` | `uuid` | sí | FK → `ota`; solo `OTA` |
| `external_confirmation_code` | `varchar(50)` | sí | Solo `OTA` |
| `start_date`, `end_date` | `date` | no | `CHECK (end_date > start_date)` |
| `guest_count` | `smallint` | no | `CHECK (guest_count >= 1)`; suma de sus habitaciones |
| `status` | `varchar(12)` | no | `PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| `status_reason` | `varchar(200)` | sí | Motivo de la última transición (D6) |
| `notes` | `varchar(500)` | sí | |
| `gross_amount` | `numeric(14,2)` | sí | Solo `OTA`: valor bruto que envía la agencia (`amount` en la revisión de Channex) |
| `currency` | `char(3)` | sí | Solo `OTA`: moneda del `gross_amount` |
| `commission_percentage` | `numeric(5,2)` | no | `0` por defecto; de 0 a 100; en `OTA`, el de la agencia al registrar la reserva |
| `commission_amount` | `numeric(14,2)` | no | `0` por defecto; `CHECK (commission_amount >= 0)`; en `OTA`, `gross_amount × commission_percentage / 100` |
| `commission_status` | `varchar(10)` | sí | Solo `OTA`: `CALCULATED`, `RECONCILED`, `PAID` |
| `created_at` | `timestamptz` | no | |
| `conflict_reason` | `varchar(25)` | sí | Solo reservas de Booking en conflicto: `NO_ROOM_AVAILABLE`, `CAPACITY_EXCEEDED`, `CHANGE_NOT_APPLICABLE` (D13) |
| `conflict_detected_at` | `timestamptz` | sí | Cuándo se detectó el conflicto |
| `updated_at` | `timestamptz(6)` | no | Control de concurrencia: lo actualiza el repositorio con `now()` en cada cambio y se lee como texto, para no perder los microsegundos |

- Único `(ota_id, external_confirmation_code)`.
- `CHECK`: `conflict_reason` y `conflict_detected_at` van los dos o ninguno, y solo en `source = 'OTA'`.
- `CHECK` de canal:
  - `DIRECT`: `ota_id`, `external_confirmation_code`, `gross_amount`, `currency` y
    `commission_status` nulos, y `commission_percentage = 0` y `commission_amount = 0`.
  - `OTA`: `ota_id`, `external_confirmation_code`, `gross_amount`, `currency` y
    `commission_status` no nulos.
- Índices: `(status, start_date)`, `(end_date)`, `(ota_id)`, `(external_confirmation_code)` para la
  búsqueda por el código de la OTA y parcial `(conflict_detected_at) WHERE conflict_reason IS NOT NULL`
  para el filtro de reservas en conflicto.

**`reservation_room`** — habitación dentro de la reserva

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `reservation_id` | `uuid` | no | FK → `reservation`, borrado en cascada |
| `room_id` | `uuid` | sí | `Room.id` del Módulo 1, sin FK; vacío solo si una reserva de Booking quedó sin habitación (D13) |
| `room_number` | `varchar(10)` | sí | Copia del número del Módulo 1, guardada al asignarla; vacío si no hay habitación |
| `category_room` | `varchar(50)` | no | |
| `guest_count` | `smallint` | no | `CHECK (guest_count >= 1)`; el tope (`maxCapacity`) lo valida la aplicación, porque viene del Módulo 1 |
| `room_gross_amount` | `numeric(14,2)` | sí | Solo `DIRECT`: `lodgingAmount` de la cotización (D2) |
| `quote_id` | `varchar(64)` | sí | Solo `DIRECT` |
| `currency` | `char(3)` | sí | Solo `DIRECT` |
| `stay_status` | `varchar(12)` | no | `EXPECTED` por defecto; `EXPECTED`, `CHECKED_IN`, `CHECKED_OUT`, `NOT_ARRIVED` |
| `start_date`, `end_date` | `date` | no | Copia de las fechas de su reserva (D3) |
| `blocks_inventory` | `boolean` | no | `true` mientras la habitación ocupa inventario (D3) |

- Único `(reservation_id, room_id)`.
- `CHECK`: `room_gross_amount`, `quote_id` y `currency` van los tres o ninguno.
- `CHECK`: `room_id` y `room_number` van los dos o ninguno, y sin habitación `blocks_inventory = false`
  (una habitación sin asignar no ocupa inventario y no entra en la restricción anti-solape).
- **Anti-solape (D3):** `EXCLUDE USING gist (room_id WITH =, daterange(start_date, end_date, '[)') WITH &&) WHERE (blocks_inventory)`.
- Índice `(room_id)`.
- Índice parcial `(category_room, start_date, end_date) WHERE blocks_inventory`, para las habitaciones
  ocupadas por categoría y noche que consulta `configure-ota` cada 30 segundos.

**`cancellation`** — registro inmutable de la anulación

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK (`cancellationId`) |
| `reservation_id` | `uuid` | no | FK → `reservation`; único (0..1 por reserva) |
| `cancellation_date` | `timestamptz` | no | |
| `reason` | `varchar(500)` | sí | |
| `channel` | `varchar(10)` | no | `RECEPTION`, `OTA_API` |
| `processed_by` | `varchar(100)` | no | Identificador de quien canceló (Recepcionista u OTA) |
| `status` | `varchar(10)` | no | Siempre `COMPLETED` |

**`guest_data`** — datos de todos los huéspedes, una vez por reserva

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `reservation_id` | `uuid` | no | FK → `reservation` |
| `document_type` | `varchar(3)` | no | `RC`, `TI`, `CC`, `CE`, `PAS`, `NIT` |
| `document_number` | `varchar(30)` | no | |
| `first_name`, `last_name` | `varchar(100)` | no | |
| `birth_date` | `date` | no | |
| `nationality` | `varchar(60)` | no | Nombre del país |
| `origin_place`, `destination_place` | `varchar(100)` | sí | Vacíos para colombianos |
| `created_at` | `timestamptz` | no | Sin `updated_at`: se crea en el Check-In y no se modifica |

Único `(reservation_id, document_number)`, **sin** el tipo de documento a propósito: en el Check-Out
el huésped se identifica solo por su número (`process-guest-data`). Índices: `(document_number)` y trigram sobre
`immutable_unaccent(lower(first_name || ' ' || last_name))`. No hay `CHECK` de procedencia y destino: el Módulo 2 da
por hecho que el Módulo 1 los envía completos para los extranjeros (D5).

**`migratory_movement`** — entrada o salida de un huésped

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK (`movementId`) |
| `guest_data_id` | `uuid` | no | FK → `guest_data` |
| `movement_type` | `varchar(9)` | no | `ENTRY`, `DEPARTURE` |
| `movement_date` | `date` | no | |
| `created_at` | `timestamptz` | no | |

Único `(guest_data_id, movement_type)`. Índice `(movement_date)` para el periodo del SIRE. La
reserva, el documento y el titular (`guestRef`) se obtienen de su `guest_data`: el titular es el
huésped cuyo documento coincide con el `guest` de la reserva.

**`sire_export`** — histórico de descargas del archivo SIRE

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK (`exportId`) |
| `export_date` | `timestamptz` | no | |
| `export_kind` | `varchar(15)` | no | `PERIOD`, `SINGLE_MOVEMENT` |
| `records_count` | `integer` | no | `CHECK (records_count >= 0)` |
| `date_range_start`, `date_range_end` | `date` | sí | Obligatorios si es `PERIOD` |
| `processed_by` | `varchar(100)` | no | La Recepcionista |

- `CHECK`: si es `SINGLE_MOVEMENT`, `records_count = 1` y sin fechas; si es `PERIOD`, las dos fechas
  con `date_range_start <= date_range_end`. El límite de un año lo valida la aplicación.
- Sin relación con los movimientos: la exportación solo filtra por `movement_date` (D7).

**`commission_audit`** — registro auditable de cada comisión (FR-010 de `register-ota-information-commission`)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `reservation_id` | `uuid` | no | FK → `reservation` |
| `ota_id` | `uuid` | no | FK → `ota` |
| `action` | `varchar(12)` | no | `CALCULATED`, `RECONCILED`, `PAID` |
| `previous_status` | `varchar(10)` | sí | Estado de la comisión antes de la acción |
| `gross_amount` | `numeric(14,2)` | no | |
| `commission_percentage` | `numeric(5,2)` | no | |
| `commission_amount` | `numeric(14,2)` | no | |
| `channel` | `varchar(10)` | no | `OTA_API` (cálculo) o `MODULE3` (conciliación) |
| `performed_by` | `varchar(100)` | no | |
| `occurred_at` | `timestamptz` | no | |

Inmutable. Índice `(reservation_id)`.

**`daily_list_message`** — avisos al Módulo 1; se guardan antes de publicarse

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `message_id` | `uuid` | no | PK; es el `messageId` del mensaje |
| `operational_date` | `date` | no | |
| `sequence_number` | `integer` | no | `CHECK (sequence_number >= 1)`; la lista es `1` |
| `message_kind` | `varchar(6)` | no | `LIST`, `UPDATE` |
| `update_type` | `varchar(8)` | sí | Solo `UPDATE`: `ADDED`, `UPDATED`, `REMOVED` |
| `reservation_id` | `uuid` | sí | FK → `reservation`; solo `UPDATE` |
| `removal_reason` | `varchar(15)` | sí | Solo `REMOVED`: `CANCELLED`, `DATE_CHANGED`, `NO_SHOW`, `ROOM_UNASSIGNED` |
| `payload` | `jsonb` | no | El JSON exacto que se publica |
| `publish_status` | `varchar(9)` | no | `PENDING`, `PUBLISHED`, `FAILED` |
| `attempts` | `smallint` | no | `0` por defecto |
| `next_attempt_at` | `timestamptz` | sí | Cuándo toca el siguiente intento (espera creciente); vacío hasta el primer fallo. La agrega una migración de `check-view-reservation` |
| `created_at` | `timestamptz` | no | |
| `published_at` | `timestamptz` | sí | |

- Único `(operational_date, sequence_number)`.
- Único parcial `(operational_date) WHERE message_kind = 'LIST'`: una sola lista por día.
- `CHECK`: una `LIST` no lleva `update_type`, `reservation_id` ni `removal_reason`; un `UPDATE` lleva
  `update_type` y `reservation_id`; `removal_reason` solo va, y es obligatorio, cuando `update_type` es
  `REMOVED`.
- Índice `(publish_status, operational_date, sequence_number)` para reintentar en orden.

**`daily_sequence`** — numeración de los avisos del día

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `operational_date` | `date` | no | PK |
| `last_sequence` | `integer` | no | `CHECK (last_sequence >= 0)`; último `sequence_number` asignado; `0` hasta que sale la lista |
| `list_generated` | `boolean` | no | `false` por defecto; `true` cuando la lista (secuencia 1) quedó guardada |

Se bloquea con `SELECT … FOR UPDATE` para asignar `sequence_number` sin huecos ni repetidos y para que
ningún cambio quede entre la lista y su primera actualización (ver `check-view-reservation/plan.md`).

**`processed_message`** — mensajes recibidos del Módulo 1 (idempotencia)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `message_id` | `uuid` | no | PK |
| `queue` | `varchar(60)` | no | Cola de la que llegó |
| `sequence_number` | `bigint` | no | Para detectar saltos (FR-023 de `update-reservation`) |
| `processed_at` | `timestamptz` | no | |

Se inserta en la misma transacción que el cambio que produce el mensaje.

**`ota_room_type_mapping`** — relación de tipos de habitación de Channex con categorías (`configure-ota`)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `channex_room_type_id` | `uuid` | no | Único; tipo de habitación en Channex |
| `category_room` | `varchar(50)` | no | Único; categoría del Módulo 2 |
| `count_of_rooms` | `integer` | no | `CHECK (count_of_rooms >= 1)` (Channex no acepta 0); habitaciones vendibles enviadas a Channex la última vez |
| `occupancy` | `smallint` | no | Capacidad máxima enviada a Channex la última vez |

La llena `SyncRoomTypes` (`configure-ota`) al crear o actualizar los tipos en Channex. No tiene `ota_id`:
los tipos son de la propiedad, igual que `ari_pending_change`.

**`ota_booking_revision`** — revisiones de Channex ya procesadas (`generate-ota-reservation`)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `revision_id` | `uuid` | no | PK; `id` de la revisión en Channex |
| `ota_id` | `uuid` | no | FK → `ota` |
| `booking_id` | `uuid` | no | `booking_id` de Channex (la misma para todas las revisiones de una reserva) |
| `status` | `varchar(9)` | no | `new`, `modified`, `cancelled` |
| `reservation_id` | `uuid` | sí | FK → `reservation`; vacío si la revisión no se aplicó |
| `result` | `varchar(10)` | no | `APPLIED`, `CONFLICT`, `IGNORED` |
| `processed_at` | `timestamptz` | no | |
| `acked_at` | `timestamptz` | sí | Cuándo se confirmó a Channex; vacío si el `ack` falló y hay que repetirlo |

Se inserta en la misma transacción que el cambio de la reserva; el `ack` se envía después del commit.
Índices: `(booking_id)` y parcial `(processed_at) WHERE acked_at IS NULL` para repetir los `ack`.

**`ari_pending_change`** — disponibilidad pendiente de enviar a Channex (`configure-ota`)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `id` | `uuid` | no | PK |
| `category_room` | `varchar(50)` | no | |
| `date_from`, `date_to` | `date` | no | Rango de noches afectadas; `date_to > date_from` |
| `created_at` | `timestamptz` | no | |

Se inserta en la misma transacción que el cambio de la reserva; la tarea de disponibilidad las agrupa,
las envía y las borra.

**`ota_no_show_report`** — no-shows de Booking pendientes de reportar a Channex (`generate-ota-reservation`)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `reservation_id` | `uuid` | no | PK y FK → `reservation` |
| `booking_id` | `uuid` | no | `booking_id` de Channex (de `ota_booking_revision`) |
| `result` | `varchar(8)` | no | `PENDING`, `REPORTED` o `REJECTED` |
| `attempts` | `smallint` | no | Intentos de envío |
| `created_at` | `timestamptz` | no | |
| `reported_at` | `timestamptz` | sí | Cuándo Channex respondió `200` |

La inserta el cierre del día (`update-reservation`), en la misma transacción que el `NO_SHOW`;
`ChannexSyncJob` envía las `PENDING`. Índice parcial `(created_at) WHERE result = 'PENDING'`.

**`idempotency_key`** — creaciones de reservas directas ya atendidas (`generate-direct-reservation`)

| Columna | Tipo | Nulo | Regla |
|---|---|---|---|
| `key` | `uuid` | no | PK; la cabecera `Idempotency-Key` |
| `request_hash` | `varchar(64)` | no | SHA-256 del cuerpo de la solicitud |
| `reservation_id` | `uuid` | no | FK → `reservation` creada |
| `created_at` | `timestamptz` | no | Vale 24 horas; el cierre del día borra las vencidas |

Se inserta en la misma transacción que la reserva.

`migrationStatus` es solo un dato de pantalla: se calcula, no se guarda.

### Reglas transversales que todos los planes de caso de uso heredan

1. **Transiciones de `status` en un solo lugar.** La tabla de transiciones vive en el dominio
   (`PENDING`→`ACTIVE`, `ACTIVE`→`IN_PROGRESS`, `IN_PROGRESS`→`COMPLETED`, `ACTIVE`/`PENDING`→`CANCELLED`,
   `ACTIVE`/`PENDING`→`NO_SHOW`) y un único servicio de aplicación (`ReservationStatusService`) la
   aplica con bloqueo optimista. `update-reservation` lo usa para el Check-In, el Check-Out, el No-Show y
   los cambios que envía Booking; `PENDING`→`ACTIVE` queda sin uso hoy; `cancel-reservation` lo invoca dentro de su propia transacción.
2. **Sin órdenes de estado al Módulo 1.** El Módulo 2 no aparta ni libera habitaciones: crear,
   modificar o cancelar una reserva solo se refleja en la lista del día (`ADDED`, `UPDATED`,
   `REMOVED`) y la reserva nunca depende de una respuesta del Módulo 1. No hay saga ni compensación.
3. **Avisos al Módulo 1 con orden.** Todo aviso lleva `messageId` y `sequenceNumber` creciente dentro
   del día operativo, se publica después de confirmar el cambio y, si falla, queda pendiente y se
   reintenta en orden.
4. **Tareas programadas** (zona horaria `America/Bogota`, idempotentes, con bloqueo asesor): envío de la
   lista del día a las 00:00; cierre del día al terminar las 23:59 (se ejecuta a las 00:00:30 y
   procesa el día que terminó; No-Show:
   `NO_SHOW` para cualquier canal, sin `Cancellation`; habitaciones no llegadas pasan a
   `NOT_ARRIVED`); reintento de los avisos pendientes; lectura del feed de Channex y, a continuación,
   envío de la disponibilidad pendiente, cada 30 segundos; y sincronización de tipos de
   habitación y disponibilidad completa con Channex a las 03:00. El día operativo es fijo y no es configurable.
5. **Errores uniformes.** Un filtro global de excepciones traduce toda excepción a `ApiError` 4xx; un
   conflicto de `updatedAt` (ediciones o cancelaciones simultáneas) es siempre 400 `CONCURRENT_UPDATE`.
   Ningún error no controlado sale como 500; el filtro genérico registra el detalle en el log y responde
   un error controlado sin datos de infraestructura.
   Cada `errorCode` tiene un solo mensaje en todo el Módulo 2 (puede llevar datos, como `{roomNumber}`): si
   los specs piden dos textos distintos, son dos códigos.
6. **Clientes de otros módulos** detrás de puertos (`Module1Port`, `Module3Port`, `ChannexPort`) con
   timeout (1 s al Módulo 1 y 3 s al Módulo 3).
   Ante fallo, cada caso de uso decide, pero nunca se asume disponibilidad ni tarifa por defecto o a cero.
   Las llamadas a otros módulos se hacen **antes de abrir la transacción**; dentro solo hay operaciones de
   base de datos. Lo que impide la sobreventa o guardar sobre datos viejos es la restricción anti-solape
   (D3) y la comparación de `updatedAt` dentro de la transacción, no la verificación previa.
7. **Mensajería.** Mensajes planos con `messageId` y `sequenceNumber`. El consumidor registra el
   `messageId` en `processed_message` dentro de la misma transacción que el cambio. Reintentos con
   backoff y dead-letter queue.
8. **Nomenclatura del diccionario**: `Reservation.status`, `roomNumber`, `startDate`/`endDate`,
   `externalConfirmationCode`, `grossAmount`, `categoryRoom`, `reservationRef`; estados del Módulo 1
   en PascalCase (`Available`, `Reserved`, `Occupied`, ...).
   El código (clases, funciones y constantes) va en inglés; los comentarios, los mensajes de error y los
   títulos de las pruebas, en español.
9. **OTA solo lectura.** Las reservas de canal OTA solo las cambian o cancelan los cambios que envía
   Booking por el feed de Channex (canal `OTA_API`); la Recepcionista solo puede asignar la habitación de
   una reserva OTA en conflicto. Cancelar una reserva OTA no toca la comisión.
10. **Sin seguridad.** El Módulo 2 no implementa autenticación ni autorización: es una capa aparte del
    sistema de microservicios. El frontend **simula** el login y guarda el nombre de la Recepcionista.
    - `X-Client` dice quién llama (`RECEPTIONIST`, `MODULE1` o `MODULE3`) cuando una misma ruta responde
      distinto según el llamador. Sin esa cabecera, o con otro valor, se responde 400.
    - `X-User` trae el nombre de quien hizo la acción y se guarda tal cual en `processed_by` o
      `performed_by`.
    - Ninguna de las dos se valida: no se comprueba quién llama ni quién es el usuario. Pero si una ruta de
      la Recepcionista guarda quién hizo la acción (`processed_by`) y falta `X-User`, responde 400
      `USER_REQUIRED`, "Falta el usuario que hace la acción."
    - Booking no llama al Módulo 2: el Módulo 2 lee el feed de Channex con la clave `user-api-key` de
      la configuración, que nunca se guarda en la base de datos ni se escribe en los logs.

### Decisiones de diseño tomadas al escribir los planes de caso de uso

| # | Decisión | Origen |
|---|---|---|
| D1 | **La confirmación de una cotización no confía en el importe de la pantalla.** Al confirmar, el servidor vuelve a cotizar con el Módulo 3 y lo compara con las tarifas por habitación que vio el solicitante; si difiere, responde 400 "La tarifa cambió, vuelva a cotizar". Nunca se guarda un monto enviado por el cliente; de la `RateQuote` solo se guardan `lodgingAmount` y `quoteId` en la habitación. Lo aplican `generate-direct-reservation` y `update-reservation`. | `calculate-dynamic-rate` |
| D2 | **La tarifa se guarda por habitación, sin total guardado:** `reservation_room` guarda `room_gross_amount` (el `lodgingAmount`), `quote_id` y `currency` tal como las entrega el Módulo 3 (FR-002); el `quote_id` permite al Módulo 3 cobrar en el Check-Out exactamente el valor cotizado. Su única operación con ellas es sumarlas para mostrar el total de la reserva, que no se guarda. | `calculate-dynamic-rate` |
| D3 | **Anti-solape con una restricción de exclusión en PostgreSQL** sobre `reservation_room`. Cada habitación guarda una copia de las fechas de su reserva (`start_date`, `end_date`) y `blocks_inventory`, que vale `true` mientras la reserva está en `PENDING`, `ACTIVE` o `IN_PROGRESS` y la habitación en `EXPECTED` o `CHECKED_IN`. Restricción: `EXCLUDE USING gist (room_id WITH =, daterange(start_date, end_date, '[)') WITH &&) WHERE (blocks_inventory)`, con la extensión `btree_gist`. El rango `'[)'` deja que una salida y una llegada el mismo día no choquen. El agregado `Reservation` actualiza esas copias en la misma transacción cada vez que cambian las fechas, el `status` o el `stayStatus`. Impide dos reservas solapadas en la misma habitación aunque se guarden al mismo tiempo; una violación se traduce en el error de disponibilidad de cada flujo, siempre 400 (`AVAILABILITY_TAKEN` en la reserva directa, después de probar otra habitación candidata; `ROOM_NOT_AVAILABLE` en la modificación); en una reserva de Booking la revisión se procesa de nuevo en la siguiente lectura y, si no hay otra habitación, queda sin asignar. | `check-room-availability` |
| D5 | **Datos migratorios completos:** el Módulo 2 da por hecho que el Módulo 1 los envía completos y correctos; no los valida ni los devuelve. | `process-guest-data` |
| D6 | **Motivo de las transiciones:** columna `status_reason` en `reservation`. | `update-reservation` |
| D7 | **Periodo de la exportación SIRE:** se filtra por la `movementDate` del movimiento migratorio. | `process-guest-data`, `export-sire-file` |
| D8 | **API de modificación en dos pasos:** `POST .../modification-preview` (no persiste) y `PATCH` (confirma, con `updatedAt` y las tarifas esperadas por habitación). Propuesta de los planes; el spec no define su forma. | `update-reservation` |
| D9 | **La exportación SIRE es `POST`**, no `GET`, porque crea un registro `SireExport` (un `GET` no debe tener efectos). | `export-sire-file` |
| D10 | **Arquitectura hexagonal** con un solo `domain/` general para todo el Módulo 2 y las capas `application` (un caso de uso por cada spec) e `infrastructure` (in/out). Verificada en CI. | Este plan |
| D11 | **Migraciones escritas en SQL**, no generadas desde las clases de TypeORM, para controlar `EXCLUDE`, índices parciales y bloqueos. | Este plan |
| D12 | **Booking.com por Channex, leyendo el feed.** Una tarea consulta `GET /api/v1/booking_revisions/feed` cada 30 s (todas las páginas, de hasta 100) y confirma cada revisión con `POST /api/v1/booking_revisions/{id}/ack` después del commit. No se usan webhooks: exigen una URL pública y el feed sirve igual en desarrollo. En el mismo ciclo, después del feed, se envía la disponibilidad, para no devolverle a Booking un cupo que Channex ya descontó. Cada revisión se procesa una sola vez (`ota_booking_revision`); las reservas de Booking nacen en `ACTIVE`. | `generate-ota-reservation` |
| D13 | **Conflictos de Booking.** Booking ya aceptó la reserva, así que nunca se rechaza: si no hay habitación libre de la categoría, la habitación queda sin asignar (`room_id` vacío, sin bloquear inventario); si se supera la capacidad o un cambio no se puede aplicar, la reserva queda marcada (`conflict_reason`). La Recepcionista asigna la habitación. Una reserva con alguna habitación sin asignar **no viaja en la lista del día** hasta que se asigne: si ya estaba, sale con `REMOVED` y motivo `ROOM_UNASSIGNED`; al asignar la última, entra con `ADDED`. | `generate-ota-reservation`, `update-reservation`, `check-view-reservation` |
| D14 | **Tipos de habitación y disponibilidad hacia Channex.** El Módulo 2 crea un tipo de habitación por categoría a partir de las habitaciones vendibles del Módulo 1 (cantidad y capacidad máxima) y lo sincroniza al iniciar y a las 03:00, sin borrar. La disponibilidad (vendibles menos las que ocupan las reservas) se envía al cambiar, agrupada cada 30 s, y completa (90 días) a las 03:00. Las habitaciones en mantenimiento se descuentan solo en sus fechas; el Módulo 1 avisa por cola los mantenimientos y los cambios de inventario. **Los planes de tarifa y los precios los envía el Módulo 3** directamente a Channex. | `configure-ota` |
| D15 | **No-show de Booking.** Al cierre del día, una reserva de Booking que pasa a `NO_SHOW` deja pendiente su reporte a Channex (`POST /api/v1/bookings/{booking_id}/no_show` con `waived_fees: true`), en la misma transacción; `ChannexSyncJob` lo envía. Booking no cobra comisión y el Módulo 2 no la concilia. | `generate-ota-reservation`, `update-reservation` |
| D16 | **Idempotencia de la reserva directa.** La creación exige `Idempotency-Key`; la misma clave con el mismo cuerpo devuelve la misma reserva durante 24 horas. | `generate-direct-reservation` |

## Estrategia de testing base

- **Unitarios** (Vitest): dominio, casos de uso y piezas de infraestructura que no usan base de datos ni
  cola, en `test/unit/` y en espejo de `src/`; reglas de negocio, tabla de
  transiciones, cálculo de comisión (`decimal.js`), reglas del día operativo.
- **Integración** (Vitest + Testcontainers): PostgreSQL y RabbitMQ reales; concurrencia optimista
  (`updatedAt`), unicidad de `(operational_date, sequence_number)` en los avisos al Módulo 1,
  restricción anti-solape, idempotencia de consumidores (`messageId`), dead-letter.
- **Contrato**: adaptadores de `Module1Port`, `Module3Port` y `ChannexPort` contra respuestas simuladas (por ejemplo
  `nock` o `msw`): éxito, rechazo, timeout y respuesta ambigua; y forma de los mensajes de cola.
- **API** (supertest): controladores con los casos de uso reales y el filtro global de errores, en
  `test/e2e/` (`pnpm --filter backend test:e2e`).
- **Arquitectura**: la verificación de dependencias entre capas corre dentro de `pnpm lint` en el CI.
- **Estilo**: las pruebas importan `describe`, `it`, `expect` y `vi` desde `vitest`; no se usan globales.
  Los archivos terminan en `.spec.ts` (unitarias, de integración y de contrato) o en `.e2e-spec.ts` (API):
  Vitest solo ejecuta esos.
- **Cada escenario Gherkin** de un `spec.md` debe tener al menos una prueba de integración en el plan
  de su caso de uso.
- **Frontend**: Vitest + Testing Library en pantallas críticas (listado con filtros, paginación,
  modificar, cancelar, exportación SIRE).

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Crear el monorepo pnpm: `pnpm-workspace.yaml`, `package.json` raíz, `.nvmrc` (Node 22 LTS) y las carpetas `backend/` y `frontend/`
- [ ] T002 Generar `backend/` con Nest CLI (TypeScript `strict`, versión fija) e instalar las dependencias de Technical Context
- [ ] T003 Inicializar `frontend/` con React + Vite + TypeScript
- [ ] T004 [P] Configurar oxlint y Prettier en backend y frontend, y `dependency-cruiser` (capas hexagonales) en el backend
- [ ] T005 [P] Crear `docker-compose.yml` con PostgreSQL y RabbitMQ para desarrollo
- [ ] T006 Configurar `@nestjs/config` por entorno (dev, test) con variables de entorno validadas

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRÍTICO**: Ningún caso de uso puede empezar hasta terminar esta fase.

- [ ] T007 Definir el esquema base (tablas de Diseño técnico base), la extensión `btree_gist` y la restricción de exclusión (D3) con migraciones SQL de TypeORM
- [ ] T008 [P] Crear el dominio y la persistencia de `Reservation`, `ReservationRoom`, `Guest` y `Ota` (entidades de dominio, clases de tabla TypeORM, mapeadores y repositorios)
- [ ] T009 [P] Crear `ApiError`, los errores de negocio y el filtro global de excepciones en `shared/`
- [ ] T010 [P] Crear el reloj del hotel (`America/Bogota`, día operativo 00:00–23:59) y el módulo de dinero con `decimal.js`
- [ ] T011 Implementar `ReservationStatusService` con la tabla de transiciones en el dominio y bloqueo optimista (depende de T008, T009)
- [ ] T012 [P] Implementar los puertos `Module1Port` y `Module3Port` con sus adaptadores HTTP (timeouts) y objetos de integración
- [ ] T013 Configurar RabbitMQ con `@golevelup/nestjs-rabbitmq`: exchange `hospitua.events`, colas, routing keys, reintentos y dead-letter
- [ ] T014 Crear `processed_message` y la idempotencia por `messageId` en `messaging/`
- [ ] T015 Configurar la infraestructura de pruebas (Vitest, supertest y Testcontainers de PostgreSQL y RabbitMQ)
- [ ] T016 [P] Esqueleto del frontend: enrutamiento, cliente HTTP, TanStack Query y manejo de errores de API
- [ ] T017 Lectura de las cabeceras `X-Client` y `X-User` (sin validar quién llama) y login simulado en el frontend
- [ ] T018 Configurar logs (`nestjs-pino`) y correlación de solicitudes, y ajustar lo que registra el filtro global de T009 (nivel según el tipo de error y sin la URL real)
- [ ] T019 Configurar el bloqueo asesor de PostgreSQL y el planificador (`@nestjs/schedule`, `America/Bogota`) para las tareas programadas
- [ ] T020 Configurar OpenAPI (`@nestjs/swagger`) y la verificación de dependencias entre capas en CI
- [ ] T021 [P] Implementar `ChannexPort` con su adaptador HTTP (`user-api-key`, propiedades, feed, `ack`, reporte de no-show, tipos de habitación y disponibilidad) y el manejo de `429` (pausa de un minuto por propiedad y después espera creciente)

**Checkpoint**: Base lista; los planes de caso de uso pueden implementarse.

---

## Orden recomendado de los 13 planes de caso de uso

1. **Consultas y servicios base**: `check-view-reservation`, `consult-room-inventory`,
   `consult-maintenance-calendar`, `calculate-dynamic-rate`.
2. **Disponibilidad**: `check-room-availability` (usa las tres consultas anteriores).
3. **Datos migratorios y punto de estado**: primero `process-guest-data`, y después `update-reservation`
   (modificación, Check-In, Check-Out y cierre del día; depende de disponibilidad, tarifa
   y del registro del movimiento migratorio).
4. **Creación de reservas y comisión**: `generate-direct-reservation`, `register-ota-information-commission`,
   `configure-ota` (agencia y tipos de habitación, antes que la de OTA) y `generate-ota-reservation`.
5. **Cancelación**: `cancel-reservation`.
6. **Cumplimiento legal**: `export-sire-file` (depende de `process-guest-data`).

## Dependencies & Execution Order

- **Setup (Fase 1)**: sin dependencias. **Foundational (Fase 2)**: depende de Setup y bloquea a todos
  los planes de caso de uso.
- Los planes de caso de uso dependen de este plan base y entre sí según el orden anterior.
- Dentro de cada caso de uso: dominio, servicio, adaptadores, endpoints y pruebas de integración por escenario.

## Contradicciones detectadas y decisiones tomadas

Las contradicciones entre la especificación técnica, los specs, el diccionario y los diagramas
quedaron decididas. La tabla registra cada decisión.

| # | Contradicción | Decisión |
|---|---|---|
| C1 | Los specs dicen que el Módulo 1 "envía a la API del Módulo 2" el Check-In y el Check-Out y que este "responde HTTP 200/400". La especificación técnica y el diagrama de integración los definen como **cola**, donde no hay respuesta HTTP al Módulo 1. | **DECIDIDO: solo cola.** Reglas en "Traducción de respuestas HTTP a cola". |
| C2 | El diagrama de integración muestra "Datos de huéspedes extranjeros" como **cola separada**; los specs los recibían **dentro** de la notificación de Check-In y de Check-Out. | **DECIDIDO: dentro del Check-In y del Check-Out.** Cada notificación trae la lista `guests` con todos los huéspedes de la habitación; no hay cola separada. El Módulo 2 selecciona los extranjeros por nacionalidad al exportar el SIRE. |
| C3 | (a) "Consultar estado de canales OTA" (M3 → M2) no existe en los specs; el diagrama tiene "Consultar % de comisión OTA" (M3 → M2, REST GET). (b) "Error de huésped no encontrado" (M1 → M2) no aparece en ningún spec. | **DECIDIDO (a): se adopta como "Consultar % de comisión OTA"**, REST GET; el Módulo 2 expone `GET /api/otas/{otaId}`. **DECIDIDO (b): fuera del plan** hasta que el Módulo 1 confirme su función y exista un spec. |
| C4 | "Consultar calendario de mantenimientos" no está en la especificación técnica ni en el diagrama de integración, pero sí en los specs y el diccionario. | **DECIDIDO: REST GET reactiva (M2 → M1)**, igual que el inventario. |
| C5 | El diagrama de casos de uso muestra que "Generar reservación por OTA" incluye "Calcular tarifa dinámica"; el spec y el diccionario dicen que **no** se recalcula: usa el valor bruto que envía la OTA. | **DECIDIDO: según el spec y el diccionario.** El Módulo 2 no llama al Módulo 3 en la reserva OTA, para que la comisión cuadre con lo que cobró la agencia. |
| C6 | El diccionario nombra `grossAmount` en `Reservation`; algunos specs usaban `totalAmount`. | **DECIDIDO: un solo nombre interno, `grossAmount`** (columna `gross_amount`, solo en reservas OTA: las directas guardan la tarifa por habitación, D2). `totalAmount` queda solo como nombre del campo en el JSON que envía la OTA. |
| C7 | Fórmula de comisión sin `/100`, con validación 0–100%. | **DECIDIDO: porcentaje de 0 a 100 y se divide entre 100.** `commissionAmount = grossAmount × commissionPercentage / 100`, con `decimal.js`, 2 decimales y redondeo `ROUND_HALF_UP`; el valor queda positivo en el Módulo 2 (el signo lo aplica el Módulo 3). |
| C10 | Las tareas programadas no tienen mecanismo definido y con varias instancias podrían ejecutarse dos veces. | **DECIDIDO: `@nestjs/schedule` con bloqueo asesor de PostgreSQL** (`pg_try_advisory_lock`, consulta nativa). Si otra instancia tiene el bloqueo, se salta esa ejecución. El día operativo es fijo (00:00–23:59, Colombia). La idempotencia que piden los specs sigue siendo la garantía principal. |
| C11 | El plan estaba escrito para Java y Spring Boot. | **DECIDIDO: NestJS, TypeScript, TypeORM, `@golevelup/nestjs-rabbitmq`, pnpm y arquitectura hexagonal.** Se eliminó el proyecto Spring/Gradle del repositorio. |

## Notes

- `[P]` marca tareas paralelizables; `[US1]` (en los planes de caso de uso) las liga a su historia de usuario.
- Cada plan de caso de uso debe indicar en su encabezado: `Plan base: ../base/plan.md`.
- Cómo escribir el plan de cada caso de uso: [guia-planes-por-caso-de-uso.md](guia-planes-por-caso-de-uso.md).
- No se programa un caso de uso hasta que su SPEC esté validado y su PLAN revisado.
- Commit por tarea o grupo lógico, con Gitflow.
