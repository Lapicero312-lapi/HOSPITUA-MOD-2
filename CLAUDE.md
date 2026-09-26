# CLAUDE.md

Instrucciones de trabajo para Claude Code en este repositorio.

## Flujo de ramas (Gitflow)

- `main` es solo para versiones estables. Nunca se hacen commits directos ahí.
- `develop` es la rama de integración. Tampoco se hacen commits directos ahí.
- No se crean ramas por cuenta propia ni una por cada spec. Solo se crea una rama
  `feature/` cuando el usuario lo pide explícitamente, y con el nombre que el usuario indique.
- Una misma feature puede abarcar varias specs u otros cambios: se sigue trabajando en la
  rama `feature/` actual hasta que el usuario diga que se cierra o que se empieza otra.
- Las ramas `feature/` siempre se crean desde `develop` actualizado (`git pull` antes de
  crear la rama).
- Las correcciones urgentes de producción van en `hotfix/nombre` creadas desde `main`,
  también solo cuando el usuario lo pida explícitamente.
- Mensajes de commit claros y en español, con prefijo de tipo: `feat: ...`, `fix: ...`,
  `refactor: ...`, `docs: ...`, etc.
- Nunca hacer `push` ni `merge` sin que el usuario lo confirme explícitamente.
