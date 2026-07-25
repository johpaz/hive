import { describe, expect, it } from "bun:test";

describe("contrato de documentación", () => {
  it("mantiene sincronizados inventario, versiones, skills, exports y enlaces", () => {
    const result = Bun.spawnSync(["bun", "scripts/generate-docs.ts", "--check"], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode, result.stderr.toString()).toBe(0);
  });
});
