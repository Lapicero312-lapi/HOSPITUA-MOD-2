# Implementation Plan: Registrar confirmación y comisión de OTA (`register-ota-information-commission`)

**Plan base**: [../base/plan.md](../base/plan.md)
**Spec**: [./spec.md](spec.md)
**Guía**: [../base/guia-planes-por-caso-de-uso.md](../base/guia-planes-por-caso-de-uso.md)

## Summary

Cada reserva de una OTA trae una obligación con la agencia: una comisión pactada sobre el valor bruto de
la estadía. Este caso de uso hace cuatro cosas:

1. **Calcula y registra la comisión** de cada reserva OTA nueva, al registrarla
   (`generate-ota-reservation` lo llama): `commissionAmount = grossAmount × commissionPercentage / 100`,
   con precisión decimal exacta, y estado inicial `CALCULATED`. La **recalcula** con el mismo porcentaje
   congelado cuando Booking cambia el valor de la reserva. Nunca calcula con un porcentaje fuera de 0 a
   100.
2. **Concilia comisiones con el Módulo 3** (finanzas): el Módulo 3 consulta las comisiones de un periodo y
   le indica al Módulo 2 cuáles pasan a `RECONCILED` o `PAID`. La Recepcionista no concilia.
3. **Consulta de agencias** (solo lectura): `GET /api/otas` y `GET /api/otas/{otaId}` para la pantalla de
   agencias de la Recepcionista y para el Módulo 3.
4. **Registro y estado de la agencia**: `ManageOta` registra o actualiza la agencia Booking.com cuando la
   configura `configure-ota`, y `OtaConnectionTracker` lleva el `connectionStatus` y el `lastSyncAt` a
   partir de las lecturas del feed de Channex (`generate-ota-reservation`). No hay rutas para la OTA.

La comisión de una reserva **cancelada por Booking o en `NO_SHOW` no se toca ni se concilia** (FR-007):
Booking no la cobra (el no-show se le reporta por Channex desde `generate-ota-reservation`).

## Resumen técnico e identificación

| Dato | Valor |
|---|---|
| Caso de uso | Registrar confirmación y comisión de OTA (`register-ota-information-commission`) |
| Spec | [spec.md](./spec.md), historias 1 a 3 y FR-001 a FR-010 |
| Actores | `generate-ota-reservation` (calcula la comisión); Módulo 3 (concilia y consulta); Recepcionista (consulta agencias); `configure-ota` (registro de la agencia); `generate-ota-reservation` (estado de la conexión) |
| Naturaleza | Escribe `reservation` (campos de comisión), `ota` y `commission_audit`; lee para las consultas |

| # | Capacidad | Disparador | Actor | Contrato |
|---|---|---|---|---|
| 1 | Calcular la comisión de una reserva nueva | Llamada interna (puerto de entrada) | `generate-ota-reservation` | B1 |
| 2 | Consultar comisiones de un periodo | REST `GET /api/ota-commissions` | Módulo 3 | A1 |
| 3 | Conciliar comisiones | REST `POST /api/ota-commissions/reconciliations` | Módulo 3 | A2 |
| 4 | Consultar agencias | REST `GET /api/otas` y `GET /api/otas/{otaId}` | Recepcionista y Módulo 3 | A3 |
| 5 | Registrar o actualizar la agencia | Llamada interna `ManageOta` | `configure-ota` | B2 |
| 6 | Estado de la conexión y última sincronización | Llamada interna `OtaConnectionTracker` | `generate-ota-reservation` y `configure-ota` | B3 |

## Technical Context

El stack, la arquitectura hexagonal y el manejo de errores son los del [plan base](../base/plan.md).
Lo propio de este caso de uso:

- **Dependencias nuevas**: ninguna. El dinero y los porcentajes usan `decimal.js` (plan base).
- **Almacenamiento**: `ota`, `reservation` (campos de comisión) y `commission_audit` (plan base).
- **Configuración**: `RECONCILIATION_MAX_ITEMS` (por defecto `500`).
- **Performance**: cálculo y registro de la comisión en menos de 1 s (NFR-001, SC-005).

## Contratos

### A. REST del Módulo 2

Las usan la Recepcionista y el Módulo 3. **Cabeceras**: `Content-Type: application/json`. Sin seguridad
(regla transversal 10 del plan base): cada ruta la usa un llamador distinto, así que no necesita
`X-Client`. La OTA no llama al Módulo 2.

**A1. `GET /api/ota-commissions`** (la usa el Módulo 3): comisiones de las reservas OTA de un periodo.

