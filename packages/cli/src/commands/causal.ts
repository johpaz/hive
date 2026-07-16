/**
 * Hive CLI - Causal Event Log Commands
 *
 * Live-tail of the G9 causal event log (IntentLogged/StateTransition/ToolCall).
 * Only works when causalLog.enabled is on (HIVE_CAUSAL_LOG=true) — otherwise
 * nothing is being appended and the watch just sits idle.
 */

export async function causal(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "watch":
      await watchCommand(args);
      break;
    default:
      printUsage();
  }
}

function printUsage(): void {
  console.log(`
Uso: hive causal watch [--agent <id>] [--stream <id>]

Live-tail del event log causal G9 (IntentLogged/StateTransition/ToolCall).
Solo muestra eventos nuevos desde que arranca el comando — sin replay
histórico. Requiere causalLog.enabled=true (HIVE_CAUSAL_LOG=true) para que
haya algo que mostrar.

Opciones:
  --agent <id>    Filtrar por agentId
  --stream <id>   Filtrar por streamId (un run/turno específico)
`);
}

function flagValue(flags: string[], name: string): string | undefined {
  const flag = flags.find((f) => f === name || f.startsWith(`${name}=`));
  if (!flag) return undefined;
  if (flag.includes("=")) return flag.split("=")[1];
  return flags[flags.indexOf(flag) + 1];
}

async function watchCommand(args: string[]): Promise<void> {
  const agentId = flagValue(args, "--agent");
  const streamId = flagValue(args, "--stream");

  const { watchCausalEvents, formatCausalEvent } = await import(
    "@johpaz/hive-agents-core/storage/causal-events"
  );
  const { loadConfig } = await import("@johpaz/hive-agents-core/config/loader");

  const config = loadConfig();
  if (!config.causalLog?.enabled) {
    console.log(
      "⚠️  causalLog.enabled está apagado (HIVE_CAUSAL_LOG=true para prenderlo) — no se va a apendear nada nuevo mientras tanto.\n"
    );
  }

  console.log(
    `👀 Escuchando eventos causales${agentId ? ` agent=${agentId}` : ""}${streamId ? ` stream=${streamId}` : ""}...`
  );
  console.log("Nota: solo se muestran eventos nuevos desde ahora — sin replay histórico. Ctrl+C para salir.\n");

  const stream = await watchCausalEvents({ agentId, streamId });

  process.on("SIGINT", () => {
    stream.close();
    process.exit(0);
  });

  for await (const event of stream) {
    console.log(formatCausalEvent(event));
  }
}
