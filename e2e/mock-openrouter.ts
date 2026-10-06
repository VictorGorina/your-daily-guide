import { createServer, type IncomingMessage, type Server } from "node:http";

// OpenRouter de mentira para los tests E2E (ticket 25 de la auditoría). Habla
// lo justo de `POST /chat/completions` (con y sin streaming) para que el SDK
// lo acepte, y contesta siempre lo mismo a lo mismo: el smoke no gasta crédito
// ni depende de lo que diga un modelo ese día. El servidor de la app lo usa al
// arrancar con `OPENROUTER_BASE_URL` (ver `aiBaseUrl`).
//
// Reconoce cada petición por cómo empieza su prompt. Lo que no reconoce
// contesta `{}` y deja el principio del prompt en la salida, para ver en el
// log del CI qué pidió la app que aquí no está previsto.

type Ingredient = {
  nombre: string;
  key: string;
  categoria: string;
  gramos: number;
  estado: "crudo" | "listo";
  es_grasa_de_cocinar: boolean;
};

const ing = (
  key: string,
  categoria: string,
  gramos: number,
  estado: "crudo" | "listo" = "crudo",
): Ingredient => ({
  nombre: key.replace(/-/g, " "),
  key,
  categoria,
  gramos,
  estado,
  es_grasa_de_cocinar: false,
});

/** Sin tildes ni mayúsculas: así se buscan las palabras del nombre del plato. */
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Qué pone en el plato cada palabra de su nombre, en la ración base de AESAN y
 * con claves de la tabla de composición. Una receta sale de las palabras que
 * lleva el nombre, así `validateRecipe` no echa nada en falta.
 */
const BY_WORD: [RegExp, (dish: string) => Ingredient[]][] = [
  [/lentejas/, () => [ing("lentejas-secas", "legumbre", 60)]],
  [/garbanzos/, () => [ing("garbanzos-secos", "legumbre", 60)]],
  [/pollo/, () => [ing("pechuga-pollo", "proteina", 110)]],
  [/pavo/, () => [ing("pavo-pechuga", "proteina", 110)]],
  [/ternera/, () => [ing("ternera-magra", "proteina", 110)]],
  [/merluza/, () => [ing("merluza", "proteina", 135)]],
  [/salmon/, () => [ing("salmon", "proteina", 135)]],
  [/sepia|calamar/, () => [ing("calamar", "proteina", 135)]],
  [/atun/, () => [ing("atun-lata", "proteina", 60, "listo")]],
  [/tortilla|revuelto/, () => [ing("huevo", "proteina", 100)]],
  [/huevo/, (dish) => (/tortilla|revuelto/.test(dish) ? [] : [ing("huevo", "proteina", 50)])],
  [/arroz/, () => [ing("arroz-crudo", "cereal", 70)]],
  [/pasta/, () => [ing("pasta-integral-cruda", "cereal", 70)]],
  [/patata/, () => [ing("patata", "cereal", 150)]],
  [/\bpan\b|tostada/, () => [ing("pan-integral", "cereal", 50, "listo")]],
  [/avena/, () => [ing("avena", "cereal", 30)]],
  [/verduras/, () => [ing("calabacin", "verdura", 100), ing("zanahoria", "verdura", 60)]],
  [/brocoli/, () => [ing("brocoli", "verdura", 150)]],
  [/espinacas/, () => [ing("espinaca", "verdura", 150)]],
  [/calabacin/, () => [ing("calabacin", "verdura", 200)]],
  [/judias verdes/, () => [ing("judia-verde", "verdura", 150)]],
  [/champinones/, () => [ing("champinon", "verdura", 150)]],
  [/pimientos/, () => [ing("pimiento", "verdura", 100)]],
  [/ensalada/, () => [ing("lechuga", "verdura", 80), ing("tomate", "verdura", 80)]],
  [/tomate/, (dish) => (/ensalada/.test(dish) ? [] : [ing("tomate", "verdura", 100)])],
  [/crema|sopa/, () => [ing("caldo", "despensa", 200, "listo")]],
  [/yogur/, () => [ing("yogur-natural", "lacteo", 125, "listo")]],
  [/fruta/, (dish) => [ing("manzana", "fruta", /yogur|avena/.test(dish) ? 60 : 150)]],
  [/nueces/, () => [ing("nuez", "fruto-seco", 25)]],
];

const METHOD_BY_WORD: [RegExp, string][] = [
  [/horno/, "horno"],
  [/plancha/, "plancha"],
  [/estofad|crema|sopa|arroz|pasta|garbanzos con|lentejas/, "guiso"],
  [/saltead|revuelto|tortilla/, "salteado"],
  [/ensalada/, "alinada"],
  [/tostada/, "untada"],
  [/yogur|fruta/, "cruda"],
];

