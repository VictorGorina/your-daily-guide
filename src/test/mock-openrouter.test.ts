import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { streamText } from "ai";

import { mockAnswer, startMockOpenRouter } from "../../e2e/mock-openrouter";
import { createAiProvider, COACH_MODEL } from "@/lib/ai-provider.server";
import { decomposeDishes, isCalculated } from "@/lib/nutrition/resolve-dish.server";

// El OpenRouter de mentira del smoke E2E (ticket 25) solo sirve si el SDK de
// verdad acepta lo que contesta y si sus recetas pasan por la validación de la
// app. Aquí no hay navegador ni base de datos: el mock, el SDK y la cadena de
// platos. Si esto falla, el job `e2e` del CI dejaría Hoy en "Calculando…".

/** Los platos que siembra `supabase/seed.sql`: los que el smoke le pedirá al mock. */
function seedDishes(): string[] {
  const seed = readFileSync(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
  const quoted = (block: string | undefined) =>
    [...(block ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  return [
    ...quoted(seed.match(/lunches constant text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1]),
    ...quoted(seed.match(/dinners constant text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1]),
    ...quoted(seed.match(/'breakfasts', jsonb_build_array\(([^)]*)\)/)?.[1]),
    ...quoted(seed.match(/'snacks', jsonb_build_array\(([^)]*)\)/)?.[1]),
  ];
}

describe("mock de OpenRouter (E2E)", () => {
  let server: Server;
  const saved = process.env.OPENROUTER_BASE_URL;

  beforeAll(async () => {
    server = await startMockOpenRouter(0);
    const { port } = server.address() as AddressInfo;
    process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = saved;
    server.close();
  });

  it("el seed trae los platos que se esperan", () => {
    expect(seedDishes()).toHaveLength(18);
  });

  it("cada plato del seed sale calculado de su receta", async () => {
    const dishes = seedDishes();
    const out = await decomposeDishes(dishes, { apiKey: "e2e", userId: null });
    const pending = dishes.filter((dish) => !isCalculated(out.get(dish)));
    expect(pending).toEqual([]);
  });

  it("contesta también en streaming (askForJson)", async () => {
    const ai = createAiProvider("e2e", null);
    const result = streamText({ model: ai(COACH_MODEL), prompt: "Genera la guía de HOY." });
    expect(JSON.parse(await result.text).behaviors).toHaveLength(3);
  });

  it("un prompt que no conoce contesta un JSON vacío", () => {
    expect(mockAnswer("Otra cosa")).toBe("{}");
  });
});
