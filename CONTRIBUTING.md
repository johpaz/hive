# Contribuir a Hive

¡Gracias por tu interés en contribuir a Hive! Este documento te ayuda a saber dónde hacer tu cambio.

## ¿Dónde hacer cambios?

| Tipo de cambio | Carpeta |
|---------------|---------|
| Canal nuevo (Telegram, Discord, WhatsApp, etc.) | `packages/core/src/channels` |
| Tool nueva (navegador, filesystem, etc.) | `packages/core/src/tools` |
| Skill nuevo (web_search, shell, memory, etc.) | `packages/core/src/skills` |
| MCP nuevo | `packages/core/src/mcp` |
| Mejora al CLI | `packages/cli/src` |
| Bug fix | Donde corresponda según el error |

## Proceso de Pull Request

1. **Fork** el repositorio
2. Crea una rama: `git checkout -b feature/mi-nueva-feature`
3. Haz tus cambios con pruebas si es posible
4. Asegúrate de que pasa el lint: `bun run lint`
5. Abre un PR describiendo tu cambio

Todos los cambios se revisan en un solo lugar. Un PR. Una revisión. Un merge.

## Ejecutar en desarrollo

```bash
bun install
bun run dev
```

## Commands disponibles

```bash
bun run dev        # Modo desarrollo
bun run start      # Iniciar gateway
bun run test       # Ejecutar tests
bun run lint       # Verificar tipos
```

---

¿Dudas? Únete a nuestro [Discord](https://discord.gg/hive) o abre un issue.
