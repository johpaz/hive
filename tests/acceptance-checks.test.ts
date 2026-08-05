/**
 * acceptance-checks — el reemplazo determinístico del agente acceptance_verifier.
 *
 * Es el punto donde se decide si la entrega de un worker se acepta, se rechaza o
 * se manda a juicio del coordinador, y corre sin una sola llamada al LLM. El
 * tri-estado importa: "unchecked" NO es un fallo, es "acá no aplicó nada
 * determinístico, decidilo vos" — confundirlo con "failed" haría que el
 * coordinador reabra tareas que estaban bien.
 *
 * Usa HIVE_DB_PATH=":memory:".
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { AgentDoc, ArtifactDoc } from "../packages/core/src/storage/collections";
import {
  runAcceptanceChecks,
  recordAgentOutcome,
  sanitizeDiagnostic,
} from "../packages/core/src/agent/acceptance-checks";

let scratch: string;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
  scratch = mkdtempSync(join(tmpdir(), "hive-acceptance-"));
});

afterEach(() => {
  closeHiveDb();
  rmSync(scratch, { recursive: true, force: true });
});

/** Crea un artifact real en disco + su fila, tal que inspectArtifact lo valide. */
async function seedArtifact(overrides: Partial<ArtifactDoc> = {}): Promise<string> {
  const id = randomUUID();
  const bytes = Buffer.from(`contenido de ${id}`);
  const path = join(scratch, `${id}.txt`);
  writeFileSync(path, bytes);

  const doc: ArtifactDoc = {
    id,
    run_id: null,
    task_id: null,
    user_id: "tester",
    kind: "document",
    path,
    mime_type: "text/plain",
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: null,
    height: null,
    status: "active",
    created_at: Date.now(),
    expires_at: Date.now() + 3_600_000,
    expired_at: null,
    ...overrides,
  };
  await (await col<ArtifactDoc>("artifacts")).put(id, doc);
  return id;
}

async function seedAgent(id: string, helpful = 0, harmful = 0): Promise<void> {
  const agents = await col<AgentDoc>("agents");
  await agents.put(id, {
    id,
    name: id,
    role: "worker",
    helpful_count: helpful,
    harmful_count: harmful,
    updated_at: 0,
  } as AgentDoc);
}

// ─── sanitizeDiagnostic ───────────────────────────────────────────────────────

describe("sanitizeDiagnostic", () => {
  test("redacta credenciales antes de que el detalle llegue al prompt del coordinador", () => {
    const out = sanitizeDiagnostic(
      'api_key: sk-live-abcdef123 y {"token":"ghp_secreto"} y authorization: Bearer xyz',
    );
    expect(out).not.toContain("sk-live-abcdef123");
    expect(out).not.toContain("ghp_secreto");
    expect(out).not.toContain("xyz");
    expect(out).toContain("[REDACTED]");
  });

  test("no deja el token detrás del esquema de auth", () => {
    // Regresión: la versión anterior consumía sólo "Bearer" y publicaba el token.
    expect(sanitizeDiagnostic("authorization: Bearer ghp_tokenreal")).toBe(
      "authorization: Bearer [REDACTED]",
    );
    expect(sanitizeDiagnostic("Authorization: Basic dXNlcjpwYXNz")).toBe(
      "Authorization: Basic [REDACTED]",
    );
  });

  test("cubre las variantes de nombre de la credencial", () => {
    for (const key of ["api_key", "api-key", "apikey", "TOKEN", "Secret", "authorization"]) {
      expect(sanitizeDiagnostic(`${key}=valor_sensible`)).not.toContain("valor_sensible");
    }
  });

  test("trunca al límite — un check tool verborrágico no puede inundar el contexto", () => {
    expect(sanitizeDiagnostic("a".repeat(5000))).toHaveLength(1000);
    expect(sanitizeDiagnostic("a".repeat(5000), 42)).toHaveLength(42);
  });

  test("deja pasar texto inocuo sin tocarlo", () => {
    const inocuo = "El archivo informe.pdf tiene 12 páginas";
    expect(sanitizeDiagnostic(inocuo)).toBe(inocuo);
  });
});

// ─── delivery gate ────────────────────────────────────────────────────────────

