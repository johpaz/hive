# Publicación del Hive SDK

Guía completa para publicar el paquete `@johpaz/hive-sdk` en npm.

---

## Visión general

El Hive SDK se publica de forma **independiente** del paquete principal `@johpaz/hive-agents`. Esto permite:

- Versionado semántico independiente
- Actualizaciones sin afectar el CLI principal
- Desarrollo iterativo de integraciones enterprise

**Script de publicación:** `scripts/publish-sdk.ts`

---

## Requisitos previos

### 1. Sesión npm autenticada

Debes tener una sesión activa en npm con permisos para publicar en `@johpaz/hive-sdk`:

```bash
# Verificar sesión actual
npm whoami

# Si no hay sesión, iniciar login
npm login
```

### 2. Permisos de publicación

Tu usuario npm debe estar en el equipo de publicación del scope `@johpaz/hive-agents`. Si no tienes permisos:

```bash
# Un admin del equipo debe ejecutar:
npm team add @johpaz/hive:publishers <tu-usuario-npm>
```

### 3. Cambios en el SDK

Asegúrate de que todos los cambios en `packages/sdk/` estén:

- ✅ Completados y probados
- ✅ Con typecheck pasando (`bun run typecheck`)
- ✅ Committeados en git

---

## Comandos de publicación

El script soporta múltiples formas de publicar:

### Publicar versión actual (sin cambiar versión)

```bash
bun run publish:sdk
```

Útil para re-publicar la misma versión (ej. si falló el publish anterior).

---

### Bump semántico y publicar

```bash
# Patch: 1.7.15 → 1.7.16 (bug fixes, cambios menores)
bun run publish:sdk patch

# Minor: 1.7.15 → 1.8.0 (nuevas features, backwards compatible)
bun run publish:sdk minor

# Major: 1.7.15 → 2.0.0 (breaking changes)
bun run publish:sdk major
```

---

### Versión explícita

```bash
# Especificar versión exacta
bun run publish:sdk 0.0.4

# Pre-release
bun run publish:sdk 2.0.0-beta.1
```

---

### Dry run (simulación)

```bash
# Simula la publicación sin hacer cambios reales
bun run publish:sdk patch --dry-run
```

Ideal para verificar que todo está correcto antes de publicar.

---

## Flujo del script

Cuando ejecutas `bun run publish:sdk`, el script realiza:

```
┌─────────────────────────────────────────────────────────────┐
│  1. Typecheck                                               │
│     Verifica que no hay errores de TypeScript               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Bump de versión (si aplica)                             │
│     Actualiza package.json del SDK                          │
│     Actualiza dependencias @johpaz/hive-* internas          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. Verificación de autenticación npm                       │
│     Ejecuta: npm whoami                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Publicación                                             │
│     Ejecuta: npm publish --access public --tag latest       │
│     O --tag next si es pre-release                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  5. Git tag (si cambió la versión)                          │
│     Crea commit y tag: sdk-vX.Y.Z                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Ejemplo de ejecución

```bash
$ bun run publish:sdk minor

📦  Hive SDK — Publicación
    Versión actual : 1.7.15
    Nueva versión  : 1.8.0

🔍  Verificando tipos...
✅  Tipos OK

🔖  Actualizando versión a 1.8.0...
✅  packages/sdk/package.json actualizado

🔐  Verificando sesión npm...
✅  Autenticado como: johpaz

🚀  Publicando @johpaz/hive-sdk@1.8.0...
+ @johpaz/hive-sdk@1.8.0

🏷️   Creando git tag sdk-v1.8.0...
✅  Tag creado. Para hacer push: git push && git push origin sdk-v1.8.0

✨  @johpaz/hive-sdk@1.8.0 publicado con éxito.
```

---

## Tags de publicación

El script determina automáticamente el tag a usar:

| Versión | Tag | Comando npm resultante |
|---------|-----|------------------------|
| `1.8.0` | `latest` | `npm publish --tag latest` |
| `2.0.0-beta.1` | `next` | `npm publish --tag next` |
| `1.9.0-rc.1` | `next` | `npm publish --tag next` |

Para instalar una versión pre-release:

```bash
npm install @johpaz/hive-sdk@next
```

---

## Git tag y push

Después de publicar, el script crea automáticamente:

- **Commit:** `chore(sdk): release vX.Y.Z`
- **Tag:** `sdk-vX.Y.Z`

**Para hacer push al repositorio:**

```bash
# Push de commits y tags
git push && git push origin sdk-v1.8.0
```

---

## Estructura del SDK

El paquete está organizado en módulos exportables:

```
packages/sdk/
├── package.json          # Configuración del paquete
├── README.md             # Documentación pública (se incluye en npm)
├── tsconfig.json         # Configuración TypeScript
└── src/
    ├── index.ts          # Entry point principal
    ├── agents/           # Ejecución de agentes, LLM
    ├── tools/            # Herramientas nativas
    ├── channels/         # Canales (Telegram, Discord, etc.)
    ├── database/         # Acceso a SQLite
    ├── mcp/              # Model Context Protocol
    ├── skills/           # Carga y gestión de skills
    ├── cron/             # Scheduler de tareas
    ├── ethics/           # Sistema de ética
    └── types/            # Tipos TypeScript
