import * as fs from "fs";
import * as path from "path";

const HIVE_DIR = path.join(process.env.HOME || "", ".hive");
const SESSIONS_DIR = path.join(HIVE_DIR, "sessions");

export async function sessions(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "list":
      await listSessions();
      break;
    case "view":
      await viewSession(args[0]);
      break;
    case "prune":
      await pruneSessions();
      break;
    default:
      console.log(`
Usage: hive sessions <command>

Commands:
  list        Listar sesiones
  view <id>   Ver transcripción
  prune       Eliminar sesiones inactivas
`);
  }
}

async function listSessions(): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log("No hay sesiones");
    return;
  }

  const sessions = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));

  if (sessions.length === 0) {
    console.log("No hay sesiones");
    return;
  }

  console.log("\n📋 Sesiones:\n");

  for (const session of sessions) {
    const sessionPath = path.join(SESSIONS_DIR, session);
    const stat = fs.statSync(sessionPath);
    const id = session.replace(".json", "");
    const date = stat.mtime.toLocaleDateString();
    const time = stat.mtime.toLocaleTimeString();

    let messageCount = 0;
    try {
      const content = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
      messageCount = content.messages?.length || 0;
    } catch {
      // ignore
    }

    console.log(`  ${id}`);
    console.log(`    Última actividad: ${date} ${time}`);
    console.log(`    Mensajes: ${messageCount}`);
    console.log();
  }
}

async function viewSession(id: string | undefined): Promise<void> {
  if (!id) {
    console.log("❌ Especifica el ID de la sesión: hive sessions view <id>");
    return;
  }

  const sessionPath = path.join(SESSIONS_DIR, `${id}.json`);

  if (!fs.existsSync(sessionPath)) {
    console.log(`❌ Sesión no encontrada: ${id}`);
    return;
  }

  const content = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
  const messages = content.messages || [];

  console.log(`\n📜 Sesión: ${id}\n`);

  for (const msg of messages) {
    const role = msg.role === "user" ? "👤 Usuario" : "🤖 Agente";
    console.log(`${role}:`);
    console.log(`  ${msg.content}`);
    console.log();
  }
}

async function pruneSessions(): Promise<void> {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log("No hay sesiones para limpiar");
    return;
  }

  const sessions = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 días

  let pruned = 0;

  for (const session of sessions) {
    const sessionPath = path.join(SESSIONS_DIR, session);
    const stat = fs.statSync(sessionPath);

    if (now - stat.mtimeMs > maxAge) {
      fs.unlinkSync(sessionPath);
      pruned++;
    }
  }

  console.log(`✅ Sesiones eliminadas: ${pruned}`);
}
