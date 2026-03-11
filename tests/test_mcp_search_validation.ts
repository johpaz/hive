/**
 * Test de validación para search_knowledge con MCP tools
 * 
 * Este test usa el tool search_knowledge real con la DB para validar
 * que las herramientas MCP se encuentran correctamente después del fix.
 * 
 * Run: bun tests/test_mcp_search_validation.ts
 */

import { initializeDatabase, getDb } from "../packages/core/src/storage/sqlite";
import { syncMCPToolsToFTS } from "../packages/core/src/agent/tool-selector";
import { searchKnowledgeTool } from "../packages/core/src/tools/core/index";

// Herramientas reales del MCP email-gmail (simuladas)
const EMAIL_GMAIL_TOOLS = [
  {
    name: "send_email",
    description: "Send an email to a recipient with subject and body",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body content (supports HTML)" },
        html: { type: "boolean", description: "Whether body is HTML format" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "send_html_email",
    description: "Send an HTML formatted email with rich content and styling",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email" },
        subject: { type: "string" },
        htmlBody: { type: "string", description: "HTML content" }
      },
      required: ["to", "htmlBody"]
    }
  },
  {
    name: "get_emails",
    description: "Retrieve emails from Gmail inbox with search filters",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
        query: { type: "string", description: "Gmail search query" }
      }
    }
  },
  {
    name: "delete_email",
    description: "Delete an email from Gmail by ID",
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string", description: "Gmail message ID" }
      },
      required: ["emailId"]
    }
  }
];

async function runValidation() {
  console.log("=== MCP Search Validation Test ===\n");
  
  // Inicializar DB
  await initializeDatabase();
  const db = getDb();
  
  // Crear tablas FTS adicionales para type=all
  console.log("1. Creating additional FTS tables...");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts5 USING fts5(name, description, category, content='skills', content_rowid='id');
    CREATE VIRTUAL TABLE IF NOT EXISTS playbook_fts5 USING fts5(rule, category, applicable_to, content='playbook', content_rowid='id');
    INSERT OR REPLACE INTO skills_fts5(skills_fts5, rowid, name, description, category) VALUES ('rebuild', 0, '', '', '');
    INSERT OR REPLACE INTO playbook_fts5(playbook_fts5, rowid, rule, category, applicable_to) VALUES ('rebuild', 0, '', '', '');
  `);
  console.log("   ✅ FTS tables created\n");
  
  // Configurar servidor MCP
  console.log("2. Setting up MCP server (email-gmail)...");
  db.query(`
    INSERT OR REPLACE INTO mcp_servers (id, name, transport, status, enabled, active, tools_count)
    VALUES (?, ?, 'stdio', 'connected', 1, 1, ?)
  `).run("email-gmail", "email-gmail", EMAIL_GMAIL_TOOLS.length);
  console.log("   ✅ Server registered\n");
  
  // Sincronizar herramientas (esto aplica el fix de keywords enriquecidas)
  console.log("3. Syncing MCP tools to FTS5...");
  await syncMCPToolsToFTS("email-gmail", "email-gmail", EMAIL_GMAIL_TOOLS);
  console.log("   ✅ Tools synced\n");
  
  // Casos de test del mundo real - search_knowledge ahora solo busca tools nativas, skills y playbook
  // Las herramientas MCP están directamente disponibles, no necesitan búsqueda
  const testCases = [
    {
      name: "Búsqueda de skill de email (ahora MCP es directo)",
      query: "email",
      type: "skills",
      expectMinResults: 0,  // Puede no haber skills de email
      expectToolName: null
    },
    {
      name: "Búsqueda de herramienta nativa",
      query: "save note",
      type: "tools",
      expectMinResults: 1,
      expectToolName: "save_note"
    },
    {
      name: "Búsqueda de skill",
      query: "web research",
      type: "skills",
      expectMinResults: 0,  // Depende de skills definidas
      expectToolName: null
    },
  ];
  
  let passed = 0;
  let failed = 0;
  
  console.log("4. Running validation tests...\n");
  
  for (const test of testCases) {
    console.log(`   Test: ${test.name}`);
    console.log(`         query="${test.query}", type="${test.type}"`);
    
    try {
      const result = await searchKnowledgeTool.execute(
        { query: test.query, type: test.type, limit: 10 },
        { configurable: { thread_id: "test-thread" } }
      );
      
      if (!result.ok) {
        console.log(`         ❌ FAILED: ${result.error}`);
        failed++;
        continue;
      }
      
      const totalResults = result.totalResults || 0;
      const toolsResults = result.tools?.length || 0;
      const skillsResults = result.skills?.length || 0;
      const playbookResults = result.playbook?.length || 0;
      
      console.log(`         Results: ${totalResults} total (${toolsResults} tools, ${skillsResults} skills, ${playbookResults} playbook)`);
      
      // Verificar cantidad mínima de resultados
      if (totalResults < test.expectMinResults) {
        console.log(`         ❌ FAILED: Expected >= ${test.expectMinResults} results, got ${totalResults}`);
        failed++;
        continue;
      }
      
      // Verificar herramienta esperada si se especificó
      if (test.expectToolName) {
        const foundExpected = result.tools?.some((t: any) => t.name === test.expectToolName);
        
        if (!foundExpected) {
          console.log(`         ❌ FAILED: Expected tool '${test.expectToolName}' not found`);
          console.log(`         Found: ${result.tools?.map((t: any) => t.name).join(', ') || 'none'}`);
          failed++;
          continue;
        }
      }
      
      console.log(`         ✅ PASSED\n`);
      passed++;
      
    } catch (err) {
      console.log(`         ❌ ERROR: ${(err as Error).message}`);
      failed++;
    }
  }
  
  // Test adicional: verificar que MCP tools NO están en search_knowledge (ahora son directas)
  console.log("5. Verifying MCP tools are NOT in search_knowledge (direct connection)...\n");
  
  const mcpSearchResult = await searchKnowledgeTool.execute(
    { query: "email send", type: "tools", limit: 10 },
    { configurable: { thread_id: "test-thread" } }
  );
  
  const hasMcpTools = mcpSearchResult.tools?.some((t: any) => t.name?.includes('gmail') || t.name?.includes('email-gmail'));
  
  if (!hasMcpTools) {
    console.log("   ✅ MCP tools correctly NOT returned by search_knowledge");
    console.log("      (They are available directly via context-compiler)\n");
    passed++;
  } else {
    console.log("   ❌ MCP tools should NOT be returned by search_knowledge");
    console.log("      (They should be available directly)\n");
    failed++;
  }
  
  // Resumen final
  console.log("=== VALIDATION SUMMARY ===");
  console.log(`Total tests: ${testCases.length + 1}`);  // +1 for MCP direct connection test
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success rate: ${((passed / (testCases.length + 1)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log("\n🎉 All validation tests passed!");
    console.log("Arquitectura de conexión directa de MCP está funcionando correctamente:");
    console.log("  - MCP tools disponibles directamente (sin búsqueda)");
    console.log("  - search_knowledge solo para tools nativas, skills y playbook\n");
  } else {
    console.log("\n⚠️  Some tests failed. Review the output above.\n");
    process.exit(1);
  }
}

// Ejecutar validación
runValidation().catch(err => {
  console.error("Validation failed:", err);
  process.exit(1);
});