```

### Package.json del SDK

```json
{
  "name": "@johpaz/hive-sdk",
  "version": "1.8.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./agents": "./src/agents/index.ts",
    "./tools": "./src/tools/index.ts",
    ...
  }
}
```

> **Nota:** El SDK usa `.ts` directamente en lugar de `.js` compilado, permitiendo a los consumidores tener mejor soporte de tipos y debugging.

---

## Dependencias internas

El SDK depende de otros paquetes internos de Hive:

```json
{
  "dependencies": {
    "@johpaz/hive-core": "^1.8.0",
    "@johpaz/hive-mcp": "^1.8.0",
    "@johpaz/hive-skills": "^1.8.0"
  }
}
```

El script **actualiza automáticamente** estas dependencias al hacer bump de versión, manteniéndolas sincronizadas con la versión del SDK.

---

## Solución de problemas

### Error: "No estás autenticado en npm"

```bash
npm login
# Luego reintentar
bun run publish:sdk
```

### Error: "Typecheck falló"

El script se detiene si hay errores de TypeScript. Ejecuta manualmente para ver los errores:

```bash
cd packages/sdk
bun run typecheck
```

Corrige los errores antes de publicar.

### Error: "Permission denied" al publicar

Tu usuario npm no tiene permisos en el scope `@johpaz/hive`. Contacta al maintainer del paquete.

### Error: "Version already exists"

Ya publicaste esa versión. Incrementa la versión:

```bash
bun run publish:sdk patch  # o minor/major
```

### El git tag falló

El tag puede fallar si ya existe. Para limpiar y reintentar:

```bash
# Eliminar tag local (si existe)
git tag -d sdk-v1.8.0

# Reintentar publicación sin bump
bun run publish:sdk
```

---

## Publicación manual (fallback)

Si el script falla, puedes publicar manualmente:

```bash
cd packages/sdk

# 1. Typecheck
bun run typecheck

# 2. Actualizar versión en package.json (manual o con npm version)
npm version patch  # o minor/major

# 3. Publicar
npm publish --access public

# 4. Crear tag manualmente
git add package.json
git commit -m "chore(sdk): release v1.8.0"
git tag sdk-v1.8.0
git push && git push origin sdk-v1.8.0
```

---

## Verificar publicación

Después de publicar, verifica en:

- **npmjs.com:** https://www.npmjs.com/package/@johpaz/hive-sdk
- **Instalación:** `npm install @johpaz/hive-sdk@latest`

---

## Flujo recomendado

Para una publicación limpia y segura:

```bash
# 1. Asegúrate de estar en la rama correcta
git checkout main
git pull

# 2. Ejecuta tests (si existen)
bun test

# 3. Dry run para verificar
bun run publish:sdk minor --dry-run

# 4. Publicar
bun run publish:sdk minor

# 5. Push de tags
git push && git push origin sdk-v$(node -p "require('./packages/sdk/package.json').version")
```

---

## Relación con el paquete principal

| Paquete | Versión | Propósito |
|---------|---------|-----------|
| `@johpaz/hive` | 1.7.15 | CLI principal, gateway, UI |
| `@johpaz/hive-sdk` | 1.8.0 | SDK para integraciones enterprise |

Aunque comparten versión base, el SDK puede evolucionar independientemente según las necesidades de los desarrolladores que construyen sobre Hive.

---

## Recursos adicionales

- [README del SDK](../../packages/sdk/README.md) — Documentación de API completa
- [Contributing](../../CONTRIBUTING.md) — Guía de contribución
- [npm package](https://www.npmjs.com/package/@johpaz/hive-sdk)

---

**Hecho en Colombia 🇨🇴** — Construido para el mundo.
