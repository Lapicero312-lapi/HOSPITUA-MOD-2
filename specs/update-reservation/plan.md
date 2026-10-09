# Implementation Plan: Actualizar reservación (`update-reservation`)

**Plan base**: [../base/plan.md](../base/plan.md)
**Spec**: [./spec.md](spec.md)
**Guía**: [../base/guia-planes-por-caso-de-uso.md](../base/guia-planes-por-caso-de-uso.md)

> **Estado: borrador.** Por ahora este plan solo contiene el contrato de las notificaciones de
> Check-In y Check-Out del Módulo 1, ya acordado con ese equipo. El resto del plan (modificación,
> cierre del día, rutas REST, tareas y pruebas) se completa siguiendo la guía.

## Contratos

### Notificaciones de Check-In y Check-Out (Módulo 1 → Módulo 2)

| Cola | Routing key | Contenido |
|---|---|---|
| `m2.habitacion.checkin.queue` | `habitacion.checkin` | `messageId`, `sequenceNumber`, `reservationRef`, `roomId`, `movementType` (`ENTRY`), `movementDate` (`checkInDate`) y la lista `guests` con todos los huéspedes de la habitación |
| `m2.habitacion.checkout.queue` | `habitacion.checkout` | `messageId`, `sequenceNumber`, `reservationRef`, `roomId`, `movementType` (`DEPARTURE`), `movementDate` (`checkOutDate`) y la lista `guests` con todos los huéspedes de la habitación |

- El `movementType` y el `movementDate` van a nivel de mensaje y valen para todos los huéspedes de la
  lista.
- Cada huésped de `guests` trae `firstName`, `lastName`, `documentType` (`RC`, `TI`, `CC`, `CE`, `PAS`
  o `NIT`), `documentNumber`, `birthDate` y `nationality` (nombre del país; un colombiano se escribe
  exactamente `Colombia`). `originPlace` y `destinationPlace` solo son obligatorios para extranjeros.
- La lista `guests` la registra "Procesar datos de huéspedes" (`process-guest-data`).
- El `sequenceNumber` del Módulo 1 es creciente por cola y nunca se reinicia (FR-023 de la spec).

**Check-In:**

```json
{
  "messageId": "UUIDv4",
  "sequenceNumber": 123,
  "reservationRef": "RSV-8D02E5A4",
  "roomId": "uuid",
  "movementType": "ENTRY",
  "movementDate": "2026-10-09",
  "guests": [
    {
      "firstName": "Ana",
      "lastName": "Pérez",
      "documentType": "CC",
      "documentNumber": "123",
      "birthDate": "1995-03-20",
      "nationality": "Colombia"
    },
    {
      "firstName": "John",
      "lastName": "Smith",
      "documentType": "PAS",
      "documentNumber": "X99",
      "birthDate": "1990-05-12",
      "nationality": "Estados Unidos",
      "originPlace": "Miami, Estados Unidos",
      "destinationPlace": "Cartagena, Colombia"
    }
  ]
}
```

**Check-Out:** misma estructura, con `movementType` `DEPARTURE`, la fecha de salida y los mismos datos
de cada huésped que en el Check-In.

```json
{
  "messageId": "UUIDv4",
  "sequenceNumber": 124,
  "reservationRef": "RSV-8D02E5A4",
  "roomId": "uuid",
  "movementType": "DEPARTURE",
  "movementDate": "2026-10-12",
  "guests": [
    {
      "firstName": "Ana",
      "lastName": "Pérez",
      "documentType": "CC",
      "documentNumber": "123",
      "birthDate": "1995-03-20",
      "nationality": "Colombia"
    },
    {
      "firstName": "John",
      "lastName": "Smith",
      "documentType": "PAS",
      "documentNumber": "X99",
      "birthDate": "1990-05-12",
      "nationality": "Estados Unidos",
      "originPlace": "Miami, Estados Unidos",
      "destinationPlace": "Cartagena, Colombia"
    }
  ]
}
```

Los valores de los ejemplos son ilustrativos. El comportamiento del consumidor ante duplicados,
errores y fallos está en el plan base ("Traducción de respuestas HTTP a cola").