| Parámetro | Tipo | Obligatorio | Regla |
|---|---|---|---|
| `dateFrom`, `dateTo` | `AAAA-MM-DD` | Sí, ambos | Rango inclusivo sobre la **`endDate`** de la reserva; máximo 366 días |
| `commissionStatus` | `CALCULATED` \| `RECONCILED` \| `PAID` | No | Sin valor: todos |
| `reservationStatus` | `ReservationStatus` | No | Por ejemplo `COMPLETED` |
| `otaId` | id | No | Una agencia |
| `page` | entero ≥ 1 | No | Por defecto `1`; tamaño fijo de 100 |

**Respuesta 200**

```json
{
  "items": [
    {
      "reservationRef": "RSV-8D02E5A4",
      "otaId": "uuid",
      "otaName": "Booking.com",
      "externalConfirmationCode": "4417829013",
      "status": "COMPLETED",
      "startDate": "2026-10-10",
      "endDate": "2026-10-12",
      "grossAmount": { "amount": "400.00", "currency": "USD" },
      "commissionPercentage": 15.00,
      "commissionAmount": { "amount": "60.00", "currency": "USD" },
      "commissionStatus": "CALCULATED"
    }
  ],
  "page": 1,
  "pageSize": 100,
  "totalItems": 1,
  "totalPages": 1
}
```

- Solo reservas de canal `OTA`. Sin resultados: `200` con `items: []`.
- Los importes van como **texto decimal**, en la moneda de la reserva (`USD` en las de Booking); los
  porcentajes, como **número** JSON de 0 a 100 con hasta dos decimales (igual que
  `otaCommissionPercentage` en la consulta para liquidar de `check-view-reservation`).

**A2. `POST /api/ota-commissions/reconciliations`** (la usa el Módulo 3): el Módulo 3 le indica al Módulo 2 qué
comisiones pasan a `RECONCILED` o `PAID`.

```json
{
  "action": "RECONCILED",
  "items": [
    {
      "reservationRef": "RSV-8D02E5A4",
      "grossAmount": "400.00",
      "commissionAmount": "60.00"
    }
  ]
}
```

- `action`: `RECONCILED` o `PAID`.
- `items`: entre 1 y `RECONCILIATION_MAX_ITEMS`. Cada uno trae la referencia y los importes que el
  Módulo 3 concilió. **El Módulo 2 confirma la coincidencia de montos** con los guardados antes de cambiar
  el estado.

**Respuesta 200** (cada ítem se procesa por separado):

```json
{
  "action": "RECONCILED",
  "results": [
    { "reservationRef": "RSV-8D02E5A4", "result": "APPLIED", "commissionStatus": "RECONCILED", "reason": null },
    { "reservationRef": "RSV-1A2B3C4D", "result": "REJECTED", "commissionStatus": "CALCULATED", "reason": "AMOUNT_MISMATCH" }
  ],
  "summary": { "applied": 1, "alreadyApplied": 0, "rejected": 1 }
}
```

`result` es `APPLIED`, `ALREADY_APPLIED` (la comisión ya estaba en ese estado: reenvío idempotente) o
`REJECTED` con su `reason`:

| `reason` | Cuándo |
|---|---|
| `RESERVATION_NOT_FOUND` | La referencia no existe |
| `NOT_OTA_RESERVATION` | La reserva es de canal directo |
| `RESERVATION_CANCELLED` | La reserva está `CANCELLED`: su comisión no se toca (FR-007) |
| `RESERVATION_NO_SHOW` | La reserva está `NO_SHOW`: su comisión no se toca (FR-007) |
| `RESERVATION_NOT_COMPLETED` | La reserva no está `COMPLETED` (solo se concilian las que finalizaron su estadía) |
| `AMOUNT_MISMATCH` | El `grossAmount` o el `commissionAmount` enviados no coinciden con los guardados |
| `INVALID_TRANSITION` | La transición de `commissionStatus` no está permitida |

**Transiciones de `commissionStatus` permitidas**: `CALCULATED → RECONCILED`, `CALCULATED → PAID` y
`RECONCILED → PAID`.

**Errores 400 de la solicitud completa** (no se procesa ningún ítem):

| `errorCode` | Cuándo | `message` |
|---|---|---|
| `INVALID_RECONCILIATION_REQUEST` | Cuerpo vacío, `items` vacío o con más de `RECONCILIATION_MAX_ITEMS` | "La solicitud de conciliación no es válida." |
| `INVALID_RECONCILIATION_ACTION` | `action` distinta de `RECONCILED` o `PAID` | "La acción de conciliación no es válida." |
| `INVALID_AMOUNT` | Importe con formato inválido o negativo | "El importe no es válido." |
| `INVALID_RESERVATION_CODE` | `reservationRef` con formato inválido | "Debe proveer un código de reserva válido para la consulta." |

