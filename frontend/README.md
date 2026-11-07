# HOSPITUA · Frontend de Recepción (Módulo 2)

React + Vite + TypeScript + React Router + TanStack Query. Trabaja contra un **backend simulado (MSW)**
que replica el contrato de `specs/check-view-reservation/plan.md`.

## Uso
```bash
pnpm install          # o npm install
pnpm dev              # http://localhost:5173 (entre con cualquier nombre)
pnpm test             # pruebas de utilidades
pnpm build            # typecheck + build
```
Pasar al backend real: copie `.env.example` a `.env` y ponga `VITE_USE_MOCKS=false` (el proxy de Vite
reenvía `/api` a `VITE_API_PROXY`).

## Versión 2 (wireframe «Recepcionista (Módulo 2)»)
Tomada de `HOSPITUA_-_Recepcionista__Modulo_2_.html` + `style.css` + `app.js`: identidad índigo (con modo oscuro),
menú plano con «Huéspedes alojados», avatares con iniciales, badges, textos de estado («No se presentó»), filtro de
agencia solo con canal OTA, detalle con pestañas y avisos de solo consulta. Los datos simulados salen de ese wireframe.

## Versión 3: Nueva reserva directa (`generate-direct-reservation`)
Pantalla `/reservas/nueva` según el plan: disponibilidad y tarifa se consultan solas al cambiar fechas, categoría o
habitaciones (`POST /api/reservations/direct/preview`); precarga del titular por documento (`GET /api/guests/lookup`);
creación con `Idempotency-Key` y las tarifas vistas en `expectedRates` (si cambian, el servidor responde `RATE_CHANGED`
y la pantalla vuelve a cotizar). Los mocks replican los errores 400 con sus mensajes literales y se prueban en
`src/mocks/directHandlers.test.ts`.

## Versión 4: Modificar y cancelar (`update-reservation`, `cancel-reservation`)
- **Modificar** (`/reservas/:ref/modificar`): fechas, habitaciones (cambiar, agregar, quitar; 1 a 10), personas, titular
  (sin nacionalidad) y observaciones. Solo viaja lo que cambió. Un resumen y la tarifa se piden solos a
  `POST /reservations/{ref}/modification-preview`; se guarda con `PATCH` y `expectedRates` solo si hubo recotización.
- **Cancelar** (`/reservas/:ref/cancelar`): resumen, motivo opcional (500) y casilla obligatoria; `POST .../cancellation`
  con `X-User`. Sin cobro ni penalidad.
- `CONCURRENT_UPDATE` ofrece «Recargar la reserva»; `RATE_CHANGED` y `NO_AVAILABILITY` vuelven a cotizar.
- Solo reservas directas `ACTIVE`; las demás muestran el motivo del bloqueo. Los mocks y sus errores están en
  `src/mocks/updateLogic.ts` y se prueban en `updateHandlers.test.ts`.

## Qué hay hecho
- Login simulado (guarda el nombre para `X-User`; todas las llamadas llevan `X-Client: RECEPTIONIST`).
- **Listado** (`/reservas`): resumen del día, búsqueda única, filtros, orden, paginación de 10; filtros en la URL.
- **Detalle** (`/reservas/:ref`): estadía, titular, habitaciones, cancelación. Modificar/Cancelar solo en directas ACTIVE/PENDING.
- **Nueva reserva directa** (v3), **Modificar** y **Cancelar** (v4), ver arriba.
- Resto de pantallas: marcadores (`PendingPage`) hasta tener el plan de su caso de uso.

## Dónde tocar cuando cambie el backend
- `src/types.ts`: tipos de la API (único lugar).
- `src/services/`: llamadas HTTP.
- `src/mocks/`: datos y handlers simulados (se pueden borrar al integrar).

## Pendientes de confirmar con el equipo
- El wireframe nuevo ya usa `RSV-` + 8 hex y agencias de solo lectura (coincide con el plan).
- El wireframe muestra 3 agencias (Booking, Expedia, Airbnb); el plan base habla de una sola (Booking).
- El wireframe no tiene conflictos de Booking ni el filtro «Solo en conflicto»; vienen del plan (se conservaron; una reserva es sintética).
- El wireframe lista categorías Estándar/Superior/Suite; los ejemplos del plan usan `DOBLE`.
- La pestaña de migración necesita los movimientos de `process-guest-data`; el detalle (C3) no los trae.
- El wireframe pide «Nombre completo» del titular; el plan exige `firstName` y `lastName` por separado (la pantalla usa Nombres/Apellidos).
- El plan permite elegir una habitación concreta (`roomId` opcional); el wireframe no lo muestra, así que la asignación es automática.
- **Contrato que falta (importante):** modificar y cancelar exigen `updatedAt` (control de concurrencia) y modificar exige
  `roomId` por habitación, pero el C3 de `check-view-reservation` no los lista. El front los lee del detalle como campos
  provisionales (`updatedAt?`, `rooms[].roomId?`); hay que agregarlos a C3 o el back responderá `CONCURRENT_UPDATE`.
- Falta la pantalla de **asignar habitación** a reservas de Booking en conflicto (`PATCH .../room-assignment`, B3).
- Documentos: el plan no admite puntos en `search` (se escribe `1144093552`, no `1.144.093.552`).
