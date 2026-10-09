# Implementation Plan: Consultar inventario de habitaciones (`consult-room-inventory`)

**Plan base**: [../base/plan.md](../base/plan.md)
**Spec**: [./spec.md](spec.md)
**Guía**: [../base/guia-planes-por-caso-de-uso.md](../base/guia-planes-por-caso-de-uso.md)

> **Estado: borrador.** Por ahora este plan solo contiene el contrato de la consulta al Módulo 1. El
> resto del plan (puerto, adaptador, pantalla "Habitaciones", tareas y pruebas) se completa siguiendo
> la guía.

## Contratos

### Habitaciones vendibles (Módulo 2 → Módulo 1, REST GET)

**Solicitud:** por `categoryRoom` (todas las habitaciones de esa categoría) o por `roomId` (una
habitación).

**Respuesta:** por cada habitación, `id`, `roomNumber`, `categoryRoom` y `maxCapacity`. Sin estado:
todas las habitaciones que entrega el Módulo 1 son vendibles.

Por categoría:

```json
[
  { "id": "uuid", "roomNumber": "201", "categoryRoom": "DOBLE", "maxCapacity": 2 },
  { "id": "uuid", "roomNumber": "202", "categoryRoom": "DOBLE", "maxCapacity": 3 }
]
```

Por `roomId`:

```json
{ "id": "uuid", "roomNumber": "201", "categoryRoom": "DOBLE", "maxCapacity": 2 }
```

**Reglas:**

- Una categoría sin habitaciones devuelve una lista vacía.
- Si el Módulo 1 falla, no responde o el `roomId` no existe, el Módulo 2 responde un error controlado
  (HTTP 400) a quien consulta.
- La consulta responde en menos de 1 segundo en condiciones normales.

Los valores de los ejemplos son ilustrativos. Las rutas y los códigos de error exactos del Módulo 1
quedan por acordar con ese equipo.
