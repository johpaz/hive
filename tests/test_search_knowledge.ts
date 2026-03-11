/**
 * Test para la herramienta search_knowledge
 * Valida que encuentra tools, skills y playbook por nombre y descripción
 */
import { Database } from "bun:sqlite";
import { existsSync } from "fs";

const dbPath = `${process.env.HOME}/.hive-dev/data/hive.db`;
if (!existsSync(dbPath)) {
    console.log("❌ DB no existe:", dbPath);
    process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

console.log("=== search_knowledge Tool Test ===\n");

// Función que simula la query de search_knowledge
function searchTools(query: string, limit: number = 10) {
    const escapedQuery = query.replace(/'/g, "''");
    
    console.log(`\n🔍 Buscando tools: "${query}"`);
    console.log(`   Query FTS5: tool_name:("${escapedQuery}"* OR ${escapedQuery}) OR ("${escapedQuery}"* OR ${escapedQuery})`);
    
    try {
        const toolRows = db.query(`
          SELECT t.id, t.name, t.description, t.category, t.enabled, t.active,
                 bm25(tools_fts, 1.0, 1.0, 0.5) as rank
          FROM tools_fts
          JOIN tools t ON t.id = tools_fts.rowid
          WHERE tools_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(`tool_name:("${escapedQuery}"* OR ${escapedQuery}) OR ("${escapedQuery}"* OR ${escapedQuery})`, limit) as any[];
        
        console.log(`   ✅ Encontradas: ${toolRows.length} tools`);
        toolRows.forEach((row: any) => {
            const status = row.enabled === 1 && row.active === 1 ? "✅" : "⚠️";
            console.log(`   ${status} ${row.name} [${row.category}] (rank: ${row.rank?.toFixed(2)})`);
            if (row.description) {
                console.log(`      → ${row.description.substring(0, 80)}...`);
            }
        });
        return toolRows;
    } catch (err: any) {
        console.log(`   ❌ Error:`, err.message);
        return [];
    }
}

function searchSkills(query: string, limit: number = 10) {
    const escapedQuery = query.replace(/'/g, "''");
    
    console.log(`\n🔍 Buscando skills: "${query}"`);
    
    try {
        const skillRows = db.query(`
          SELECT s.id, s.name, s.description, s.category, s.source, s.enabled, s.active,
                 bm25(skills_fts, 1.0, 1.0, 0.5) as rank
          FROM skills_fts
          JOIN skills s ON s.id = skills_fts.rowid
          WHERE skills_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(`name:("${escapedQuery}"* OR ${escapedQuery}) OR ("${escapedQuery}"* OR ${escapedQuery})`, limit) as any[];
        
        console.log(`   ✅ Encontradas: ${skillRows.length} skills`);
        skillRows.forEach((row: any) => {
            const status = row.enabled === 1 && row.active === 1 ? "✅" : "⚠️";
            console.log(`   ${status} ${row.name} [${row.category}] (rank: ${row.rank?.toFixed(2)})`);
        });
        return skillRows;
    } catch (err: any) {
        console.log(`   ❌ Error:`, err.message);
        return [];
    }
}

function searchPlaybook(query: string, limit: number = 10) {
    const escapedQuery = query.replace(/'/g, "''");
    
    console.log(`\n🔍 Buscando playbook: "${query}"`);
    
    try {
        const playbookRows = db.query(`
          SELECT p.id, p.rule, p.category, p.helpful_count, p.active,
                 bm25(playbook_fts, 1.0, 1.0, 0.5) as rank
          FROM playbook_fts
          JOIN playbook p ON p.id = playbook_fts.rowid
          WHERE playbook_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(`rule:("${escapedQuery}"* OR ${escapedQuery}) OR ("${escapedQuery}"* OR ${escapedQuery})`, limit) as any[];
        
        console.log(`   ✅ Encontradas: ${playbookRows.length} reglas`);
        playbookRows.forEach((row: any) => {
            const status = row.active === 1 ? "✅" : "⚠️";
            console.log(`   ${status} [${row.category}] (rank: ${row.rank?.toFixed(2)})`);
            console.log(`      → ${row.rule.substring(0, 80)}...`);
        });
        return playbookRows;
    } catch (err: any) {
        console.log(`   ❌ Error:`, err.message);
        return [];
    }
}

// Tests con queries que el agente suele enviar
const testQueries = [
    { type: "tools", query: "cron_list" },
    { type: "tools", query: "cron_edit" },
    { type: "tools", query: "cron_add" },
    { type: "tools", query: "cron" },
    { type: "tools", query: "editar tarea" },
    { type: "tools", query: "web_search" },
    { type: "tools", query: "search_knowledge" },
    { type: "skills", query: "summarize" },
    { type: "playbook", query: "error" },
];

console.log("=== Estado de la BD ===");
const toolCount = db.query("SELECT COUNT(*) as n FROM tools WHERE enabled=1 AND active=1").get() as any;
const ftsCount = db.query("SELECT COUNT(*) as n FROM tools_fts").get() as any;
console.log(`Tools activas: ${toolCount.n}`);
console.log(`Tools en FTS5: ${ftsCount.n}`);

const skillCount = db.query("SELECT COUNT(*) as n FROM skills_fts").get() as any;
console.log(`Skills en FTS5: ${skillCount.n}`);

const playbookCount = db.query("SELECT COUNT(*) as n FROM playbook_fts").get() as any;
console.log(`Playbook en FTS5: ${playbookCount.n}`);

console.log("\n=== Ejecutando tests ===");
for (const test of testQueries) {
    if (test.type === "tools") {
        searchTools(test.query);
    } else if (test.type === "skills") {
        searchSkills(test.query);
    } else if (test.type === "playbook") {
        searchPlaybook(test.query);
    }
}

// Test específico para cron_tools
console.log("\n=== Verificación cron_tools ===");
const cronTools = db.query("SELECT name, enabled, active FROM tools WHERE name LIKE 'cron_%'").all() as any[];
console.log("Tools en DB:");
cronTools.forEach(t => {
    const status = t.enabled === 1 && t.active === 1 ? "✅" : t.enabled === 1 ? "⚠️ active=0" : "❌ enabled=0";
    console.log(`  ${status} ${t.name}`);
});

const cronFts = db.query("SELECT tool_name FROM tools_fts WHERE tool_name LIKE 'cron_%'").all() as any[];
console.log("\nTools en FTS5:");
cronFts.forEach(t => console.log(`  ✅ ${t.tool_name}`));

db.close();
console.log("\n=== Test completo ===");
