# Instalación y actualización

## Requisitos

Para usar el repositorio se requiere Bun 1.3.x y Git. Docker o los binarios de release no necesitan un runtime JavaScript instalado.

## Desde npm con Bun

```bash
bun add --global @johpaz/hive-agents@1.0.0
hive onboard
hive start
```

## Desde el repositorio

```bash
git clone https://github.com/johpaz/hive.git
cd hive
bun install
bun run hive onboard
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
  -e HIVE_HOST=0.0.0.0 \
  johpaz/hive:1.0.0
```

El volumen conserva HiveDB, configuración, credenciales de canales y artefactos. No expongas el puerto directamente a Internet; usa un proxy TLS y conserva la autenticación.

## Binarios

Los artefactos de una release 1.0.0 siguen estos nombres:

- `hive-v1.0.0-linux-x64`
- `hive-v1.0.0-linux-arm64`
- `hive-v1.0.0-macos-x64`
- `hive-v1.0.0-macos-arm64`
- `hive-v1.0.0-windows-x64.exe`

Descárgalos desde la release correspondiente, concede permiso de ejecución en Linux/macOS y ejecuta `hive onboard`.

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
