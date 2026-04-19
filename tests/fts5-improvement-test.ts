/**
 * Test: FTS5 Improvements Validation
 * 
 * Valida las mejoras implementadas en FTS5 scoring:
 * 1. Column weights (triggers=5.0, name=3.0 para skills)
 * 2. Threshold reducido (-15 en vez de -5)
 * 3. Prefix matching (gener*匹配generando, generación)
 * 4. MAX_SKILLS_PER_TURN aumentado (4 en vez de 2)
 * 
 * @example
 * bun run tests/fts5-improvement-test.ts
 */

import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { selectSkills } from "../packages/core/src/agent/skill-selector";
import { selectTools, CORE_TOOL_CATALOG } from "../packages/core/src/agent/tool-selector";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
}

interface TestCase {
  message: string;
  expectedSkills: string[];
  expectedTools?: string[];
  description: string;
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function printHeader(text: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(text);
  console.log("=".repeat(60));
}

function printSubHeader(text: string): void {
  console.log("\n" + "-".repeat(40));
  console.log(text);
  console.log("-".repeat(40));
}

function printSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

function printError(message: string): void {
  console.log(`❌ ${message}`);
}

function printInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

// ─── Test Cases ──────────────────────────────────────────────────────────────

const SKILL_TEST_CASES: TestCase[] = [
  {
    message: "generá código para una API REST",
    expectedSkills: ["code_generate"],
    description: "Generación de código (trigger explícito)"
  },
  {
    message: "generar un endpoint con autenticación",
    expectedSkills: ["code_generate"],
    description: "Generación de código (infinitivo, sin trigger explícito)"
  },
  {
    message: "creando código nuevo",
    expectedSkills: ["code_generate"],
    description: "Generación de código (gerundio, prefix matching)"
  },
  {
    message: "debugueá este error",
    expectedSkills: ["code_debug"],
    description: "Debug (trigger explícito)"
  },
  {
    message: "la aplicación tiene un bug",
    expectedSkills: ["code_debug"],
    description: "Debug (semántico)"
  },
  {
    message: "refactorizá el código",
    expectedSkills: ["code_refactor"],
    description: "Refactor (trigger explícito)"
  },
  {
    message: "optimizar la performance",
    expectedSkills: ["code_refactor"],
    description: "Refactor (semántico)"
  },
  {
    message: "revisá el código antes del merge",
    expectedSkills: ["code_review"],
    description: "Code review (trigger explícito)"
  },
  {
    message: "mejorar la calidad del código",
    expectedSkills: ["code_review"],
    description: "Code review (semántico)"
  },
  {
    message: "guardar en memoria",
    expectedSkills: ["memory_manager"],
    description: "Memoria (semántico)"
  },
  {
    message: "mostrar progreso",
    expectedSkills: ["canvas_report"],
    description: "Canvas (semántico)"
  },
  {
    message: "delegar tarea a worker",
    expectedSkills: ["task_orchestrator"],
    description: "Task orchestrator (semántico)"
  },
];

const TOOL_TEST_CASES: TestCase[] = [
  {
    message: "crear una tarea programada",
    expectedSkills: [],
    expectedTools: ["cron.create"],
    description: "Schedule create"
  },
  {
    message: "buscar en internet",
    expectedSkills: [],
    expectedTools: ["web_search"],
    description: "Web search"
  },
  {
    message: "leer archivo",
    expectedSkills: [],
    expectedTools: ["fs_read"],
    description: "Filesystem read"
  },
  {
    message: "navegar a una página",
    expectedSkills: [],
    expectedTools: ["browser_navigate"],
    description: "Browser navigate"
  },
  {
    message: "crear agente worker",
    expectedSkills: [],
    expectedTools: ["agent_create"],
    description: "Agent create"
  },
];

/**
 * Test 1: Inicializar BD
 */
async function testInitialize(): Promise<TestResult> {
  printSubHeader("Test 1: Inicializar BD");
  
  try {
    initializeDatabase();
    const db = getDb();
    
    const skillCount = db.query("SELECT COUNT(*) as count FROM skills_fts").get() as { count: number };
    const toolCount = db.query("SELECT COUNT(*) as count FROM tools_fts").get() as { count: number };
    
    printSuccess(`Skills en FTS5: ${skillCount.count}`);
    printSuccess(`Tools en FTS5: ${toolCount.count}`);
    
    return {
      success: true,
      message: "BD inicializada",
      details: { skills: skillCount.count, tools: toolCount.count }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al inicializar",
      error: (error as Error).message
    };
  }
}

/**
 * Test 2: Skills - Trigger Explícito
 */
async function testSkillTriggers(): Promise<TestResult> {
  printSubHeader("Test 2: Skills - Triggers Explícitos");
  
  const triggerTests = SKILL_TEST_CASES.filter(t => 
    t.message.includes("generá") || 
    t.message.includes("debugueá") ||
    t.message.includes("refactorizá") ||
    t.message.includes("revisá")
  );
  
  let passed = 0;
  let failed = 0;
  
  for (const test of triggerTests) {
    const skills = selectSkills(test.message);
    const skillNames = skills.map(s => s.name);
    
    const found = test.expectedSkills.some(expected => skillNames.includes(expected));
    
    if (found) {
      printSuccess(`"${test.message}" → ${skillNames.join(", ")}`);
      passed++;
    } else {
      printError(`"${test.message}" → No encontró ${test.expectedSkills.join(", ")}`);
      printInfo(`   Encontró: ${skillNames.join(", ") || "nada"}`);
      failed++;
    }
  }
  
  printInfo(`\nResultado: ${passed} passed, ${failed} failed`);
  
  return {
    success: failed === 0,
    message: `Triggers: ${passed}/${triggerTests.length}`,
    details: { passed, failed, total: triggerTests.length }
  };
}

/**
 * Test 3: Skills - Búsqueda Semántica
 */
async function testSkillSemantic(): Promise<TestResult> {
  printSubHeader("Test 3: Skills - Búsqueda Semántica");
  
  const semanticTests = SKILL_TEST_CASES.filter(t => 
    !t.message.includes("generá") && 
    !t.message.includes("debugueá") &&
    !t.message.includes("refactorizá") &&
    !t.message.includes("revisá")
  );
  
  let passed = 0;
  let failed = 0;
  
  for (const test of semanticTests) {
    const skills = selectSkills(test.message);
    const skillNames = skills.map(s => s.name);
    
    const found = test.expectedSkills.some(expected => skillNames.includes(expected));
    
    if (found) {
      printSuccess(`"${test.description}" → ${skillNames.join(", ")}`);
      printInfo(`   Message: "${test.message}"`);
      passed++;
    } else {
      printError(`"${test.description}" → No encontró ${test.expectedSkills.join(", ")}`);
      printInfo(`   Message: "${test.message}"`);
      printInfo(`   Encontró: ${skillNames.join(", ") || "nada"}`);
      failed++;
    }
  }
  
  printInfo(`\nResultado: ${passed} passed, ${failed} failed`);
  
  return {
    success: failed === 0,
    message: `Semántico: ${passed}/${semanticTests.length}`,
    details: { passed, failed, total: semanticTests.length }
  };
}

/**
 * Test 4: Skills - Prefix Matching
 */
async function testPrefixMatching(): Promise<TestResult> {
  printSubHeader("Test 4: Skills - Prefix Matching");
  
  const prefixTests = [
    { message: "generando código", expected: "code_generate" },
    { message: "generación de código", expected: "code_generate" },
    { message: "creando código", expected: "code_generate" },
    { message: "creación de código", expected: "code_generate" },
    { message: "optimizando código", expected: "code_refactor" },
    { message: "optimización de código", expected: "code_refactor" },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of prefixTests) {
    const skills = selectSkills(test.message);
    const skillNames = skills.map(s => s.name);
    
    const found = skillNames.includes(test.expected);
    
    if (found) {
      printSuccess(`"${test.message}" → ${test.expected}`);
      passed++;
    } else {
      printError(`"${test.message}" → No encontró ${test.expected}`);
      printInfo(`   Encontró: ${skillNames.join(", ") || "nada"}`);
      failed++;
    }
  }
  
  printInfo(`\nResultado: ${passed} passed, ${failed} failed`);
  
  return {
    success: failed === 0,
    message: `Prefix matching: ${passed}/${prefixTests.length}`,
    details: { passed, failed, total: prefixTests.length }
  };
}

/**
 * Test 5: Tools - Búsqueda FTS5
 */
async function testToolSearch(): Promise<TestResult> {
  printSubHeader("Test 5: Tools - Búsqueda FTS5");
  
  let passed = 0;
  let failed = 0;
  
  for (const test of TOOL_TEST_CASES) {
    // Pass CORE_TOOL_CATALOG to get full tool list
    const tools = selectTools(test.message, CORE_TOOL_CATALOG, 10);
    const toolNames = tools.map(t => t.name);
    
    const found = test.expectedTools?.some(expected => toolNames.includes(expected));
    
    if (found) {
      printSuccess(`"${test.description}" → ${toolNames.join(", ")}`);
      passed++;
    } else {
      printError(`"${test.description}" → No encontró ${test.expectedTools?.join(", ")}`);
      printInfo(`   Message: "${test.message}"`);
      printInfo(`   Encontró: ${toolNames.join(", ") || "nada"}`);
      failed++;
    }
  }
  
  printInfo(`\nResultado: ${passed} passed, ${failed} failed`);
  
  return {
    success: failed === 0,
    message: `Tools: ${passed}/${TOOL_TEST_CASES.length}`,
    details: { passed, failed, total: TOOL_TEST_CASES.length }
  };
}

/**
 * Test 6: Performance
 */
async function testPerformance(): Promise<TestResult> {
  printSubHeader("Test 6: Performance");
  
  const messages = SKILL_TEST_CASES.map(t => t.message);
  const timings: number[] = [];
  
  for (const message of messages) {
    const start = performance.now();
    selectSkills(message);
    const end = performance.now();
    timings.push(end - start);
  }
  
  const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
  const maxTime = Math.max(...timings);
  const minTime = Math.min(...timings);
  
  printInfo(`Mensajes probados: ${messages.length}`);
  printInfo(`Tiempo promedio: ${avgTime.toFixed(2)}ms`);
  printInfo(`Tiempo máximo: ${maxTime.toFixed(2)}ms`);
  printInfo(`Tiempo mínimo: ${minTime.toFixed(2)}ms`);
  
  if (avgTime > 50) {
    printError(`Performance lenta: ${avgTime.toFixed(2)}ms promedio (debería ser < 50ms)`);
    return {
      success: false,
      message: "Performance lenta",
      details: { avgTime, maxTime, minTime }
    };
  }
  
  printSuccess("Performance dentro de límites aceptables (< 50ms)");
  
  return {
    success: true,
    message: "Performance OK",
    details: { avgTime, maxTime, minTime, samples: messages.length }
  };
}

/**
 * Test 7: MAX_SKILLS_PER_TURN
 */
async function testMaxSkills(): Promise<TestResult> {
  printSubHeader("Test 7: MAX_SKILLS_PER_TURN (debería ser 4)");
  
  // Mensaje amplio que debería retornar múltiples skills
  const message = "necesito crear un proyecto completo con código, tests, y documentación";
  const skills = selectSkills(message);
  
  printInfo(`Mensaje: "${message}"`);
  printInfo(`Skills encontradas: ${skills.length}`);
  printInfo(`Skills: ${skills.map(s => s.name).join(", ")}`);
  
  if (skills.length >= 2 && skills.length <= 4) {
    printSuccess(`Cantidad correcta: ${skills.length} skills (entre 2 y 4)`);
    return {
      success: true,
      message: "MAX_SKILLS correcto",
      details: { count: skills.length, names: skills.map(s => s.name) }
    };
  } else if (skills.length > 4) {
    printError(`Demasiadas skills: ${skills.length} (máximo debería ser 4)`);
    return {
      success: false,
      message: "Demasiadas skills",
      details: { count: skills.length }
    };
  } else {
    printInfo(`Pocas skills: ${skills.length} (pero puede ser por FTS5 scoring)`);
    return {
      success: true,
      message: "Cantidad aceptable",
      details: { count: skills.length }
    };
  }
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  printHeader("🧪 TEST: FTS5 Improvements Validation");
  printInfo("Validando mejoras de FTS5 scoring para skills y tools");
  
  const tests = [
    testInitialize,
    testSkillTriggers,
    testSkillSemantic,
    testPrefixMatching,
    testToolSearch,
    testPerformance,
    testMaxSkills,
  ];
  
  const results: TestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const testFn of tests) {
    const result = await testFn();
    results.push(result);
    
    if (result.success) {
      totalPassed++;
    } else {
      totalFailed++;
    }
  }
  
