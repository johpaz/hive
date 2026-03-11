#!/usr/bin/env bun
/**
 * Test MCP FTS5 Search
 * 
 * Verifica que las herramientas MCP estén en FTS5 y se puedan buscar
 */

import { Database } from "bun:sqlite";
import path from "node:path";

const DB_PATH = path.join(process.env.HOME || "~", ".hive-dev", "data", "hive.db");

async function testMCPFTS5() {
  console.log("🧪 MCP FTS5 Search Test\n");
  console.log("=".repeat(50));
  
  const db = new Database(DB_PATH, { readonly: true });
  
  // Step 1: Count all tools in FTS5
  console.log("\n📊 Step 1: Total tools in FTS5");
  const totalTools = db.query("SELECT count(*) as count FROM tools_fts").get() as { count: number };
  console.log(`   Total: ${totalTools.count} tools`);
  
  // Step 2: Count tools by category
  console.log("\n📂 Step 2: Tools by category");
  const byCategory = db.query(`
    SELECT category, count(*) as count 
    FROM tools_fts 
    GROUP BY category 
    ORDER BY count DESC
  `).all() as { category: string; count: number }[];
  
  for (const row of byCategory) {
    console.log(`   ${row.category}: ${row.count}`);
  }
  
  // Step 3: Check MCP tools specifically
  console.log("\n🔌 Step 3: MCP tools in FTS5");
  const mcpTools = db.query(`
    SELECT tool_name, name, category 
    FROM tools_fts 
    WHERE category LIKE 'mcp:%'
    LIMIT 20
  `).all() as { tool_name: string; name: string; category: string }[];
  
  if (mcpTools.length === 0) {
    console.log("   ❌ No MCP tools found in FTS5!");
  } else {
    console.log(`   ✅ Found ${mcpTools.length} MCP tools:`);
    for (const tool of mcpTools) {
      console.log(`      - ${tool.tool_name} (${tool.name})`);
    }
  }
  
  // Step 4: Test FTS5 search for "twitter"
  console.log("\n🔍 Step 4: FTS5 search for 'twitter'");
  const twitterSearch = db.query(`
    SELECT tool_name, name, category, bm25(tools_fts) as score
    FROM tools_fts 
    WHERE tool_name MATCH 'twitter' OR name MATCH 'twitter'
    ORDER BY score
    LIMIT 10
  `).all() as { tool_name: string; name: string; category: string; score: number }[];
  
  if (twitterSearch.length === 0) {
    console.log("   ❌ No tools found for 'twitter'");
  } else {
    console.log(`   ✅ Found ${twitterSearch.length} tools:`);
    for (const tool of twitterSearch) {
      console.log(`      - ${tool.tool_name} (${tool.category}) [score: ${tool.score}]`);
    }
  }
  
  // Step 5: Test FTS5 search for "perplexity"
  console.log("\n🔍 Step 5: FTS5 search for 'perplexity'");
  const perplexitySearch = db.query(`
    SELECT tool_name, name, category, bm25(tools_fts) as score
    FROM tools_fts 
    WHERE tool_name MATCH 'perplexity' OR name MATCH 'perplexity'
    ORDER BY score
    LIMIT 10
  `).all() as { tool_name: string; name: string; category: string; score: number }[];
  
  if (perplexitySearch.length === 0) {
    console.log("   ❌ No tools found for 'perplexity'");
  } else {
    console.log(`   ✅ Found ${perplexitySearch.length} tools:`);
    for (const tool of perplexitySearch) {
      console.log(`      - ${tool.tool_name} (${tool.category}) [score: ${tool.score}]`);
    }
  }
  
  // Step 6: Test FTS5 search for "post"
  console.log("\n🔍 Step 6: FTS5 search for 'post'");
  const postSearch = db.query(`
    SELECT tool_name, name, category, bm25(tools_fts) as score
    FROM tools_fts 
    WHERE tool_name MATCH 'post' OR name MATCH 'post'
    ORDER BY score
    LIMIT 10
  `).all() as { tool_name: string; name: string; category: string; score: number }[];
  
  if (postSearch.length === 0) {
    console.log("   ❌ No tools found for 'post'");
  } else {
    console.log(`   ✅ Found ${postSearch.length} tools:`);
    for (const tool of postSearch) {
      console.log(`      - ${tool.tool_name} (${tool.category}) [score: ${tool.score}]`);
    }
  }
  
  // Step 7: Show sample of MCP tool entries
  console.log("\n📋 Step 7: Sample MCP tool entries");
  const sampleMCP = db.query(`
    SELECT tool_name, name, description, category 
    FROM tools_fts 
    WHERE category LIKE 'mcp:%'
    LIMIT 5
  `).all() as { tool_name: string; name: string; description: string; category: string }[];
  
  for (const tool of sampleMCP) {
    console.log(`\n   Tool: ${tool.tool_name}`);
    console.log(`   Name: ${tool.name}`);
    console.log(`   Category: ${tool.category}`);
    console.log(`   Description: ${tool.description.substring(0, 100)}...`);
  }
  
  db.close();
  
  console.log("\n" + "=".repeat(50));
  console.log("✅ Test completed!\n");
}

testMCPFTS5().catch(console.error);
