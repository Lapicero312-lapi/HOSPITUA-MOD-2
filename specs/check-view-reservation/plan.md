# Implementation Plan: Consultar y buscar reservas (`check-view-reservation`)

**Plan base**: [../base/plan.md](../base/plan.md)
**Spec**: [./spec.md](spec.md)
**Guía**: [../base/guia-planes-por-caso-de-uso.md](../base/guia-planes-por-caso-de-uso.md)

> **Estado: borrador.** Por ahora este plan solo contiene el contrato de los mensajes al Módulo 1, ya
> acordado con ese equipo. El resto del plan (rutas REST, pantallas, tareas y pruebas) se completa
> siguiendo la guía.

## Contratos

### Lista del día y sus actualizaciones al Módulo 1 (historias de usuario 4 y 5)

La lista y sus actualizaciones llevan el detalle de FR-014 de la spec. El campo `source` viaja como
`DIRECTA` para las reservas directas o con el nombre de la agencia (por ejemplo `BOOKING`) para las
`OTA`.


Los dos mensajes viajan por la cola `m1.reservas.diarias.queue`. Las fechas sin hora van como
`AAAA-MM-DD` y las fechas con hora en ISO 8601 con zona horaria. Los valores de los ejemplos son
ilustrativos.

**Lista del día** (routing key `reserva.lista-del-dia`, una vez por día operativo a las 00:00):

```json
{
  "messageId": "UUIDv4",
  "sequenceNumber": 1,
  "operationalDate": "2026-10-09",
  "generatedAt": "2026-10-09T00:00:02-05:00",
  "totalReservations": 1,
  "totalRooms": 1,
  "totalGuests": 2,
  "reservations": [
    {
      "reservationRef": "RSV-3F9A1C7B",
      "status": "ACTIVE",
      "source": "DIRECTA",
      "startDate": "2026-10-09",
      "endDate": "2026-10-12",
      "guestCount": 2,
      "notes": "Llegada tarde",
      "updatedAt": "2026-10-08T15:42:10.123456-05:00",
      "rooms": [
        { "roomId": "uuid", "roomNumber": "201", "categoryRoom": "DOBLE", "guestCount": 2 }
      ],
      "guest": {
        "guestRef": "uuid",
        "firstName": "Ana",
        "lastName": "Pérez",
        "fullName": "Ana Pérez",
        "documentType": "CC",
        "documentNumber": "123",
        "nationality": "Colombia",
        "contactPhone": "+57 300 000 0000",
        "contactEmail": "ana@correo.com"
      }
    }
  ]
}
```

Una reserva `OTA` lleva además `externalConfirmationCode`, y su `source` es el nombre de la agencia.
Si no hay reservas, la lista se envía con `"reservations": []` y los totales en `0`.

**Actualización `ADDED` o `UPDATED`** (routing key `reserva.lista-del-dia.actualizacion`). El
campo `reservation` lleva el detalle completo de FR-014, no solo lo que cambió:

```json
{
  "messageId": "UUIDv4",
  "sequenceNumber": 2,
  "operationalDate": "2026-10-09",
  "updateType": "UPDATED",
  "occurredAt": "2026-10-09T09:15:00-05:00",
  "reservationRef": "RSV-3F9A1C7B",
  "reservation": {
    "reservationRef": "RSV-3F9A1C7B",
    "status": "ACTIVE",
    "source": "DIRECTA",
    "startDate": "2026-10-09",
    "endDate": "2026-10-13",
    "guestCount": 2,
    "notes": "Llegada tarde",
    "updatedAt": "2026-10-09T09:15:00.000000-05:00",
    "rooms": [
      { "roomId": "uuid", "roomNumber": "201", "categoryRoom": "DOBLE", "guestCount": 2 }
    ],
    "guest": {
      "guestRef": "uuid",
      "firstName": "Ana",
      "lastName": "Pérez",
      "fullName": "Ana Pérez",
      "documentType": "CC",
      "documentNumber": "123",
      "nationality": "Colombia",
      "contactPhone": "+57 300 000 0000",
      "contactEmail": "ana@correo.com"
    }
  }
}
```

**Actualización `REMOVED`** (misma routing key). No lleva `reservation`; `removalReason` es
`CANCELLED`, `DATE_CHANGED` o `NO_SHOW`:

```json
{
  "messageId": "UUIDv4",
  "sequenceNumber": 3,
  "operationalDate": "2026-10-09",
  "updateType": "REMOVED",
  "occurredAt": "2026-10-09T23:59:00-05:00",
  "reservationRef": "RSV-8D02E5A4",
  "removalReason": "NO_SHOW"
}
```

