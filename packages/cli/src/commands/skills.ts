import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";

const SKILLS_DIR = path.join(process.env.HOME || "", ".hive", "skills");
const BUNDLED_SKILLS: Array<{ slug: string; name: string; description: string }> = [
  { slug: "web-search", name: "Web Search", description: "Search the web using multiple search engines" },
  { slug: "code-exec", name: "Code Execution", description: "Execute code snippets safely" },
  { slug: "file-ops", name: "File Operations", description: "Read, write, and manage files" },
  { slug: "memory", name: "Memory", description: "Persistent memory and notes" },
  { slug: "cron", name: "Cron Jobs", description: "Schedule recurring tasks" },
];

export async function skills(subcommand: string | undefined, args: string[]): Promise<void> {
  switch (subcommand) {
    case "list":
      await listSkills();
      break;
    case "search":
      await searchSkills(args[0]);
      break;
    case "install":
      await installSkill(args[0]);
      break;
    case "remove":
      await removeSkill(args[0]);
      break;
    case "update":
      await updateSkills();
      break;
    default:
      console.log(`
Usage: hive skills <command>

Commands:
  list              Listar skills instaladas
  search <query>    Buscar skills
  install <slug>    Instalar skill
  remove <nombre>   Eliminar skill
  update            Actualizar skills
`);
  }
}

async function listSkills(): Promise<void> {
  console.log("\n📚 Skills instaladas:\n");

  console.log("  Bundled (incluidas):");
  for (const skill of BUNDLED_SKILLS) {
    console.log(`    • ${skill.name} (${skill.slug})`);
    console.log(`      ${skill.description}`);
  }

  if (fs.existsSync(SKILLS_DIR)) {
    const managedSkills = fs.readdirSync(SKILLS_DIR).filter((f) => {
      const skillPath = path.join(SKILLS_DIR, f);
      return fs.statSync(skillPath).isDirectory();
    });

    if (managedSkills.length > 0) {
      console.log("\n  Managed (instaladas):");
      for (const slug of managedSkills) {
        const skillPath = path.join(SKILLS_DIR, slug, "skill.json");
        if (fs.existsSync(skillPath)) {
          const meta = JSON.parse(fs.readFileSync(skillPath, "utf-8"));
          console.log(`    • ${meta.name || slug}`);
          console.log(`      ${meta.description || "Sin descripción"}`);
        } else {
          console.log(`    • ${slug}`);
        }
      }
    }
  }

  console.log();
}

async function searchSkills(query: string | undefined): Promise<void> {
  if (!query) {
    console.log("❌ Especifica un término de búsqueda: hive skills search <query>");
    return;
  }

  console.log(`\n🔍 Buscando: "${query}"\n`);

  const results = BUNDLED_SKILLS.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.slug.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase())
  );

  if (results.length === 0) {
    console.log("No se encontraron skills");
    return;
  }

  for (const skill of results) {
    console.log(`  ${skill.slug}`);
    console.log(`    ${skill.name}`);
    console.log(`    ${skill.description}`);
    console.log(`    Tipo: bundled`);
    console.log();
  }
}

async function installSkill(slug: string | undefined): Promise<void> {
  if (!slug) {
    const result = await p.text({
      message: "Slug de la skill a instalar:",
      placeholder: "example-skill",
      validate: (v) => (!v ? "El slug es requerido" : undefined),
    });

    if (p.isCancel(result)) {
      p.cancel("Cancelado");
      return;
    }
    slug = result;
  }

  console.log(`\n📦 Instalando skill: ${slug}`);

  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const skillPath = path.join(SKILLS_DIR, slug);
  if (fs.existsSync(skillPath)) {
    console.log("⚠️  La skill ya está instalada");
    return;
  }

  fs.mkdirSync(skillPath, { recursive: true });

  const meta = {
    name: slug,
    version: "1.0.0",
    description: "Skill instalada manualmente",
    installed: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(skillPath, "skill.json"), JSON.stringify(meta, null, 2));

  console.log(`✅ Skill "${slug}" instalada`);
}

async function removeSkill(slug: string | undefined): Promise<void> {
  if (!slug) {
    console.log("❌ Especifica la skill: hive skills remove <slug>");
    return;
  }

  const skillPath = path.join(SKILLS_DIR, slug);

  if (!fs.existsSync(skillPath)) {
    console.log(`❌ La skill "${slug}" no está instalada`);
    return;
  }

  const confirm = await p.confirm({
    message: `¿Eliminar la skill "${slug}"?`,
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    console.log("Cancelado");
    return;
  }

  fs.rmSync(skillPath, { recursive: true });
  console.log(`✅ Skill "${slug}" eliminada`);
}

async function updateSkills(): Promise<void> {
  console.log("\n🔄 Actualizando skills...\n");

  try {
    // 1. Contar skills actuales en BD
    const { initializeDatabase, getDb } = await import("@johpaz/hive-agents-core/storage/sqlite");
    initializeDatabase();
    const db = getDb();

    const beforeCount = (db.query("SELECT COUNT(*) as n FROM skills").get() as { n: number })?.n ?? 0;
    console.log(`   Skills actuales en BD: ${beforeCount}`);

    // 2. Recargar skills desde SkillLoader y re-semear
    const { seedAllData } = await import("@johpaz/hive-agents-core/storage/seed");
    seedAllData();

    // 3. Contar skills después del re-seed
    const afterCount = (db.query("SELECT COUNT(*) as n FROM skills").get() as { n: number })?.n ?? 0;
    const newSkills = afterCount - beforeCount;

    if (newSkills > 0) {
      console.log(`   ✅ +${newSkills} nuevas skills añadidas`);
    } else {
      console.log(`   ✅ Todas las skills están actualizadas`);
    }

    // 4. Verificar si el gateway está corriendo
    const { existsSync } = await import("node:fs");
    const { getHiveDir } = await import("@johpaz/hive-agents-core/config/loader");
    const path = await import("node:path");
    const pidFile = path.join(getHiveDir(), "gateway.pid");
    if (existsSync(pidFile)) {
      console.log(`\n   💡 El gateway está corriendo. Ejecuta 'hive reload' para aplicar cambios.`);
    }

    console.log();
  } catch (err) {
    console.log(`   ⚠️  No se pudieron actualizar las skills: ${(err as Error).message}`);
    console.log(`   💡 Ejecuta 'hive start' para inicializar la base de datos primero.\n`);
  }
}
