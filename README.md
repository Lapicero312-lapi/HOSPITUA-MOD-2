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
| `pnpm --filter backend test:integration` | Pruebas de integración: arrancan PostgreSQL y RabbitMQ propios con Testcontainers (necesita Docker Desktop abierto, no `docker compose`) |
| `pnpm --filter backend build` | Compila |
| `pnpm lint` / `pnpm test` / `pnpm build` | Lo mismo, en los dos paquetes |

Antes de abrir una PR, corre `lint`, `typecheck`, `format`, `test`, `test:e2e` y `test:integration`: es lo
mismo que revisa el CI.

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

## Despliegue de la demo (Render)

La demo del avance corre en Render, con los simuladores en lugar de los Módulos 1 y 3 (plan base,
"Despliegue de la demo (Render)"). Todo lo describe [`render.yaml`](render.yaml):

| Servicio | Qué es | URL |
|---|---|---|
| `hospitua-m2-frontend` | La pantalla de la Recepcionista (sitio estático); `/api/*` va al backend | `https://hospitua-m2-frontend.onrender.com` |
| `hospitua-m2-backend` | El backend ([`backend/Dockerfile`](backend/Dockerfile)): aplica las migraciones y arranca | `https://hospitua-m2-backend.onrender.com/api/docs` |
| `hospitua-m2-simulators` | Los simuladores de los Módulos 1 y 3, en un solo puerto | `https://hospitua-m2-simulators.onrender.com/api/rooms` |
| `hospitua-m2-db` | PostgreSQL | Solo la usa el backend |

**Para crearlo (una sola vez):**

1. Crea una cuenta en [Render](https://render.com) con GitHub y dale acceso a este repositorio.
2. Crea una cuenta gratuita en [CloudAMQP](https://www.cloudamqp.com) y una instancia gratuita de RabbitMQ.
   Copia su URL (`amqps://...`): el backend todavía no la usa, pero en producción la exige.
3. En Render: **New → Blueprint**, elige este repositorio y la rama que quieres desplegar. Render lee
   `render.yaml` y te pide los tres secretos:
   - `RABBITMQ_URL`: la de CloudAMQP.
   - `CHANNEX_API_KEY` y `CHANNEX_PROPERTY_ID`: los de tu `backend/.env`. Escríbelos solo ahí, nunca en
     el repositorio, en un chat ni en un documento.
4. Espera a que los tres servicios queden en *Live* y abre el frontend.

**Si Render le da otra URL a un servicio** porque el nombre ya estaba ocupado, cámbiala en `render.yaml`:
la del backend en la regla `/api/*` del frontend, y la de los simuladores en `MODULE1_BASE_URL` y
`MODULE3_BASE_URL`.

**Antes de presentar:**
- En el plan gratuito el backend y los simuladores **se duermen tras un rato sin uso** y despiertan en cerca
  de un minuto. Abre sus URL un par de minutos antes. Mientras duermen, las tareas de Channex no corren.
- La base gratuita dura un tiempo limitado: alcanza para la demo, no para guardar datos.
- **La demo es la única copia conectada a Channex** mientras esté encendida. Nadie del equipo debe arrancar
  su backend con la misma clave al mismo tiempo; en tu `backend/.env` local, deja `CHANNEX_API_KEY` vacía.

**Para probar la imagen del backend en local** (desde la raíz): `docker build -f backend/Dockerfile .`

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
| `render.yaml`, `backend/Dockerfile`, `.dockerignore` | El despliegue de la demo en Render |
| `.github/workflows/ci.yml` | La revisión automática de cada PR |

## Si algo falla

- **VS Code marca en rojo un `tsconfig.json`** después de reinstalar dependencias: es un caché del
  editor. `Ctrl + Shift + P` → **TypeScript: Restart TS Server**. Para usar el TypeScript del proyecto:
  `Ctrl + Shift + P` → **TypeScript: Select TypeScript Version** → *Use Workspace Version*.
- **`pnpm` no se reconoce:** ejecuta `corepack enable` y abre una terminal nueva.
- **Docker Desktop no arranca o `docker` dice que no encuentra el motor:** en Windows 11 Home necesita
  WSL 2. En PowerShell como administrador: `wsl --install --no-distribution`, reinicia y abre Docker
  Desktop hasta que diga "Engine running".
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
