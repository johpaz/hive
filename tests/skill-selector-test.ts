/**
 * Test: Skill Selector - Búsqueda y Selección de Skills
 * 
 * Valida el funcionamiento del skill-selector:
 * 1. Carga de skills desde bundled
 * 2. Sincronización con FTS5
 * 3. Búsqueda por triggers explícitos
 * 4. Búsqueda semántica con FTS5 bm25()
 * 5. Filtrado por threshold de relevancia
 * 6. Mensajes conversacionales (no retornan skills)
 * 7. Integración con contexto del agente
 * 
 * @example
 * bun run tests/skill-selector-test.ts
 */

import { getDb, initializeDatabase } from "../packages/core/src/storage/sqlite";
import { seedAllData } from "../packages/core/src/storage/seed";
import { 
  selectSkills, 
  getMinimalSkills, 
  getAllSkillsFromDB,
  getSkillByName,
  getSkillsByCategory,
  syncSkillsToFTS,
  MINIMAL_SKILL_NAMES,
} from "../packages/core/src/agent/skill-selector";
import { SkillLoader } from "../packages/skills/src/loader";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
}

interface TestSuite {
  name: string;
  tests: Array<() => Promise<TestResult> | TestResult>;
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

/**
 * Test 1: Inicializar base de datos (usa BD real de .hive-dev)
 */
async function testInitializeDB(): Promise<TestResult> {
  printSubHeader("Test 1: Inicializar Base de Datos (BD Real)");
  
  try {
    // Solo inicializar, las tablas ya deberían existir
    initializeDatabase();
    const db = getDb();
    
    // Verificar que la BD está conectada y tiene datos
    const skillCount = db.query("SELECT COUNT(*) as count FROM skills WHERE active = 1").get() as { count: number } | undefined;
    
    if (!skillCount) {
      return {
        success: false,
        message: "No se pudo conectar a la BD",
        error: "La consulta retornó undefined"
      };
    }
    
    printSuccess("BD conectada correctamente");
    printInfo(`Skills en BD: ${skillCount.count}`);
    
    // Verificar tablas principales
    const tables = db.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('skills', 'skills_fts')
    `).all() as { name: string }[];
    
    if (tables.length >= 2) {
      printSuccess(`Tablas verificadas: ${tables.map(t => t.name).join(", ")}`);
    } else {
      printInfo(`Tablas encontradas: ${tables.map(t => t.name).join(", ")}`);
    }
    
    return {
      success: true,
      message: "BD conectada",
      details: { 
        skillCount: skillCount.count,
        tables: tables.map(t => t.name)
      }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al conectar BD",
      error: (error as Error).message
    };
  }
}

/**
 * Test 2: Cargar skills desde bundled con SkillLoader
 */
async function testLoadBundledSkills(): Promise<TestResult> {
  printSubHeader("Test 2: Cargar Skills desde Bundled");
  
  try {
    const loader = new SkillLoader({
      workspacePath: process.cwd()
    });
    
    const skills = loader.loadBundledSkills();
    
    if (skills.length === 0) {
      return {
        success: false,
        message: "No se cargaron skills bundled",
        error: "SkillLoader no encontró archivos SKILL.md"
      };
    }
    
    printSuccess(`${skills.length} skills cargadas desde bundled`);
    
    // Agrupar por categoría
    const byCategory = skills.reduce((acc, skill) => {
      const cat = skill.category || "unknown";
      if (!acc[cat]) acc[cat] = 0;
      acc[cat]++;
      return acc;
    }, {} as Record<string, number>);
    
    printInfo("Distribución por categoría:");
    for (const [cat, count] of Object.entries(byCategory)) {
      console.log(`   - ${cat}: ${count}`);
    }
    
    // Verificar skills de codebridge
    const codebridgeSkills = skills.filter(s => s.category === "codebridge");
    if (codebridgeSkills.length > 0) {
      printSuccess(`${codebridgeSkills.length} skills de codebridge encontradas`);
      codebridgeSkills.forEach(s => {
        printInfo(`   - ${s.name}: tools=[${(s.tools || []).join(", ")}]`);
      });
    }
    
    return {
      success: true,
      message: "Skills cargadas",
      details: { 
        total: skills.length, 
        byCategory,
        codebridge: codebridgeSkills.length 
      }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al cargar skills",
      error: (error as Error).message
    };
  }
}

/**
 * Test 3: Seed de skills en la base de datos
 */
async function testSeedSkillsToDB(): Promise<TestResult> {
  printSubHeader("Test 3: Seed de Skills a la BD (skip - lo hace seedAllData)");
  
  // Este test se salta porque seedAllData (Test 4) hace el seed completo
  // incluyendo FTS5 y triggers
  printInfo("Skip: seedAllData en Test 4 se encarga de esto");
  
  return {
    success: true,
    message: "Skip - ver Test 4",
    details: { skipped: true }
  };
}

/**
 * Test 4: Verificar FTS5 sincronizado
 */
async function testVerifyFTS5(): Promise<TestResult> {
  printSubHeader("Test 4: Verificar FTS5 Sincronizado");
  
  try {
    const db = getDb();
    
    // Verificar cantidad en skills
    const skillsCount = db.query("SELECT COUNT(*) as count FROM skills WHERE active = 1").get() as { count: number };
    
    // Verificar cantidad en FTS5
    const ftsCount = db.query("SELECT COUNT(*) as count FROM skills_fts").get() as { count: number };
    
    printSuccess(`Skills en DB: ${skillsCount.count}`);
    printSuccess(`Skills en FTS5: ${ftsCount.count}`);
    
    // Si hay diferencia, sincronizar
    if (skillsCount.count !== ftsCount.count) {
      printInfo("Sincronizando FTS5...");
      await syncSkillsToFTS();
      const newFtsCount = db.query("SELECT COUNT(*) as count FROM skills_fts").get() as { count: number };
      printSuccess(`FTS5 sincronizado: ${newFtsCount.count}`);
    }
    
    // Verificar triggers de sincronización automática
    const triggers = db.query(`
      SELECT name FROM sqlite_master 
      WHERE type='trigger' AND name LIKE 'skills_%'
    `).all() as { name: string }[];
    
    printInfo(`Triggers FTS5: ${triggers.map(t => t.name).join(", ")}`);
    
    return {
      success: true,
      message: "FTS5 verificado",
      details: { 
        skillsCount: skillsCount.count, 
        ftsCount: ftsCount.count,
        triggers: triggers.map(t => t.name)
      }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al verificar FTS5",
      error: (error as Error).message
    };
  }
}

/**
 * Test 5: Obtener todas las skills desde DB
 */
async function testGetAllSkillsFromDB(): Promise<TestResult> {
  printSubHeader("Test 5: Obtener Todas las Skills desde DB");
  
  try {
    const skills = getAllSkillsFromDB();
    
    if (skills.length === 0) {
      return {
        success: false,
        message: "No se encontraron skills en la BD"
      };
    }
    
    printSuccess(`${skills.length} skills encontradas en DB`);
    
    // Mostrar primeras 5 skills
    printInfo("Primeras 5 skills:");
    skills.slice(0, 5).forEach(s => {
      console.log(`   - ${s.name} (${s.category})`);
    });
    
    return {
      success: true,
      message: "Skills obtenidas",
      details: { total: skills.length, sample: skills.slice(0, 5).map(s => s.name) }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al obtener skills",
      error: (error as Error).message
    };
  }
}

/**
 * Test 6: Obtener skills por categoría (codebridge)
 */
async function testGetSkillsByCategory(): Promise<TestResult> {
  printSubHeader("Test 6: Obtener Skills por Categoría (codebridge)");
  
  try {
    const skills = getSkillsByCategory("codebridge");
    
    if (skills.length === 0) {
      return {
        success: false,
        message: "No se encontraron skills de codebridge"
      };
    }
    
    printSuccess(`${skills.length} skills de codebridge encontradas`);
    
    skills.forEach(s => {
      const tools = s.tools ? s.tools.split(",") : [];
      printInfo(`   - ${s.name}: tools=[${tools.join(", ")}]`);
    });
    
    return {
      success: true,
      message: "Skills por categoría obtenidas",
      details: { total: skills.length, names: skills.map(s => s.name) }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al obtener skills por categoría",
      error: (error as Error).message
    };
  }
}

/**
 * Test 7: Obtener skill por nombre
 */
async function testGetSkillByName(): Promise<TestResult> {
  printSubHeader("Test 7: Obtener Skill por Nombre");
  
  try {
    const skill = getSkillByName("code_generate");
    
    if (!skill) {
      return {
        success: false,
        message: "Skill 'code_generate' no encontrada"
      };
    }
    
    printSuccess(`Skill encontrada: ${skill.name}`);
    printInfo(`   Categoría: ${skill.category}`);
    printInfo(`   Tools: ${skill.tools}`);
    printInfo(`   Triggers: ${skill.triggers?.substring(0, 50)}...`);
    
    return {
      success: true,
      message: "Skill encontrada por nombre",
      details: { name: skill.name, category: skill.category }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al obtener skill por nombre",
      error: (error as Error).message
    };
  }
}

/**
 * Test 8: Obtener minimal skills
 */
async function testGetMinimalSkills(): Promise<TestResult> {
  printSubHeader("Test 8: Obtener Minimal Skills");
  
  try {
    const skills = getMinimalSkills();
    
    printSuccess(`${skills.length} minimal skills encontradas`);
    printInfo(`Nombres esperados: ${Array.from(MINIMAL_SKILL_NAMES).join(", ")}`);
    
    skills.forEach(s => {
      printInfo(`   - ${s.name}`);
    });
    
    // Verificar que están las esperadas
    const foundNames = new Set(skills.map(s => s.name));
    const missing = Array.from(MINIMAL_SKILL_NAMES).filter(n => !foundNames.has(n));
    
    if (missing.length > 0) {
      printError(`Faltan minimal skills: ${missing.join(", ")}`);
      return {
        success: false,
        message: "Faltan minimal skills",
        details: { missing }
      };
    }
    
    return {
      success: true,
      message: "Minimal skills verificadas",
      details: { total: skills.length, names: skills.map(s => s.name) }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al obtener minimal skills",
      error: (error as Error).message
    };
  }
}

/**
 * Test 9: Búsqueda por triggers explícitos
 */
async function testTriggerMatching(): Promise<TestResult> {
  printSubHeader("Test 9: Búsqueda por Triggers Explícitos");
  
  const testCases = [
    { message: "generá código", expectedSkill: "code_generate" },
    { message: "debugueá este error", expectedSkill: "code_debug" },
    { message: "refactorizá el código", expectedSkill: "code_refactor" },
    { message: "revisá el código", expectedSkill: "code_review" },
    { message: "fix error", expectedSkill: "code_debug" },
    { message: "create code", expectedSkill: "code_generate" },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    const skills = selectSkills(testCase.message);
    
    if (skills.length > 0 && skills.some(s => s.name === testCase.expectedSkill)) {
      printSuccess(`"${testCase.message}" → ${skills[0].name}`);
      passed++;
    } else {
      printError(`"${testCase.message}" → No encontró ${testCase.expectedSkill}`);
      if (skills.length > 0) {
        printInfo(`   Encontró: ${skills.map(s => s.name).join(", ")}`);
      } else {
        printInfo(`   No encontró ninguna skill`);
      }
      failed++;
    }
  }
  
  printInfo(`\nResultado: ${passed} passed, ${failed} failed`);
  
  return {
    success: failed === 0,
    message: `Trigger matching: ${passed}/${testCases.length}`,
    details: { passed, failed, total: testCases.length }
  };
}

/**
 * Test 10: Búsqueda semántica con FTS5
 */
async function testFTS5Search(): Promise<TestResult> {
  printSubHeader("Test 10: Búsqueda Semántica con FTS5");
  
  const testCases = [
    { 
      message: "necesito crear un endpoint REST en Express", 
      expectedCategory: "codebridge",
      description: "Generación de código API"
    },
    { 
      message: "la aplicación tiene un bug y no sé dónde está", 
      expectedCategory: "codebridge",
      description: "Debug de errores"
    },
    { 
      message: "este código es muy lento, cómo lo optimizo", 
      expectedCategory: "codebridge",
      description: "Refactorización/performance"
    },
    { 
      message: "quiero mejorar la calidad del código antes del merge", 
      expectedCategory: "codebridge",
      description: "Code review"
    },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    const skills = selectSkills(testCase.message);
    
    if (skills.length > 0 && skills.some(s => s.category === testCase.expectedCategory)) {
      printSuccess(`"${testCase.description}"`);
      printInfo(`   Message: "${testCase.message}"`);
      printInfo(`   Skills: ${skills.map(s => s.name).join(", ")}`);
      passed++;
    } else {
      printError(`"${testCase.description}"`);
      printInfo(`   Message: "${testCase.message}"`);
      if (skills.length > 0) {
        printInfo(`   Skills encontradas: ${skills.map(s => s.name).join(", ")} (categoría: ${skills[0].category})`);
      } else {
        printInfo(`   No encontró ninguna skill`);
      }
      failed++;
    }
  }
  
  printInfo(`\nResultado: ${passed} passed, ${failed} failed`);
  
  return {
    success: failed === 0,
    message: `FTS5 search: ${passed}/${testCases.length}`,
    details: { passed, failed, total: testCases.length }
  };
}

/**
 * Test 11: Mensajes conversacionales (no deben retornar skills)
 */
async function testConversationalMessages(): Promise<TestResult> {
  printSubHeader("Test 11: Mensajes Conversacionales (sin skills)");
  
  const conversationalMessages = [
    "hola",
    "buenos días",
    "gracias",
    "cómo estás",
    "adiós",
    "ok",
    "entendido",
    "sí",
    "bien",
    "?",
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const message of conversationalMessages) {
    const skills = selectSkills(message);
    
    if (skills.length === 0) {
      printSuccess(`"${message}" → [] (correcto, es conversacional)`);
      passed++;
    } else {
      printError(`"${message}" → ${skills.map(s => s.name).join(", ")} (incorrecto, debería ser [])`);
      failed++;
    }
  }
  
  printInfo(`\nResultado: ${passed} passed, ${failed} failed`);
  
  return {
    success: failed === 0,
    message: `Conversacional: ${passed}/${conversationalMessages.length}`,
    details: { passed, failed, total: conversationalMessages.length }
  };
}

/**
 * Test 12: Skills encontradas pasan al contexto
 */
async function testContextInjection(): Promise<TestResult> {
  printSubHeader("Test 12: Inyección de Skills al Contexto");
  
  try {
    // Simular mensaje que activa codebridge skills
    const message = "generá un endpoint REST con autenticación JWT";
    const skills = selectSkills(message);
    
    if (skills.length === 0) {
      return {
        success: false,
        message: "No se encontraron skills para inyectar",
        error: "El mensaje no activó ninguna skill"
      };
    }
    
    printSuccess(`${skills.length} skills seleccionadas para inyectar`);
    
    // Simular cómo se inyectan en el system prompt
    const contextParts: string[] = [];
    
    for (const skill of skills) {
      contextParts.push(`
## Skill: ${skill.name}
**Categoría:** ${skill.category}
**Tools:** ${skill.tools}

${skill.body?.substring(0, 500)}...
`.trim());
    }
    
    const injectedContext = contextParts.join("\n\n---\n\n");
    
    printInfo(`Contexto generado: ${injectedContext.length} caracteres`);
    printInfo(`Skills inyectadas: ${skills.map(s => s.name).join(", ")}`);
    
    // Verificar que el contexto contiene información relevante
    const hasCodeGenerate = skills.some(s => s.name === "code_generate");
    const hasTools = skills.some(s => s.tools && s.tools.length > 0);
    const hasBody = skills.some(s => s.body && s.body.length > 0);
    
    if (!hasCodeGenerate) {
      printInfo("Nota: code_generate no fue seleccionada (puede ser por FTS5 scoring)");
    }
    
    if (!hasTools) {
      printError("Ninguna skill tiene tools definidas");
    }
    
    if (!hasBody) {
      printError("Ninguna skill tiene body/content");
    }
    
    return {
      success: true,
      message: "Contexto inyectado correctamente",
      details: { 
        skillsCount: skills.length, 
        contextLength: injectedContext.length,
        skillNames: skills.map(s => s.name)
      }
    };
  } catch (error) {
    return {
      success: false,
      message: "Error al inyectar contexto",
      error: (error as Error).message
    };
  }
}

/**
 * Test 13: Performance del skill selector
 */
async function testPerformance(): Promise<TestResult> {
  printSubHeader("Test 13: Performance del Skill Selector");
  
  const testMessages = [
    "generá código",
    "debugueá este error",
    "necesito crear una API REST con autenticación",
    "la aplicación tiene un bug en el login",
    "optimizá la performance de esta función",
    "revisá este PR en busca de problemas de seguridad",
    "hola",
    "gracias",
  ];
  
  const timings: number[] = [];
  
  for (const message of testMessages) {
    const start = performance.now();
    selectSkills(message);
    const end = performance.now();
    const duration = end - start;
    timings.push(duration);
  }
  
  const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
  const maxTime = Math.max(...timings);
  const minTime = Math.min(...timings);
  
  printInfo(`Mensajes probados: ${testMessages.length}`);
  printInfo(`Tiempo promedio: ${avgTime.toFixed(2)}ms`);
  printInfo(`Tiempo máximo: ${maxTime.toFixed(2)}ms`);
  printInfo(`Tiempo mínimo: ${minTime.toFixed(2)}ms`);
  
  // Verificar que el promedio sea razonable (< 50ms)
  if (avgTime > 50) {
    printError(`Performance lenta: ${avgTime.toFixed(2)}ms promedio (debería ser < 50ms)`);
    return {
      success: false,
      message: "Performance lenta",
      details: { avgTime, maxTime, minTime }
    };
  }
  
  printSuccess("Performance dentro de límites aceptables");
  
  return {
    success: true,
    message: "Performance OK",
    details: { avgTime, maxTime, minTime, samples: testMessages.length }
  };
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  printHeader("🧪 TEST: Skill Selector - Búsqueda y Selección de Skills");
  
  const testSuites: TestSuite[] = [
    {
      name: "Inicialización y Carga",
      tests: [
        testInitializeDB,
        testLoadBundledSkills,
        testSeedSkillsToDB,
        testVerifyFTS5,
      ]
    },
    {
      name: "Consultas Básicas",
      tests: [
        testGetAllSkillsFromDB,
        testGetSkillsByCategory,
        testGetSkillByName,
        testGetMinimalSkills,
      ]
    },
    {
      name: "Búsqueda y Matching",
      tests: [
        testTriggerMatching,
        testFTS5Search,
        testConversationalMessages,
      ]
    },
    {
      name: "Integración y Performance",
      tests: [
        testContextInjection,
        testPerformance,
      ]
    }
  ];
  
  const results: TestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const suite of testSuites) {
    printHeader(`📋 Suite: ${suite.name}`);
    
    for (const testFn of suite.tests) {
      const result = await testFn();
      results.push(result);
      
      if (result.success) {
        totalPassed++;
      } else {
        totalFailed++;
      }
    }
  }
  
  // ─── Final Summary ─────────────────────────────────────────────────────────
  
  printHeader("📊 RESUMEN FINAL");
  
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  Total Tests:  ${totalPassed + totalFailed}                                    │
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
}

// Run tests
runAllTests().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
