import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import { getHiveDir } from "@johpaz/hive-core/config/loader";

const getHiveDirConst = () => getHiveDir();
const getCronDir = () => path.join(getHiveDirConst(), "cron");
const CRON_DB = path.join(getCronDir(), "jobs.json");

interface CronJob {
  id: string;
  schedule: string;
  command: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

function loadJobs(): CronJob[] {
  if (!fs.existsSync(CRON_DB)) return [];
  try {
    return JSON.parse(fs.readFileSync(CRON_DB, "utf-8"));
  } catch {
    return [];
  }
}

function saveJobs(jobs: CronJob[]): void {
  if (!fs.existsSync(getCronDir())) {
    fs.mkdirSync(getCronDir(), { recursive: true });
  }
  fs.writeFileSync(CRON_DB, JSON.stringify(jobs, null, 2));
}

export async function cron(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "list":
      await listCron();
      break;
    case "add":
      await addCron();
      break;
    case "remove":
      await removeCron(args[0]);
      break;
    case "logs":
      await cronLogs();
      break;
    default:
      console.log(`
Usage: hive cron <command>

Commands:
  list        Listar cron jobs
  add         Añadir cron job
  remove <id> Eliminar cron job
  logs        Ver logs de cron
`);
  }
}

async function listCron(): Promise<void> {
  const jobs = loadJobs();

  if (jobs.length === 0) {
    console.log("No hay cron jobs configurados");
    return;
  }

  console.log("\n⏰ Cron Jobs:\n");

  for (const job of jobs) {
    const status = job.enabled ? "✅ Activo" : "⏸️  Pausado";
    console.log(`  ${job.id}`);
    console.log(`    Estado:    ${status}`);
    console.log(`    Schedule:  ${job.schedule}`);
    console.log(`    Comando:   ${job.command}`);
    if (job.lastRun) {
      console.log(`    Última:    ${job.lastRun}`);
    }
    console.log();
  }
}

async function addCron(): Promise<void> {
  const idValue = await p.text({
    message: "ID del cron job:",
    placeholder: "daily-report",
    validate: (v) => (!v ? "El ID es requerido" : undefined),
  });

  if (p.isCancel(idValue)) {
    p.cancel("Cancelado");
    return;
  }

  const scheduleValue = await p.text({
    message: "Schedule (cron expression):",
    placeholder: "0 9 * * *",
    validate: (v) => (!v ? "El schedule es requerido" : undefined),
  });

  if (p.isCancel(scheduleValue)) {
    p.cancel("Cancelado");
    return;
  }

  const commandValue = await p.text({
    message: "Comando a ejecutar:",
    placeholder: "hive chat --agent work 'Genera el reporte diario'",
    validate: (v) => (!v ? "El comando es requerido" : undefined),
  });

  if (p.isCancel(commandValue)) {
    p.cancel("Cancelado");
    return;
  }

  const jobs = loadJobs();
  jobs.push({
    id: idValue as string,
    schedule: scheduleValue as string,
    command: commandValue as string,
    enabled: true,
  });
  saveJobs(jobs);

  console.log(`✅ Cron job "${idValue}" creado`);
}

async function removeCron(id: string | undefined): Promise<void> {
  if (!id) {
    console.log("❌ Especifica el ID: hive cron remove <id>");
    return;
  }

  const jobs = loadJobs();
  const index = jobs.findIndex((j) => j.id === id);

  if (index === -1) {
    console.log(`❌ Cron job no encontrado: ${id}`);
    return;
  }

  jobs.splice(index, 1);
  saveJobs(jobs);

  console.log(`✅ Cron job "${id}" eliminado`);
}

async function cronLogs(): Promise<void> {
  const logFile = path.join(getCronDir(), "cron.log");

  if (!fs.existsSync(logFile)) {
    console.log("No hay logs de cron");
    return;
  }

  const content = fs.readFileSync(logFile, "utf-8");
  console.log(content);
}