**Errores de A1** (`400`): `INVALID_DATE` ("La fecha indicada no es válida."), `INCOMPLETE_DATE_RANGE`
("Debe completar ambas fechas del rango."), `INVALID_DATE_RANGE` ("La fecha inicial no puede ser posterior a
la fecha final."), `DATE_RANGE_TOO_LARGE` ("El rango de fechas no puede superar 366 días."),
`INVALID_COMMISSION_STATUS` ("El estado de la comisión no es válido.") e `INVALID_STATUS` ("El estado
indicado no es válido.").

**A3. Consulta de agencias** (solo lectura): `GET /api/otas` y `GET /api/otas/{otaId}`, para la Recepcionista
y el Módulo 3, con la misma respuesta para los dos.

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Booking.com",
      "hotelAccountId": "10485037",
      "commissionPercentage": 15.00,
      "connectionStatus": "CONNECTED",
      "linkedAt": "2026-03-02T09:14:00-05:00",
      "lastSyncAt": "2026-10-09T07:58:00-05:00",
      "activeReservations": 3
    }
  ],
  "total": 1
}
```

- `GET /api/otas/{otaId}` devuelve un solo objeto con esos mismos campos.
- `activeReservations`: reservas de esa agencia en `PENDING`, `ACTIVE` o `IN_PROGRESS`.
- Una `Ota` desconectada **sigue apareciendo**, con `connectionStatus: DISCONNECTED`.
- No hay rutas de alta, edición ni borrado para la Recepcionista (plan base): solo lectura.
- Agencia inexistente: `400` `OTA_NOT_FOUND`, "La agencia no existe." (regla del plan base: los recursos
  inexistentes son 400).

### B. Puertos de entrada internos

**B1. Calcular la comisión de una reserva nueva** (`RegisterOtaConfirmationAndCommission`, lo usa
`generate-ota-reservation` dentro de su transacción):

```typescript
interface CommissionInput {
  otaId: string;
  grossAmount: Money;                  // valor bruto de toda la reserva, recibido de la OTA
  externalConfirmationCode: string;
}

interface CommissionResult {
  otaId: string;
  commissionPercentage: string;        // el de la agencia en este momento, de 0 a 100
  commissionAmount: Money;             // grossAmount × commissionPercentage / 100, 2 decimales, ROUND_HALF_UP
  commissionStatus: 'CALCULATED';
}

interface RegisterOtaConfirmationAndCommission {
  calculate(input: CommissionInput): Promise<CommissionResult>;
  // Booking cambió el valor: mismo porcentaje congelado de la reserva, importe nuevo
  recalculate(reservation: Reservation, grossAmount: Money): CommissionResult;
  recordAudit(tx: Transaction, reservationId: string, result: CommissionResult, performedBy: string): Promise<void>;
}
```

- `calculate` **no persiste**: valida y calcula. La reserva con sus campos de comisión la inserta quien
  llama en su transacción, y luego llama a `recordAudit`.
- **Validaciones** (en este orden): la `Ota` existe; su `commissionPercentage` está entre 0 y 100; el
  `externalConfirmationCode` no está ya registrado para esa `Ota` (FR-005; `generate-ota-reservation` ya
  trata un código repetido como un cambio, así que este error solo protege contra un uso indebido).
- `recalculate` tampoco persiste: quien llama (`ApplyOtaChange`) guarda los importes nuevos y llama a
  `recordAudit`, que deja la fila `CALCULATED` con ellos.
- La reserva guarda **su propia copia** del porcentaje y del importe: un cambio posterior del porcentaje de
  la agencia **no afecta** a las reservas ya registradas.

**B2. Registrar o actualizar la agencia** (`ManageOta`, lo usa `configure-ota` al iniciar):

```typescript
interface OtaRegistration { name: string; hotelAccountId: string; commissionPercentage: string }

