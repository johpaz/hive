# Versionado y releases

Hive usa un único número de versión (semver) para todo lo que se publica en una release: el paquete npm, la imagen Docker y la app de escritorio. Este documento describe qué archivos lo llevan, cómo se bumpea y cómo se dispara una publicación.

## Qué archivos llevan versión

`bun scripts/bump-version.ts` sincroniza estos 9 archivos en un solo paso:

| Archivo | Formato |
|---|---|
| `package.json` | JSON — fuente de verdad para npm |
| `packages/cli/package.json` | JSON |
| `packages/core/package.json` | JSON |
| `packages/mcp/package.json` | JSON |
| `packages/skills/package.json` | JSON |
| `packages/hive-ui/package.json` | JSON |
| `apps/hive-desktop/package.json` | JSON |
| `apps/hive-desktop/src-tauri/tauri.conf.json` | JSON |
| `apps/hive-desktop/src-tauri/Cargo.toml` | TOML — línea `version = "..."` de `[package]` |

Además reescribe con regex las menciones en prosa: el badge y los comandos de ejemplo en `README.md`, y los mismos comandos en `docs/guides/instalacion.md`.

`apps/hive-desktop/src-tauri/Cargo.lock` también se actualiza (el bloque `[[package]] name = "hive-desktop"`), aunque no es estrictamente necesario: `cargo build`/`cargo tauri build` lo regenera solo la próxima vez que corra, siempre que no se use `--locked`.

**Por qué la app de escritorio importa tanto como npm**: vive en `apps/hive-desktop`, fuera de `workspaces` (que solo cubre `packages/*`), así que ningún mecanismo de Bun la sincroniza automáticamente. Si su versión queda atrás, dos cosas se rompen:

1. `bun run docs:check` (`scripts/generate-docs.ts`) falla — valida que los 8 manifests JSON y el `Cargo.toml` coincidan con `package.json`.
2. El job `validate-version` de `release.yml` aborta el release: compara el tag contra `package.json` **y** contra `tauri.conf.json`/`Cargo.toml`.

Si en cambio queda desincronizada en silencio (sin que ningún check la agarre), el updater de Tauri anuncia una versión que el binario instalado ya cree tener — y ofrece la misma actualización en bucle.

## Cómo bumpear

```bash
# Incrementa patch/minor/major sobre la versión actual de @johpaz/hive-agents-core
bun scripts/bump-version.ts patch
bun scripts/bump-version.ts minor
bun scripts/bump-version.ts major

# O fija una versión explícita
bun scripts/bump-version.ts 1.2.0
```

Sin flags, el script **no toca git**: solo edita los 9 archivos + la prosa, y regenera `docs/reference/inventario.md`. Revisá el diff vos mismo.

```bash
bun scripts/bump-version.ts 1.0.1 --dry-run   # solo muestra qué cambiaría
```

## Flujo de release, paso a paso

1. **Bump local** (sin `--push`), revisar `git diff` a mano.
2. `bun install` — por si `bun.lock` quedó con las versiones de workspace desactualizadas (no rompe `--frozen-lockfile`, pero conviene mantenerlo al día).
3. Verificar en local antes de comprometerse a nada:
   ```bash
   bun run lint && bun run test && bun run docs:check
   ```
4. Commitear el resultado del bump con normalidad (no hace falta usar `--push` para el commit).
5. Publicar el release:
   ```bash
   bun scripts/bump-version.ts 1.0.1 --push
   ```
   Esto agrega lo que quede sin commitear, commitea como `chore: release v1.0.1`, crea el tag `v1.0.1` y hace push de `master` + el tag — pero antes pide confirmación explícita (hay que escribir `si`). Si el tag ya existe localmente, el script aborta: es la señal de que esa versión ya se publicó antes.

El push del tag `v*.*.*` dispara `.github/workflows/release.yml`, que construye y publica en paralelo: paquete npm, imagen Docker (`linux/amd64` + `linux/arm64`) e instaladores de escritorio para Windows, macOS (x64 + arm64) y Linux (AppImage, deb, rpm, Flatpak).

## Verificar que una release salió bien

```bash
npm view @johpaz/hive-agents version
docker run --rm johpaz/hive-agents:<versión> --version
curl -s https://api.github.com/repos/johpaz/hive/releases/latest | grep '"name"'
```

El GitHub Release debe traer únicamente instaladores de escritorio (`.deb`, `.rpm`, `.AppImage`, `.dmg`, `.exe`, `.msi`, `.flatpak`), `latest.json` (el manifiesto del updater) y `checksums.txt`. Los binarios standalone de Bun ya no se publican — la instalación sin dependencias es la app de escritorio; el paquete npm y Docker cubren el resto.

## Recuperarse de una release fallida

`release.yml` dispara únicamente con `push` de un tag `v*.*.*`. Si un job falla a mitad de camino, también se puede relanzar manualmente sin crear un tag nuevo:

- **GitHub → Actions → Release → Run workflow**, indicando el tag ya existente (ej. `v1.0.1`).
- Equivalente por CLI: `gh workflow run release.yml -f tag=v1.0.1` (requiere `gh` instalado y autenticado).

El primer job (`resolve-tag`) resuelve el tag pedido y lo usa en el resto del pipeline — no hace falta re-taggear ni forzar push para reintentar.

Si en cambio el problema está en los archivos (versión mal sincronizada, un manifest mal armado), corregí el código, y solo si el tag fallido **nunca llegó a publicar nada** (sin paquete npm, sin imagen Docker, sin GitHub Release), es seguro borrarlo y recrearlo:

```bash
git push origin :refs/tags/v1.0.1   # borra el tag remoto
git tag -d v1.0.1                   # borra el tag local
# ... corregir, commitear ...
git tag v1.0.1 && git push origin master && git push origin v1.0.1
```

Si el tag **sí** llegó a publicar algo (aunque sea parcialmente), no lo reescribas: publicá una versión nueva en su lugar. Un tag que ya fue consumido (por `npm install`, un `docker pull`, o alguien que ya se bajó un instalador) no debe cambiar de contenido bajo el mismo número.
