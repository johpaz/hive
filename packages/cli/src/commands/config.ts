import * as p from "@clack/prompts";
import { loadConfig } from "@johpaz/hive-core/config/loader";

export async function config(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "show":
      await showConfig();
      break;
    case "edit":
      console.log("Configura Hive a través de variables de entorno o la base de datos.");
      break;
    default:
      console.log(`
Usage: hive config <command>

Commands:
  show      Mostrar la configuración actual (redactada)
  edit      (Deshabilitado) Edición manual de configuración
`);
  }
}

function redactSecrets(obj: any, depth = 0): any {
  if (depth > 10) return obj;
  if (typeof obj !== "object" || obj === null) return obj;

  const sensitiveKeys = ["apiKey", "token", "botToken", "password", "secret", "key"];

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item, depth + 1));
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
      result[key] = "***REDACTED***";
    } else {
      result[key] = redactSecrets(value, depth + 1);
    }
  }
  return result;
}

async function showConfig(): Promise<void> {
  const config = loadConfig();
  console.log("\n⚙️  Configuración Actual (Redactada):\n");
  console.log(JSON.stringify(redactSecrets(config), null, 2));
  console.log();
}