interface ManageOta {
  register(data: OtaRegistration, at: Date): Promise<Ota>;                 // nace CONNECTED, linkedAt = lastSyncAt = at
  update(otaId: string, data: Partial<OtaRegistration>, at: Date): Promise<Ota>;
}
```

- **Validaciones** (`400`, indicando los campos inválidos): `name` o `hotelAccountId` vacíos,
  `commissionPercentage` fuera de 0 a 100, o `name` ya usado por otra `Ota`.
- Una `Ota` **nace en `CONNECTED`**, con `linkedAt` y `lastSyncAt` iguales a la hora del registro (`at`).
  Registrarla de nuevo al reiniciar **no crea** una `Ota` nueva ni cambia `linkedAt`.
- Un nuevo `commissionPercentage` **aplica solo a las reservas futuras**.
- La `Ota` **nunca se borra**: si Channex rechaza la conexión pasa a `DISCONNECTED`, y sus reservas no
  cambian (`status`, `commissionAmount` y `commissionStatus` se conservan).

**B3. Estado de la conexión** (`OtaConnectionTracker`):

```typescript
interface OtaConnectionTracker {
  markSynced(otaId: string, at: Date): Promise<void>;        // lectura del feed que terminó bien: lastSyncAt y, si estaba DISCONNECTED, CONNECTED
  markDisconnected(otaId: string, at: Date): Promise<void>;  // Channex respondió 401 o 403
}
```

- Lo llaman `generate-ota-reservation` (cada lectura del feed) y `configure-ota` (si Channex rechaza un
  envío de tipos de habitación o de disponibilidad). Volver a `CONNECTED` no cambia `linkedAt`.

**Errores de B2** (los registra `configure-ota` en el log al iniciar, con los campos inválidos):

| `errorCode` | Cuándo | `message` |
|---|---|---|
| `INVALID_OTA_DATA` | `name` o `hotelAccountId` vacío, o porcentaje fuera de 0 a 100 | "Datos de la agencia inválidos: {campos}." |
| `OTA_NAME_ALREADY_EXISTS` | El `name` coincide con el de otra `Ota` | "Ya existe una agencia con ese nombre." |
| `OTA_ACCOUNT_ALREADY_EXISTS` | El `hotelAccountId` ya está registrado | "Ya existe una agencia con esa cuenta del hotel." |

**Errores de B1** (los registra `generate-ota-reservation` en el log):

| `errorCode` | Cuándo | `message` |
|---|---|---|
| `INVALID_COMMISSION_PERCENTAGE` | El porcentaje de la agencia es menor que 0 o mayor que 100 | "El porcentaje de comisión no es válido." |
| `DUPLICATE_CONFIRMATION_CODE` | El `externalConfirmationCode` ya existe para esa `Ota` | "El código de confirmación ya está registrado para esta agencia." |
| `OTA_NOT_FOUND` | La `Ota` no existe | "La agencia no existe." |

## Reglas de negocio

1. **Fórmula**: `commissionAmount = grossAmount × commissionPercentage / 100`, con `decimal.js`, **dos
   decimales y redondeo `ROUND_HALF_UP`**; el valor queda positivo (el signo lo aplica el Módulo 3).
   Se calcula **una sola vez por reserva**, sobre el `grossAmount` completo, no por habitación.
   Ejemplo: `400 × 15 / 100 = 60.00`.
2. **Estado inicial** `CALCULATED`, desde el momento del registro de la reserva.
3. **Conciliación**: solo reservas OTA en `COMPLETED`, solo con los montos que coinciden, y con las
   transiciones permitidas. Cada cambio deja un registro en `commission_audit`.
4. **Reservas canceladas**: la cancelación por la OTA solo cambia `Reservation.status` a `CANCELLED`; este
   caso de uso **nunca** modifica `commissionAmount` ni `commissionStatus` por eso, y una conciliación las
   rechaza con `RESERVATION_CANCELLED`.
5. **Duplicados**: un `externalConfirmationCode` repetido para la misma `Ota` se rechaza antes de crear
   la reserva y no genera una comisión duplicada; la restricción única `(ota_id,
   external_confirmation_code)` es el respaldo ante solicitudes simultáneas.
6. **Auditoría** (FR-010): cada comisión calculada o conciliada deja una fila **inmutable** en
   `commission_audit` con la acción, el estado anterior, los importes, el canal (`OTA_API` para el cálculo
   y `MODULE3` para la conciliación), quién la hizo (`performed_by`: `Booking.com` en el cálculo y
   `MODULE3` en la conciliación) y cuándo.
7. **Concurrencia**: dos actualizaciones de la misma reserva se procesan en secuencia con
   `SELECT … FOR UPDATE` de la reserva, de modo que el `commissionStatus` final refleje la versión más
   reciente.

## Diagramas de secuencia

### D1. Cálculo de la comisión al registrar una reserva OTA (historia 1)

```mermaid
sequenceDiagram
    participant G as generate-ota-reservation
    participant C as RegisterOtaConfirmationAndCommission
    participant R as OtaRepository
    participant DB as PostgreSQL

    G->>C: calculate(otaId, grossAmount, externalConfirmationCode)
    C->>R: findById(otaId)
    alt la agencia no existe
        C-->>G: BusinessError OTA_NOT_FOUND (400)
    end
    C->>C: ¿porcentaje entre 0 y 100?
    alt porcentaje inválido
        C-->>G: BusinessError INVALID_COMMISSION_PERCENTAGE (400), no se persiste la reserva
    end
    C->>DB: ¿existe (otaId, externalConfirmationCode)?
    alt duplicado
        C-->>G: BusinessError DUPLICATE_CONFIRMATION_CODE (400), sin comisión duplicada
    end
    C->>C: commissionAmount = grossAmount x porcentaje / 100 (decimal.js, 2 decimales)
    C-->>G: CommissionResult (CALCULATED)
    G->>DB: INSERT reservation con la comisión (en su transacción)
    G->>C: recordAudit(tx, reservationId, result, performedBy)
    C->>DB: INSERT commission_audit (CALCULATED)
