# Implementation Plan: Calcular Tarifa Dinámica

**Date**: 2026-09-26  
**Spec**: [spec.md](./spec.md)  
**Plan base**: [../base/plan.md](../base/plan.md)  

## Summary

El Módulo 2 consume el servicio de precios del Módulo 3 (REST POST con cuerpo JSON, reactiva) para obtener
una `RateQuote` y guardar su `grossAmount` como valor **informativo** de la reserva. No calcula
precios, impuestos ni comisiones. Es un servicio interno (`RateQuoteService`) con el cliente
`Module3Client`, usado por `generate-direct-reservation` (cotización nueva) y `update-reservation`
(recotización con `previousGrossAmount`). Ante cualquier falla del Módulo 3 no se asume ninguna tarifa.

## Technical Context

Hereda todo de `../base/plan.md`. Solo lo específico de esta feature:

- **Storage**: ninguno propio; el `grossAmount` se guarda en `reservation.gross_amount` (lo escriben las features invocadoras). La `RateQuote` no se persiste (spec).
- **Testing**: JUnit 5; `MockRestServiceServer` para el Módulo 3.
- **Performance Goals**: llamada e integración < 1,5 s (NFR-001).
- **Constraints**: precisión decimal exacta, sin redondeos propios (NFR-002); sin reintentos; nunca tarifa por defecto ni a cero.
- **Scale/Scope**: NEEDS CLARIFICATION.

## Diseño técnico

### Contrato hacia el Módulo 3

`POST {module3}/pricing/quotes` (ruta **propuesta**; la define el Módulo 3), cuerpo JSON:

```json
{ "categoryRoom": "...", "startDate": "2026-10-01", "endDate": "2026-10-04", "previousGrossAmount": 400.00 }
```

`previousGrossAmount` solo se envía en recotizaciones. Respuesta:

```json
{ "grossAmount": 480.00, "amountDifference": 80.00, "currency": "COP", "calculatedAt": "2026-09-26T10:00:00Z" }
```

`amountDifference` viene solo si la petición incluyó `previousGrossAmount`: positivo es a cobrar; negativo, a reembolsar.

### Componentes

| Clase | Ubicación | Responsabilidad |
|---|---|---|
| `Module3Client` (interfaz) y `Module3RestClient` | `integration/module3/` | POST con `RestClient`, timeouts, traducción de errores |
| `RateQuoteRequestDto`, `RateQuoteResponseDto` | `integration/module3/` | Contrato; los importes son `BigDecimal` (`USE_BIG_DECIMAL_FOR_FLOATS`) |
| `RateQuote` (record) | `pricing/` | `grossAmount`, `amountDifference` (nullable), `currency`, `calculatedAt` |
| `RateQuoteService` | `pricing/` | `quoteNew(categoryRoom, startDate, endDate)` y `requote(..., previousGrossAmount)` |
| `PricingUnavailableException`, `InvalidQuoteRequestException` | `pricing/` | Fallo del Módulo 3 y petición inválida |

### Reglas (mapa a los requisitos)

- **FR-001**: petición POST con los parámetros obligatorios y `previousGrossAmount` solo en recotización.
- **FR-002 / NFR-002**: `RateQuote` conserva `grossAmount`, `currency` y `amountDifference` con `BigDecimal`, sin redondear.
- **FR-003 / FR-004**: si el Módulo 3 no responde, agota el tiempo o devuelve error de servidor, se lanza `PricingUnavailableException`; el flujo invocador no persiste nada y conserva el `grossAmount` vigente.
- **FR-005**: no existe ninguna operación de IVA ni comisión en este servicio.
- **FR-006**: este servicio no llama al Módulo 1 ni verifica disponibilidad; el flujo invocador lo hace antes.
- **FR-007**: la confirmación y el incremento de `version` los hace el flujo invocador (`update-reservation`), no este servicio.
- **FR-008 / errores** (400 mediante `GlobalExceptionHandler`):

| Caso | `errorCode` | Mensaje |
|---|---|---|
| Cotización nueva: Módulo 3 no disponible | `PRICING_UNAVAILABLE` | "Error 400: El servicio de cotización de tarifas no se encuentra disponible" |
| Recotización: Módulo 3 no disponible | `REQUOTE_UNAVAILABLE` | "No se pudo calcular la nueva tarifa en este momento. Intente más tarde." |
| Fechas incoherentes, categoría vacía o ausente (validación local, sin llamar al Módulo 3) | `INVALID_QUOTE_REQUEST` | mensaje del campo inválido |
| El Módulo 3 responde 4xx (categoría inexistente, parámetros rechazados) | `INVALID_QUOTE_REQUEST` | "La categoría no es válida" o el motivo que devuelva el Módulo 3 |
| Respuesta del Módulo 3 sin `grossAmount`, con importes negativos o sin `amountDifference` cuando había `previousGrossAmount` | `PRICING_UNAVAILABLE` (o `REQUOTE_UNAVAILABLE`) | mismos mensajes; se registra el detalle en el log |

- **La confirmación no se fía del importe que muestra la pantalla** (diseño propuesto para las features invocadoras): al confirmar, el servidor vuelve a cotizar y compara con el importe que vio el solicitante; si difiere, responde 400 "La tarifa cambió, vuelva a cotizar". Así no se guarda un monto enviado por el cliente y se cumple que la `RateQuote` no se persiste.
- **Nunca** se usa un valor por defecto, estimado, heredado ni cero.
- **Configuración**: `hospitua.module3.base-url`, `connect-timeout` y `read-timeout` (por defecto 1 s de lectura).

