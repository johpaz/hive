# @johpaz/hive-sdk

SDK oficial para construir sobre [Hive](https://github.com/johpaz/hive) — el runtime de agentes IA local-first multi-canal.

Expone toda la funcionalidad interna de Hive como una API organizada por módulos, pensada para integraciones enterprise, extensiones personalizadas y proyectos que necesitan construir sobre el núcleo de Hive.

## Instalación

```bash
npm install @johpaz/hive-sdk
# o
bun add @johpaz/hive-sdk
```

> **Requisito:** Hive debe estar inicializado en el sistema (base de datos, onboarding). El SDK opera sobre la instalación existente de Hive.

---

## Módulos

El SDK está dividido en módulos independientes que se pueden importar por separado:

| Módulo | Import | Descripción |
|---|---|---|
| [agents](#agents) | `@johpaz/hive-sdk/agents` | Ejecución de agentes, loop nativo, LLM |
| [tools](#tools) | `@johpaz/hive-sdk/tools` | Todas las herramientas nativas por categoría |
| [channels](#channels) | `@johpaz/hive-sdk/channels` | Adaptadores de canales (Telegram, Discord…) |
| [database](#database) | `@johpaz/hive-sdk/database` | Acceso a SQLite, esquemas, crypto |
| [mcp](#mcp) | `@johpaz/hive-sdk/mcp` | Cliente MCP (Model Context Protocol) |
| [skills](#skills) | `@johpaz/hive-sdk/skills` | Carga y gestión de skills |
| [cron](#cron) | `@johpaz/hive-sdk/cron` | Scheduler de tareas programadas |
| [ethics](#ethics) | `@johpaz/hive-sdk/ethics` | Sistema de ética constitucional |
| [types](#types) | `@johpaz/hive-sdk/types` | Todos los tipos TypeScript |

También puedes importar todo de una vez:

```ts
import * as HiveSDK from "@johpaz/hive-sdk";
```

---

## agents

```ts
import {
  runAgent,
  runAgentIsolated,
  AgentService,
  compileContext,
  callLLM,
} from "@johpaz/hive-sdk/agents";
```

### Ejecutar un agente

```ts
import { runAgent } from "@johpaz/hive-sdk/agents";

const response = await runAgent({
  agentId: "main",          // ID del agente en la DB
  message: "Hola, agente",
  threadId: "thread-abc",   // sesión de conversación
});

console.log(response.text);
```

### Ejecutar un agente aislado (worker)

Corre el agente en un worker separado sin acceso al estado del coordinador:

```ts
import { runAgentIsolated } from "@johpaz/hive-sdk/agents";

const result = await runAgentIsolated({
  agentId: "researcher",
  message: "Investiga X y devuelve un resumen",
  threadId: "isolated-thread",
});
```

### Llamar al LLM directamente

```ts
import { callLLM, resolveProviderConfig } from "@johpaz/hive-sdk/agents";
import type { LLMMessage } from "@johpaz/hive-sdk/agents";

const messages: LLMMessage[] = [
  { role: "user", content: "¿Cuál es la capital de Colombia?" },
];

const config = await resolveProviderConfig(agentId);
const response = await callLLM({ messages, ...config });

console.log(response.content);
```

### Historial de conversación

```ts
import {
  addMessage,
  getHistory,
  getRecentMessages,
} from "@johpaz/hive-sdk/agents";

// Agregar mensaje
await addMessage("thread-abc", "user", "Hola");

// Leer historial completo
const history = await getHistory("thread-abc");

// Leer los últimos N mensajes
const recent = await getRecentMessages("thread-abc", 10);
```

### Compilar contexto del sistema

```ts
import { compileContext } from "@johpaz/hive-sdk/agents";

const { systemPrompt, tools } = await compileContext({
  agentId: "main",
  userId: "user-1",
  threadId: "thread-abc",
});
```

### Gestión de AgentService

```ts
import { createAgentService, getAgentService } from "@johpaz/hive-sdk/agents";

const service = await createAgentService({ agentId: "main" });
// o
const existing = getAgentService("main");
```

---

## tools

```ts
import { createAllTools, createToolsByCategory } from "@johpaz/hive-sdk/tools";
```

### Crear todas las herramientas

```ts
import { createAllTools } from "@johpaz/hive-sdk/tools";

const tools = createAllTools({ userId: "user-1", agentId: "main" });
```

### Por categoría

```ts
import { createToolsByCategory } from "@johpaz/hive-sdk/tools";

const fsTools = createToolsByCategory("filesystem", config);
const webTools = createToolsByCategory("web", config);
```

### Herramientas disponibles

**Filesystem**
```ts
import { fsReadTool, fsWriteTool, fsEditTool, fsDeleteTool, fsListTool, fsGlobTool, fsExistsTool } from "@johpaz/hive-sdk/tools";
```

**Web**
```ts
import { webSearchTool, webFetchTool, browserNavigateTool, browserScreenshotTool, browserClickTool, browserTypeTool } from "@johpaz/hive-sdk/tools";
```

**Proyectos y tareas**
```ts
import { projectCreateTool, projectListTool, projectUpdateTool, projectDoneTool, projectFailTool, taskCreateTool, taskUpdateTool, taskEvaluateTool } from "@johpaz/hive-sdk/tools";
```

**Agentes y memoria**
```ts
import { agentCreateTool, agentFindTool, agentArchiveTool, taskDelegateTool, taskDelegateCodeTool, taskStatusTool, memoryWriteTool, memoryReadTool, memoryListTool, memorySearchTool, memoryDeleteTool, busPublishTool, busReadTool, projectUpdatesTool } from "@johpaz/hive-sdk/tools";
```

**Canvas (UI)**
```ts
import { canvasRenderTool, canvasAskTool, canvasConfirmTool, canvasShowCardTool, canvasShowProgressTool, canvasShowListTool, canvasClearTool } from "@johpaz/hive-sdk/tools";
```

**Code Bridge**
```ts
import { codebridgeLaunchTool, codebridgeStatusTool, codebridgeCancelTool } from "@johpaz/hive-sdk/tools";
```

**Voz**
```ts
import { voiceTranscribeTool, voiceSpeakTool } from "@johpaz/hive-sdk/tools";
```

**Core**
```ts
import { searchKnowledgeTool, notifyTool, saveNoteTool, reportProgressTool } from "@johpaz/hive-sdk/tools";
```

**Cron**
```ts
import { cronAddTool, cronListTool, cronEditTool, cronRemoveTool } from "@johpaz/hive-sdk/tools";
```

**CLI**
```ts
import { cliExecTool } from "@johpaz/hive-sdk/tools";
```

---

## channels

```ts
import { ChannelManager, TelegramChannel, DiscordChannel } from "@johpaz/hive-sdk/channels";
```

### Registrar un canal personalizado

```ts
import { ChannelManager } from "@johpaz/hive-sdk/channels";
import type { IncomingMessage, MessageHandler } from "@johpaz/hive-sdk/channels";

const manager = new ChannelManager(config);

manager.onMessage(async (msg: IncomingMessage) => {
  console.log("Mensaje recibido:", msg.text);
});

await manager.startAll();
```

### Canales disponibles

```ts
import {
  TelegramChannel,   // Bot de Telegram (grammy)
  DiscordChannel,    // Bot de Discord
  WhatsAppChannel,   // WhatsApp (Baileys)
  SlackChannel,      // Slack (Bolt)
  WebChatChannel,    // WebChat HTTP/WS
} from "@johpaz/hive-sdk/channels";
```

---

## database

```ts
import { getDb, initializeDatabase, dbService } from "@johpaz/hive-sdk/database";
```

### Acceder a la base de datos

```ts
import { getDb, initializeDatabase } from "@johpaz/hive-sdk/database";

// Inicializar (crear tablas si no existen)
initializeDatabase();

// Instancia raw de bun:sqlite
const db = getDb();
const rows = db.query("SELECT * FROM agents").all();
```

### Usar el servicio de DB

```ts
import { dbService } from "@johpaz/hive-sdk/database";

const agents = dbService.getUserAgents(userId);
const project = dbService.getProjectWithTasks(projectId);
```

### Queries de onboarding

```ts
import {
  getAllProviders,
  getAllModels,
  getAllChannels,
  getAllMcpServers,
  getActiveTools,
  getUserAgents,
  getCoordinatorAgentId,
  resolveUserId,
  resolveAgentId,
} from "@johpaz/hive-sdk/database";

const providers = getAllProviders();
const agentId = await resolveAgentId("main");
```

### Crypto

```ts
import { encryptApiKey, decryptApiKey, hashPassword, verifyPassword } from "@johpaz/hive-sdk/database";

const encrypted = encryptApiKey("sk-...");
const decrypted = decryptApiKey(encrypted);

const hash = hashPassword("secret");
const valid = verifyPassword("secret", hash);
```

### Seed / Reset

```ts
import { seedAllData, seedToolsAndSkills } from "@johpaz/hive-sdk/database";

// Poblar la DB con datos iniciales (idempotente)
await seedAllData();

// Solo tools y skills
await seedToolsAndSkills();
```

---

## mcp

```ts
import { MCPClientManager } from "@johpaz/hive-sdk/mcp";
import type { MCPConfig } from "@johpaz/hive-sdk/mcp";
```

### Conectar a un servidor MCP

```ts
import { MCPClientManager } from "@johpaz/hive-sdk/mcp";

const manager = new MCPClientManager({
  servers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    },
  },
});

await manager.connect();

const tools = manager.getTools();        // herramientas del servidor
const resources = manager.getResources(); // recursos disponibles
```

---

## skills

```ts
import { SkillLoader, createSkillLoader } from "@johpaz/hive-sdk/skills";
```

### Cargar skills

```ts
import { createSkillLoader } from "@johpaz/hive-sdk/skills";

const loader = createSkillLoader({
  workspacePath: "/path/to/workspace",
});

const skills = await loader.loadAll();

for (const skill of skills) {
  console.log(skill.name, skill.description);
}
```

### Ejecutar un skill

```ts
const result = await loader.run("my-skill", {
  input: "contexto del agente",
});
```

---

## cron

```ts
import { initCronScheduler, resolveBestChannel, createCronTools } from "@johpaz/hive-sdk/cron";
```

### Inicializar el scheduler

```ts
import { initCronScheduler } from "@johpaz/hive-sdk/cron";

initCronScheduler(async (job) => {
  // Se ejecuta cuando vence un cron job
  console.log("Ejecutando job:", job.name);
  await runAgent({ agentId: job.agentId, message: job.prompt, threadId: job.id });
});
```

### Herramientas de cron

```ts
import { cronAddTool, cronListTool, cronEditTool, cronRemoveTool } from "@johpaz/hive-sdk/cron";
```

---

## ethics

```ts
import { getAllEthics, activateEthics } from "@johpaz/hive-sdk/ethics";
```

### Gestionar reglas éticas

```ts
import { getAllEthics, activateEthics } from "@johpaz/hive-sdk/ethics";

// Leer todas las reglas
const rules = getAllEthics();

// Activar/desactivar un conjunto de reglas
activateEthics("default");
```

---

## types

Importa cualquier tipo de TypeScript sin traer código de ejecución:

```ts
import type {
  // Agentes
  AgentDBRecord,
  AgentServiceConfig,
  AgentLoopOptions,
  StepEvent,
  StreamChunk,

  // LLM
  LLMMessage,
  LLMResponse,
  LLMCallOptions,
  LLMToolCall,

  // Canales
  IncomingMessage,
  OutboundMessage,
  ChannelConfig,
  IChannel,

  // MCP
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPConfig,
  MCPServerConfig,

  // Skills
  Skill,
  SkillMetadata,
  SkillStep,
  SkillExample,
  SkillsConfig,

  // Conversación
  StoredMessage,
} from "@johpaz/hive-sdk/types";
```

---

## Ejemplo completo

Agente personalizado que escucha en Telegram y responde usando el loop nativo:

```ts
import { initializeDatabase } from "@johpaz/hive-sdk/database";
import { TelegramChannel } from "@johpaz/hive-sdk/channels";
import { runAgent } from "@johpaz/hive-sdk/agents";

// 1. Inicializar DB
initializeDatabase();

// 2. Crear canal
const telegram = new TelegramChannel({
  token: process.env.TELEGRAM_BOT_TOKEN!,
});

// 3. Manejar mensajes
telegram.onMessage(async (msg) => {
  const response = await runAgent({
    agentId: "main",
    message: msg.text,
    threadId: `telegram:${msg.chatId}`,
  });

  await telegram.send({ chatId: msg.chatId, text: response.text });
});

await telegram.start();
console.log("Bot activo");
```

---

## Publicación

```bash
# Publicar la versión actual
bun run publish:sdk

# Bump y publicar
bun run publish:sdk patch
bun run publish:sdk minor
bun run publish:sdk major

# Versión explícita
bun run publish:sdk 2.0.0

# Simular sin publicar
bun run publish:sdk patch --dry-run
```

El script (`scripts/publish-sdk.ts`) ejecuta typecheck, actualiza `package.json`, verifica la sesión npm, publica y crea un git tag `sdk-vX.Y.Z` automáticamente.

---

## Licencia

MIT — construido desde Colombia para el mundo.
