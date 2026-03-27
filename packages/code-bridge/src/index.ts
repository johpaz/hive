import { ProcessManager } from "./process-manager.ts";
import { DashboardCommand } from "./schemas.ts";

const CODE_BRIDGE_PORT = parseInt(process.env.CODE_BRIDGE_PORT ?? "18791", 10);
const HEARTBEAT_INTERVAL = 30000; // 30 segundos
const HEARTBEAT_TIMEOUT = 45000;  // 45 segundos para responder (da margen para 2-3 heartbeats del cliente)

const manager = new ProcessManager();

console.log(`🌉 [Code Bridge] Iniciando servidor en puerto ${CODE_BRIDGE_PORT}...`);

const server = Bun.serve<{ id: string; lastPong: number }>({
    port: CODE_BRIDGE_PORT,

    // ── HTTP routes ──────────────────────────────────────────────────────────
    fetch(req, server) {
        const url = new URL(req.url);

        // Upgrade WebSocket connections
        if (url.pathname === "/ws") {
            const id = crypto.randomUUID();
            const upgraded = server.upgrade(req, { data: { id, lastPong: Date.now() } });
            if (upgraded) return undefined;
            console.log(`[Code Bridge] ❌ WebSocket upgrade failed for ${req.url}`);
            return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // Simple REST ping
        if (url.pathname === "/health") {
            return new Response(JSON.stringify({ ok: true, port: CODE_BRIDGE_PORT }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // Status snapshot (REST fallback for the dashboard initial load)
        if (url.pathname === "/status") {
            return new Response(JSON.stringify(manager.status()), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // Status for specific task
        if (url.pathname.startsWith("/status/")) {
            const taskId = url.pathname.split("/")[2];
            console.log(`[Code Bridge] 📊 Status request for task: ${taskId}`);
            return new Response(JSON.stringify(manager.statusForTask(taskId)), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // Cancel specific task
        if (url.pathname.startsWith("/cancel/")) {
            const taskId = url.pathname.split("/")[2];
            console.log(`[Code Bridge] 🛑 Cancel request for task: ${taskId}`);
            const ok = manager.cancel(taskId);
            return new Response(JSON.stringify({ ok, taskId }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response("Not found", { status: 404 });
    },

    // ── WebSocket handlers ───────────────────────────────────────────────────
    websocket: {
        open(ws) {
            console.log(`[Code Bridge] ✅ WebSocket client connected`);
            manager.subscribe(ws);
            // Immediately send the current snapshot to the newly connected client
            ws.send(JSON.stringify(manager.status()));
            
            // Start heartbeat for this client
            ws.data.lastPong = Date.now();
            const heartbeatInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    const timeSinceLastPong = Date.now() - ws.data.lastPong;
                    if (timeSinceLastPong > HEARTBEAT_TIMEOUT) {
                        console.log(`[Code Bridge] ⚠️ Client no respondió heartbeat en ${timeSinceLastPong}ms, cerrando conexión`);
                        clearInterval(heartbeatInterval);
                        ws.close();
                        return;
                    }
                    console.log(`[Code Bridge] 💓 Enviando heartbeat...`);
                    ws.send(JSON.stringify({ type: "ping" }));
                } else {
                    clearInterval(heartbeatInterval);
                }
            }, HEARTBEAT_INTERVAL);
            
            // Store interval for cleanup
            (ws as any)._heartbeatInterval = heartbeatInterval;
        },

        async message(ws, raw) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
            } catch {
                ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
                return;
            }

            const cmd = DashboardCommand.safeParse(parsed);
            if (!cmd.success) {
                console.log(`[Code Bridge] ⚠️ Invalid command: ${cmd.error.message}`);
                ws.send(JSON.stringify({ type: "error", message: cmd.error.message }));
                return;
            }

            const command = cmd.data;
            console.log(`[Code Bridge] 📩 Received command: ${command.cmd}`, command.taskId ? `for task ${command.taskId}` : "");

            switch (command.cmd) {
                case "launch": {
                    try {
                        console.log(`[Code Bridge] 🚀 Launching ${command.config.cli} for task ${command.taskId}...`);
                        const pid = await manager.launch(command.taskId, command.config, command.prompt);
                        console.log(`[Code Bridge] ✅ Launched ${command.config.cli} with PID ${pid}`);
                        ws.send(JSON.stringify({ type: "ack", cmd: "launch", taskId: command.taskId, pid }));
                    } catch (err: any) {
                        console.log(`[Code Bridge] ❌ Launch error: ${err.message}`);
                        ws.send(JSON.stringify({ type: "error", message: err.message }));
                    }
                    break;
                }

                case "cancel": {
                    console.log(`[Code Bridge] 🛑 Cancelling task ${command.taskId}...`);
                    const ok = manager.cancel(command.taskId);
                    console.log(`[Code Bridge] ${ok ? '✅' : '❌'} Cancel ${ok ? 'success' : 'failed'}`);
                    ws.send(JSON.stringify({ type: "ack", cmd: "cancel", taskId: command.taskId, ok }));
                    break;
                }

                case "status": {
                    console.log(`[Code Bridge] 📊 Status request`);
                    ws.send(JSON.stringify(manager.status()));
                    break;
                }

                case "ping": {
                    // Client heartbeat - update lastPong timestamp
                    ws.data.lastPong = Date.now();
                    console.log(`[Code Bridge] ✅ Heartbeat recibido del cliente`);
                    ws.send(JSON.stringify({ type: "pong" }));
                    break;
                }
            }
        },

        close(ws) {
            console.log(`[Code Bridge] 🔌 WebSocket client disconnected`);
            manager.unsubscribe(ws);
            
            // Cleanup heartbeat interval
            if ((ws as any)._heartbeatInterval) {
                clearInterval((ws as any)._heartbeatInterval);
                (ws as any)._heartbeatInterval = null;
            }
        },
    },
});

console.log(`🌉 [Code Bridge] Servidor corriendo en ws://localhost:${server.port}`);
console.log(`🌉 [Code Bridge] Health: http://localhost:${server.port}/health`);
console.log(`🌉 [Code Bridge] WebSocket: ws://localhost:${server.port}/ws`);
console.log(`🌉 [Code Bridge] Heartbeat: cada ${HEARTBEAT_INTERVAL/1000}s, timeout: ${HEARTBEAT_TIMEOUT/1000}s`);
