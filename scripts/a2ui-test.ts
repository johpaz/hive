/**
 * a2ui-test.ts
 *
 * Envía una solicitud de prueba al panel interactivo A2UI.
 *
 * Uso: bun scripts/a2ui-test.ts [sessionId]
 *   sessionId - ID de sesión (default: "default")
 */

const HOST = process.env.HIVE_GATEWAY_HOST ?? "127.0.0.1";
const PORT = process.env.HIVE_GATEWAY_PORT ?? "18790";
const AUTH_TOKEN = process.env.HIVE_AUTH_TOKEN ?? "";

const sessionId = process.argv[2] ?? "default";

const url = new URL(`ws://${HOST}:${PORT}/ws`);
url.searchParams.set("session", sessionId);
if (AUTH_TOKEN) url.searchParams.set("token", AUTH_TOKEN);

console.log(`🧪 A2UI Test Script`);
console.log(`   Session: ${sessionId}`);
console.log(`   Gateway: ${HOST}:${PORT}\n`);

const ws = new WebSocket(url.toString());

ws.addEventListener("open", () => {
  console.log("✅ Conectado al gateway");
  ws.send(JSON.stringify({ type: "canvas_subscribe", sessionId }));

  setTimeout(() => {
    console.log("\n🧩 Enviando solicitud A2UI al agente...");
    ws.send(JSON.stringify({
      type: "message",
      content: "Usa las herramientas a2ui_create_surface y a2ui_update_components para crear una superficie A2UI con surfaceId 'test-a2ui-surface'. Crea un formulario con campos de nombre y email, y un botón de enviar. El tema debe tener primaryColor '#06b6d4' y agentDisplayName 'Hive Agent'. Luego actualiza el data model con datos de ejemplo.",
      sessionId,
      timestamp: new Date().toISOString(),
    }));

    console.log("\n⏳ Esperando respuestas del agente (20s)...\n");
  }, 1500);
});

ws.addEventListener("message", (event) => {
  try {
    const d = JSON.parse(event.data as string);
    if (d.type === "welcome") console.log(`  👋 Welcome: ${d.sessionId}`);
    else if (d.type === "canvas:connected") console.log(`  🔗 Sesión visual conectada`);
    else if (d.type === "canvas:snapshot") console.log(`  📸 Actividad: ${(d.data?.nodes?.length ?? 0)} agentes`);
    else if (d.type === "a2ui:createSurface") console.log(`  🧩 a2ui:createSurface → ${d.data?.surfaceId}`);
    else if (d.type === "a2ui:updateComponents") console.log(`  🧩 a2ui:updateComponents → ${d.data?.surfaceId} (${d.data?.components?.length ?? 0} componentes)`);
    else if (d.type === "a2ui:updateDataModel") console.log(`  🧩 a2ui:updateDataModel → ${d.data?.surfaceId}`);
    else if (d.type === "progress") console.log(`  📊 Progress: ${d.content?.substring(0, 100)}`);
    else if (d.type === "message" && d.isChunk) process.stdout.write(d.content ?? "");
    else if (d.type === "message" && !d.isChunk && !d.isStep) {
      if (d.content) console.log(`\n  💬 Agent: ${String(d.content).substring(0, 150)}`);
    }
    else if (d.type === "message" && d.isStep) console.log(`  📊 Step: ${d.content?.substring(0, 100)}`);
    else if (d.type === "typing") { /* skip */ }
    else if (d.type === "pong") { /* skip */ }
    else if (d.type === "error") console.log(`  ❌ Error: ${d.error}`);
    else if (d.type === "status") { /* skip */ }
    else console.log(`  📩 ${d.type}`);
  } catch {}
});

ws.addEventListener("error", (e) => { console.error("❌ WS error"); process.exit(1); });
ws.addEventListener("close", (e) => { console.log(`🔌 Cerrado: ${e.code}`); process.exit(0); });
setTimeout(() => { console.log("\n⏰ Timeout - cerrando"); ws.close(); process.exit(0); }, 25000);
