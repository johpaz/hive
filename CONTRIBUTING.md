# Contribuir a Hive

## Preparación

```bash
git clone https://github.com/johpaz/hive.git
cd hive
bun install
```

Usa Bun 1.3.x. Para ejecutar una instancia aislada:

```bash
HIVE_HOME=/tmp/hive-dev bun run hive start
```

No uses un directorio de datos personal para tests destructivos.

## Estructura

- `packages/core`: gateway y runtime.
- `packages/cli`: CLI y distribución.
- `packages/hive-ui`: React/Vite.
- `packages/mcp`: cliente y transportes MCP.
- `packages/skills`: skills incluidas.
- `tests`: suite Bun del runtime.
- `docs`: documentación canónica.

## Flujo de cambios

1. Lee el código y los tests del subsistema.
2. Conserva cambios locales no relacionados.
3. Añade una reproducción para bugs o tests de comportamiento para funciones nuevas.
4. Haz el cambio mínimo en la fuente del problema.
5. Actualiza documentación y changelog cuando cambie una interfaz.
6. Ejecuta las validaciones relevantes.

```bash
bun run lint
bun run test
bun run test:ui
bun run docs:check
bun run build
```

Después de cambios React ejecuta:

```bash
npx -y react-doctor@latest packages/hive-ui --verbose --diff
```

## Documentación

No copies inventarios manualmente. Modifica la fuente correspondiente y ejecuta:

```bash
bun run docs:generate
bun run docs:check
```

Los `SKILL.md` solo pueden declarar tools existentes y agentes preferidos del catálogo. Mantén ejemplos en español o bilingües cuando la skill ya lo sea.

## Commits y releases

`scripts/bump-version.ts` (sin `--push`) solo edita manifests y prosa — no toca git. Con `--push` sí commitea, tagea y hace push, pero pide confirmación explícita antes de publicar. La publicación real (npm, Docker, instaladores de escritorio) ocurre exclusivamente en `.github/workflows/release.yml`, disparado por el push del tag. Ver la [guía de versionado](docs/guides/versionado.md) para el flujo completo.
