# Instalación y actualización

## Requisitos

Para usar el repositorio se requiere Bun 1.3.x y Git. Docker y la app de escritorio no necesitan ningún runtime JavaScript instalado: el gateway va embebido.

## Desde npm con Bun

El paquete publicado en npm **requiere Bun** como runtime — no funciona con Node. `dist/hive.js` lleva `#!/usr/bin/env bun` y usa APIs exclusivas de Bun (`Bun.spawn`, `Bun.serve`, `Bun.file`, etc.). `npm install -g` funciona porque solo descarga el paquete, pero `hive` no arranca sin Bun instalado en el `PATH`.

```bash
bun add --global @johpaz/hive-agents@1.0.3
hive start
```

## Desde el repositorio

```bash
git clone https://github.com/johpaz/hive.git
cd hive
bun install
bun run hive start
```

Para desarrollo:

```bash
bun run dev
```

Este comando construye la UI y usa un `HIVE_HOME` de desarrollo separado.

## Docker

```bash
docker run --name hive \
  -p 18790:18790 \
  -v hive-data:/root/.hive \
  johpaz/hive-agents:1.0.3
```

El volumen conserva HiveDB, configuración, credenciales de canales y artefactos. No expongas el puerto directamente a Internet; usa un proxy TLS y conserva la autenticación.

### Despliegue en VPS

Para un servidor con dominio propio (por ejemplo detrás de Traefik), usa `docker-compose.hostinguer.yml` como referencia: agrega las labels de enrutamiento, TLS automático (`certresolver`) y cabeceras HSTS sobre el mismo `docker-compose.yml` base. Asume una red Docker externa ya creada (`n8n_evoapi` en el archivo de ejemplo — cambiala por la tuya) y toma `HIVE_DOMAIN` y opcionalmente `HIVE_PUBLIC_URL` del entorno:

```bash
docker network create n8n_evoapi   # si todavía no existe
HIVE_DOMAIN=hive.tu-dominio.com HIVE_PUBLIC_URL=https://hive.tu-dominio.com \
  docker compose -f docker-compose.hostinguer.yml up -d
```

El repo también trae utilidades de conveniencia para arrancar localmente (`hive-docker.sh`, `start.sh`) y para construir y publicar la imagen a mano (`build.sh`). Sobre `build.sh --push`: construye **solo para la arquitectura de la máquina donde corre** (sin `buildx`, sin multi-arch) — si lo corrés desde un Mac ARM, el `latest` que sube pisa el manifiesto `linux/amd64,linux/arm64` que produce el release oficial. Para un VPS, preferí siempre la imagen publicada por el pipeline de release (`johpaz/hive-agents:<versión>`) en vez de reconstruir localmente.

## App de escritorio

La app de escritorio (Windows, macOS, Linux) no requiere Bun, Docker ni Git: es un shell [Tauri](https://tauri.app) que trae el gateway embebido como proceso secundario y lo levanta al abrir la ventana.

Descarga el instalador de tu sistema desde la [última versión](https://github.com/johpaz/hive/releases/latest):

| Sistema | Instaladores |
|---|---|
| Windows | `Hive Agents_<versión>_x64-setup.exe`, `Hive Agents_<versión>_x64_en-US.msi` |
| macOS | `Hive Agents_<versión>_x86_64.dmg`, `Hive Agents_<versión>_aarch64.dmg` |
| Linux | `Hive Agents_<versión>_amd64.deb`, `Hive Agents-<versión>-1.x86_64.rpm`, `Hive-<versión>-linux-x86_64.flatpak` |

> AppImage está temporalmente fuera del release: `linuxdeploy` (la herramienta que lo empaqueta) aborta al inspeccionar nuestro sidecar del gateway, compilado con Bun — ver el comentario en `.github/workflows/release.yml` job `build-desktop`. Se retoma en un release posterior.

La app se autoactualiza: revisa nuevas versiones contra el manifiesto publicado en cada release y las instala sin pasos manuales.

### El sistema operativo advierte que el instalador no es de confianza

Los instaladores **no están firmados con un certificado de plataforma** (Apple Developer ID o Authenticode de Windows) — sí van firmados internamente para el mecanismo de autoactualización, pero eso no evita el aviso del sistema operativo en la primera instalación:

- **macOS**: Gatekeeper bloquea la app con "está dañada" o "no se puede verificar el desarrollador". Quita el atributo de cuarentena:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Hive Agents.app"
  ```
  o hacé clic derecho sobre la app → "Abrir" → confirmar en el diálogo.
- **Windows**: SmartScreen muestra "Windows protegió tu PC". Hacé clic en "Más información" → "Ejecutar de todas formas".
- **Linux**: no aplica — deb/rpm/Flatpak no pasan por ningún gatekeeper del sistema.

## Migrar desde 0.0.x

1. Detén Hive con `hive stop`.
2. Copia el directorio completo indicado por `HIVE_HOME` —por defecto `~/.hive`—.
3. Instala 1.0.0.
4. Ejecuta `hive migrate`.
5. Ejecuta `hive doctor`.
6. Arranca con `hive start` y revisa agentes, canales y servidores MCP.

El arranque repara estados interrumpidos y vuelve a sembrar catálogos del sistema sin borrar contenido de usuario. Consulta las incompatibilidades en el [changelog 1.0.0](../../CHANGELOG_v1.0.0.md).

### Migración de Canvas a A2UI

Al actualizar, el reconciliador retira del catálogo las herramientas, skills y
el agente sembrado del Canvas clásico. No es necesario borrar HiveDB ni editar
el catálogo manualmente. Los agentes pasan a usar el Panel interactivo A2UI y
la Oficina 3D queda como única vista de actividad.

Después del primer arranque:

1. Abre `/office` y comprueba que aparece la actividad del enjambre.
2. Abre `/a2ui` y crea una superficie de prueba con
   `bun scripts/a2ui-test.ts`.
3. Comprueba que tus prompts o automatizaciones no invoquen nombres
   `canvas_*`.

La ruta `/canvas` ya no existe. Los nombres internos `canvas:*` que puedan
aparecer en trazas WebSocket son identificadores de transporte conservados por
compatibilidad y no requieren una migración del usuario.

## Diagnóstico

```bash
hive status
hive doctor
hive logs --follow
```

Si ejecutas varias instancias, asigna un `HIVE_HOME` y puerto diferentes a cada una.
