/**
 * Test MCP Connection Flow
 * 
 * Este test verifica el flujo completo de conexión MCP:
 * 1. Obtener MCP Manager desde el agent
 * 2. Verificar configuración actual
 * 3. Agregar un servidor de prueba
 * 4. Conectar el servidor
 * 5. Verificar herramientas
 * 
 * Uso: bun test_mcp_flow.ts
 */

import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { decryptConfig } from "../packages/core/src/storage/crypto";

async function testMCPConnection() {
  console.log("🧪 MCP Connection Flow Test\n");
  console.log("=".repeat(50));

  // Step 1: Initialize database
  console.log("\n📁 Step 1: Initializing database...");
  try {
    initializeDatabase();
    console.log("   ✅ Database initialized");
  } catch (e) {
    console.log("   ⚠️  Database already initialized");
  }

  const db = getDb();

  // Step 2: Check MCP servers in DB
  console.log("\n💾 Step 2: Checking MCP servers in database...");
  const dbServers = db.query(`SELECT * FROM mcp_servers ORDER BY name`).all() as Record<string, any>[];
  console.log(`   Found ${dbServers.length} server(s):`);

  for (const server of dbServers) {
    console.log(`\n   ┌─ ${server.name}`);
    console.log(`   │  ID: ${server.id}`);
    console.log(`   │  Transport: ${server.transport}`);
    console.log(`   │  URL: ${server.url || 'N/A'}`);
    console.log(`   │  Command: ${server.command || 'N/A'}`);
    console.log(`   │  Enabled: ${server.enabled === 1 ? '✅' : '❌'}`);
    console.log(`   │  Status: ${server.status}`);
    console.log(`   │  Tools: ${server.tools_count || 0}`);
    console.log(`   │  Has encrypted headers: ${server.headers_encrypted ? '✅' : '❌'}`);

    if (server.headers_encrypted && server.headers_iv) {
      try {
        const headers = decryptConfig(server.headers_encrypted, server.headers_iv);
        console.log(`   │  Decrypted headers:`, headers);
      } catch (e) {
        console.log(`   │  ❌ Failed to decrypt headers`);
      }
    }
  }

  if (dbServers.length === 0) {
    console.log("\n   ⚠️  No MCP servers found in database!");
    console.log("   Please create one from the UI first.");
    return;
  }

  // Step 3: Try to get Agent and MCP Manager
  console.log("\n\n🤖 Step 3: Getting MCP Manager from Agent...");

  try {
    // Import agent service
    const { AgentService } = await import("../packages/core/src/agent/service");

    // Try to get singleton instance or create one
    let agent: any = null;

    // Check if there's a global agent instance
    const globalAny = globalThis as any;
    if (globalAny._agent) {
      agent = globalAny._agent;
      console.log("   ✅ Found global agent instance");
    } else {
      console.log("   ⚠️  No global agent instance found");
      console.log("   💡 The gateway must be running to test MCP connection");
      console.log("\n   Alternative: Start the gateway with `bun run dev`");
      return;
    }

    // Get MCP Manager
    const mcpManager = agent.getMCPManager?.();

    if (!mcpManager) {
      console.log("   ❌ MCP Manager is null/undefined");
      console.log("   💡 MCP might be disabled in config");
      return;
    }

    console.log("   ✅ MCP Manager found");

    // Step 4: Check current MCP config
    console.log("\n\n⚙️  Step 4: Checking MCP Manager config...");
    const currentConfig = (mcpManager as any).config;
    console.log("   Current config:", JSON.stringify(currentConfig, null, 2));

    // Step 5: Check registered servers
    console.log("\n\n📋 Step 5: Checking registered servers in MCP Manager...");
    const registeredServers = mcpManager.listServers?.() || [];
    console.log(`   Registered: ${registeredServers.length} server(s)`);

    for (const server of registeredServers) {
      console.log(`\n   ┌─ ${server.name}`);
      console.log(`   │  Status: ${server.status}`);
      console.log(`   │  Tools: ${server.tools?.length || 0}`);
      console.log(`   │  Resources: ${server.resources?.length || 0}`);
      console.log(`   │  Prompts: ${server.prompts?.length || 0}`);
      console.log(`   │  Error: ${server.error || 'None'}`);
    }

    // Step 6: Test connection for first server
    console.log("\n\n🔌 Step 6: Testing connection for first server...");
    const testServer = dbServers[0];
    const testServerName = testServer.name;

    console.log(`   Testing: ${testServerName}`);

    try {
      // Build config
      const mcpServerConfig: any = {
        transport: testServer.transport,
        command: testServer.command,
        args: testServer.args ? JSON.parse(testServer.args) : [],
        url: testServer.url,
        enabled: true,
      };

      if (testServer.headers_encrypted && testServer.headers_iv) {
        try {
          mcpServerConfig.headers = decryptConfig(testServer.headers_encrypted, testServer.headers_iv);
          console.log("   ✅ Headers decrypted");
        } catch (e) {
          console.log("   ⚠️  Failed to decrypt headers");
        }
      }

      console.log("   Config:", JSON.stringify(mcpServerConfig, null, 2));

      // Update config to register server
      console.log("\n   📝 Registering server in MCP Manager...");
      const newServersConfig = { ...currentConfig.servers }
      newServersConfig[testServerName] = mcpServerConfig

      await mcpManager.updateConfig({
        ...currentConfig,
        servers: newServersConfig,
      });
      console.log("   ✅ Server registered");

      // Check if connected
      console.log("\n   🔍 Checking server status after registration...");
      const serversAfterUpdate = mcpManager.listServers?.() || [];
      const updatedServer = serversAfterUpdate.find((s: any) => s.name === testServerName);

      if (updatedServer) {
        console.log(`   Status: ${updatedServer.status}`);
        console.log(`   Tools: ${updatedServer.tools?.length || 0}`);
        console.log(`   Error: ${updatedServer.error || 'None'}`);
      } else {
        console.log("   ❌ Server not found after update");
      }

      // Try explicit connect
      console.log("\n   🔌 Attempting explicit connect...");
      await mcpManager.connectServer(testServerName);
      console.log("   ✅ Connect called");

      // Final status check
      console.log("\n   📊 Final status:");
      const finalServers = mcpManager.listServers?.() || [];
      const finalServer = finalServers.find((s: any) => s.name === testServerName);

      if (finalServer) {
        console.log(`   Status: ${finalServer.status}`);
        console.log(`   Tools: ${finalServer.tools?.length || 0}`);
        console.log(`   Error: ${finalServer.error || 'None'}`);

        if (finalServer.tools && finalServer.tools.length > 0) {
          console.log("\n   🛠️  Available tools:");
          for (const tool of finalServer.tools) {
            console.log(`      - ${tool.name}: ${tool.description?.substring(0, 50) || 'No description'}`);
          }
        }
      }

      // Update DB status
      if (finalServer?.status === "connected") {
        console.log("\n   💾 Updating database status...");
        db.query(`UPDATE mcp_servers SET status = ?, tools_count = ? WHERE id = ?`).run(
          "connected",
          finalServer.tools?.length || 0,
          testServerName
        );
        console.log("   ✅ Database updated");
      }

    } catch (error) {
      console.log("   ❌ Error during connection test:", (error as Error).message);
      console.log("   Stack:", (error as Error).stack);
    }

    console.log("\n\n" + "=".repeat(50));
    console.log("✅ Test completed!\n");

  } catch (error) {
    console.log("   ❌ Error:", (error as Error).message);
    console.log("   💡 Make sure the gateway is running with `bun run dev`");
  }
}

// Run test
testMCPConnection().catch(console.error);
