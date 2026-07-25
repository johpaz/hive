# Arquitectura general

Hive es un monorepo TypeScript ejecutado con Bun:

- `packages/cli`: comandos, adaptadores de instalación y ciclo del gateway.
- `packages/core`: agentes, gateway, storage, canales, herramientas y runtime.
- `packages/hive-ui`: aplicación React/Vite.
- `packages/mcp`: transportes y administración MCP.
- `packages/skills`: loader y skills incluidas.

## Componentes

```text
CLI / UI / canales
        │
        ▼
Gateway HTTP + WebSocket
        │
        ├── Agent Service ──► loop / contexto / modelos
        │                         │
        │                         ├── herramientas nativas
        │                         ├── pool de workers
        │                         └── MCP
        │
        ├── Harness durable ──► jobs / leases / reintentos
        ├── Actividad Office3D / A2UI / reuniones / voz
        └── HiveDB ──► configuración, catálogo, runs, memoria y evidencia
```

## Fuente de verdad

HiveDB es la única base persistente del runtime. Almacena documentos por colección y mantiene índices para búsquedas y reconciliación. No existe una base SQLite ni FTS5 paralela.

El arranque:

1. Abre y asegura colecciones e índices.
2. Siembra proveedores, modelos, herramientas, skills, playbook y agentes de catálogo.
3. Reconcilia filas retiradas o incompletas.
4. Recupera runs, jobs y reuniones interrumpidos según sus leases.
5. Inicia canales, cron, MCP y gateway.

## Artefactos

Capturas y otra evidencia binaria se escriben en:

```text
HIVE_HOME/artifacts/YYYY-MM-DD/
```

HiveDB guarda ID, propietario, run/tarea, MIME, tamaño, SHA-256, fechas y estado. El binario expira después de siete días; los metadatos permanecen para auditoría y muestran si el archivo expiró o falta.

## UI

La UI incluye dashboard, chat, agentes, proveedores, canales, configuración, logs, cliente API, Panel interactivo, reuniones y Office3D. Las rutas pesadas se cargan de forma diferida; Three.js viaja en el chunk de Office3D.

Office3D consume el grafo de actividad en vivo. Un driver mantiene posiciones orbitales mutables y el resto de la escena lee esas posiciones sin provocar renders de React por frame.

El Panel interactivo consume superficies A2UI v0.9 y sus data models. El
registro de sesión mantiene el snapshot necesario para clientes que se conectan
tarde. Office3D y A2UI comparten transporte y sesión, pero no componentes ni
responsabilidades de producto: Office3D observa la ejecución y A2UI presenta e
intercambia información con el usuario.

La implementación conserva el nombre histórico `canvas` en algunos módulos y
eventos internos del registro de sesión. Es un detalle de compatibilidad, no
una tercera superficie de UI.
