import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { YAML } from "bun";
import { createAllTools, createToolsByCategory } from "../packages/core/src/tools/index.ts";
import { createSeedCatalogAgents } from "../packages/core/src/agent/agent-catalog.ts";

const root = resolve(import.meta.dir, "..");
const outputPath = resolve(root, "docs/reference/inventario.md");
const checkOnly = process.argv.includes("--check");
const packagePaths = [
  "package.json",
  "packages/cli/package.json",
  "packages/core/package.json",
  "packages/hive-ui/package.json",
  "packages/mcp/package.json",
  "packages/skills/package.json",
];
const categories = ["filesystem", "web", "cron", "cli", "agents", "a2ui", "core", "office", "api"];

function markdown(value: unknown): string {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function loadSkills() {
  const base = resolve(root, "packages/skills/src/bundled");
  return readdirSync(base, { recursive: true })
    .filter((entry) => String(entry).endsWith("SKILL.md"))
    .map((entry) => {
      const path = resolve(base, String(entry));
      const raw = readFileSync(path, "utf8");
      const match = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!match) throw new Error(`Frontmatter ausente: ${relative(root, path)}`);
      const data = YAML.parse(match[1]!) as Record<string, unknown>;
      return {
        name: String(data.name ?? ""),
        description: String(data.description ?? ""),
        category: String(data.category ?? "general"),
        version: String(data.version ?? ""),
        tools: Array.isArray(data.tools) ? data.tools.map(String) : [],
        preferredAgents: Array.isArray(data.preferred_agents) ? data.preferred_agents.map(String) : [],
        path,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function validateContracts(tools: ReturnType<typeof createAllTools>, skills: ReturnType<typeof loadSkills>) {
  const errors: string[] = [];
  const toolNames = new Set(tools.map((tool) => tool.name));
  const agentNames = new Set(createSeedCatalogAgents(0).map((agent) => agent.id));
  const versions = packagePaths.map((path) => ({ path, pkg: readJson(path) }));
  const expectedVersion = versions[0]!.pkg.version;

  for (const { path, pkg } of versions) {
    if (pkg.version !== expectedVersion) errors.push(`${path}: versión ${pkg.version} != ${expectedVersion}`);
    for (const [name, value] of Object.entries(pkg.dependencies ?? {})) {
      if (name.startsWith("@johpaz/hive-agents-") && value !== `^${expectedVersion}`) {
        errors.push(`${path}: ${name} usa ${value}, se esperaba ^${expectedVersion}`);
      }
    }
    for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
      if (typeof target === "string" && !existsSync(resolve(dirname(resolve(root, path)), target))) {
        errors.push(`${path}: export ${subpath} apunta a ${target}, que no existe`);
      }
    }
  }

  for (const skill of skills) {
    for (const tool of skill.tools) {
      if (!toolNames.has(tool)) errors.push(`${relative(root, skill.path)}: tool desconocida ${tool}`);
    }
    for (const agent of skill.preferredAgents) {
      if (!agentNames.has(agent)) errors.push(`${relative(root, skill.path)}: agente desconocido ${agent}`);
    }
  }

  if (errors.length) throw new Error(`Contratos documentales inválidos:\n- ${errors.join("\n- ")}`);
}

function markdownFiles(): string[] {
  const roots = ["README.md", "CONTRIBUTING.md", "CHANGELOG_v1.0.0.md", "docs", "packages/hive-ui/README.md"];
  const files: string[] = [];
  for (const item of roots) {
    const absolute = resolve(root, item);
    if (!existsSync(absolute)) continue;
    if (item.endsWith(".md")) {
      files.push(absolute);
      continue;
    }
    for (const entry of readdirSync(absolute, { recursive: true })) {
      if (String(entry).endsWith(".md")) files.push(resolve(absolute, String(entry)));
    }
  }
  return files;
}

function validateLocalLinks() {
  const broken: string[] = [];
  for (const file of markdownFiles()) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
      let target = match[1]!.trim().replace(/^<|>$/g, "");
      if (!target || target.startsWith("#") || /^[a-z]+:/i.test(target)) continue;
      target = target.split("#")[0]!.split("?")[0]!;
      if (!target) continue;
      const resolved = resolve(dirname(file), decodeURIComponent(target));
      if (!existsSync(resolved)) broken.push(`${relative(root, file)} -> ${target}`);
    }
  }
  if (broken.length) throw new Error(`Enlaces locales rotos:\n- ${broken.join("\n- ")}`);
}

// Catches prose drift like "11 agentes de catálogo" surviving a catalog change
// (found during the 1.0 release audit: several docs still said 11 after a
// persona was dropped to 10). Matches phrasings actually used in the docs;
// widen the pattern if a new one shows up.
function validateAgentCountProse(realCount: number) {
  const pattern = /(\d+)\s+agentes?\s+(?:de\s+cat[aá]logo|del\s+sistema|especializados)/gi;
  const mismatches: string[] = [];
  for (const file of markdownFiles()) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(pattern)) {
      const claimed = Number(match[1]);
      if (claimed !== realCount) {
        mismatches.push(`${relative(root, file)}: dice "${match[0]}", pero hay ${realCount} agentes de catálogo`);
      }
    }
  }
  if (mismatches.length) throw new Error(`Conteo de agentes desactualizado:\n- ${mismatches.join("\n- ")}`);
}

