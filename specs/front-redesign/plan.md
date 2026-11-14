# Implementation Plan: Rediseño visual del frontend de la Recepcionista

**Date**: 2026-11-14
**Plan base**: ../base/plan.md
**Spec**: ./spec.md

## Summary

Rediseño de la **capa visual** del frontend (`frontend/`) con la identidad hospitua. Se centralizan los
estilos en tokens CSS y piezas compartidas, se cambia el marco de navegación (rail, cabecera), el login y
la presentación de cada pantalla, y se agregan tema oscuro y adaptación a tablet y celular. **No toca el
backend, los servicios del frontend (`src/services/` salvo el tema), las rutas ni las pruebas.**

La implementación ya está en Lapicero312-lapi/HOSPITUA-MOD-2#651 (incluye la v2 de
Lapicero312-lapi/HOSPITUA-MOD-2#655). Este plan es la tarea contra la que se revisa: lo que el PR haga y
este plan no pida se quita, y lo que pida y falte se agrega (T008 y T009).

## Technical Context

- **Stack**: el del plan base para el frontend (React + Vite + React Router + TanStack Query, TypeScript
  `strict`). **Sin dependencias nuevas de interfaz**: no se agrega Tailwind, ni librerías de iconos, ni
  Three.js. Solo `@fontsource` para servir las fuentes (T008).
- **Estilos**: CSS plano con variables (custom properties). Los tokens viven en `src/index.css`; cada
  pantalla conserva su hoja (`*.css`) solo para lo propio.
- **Pruebas**: Vitest + Testing Library, sin cambios en las existentes (FR-002).
- **Navegadores**: los dos últimos de Chrome, Edge, Firefox y Safari.

## Decisiones

| # | Decisión | Por qué |
|---|---|---|
| R1 | Tokens como variables CSS en `src/index.css`, con un bloque para `:root` (claro) y otro para `:root[data-theme='dark']` | Un solo lugar para la paleta (FR-004); el tema oscuro solo cambia valores |
| R2 | Piezas compartidas con prefijo `ui-` (`ui-panel`, `ui-table`, `ui-badge` + `tone-*`, `ui-ribbon`, `ui-toolbar`, `ui-pagination`, `ui-state`, `ui-back`, `ui-button--primary/--ghost/--danger`) que las pantallas agregan como clases | Las pantallas solo agregan clases; no cambia su estructura ni sus nombres accesibles (FR-001) |
| R3 | El color de cada estado se fija en la hoja de la pantalla con las variables `--tone-*` | Mismo color en listado y detalle (FR-007) sin lógica nueva |
| R4 | El tema se guarda en `localStorage` (`hospitua.theme`) y lo aplica un script en `index.html` antes de pintar | Sin parpadeo (US4); no es un dato de negocio |
| R5 | La preferencia del rail se guarda en `localStorage` (`hospitua.rail`) | FR-012 |
| R6 | Las animaciones de entrada usan `animation-fill-mode: backwards` | Con `both` el `transform` final rompe los paneles `position: fixed` (vista previa SIRE) |
| R7 | Túa en SVG puro (`components/Concierge.tsx`), no la variante Three.js | Sin dependencias pesadas en la primera pantalla |
| R8 | El login no tiene animación de salida | FR-013: entrar sin demoras |
| R9 | Breakpoints: `< 768` celular y tablet vertical, `768–1023` tablet horizontal, `≥ 1024` escritorio | FR-016 |
| R10 | Las fuentes se sirven con `@fontsource/plus-jakarta-sans` y `@fontsource/jetbrains-mono` | FR-017: sin Google Fonts |

## Pantallas

No cambian las llamadas al backend de ninguna pantalla.

| Pantalla | Caso de uso | Qué cambia |
|---|---|---|
| Login | regla 10 | Split-screen, logo animado, Túa, panel decorativo (US3) |
| Marco (`Layout`) | base | Rail, cabecera con ubicación, tema, responsivo (US2, US4, US5) |
| Inicio | base | Accesos como tarjetas con icono |
| Consultar reservas, detalle, cancelar, modificar, nueva reserva | `check-view-reservation`, `cancel-reservation`, `update-reservation`, `generate-direct-reservation` | Piezas `ui-*`, colores de estado, cinta del resumen del día; detalle en dos columnas |
| Huéspedes alojados | `process-guest-data` | Piezas `ui-*`; detalle como panel lateral |
| Exportar SIRE | `export-sire-file` | Piezas `ui-*`; vista previa como panel lateral |
| Habitaciones, Tarifas, Agencias OTA | `consult-room-inventory`, `calculate-dynamic-rate`, `register-ota-information-commission` | Piezas `ui-*` |

## Project Structure

```text
frontend/
├── index.html                       # script del tema (R4)
├── public/favicon.svg               # isotipo oficial
└── src/
    ├── index.css                    # tokens y piezas ui-* (R1, R2)
    ├── assets/                      # imagen del panel del login
    ├── services/theme.ts            # tema claro / oscuro (R4)
    ├── components/
    │   ├── Layout.tsx, Layout.css   # rail y cabecera
    │   ├── navigation.tsx           # pantallas del menú y ubicación
    │   ├── brand.tsx                # logo e isotipo
    │   ├── Concierge.tsx, .css      # Túa (R7)
    │   ├── icons.tsx                # iconos de línea
    │   ├── LiveClock.tsx            # punto de revisión 2
    │   └── CommandPalette.tsx       # punto de revisión 1
    └── pages/…                      # cada pantalla: clases ui-* y su hoja propia
```

## Tasks

- [ ] T001 Tokens y piezas `ui-*` en `src/index.css`, con tema claro y oscuro (FR-004 a FR-008, FR-015, R1, R2)
- [ ] T002 [P] Tema: `services/theme.ts`, script en `index.html` y botón en el login y el rail (US4, R4)
- [ ] T003 Marco: rail, cabecera con ubicación, rail contraíble y responsivo (US2, US5, FR-010 a FR-012, FR-016)
- [ ] T004 [P] Logo, isotipo y favicon oficiales (FR-009)
- [ ] T005 Login: split-screen, logo animado, panel decorativo y Túa (US3, FR-013, FR-014, R7, R8)
- [ ] T006 Pantallas con piezas `ui-*` y colores de estado (US1, FR-007, R3); paneles laterales de SIRE y huéspedes (US5)
- [ ] T007 Revisión en navegador: todas las pantallas a 1440, 900 y 390 px, claro y oscuro; contraste AA (SC-003, SC-004)
- [ ] T008 Fuentes servidas desde el frontend con `@fontsource`, quitando Google Fonts de `index.html` (FR-017, R10)
- [ ] T009 Aplicar lo que decida la revisión sobre los "Puntos para decidir" de la spec (paleta ⌘K, reloj, "Nueva reserva" en la cabecera, cerrar paneles con clic fuera)

## Pruebas

- Las pruebas existentes del frontend se ejecutan sin cambios (FR-002, SC-001).
- No se agregan pruebas de estilos. Si se agrega lógica nueva (tema, preferencia del rail, paleta), se
  prueba con Vitest: el tema por defecto sigue al sistema, la elección se recuerda y una elección inválida
  en `localStorage` se ignora.
- T007 es una revisión manual con capturas, que se adjuntan al PR.