```

### D2. Conciliación del Módulo 3 (historia 2)

```mermaid
sequenceDiagram
    participant M3 as Módulo 3
    participant K as ReconciliationsController
    participant U as ReconcileCommissions
    participant DB as PostgreSQL

    M3->>K: POST /api/ota-commissions/reconciliations
    K->>K: Validar el cuerpo
    alt solicitud inválida
        K-->>M3: 400 sin procesar ningún ítem
    end
    K->>U: execute(action, items)
    loop por cada ítem (una transacción cada uno)
        U->>DB: BEGIN y SELECT reserva por referencia FOR UPDATE
        alt no existe, es directa, está cancelada o no está COMPLETED
            U->>DB: ROLLBACK
            Note over U: Resultado REJECTED con su motivo (la comisión no se toca)
        else los montos no coinciden
            U->>DB: ROLLBACK
            Note over U: Resultado REJECTED con AMOUNT_MISMATCH
        else ya estaba en ese estado
            U->>DB: COMMIT sin cambios
            Note over U: Resultado ALREADY_APPLIED
        else
            U->>DB: UPDATE commission_status e INSERT commission_audit (canal MODULE3)
            U->>DB: COMMIT
            Note over U: Resultado APPLIED
        end
    end
    U-->>K: resultados y resumen
    K-->>M3: 200
```

### D3. Consulta de comisiones y de agencias

```mermaid
sequenceDiagram
    participant X as Módulo 3 o Recepcionista
    participant C as Controller
    participant U as Caso de uso de consulta
    participant DB as PostgreSQL

    X->>C: GET /api/ota-commissions (Módulo 3) o GET /api/otas (Recepcionista o Módulo 3)
    C->>C: Validar parámetros
    alt parámetro inválido
        C-->>X: 400 con el mensaje correspondiente
    end
    C->>U: execute(filtros)
    U->>DB: consulta de solo lectura (con el conteo de reservas activas en el caso de agencias)
    U-->>C: resultado
    C-->>X: 200
```

### D4. Registro y conexión de una OTA (servicios internos, historia 3)

```mermaid
sequenceDiagram
    participant X as EnsureChannexSetup (configure-ota)
    participant M as ManageOta
    participant DB as PostgreSQL

    X->>M: register / update
    M->>M: Validar nombre, cuenta del hotel y porcentaje (0 a 100)
    alt datos ausentes o inválidos, o nombre repetido
        M-->>X: BusinessError con los campos inválidos (400)
    end
    M->>DB: INSERT o UPDATE ota (nace CONNECTED; linkedAt no cambia al reconectar)
    M->>DB: linked_at y last_sync_at = hora del registro (solo al crearla)
    M-->>X: Ota
    Note over M,DB: La Ota nunca se borra; reiniciar no la duplica
