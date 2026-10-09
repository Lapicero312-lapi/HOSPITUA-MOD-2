# Guía para escribir el plan de un caso de uso

Esta guía explica cómo escribir el `plan.md` de cada caso de uso del Módulo 2 a partir del plan
base ([plan.md](plan.md)). La spec dice **qué** hace el caso de uso; su plan dice **cómo** se
construye, sin repetir lo que ya fija el plan base.

## 1. Dónde va y cómo empieza

- El plan se crea en `specs/<caso-de-uso>/plan.md`, al lado de su `spec.md`.
- Se parte de la plantilla [`specs/template/plan-template.md`](../template/plan-template.md).
- El encabezado lleva la referencia al plan base:

  ```markdown
  **Plan base**: ../base/plan.md
  **Spec**: ./spec.md
  ```

## 2. Lo que se hereda y no se redefine

Estos temas ya están decididos en el plan base. El plan del caso de uso los usa tal cual y no los
cambia; si algo no le sirve, se discute y se cambia primero en el plan base.

- **Stack:** NestJS, TypeScript `strict`, TypeORM, PostgreSQL, RabbitMQ (`@golevelup/nestjs-rabbitmq`),
  pnpm; frontend React + Vite + TanStack Query.
- **Arquitectura hexagonal:** un solo `src/domain/` para todo el Módulo 2, un caso de uso por feature
  en `application/use-cases/` y adaptadores en `infrastructure/in` y `infrastructure/out`.
- **Errores:** siempre 4xx con el cuerpo `{ errorCode, message, timestamp, path }`; nunca 500.
- **Mensajería:** mensajes JSON planos, `messageId` como única clave de duplicados, `sequenceNumber`
  para el orden, reintentos y dead-letter.
- **Concurrencia:** control por `updatedAt`; un conflicto es 400 `CONCURRENT_UPDATE`.
- **Tareas programadas:** `@nestjs/schedule` en `America/Bogota` con bloqueo asesor.
- **Nombres:** los del diccionario (`reservationRef`, `startDate`, `endDate`, `categoryRoom`, ...).
- **Modelo de datos base:** las tablas del plan base. Un caso de uso solo agrega lo que le falte.

## 3. Lo que debe definir cada plan

1. **Comunicación.** Si el caso de uso habla con otro módulo, indicar si es REST o cola según la regla
   del plan base: **proactiva** (avisa y no espera respuesta) → cola; **reactiva** (necesita una
   respuesta inmediata) → REST.
2. **Contratos exactos.**
   - **REST:** método, ruta definitiva, parámetros, cuerpo de la solicitud, respuesta con un ejemplo
     JSON y cada error con su código y su mensaje.
   - **Cola:** cola, routing key, quién publica y quién consume, y el JSON exacto del mensaje.
3. **Dominio y datos.** Entidades, reglas o tablas nuevas o que cambian, si las hay. Si no hay
   cambios, decirlo.
4. **Puertos.** Qué puertos de salida usa (repositorios, `Module1Port`, `Module3Port`,
   `EventPublisher`, `Clock`) y qué puerto de entrada expone.
5. **Pantallas.** Si el caso de uso tiene interfaz para la Recepcionista, qué pantalla es y qué
   llamadas hace al backend.
6. **Tareas, en orden:** dominio → caso de uso → adaptadores → endpoint o consumidor → pruebas.
   Cada tarea con su identificador (`T001`, ...) y `[P]` si se puede hacer en paralelo.

## 4. Pruebas

- Cada escenario de la spec (`Given / When / Then`) lleva al menos una prueba de integración.
- Las llamadas a otros módulos se prueban contra respuestas simuladas: éxito, error, tiempo agotado.
- Los mensajes de cola se prueban con su forma exacta y con un mensaje repetido (mismo `messageId`).

## 5. Antes de programar

- La spec del caso de uso está validada.
- Su plan está revisado por el equipo.
- El caso de uso respeta el orden recomendado del plan base (por ejemplo, `check-room-availability`
  va después de las consultas al Módulo 1 y al Módulo 3).