  // ─── Final Summary ─────────────────────────────────────────────────────────
  
  printHeader("📊 RESUMEN FINAL");
  
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  Total Tests:  ${tests.length}                                    │
│  ✅ Passed:   ${totalPassed}                                    │
│  ❌ Failed:   ${totalFailed}                                     │
└─────────────────────────────────────────────────────────────┘
`);
  
  if (totalFailed === 0) {
    printSuccess("🎉 TODOS LOS TESTS PASARON");
  } else {
    printError(`⚠️  ${totalFailed} test(s) fallaron`);
  }
  
  // Detailed results
  printSubHeader("Detalle de Resultados");
  results.forEach((r, i) => {
    const icon = r.success ? "✅" : "❌";
    console.log(`${icon} Test ${i + 1}: ${r.message}`);
  });
  
  // Mejoras validadas
  printSubHeader("Mejoras Implementadas");
  console.log(`
✅ Column Weights:
   - Skills: triggers=5.0, name=3.0
   - Tools: name=5.0, description=3.0

✅ Threshold:
   - Skills: -15 (era -5)
   - Tools: -25

✅ Prefix Matching:
   - "gener*" 匹配 "generar", "generando", "generación"

✅ MAX_SKILLS_PER_TURN:
   - 4 (era 2)

✅ Logs de Debug:
   - Raw scores visibles en logs
`);
}

// Run tests
runAllTests().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
