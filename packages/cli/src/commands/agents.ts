import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import { loadConfig, getHiveDir } from "@johpaz/hiveAgents-core/config/loader";

const getAgentsPath = () => path.join(getHiveDir(), "agents");

interface AgentConfig {
  id: string;
  name: string;
  default?: boolean;
  workspace: string;
  agentDir: string;
}

interface AgentState {
  id: string;
  name: string;
  type: "primary" | "child" | "sibling";
  state: "active" | "hibernated" | "terminated";
  purpose: string;
  parentId?: string;
  childrenIds: string[];
  workspacePath: string;
  createdAt: string;
  lastActivity: string;
  capabilities: string[];
}

async function loadLifecycleAgents(): Promise<AgentState[]> {
  const agents: AgentState[] = [];
  try {
    if (!fs.existsSync(getAgentsPath())) return [];
    const entries = fs.readdirSync(getAgentsPath(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const statePath = path.join(getAgentsPath(), entry.name, "state.json");
      try {
        const content = fs.readFileSync(statePath, "utf-8");
        agents.push(JSON.parse(content) as AgentState);
      } catch { }
    }
  } catch { }
  return agents;
}

export async function agents(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "add":
      await addAgent(args[0]);
      break;
    case "create":
      await createAgent(args);
      break;
    case "list":
    case "ls":
      await listAgents(args.includes("--bindings"));
      break;
    case "logs":
      await showLogs(args[0]);
      break;
    case "hibernate":
      await hibernateAgent(args[0]);
      break;
    case "wake":
      await wakeAgent(args[0]);
      break;
    case "terminate":
    case "kill":
      await terminateAgent(args[0], args.includes("--cascade"));
      break;
    case "tree":
      await showTree();
      break;
    case "remove":
      await removeAgent(args[0]);
      break;
    default:
      console.log(`
Usage: hive agents <command> [arguments]

Commands:
  list, ls                    List all agents
  add <id>                    Create agent (legacy)
  create                      Create agent with new lifecycle system
  logs <agent-id>             Show agent logs
  hibernate <agent-id>        Put agent to sleep
  wake <agent-id>             Wake a hibernated agent
  terminate <agent-id> [--cascade]  Terminate an agent
  tree                        Show agent hierarchy tree
  remove <id>                 Remove agent (legacy)

Examples:
  hive agents list
  hive agents create
  hive agents tree
  hive agents hibernate agent-abc123
  hive agents wake agent-abc123
  hive agents terminate agent-abc123 --cascade
`);
  }
}

async function createAgent(args: string[]): Promise<void> {
  const name = args[0] || await promptInput("Agent name:", `agent-${Date.now()}`);
  const purpose = args[1] || await promptInput("Purpose:", "General AI assistant");

  const agentId = `agent-${crypto.randomUUID().slice(0, 8)}`;
  const workspacePath = path.join(getAgentsPath(), agentId);

  fs.mkdirSync(path.join(workspacePath, "memory"), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, "skills"), { recursive: true });
  fs.mkdirSync(path.join(workspacePath, "logs"), { recursive: true });

  const soulMd = `# SOUL.md - ${name}

## Identity

I am ${name}, created to ${purpose.toLowerCase()}.

## Personality

- Helpful and responsive
- Clear communicator
- Adaptable to user needs
`;

  const ethicsMd = `# ETHICS.md

## Core Principles

1. Honesty - Never deceive the user
2. Privacy - Protect user data
3. Safety - Prevent harm
4. Consent - Ask before significant actions
`;

  fs.writeFileSync(path.join(workspacePath, "SOUL.md"), soulMd);
  fs.writeFileSync(path.join(workspacePath, "ETHICS.md"), ethicsMd);
  fs.writeFileSync(path.join(workspacePath, "USER.md"), "# USER.md\n\n## Preferences\n\n");

  const state: AgentState = {
    id: agentId,
    name,
    type: "sibling",
    state: "active",
    purpose,
    childrenIds: [],
    workspacePath,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    capabilities: ["general"],
  };

  fs.writeFileSync(path.join(workspacePath, "state.json"), JSON.stringify(state, null, 2));

  console.log(`\n✅ Agent created: ${name} (${agentId})`);
  console.log(`   Workspace: ${workspacePath}\n`);
}

async function promptInput(message: string, defaultVal: string): Promise<string> {
  const result = await p.text({
    message,
    placeholder: defaultVal,
    defaultValue: defaultVal,
  });
  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return result as string;
}

async function showLogs(agentId: string | undefined): Promise<void> {
  if (!agentId) {
    console.log("Usage: hive agents logs <agent-id>");
    return;
  }

  const logPath = path.join(getAgentsPath(), agentId, "logs");
  try {
    const files = fs.readdirSync(logPath).filter((f) => f.endsWith(".log")).sort().reverse();
    if (files.length === 0) {
      console.log("\n📋 No logs found.\n");
      return;
    }
    const content = fs.readFileSync(path.join(logPath, files[0]!), "utf-8");
    console.log(`\n📋 Logs for ${agentId}:\n`);
    console.log(content.slice(-3000));
  } catch {
    console.log(`\n❌ Agent not found: ${agentId}\n`);
  }
}

async function hibernateAgent(agentId: string | undefined): Promise<void> {
  if (!agentId) {
    console.log("Usage: hive agents hibernate <agent-id>");
    return;
  }

  const statePath = path.join(getAgentsPath(), agentId, "state.json");
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as AgentState;
    state.state = "hibernated";
    (state as any).hibernatedAt = new Date().toISOString();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(`\n💤 Agent ${state.name} hibernated.\n`);
  } catch {
    console.log(`\n❌ Agent not found: ${agentId}\n`);
  }
}

