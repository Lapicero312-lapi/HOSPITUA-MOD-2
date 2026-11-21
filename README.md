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

## Los Módulos 1 y 3

El backend usa siempre los módulos reales, en local y en la demo. `backend/.env.example` ya apunta a ellos:

| Módulo | URL | Rutas que usa el Módulo 2 | Variables |
|---|---|---|---|
| Módulo 1 (inventario y mantenimientos) | `https://gestionophospitua.tech` | `GET /api/rooms`, `GET /api/rooms?categoryRoom=…`, `GET /api/rooms/{roomId}` y `GET /api/rooms/{roomId}/maintenances?startDate=…&endDate=…` | `MODULE1_BASE_URL`, `MODULE1_INTERNAL_KEY` |
| Módulo 3 (cotizaciones) | `https://hospitua-module-3.onrender.com` | `POST /pricing/quotes` (sin `/api`) | `MODULE3_BASE_URL`, `MODULE3_INTERNAL_KEY` |

- **Las claves `X-Internal-Key`** las entrega cada módulo por privado. Van solo en tu `backend/.env` y en el
  panel de Render. Vacías, el backend llama sin la cabecera.
- **El Módulo 3 está en el plan gratuito de Render:** si está dormido, la primera cotización responde "servicio
  no disponible". Abre `https://hospitua-module-3.onrender.com/docs` antes de probar.
- **RabbitMQ en local es el de `docker compose`,** no el del Módulo 1: ahí no llegan sus avisos de Check-In y
  Check-Out. Para probarlos, publícalos a mano desde el panel (`http://localhost:15672`) en `hospitua.events`,
  con la routing key `habitacion.checkin` o `habitacion.checkout` y el JSON del plan de `update-reservation`.
- **Si tu RabbitMQ local tiene colas `m2.*` de antes de `m2.direct`,** bórralas una vez desde el panel
  (*Queues and Streams*, filtra por `m2.` y borra cada una). Esas colas usan el exchange por defecto como
  dead-letter, y RabbitMQ rechaza volver a declararlas con otros argumentos: el backend no consumiría nada. Al
  arrancar, el backend las crea de nuevo.
- Las pruebas del backend no llaman a los módulos: los simulan con `msw`.

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

La demo del avance corre en Render (plan base, "Despliegue de la demo (Render)") y se conecta a los Módulos 1
y 3 reales: `https://gestionophospitua.tech` y `https://hospitua-module-3.onrender.com`. Todo lo describe
[`render.yaml`](render.yaml):

| Servicio | Qué es | URL |
|---|---|---|
| `hospitua-m2-frontend` | La pantalla de la Recepcionista (sitio estático); `/api/*` va al backend | `https://hospitua-m2-frontend.onrender.com` |
| `hospitua-m2-backend` | El backend ([`backend/Dockerfile`](backend/Dockerfile)): aplica las migraciones y arranca | `https://hospitua-m2-backend.onrender.com/api/docs` |
| `hospitua-m2-db` | PostgreSQL | Solo la usa el backend |

**Para crearlo (una sola vez):**

1. Crea una cuenta en [Render](https://render.com) con GitHub y dale acceso a este repositorio.
2. Pide al Módulo 1, por un canal privado, el usuario y la clave de su RabbitMQ. El broker común es el suyo:
   `broker.gestionophospitua.tech`, puerto `5671`, vhost `/`, solo con TLS.
3. En Render: **New → Blueprint**, elige este repositorio y la rama que quieres desplegar. Render lee
   `render.yaml` y te pide los tres secretos:
   - `RABBITMQ_URL`: `amqps://<usuario>:<clave>@broker.gestionophospitua.tech:5671/%2F` (el `%2F` es el
     vhost `/`).
   - `CHANNEX_API_KEY` y `CHANNEX_PROPERTY_ID`: los de tu `backend/.env`. Escríbelos solo ahí, nunca en
     el repositorio, en un chat ni en un documento.
4. Espera a que el backend y el frontend queden en *Live* y abre el frontend.
5. Agrega en el panel del backend las claves que entregan los otros módulos por privado:
   `MODULE1_INTERNAL_KEY` (el Módulo 1 todavía no la exige y avisa antes de hacerlo) y `MODULE3_INTERNAL_KEY`
   (avísale antes al Módulo 3, para que la active de su lado al mismo tiempo). Sin ellas, el backend llama
   sin `X-Internal-Key`.
6. La nuestra, `MODULE2_INTERNAL_KEY`: genera una clave larga (por ejemplo `openssl rand -hex 32`), pásala
   por privado a los Módulos 1 y 3 y agrégala en el panel **cuando ellos ya la envíen**. Desde ese momento
   `GET /api/reservations` (con `X-Client: MODULE1`), `GET /api/reservations/{ref}` (con `X-Client: MODULE3`)
   y `/api/ota-commissions…` responden `401 INVALID_INTERNAL_KEY` sin ella. Las rutas de la Recepcionista no
   la piden: el navegador no puede guardar un secreto.

**Si Render le da otra URL al backend** porque el nombre ya estaba ocupado, cámbiala en `render.yaml`, en la
regla `/api/*` del frontend.

**Antes de presentar:**
- En el plan gratuito el backend **se duerme tras un rato sin uso** y despierta en cerca de un minuto. Abre
  su URL un par de minutos antes. Mientras duerme, las tareas de Channex no corren.
- **El Módulo 3 también está en el plan gratuito.** El backend le espera 3 s: si está dormido, la primera
  cotización responde "servicio no disponible". Pídeles que lo despierten antes, o abre
  `https://hospitua-module-3.onrender.com/docs`.
- La base gratuita dura un tiempo limitado: alcanza para la demo, no para guardar datos.
- **La demo es la única copia conectada a Channex** mientras esté encendida. Nadie del equipo debe arrancar
  su backend con la misma clave al mismo tiempo; en tu `backend/.env` local, deja `CHANNEX_API_KEY` vacía.
- **La demo es también la única copia conectada al RabbitMQ del Módulo 1.** Un backend local con la misma
  `RABBITMQ_URL` consumiría los avisos de Check-In y Check-Out de la demo. En tu `backend/.env` local deja la
  de `docker compose`.
- El Módulo 2 no declara la cola de la lista del día (`m1.reservas.diarias.queue`): es del Módulo 1. Si esa
  cola todavía no existe, la lista queda pendiente y se reintenta hasta que exista.

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
