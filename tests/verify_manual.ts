import { Database } from "bun:sqlite";
import * as path from "node:path";

// The user indicated .hive-dev as the target directory for development
const DB_PATH = path.join(process.cwd(), ".hive-dev", "data", "hive.db");

async function verify() {
    console.log("🚀 Manual FTS5 Audit Verification (.hive-dev)...");
    const results: any = {
        dbPath: DB_PATH,
        timestamp: new Date().toISOString()
    };

    try {
        const db = new Database(DB_PATH);

        // 1. Check Tables
        const allTables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => (t as any).name);
        results.ftsTables = allTables.filter(n => n.endsWith("_fts"));

        // 2. Count Records
        results.counts = {
            tools_fts: (db.query("SELECT COUNT(*) as count FROM tools_fts").get() as any)?.count || 0,
            skills_fts: (db.query("SELECT COUNT(*) as count FROM skills_fts").get() as any)?.count || 0,
            playbook_fts: (db.query("SELECT COUNT(*) as count FROM playbook_fts").get() as any)?.count || 0
        };

        // 3. Sample Search
        if (results.counts.playbook_fts > 0) {
            results.samplePlaybookSearch = db.query(`
                SELECT playbook_id, rule, rank
                FROM playbook_fts
                WHERE playbook_fts MATCH 'error'
                ORDER BY rank
                LIMIT 2
            `).all();
        }

        results.success = true;
    } catch (err) {
        results.success = false;
        results.error = (err as Error).message;
    }

    await Bun.write("/tmp/fts_audit_results.json", JSON.stringify(results, null, 2));
    console.log("✨ Results written to /tmp/fts_audit_results.json");
}

verify();
