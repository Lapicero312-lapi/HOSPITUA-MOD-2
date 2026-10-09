# Implementation Plan: Calcular tarifa dinámica (`calculate-dynamic-rate`)

**Plan base**: [../base/plan.md](../base/plan.md)
**Spec**: [./spec.md](spec.md)
**Guía**: [../base/guia-planes-por-caso-de-uso.md](../base/guia-planes-por-caso-de-uso.md)

> **Estado: borrador.** Por ahora este plan solo contiene el contrato de la cotización con el
> Módulo 3. El resto del plan (puerto, adaptador, pantalla de referencia, tareas y pruebas) se completa
> siguiendo la guía.

## Contratos

### Cotización de tarifa (Módulo 2 → Módulo 3, REST POST)

**Solicitud:** `POST /pricing/quotes` con cuerpo JSON. Los nombres son los de la API del Módulo 3 y
equivalen a los del Módulo 2: `roomType` = `categoryRoom`, `checkInDate` = `startDate`,
`checkOutDate` = `endDate`. Se pide una cotización por habitación.

**Respuesta (`RateQuote`):** `quoteId`, `currency`, `nightlyRates` (lista de `date` y `rate`) y
`lodgingAmount`.

```json
{
  "quoteId": "Q-12345",
  "currency": "COP",
  "nightlyRates": [
    { "date": "2026-10-10", "rate": 250000 },
    { "date": "2026-10-11", "rate": 280000 }
  ],
  "lodgingAmount": 530000
}
```

Los valores del ejemplo son ilustrativos. De la respuesta, el Módulo 2 guarda en cada
`ReservationRoom` solo el `lodgingAmount` (como `roomGrossAmount`), el `quoteId` y la `currency`
(decisiones D1 y D2 del plan base).
