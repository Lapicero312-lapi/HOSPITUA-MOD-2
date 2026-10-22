# HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal

Monorepo del Módulo 2: `backend/` (NestJS) y `frontend/` (React + Vite). La especificación completa está
en [`specs/`](specs/): empieza por el [diccionario](specs/diccionario.md) y el
[plan base](specs/base/plan.md).

## Requisitos

| Herramienta | Versión | Cómo instalarla en Windows |
|---|---|---|
| Node.js | 22 (la fija `.nvmrc`) | `winget install OpenJS.NodeJS.22` |
| pnpm | la fija `package.json` (`packageManager`) | Viene con Node: `corepack enable` |
| Docker Desktop | reciente | <https://www.docker.com/products/docker-desktop/> |

## Primeros pasos

```bash
corepack enable                              # activa pnpm (una sola vez)
pnpm install                                 # instala backend y frontend
cp backend/.env.example backend/.env         # configuración local (no se sube al repositorio)
docker compose up -d                         # PostgreSQL y RabbitMQ
pnpm --filter backend migration:run          # crea las tablas en PostgreSQL
pnpm --filter backend start:dev              # backend en http://localhost:3000
pnpm --filter frontend dev                   # frontend en http://localhost:5173
```

El panel de RabbitMQ queda en <http://localhost:15672> (usuario y clave: `hospitua`).

## Comandos

Se ejecutan desde la raíz. Cambia `backend` por `frontend` para el otro paquete.

| Comando | Qué hace |
|---|---|
| `pnpm --filter backend lint` | oxlint y **reglas de capas** (dependency-cruiser) |
| `pnpm --filter backend typecheck` | Revisa los tipos (TypeScript `strict`) |
| `pnpm --filter backend format` | Da formato al código (Prettier) |
| `pnpm --filter backend test` | Pruebas unitarias (Vitest) |
| `pnpm --filter backend test:e2e` | Pruebas e2e del backend |
| `pnpm --filter backend build` | Compila |
| `pnpm lint` / `pnpm test` / `pnpm build` | Lo mismo, en los dos paquetes |

Antes de abrir una PR, corre `lint`, `typecheck`, `format` y `test`: es lo mismo que revisa el CI.

## Base de datos

El esquema se crea con **migraciones escritas a mano en SQL** (decisión D11 del plan base), en
`backend/src/migrations/`. TypeORM nunca genera tablas desde las clases.

| Comando | Qué hace |
|---|---|
| `pnpm --filter backend migration:run` | Aplica las migraciones pendientes |
| `pnpm --filter backend migration:show` | Muestra cuáles están aplicadas (`[X]`) y cuáles no (`[ ]`) |
| `pnpm --filter backend migration:revert` | Deshace la última migración aplicada |

Usan la conexión de `backend/.env` (PostgreSQL de `docker compose`). La primera migración,
`EsquemaBase`, crea las 17 tablas del modelo con sus relaciones, restricciones e índices.

**Para agregar una migración:** crea `backend/src/migrations/<marca-de-tiempo>-<Nombre>.ts` (la marca es
`Date.now()`), con `up` y `down` en SQL, y agrégala al final de la lista de `src/migrations/index.ts`.
**Nunca modifiques una migración que ya está en `develop`:** si hay que cambiar algo, crea una nueva.

## Dónde va cada cosa

El equipo trabaja casi solo en `backend/src/` y `backend/test/`. La estructura sigue el
[plan base](specs/base/plan.md) ("Project Structure"); las carpetas vacías tienen un `.gitkeep` para que
Git las guarde.

```text
backend/
├── src/
│   ├── domain/              Reglas de negocio. TypeScript puro: sin Nest, sin base de datos, sin colas
│   │   ├── reservation/     Reservation, ReservationRoom, transiciones de estado
│   │   ├── guest/           Guest (titular)
│   │   ├── ota/             Ota, relación de tipos de habitación, regla de comisión
│   │   ├── cancellation/    Cancellation
│   │   ├── migration/       GuestData, MigratoryMovement, SireExport
│   │   └── shared/          Enumerados, dinero (decimal.js), día operativo, errores de negocio
│   ├── application/         Los casos de uso
│   │   ├── use-cases/       Una carpeta por spec (13): puerto de entrada + servicio
│   │   ├── ports/out/       Lo que los casos de uso necesitan de afuera (repositorios, Módulo 1, ...)
│   │   └── integration/     Datos que vienen de otros módulos (Room, RateQuote, ...), no se guardan
│   ├── infrastructure/      Todo lo que toca el mundo real
│   │   ├── in/              Por donde entra algo: rest/ (controladores), messaging/ (colas), jobs/ (tareas)
│   │   ├── out/             Por donde sale algo: persistence/, module1/, module3/, channex/, messaging/, clock/
│   │   ├── config/          Variables de entorno
│   │   └── shared/          Errores de API, filtro de excepciones, logs
│   └── migrations/          Cambios de la base de datos (SQL)
└── test/
    ├── unit/                Sin base de datos ni cola: dominio, casos de uso e infraestructura (espejo de src/)
    ├── integration/         Con PostgreSQL y RabbitMQ reales (Testcontainers)
    ├── contract/            Contratos REST y de mensajes
    └── e2e/                 API con supertest (archivos *.e2e-spec.ts)

frontend/src/
├── pages/                   Pantallas de la Recepcionista
├── components/              Piezas reutilizables
├── services/                Llamadas a la API del backend
└── test/                    Configuración de las pruebas
```

