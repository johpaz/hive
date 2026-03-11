/**
 * Test FTS5 against the real hive.db
 */
import { Database } from "bun:sqlite";
import { existsSync } from "fs";

const dbPath = `${process.env.HOME}/.hive-dev/data/hive.db`;
if (!existsSync(dbPath)) {
    console.log("❌ DB no existe:", dbPath);
    process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// 1. Verificar tabla tools y su contenido
console.log("=== 1. Tabla tools ===");
try {
    const tools = db.query("SELECT name, description, category FROM tools WHERE enabled=1 AND active=1").all();
    console.log(`  Tools en BD: ${tools.length}`);
    (tools as any[]).slice(0, 3).forEach((t: any) => console.log(`    → ${t.name} [${t.category}]`));
} catch (e: any) {
    console.log("  ❌ Error:", e.message || JSON.stringify(e));
}

// 2. Verificar tabla tools_fts
console.log("\n=== 2. Tabla tools_fts ===");
try {
    const count = db.query("SELECT count(*) as n FROM tools_fts").get() as any;
    console.log(`  Registros en tools_fts: ${count.n}`);
    if (count.n > 0) {
        const rows = db.query("SELECT * FROM tools_fts LIMIT 3").all();
        (rows as any[]).forEach((r: any) => console.log(`    → ${r.tool_name}: ${(r.description || "").substring(0, 50)}`));
    }
} catch (e: any) {
    console.log("  ❌ Error:", e.message || JSON.stringify(e));
}

// 3. Probar MATCH query
console.log("\n=== 3. FTS5 MATCH query ===");
try {
    const results = db.query(`
    SELECT tool_name, bm25(tools_fts) as score
    FROM tools_fts WHERE tools_fts MATCH 'search'
    ORDER BY score ASC LIMIT 5
  `).all();
    console.log(`  Resultados para 'search': ${results.length}`);
    (results as any[]).forEach((r: any) => console.log(`    → ${r.tool_name} (score: ${r.score})`));
} catch (e: any) {
    console.log("  ❌ Error:", e.message || JSON.stringify(e));
}

// 4. Verificar skills_fts
console.log("\n=== 4. Tabla skills_fts ===");
try {
    const count = db.query("SELECT count(*) as n FROM skills_fts").get() as any;
    console.log(`  Registros en skills_fts: ${count.n}`);
} catch (e: any) {
    console.log("  ❌ Error:", e.message || JSON.stringify(e));
}

// 5. Verificar playbook_fts
console.log("\n=== 5. Tabla playbook_fts ===");
try {
    const count = db.query("SELECT count(*) as n FROM playbook_fts").get() as any;
    console.log(`  Registros en playbook_fts: ${count.n}`);
} catch (e: any) {
    console.log("  ❌ Error:", e.message || JSON.stringify(e));
}

// 6. Simular lo que hace context-compiler
console.log("\n=== 6. Simulación context-compiler ===");
try {
    const dbTools = db.query(`
    SELECT name, description, category, enabled, active
    FROM tools WHERE enabled = 1 AND active = 1
  `).all() as any[];
    console.log(`  Tools activas: ${dbTools.length}`);

    if (dbTools.length > 0) {
        // Simular buildFTSQuery con el primer tool name
        const testQuery = "buscar información en internet"
        const words = testQuery.toLowerCase().replace(/['\"*()[\]]/g, " ").split(/\s+/).filter(w => w.length > 2).slice(0, 5);
        const ftsQ = words.join(" OR ");
        console.log(`  FTS query simulada: "${ftsQ}"`);

        const ftsResults = db.query(`
      SELECT tool_name, bm25(tools_fts) as bm25_score
      FROM tools_fts WHERE tools_fts MATCH ?
      ORDER BY bm25_score ASC LIMIT 10
    `).all(ftsQ) as any[];
        console.log(`  Resultados: ${ftsResults.length}`);
        ftsResults.forEach((r: any) => console.log(`    → ${r.tool_name} (${r.bm25_score})`));
    }
} catch (e: any) {
    console.log("  ❌ Error:", e.message || JSON.stringify(e));
}

db.close();
console.log("\n=== Test completo ===");
