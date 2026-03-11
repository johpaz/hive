import * as p from "@clack/prompts";
import { loadConfig } from "@johpaz/hive-core/config/loader";

function getGatewayUrl(config: any): string {
  const gateway = config?.gateway;
  const host = gateway?.host ?? "localhost";
  const port = gateway?.port ?? 3000;
  return `http://${host}:${port}`;
}

export async function agent(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "run":
      await agentRun(args);
      break;
    default:
      console.log(`
Usage: hive agent <command>

Commands:
  run --message <text>     Ejecutar agente con mensaje
  run --thinking <level>   Nivel de razonamiento (low/medium/high)
  run --wait               Esperar respuesta completa
`);
  }
}

async function agentRun(args: string[]): Promise<void> {
  const messageIndex = args.indexOf("--message");
  const thinkingIndex = args.indexOf("--thinking");
  const toolsIndex = args.indexOf("--tools");
  const agentIndex = args.indexOf("--agent");
  const waitIndex = args.indexOf("--wait");

  if (messageIndex === -1) {
    const msg = await p.text({
      message: "Mensaje para el agente:",
      placeholder: "Analiza el archivo README.md",
      validate: (v) => (!v ? "El mensaje es requerido" : undefined),
    });

    if (p.isCancel(msg)) {
      p.cancel("Cancelado");
      return;
    }

    args.push("--message", msg as string);
    return agentRun(args);
  }

  const message = args[messageIndex + 1];
  const thinking = thinkingIndex !== -1 ? args[thinkingIndex + 1] : "medium";
  const tools = toolsIndex !== -1 ? args[toolsIndex + 1] : "all";
  const agentId = agentIndex !== -1 ? args[agentIndex + 1] : "main";
  const wait = waitIndex !== -1;

  if (!message) {
    console.log("❌ Mensaje requerido");
    return;
  }

  const config = loadConfig();
  const gatewayUrl = getGatewayUrl(config);

  const spinner = p.spinner();
  spinner.start("Conectando con el agente...");

  try {
    if (wait) {
      await executeWithStream(gatewayUrl, { message, thinking, tools, agentId }, spinner);
    } else {
      await executeAsync(gatewayUrl, { message, thinking, tools, agentId }, spinner);
    }
  } catch (error) {
    spinner.stop("Error");
    console.log(`❌ ${(error as Error).message}`);
    console.log("   ¿Está corriendo el Gateway? Ejecuta: hive start");
  }
}

async function executeWithStream(
  gatewayUrl: string,
  payload: { message: string; thinking: string; tools: string; agentId: string },
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  const response = await fetch(`${gatewayUrl}/api/agent/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }

  spinner.stop("Conectado");

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No se pudo obtener el stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let thinking = true;

  process.stdout.write("\n");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim() || !line.startsWith("data: ")) continue;

      try {
        const data = JSON.parse(line.slice(6));

        if (data.type === "thinking" && thinking) {
          process.stdout.write(".");
        } else if (data.type === "response") {
          if (thinking) {
            process.stdout.write("\n\n");
            thinking = false;
          }
          process.stdout.write(data.content ?? "");
        } else if (data.type === "tool_call") {
          process.stdout.write(`\n[Tool: ${data.toolName}]`);
        } else if (data.type === "complete") {
          process.stdout.write("\n\n");
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
}

async function executeAsync(
  gatewayUrl: string,
  payload: { message: string; thinking: string; tools: string; agentId: string },
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  const response = await fetch(`${gatewayUrl}/api/agent/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: false }),
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }

  const result = await response.json() as { taskId?: string; success: boolean };

  spinner.stop("Enviado");

  if (result.taskId) {
    console.log(`✓ Tarea enviada: ${result.taskId}`);
    console.log("  Usa `hive tasks list` para ver el estado");
  } else {
    console.log("✓ Tarea enviada");
  }
}
