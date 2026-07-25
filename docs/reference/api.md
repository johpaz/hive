# API HTTP y WebSocket

El gateway expone la UI y APIs operativas en el mismo puerto. El valor predeterminado es `http://127.0.0.1:18790`.

## Autenticación

Salvo onboarding, estado de autenticación, login, recuperación y health, las rutas requieren un token o sesión válida.

```bash
curl -H "Authorization: Bearer $HIVE_AUTH_TOKEN" \
  http://127.0.0.1:18790/status
```

## Grupos de rutas

| Grupo | Prefijo | Uso |
|---|---|---|
| Salud y estado | `/health`, `/status`, `/api/version` | Operación |
| Setup y auth | `/api/setup/*`, `/api/auth/*` | Onboarding y acceso |
| Chat | `/api/chat`, `/api/chat/history`, `/ws` | Conversación y eventos |
| Agentes y tareas | `/api/agents`, `/api/tasks` | Catálogo y ejecución |
| Configuración | `/api/config`, `/api/providers`, `/api/models` | Runtime de modelos |
| Capacidades | `/api/tools`, `/api/skills`, `/api/mcp/servers` | Inventario y MCP |
| Canales | `/api/channels` | Cuentas y conexiones |
| Cron | `/api/cron` | Automatizaciones |
| Actividad y A2UI | `/ws` | Oficina 3D, superficies y acciones |
| Voz | `/api/voice`, `/api/tts-local` | Configuración de producto |
| Reuniones | `/api/meetings`, `/meeting-stream` | Captura y reportes |

## WebSocket

`/ws` transporta chat streaming, estado de agentes, narración y A2UI. Los consumidores deben tolerar eventos adicionales y correlacionar por IDs en lugar de depender del orden global.

El Panel interactivo recibe eventos `a2ui:createSurface`,
`a2ui:updateComponents`, `a2ui:updateDataModel` y `a2ui:deleteSurface`. Las
acciones del usuario regresan como `a2ui:action`.

La suscripción al grafo de actividad y algunos eventos de sesión conservan
nombres internos con el prefijo `canvas` por compatibilidad. Ese prefijo no
expone una API Canvas: no existe un endpoint HTTP `/api/canvas` ni una ruta de
UI `/canvas`.

`/meeting-stream` está separado porque transporta el flujo de captura de reuniones.

## Estabilidad

Los exports de paquetes listados en el [inventario](inventario.md) forman la superficie técnica publicada. Las rutas usadas exclusivamente por la UI son internas en 1.0 y pueden evolucionar; las integraciones externas deben preferir health, status, chat y las rutas de recursos documentadas.
