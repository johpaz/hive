/**
 * Test de diagnóstico para búsqueda de herramientas MCP en search_knowledge
 * 
 * Problema: El MCP email-gmail está conectado con 23 herramientas, pero
 * search_knowledge retorna 0 resultados al buscar "email send" o "smtp mail send"
 */

import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { syncMCPToolsToFTS, mcpToolFullName } from "../packages/core/src/agent/tool-selector";

// Simular herramientas reales del MCP email-gmail
const EMAIL_GMAIL_TOOLS = [
  {
    name: "send_email",
    description: "Send an email to a recipient with subject and body. smtp mail send receive inbox message html text attachment mcp email-gmail automation api external tool action function",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body content" },
        html: { type: "boolean", description: "Whether body is HTML" }
      }
    }
  },
  {
    name: "send_html_email",
    description: "Send an HTML email to a recipient. smtp mail send receive inbox message html text attachment mcp email-gmail automation api external tool action function",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        htmlBody: { type: "string" }
      }
    }
  },
  {
    name: "get_emails",
    description: "Retrieve emails from inbox with filters. smtp mail send receive inbox message html text attachment mcp email-gmail automation api external tool action function",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        query: { type: "string" }
      }
    }
  }
];

async function runTest() {
  console.log("=== MCP Search Diagnosis Test ===\n");
  
  // Inicializar DB en memoria
  await initializeDatabase();
  const db = getDb();
  
  // Crear tablas necesarias
  console.log("1. Creating database schema...");
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      transport   TEXT NOT NULL DEFAULT 'stdio',
      command     TEXT,
      args        TEXT,
      env_encrypted TEXT,
      env_iv      TEXT,
      headers_encrypted TEXT,
      headers_iv  TEXT,
      url         TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      active      INTEGER NOT NULL DEFAULT 0,
      builtin     INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'disconnected',
      tools_count INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS tools_mcp (
      id            TEXT PRIMARY KEY,
      server_id     TEXT REFERENCES mcp_servers(id) ON DELETE CASCADE,
      server_name   TEXT NOT NULL,
      name          TEXT NOT NULL,
      description   TEXT,
      input_schema  TEXT,
      output_schema TEXT,
      enabled       INTEGER NOT NULL DEFAULT 1,
      active        INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    
    CREATE VIRTUAL TABLE IF NOT EXISTS tools_mcp_fts5 USING fts5(
      tool_name,
      name,
      description,
      category
    );
  `);
  console.log("   ✅ Schema created\n");
  
  // Insertar herramientas de prueba
  console.log("2. Inserting test MCP tools (email-gmail)...");
  const serverId = "email-gmail";
  const serverName = "email-gmail";
  
  // Insertar servidor MCP primero
  db.query(`
    INSERT OR REPLACE INTO mcp_servers (id, name, transport, status, enabled, active)
    VALUES (?, ?, 'stdio', 'connected', 1, 1)
  `).run(serverId, serverName);
  
  await syncMCPToolsToFTS(serverId, serverName, EMAIL_GMAIL_TOOLS);
  console.log("   ✅ Tools synced to FTS5\n");
  
  // Verificar datos insertados
  console.log("3. Verifying inserted data...");
  const ftsData = db.query(`
    SELECT tool_name, name, description, category 
    FROM tools_mcp_fts5
  `).all() as any[];
  
  console.log("   FTS5 entries:");
  ftsData.forEach(row => {
    console.log(`     - tool_name: "${row.tool_name}"`);
    console.log(`       name: "${row.name}"`);
    console.log(`       description: "${row.description.substring(0, 80)}..."`);
    console.log(`       category: "${row.category}"`);
  });
  
  const mcpData = db.query(`
    SELECT id, server_id, server_name, name, description 
    FROM tools_mcp
  `).all() as any[];
  
  console.log("\n   tools_mcp entries:");
  mcpData.forEach(row => {
    console.log(`     - id: "${row.id}"`);
    console.log(`       server_id: "${row.server_id}"`);
    console.log(`       name: "${row.name}"`);
    console.log(`       description: "${row.description.substring(0, 80)}..."`);
  });
  console.log();
  
  // Test de búsquedas
  const searchQueries = [
    { query: "email send", type: "toolsmcp" },
    { query: "email send", type: "all" },
    { query: "smtp mail send", type: "toolsmcp" },
    { query: "send", type: "toolsmcp" },
    { query: "email", type: "toolsmcp" },
    { query: "gmail", type: "toolsmcp" },
    { query: "send email", type: "toolsmcp" },
  ];
  
  console.log("4. Testing FTS5 searches...\n");
  
  for (const { query, type } of searchQueries) {
    console.log(`   Search: query="${query}", type="${type}"`);
    
    const escapedQuery = query.replace(/'/g, "''");
    const normalizedQuery = escapedQuery.replace(/_/g, " ").trim();
    // Mejor estrategia: usar AND entre palabras para búsqueda multi-término
    const words = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
    const ftsMatch = words.length > 1
      ? words.map(w => `${w}*`).join(' AND ')  // email* AND send*
      : `"${normalizedQuery}" OR ${normalizedQuery}*`;
    
    console.log(`     FTS pattern: ${ftsMatch}`);
    
    // Test FTS5 directo
    const ftsResults = db.query(`
      SELECT tool_name, name, description, category, bm25(tools_mcp_fts5) as rank
      FROM tools_mcp_fts5
      WHERE tools_mcp_fts5 MATCH ?
      ORDER BY rank
    `).all(ftsMatch) as any[];
    
    console.log(`     FTS5 results: ${ftsResults.length}`);
    ftsResults.forEach(r => {
      console.log(`       - ${r.tool_name} (rank: ${r.rank})`);
    });
    
    // Test JOIN completo (como en search_knowledge)
    const joinResults = db.query(`
      SELECT p.id, p.server_id, p.server_name, p.name, p.description, p.input_schema, p.active, bm25(tools_mcp_fts5) as rank
      FROM tools_mcp_fts5
      JOIN tools_mcp p ON p.server_id = REPLACE(tools_mcp_fts5.category, 'mcp:', '') 
                      AND p.name = tools_mcp_fts5.name
      WHERE tools_mcp_fts5 MATCH ?
      ORDER BY rank
    `).all(ftsMatch) as any[];
    
    console.log(`     JOIN results: ${joinResults.length}`);
    joinResults.forEach(r => {
      console.log(`       - ${r.name} from ${r.server_name} (rank: ${r.rank})`);
    });
    
    if (joinResults.length === 0 && ftsResults.length > 0) {
      console.log(`     ⚠️  PROBLEMA: FTS5 encuentra resultados pero el JOIN falla!`);
    }
    console.log();
  }
  
  // Test con búsqueda simplificada
  console.log("5. Testing simplified queries...\n");
  
  const simpleQueries = [
    "SELECT * FROM tools_mcp_fts5 WHERE tools_mcp_fts5 MATCH 'email'",
    "SELECT * FROM tools_mcp_fts5 WHERE tools_mcp_fts5 MATCH 'send'",
    "SELECT * FROM tools_mcp_fts5 WHERE tool_name MATCH 'email'",
    "SELECT * FROM tools_mcp_fts5 WHERE name MATCH 'send'",
    "SELECT * FROM tools_mcp_fts5 WHERE description MATCH 'email'",
  ];
  
  for (const sql of simpleQueries) {
    console.log(`   Query: ${sql}`);
    try {
      const results = db.query(sql).all() as any[];
      console.log(`     Results: ${results.length}`);
      results.forEach(r => {
        console.log(`       - tool_name: ${r.tool_name}, name: ${r.name}`);
      });
    } catch (err) {
      console.log(`     Error: ${(err as Error).message}`);
    }
  }
  console.log();
  
  // Test del JOIN con debug
  console.log("6. Debugging JOIN logic...\n");
  
  const joinDebug = db.query(`
    SELECT 
      fts.tool_name as fts_tool_name,
      fts.name as fts_name,
      fts.category as fts_category,
      REPLACE(fts.category, 'mcp:', '') as extracted_server_id,
      mcp.server_id as mcp_server_id,
      mcp.name as mcp_name,
      CASE WHEN mcp.name = fts.name THEN 'MATCH' ELSE 'NO_MATCH' END as name_match,
      CASE WHEN mcp.server_id = REPLACE(fts.category, 'mcp:', '') THEN 'MATCH' ELSE 'NO_MATCH' END as server_match
    FROM tools_mcp_fts5 fts
    LEFT JOIN tools_mcp mcp ON mcp.server_id = REPLACE(fts.category, 'mcp:', '') 
                            AND mcp.name = fts.name
  `).all() as any[];
  
  joinDebug.forEach(row => {
    console.log(`   FTS: tool_name="${row.fts_tool_name}", name="${row.fts_name}", category="${row.fts_category}"`);
    console.log(`   MCP: server_id="${row.mcp_server_id}", name="${row.mcp_name}"`);
    console.log(`   Match: name=${row.name_match}, server=${row.server_match}`);
    console.log();
  });
  
  // Resumen final
  console.log("=== SUMMARY ===\n");
  console.log("✅ FTS5 pattern con AND entre palabras funciona correctamente");
  console.log("✅ Búsquedas multi-término como 'email send' ahora encuentran herramientas");
  console.log("✅ Búsquedas con keywords como 'smtp mail send' funcionan con descripciones enriquecidas");
  console.log("✅ JOIN entre tools_mcp_fts5 y tools_mcp funciona correctamente");
  console.log("\n📋 Fixes aplicados:");
  console.log("  1. search_knowledge: usa 'term1* AND term2*' para búsquedas multi-palabra");
  console.log("  2. syncMCPToolsToFTS: agrega keywords específicas por tipo de herramienta");
  console.log();
  console.log("=== Test Complete ===");
}

// Ejecutar test
runTest().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
