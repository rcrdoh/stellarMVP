# AGENTS

Reglas estrictas para agentes que modifiquen esta base Bun/TypeScript.

## Antes de cambiar codigo

- Lee `README.md`, `docs/sdd.md`, `docs/solid.md`, `docs/errors.md` y la
  carpeta relacionada al cambio.
- Si el cambio usa Bun, TypeScript, Fastify, Zod, Biome, Prisma u otro recurso
  externo, revisa su documentacion oficial o primaria antes de implementar y
  aplica el patron recomendado para este repo.
- Declara supuestos concretos si la instruccion del usuario es ambigua. En modo
  plan, indica que el usuario puede corregir esos supuestos; en una prompt
  puntual, indica que puede detenerte o corregirte.

## Estructura y diseño

- No rompas la estructura por capas: `src/http` transporte, `src/config`
  configuracion, `src/domain` dominio puro, `src/services` casos de uso,
  `src/integrations` adaptadores.
- Respeta SOLID: los servicios dependen de interfaces, no de adaptadores
  concretos; no pongas reglas de negocio en rutas Fastify.
- Respeta SDD: cambios de contrato primero en `specs/openapi.json`, luego
  implementacion, pruebas y documentacion.
- Si un cambio afecta docs, specs o taxonomia, propagalo a las subcarpetas
  relacionadas. Un cambio puntual debe actualizar el README/doc asociado a esa
  carpeta o archivo.

## Pruebas

- Pruebas permanentes van en `tests/` o `tests/contract/`.
- Si necesitas materializar una prueba volatil, avisa al usuario y guardala en
  `tmp/`; no la mezcles con pruebas permanentes salvo que el usuario lo pida o
  aceptes convertirla en test estable.
- Recomienda prueba permanente cuando el cambio cubra contrato, bug o
  comportamiento esperado.
- Todo cambio debe probarse antes de cerrar. Minimo esperado:

```bash
bun run spec:check
bun test
bun run check-types
bun run check
```

## Documentacion y operacion

- Si las pruebas pasan, actualiza la documentacion relacionada antes de terminar.
- No guardes secretos en TOML, `.env.example`, docs ni tests.
- No dejes servidores, contenedores o procesos en ejecucion sin informarlo.

## Entorno local

- Si `node`, `npm`, `curl` o `bun` fallan con errores de `GLIBCXX`/`OPENSSL` o
  librerias faltantes, revisa `LD_LIBRARY_PATH`; un valor espurio apuntando a
  `/tmp/_MEI*` rompe el enlazado dinamico. Ejecuta las herramientas con
  `LD_LIBRARY_PATH= ...` para restaurar los enlaces del sistema.

## Git Feature Branch Workflow

As the OpenHands agent, use this workflow when implementing a feature requested
in chat. The feature branch itself is the deliverable — no pull request is
needed.

### 1. Create Branch
Create a new git branch with this naming pattern:
agent/task-{TIMESTAMP}-{feature-name}
Example: `agent/task-1704067200-auth-feature`

Command:
```bash
git checkout -b agent/task-$(date +%s)-{feature-name}
```

### 2. Implement Feature
Write the code for the requested feature:
- Create new files as needed
- Follow existing code patterns
- Add comments where appropriate

### 3. Commit Code
Commit your changes with a clear message:
```bash
git commit -m "[AGENT:feature-name] {description of what was implemented}

Co-authored-by: openhands <openhands@all-hands.dev>"
```

### 4. Push Branch
Push your branch to remote:
```bash
git push origin agent/task-{TIMESTAMP}-{feature-name}
```

The code is now in its own feature branch, ready for review. No pull request
is created — the branch is published and handled separately.