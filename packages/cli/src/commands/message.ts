import { loadConfig } from "@johpaz/hiveAgents-core/config/loader";

interface MessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function getGatewayUrl(config: any): string {
  const gateway = config?.gateway;
  const host = gateway?.host ?? "localhost";
  const port = gateway?.port ?? 3000;
  return `http://${host}:${port}`;
}

export async function message(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "send":
      await messageSend(args);
      break;
    default:
      console.log(`
Usage: hive message <command>

Commands:
  send --to <id> --content <text>  Enviar mensaje
`);
  }
}

async function messageSend(args: string[]): Promise<void> {
  const toIndex = args.indexOf("--to");
  const contentIndex = args.indexOf("--content");
  const channelIndex = args.indexOf("--channel");

  if (toIndex === -1 || contentIndex === -1) {
    console.log("❌ Faltan parámetros requeridos");
    console.log("   hive message send --to <id> --content <texto>");
    return;
  }

  const to = args[toIndex + 1];
  const content = args[contentIndex + 1];
  const channel = channelIndex !== -1 ? args[channelIndex + 1] : "default";

  if (!to || !content) {
    console.log("❌ Parámetros inválidos");
    return;
  }

  const config = loadConfig();
  const gatewayUrl = getGatewayUrl(config);

  try {
    const response = await fetch(`${gatewayUrl}/api/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, content, channel }),
    });

    if (!response.ok) {
      console.log(`❌ Error: ${response.statusText}`);
      return;
    }

    const result = (await response.json()) as MessageResult;

    if (result.success) {
      console.log(`✓ Mensaje enviado: ${result.messageId}`);
    } else {
      console.log(`❌ Error: ${result.error}`);
    }
  } catch (error) {
    console.log(`❌ No se pudo conectar al Gateway: ${(error as Error).message}`);
    console.log("   ¿Está corriendo? Ejecuta: hive start");
  }
}