function renderInventory(): string {
  const tools = createAllTools({} as never);
  const skills = loadSkills();
  const agents = createSeedCatalogAgents(0);
  validateContracts(tools, skills);
  validateAgentCountProse(agents.length);

  const categoryByTool = new Map<string, string>();
  for (const category of categories) {
    for (const tool of createToolsByCategory(category, {} as never)) categoryByTool.set(tool.name, category);
  }

  const manifests = packagePaths.map((path) => ({ path, pkg: readJson(path) }));
  const lines = [
    "# Inventario generado de Hive",
    "",
    "> No edites este archivo manualmente. Ejecuta `bun run docs:generate`.",
    "",
    `Generado desde el código fuente para Hive **${manifests[0]!.pkg.version}**.`,
    "",
    "## Versiones",
    "",
    "| Paquete | Versión |",
    "|---|---:|",
    ...manifests.map(({ pkg }) => `| \`${markdown(pkg.name)}\` | \`${markdown(pkg.version)}\` |`),
    "",
    `## Herramientas (${tools.length})`,
    "",
    "| Herramienta | Categoría | Descripción |",
    "|---|---|---|",
    ...tools
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => `| \`${markdown(tool.name)}\` | ${markdown(categoryByTool.get(tool.name) ?? "externa")} | ${markdown(tool.description)} |`),
    "",
    `## Skills incluidas (${skills.length})`,
    "",
    "| Skill | Categoría | Versión | Herramientas | Agentes preferidos |",
    "|---|---|---:|---|---|",
    ...skills.map((skill) =>
      `| \`${markdown(skill.name)}\` | ${markdown(skill.category)} | ${markdown(skill.version)} | ${skill.tools.map((tool) => `\`${markdown(tool)}\``).join(", ") || "—"} | ${skill.preferredAgents.map((agent) => `\`${markdown(agent)}\``).join(", ") || "—"} |`
    ),
    "",
    `## Agentes de catálogo (${agents.length})`,
    "",
    "| ID | Nombre | Propósito | Herramientas autorizadas | Skills |",
    "|---|---|---|---|---|",
    ...agents.map((agent) =>
      `| \`${markdown(agent.id)}\` | ${markdown(agent.name)} | ${markdown(agent.description)} | ${JSON.parse(agent.tool_allowlist_json ?? "[]").map((tool: string) => `\`${markdown(tool)}\``).join(", ")} | ${JSON.parse(agent.skills_json ?? "[]").map((skill: string) => `\`${markdown(skill)}\``).join(", ")} |`
    ),
    "",
    "## Exports públicos",
    "",
    "| Paquete | Subpath | Destino |",
    "|---|---|---|",
    ...manifests.flatMap(({ path, pkg }) =>
      Object.entries(pkg.exports ?? {}).map(([subpath, target]) =>
        `| \`${markdown(pkg.name)}\` | \`${markdown(subpath)}\` | \`${markdown(target)}\` |`
      )
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

const expected = renderInventory();
if (checkOnly) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== expected) {
    console.error("docs/reference/inventario.md está desactualizado. Ejecuta: bun run docs:generate");
    process.exit(1);
  }
  validateLocalLinks();
  console.log("Documentación, versiones, skills y exports sincronizados.");
} else {
  writeFileSync(outputPath, expected);
  console.log(`Actualizado ${relative(root, outputPath)}`);
}

// El registro de sesiones A2UI crea un heartbeat singleton al importarse. Este script
// ya completó todo su trabajo síncrono, así que no debe quedar esperando ese
// recurso del runtime.
process.exit(0);