Las dependencias solo van hacia adentro: `infrastructure → application → domain`. Si no sabes dónde
poner algo: ¿es una regla de negocio? `domain/`. ¿Un caso de uso? `application/`. ¿Habla con la base de
datos, una cola, un controlador o un servicio externo? `infrastructure/`.

## Archivos de configuración

Hay muchos porque cada herramienta tiene el suyo. **Rara vez se tocan.** Si no sabes qué hace uno, no lo
cambies sin preguntar.

| Archivo | Para qué sirve |
|---|---|
| `package.json` (raíz, `backend/`, `frontend/`) | Las librerías del proyecto y los comandos (`pnpm test`, `pnpm build`, ...) |
| `pnpm-lock.yaml` | Las versiones exactas de todo. Lo genera pnpm: **nunca se edita a mano**, pero sí se sube |
| `pnpm-workspace.yaml` | Dice que `backend` y `frontend` son un solo proyecto |
| `tsconfig*.json` | Las reglas con las que TypeScript revisa y compila el código |
| `.oxlintrc.json`, `.prettierrc` | Las reglas del lint y el formato único del código |
| `backend/.dependency-cruiser.cjs` | Las reglas de las capas (qué carpeta puede importar de cuál) |
| `vitest.config*.ts` | Cómo corren las pruebas |
| `.nvmrc` | La versión de Node que usa todo el equipo |
| `.gitignore`, `.gitattributes` | Qué archivos ignora Git y cómo guarda los saltos de línea |
| `backend/.env.example` | Plantilla de tu configuración local (`backend/.env`, que no se sube) |
| `docker-compose.yml` | PostgreSQL y RabbitMQ para desarrollo |
| `.github/workflows/ci.yml` | La revisión automática de cada PR |

## Si algo falla

- **VS Code marca en rojo un `tsconfig.json`** después de reinstalar dependencias: es un caché del
  editor. `Ctrl + Shift + P` → **TypeScript: Restart TS Server**. Para usar el TypeScript del proyecto:
  `Ctrl + Shift + P` → **TypeScript: Select TypeScript Version** → *Use Workspace Version*.
- **`pnpm` no se reconoce:** ejecuta `corepack enable` y abre una terminal nueva.
- **`pnpm install` dice "Unsupported engine":** tienes otra versión de Node. Instala Node 22 (la del CI y
  de `.nvmrc`); pnpm no instala con otra para que todos probemos con la misma.

## Reglas del equipo

- **Código en inglés** (clases, funciones y constantes); **comentarios, mensajes y títulos de las
  pruebas en español**.
- **Pruebas:** se importan siempre `describe`, `it`, `expect` y `vi` desde `vitest`.
- **Los specs mandan.** Si el código obliga a cambiar un contrato, una regla o un nombre, primero se
  cambia el `spec.md` o el `plan.md` en una PR aparte, y después el código.
- **Arquitectura hexagonal** (plan base): las dependencias apuntan hacia adentro,
  `infrastructure → application → domain`. `domain/` es TypeScript puro. `pnpm lint` lo verifica y el CI
  rechaza la PR si se rompe.
- **El backend es ESM**: los imports relativos llevan la extensión `.js` aunque el archivo sea `.ts`
  (`import { AppModule } from './app.module.js'`).
- **Ramas (Gitflow)**: todo sale de `develop` con `feature/<caso-de-uso>-<tarea>`, entra por PR con al
  menos una aprobación y con el CI en verde. Nadie sube directo a `develop` ni a `main`.
- **Secretos**: la clave de Channex y cualquier otra clave van solo en tu `backend/.env`. Nunca en el
  repositorio, la base de datos ni los logs.
