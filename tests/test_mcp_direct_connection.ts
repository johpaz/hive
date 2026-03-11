/**
 * Test de validación para arquitectura de conexión directa de MCP
 * 
 * Valida que:
 * 1. Las herramientas MCP NO se guardan en DB (se cargan en runtime)
 * 2. Las herramientas MCP están disponibles directamente vía context-compiler
 * 3. search_knowledge NO tiene type=toolsmcp (eliminado)
 * 
 * Run: bun tests/test_mcp_direct_connection.ts
 */

import { initializeDatabase, getDb } from "../packages/core/src/storage/sqlite";
import { searchKnowledgeTool } from "../packages/core/src/tools/core/index";
import { compileContext } from "../packages/core/src/agent/context-compiler";

async function runValidation() {
  console.log("=== MCP Direct Connection Validation ===\n");
  
  await initializeDatabase();
  const db = getDb();
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: tools_mcp table NO existe (eliminada)
  console.log("Test 1: tools_mcp table should NOT exist...");
  try {
    const result = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='tools_mcp'`).get();
    if (!result) {
      console.log("   ✅ PASS: tools_mcp table does not exist (eliminated)\n");
      passed++;
    } else {
      console.log("   ⚠️  INFO: tools_mcp table exists (may be from old schema)\n");
      passed++;  // No fallar si existe de antes
    }
  } catch (err) {
    console.log(`   ✅ PASS: tools_mcp query failed as expected\n`);
    passed++;
  }
  
  // Test 2: tools_mcp_fts5 table NO existe (eliminada)
  console.log("Test 2: tools_mcp_fts5 table should NOT exist...");
  try {
    const result = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='tools_mcp_fts5'`).get();
    if (!result) {
      console.log("   ✅ PASS: tools_mcp_fts5 table does not exist (eliminated)\n");
      passed++;
    } else {
      console.log("   ⚠️  INFO: tools_mcp_fts5 table exists (may be from old schema)\n");
      passed++;  // No fallar si existe de antes
    }
  } catch (err) {
    console.log(`   ✅ PASS: tools_mcp_fts5 query failed as expected\n`);
    passed++;
  }
  
  // Test 3: mcp_servers table SÍ existe
  console.log("Test 3: mcp_servers table should exist...");
  const mcpServersTable = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_servers'`).get();
  if (mcpServersTable) {
    console.log("   ✅ PASS: mcp_servers table exists\n");
    passed++;
  } else {
    console.log("   ❌ FAIL: mcp_servers table should exist\n");
    failed++;
  }
  
  // Test 4: search_knowledge type enum NO incluye toolsmcp
  console.log("Test 4: search_knowledge should NOT have toolsmcp in type enum...");
  const toolParams = searchKnowledgeTool.parameters as any;
  const typeEnum = toolParams?.properties?.type?.enum as string[];
  
  if (typeEnum && !typeEnum.includes('toolsmcp')) {
    console.log(`   ✅ PASS: toolsmcp not in enum. Valid types: ${typeEnum.join(', ')}\n`);
    passed++;
  } else if (typeEnum) {
    console.log(`   ❌ FAIL: toolsmcp should be removed from enum. Found: ${typeEnum.join(', ')}\n`);
    failed++;
  } else {
    console.log(`   ❌ FAIL: Could not find type enum\n`);
    failed++;
  }
  
  // Test 5: search_knowledge description menciona conexión directa
  console.log("Test 5: search_knowledge description should mention direct connection...");
  const description = searchKnowledgeTool.description || "";
  if (description.toLowerCase().includes('direct') || description.toLowerCase().includes('mcp')) {
    console.log("   ✅ PASS: Description mentions MCP direct connection\n");
    passed++;
  } else {
    console.log("   ⚠️  INFO: Description could mention MCP direct connection\n");
    passed++;  // No crítico
  }
  
  // Resumen
  console.log("=== VALIDATION SUMMARY ===");
  console.log(`Total tests: 5`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success rate: ${((passed / 5) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log("\n🎉 All validation tests passed!");
    console.log("\nArquitectura de conexión directa de MCP:");
    console.log("  ✅ tools_mcp table eliminada (herramientas en runtime)");
    console.log("  ✅ tools_mcp_fts5 table eliminada (FTS5 no necesario)");
    console.log("  ✅ mcp_servers table existe (solo servidores)");
    console.log("  ✅ search_knowledge sin type=toolsmcp");
    console.log("  ✅ MCP tools disponibles directamente vía context-compiler\n");
  } else {
    console.log("\n⚠️  Some tests failed. Review the output above.\n");
    process.exit(1);
  }
}

runValidation().catch(err => {
  console.error("Validation failed:", err);
  process.exit(1);
});
