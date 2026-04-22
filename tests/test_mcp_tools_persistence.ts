/**
 * Test: MCP Tools Persistence + FTS5 v0.0.29
 *
 * Validates:
 * 1. mcp_tools table schema is correct
 * 2. syncMCPToolsToDB persists tool definitions
 * 3. syncMCPToolsToFTS indexes tools for search
 * 4. clearMCPToolsFromDB removes tools and re-syncs FTS5
 * 5. search_knowledge finds MCP tools with type="mcp"
 * 6. search_knowledge finds MCP tools with type="all"
 * 7. FTS5 bm25 ranking works for MCP tools
 * 8. mcpToolId generates stable IDs
 * 9. Empty tools list doesn't break sync
 *
 * Run: bun run tests/test_mcp_tools_persistence.ts
 */

import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { syncMCPToolsToDB, syncMCPToolsToFTS, clearMCPToolsFromDB, mcpToolId } from "../packages/core/src/mcp/tool-sync";
import { runStartupMigrations } from "../packages/core/src/storage/onboarding";
import { searchKnowledgeTool } from "../packages/core/src/tools/core/index";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}`);
    failed++;
  }
}

async function runTests() {
  console.log("\n🧪 MCP Tools Persistence + FTS5 v0.0.29 Tests\n");

  initializeDatabase();
  runStartupMigrations();

  const db = getDb();

  // ─── Test 1: mcp_tools table schema ─────────────────────────────────────
  console.log("Test 1: mcp_tools table schema");
  {
    const cols = db.query("PRAGMA table_info(mcp_tools)").all() as Array<{ name: string; type: string; notnull: number }>;
    const colNames = cols.map(c => c.name);

    assert(colNames.includes("id"), "has id column");
    assert(colNames.includes("server_id"), "has server_id column");
    assert(colNames.includes("server_name"), "has server_name column");
    assert(colNames.includes("tool_name"), "has tool_name column");
    assert(colNames.includes("description"), "has description column");
    assert(colNames.includes("category"), "has category column");
    assert(colNames.includes("active"), "has active column");
  }

  // ─── Test 2: mcp_tools_fts exists ──────────────────────────────────────
  console.log("\nTest 2: mcp_tools_fts virtual table");
  {
    const ftsCheck = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_tools_fts'").get();
    assert(!!ftsCheck, "mcp_tools_fts exists");
  }

  // ─── Test 3: syncMCPToolsToDB persists tool definitions ──────────────────
  console.log("\nTest 3: syncMCPToolsToDB persists tools");
  {
    const tools = [
      { name: "send_email", description: "Send an email to a recipient" },
      { name: "create_issue", description: "Create a new issue in the project tracker" },
      { name: "search_docs", description: "Search documentation for a topic" },
    ];

    syncMCPToolsToDB("srv_github_001", "github", tools);

    const rows = db.query("SELECT * FROM mcp_tools WHERE server_id = ?").all("srv_github_001") as any[];
    assert(rows.length === 3, `persisted 3 tools (got ${rows.length})`);
    assert(rows[0].server_name === "github", "server_name is github");
    assert(rows[0].category === "mcp", "category defaults to mcp");
    assert(rows[0].active === 1, "active defaults to 1");
  }

  // ─── Test 4: syncMCPToolsToFTS indexes tools ────────────────────────────
  console.log("\nTest 4: syncMCPToolsToFTS indexes tools");
  {
    await syncMCPToolsToFTS();

    const ftsRows = db.query("SELECT * FROM mcp_tools_fts").all() as any[];
    assert(ftsRows.length === 3, `FTS5 has 3 entries (got ${ftsRows.length})`);

    const searchResult = db.query(
      "SELECT * FROM mcp_tools_fts WHERE mcp_tools_fts MATCH ? ORDER BY rank"
    ).all("email") as any[];
    assert(searchResult.length === 1, `FTS5 finds "email" (got ${searchResult.length})`);
    assert(searchResult[0].tool_name === "send_email", "found send_email by 'email'");
  }

  // ─── Test 5: clearMCPToolsFromDB removes tools ──────────────────────────
  console.log("\nTest 5: clearMCPToolsFromDB removes tools and re-syncs FTS5");
  {
    // Add tools from a second server
    const slackTools = [
      { name: "send_message", description: "Send a Slack message" },
      { name: "list_channels", description: "List available Slack channels" },
    ];
    syncMCPToolsToDB("srv_slack_001", "slack", slackTools);
    await syncMCPToolsToFTS();

    // Verify 5 tools total
    let allRows = db.query("SELECT * FROM mcp_tools").all() as any[];
    assert(allRows.length === 5, `5 total tools before delete (got ${allRows.length})`);

    // Clear github server
    clearMCPToolsFromDB("srv_github_001");

    // Should only have slack tools left
    allRows = db.query("SELECT * FROM mcp_tools").all() as any[];
    assert(allRows.length === 2, `2 tools left after clear (got ${allRows.length})`);

    // FTS5 should also be clean
    const ftsRows = db.query("SELECT * FROM mcp_tools_fts").all() as any[];
    assert(ftsRows.length === 2, `FTS5 has 2 entries after clear (got ${ftsRows.length})`);
  }

  // ─── Test 6: search_knowledge type="mcp" ─────────────────────────────────
  console.log("\nTest 6: search_knowledge with type='mcp'");
  {
    // Re-seed with known tools
    db.run("DELETE FROM mcp_tools");
    db.run("DELETE FROM mcp_tools_fts");

    const tools = [
      { name: "deploy_app", description: "Deploy an application to cloud infrastructure" },
      { name: "run_tests", description: "Execute the test suite for a project" },
      { name: "manage_dns", description: "Manage DNS records for a domain" },
    ];
    syncMCPToolsToDB("srv_vercel_001", "vercel", tools);
    await syncMCPToolsToFTS();

    const result = await searchKnowledgeTool.execute({ query: "deploy cloud", type: "mcp" }) as any;
    assert(result.ok === true, "search_knowledge returns ok");
    assert(Array.isArray(result.toolsmcp), "result.toolsmcp is array");

    const deployResult = result.toolsmcp.find((t: any) => t.tool_name === "deploy_app");
    assert(!!deployResult, "found deploy_app via search_knowledge type=mcp");
  }

  // ─── Test 7: search_knowledge type="all" includes MCP ────────────────────
  console.log("\nTest 7: search_knowledge with type='all' includes MCP");
  {
    const result = await searchKnowledgeTool.execute({ query: "deploy", type: "all" }) as any;
    assert(result.ok === true, "search_knowledge type=all returns ok");
    assert(Array.isArray(result.toolsmcp), "result.toolsmcp is array");
    assert(result.toolsmcp.length > 0, `MCP tools found in 'all' search (got ${result.toolsmcp.length})`);
    assert(typeof result.totalResults === "number", "totalResults is number");
    assert(result.totalResults >= result.toolsmcp.length, "totalResults includes MCP count");
  }

  // ─── Test 8: bm25 ranking works ────────────────────────────────────────
  console.log("\nTest 8: bm25 ranking for MCP tools");
  {
    const result = await searchKnowledgeTool.execute({ query: "dns", type: "mcp" }) as any;
    assert(result.ok === true, "search for 'dns' returns ok");

    const dnsResult = result.toolsmcp.find((t: any) => t.tool_name === "manage_dns");
    assert(!!dnsResult, "found manage_dns via 'dns' search");
    assert(typeof dnsResult.rank === "number", "rank is a number");
  }

  // ─── Test 9: mcpToolId generates stable IDs ──────────────────────────────
  console.log("\nTest 9: mcpToolId generates stable IDs");
  {
    const id1 = mcpToolId("github", "send_email");
    const id2 = mcpToolId("github", "send_email");
    assert(id1 === id2, "same inputs produce same ID");

    const id3 = mcpToolId("github", "create_issue");
    assert(id1 !== id3, "different tool names produce different IDs");

    const id4 = mcpToolId("slack", "send_email");
    assert(id1 !== id4, "different server names produce different IDs");

    assert(/^[a-zA-Z_]/.test(id4), "ID starts with valid char");
  }

  // ─── Test 10: empty tool list doesn't break sync ────────────────────────
  console.log("\nTest 10: empty tool list doesn't break sync");
  {
    db.run("DELETE FROM mcp_tools");
    db.run("DELETE FROM mcp_tools_fts");

    syncMCPToolsToDB("srv_empty_001", "empty_server", []);
    await syncMCPToolsToFTS();

    const rows = db.query("SELECT * FROM mcp_tools").all() as any[];
    assert(rows.length === 0, "no tools persisted for empty list");

    const ftsRows = db.query("SELECT * FROM mcp_tools_fts").all() as any[];
    assert(ftsRows.length === 0, "no FTS entries for empty list");
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});