async function wakeAgent(agentId: string | undefined): Promise<void> {
  if (!agentId) {
    console.log("Usage: hive agents wake <agent-id>");
    return;
  }

  const statePath = path.join(getAgentsPath(), agentId, "state.json");
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as AgentState;
    state.state = "active";
    state.lastActivity = new Date().toISOString();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(`\n⚡ Agent ${state.name} activated.\n`);
  } catch {
    console.log(`\n❌ Agent not found: ${agentId}\n`);
  }
}

async function terminateAgent(agentId: string | undefined, cascade: boolean): Promise<void> {
  if (!agentId) {
    console.log("Usage: hive agents terminate <agent-id> [--cascade]");
    return;
  }

  const statePath = path.join(getAgentsPath(), agentId, "state.json");
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as AgentState;
    state.state = "terminated";
    (state as any).terminatedAt = new Date().toISOString();
    (state as any).terminationReason = "User requested";
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    console.log(`\n⚫ Agent ${state.name} terminated.\n`);

    if (cascade && state.childrenIds?.length > 0) {
      for (const childId of state.childrenIds) {
        await terminateAgent(childId, true);
      }
    }
  } catch {
    console.log(`\n❌ Agent not found: ${agentId}\n`);
  }
}

async function showTree(): Promise<void> {
  const agents = await loadLifecycleAgents();
  if (agents.length === 0) {
    console.log("\n📋 No agents found. Run 'hive onboard' to create your first agent.\n");
    return;
  }

  const primaries = agents.filter((a) => a.type === "primary" && a.state !== "terminated");

  const printTree = (agent: AgentState, indent = "") => {
    const icon = agent.state === "active" ? "🟢" : agent.state === "hibernated" ? "💤" : "⚫";
    console.log(`${indent}${icon} ${agent.name} (${agent.id.slice(0, 12)}...)`);
    const children = agents.filter((a) => a.parentId === agent.id);
    for (const child of children) {
      printTree(child, indent + "  ");
    }
  };

  console.log("\n🌳 Agent Hierarchy:\n");
  for (const primary of primaries) {
    printTree(primary);
  }
  console.log("");
}

async function addAgent(id: string | undefined): Promise<void> {
  const config = loadConfig();

  if (!id) {
    const result = await p.text({
      message: "ID del nuevo agente:",
      placeholder: "work",
      validate: (v) => (!v ? "El ID es requerido" : undefined),
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelado");
      return;
    }
    id = result;
  }

  const agentsList = ((config.agents as Record<string, unknown>)?.list as AgentConfig[]) || [];
  if (agentsList.find((a) => a.id === id)) {
    console.log(`❌ Ya existe un agente con ID "${id}"`);
    return;
  }

  const name = await p.text({
    message: "Nombre del agente:",
    placeholder: id,
    defaultValue: id,
  });

  if (p.isCancel(name)) {
    p.cancel("Cancelado");
    return;
  }

  const workspace = path.join(getHiveDir(), "agents", id as string, "workspace");
  const agentDir = path.join(getHiveDir(), "agents", id as string, "agent");

  const newAgent: AgentConfig = {
    id: id as string,
    name: name as string,
    workspace,
    agentDir,
  };

  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });

  const soulPath = path.join(agentDir, "SOUL.md");
  if (!fs.existsSync(soulPath)) {
    fs.writeFileSync(soulPath, `# ${name} — Soul\n\nEres ${name}, un agente especializado.\n`, "utf-8");
  }

  const userPath = path.join(agentDir, "USER.md");
  if (!fs.existsSync(userPath)) {
    fs.writeFileSync(userPath, `# User Profile\n\nNotas sobre el usuario.\n`, "utf-8");
  }

  agentsList.push(newAgent);

  console.log(`✅ Agente "${id}" creado`);
  console.log(`   Workspace: ${workspace}`);
  console.log(`   AgentDir:  ${agentDir}`);
}

async function listAgents(showBindings: boolean): Promise<void> {
  const config = loadConfig();
  const agentsList = ((config.agents as Record<string, unknown>)?.list as AgentConfig[]) || [];

  if (agentsList.length === 0) {
    console.log("No hay agentes configurados");
    return;
  }

  console.log("\n🐝 Agentes:\n");
  for (const agent of agentsList) {
    const defaultTag = agent.default ? " (default)" : "";
    console.log(`  ${agent.id}${defaultTag}`);
    console.log(`    Nombre:     ${agent.name}`);
    console.log(`    Workspace:  ${agent.workspace}`);
    if (showBindings) {
      const bindings = ((config as any).bindings as any[])?.filter((b: any) => (b.agentId || b.agent) === agent.id) || [];
      console.log(`    Bindings:   ${bindings.length}`);
    }
    console.log();
  }
}

async function removeAgent(id: string | undefined): Promise<void> {
  if (!id) {
    console.log("❌ Especifica el ID del agente: hive agents remove <id>");
    return;
  }

  const config = loadConfig();
  const agentsList = ((config.agents as Record<string, unknown>)?.list as AgentConfig[]) || [];
  const agent = agentsList.find((a) => a.id === id);

  if (!agent) {
    console.log(`❌ No existe el agente "${id}"`);
    return;
  }

  if (agent.default) {
    console.log("❌ No puedes eliminar el agente por defecto");
    return;
  }

  const confirm = await p.confirm({
    message: `¿Eliminar el agente "${id}"?`,
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    console.log("Cancelado");
    return;
  }

  console.log(`✅ Agente "${id}" eliminado`);
}