## Project Structure

```text
backend/src/main/java/com/hospitua/reservas/
├── integration/module3/
│   ├── Module3Client.java
│   ├── Module3RestClient.java
│   ├── RateQuoteRequestDto.java
│   └── RateQuoteResponseDto.java
└── pricing/
    ├── RateQuote.java
    ├── RateQuoteService.java
    ├── PricingUnavailableException.java
    └── InvalidQuoteRequestException.java
backend/src/test/java/com/hospitua/reservas/
├── unit/pricing/RateQuoteServiceTest.java
└── contract/module3/Module3RateQuoteContractTest.java
```

## Estrategia de testing

| Escenario / caso | Prueba |
|---|---|
| US1 Esc. 1: cotización exitosa | `Module3RateQuoteContractTest`: una sola llamada POST con los tres parámetros; mapea `grossAmount` y `currency` |
| US1 Esc. 2: Módulo 3 sin respuesta | Timeout y error 5xx → `PRICING_UNAVAILABLE`; no se persiste nada |
| US1 Esc. 3: sin disponibilidad, no se cotiza | Prueba en el flujo invocador: cero llamadas al Módulo 3 (se cubre en `generate-direct-reservation`) |
| US2 Esc. 1 y 2: diferencia a pagar y a reembolsar | Contrato con `amountDifference` positivo y negativo; se envía `previousGrossAmount` |
| US2 Esc. 3: el solicitante no confirma | Se cubre en `update-reservation`: no cambia `grossAmount` ni fechas |
| Caso borde: recotización sin respuesta | `REQUOTE_UNAVAILABLE`, conserva el `grossAmount` vigente |
| Caso borde: categoría inexistente | Módulo 3 responde 4xx → `INVALID_QUOTE_REQUEST` |
| Precisión decimal | `RateQuoteServiceTest`: valores con muchos decimales llegan sin redondeo |
| Respuesta incompleta | Falta `grossAmount` o `amountDifference` esperado → tratada como fallo |

## Phase 3: User Story 1 - Consumo de cotización para reservas nuevas (Priority: P1)

**Goal**: obtener el `grossAmount` informativo de una estadía nueva.  
**Independent Test**: escenarios 1 y 2 de la Historia 1 con el Módulo 3 simulado.

### Tests

- [ ] T-CDR-01 [P] [US1] `Module3RateQuoteContractTest`: cotización nueva, timeout, 5xx y 4xx
- [ ] T-CDR-02 [P] [US1] `RateQuoteServiceTest`: validación local y precisión decimal

### Implementation

- [ ] T-CDR-03 [P] [US1] Crear `RateQuote`, `RateQuoteRequestDto`, `RateQuoteResponseDto` (con `BigDecimal`)
- [ ] T-CDR-04 [US1] Implementar `Module3Client` y `Module3RestClient` (usa T012 del plan base)
- [ ] T-CDR-05 [P] [US1] Crear `PricingUnavailableException` e `InvalidQuoteRequestException` y su traducción en `GlobalExceptionHandler`
- [ ] T-CDR-06 [US1] Implementar `RateQuoteService.quoteNew` (depende de T-CDR-03 a T-CDR-05)
- [ ] T-CDR-07 [US1] Agregar las propiedades `hospitua.module3.*` a `application.yml`

**Checkpoint**: `generate-direct-reservation` puede cotizar sin conocer el contrato REST del Módulo 3.

## Phase 4: User Story 2 - Recotización por modificación de estadía (Priority: P1)

**Goal**: recotizar con `previousGrossAmount` y devolver la diferencia.  
**Independent Test**: escenarios 1 y 2 de la Historia 2.

### Tests

- [ ] T-CDR-08 [P] [US2] `Module3RateQuoteContractTest`: recotización con diferencia positiva, negativa y respuesta sin `amountDifference`
- [ ] T-CDR-09 [P] [US2] `RateQuoteServiceTest`: `requote` conserva el `grossAmount` vigente ante fallo

### Implementation

- [ ] T-CDR-10 [US2] Implementar `RateQuoteService.requote` con `previousGrossAmount` (depende de T-CDR-06)
- [ ] T-CDR-11 [US2] Agregar el mensaje y `errorCode` `REQUOTE_UNAVAILABLE`

**Checkpoint**: `update-reservation` puede mostrar la diferencia antes de confirmar.

## Dependencies & Execution Order

- Depende de T009 y T012 del plan base. No depende de las otras tres features de este grupo.
- Lo consumen `generate-direct-reservation` y `update-reservation`. La reserva OTA **no** lo usa
  (decisión C5 del plan base).

## Preguntas abiertas (NEEDS CLARIFICATION)

1. **Contrato real del Módulo 3**: ruta, nombres de campos y autenticación.
2. **`currency` en `Reservation`**: decidido (D2 del plan base): columna `gross_amount_currency` junto a `gross_amount`.
3. **Confirmación con revalidación**: decidido (D1 del plan base): al confirmar se vuelve a cotizar y se compara con el importe que vio el solicitante.
4. **Escala del importe** (decimales y moneda): NEEDS CLARIFICATION con el Módulo 3.
