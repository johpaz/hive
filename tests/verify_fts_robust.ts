import { Database } from "bun:sqlite";
import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { syncToolsToFTS, syncSkillsToFTS, syncPlaybookToFTS } from "../packages/core/src/agent/context-compiler";
import { selectPlaybookRules } from "../packages/core/src/agent/playbook-selector";

async function verify() {
    console.log("🚀 Starting robust FTS5 audit verification...");

    // Initialize DB
    initializeDatabase();
    const db = getDb();

    // 1. Check schemas
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'").all();
    console.log("Tables found:", tables.map(t => (t as any).name));

    // 2. Perform Sync
    console.log("⏳ Syncing all indexes...");
    const start = performance.now();
    await Promise.all([
        syncToolsToFTS(),
        syncSkillsToFTS(),
        syncPlaybookToFTS()
    ]);
    const end = performance.now();
    console.log(`✅ Sync completed in ${(end - start).toFixed(2)}ms`);

    // 3. Verify tool counts
    const toolCountFTS = db.query("SELECT COUNT(*) as count FROM tools_fts").get() as any;
    const toolCountDB = db.query("SELECT COUNT(*) as count FROM tools").get() as any;
    console.log(`Tools: DB=${toolCountDB.count}, FTS=${toolCountFTS.count}`);

    // 4. Verify skill counts
    const skillCountFTS = db.query("SELECT COUNT(*) as count FROM skills_fts").get() as any;
    const skillCountDB = db.query("SELECT COUNT(*) as count FROM skills").get() as any;
    console.log(`Skills: DB=${skillCountDB.count}, FTS=${skillCountFTS.count}`);

    // 5. Verify playbook counts
    const playbookCountFTS = db.query("SELECT COUNT(*) as count FROM playbook_fts").get() as any;
    const playbookCountDB = db.query("SELECT COUNT(*) as count FROM playbook WHERE active = 1").get() as any;
    console.log(`Playbook: DB(active)=${playbookCountDB.count}, FTS=${playbookCountFTS.count}`);

    // 6. Test semantic search on playbook
    console.log("\n🔍 Testing semantic search (Playbook):");
    const testMessages = [
        "como manejo errores de api?",
        "recordatorios de cumpleaños",
        "saludar al usuario"
    ];

    for (const msg of testMessages) {
        const rules = selectPlaybookRules(msg);
        console.log(`Query: "${msg}" -> Found ${rules.length} rules`);
        if (rules.length > 0) {
            console.log(`   - Top rule: ${rules[0].rule.substring(0, 50)}...`);
        }
    }

    console.log("\n✨ Verification finished successfully!");
}

verify().catch(console.error);
