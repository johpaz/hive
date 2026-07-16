/**
 * Hive CLI - Causal Event Log Commands
 *
 * Live-tail of the G9 causal event log (IntentLogged/StateTransition/ToolCall).
 * Only works when causalLog.enabled is on (HIVE_CAUSAL_LOG=true) — otherwise
 * nothing is being appended and the watch just sits idle.
 *
 * IMPORTANT constraint (confirmed by testing, not just reading docs): HiveDB
 * only allows ONE process to have the database open at a time — there is no
 * shared/read-only open mode. So this command CANNOT run alongside a live
 * `hive` gateway process pointed at the same DB; it fails fast with a clear
 * "already open" message instead. It's a real capability (proven to work
 * end-to-end with a real LLM turn in-process), but only usable today from
 * inside the same process as whatever else has the DB open — e.g. embedded
 * in the gateway itself — not as an external CLI process watching a live one.
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

⚠️  No podés correr esto en paralelo con un \`hive dev\`/\`hive start\` activo
sobre la misma DB — HiveDB solo permite un proceso con la base abierta a la
vez, sin modo de solo-lectura compartido.

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

  let stream: Awaited<ReturnType<typeof watchCausalEvents>>;
  try {
    stream = await watchCausalEvents({ agentId, streamId });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (message.includes("already open")) {
      console.error(
        "❌ La base de datos ya está abierta por otro proceso (probablemente el gateway).\n" +
        "   HiveDB solo permite un proceso con la DB abierta a la vez — no hay modo de solo-lectura compartido.\n" +
        "   `hive causal watch` no puede correr en paralelo con un `hive dev`/`hive start` activo sobre la misma DB."
      );
      process.exit(1);
    }
    throw err;
  }

  process.on("SIGINT", () => {
    stream.close();
    process.exit(0);
  });

  for await (const event of stream) {
    console.log(formatCausalEvent(event));
  }
}
