# Imagen del backend para el despliegue de la demo (plan base, "Despliegue de la demo (Render)").
# Se construye desde la raíz del repositorio, porque es un monorepo de pnpm:
#   docker build -f backend/Dockerfile .

FROM node:22-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# corepack instala la versión exacta de pnpm del campo "packageManager", como en el CI.
RUN corepack enable

# Primero solo los package.json: si no cambian, Docker reutiliza la instalación de la vez anterior.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY simulators/package.json simulators/
RUN pnpm install --frozen-lockfile --filter backend

COPY backend/ backend/
RUN pnpm --filter backend build
# Solo las dependencias de producción, en una carpeta aparte.
RUN pnpm --filter backend deploy --prod --legacy /deploy

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /deploy/ ./
COPY --from=build /app/backend/dist ./dist
USER node
EXPOSE 3000
# Aplica las migraciones pendientes y después arranca. Si una migración falla, el backend no arranca.
CMD ["sh", "-c", "node node_modules/typeorm/cli.js migration:run -d dist/infrastructure/config/data-source.js && exec node dist/main.js"]