describe("runAcceptanceChecks — delivery gate", () => {
  test("una entrega vacía falla sin necesidad de criterios", async () => {
    const checks = await runAcceptanceChecks({ objective: "algo", delivery: "" });

    expect(checks.status).toBe("failed");
    expect(checks.results).toHaveLength(1);
    expect(checks.results[0]).toMatchObject({
      criterion_id: "delivery",
      check: "delivery_gate",
      met: false,
      detail: "Empty delivery",
    });
  });

  test("una entrega de puro whitespace cuenta como vacía", async () => {
    const checks = await runAcceptanceChecks({ objective: "algo", delivery: "   \n\t  " });
    expect(checks.status).toBe("failed");
  });

  test("el worker que declara `status: failed` se rechaza solo", async () => {
    const checks = await runAcceptanceChecks({
      objective: "algo",
      delivery: "Intenté descargarlo pero el sitio pide login.\n- status: failed",
    });

    expect(checks.status).toBe("failed");
    expect(checks.results[0].detail).toContain("failed");
  });

  test("`status: completed` no dispara el gate", async () => {
    const checks = await runAcceptanceChecks({
      objective: "algo",
      delivery: "Listo.\nstatus: completed",
    });
    expect(checks.results.some((r) => r.check === "delivery_gate")).toBe(false);
  });

  test("la palabra 'failed' en prosa no rechaza una entrega buena", async () => {
    // El gate se ancla a "status:" al principio de línea. Sin eso, cualquier
    // worker que narre un intento fallido intermedio se auto-rechazaría.
    const checks = await runAcceptanceChecks({
      objective: "algo",
      delivery: "El primer intento failed, reintenté y salió bien. Adjunto el resultado.",
    });

    expect(checks.status).toBe("unchecked");
    expect(checks.results).toHaveLength(0);
  });
});

// ─── tri-estado ───────────────────────────────────────────────────────────────

describe("runAcceptanceChecks — tri-estado", () => {
  test("sin nada determinístico aplicable devuelve 'unchecked', no 'failed'", async () => {
    const checks = await runAcceptanceChecks({
      objective: "resumir el documento",
      delivery: "Acá va el resumen del documento.",
    });

    expect(checks.status).toBe("unchecked");
    expect(checks.results).toHaveLength(0);
    expect(checks.summary).toContain("requiere juicio del coordinador");
  });

  test("un criterio sin checkTool no genera resultado — queda para el coordinador", async () => {
    const checks = await runAcceptanceChecks({
      objective: "resumir",
      delivery: "resumen",
      acceptance: [{ id: "c1", description: "el resumen debe ser fiel al original" }],
    });

    expect(checks.status).toBe("unchecked");
    expect(checks.results).toHaveLength(0);
  });

  test("un checkTool que no está en el registry es 'unchecked', no un fallo", async () => {
    // Un nombre de tool mal escrito en el criterio no debe hacer fracasar una
    // entrega correcta: no sabemos nada, y eso es distinto de saber que está mal.
    const checks = await runAcceptanceChecks({
      objective: "verificar",
      delivery: "hecho",
      acceptance: [{ id: "c1", description: "x", checkTool: "tool_que_no_existe" }],
    });

    expect(checks.results).toHaveLength(1);
    expect(checks.results[0]).toMatchObject({
      criterion_id: "c1",
      check: "tool_que_no_existe",
      met: null,
      detail: "Check tool not found in registry",
    });
    expect(checks.status).toBe("unchecked");
  });

  test("un fallo pesa más que un acierto", async () => {
    const good = await seedArtifact();
    const checks = await runAcceptanceChecks({
      objective: "entregar dos archivos",
      delivery: "listo",
      evidence: [
        `artifact_id: ${good}`,
        `artifact_id: ${randomUUID()}`, // no existe
      ],
    });

    expect(checks.results).toHaveLength(2);
    expect(checks.results.some((r) => r.met === true)).toBe(true);
    expect(checks.results.some((r) => r.met === false)).toBe(true);
    expect(checks.status).toBe("failed");
  });
});

// ─── artifacts ────────────────────────────────────────────────────────────────

