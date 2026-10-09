# Implementation Plan: Consultar calendario de mantenimientos (`consult-maintenance-calendar`)

**Plan base**: [../base/plan.md](../base/plan.md)
**Spec**: [./spec.md](spec.md)
**Guía**: [../base/guia-planes-por-caso-de-uso.md](../base/guia-planes-por-caso-de-uso.md)

> **Estado: borrador.** Por ahora este plan solo contiene el contrato de la consulta al Módulo 1, ya
> acordado con ese equipo. El resto del plan (puerto, adaptador, tareas y pruebas) se completa
> siguiendo la guía.

## Contratos

### Consulta de mantenimientos (Módulo 2 → Módulo 1, REST GET)

**Solicitud:** `roomId`, `startDate` y `endDate` (fechas `AAAA-MM-DD`). Se consulta una vez por cada
habitación candidata de la categoría pedida.

**Respuesta con cruce:**

```json
{
  "roomId": "uuid",
  "available": false,
  "conflicts": [
    { "maintenanceStart": "2026-10-10", "maintenanceEnd": "2026-10-12" }
  ]
}
```

**Respuesta sin cruce:**

```json
{
  "roomId": "uuid",
  "available": true,
  "conflicts": []
}
```

**Reglas:**

- Hay cruce si el mantenimiento se solapa total o parcialmente con el rango consultado. Todos los
  mantenimientos bloquean la reserva.
- Un mantenimiento que termina justo antes de la fecha de llegada no es cruce.
- `conflicts` trae el inicio y el fin de cada mantenimiento que se cruza; no trae el motivo.
- Errores del Módulo 1: **404** si la habitación no existe; **400** si el `roomId` tiene formato
  inválido o el rango de fechas es inválido. Nunca 500.
- Cada consulta responde en menos de 1 segundo en condiciones normales.
- Si el Módulo 1 falla o no responde, el Módulo 2 no asume que la habitación está libre: responde un
  error controlado (HTTP 400) a quien consulta.
