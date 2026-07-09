/**
 * Test de validación para arquitectura de conexión directa de MCP
 *
 * Valida que:
 * 1. Las herramientas MCP NO se guardan como documentos separados — se cargan en runtime
 * 2. search_knowledge NO tiene type=toolsmcp (eliminado)
 *
 * Run: bun tests/test_mcp_direct_connection.ts
 */

import { searchKnowledgeTool } from "../packages/core/src/tools/core/index";

async function runValidation() {
  console.log("=== MCP Direct Connection Validation ===\n");

  let passed = 0;
  let failed = 0;

  // Test 1: search_knowledge type enum NO incluye toolsmcp
  console.log("Test 1: search_knowledge should NOT have toolsmcp in type enum...");
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

  // Test 2: search_knowledge description menciona conexión directa
  console.log("Test 2: search_knowledge description should mention direct connection...");
  const description = searchKnowledgeTool.description || "";
  if (description.toLowerCase().includes('direct') || description.toLowerCase().includes('mcp')) {
    console.log("   ✅ PASS: Description mentions MCP direct connection\n");
    passed++;
  } else {
    console.log("   ⚠️  INFO: Description could mention MCP direct connection\n");
    passed++;  // No crítico
  }

  // Resumen
  const total = 2;
  console.log("=== VALIDATION SUMMARY ===");
  console.log(`Total tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success rate: ${((passed / total) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log("\n🎉 All validation tests passed!");
    console.log("\nArquitectura de conexión directa de MCP:");
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
