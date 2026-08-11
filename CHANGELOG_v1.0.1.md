# Changelog — Hive 1.0.1

Fecha: 2026-08-08

Hive 1.0.1 suma la **app de escritorio** (Windows, macOS, Linux) como vía oficial de instalación sin dependencias, retira los binarios standalone de Bun de la distribución, y reemplaza el verificador independiente por checks determinísticos + juicio del coordinador. Es una versión menor, compatible con 1.0.0.

## Añadido

- **App de escritorio** (`apps/hive-desktop`, Tauri 2): shell nativo que embebe el gateway compilado como sidecar y abre la UI existente sobre HTTP/WebSocket. No requiere Bun, Node.js, Rust ni Docker instalados.
  - Instaladores por sistema: `.exe`/`.msi` (Windows, con WebView2 offline embebido), `.dmg` para Intel y Apple Silicon (macOS), `.deb`/`.rpm`/Flatpak (Linux).
  - Autoactualización vía `tauri-plugin-updater`, firmada con minisign contra el manifiesto `latest.json` publicado en cada release.
  - `docs/guides/versionado.md` (nuevo): guía completa de qué archivos llevan versión, cómo bumpearlos y cómo recuperarse de un release fallido.
- `scripts/bump-version.ts` y `scripts/generate-docs.ts` ahora sincronizan y validan también los 4 archivos de versión de la app de escritorio (`package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`), además de los 6 manifests que ya cubrían.
- `.github/workflows/release.yml`: job `resolve-tag` que permite reintentar una publicación fallida sin re-taggear (`workflow_dispatch`), y `validate-version` ahora también verifica los manifests de escritorio contra el tag.
- Sección de despliegue en VPS en `docs/guides/instalacion.md` (Docker Compose detrás de Traefik, `HIVE_DOMAIN`/`HIVE_PUBLIC_URL`, advertencia sobre `build.sh --push` en single-arch).

## Cambiado

- **Verificación de entregas**: el verificador independiente (agente aparte, hasta 24 llamadas a LLM por tarea) fue reemplazado por checks determinísticos (`acceptance-checks.ts`) evaluados junto con el juicio del propio coordinador y el flujo `task_revise`, que devuelve trabajo al mismo worker con feedback concreto en vez de repetirlo desde cero.
- La distribución oficial para usuario final pasa de binarios standalone de Bun a la app de escritorio; el paquete npm (`bun add --global @johpaz/hive-agents`) y la imagen Docker (`johpaz/hive-agents`) siguen funcionando igual que antes.
- El caso `binary` del endpoint de actualización del gateway (`packages/core/src/gateway/routes/system.ts`) ahora explica el autoupdate de la app de escritorio en vez de apuntar a un binario de Releases que ya no existe.
- El timeout por defecto de la suite de tests (`bun run test`) subió a 15s para absorber el arranque en frío de Chrome real en CI sin marcar falsos negativos.

## Eliminado

- Binarios standalone de Bun (`hive-v*`, `tool-worker.js`, `ui-dist.tar.gz`) del GitHub Release. El job `build-binaries` fue retirado de `release.yml`; `build-worker` se conserva solo como guard de CI (verifica que el worker no arrastre `@johpaz/hive-db`), sin publicar su artefacto.
- `acceptance-verifier.ts` y su ejecución como agente independiente.

## Notas de esta release

- **AppImage queda temporalmente fuera** de los instaladores de Linux: `linuxdeploy-plugin-gtk` aborta (SIGABRT) al inspeccionar el sidecar `hive-gateway` (compilado con Bun) durante el escaneo de dependencias, reproducido en CI tanto en x86_64 como en aarch64. `.deb`, `.rpm` y Flatpak no pasan por `linuxdeploy` y no se ven afectados. Se retoma en una release posterior — ver el comentario en el job `build-desktop` de `release.yml`.
- Ni el `.dmg` de macOS ni los instaladores de Windows llevan firma de código de plataforma (Apple Developer ID / Authenticode) — requiere certificados pagos que el proyecto no tiene hoy. Gatekeeper y SmartScreen muestran un aviso la primera vez; ver `docs/guides/instalacion.md` para el paso a paso de cómo continuar. Esto es independiente de la firma minisign del updater, que sí está activa y protege las actualizaciones automáticas.

## Compatibilidad

- Sin cambios incompatibles respecto a 1.0.0: `fs_*`, `task_delegate`, grupos de delegación y el resto de la superficie pública quedan igual.
- Quien instaló 1.0.0 vía `hive migrate`/`hive doctor` no necesita ninguna acción adicional; el update es transparente vía npm, Docker o (a partir de ahora) el autoupdate de la app de escritorio.
