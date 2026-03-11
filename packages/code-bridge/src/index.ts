import { ProcessManager } from "./process-manager.ts";
import { DashboardCommand } from "./schemas.ts";

const CODE_BRIDGE_PORT = parseInt(process.env.CODE_BRIDGE_PORT ?? "18791", 10);

const manager = new ProcessManager();

const server = Bun.serve<{ id: string }>({
    port: CODE_BRIDGE_PORT,

    // ── HTTP routes ──────────────────────────────────────────────────────────
    fetch(req, server) {
        const url = new URL(req.url);

        // Upgrade WebSocket connections
        if (url.pathname === "/ws") {
            const id = crypto.randomUUID();
            const upgraded = server.upgrade(req, { data: { id } });
            if (upgraded) return undefined;
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

        return new Response("Not found", { status: 404 });
    },

    // ── WebSocket handlers ───────────────────────────────────────────────────
    websocket: {
        open(ws) {
            manager.subscribe(ws);
            // Immediately send the current snapshot to the newly connected client
            ws.send(JSON.stringify(manager.status()));
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
                ws.send(JSON.stringify({ type: "error", message: cmd.error.message }));
                return;
            }

            const command = cmd.data;

            switch (command.cmd) {
                case "launch": {
                    try {
                        const pid = await manager.launch(command.taskId, command.config, command.prompt);
                        ws.send(JSON.stringify({ type: "ack", cmd: "launch", taskId: command.taskId, pid }));
                    } catch (err: any) {
                        ws.send(JSON.stringify({ type: "error", message: err.message }));
                    }
                    break;
                }

                case "cancel": {
                    const ok = manager.cancel(command.taskId);
                    ws.send(JSON.stringify({ type: "ack", cmd: "cancel", taskId: command.taskId, ok }));
                    break;
                }

                case "status": {
                    ws.send(JSON.stringify(manager.status()));
                    break;
                }
            }
        },

        close(ws) {
            manager.unsubscribe(ws);
        },
    },
});

console.log(`🌉 Hive Code Bridge running on ws://localhost:${server.port}`);
