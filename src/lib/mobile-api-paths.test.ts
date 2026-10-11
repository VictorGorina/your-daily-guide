import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// El móvil llama a `/api/v1/*` con `apiPost("ruta")`: una cadena que `tsc` no
// puede comprobar. Una ruta mal escrita (o con el prefijo repetido: `apiPost`
// ya pone `/api/v1/`) solo fallaba en el dispositivo, como un 404 silencioso.
// Se leen los fuentes del móvil como texto: aquí no hay `mobile/node_modules`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CALL = /\bapiPost(?:Public)?\s*(?:<[^;]*?>)?\(\s*(["'`])([^"'`]*)\1/gs;

function mobileApiPaths(): { path: string; file: string }[] {
  const out: { path: string; file: string }[] = [];
  for (const dir of ["lib", "app", "components"]) {
    const files = readdirSync(join(ROOT, "mobile", dir), { recursive: true, encoding: "utf8" });
    for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(join(ROOT, "mobile", dir, file), "utf8");
      for (const match of source.matchAll(CALL)) {
        out.push({ path: match[2]!, file: `mobile/${dir}/${file}` });
      }
    }
  }
  return out;
}

describe("rutas de la API que llama el móvil", () => {
  const calls = mobileApiPaths();

  it("encuentra las llamadas (si no, el patrón ha dejado de valer)", () => {
    expect(calls.length).toBeGreaterThan(25);
    expect(calls.map((c) => c.path)).toContain("day/guide");
  });

  it("cada `apiPost` apunta a una ruta que existe en src/routes/api/v1", () => {
    const missing = calls.filter(
      (c) => !existsSync(join(ROOT, "src/routes/api/v1", `${c.path}.ts`)),
    );
    expect(missing).toEqual([]);
  });
});
