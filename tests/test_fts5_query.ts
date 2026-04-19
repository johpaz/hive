/**
 * Test FTS5 query para tool-selector
 * Valida que la query encuentra herramientas por nombre y descripción
 */
import { Database } from "bun:sqlite";
import { existsSync } from "fs";

const dbPath = `${process.env.HOME}/.hive-dev/data/hive.db`;
if (!existsSync(dbPath)) {
    console.log("❌ DB no existe:", dbPath);
    process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

console.log("=== 1. Tools activas en DB ===");
const activeTools = db.query("SELECT name, category FROM tools WHERE enabled = 1 AND active = 1").all() as any[];
console.log(`  Total: ${activeTools.length}`);
const cronTools = activeTools.filter(t => t.name.startsWith('cron.'));
console.log(`  Cron tools: ${cronTools.length}`);
cronTools.forEach(t => console.log(`    → ${t.name}`));

console.log("\n=== 2. Tools en FTS5 ===");
const ftsCount = db.query("SELECT COUNT(*) as n FROM tools_fts").get() as any;
console.log(`  Total en tools_fts: ${ftsCount.n}`);

// Verificar contenido de tools_fts para cron.update
console.log("\n=== 3. Contenido de tools_fts para cron_* ===");
const cronFts = db.query("SELECT tool_name, name, category FROM tools_fts WHERE tool_name LIKE 'cron.%'").all() as any[];
console.log(`  Cron tools en FTS5: ${cronFts.length}`);
cronFts.forEach(t => console.log(`    → ${t.tool_name} [${t.category}]`));

// Test de queries
const testQueries = [
    "cron.update",
    "cron.list",
    "cron",
    "editar tarea programada",
    "listar tareas",
    "programar recordatorio"
];

for (const testQuery of testQueries) {
    console.log(`\n=== 4. Test FTS5 query: '${testQuery}' ===`);
    
    // Construir query como lo hace tool-selector.ts
    const words = testQuery
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 8);
    const ftsQuery = words.join(" OR ");
    console.log(`  FTS query construida: "${ftsQuery}"`);
    
    // Test 1: Query original (busca en todas las columnas)
    try {
        const originalResults = db.query(`
          SELECT tool_name, bm25(tools_fts) as bm25_score
          FROM tools_fts
          WHERE tools_fts MATCH ?
          ORDER BY bm25_score ASC
          LIMIT 10
        `).all(ftsQuery) as any[];
        console.log(`  ✅ Query original (MATCH ?): ${originalResults.length} resultados`);
        originalResults.slice(0, 3).forEach((r: any) => console.log(`      → ${r.tool_name} (score: ${r.bm25_score})`));
    } catch (e: any) {
        console.log(`  ❌ Query original falló:`, e.message);
    }
    
    // Test 2: Nueva query (tool_name + todas las columnas)
    try {
        const newResults = db.query(`
          SELECT tool_name, bm25(tools_fts) as bm25_score
          FROM tools_fts
          WHERE tools_fts MATCH ?
          ORDER BY bm25_score ASC
          LIMIT 10
        `).all(`tool_name:(${ftsQuery}) OR (${ftsQuery})`) as any[];
        console.log(`  ✅ Nueva query (tool_name:(...) OR (...)): ${newResults.length} resultados`);
        newResults.slice(0, 3).forEach((r: any) => console.log(`      → ${r.tool_name} (score: ${r.bm25_score})`));
    } catch (e: any) {
        console.log(`  ❌ Nueva query falló:`, e.message);
    }
    
    // Test 3: Solo tool_name
    try {
        const nameOnlyResults = db.query(`
          SELECT tool_name, bm25(tools_fts) as bm25_score
          FROM tools_fts
          WHERE tools_fts MATCH ?
          ORDER BY bm25_score ASC
          LIMIT 10
        `).all(`tool_name:(${ftsQuery})`) as any[];
        console.log(`  ✅ Solo tool_name (tool_name:(...)): ${nameOnlyResults.length} resultados`);
        nameOnlyResults.slice(0, 3).forEach((r: any) => console.log(`      → ${r.tool_name} (score: ${r.bm25_score})`));
    } catch (e: any) {
        console.log(`  ❌ Solo tool_name falló:`, e.message);
    }
}

// Verificar si hay herramientas con enabled=1 pero active=0
console.log("\n=== 5. Tools enabled vs active ===");
const enabledTools = db.query("SELECT COUNT(*) as n FROM tools WHERE enabled = 1").get() as any;
const activeToolsCount = db.query("SELECT COUNT(*) as n FROM tools WHERE active = 1").get() as any;
const bothTools = db.query("SELECT COUNT(*) as n FROM tools WHERE enabled = 1 AND active = 1").get() as any;
console.log(`  enabled=1: ${enabledTools.n}`);
console.log(`  active=1: ${activeToolsCount.n}`);
console.log(`  enabled=1 AND active=1: ${bothTools.n}`);

// Verificar cron_tools específicas
console.log("\n=== 6. Estado de cron_tools ===");
const cronToolsDetail = db.query("SELECT name, enabled, active FROM tools WHERE name LIKE 'cron.%'").all() as any[];
cronToolsDetail.forEach(t => {
    const status = t.enabled === 1 && t.active === 1 ? "✅" : t.enabled === 1 ? "⚠️ active=0" : "❌ enabled=0";
    console.log(`  ${status} ${t.name} (enabled=${t.enabled}, active=${t.active})`);
});

db.close();
console.log("\n=== Test completo ===");
