import { describe, expect, it } from "bun:test";

import {
  DecomposeError,
  matchAnswer,
  parseDecomposition,
  runDecomposeChain,
  type AskModel,
  type RawDish,
} from "./decompose-chain";

const withRecipe = (): RawDish => ({
  comida: true,
  vago: false,
  metodos: ["guiso"],
  ingredientes: [{ key: "lentejas-secas", nombre: "lentejas", gramos: 60, estado: "crudo" }],
});

/** Un `ask` de mentira: por modelo, qué platos contesta y cuáles no. */
function fakeAsk(
  answers: Record<string, (dishes: string[]) => Map<string, RawDish>>,
  calls: { model: string; dishes: string[] }[] = [],
): AskModel {
  return async (dishes, model) => {
    calls.push({ model, dishes });
    const answer = answers[model];
    if (!answer) throw new DecomposeError("error-modelo");
    return answer(dishes);
  };
}

const fast = { batch: 10, single: 10, fallback: 10 };
const PRIMARY = "openai/gpt-5";
const FALLBACK = "google/gemini-2.5-flash";

describe("runDecomposeChain — todo plato se calcula (D13)", () => {
  it("un plato que falla con el primer modelo y sale con el segundo queda calculado", async () => {
    const calls: { model: string; dishes: string[] }[] = [];
    const ask = fakeAsk(
      {
        [PRIMARY]: () => new Map(), // JSON válido pero sin el plato: lote cortado
        [FALLBACK]: (dishes) => new Map(dishes.map((d) => [d.toLowerCase(), withRecipe()])),
      },
      calls,
    );
    const { raws, failures } = await runDecomposeChain({
      dishes: ["Lentejas estofadas"],
      ask,
      model: PRIMARY,
      fallbackModel: FALLBACK,
      timeouts: fast,
    });
    expect(raws.get("Lentejas estofadas")?.ingredientes.length).toBe(1);
    expect(failures.size).toBe(0);
    // Lote, reintento uno a uno con el mismo modelo, y después el de respaldo.
    expect(calls.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
  });

  it("reintenta uno a uno solo los platos que faltan en el lote", async () => {
    const calls: { model: string; dishes: string[] }[] = [];
    const ask = fakeAsk(
      {
        [PRIMARY]: (dishes) =>
          dishes.length > 1
            ? new Map([["pasta con tomate", withRecipe()]])
            : new Map(dishes.map((d) => [d.toLowerCase(), withRecipe()])),
      },
      calls,
    );
    const { raws } = await runDecomposeChain({
      dishes: ["Pasta con tomate", "Tortilla", "Ensalada"],
      ask,
      model: PRIMARY,
      fallbackModel: FALLBACK,
      timeouts: fast,
    });
    expect(raws.size).toBe(3);
    expect(calls.slice(1).map((c) => c.dishes)).toEqual([["Tortilla"], ["Ensalada"]]);
    expect(calls.some((c) => c.model === FALLBACK)).toBe(false);
  });

  it("si fallan los dos modelos, queda sin resultado y con su motivo", async () => {
    const ask = fakeAsk({
      [PRIMARY]: () => {
        throw new DecomposeError("json-invalido");
      },
    });
    const { raws, failures } = await runDecomposeChain({
      dishes: ["Pizza"],
      ask,
      model: PRIMARY,
      fallbackModel: FALLBACK,
      timeouts: fast,
    });
    expect(raws.size).toBe(0);
    expect(failures.get("Pizza")).toBe("error-modelo"); // el último paso, el de respaldo
  });

  it("el tope de gasto mensual corta la cadena: no se sigue llamando", async () => {
    const calls: { model: string; dishes: string[] }[] = [];
    const capped: AskModel = async (dishes, model) => {
      calls.push({ model, dishes });
      const error = new Error("tope");
      error.name = "RateLimitError";
      throw error;
    };
    const result = await runDecomposeChain({
      dishes: ["Pizza", "Pasta"],
      ask: capped,
      model: PRIMARY,
      fallbackModel: FALLBACK,
      timeouts: fast,
    });
    expect(result.capped).toBe(true);
    expect(calls).toHaveLength(1);
    expect(result.failures.get("Pizza")).toBe("tope-gasto");
  });

  it("vago y 'no es comida' son respuestas, no fallos: no se reintentan", async () => {
    const calls: { model: string; dishes: string[] }[] = [];
    const ask = fakeAsk(
      {
        [PRIMARY]: () =>
          new Map<string, RawDish>([
            ["algo rapido", { comida: true, vago: true, metodos: [], ingredientes: [] }],
            ["una piedra", { comida: false, vago: false, metodos: [], ingredientes: [] }],
          ]),
      },
      calls,
    );
    const { raws } = await runDecomposeChain({
      dishes: ["algo rápido", "una piedra"],
      ask,
      model: PRIMARY,
      fallbackModel: FALLBACK,
      timeouts: fast,
    });
    expect(raws.get("algo rápido")?.vago).toBe(true);
    expect(raws.get("una piedra")?.comida).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("`noFallback` (el eval) no llama al modelo de respaldo", async () => {
    const calls: { model: string; dishes: string[] }[] = [];
    const ask = fakeAsk({ [PRIMARY]: () => new Map() }, calls);
    await runDecomposeChain({
      dishes: ["Pizza"],
      ask,
      model: PRIMARY,
      fallbackModel: FALLBACK,
      noFallback: true,
      timeouts: fast,
    });
    expect(calls.map((c) => c.model)).toEqual([PRIMARY, PRIMARY]);
  });
});

describe("parseDecomposition", () => {
  const parse = (t: string) => JSON.parse(t);

  it("indexa por nombre normalizado y lee vago y comida", () => {
    const map = parseDecomposition(
      JSON.stringify({ platos: [{ plato: "Pollo al Curry", comida: true, ingredientes: [{}] }] }),
      parse,
    );
    expect(map.get("pollo al curry")).toMatchObject({ comida: true, vago: false });
  });

  it("sin texto o sin `platos` es un fallo con motivo, no un mapa vacío", () => {
    expect(() => parseDecomposition("", parse)).toThrow("sin-respuesta");
    expect(() => parseDecomposition("{no json", parse)).toThrow("json-invalido");
    expect(() => parseDecomposition('{"x": 1}', parse)).toThrow("json-invalido");
  });
});

describe("matchAnswer — casar la respuesta con los platos pedidos", () => {
  const raw = withRecipe();
  const answerOf = (...labels: string[]) =>
    new Map(labels.map((label) => [label, { ...raw, coccion: label }] as const));
  /** La marca que `answerOf` deja en cada fila, para saber cuál casó con qué plato. */
  const markOf = (dish: RawDish | undefined) => (dish as { coccion?: string } | undefined)?.coccion;

  it("por nombre, como siempre", () => {
    const got = matchAnswer(["Pasta con tomate"], answerOf("pasta con tomate"));
    expect(markOf(got.get("Pasta con tomate"))).toBe("pasta con tomate");
  });

  it("etiquetas con el número de la lista que copió el modelo (regresión 2026-09-24)", () => {
    const got = matchAnswer(
      ["Pasta con tomate", "Lentejas"],
      answerOf("1. pasta con tomate", "2) lentejas"),
    );
    expect(markOf(got.get("Pasta con tomate"))).toBe("1. pasta con tomate");
    expect(markOf(got.get("Lentejas"))).toBe("2) lentejas");
  });

  it("un plato que empieza por número no pierde el número", () => {
    const got = matchAnswer(["2 huevos fritos"], answerOf("2 huevos fritos"));
    expect(got.get("2 huevos fritos")).toBeDefined();
    // Sin separador no es un número de lista: "huevos fritos" no casa con él.
    expect(
      matchAnswer(["Huevos fritos", "Otro"], answerOf("2 huevos fritos", "x")).get("Huevos fritos"),
    ).toBeUndefined();
  });

  it("un plato y una fila: casa por posición aunque el modelo reescriba la etiqueta", () => {
    const got = matchAnswer(["Pasta boloñesa"], answerOf("espaguetis a la boloñesa"));
    expect(markOf(got.get("Pasta boloñesa"))).toBe("espaguetis a la boloñesa");
  });

  it("varios platos con etiquetas reescritas: no adivina (mejor reintentar que cifras cruzadas)", () => {
    const got = matchAnswer(["Pasta", "Lentejas"], answerOf("espaguetis", "legumbres"));
    expect(got.get("Pasta")).toBeUndefined();
    expect(got.get("Lentejas")).toBeUndefined();
  });

  it("la cadena da por buenos los platos numerados sin reintentar uno a uno", async () => {
    const calls: { model: string; dishes: string[] }[] = [];
    const result = await runDecomposeChain({
      dishes: ["Pasta con tomate", "Lentejas"],
      ask: fakeAsk(
        { m: (d) => new Map(d.map((dish, i) => [`${i + 1}. ${dish.toLowerCase()}`, raw])) },
        calls,
      ),
      model: "m",
      fallbackModel: "f",
    });
    expect(result.raws.size).toBe(2);
    expect(calls).toHaveLength(1);
  });
});