```

## Modelo de datos y entidades involucradas

**No se crean tablas.** Se usan las del plan base:

| Tabla | Qué cambia este caso de uso |
|---|---|
| `ota` | `name`, `hotel_account_id`, `commission_percentage`, `connection_status`, `linked_at`, `last_sync_at` (únicos `name` y `hotel_account_id`) |
| `reservation` | Campos de comisión de las reservas OTA: `gross_amount`, `currency`, `commission_percentage`, `commission_amount`, `commission_status`, `external_confirmation_code` (los inserta `generate-ota-reservation`; la conciliación actualiza `commission_status`) |
| `commission_audit` | Una fila inmutable por cada comisión calculada o conciliada |

- `commission_percentage` es `numeric(5,2)` de 0 a 100 y los importes `numeric(14,2)`: la exactitud
  decimal (NFR-002) la dan `decimal.js` y las columnas `numeric`, nunca `number`.
- La restricción única `(ota_id, external_confirmation_code)` respalda FR-005.
- Las restricciones `CHECK` del canal `OTA` del plan base obligan a que la reserva OTA lleve
  `gross_amount`, `currency`, `commission_status` y el código.
- Índices que usa la consulta de comisiones: `(status, start_date)` y `(end_date)` de `reservation`, y
  `(ota_id)`.

**Estados de `commissionStatus`**:

```text
CALCULATED --conciliación--> RECONCILED --pago--> PAID
CALCULATED --pago----------> PAID
(CANCELLED o NO_SHOW: la comisión no cambia ni se concilia)
```

**`connectionStatus` de la `Ota`**: `CONNECTED` (nace así) ⇄ `DISCONNECTED`, solo por las respuestas de Channex (`OtaConnectionTracker`).

## Reglas de validación y manejo de errores

Todo error REST sale con `{ "errorCode", "message", "timestamp", "path" }` y **siempre 4xx**; nunca 500.

| Situación | HTTP | `errorCode` |
|---|---|---|
| Errores de las tablas de A1, A2, A3, B1 y B2 | 400 | Los de cada tabla |
| Excepción inesperada o fallo de integración | 400 | `REQUEST_NOT_PROCESSED` |

- **Un porcentaje inválido o un código duplicado impiden crear la reserva**: el error se lanza antes de
  insertar, y la transacción de `generate-ota-reservation` no se confirma.
- **La conciliación procesa cada ítem por separado**: el rechazo de uno no impide el resto, y el resultado
  de cada ítem va en la respuesta (no es un error HTTP).
- La conciliación **repetida** no cambia nada y devuelve `ALREADY_APPLIED`.
- Los fallos de infraestructura se informan sin detalles.

## Integraciones externas

| Módulo | Dirección | Mecanismo | Contrato | Fallo |
|---|---|---|---|---|
| Módulo 3 | M3 → M2 | REST `GET /api/ota-commissions` y `POST /api/ota-commissions/reconciliations` | A1 y A2 | Errores 4xx controlados; el Módulo 2 no llama al Módulo 3 en este caso de uso |
| Módulo 3 | M3 → M2 | REST `GET /api/otas` y `GET /api/otas/{otaId}` ("Consultar % de comisión OTA") | A3 | Idem |
| Channex | A través de `generate-ota-reservation` y `configure-ota` | Las lecturas del feed y las respuestas de Channex actualizan `lastSyncAt` y `connectionStatus` | B3 | Idem |

- Este caso de uso **no llama a ningún módulo** de forma síncrona y **no usa colas**.
- **Sin autenticación**: la seguridad es una capa aparte (regla transversal 10 del plan base).

## Arquitectura (capas del plan base)

| Capa | Piezas de este caso de uso |
|---|---|
| `domain/ota/` | `Ota`, regla de comisión (`calculateCommission`), transiciones de `commissionStatus` y de `connectionStatus` |
| `application/use-cases/register-ota-information-commission/` | **Entrada**: `RegisterOtaConfirmationAndCommission`, `ReconcileCommissions`, `ListOtaCommissions`, `ListOtas`, `GetOta`, `ManageOta`, `OtaConnectionTracker` |
| `application/ports/out/` | `OtaRepository`, `CommissionAuditRepository`, `Clock` |
| `infrastructure/in/rest/` | `OtaCommissionsController` y `OtasController` |
| `infrastructure/out/persistence/` | Repositorios y las consultas de A1 y A3 |

```text
backend/src/
├── domain/ota/
│   ├── ota.ts
│   ├── commission.ts                    # fórmula con decimal.js y transiciones de commissionStatus
│   └── connection-status.ts
├── application/use-cases/register-ota-information-commission/
│   ├── ports/in/
│   ├── register-ota-confirmation-and-commission.service.ts
│   ├── reconcile-commissions.service.ts
│   ├── list-ota-commissions.service.ts
│   ├── list-otas.service.ts
│   ├── get-ota.service.ts
│   ├── manage-ota.service.ts
│   └── ota-connection-tracker.service.ts
├── infrastructure/in/rest/
│   ├── ota-commissions.controller.ts
│   └── otas.controller.ts
└── infrastructure/out/persistence/
    ├── ota.repository.ts
    └── commission-audit.repository.ts
