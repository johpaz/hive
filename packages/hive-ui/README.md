# Hive UI

Interfaz React 18, TypeScript, Vite 8 y Tailwind para operar Hive.

## Desarrollo

Desde la raíz:

```bash
bun install
bun --cwd=packages/hive-ui run dev
```

Vite escucha en `5173` y redirige `/api`, `/health`, `/status` y `/ws` al gateway en `127.0.0.1:18790`.

Para usar datos reales, inicia el gateway en otra terminal:

```bash
bun run hive start
```

## Rutas principales

- `/`: dashboard.
- `/chat`: webchat.
- `/agents`: catálogo y agentes del usuario.
- `/providers`, `/channels`, `/settings`: configuración.
- `/a2ui`: Panel interactivo.
- `/office`: Oficina 3D.
- `/meeting`: reuniones.
- `/logs`, `/api-client`: operación e integración.

No existe una ruta `/canvas`: Office3D sustituyó la antigua oficina visual y
A2UI es la única superficie donde los agentes renderizan interfaces.

## Estado

La UI usa stores Zustand y React Query. El WebSocket alimenta chat, actividad de agentes, narración y A2UI. Office3D reutiliza el modelo de actividad en vivo y se carga de forma diferida para aislar Three.js.

## Validación

```bash
bun --cwd=packages/hive-ui run test
bun --cwd=packages/hive-ui run build
npx -y react-doctor@latest packages/hive-ui --verbose --diff
```

Las pruebas UI usan Vitest con jsdom. La suite raíz de Bun se limita a `tests/` para no ejecutar esos archivos con un entorno incompatible.
