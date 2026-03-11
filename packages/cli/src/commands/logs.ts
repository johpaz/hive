import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

const LOG_DIR = path.join(process.env.HOME || "", ".hive", "logs");
const LOG_FILE = path.join(LOG_DIR, "gateway.log");

export async function logs(flags: string[]): Promise<void> {
  if (flags.includes("--clear")) {
    await clearLogs();
    return;
  }

  if (!fs.existsSync(LOG_FILE)) {
    console.log("No hay logs disponibles");
    return;
  }

  const follow = flags.includes("--follow") || flags.includes("-f");
  const levelFlag = flags.find((f) => f.startsWith("--level"));
  const level = levelFlag ? levelFlag.split("=")[1] || flags[flags.indexOf(levelFlag) + 1] : null;
  const agentFlag = flags.find((f) => f.startsWith("--agent"));
  const agent = agentFlag ? agentFlag.split("=")[1] || flags[flags.indexOf(agentFlag) + 1] : null;
  const lines = 100;

  if (follow) {
    const tail = spawn("tail", ["-f", LOG_FILE], { stdio: "inherit" });
    process.on("SIGINT", () => {
      tail.kill();
      process.exit(0);
    });
  } else {
    let content = fs.readFileSync(LOG_FILE, "utf-8");
    const allLines = content.split("\n");

    let filtered = allLines;
    if (level) {
      const levelLower = level.toLowerCase();
      filtered = filtered.filter((l) => l.toLowerCase().includes(levelLower));
    }
    if (agent) {
      filtered = filtered.filter((l) => l.includes(agent));
    }

    const lastLines = filtered.slice(-lines);
    console.log(lastLines.join("\n"));
  }
}

async function clearLogs(): Promise<void> {
  if (fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, "");
    console.log("✅ Logs limpiados");
  } else {
    console.log("No hay logs para limpiar");
  }
}