/** La receta fija de un plato: una ración base, como la pide `decomposePrompt`. */
export function mockRecipe(dish: string) {
  const name = plain(dish);
  const ingredientes = BY_WORD.flatMap(([word, build]) => (word.test(name) ? build(name) : []));
  const metodos = METHOD_BY_WORD.filter(([word]) => word.test(name))
    .map(([, method]) => method)
    .slice(0, 2);
  return {
    plato: dish,
    comida: true,
    vago: false,
    metodos: metodos.length ? metodos : ["plancha"],
    tipo_racion: "plato",
    unidad: null,
    cantidad_texto: null,
    // Un plato que no se reconoce: uno completo cualquiera, para que se calcule.
    ingredientes: ingredientes.length
      ? ingredientes
      : [
          ing("arroz-crudo", "cereal", 70),
          ing("pechuga-pollo", "proteina", 110),
          ing("calabacin", "verdura", 150),
        ],
  };
}

const GUIDE = {
  intro: "Hoy toca un día sencillo y rico.",
  macros: "Proteína en cada comida y verdura en dos de ellas.",
  behaviors: ["Bebe agua antes de comer", "Come sin pantallas", "Camina veinte minutos"],
  meals: [
    { moment: "Desayuno", idea: "Yogur natural con avena y fruta" },
    { moment: "Comida", idea: "Lentejas estofadas con verduras" },
    { moment: "Cena", idea: "Tortilla francesa con ensalada de tomate" },
    { moment: "Merienda", idea: "Fruta y un puñado de nueces" },
  ],
  tips: ["Empieza por la verdura", "Cena dos horas antes de dormir", "Ten fruta a la vista"],
};

/** Los platos de la lista numerada del prompt de recetas. */
function dishesOf(prompt: string): string[] {
  const list = prompt.split("Platos:\n")[1]?.split("\n\n")[0] ?? "";
  return list
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Cuántas peticiones de cada tipo han llegado (`GET /requests`): el smoke lo
 * mira para saber que la app pasó de verdad por aquí y no por un respaldo.
 */
const seen: Record<string, number> = {};
const count = (kind: string) => {
  seen[kind] = (seen[kind] ?? 0) + 1;
};

/** Lo que contesta el "modelo" a un prompt. */
export function mockAnswer(prompt: string): string {
  if (prompt.startsWith("Da la receta de cada plato")) {
    count("recipes");
    return JSON.stringify({ platos: dishesOf(prompt).map(mockRecipe) });
  }
  if (prompt.startsWith("Genera la guía de HOY")) {
    count("guide");
    return JSON.stringify(GUIDE);
  }
  if (prompt.startsWith("Para cada ingrediente, elige de SU lista")) {
    count("closestFood");
    return JSON.stringify({ elecciones: [] });
  }
  // La ronda de ajuste del plan (`askPlanFit`): nada que cambiar.
  if (prompt.startsWith("El sistema ajusta la cantidad de cada plato")) {
    count("planFit");
    return JSON.stringify({ cambios: [], ideas: [] });
  }
  count("unknown");
  console.log(`[mock-openrouter] prompt sin respuesta prevista: ${prompt.slice(0, 120)}`);
  return "{}";
}

type ChatMessage = { role?: string; content?: unknown };

/** El texto del último mensaje de la persona (el SDK lo manda como texto o por partes). */
function lastUserText(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const content = last?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const USAGE = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, cost: 0 };

/** Arranca el mock en `port` (0 = uno libre) y devuelve el servidor ya escuchando. */
export function startMockOpenRouter(port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      const body = req.url?.endsWith("/requests") ? JSON.stringify(seen) : '{"ok":true}';
      res.writeHead(200, { "content-type": "application/json" }).end(body);
      return;
    }
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}');
      return;
    }
    const body = await readJson(req);
    const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
    const content = mockAnswer(lastUserText(messages));
    const base = {
      id: "gen-e2e",
      created: Math.floor(Date.now() / 1000),
      model: String(body.model ?? "mock"),
    };

    if (body.stream !== true) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          ...base,
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: USAGE,
        }),
      );
      return;
    }

    const chunk = (choice: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      `data: ${JSON.stringify({
        ...base,
        object: "chat.completion.chunk",
        choices: [{ index: 0, ...choice }],
        ...extra,
      })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(chunk({ delta: { role: "assistant", content }, finish_reason: null }));
    res.write(chunk({ delta: {}, finish_reason: "stop" }, { usage: USAGE }));
    res.end("data: [DONE]\n\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