describe("runAcceptanceChecks — artifacts", () => {
  test("un artifact íntegro pasa", async () => {
    const id = await seedArtifact();
    const checks = await runAcceptanceChecks({
      objective: "generar el informe",
      delivery: "informe generado",
      evidence: [`Adjunto el informe. artifact_id: ${id}`],
    });

    expect(checks.status).toBe("passed");
    expect(checks.results[0]).toMatchObject({ check: "artifact_inspect", met: true });
    expect(checks.results[0].detail).toContain(id);
  });

  test("un artifact_id inventado se detecta — es el modo de falla que motivó el check", async () => {
    const fantasma = randomUUID();
    const checks = await runAcceptanceChecks({
      objective: "generar el informe",
      delivery: "informe generado",
      evidence: [`artifact_id: ${fantasma}`],
    });

    expect(checks.status).toBe("failed");
    expect(checks.results[0].detail).toContain("Artifact not found");
  });

  test("un artifact cuyo binario cambió bajo los pies falla el hash", async () => {
    const id = await seedArtifact();
    const artifacts = await col<ArtifactDoc>("artifacts");
    const entry = (await artifacts.get(id))!;
    writeFileSync(entry.doc.path, "contenido manipulado");

    const checks = await runAcceptanceChecks({
      objective: "x",
      delivery: "y",
      evidence: [`artifact_id: ${id}`],
    });

    expect(checks.status).toBe("failed");
  });

  test("un artifact expirado no cuenta como entregado", async () => {
    const id = await seedArtifact({ status: "expired", expired_at: Date.now() });
    const checks = await runAcceptanceChecks({
      objective: "x",
      delivery: "y",
      evidence: [`artifact_id: ${id}`],
    });

    expect(checks.status).toBe("failed");
    expect(checks.results[0].detail).toContain("expired");
  });

  test("el mismo artifact citado varias veces se inspecciona una sola vez", async () => {
    const id = await seedArtifact();
    const checks = await runAcceptanceChecks({
      objective: "x",
      delivery: "y",
      evidence: [`artifact_id: ${id}`, `de nuevo artifact_id: ${id}`],
    });

    expect(checks.results.filter((r) => r.check === "artifact_inspect")).toHaveLength(1);
  });

  test("evidencia sin artifact_id no inventa checks", async () => {
    const checks = await runAcceptanceChecks({
      objective: "x",
      delivery: "y",
      evidence: ["Busqué en la web y encontré tres fuentes."],
    });

    expect(checks.results).toHaveLength(0);
    expect(checks.status).toBe("unchecked");
  });

  test("reconoce el artifact_id entrecomillado y en mayúsculas", async () => {
    const id = await seedArtifact();
    const checks = await runAcceptanceChecks({
      objective: "x",
      delivery: "y",
      evidence: [`ARTIFACT_ID: "${id}"`],
    });

    expect(checks.results).toHaveLength(1);
    expect(checks.results[0].met).toBe(true);
  });
});

// ─── summary ──────────────────────────────────────────────────────────────────

describe("runAcceptanceChecks — summary", () => {
  test("el summary marca cada resultado con su símbolo y redacta credenciales", async () => {
    const ok = await seedArtifact();
    const checks = await runAcceptanceChecks({
      objective: "x",
      delivery: "y",
      evidence: [`artifact_id: ${ok}`, `artifact_id: ${randomUUID()}`],
    });

    expect(checks.summary).toContain("✅");
    expect(checks.summary).toContain("❌");
    expect(checks.summary).toContain("artifact_inspect");
  });
});

// ─── recordAgentOutcome ───────────────────────────────────────────────────────

describe("recordAgentOutcome", () => {
  test("suma al contador correcto y no toca el otro", async () => {
    await seedAgent("worker_x", 2, 1);

    await recordAgentOutcome("worker_x", "helpful");
    let doc = (await (await col<AgentDoc>("agents")).get("worker_x"))!.doc;
    expect(doc.helpful_count).toBe(3);
    expect(doc.harmful_count).toBe(1);

    await recordAgentOutcome("worker_x", "harmful");
    doc = (await (await col<AgentDoc>("agents")).get("worker_x"))!.doc;
    expect(doc.helpful_count).toBe(3);
    expect(doc.harmful_count).toBe(2);
  });

  test("arranca desde 0 cuando el agente nunca tuvo contadores", async () => {
    const agents = await col<AgentDoc>("agents");
    await agents.put("worker_nuevo", { id: "worker_nuevo", name: "nuevo", role: "worker" } as AgentDoc);

    await recordAgentOutcome("worker_nuevo", "helpful");

    const doc = (await agents.get("worker_nuevo"))!.doc;
    expect(doc.helpful_count).toBe(1);
    expect(doc.harmful_count).toBe(0);
  });

  test("refresca updated_at", async () => {
    await seedAgent("worker_ts");
    await recordAgentOutcome("worker_ts", "helpful");
    const doc = (await (await col<AgentDoc>("agents")).get("worker_ts"))!.doc;
    expect(doc.updated_at).toBeGreaterThan(0);
  });

  test("un agentId ausente o desconocido es un no-op silencioso", async () => {
    // El llamador no siempre sabe qué agente ejecutó (delegación anónima); esto
    // corre en la ruta de cierre de una tarea y no puede tumbarla.
    await recordAgentOutcome(null, "helpful");
    await recordAgentOutcome(undefined, "harmful");
    await recordAgentOutcome("", "helpful");
    await recordAgentOutcome("no_existe", "harmful");

    expect(await (await col<AgentDoc>("agents")).get("no_existe")).toBeUndefined();
  });

  test("escrituras concurrentes sobre el mismo agente no se pisan (OCC)", async () => {
    await seedAgent("worker_race");

    await Promise.all([
      recordAgentOutcome("worker_race", "helpful"),
      recordAgentOutcome("worker_race", "helpful"),
      recordAgentOutcome("worker_race", "harmful"),
    ]);

    const doc = (await (await col<AgentDoc>("agents")).get("worker_race"))!.doc;
    expect(doc.helpful_count + doc.harmful_count).toBe(3);
  });
});
