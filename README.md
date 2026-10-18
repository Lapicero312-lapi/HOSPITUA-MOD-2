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

## Reglas del equipo

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
