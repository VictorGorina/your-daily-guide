import { describe, expect, it } from "bun:test";

import { WEB_AFTER_TOOL } from "./chat-body.fixtures";
import { chatHistoryMax, compactGuide, trimHistory } from "./chat-context";

const user = (id: string) => ({ id, role: "user" });
const coach = (id: string) => ({ id, role: "assistant" });
const ids = (messages: { id: string }[]) => messages.map((m) => m.id).join(" ");

/** Conversación alterna persona/coach: u1 a1 u2 a2 … */
const turns = (n: number) =>
  Array.from({ length: n }, (_, i) => [user(`u${i + 1}`), coach(`a${i + 1}`)]).flat();

describe("chatHistoryMax", () => {
  it("sin definir, vacía o inválida: sin límite", () => {
    for (const raw of [undefined, "", "0", "-3", "2.5", "treinta"]) {
      expect(chatHistoryMax(raw)).toBe(Infinity);
    }
  });

  it("lee un entero ≥ 1", () => {
    expect(chatHistoryMax("30")).toBe(30);
    expect(chatHistoryMax("1")).toBe(1);
  });
});

describe("trimHistory", () => {
  it("no toca lo que cabe, ni nada sin límite", () => {
    const messages = [...turns(3), user("u4")];
    expect(trimHistory(messages, 7)).toBe(messages);
    expect(trimHistory(messages, Infinity)).toBe(messages);
    expect(trimHistory(messages, 0)).toBe(messages);
  });

  it("deja los últimos mensajes, hasta el de la persona", () => {
    const messages = [...turns(4), user("u5")];
    expect(ids(trimHistory(messages, 3))).toBe("u4 a4 u5");
  });

  it("si el corte cae en un mensaje del coach, recorta uno más", () => {
    const messages = [...turns(4), user("u5")];
    // Los 4 últimos serían «a3 u4 a4 u5»: a3 contesta a algo que ya no está.
    expect(ids(trimHistory(messages, 4))).toBe("u4 a4 u5");
  });

  it("no parte una herramienta de su resultado: van en el mismo mensaje", () => {
    const [first, withTool] = WEB_AFTER_TOOL.messages as { id: string; role: string }[];
    const messages = [...turns(3), first!, withTool!];
    const kept = trimHistory(messages, 1);
    // El reenvío tras una herramienta acaba en el coach: se conserva el
    // mensaje de la persona que la provocó, aunque quede antes del corte.
    expect(kept).toEqual([first!, withTool!]);
  });

  it("conserva el último mensaje de la persona tras varios pasos del coach", () => {
    const messages = [...turns(2), user("u3"), coach("a3"), coach("a3b"), coach("a3c")];
    expect(ids(trimHistory(messages, 2))).toBe("u3 a3 a3b a3c");
  });

  it("sin ningún mensaje de la persona, los últimos sin más", () => {
    const messages = [coach("a1"), coach("a2"), coach("a3")];
    expect(ids(trimHistory(messages, 2))).toBe("a2 a3");
  });
});

/**
 * Una guía con la forma con la que se guarda en `daily_logs.guide` (las de
 * producción pesan entre 1,8 y 2 KB), con texto de relleno.
 */
const GUIDE = {
  intro: "Hoy toca un día tranquilo: céntrate en llegar bien a la cena.",
  calories: "Hoy te tocan unas 1.850 kcal, repartidas en cuatro comidas.",
  macros: "Proteína alta, hidratos en la comida y grasa moderada.",
  targets: { kcal: 1850, protein_g: 120, carbs_g: 200, fat_g: 60, fiber_g: 28 },
  macroEstimate: { kcal: 1320, protein_g: 82, carbs_g: 150, fat_g: 44, fiber_g: 24 },
  portionFactor: 1.1,
  behaviors: ["Bebe agua con cada comida", "Sal a caminar 20 minutos"],
  tips: ["Deja el pan cortado para no repetir"],
  meals: [
    { moment: "Desayuno", idea: "Tostada integral con tomate y huevo" },
    { moment: "Comida", idea: "Lentejas estofadas con verduras" },
    { moment: "Merienda", idea: "Yogur natural con nueces" },
    { moment: "Cena", idea: "Merluza al horno con brócoli" },
  ],
  mealMacros: [
    {
      moment: "Desayuno",
      idea: "Tostada integral con tomate y huevo",
      status: "calculado",
      portion: 1.1,
      kcal: 381.6,
      protein_g: 19,
      carbs_g: 38,
      fat_g: 16,
      fiber_g: 6,
    },
    {
      moment: "Comida",
      idea: "Lentejas estofadas con verduras",
      status: "calculado",
      kcal: 612,
      protein_g: 34,
      carbs_g: 82,
      fat_g: 14,
      fiber_g: 16,
    },
    {
      moment: "Merienda",
      idea: "Yogur natural con nueces",
      status: "calculando",
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      fiber_g: 0,
    },
    // Calculado contra el plato de antes: la cena se cambió después.
    {
      moment: "Cena",
      idea: "Tortilla francesa con ensalada",
      status: "calculado",
      kcal: 420,
      protein_g: 28,
      carbs_g: 12,
      fat_g: 28,
      fiber_g: 4,
    },
  ],
};

describe("compactGuide", () => {
  it("deja las comidas con sus kcal y el texto de calorías", () => {
    expect(compactGuide(GUIDE, true)).toEqual({
      calorias: GUIDE.calories,
      comidas: [
        { momento: "Desayuno", plato: "Tostada integral con tomate y huevo", kcal: 382 },
        { momento: "Comida", plato: "Lentejas estofadas con verduras", kcal: 612 },
        // Calculando: sus cifras a 0 no son un dato.
        { momento: "Merienda", plato: "Yogur natural con nueces" },
        // Las kcal eran de otro plato.
        { momento: "Cena", plato: "Merluza al horno con brócoli" },
      ],
    });
  });

  it("pesa bastante menos que la guía entera", () => {
    const compact = JSON.stringify(compactGuide(GUIDE, true)).length;
    expect(compact).toBeLessThan(JSON.stringify(GUIDE).length / 2);
  });

  it("sin cifras para quien eligió no verlas", () => {
    const compact = compactGuide(GUIDE, false);
    expect(compact?.comidas).toHaveLength(4);
    expect(JSON.stringify(compact)).not.toMatch(/\d/);
  });

  it("una guía sin `meals` cuenta con lo que digan sus macros", () => {
    const { meals: _meals, ...old } = GUIDE;
    expect(compactGuide(old, true)?.comidas[3]).toEqual({
      momento: "Cena",
      plato: "Tortilla francesa con ensalada",
      kcal: 420,
    });
  });

  it("sin guía, o sin nada que contar, null", () => {
    expect(compactGuide(null, true)).toBeNull();
    expect(compactGuide("guía", true)).toBeNull();
    expect(compactGuide({ intro: "Hola" }, true)).toBeNull();
    expect(compactGuide({ calories: "Unas 1.850 kcal", meals: [] }, false)).toBeNull();
  });
});