backend/test/
├── unit/                                        # espejo de src/: fórmula, redondeo, transiciones, validaciones
├── integration/register-ota-information-commission/ # Testcontainers: cálculo, conciliación, consulta
└── contract/                                       # forma de A1, A2 y A3
frontend/src/pages/otas/                            # pantalla "Agencias OTA" (solo lectura)
```

## Phase 1: Setup

- [ ] T001 Variable `RECONCILIATION_MAX_ITEMS` en la configuración validada

## Phase 2: Foundational

- [ ] T002 [P] Entidad `Ota` y funciones de dominio `calculateCommission` (decimal.js, 2 decimales, `ROUND_HALF_UP`), con pruebas de exactitud (por ejemplo `400 × 15 / 100 = 60.00`, redondeos en `.005`)
- [ ] T003 [P] Transiciones de `commissionStatus` y de `connectionStatus` en el dominio
- [ ] T004 `OtaRepository` y `CommissionAuditRepository`
- [ ] T005 Códigos de error y mensajes de las tablas de A1, A2, A3, B1 y B2

## Phase 3: User Story 1 - Cálculo y registro de la comisión (P1)

**Goal**: toda reserva OTA nueva queda con su comisión exacta y `CALCULATED`.
**Independent Test**: `grossAmount` de 400 y 15 % dan 60 y `CALCULATED`; un porcentaje inválido se rechaza.

- [ ] T006 [US1] `RegisterOtaConfirmationAndCommission.calculate`: agencia, porcentaje de 0 a 100, código duplicado y fórmula
- [ ] T007 [US1] `recordAudit` y la inserción de `commission_audit` dentro de la transacción de quien llama
- [ ] T008 [US1] Prueba de que la comisión se calcula una sola vez sobre el total completo y de que un cambio posterior del porcentaje de la agencia no afecta a las reservas existentes
- [ ] T009 [US1] Pruebas de integración de los escenarios 1 y 2 y de los casos borde (duplicado y simultaneidad)
- [ ] T010 [US1] Coordinar con el plan de `generate-ota-reservation` la llamada dentro de su transacción

## Phase 4: User Story 2 - Conciliación con el Módulo 3 (P2)

- [ ] T011 [US2] `ListOtaCommissions` y `GET /api/ota-commissions` (A1) con sus filtros y validaciones
- [ ] T012 [US2] `ReconcileCommissions` y `POST /api/ota-commissions/reconciliations` (A2): una transacción por ítem, comprobación de montos y resultados por ítem
- [ ] T013 [US2] Rechazo de reservas `CANCELLED`, no `COMPLETED`, directas o inexistentes, e idempotencia (`ALREADY_APPLIED`)
- [ ] T014 [US2] Pruebas de integración de los escenarios 1 y 2, incluida la conservación de la comisión de una reserva cancelada por Booking

## Phase 5: User Story 3 - Registro y estado de la OTA (P3)

- [ ] T015 [US3] `ManageOta` (`register`, `update`) con las validaciones y los códigos de error
- [ ] T016 [US3] `OtaConnectionTracker` (`markSynced`, `markDisconnected`)
- [ ] T017 [US3] `ListOtas`, `GetOta` y `GET /api/otas` y `/{otaId}` (A3) con `activeReservations`
- [ ] T018 [US3] Pruebas de los escenarios 1 a 5 y de los casos borde (nace `CONNECTED`, rechazo de Channex y recuperación, porcentaje nuevo solo para reservas futuras)
- [ ] T019 [P] [US3] Frontend: pantalla "Agencias OTA" (solo lectura)

## Phase N: Polish

- [ ] T020 Prueba de tiempo: cálculo y registro de la comisión en menos de 1 s (NFR-001)
- [ ] T021 Documentar A1, A2 y A3 en OpenAPI (`@nestjs/swagger`)

## Pruebas por escenario

| Historia | Escenario | Qué se verifica |
|---|---|---|
| US1 | 1 registro exitoso | `grossAmount` 400 y 15 %: `commissionAmount` 60.00, `commissionStatus` `CALCULATED`, fila en `commission_audit` |
| US1 | 2 porcentaje inválido | Menor que 0 o mayor que 100: `400` `INVALID_COMMISSION_PERCENTAGE` y la reserva no se persiste |
| US2 | 1 conciliación | Reservas `COMPLETED` y `CALCULATED` pasan a `RECONCILED` cuando los montos coinciden; queda auditoría con el canal `MODULE3` |
| US2 | 2 cancelada por Booking | Su `commissionAmount` y `commissionStatus` no cambian, ni al cancelar ni al conciliar (`RESERVATION_CANCELLED`) |
| US2 | 3 en `NO_SHOW` | La conciliación la rechaza (`RESERVATION_NO_SHOW`) y la comisión no cambia |
| US3 | 1 registro por configuración | Una `Ota` "Booking.com" nace `CONNECTED` con `linkedAt`, sin duplicarse al reiniciar |
| US3 | 2 cambio del porcentaje | El nuevo porcentaje se guarda y solo aplica a reservas futuras |
| US3 | 3 Channex rechaza la conexión | `DISCONNECTED`; la `Ota` y sus reservas se conservan y sigue visible en la pantalla |
| US3 | 4 conexión recuperada | `CONNECTED`, sin `Ota` nueva ni cambio de `linkedAt` |
| US3 | 5 `lastSyncAt` | Cada lectura del feed que termina bien lo actualiza |
| Casos borde | Código duplicado | Mismo `externalConfirmationCode` para la misma `Ota`: `400` y sin comisión duplicada; mismo código en otra `Ota`: se acepta |
| Casos borde | Simultaneidad | Dos solicitudes con el mismo código a la vez: una se crea y la otra falla por la restricción única |
| Casos borde | Dos actualizaciones de la misma reserva | Se procesan en secuencia con el bloqueo de fila |
| FR-006 | Conciliación repetida | `ALREADY_APPLIED` sin cambios |
| NFR-002 | Exactitud decimal | Una batería de importes con redondeo exacto; nunca `number`. Datos de `calculateCommission` (`grossAmount` en `COP` × porcentaje / 100): `400.00` × `15` = `60.00` (ejemplo de la regla 1); `100.30` × `15` = `15.045` → `15.05`; `0.10` × `15` = `0.015` → `0.02` (con `number`, los dos casos de `.005` darían `15.04` y `0.01`); `333.33` × `15` = `49.9995` → `50.00`; `100.10` × `14.95` = `14.96495` → `14.96` (se redondea una sola vez: redondear antes a tres decimales daría `14.97`); `1000.00` × `0` = `0.00`; `250000.00` × `100` = `250000.00`. La comisión queda en la moneda del `grossAmount` |
| NFR-001 | Tiempo | El cálculo en menos de 1 s |
| Contrato | REST | Forma exacta de A1, A2 y A3 |

## Dependencies & Execution Order

- **Depende de**: el plan base (tablas `ota`, `reservation` y `commission_audit`, `decimal.js`).
- **Necesitan de este caso de uso**: `generate-ota-reservation` (calcula la comisión al registrar la
  reserva) y `cancel-reservation` (no debe tocar la comisión de una reserva OTA).
- **Orden**: T001–T005 → US1 (T006–T010) → US2 (T011–T014) → US3 (T015–T019) → Polish. Va **antes de
  `generate-ota-reservation`**.

## Trazabilidad: requisito → componente → tarea

| Requisito | Componente | Tarea |
|---|---|---|
| FR-001 | `calculateCommission` | T002, T006 |
| FR-002 | Lectura del porcentaje de la `Ota` | T006 |
| FR-003 | Estado inicial `CALCULATED` | T006 |
| FR-004 | Validación del porcentaje de 0 a 100 | T006, T009 |
| FR-005 | Código duplicado y restricción única | T006, T009 |
| FR-006 | `ReconcileCommissions` (A2) | T012, T013 |
| FR-007 | Rechazo de reservas canceladas | T013, T014 |
| FR-008, FR-008a | `ManageOta`, `OtaConnectionTracker` y las consultas de agencias | T015–T017 |
| FR-009 | Mapeo a 400 | T005 |
| FR-010 | `commission_audit` | T007, T012 |
| NFR-001 | Prueba de tiempo | T020 |
| NFR-002 | `decimal.js` y columnas `numeric` | T002 |
| SC-001 a SC-005 | Pruebas por escenario | T009, T014, T018 |

## Puntos que este plan propone (el spec no los dice)

1. **Dos rutas nuevas para el Módulo 3**: `GET /api/ota-commissions` (el spec dice que el Módulo 2 "pone a
   su disposición esos datos", sin ruta) y el cuerpo de `POST /api/ota-commissions/reconciliations`.
2. **El periodo** de la consulta de comisiones se filtra por la **`endDate`** de la reserva (el cierre de
   su estadía).
3. **La conciliación procesa cada ítem por separado** y devuelve el resultado de cada uno; un ítem
   rechazado no impide los demás.
4. **Comprobación de montos**: el Módulo 3 envía el `grossAmount` y el `commissionAmount` que concilió y el
   Módulo 2 los compara con los guardados.
5. **Transiciones permitidas**: `CALCULATED → RECONCILED`, `CALCULATED → PAID` y `RECONCILED → PAID`.
6. **Solo se concilian reservas `COMPLETED`.**
7. **La reserva guarda su propio porcentaje y su importe**, así que un cambio posterior del porcentaje de
   la agencia no cambia lo ya registrado.
8. **`GET /api/otas` devuelve más campos que el plan base** (`hotelAccountId`, `linkedAt`, `lastSyncAt` y
   `activeReservations`), porque la pantalla de agencias los muestra.
9. **La comisión se recalcula** con el porcentaje congelado cuando Booking cambia el valor (`recalculate`).

## Puntos abiertos

| # | Pendiente | Con quién |
|---|---|---|
| 1 | Estructura exacta de la conciliación que enviará el Módulo 3 (periodo, identificador del cierre, montos) y de la consulta de comisiones | Módulo 3 |

## Notes

- `[P]` marca tareas paralelizables; `[US1]`, `[US2]` y `[US3]` las ligan a su historia de usuario.
- Commit por tarea o grupo lógico, con Gitflow.
- Este plan no modifica el spec ni el plan base.
