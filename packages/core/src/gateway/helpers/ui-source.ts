import * as path from "node:path";
import { existsSync } from "node:fs";

/**
 * De dónde sale la UI que sirve el gateway en producción.
 *
 * `disk` gana siempre que haya un `index.html` real, porque esa copia se
 * construye en el mismo paso que la publica (la etapa `ui-builder` del
 * Dockerfile, o `packages/hive-ui/dist` en el monorepo). `embedded` es el
 * bundle que `generate-ui-bundle.ts` compila dentro del ejecutable standalone,
 * que es la única forma de que un binario suelto tenga UI pero que también
 * puede quedar viejo respecto del disco.
 */
export type UISource =
  | { kind: "disk"; dir: string }
  | { kind: "embedded" }
  | { kind: "none"; dir: string };

export type UISourceInput = {
  uiDirEnv?: string;
  distDirEnv?: string;
  hiveDir: string;
  cwd: string;
  hasEmbedded: boolean;
  /** Inyectable para poder testear sin tocar el filesystem. */
  exists?: (candidate: string) => boolean;
};

/**
 * Orden:
 * HIVE_UI_DIR > bundle embebido > ~/.hive/ui > HIVE_DIST_DIR/ui > cwd/packages/hive-ui/dist
 *
 * La elección es una sola por request y no por path: mezclar dos fuentes
 * serviría un `index.html` de un build con los `assets/index-<hash>.js` de otro.
 */
export function resolveUISource(input: UISourceInput): UISource {
  const exists = input.exists ?? existsSync;
  const hasIndex = (dir: string) => exists(path.join(dir, "index.html"));

  // HIVE_UI_DIR es un override explícito y le gana al embed. Es lo que usa la
  // imagen Docker, cuya etapa ui-builder compila la UI en cada build y la deja
  // en /app/ui. Cuando el embed ganaba, el contenedor servía la copia que
  // viajaba dentro del binario —commiteada y congelada— y /app/ui quedaba
  // inerte.
  if (input.uiDirEnv && hasIndex(input.uiDirEnv)) {
    return { kind: "disk", dir: input.uiDirEnv };
  }

  // El embed va compilado dentro del ejecutable, así que siempre corresponde a
  // su versión. Le gana a los directorios heredados: ~/.hive/ui puede haber
  // quedado de una instalación anterior y taparía la UI del binario nuevo.
  if (input.hasEmbedded) return { kind: "embedded" };

  const fallbacks = [
    path.join(input.hiveDir, "ui"),
    input.distDirEnv ? path.join(input.distDirEnv, "ui") : undefined,
    path.join(input.cwd, "packages/hive-ui/dist"),
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of fallbacks) {
    if (hasIndex(dir)) return { kind: "disk", dir };
  }

  // Sin UI en ningún lado: se devuelve el candidato preferido para poder
  // nombrarlo en el mensaje de error.
  return { kind: "none", dir: input.uiDirEnv ?? fallbacks[0]! };
}
