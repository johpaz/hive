process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col } from "../packages/core/src/storage/hive";
import type {
  AgentDoc,
  McpServerDoc,
  McpToolDoc,
  ModelDoc,
  ProviderDoc,
} from "../packages/core/src/storage/collections";
import { syncMCPToolsToIndex } from "../packages/core/src/mcp/tool-sync";
import { searchKnowledgeTool } from "../packages/core/src/tools/core";
import { agentCreateTool, agentFindTool } from "../packages/core/src/tools/agents";
import { compileContext } from "../packages/core/src/agent/context-compiler";
import { mcpToolFullName } from "../packages/core/src/agent/tool-selector";
import { prepareDelegation } from "../packages/core/src/agent/delegation-runtime";
import { taskDelegateTool } from "../packages/core/src/tools/agents";

const USER_ID = "mcp-specialist-user";
const SERVER_ID = `${USER_ID}:google-workspace`;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();

  await (await col<ProviderDoc>("providers")).put("test-provider", {
    id: "test-provider",
    name: "Test Provider",
    base_url: null,
    category: "llm",
    num_ctx: null,
    num_gpu: 0,
    enabled: true,
    active: true,
    created_at: Date.now(),
  });
  await (await col<ModelDoc>("models")).put("test-model", {
    id: "test-model",
    provider_id: "test-provider",
    name: "Test Model",
    model_type: "llm",
    context_window: 32_000,
    capabilities: JSON.stringify([]),
    enabled: true,
    active: true,
    source: "discovered",
  });
  await (await col<McpServerDoc>("mcpServers")).put(SERVER_ID, {
    id: SERVER_ID,
    user_id: USER_ID,
    name: "Google Workspace",
    transport: "stdio",
    command: "test-mcp",
    args: "[]",
    url: null,
    enabled: true,
    active: true,
    builtin: false,
    status: "connected",
    tools_count: 2,
  });

  const tools = await col<McpToolDoc>("mcpTools");
  await tools.put("google-workspace__send_email", {
    id: "google-workspace__send_email",
    server_id: SERVER_ID,
    server_name: "Google Workspace",
    tool_name: "send_email",
    description: "Send an email",
    category: "mcp",
    active: true,
  });
  await tools.put("google-workspace__list_events", {
    id: "google-workspace__list_events",
    server_id: SERVER_ID,
    server_name: "Google Workspace",
    tool_name: "list_events",
    description: "List calendar events",
    category: "mcp",
    active: true,
  });
  await syncMCPToolsToIndex();
});

afterEach(() => {
  closeHiveDb();
});

describe("persistent MCP specialists", () => {
  test("MCP discovery returns the stable server id required for assignment", async () => {
    const result = await searchKnowledgeTool.execute({
      query: "email calendar",
      type: "mcp",
      limit: 10,
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.toolsmcp).toHaveLength(2);
    expect(result.toolsmcp.every((tool: any) => tool.server_id === SERVER_ID)).toBe(true);
  });

  test("agent_create assigns one MCP server and agent_find exposes it", async () => {
    const created = await agentCreateTool.execute({
      name: "Especialista externo",
      description: "Gestiona la integración asignada.",
      system_prompt: "Opera únicamente la integración Google Workspace asignada.",
      providerId: "test-provider",
      modelId: "test-model",
      mcp_server_id: SERVER_ID,
    }, {
      configurable: {
        user_id: USER_ID,
        agent_id: "coordinator",
        workspace: null,
      },
    }) as any;

    expect(created.ok).toBe(true);
    expect(created.mcpServerId).toBe(SERVER_ID);

    const stored = await (await col<AgentDoc>("agents")).get(created.agentId);
    expect(stored?.doc.source).toBe("user");
    expect(JSON.parse(stored?.doc.mcp_server_ids_json ?? "[]")).toEqual([SERVER_ID]);

    const found = await agentFindTool.execute({ search: "Google Workspace" }, {
      configurable: { user_id: USER_ID },
    }) as any;
    expect(found.agents).toHaveLength(1);
    expect(found.agents[0].mcpServerIds).toEqual([SERVER_ID]);
  });

  test("agent_create prevents duplicate specialists for the same user and server", async () => {
    const params = {
      name: "Especialista Google Workspace",
      providerId: "test-provider",
      modelId: "test-model",
      mcp_server_id: SERVER_ID,
    };
    const config = { configurable: { user_id: USER_ID, agent_id: "coordinator" } };

    expect((await agentCreateTool.execute(params, config) as any).ok).toBe(true);
    const duplicate = await agentCreateTool.execute(params, config) as any;

    expect(duplicate.ok).toBe(false);
    expect(duplicate.error.toLowerCase()).toContain("ya existe");
  });

  test("only a worker assigned to the server receives its MCP tools", async () => {
    const created = await agentCreateTool.execute({
      name: "Especialista Google Workspace",
      providerId: "test-provider",
      modelId: "test-model",
      mcp_server_id: SERVER_ID,
    }, {
      configurable: { user_id: USER_ID, agent_id: "coordinator" },
    }) as any;

    const agents = await col<AgentDoc>("agents");
    const specialist = (await agents.get(created.agentId))!.doc;
    await agents.put("ordinary-worker", {
      ...specialist,
      id: "ordinary-worker",
      name: "Worker común",
      mcp_server_ids_json: null,
      active_mcp_json: null,
    });

    const fakeManager = {
      getServerTools: (key: string) => key === SERVER_ID || key === "Google Workspace"
        ? [{
            name: "send_email",
            description: "Send an email",
            inputSchema: { type: "object", properties: {} },
          }]
        : [],
      connectServer: async () => {},
      callTool: async () => ({ ok: true }),
    } as any;

    const specialistContext = await compileContext({
      agentId: created.agentId,
      threadId: "specialist-thread",
      userMessage: "envía un correo",
      taskContext: "envía un correo",
      isolated: true,
      mcpManager: fakeManager,
    });
    const ordinaryContext = await compileContext({
      agentId: "ordinary-worker",
      threadId: "ordinary-thread",
      userMessage: "envía un correo",
      taskContext: "envía un correo",
      isolated: true,
      mcpManager: fakeManager,
    });

    const sendEmailTool = mcpToolFullName("Google Workspace", "send_email");
    expect(specialistContext.tools.map((tool) => tool.function.name)).toContain(sendEmailTool);
    expect(ordinaryContext.allTools.some((tool) => tool.name === sendEmailTool)).toBe(false);
  });

  test("delegation leases the specialist's persistent server without a public task scope", async () => {
    const created = await agentCreateTool.execute({
      name: "Especialista Google Workspace",
      providerId: "test-provider",
      modelId: "test-model",
      mcp_server_id: SERVER_ID,
    }, {
      configurable: { user_id: USER_ID, agent_id: "coordinator" },
    }) as any;
    const connected: string[] = [];
    const manager = {
      connectServer: async (id: string) => { connected.push(id); },
      disconnectServer: async () => {},
    } as any;

    const prepared = await prepareDelegation(created.agentId, {
      workspace: null,
      mcpManager: manager,
    });

    expect(prepared.mcpServerIds).toEqual([SERVER_ID]);
    expect(connected).toEqual([SERVER_ID]);
    expect((taskDelegateTool.parameters.properties as any).mcp_server_ids).toBeUndefined();
    await prepared.release();
  });

  test("the retired MCP operator is absent from the catalog and database", async () => {
    const agents = await col<AgentDoc>("agents");
    expect(await agents.get("mcp_integration_operator")).toBeUndefined();
  });
});
