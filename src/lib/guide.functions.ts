import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COACH_MODEL, coachSystemPrompt, createAiProvider } from "@/lib/ai-provider.server";

/**
 * Estimación aproximada del total del día, calculada por el modelo a partir
 * de los platos reales del plan de hoy (no de una base de datos nutricional).
 * Es orientativa por diseño — ver el aviso que se muestra junto a la barra de
 * macros en Hoy y el de la portada (index.tsx).
 */
export type MacroEstimate = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

export type GeneratedGuide = {
  intro: string;
  calories: string;
  macros: string;
  /** null cuando aún no hay platos reales de hoy (sin plan) de los que partir. */
  macroEstimate: MacroEstimate | null;
  behaviors: string[];
  meals: { moment: string; idea: string }[];
  tips: string[];
};

const fallback: GeneratedGuide = {
  intro: "Hoy vamos a lo sencillo: comer con calma y moverte un poco.",
  calories: "Rango orientativo según tu día, sin obsesión por la cifra.",
  macros: "Prioriza proteína en cada comida, verdura en dos de ellas y grasas buenas.",
  macroEstimate: null,
  behaviors: ["Bebe agua antes de cada comida", "Come sin pantallas", "Camina 20 minutos"],
  meals: [
    { moment: "Desayuno", idea: "Yogur con fruta y un puñado de frutos secos" },
    { moment: "Comida", idea: "Pollo o legumbre con verduras asadas y arroz" },
    { moment: "Cena", idea: "Tortilla de verduras con ensalada" },
    { moment: "Snack", idea: "Fruta de temporada o un puñado de almendras" },
  ],
  tips: [
    "Bebe unos 2 litros de agua a lo largo del día",
    "Empieza la comida por la verdura o la ensalada",
    "Deja 2-3 horas entre la cena y la cama",
  ],
};

/** Un número finito y positivo, o 0 si el modelo devuelve cualquier otra cosa. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

export const generateDailyGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { meals?: { moment: string; idea: string }[] }) => ({
    // Los platos reales del plan de hoy (no los que la guía se inventa en su
    // propio campo "meals"), para que la estimación de macros parta de lo que
    // la persona va a comer de verdad. Como mucho 6: es contexto, no una lista
    // a repetir en la respuesta.
    todayMeals: Array.isArray(input?.meals)
      ? input.meals
          .filter((m) => m?.idea)
          .slice(0, 6)
          .map((m) => ({ moment: String(m.moment ?? ""), idea: String(m.idea ?? "") }))
      : [],
  }))
  .handler(async ({ data, context }): Promise<GeneratedGuide> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return fallback;

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();

    const todayMeals = data.todayMeals;
    const dishesLine = todayMeals.length
      ? `Los platos reales de HOY (de su plan mensual, no te los inventes) son: ${todayMeals
          .map((m) => `${m.moment}: ${m.idea}`)
          .join("; ")}. Calcula "macroEstimate" a partir de estos platos concretos. `
      : 'No hay plan con platos para hoy todavía: deja "macroEstimate" en null. ';

    const ai = createAiProvider(key);
    try {
      const { text } = await generateText({
        model: ai(COACH_MODEL),
        system: coachSystemPrompt(profile as never),
        prompt:
          "Genera la guía de HOY. Devuelve solo JSON válido con esta forma: " +
          '{"intro": string (1 frase cálida y motivadora, sin presión), "calories": string (rango orientativo, nunca una cifra rígida), "macros": string (orientación de macros en una frase), ' +
          '"macroEstimate": null o {"kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number} (estimación aproximada del total del día — es una guía orientativa, no un conteo nutricional exacto, así que da tu mejor cálculo razonable), ' +
          '"behaviors": [3 hábitos concretos y cortos para hoy], "meals": [4 objetos {"moment": "Desayuno"|"Comida"|"Cena"|"Snack", "idea": plato sugerido concreto pero flexible, sin gramajes}], "tips": [3 consejos de nutrición prácticos y cortos, estilo "Bebe 2L de agua"]}. ' +
          dishesLine +
          "Adapta los platos a sus horarios, restricciones y vida real. Sin markdown, sin explicaciones.",
      });
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as GeneratedGuide;
      if (!parsed.behaviors?.length) return fallback;
      const rawMacro = parsed.macroEstimate as unknown;
      const macroEstimate: MacroEstimate | null =
        todayMeals.length && rawMacro && typeof rawMacro === "object"
          ? {
              kcal: num((rawMacro as Record<string, unknown>).kcal),
              protein_g: num((rawMacro as Record<string, unknown>).protein_g),
              carbs_g: num((rawMacro as Record<string, unknown>).carbs_g),
              fat_g: num((rawMacro as Record<string, unknown>).fat_g),
              fiber_g: num((rawMacro as Record<string, unknown>).fiber_g),
            }
          : null;
      return {
        intro: String(parsed.intro ?? fallback.intro),
        calories: String(parsed.calories ?? fallback.calories),
        macros: String(parsed.macros ?? fallback.macros),
        macroEstimate: macroEstimate?.kcal ? macroEstimate : null,
        behaviors: parsed.behaviors.slice(0, 3).map(String),
        meals: Array.isArray(parsed.meals)
          ? parsed.meals
              .slice(0, 4)
              .map((m) => ({ moment: String(m?.moment ?? ""), idea: String(m?.idea ?? "") }))
              .filter((m) => m.moment && m.idea)
          : fallback.meals,
        tips:
          Array.isArray(parsed.tips) && parsed.tips.length
            ? parsed.tips.slice(0, 4).map(String)
            : fallback.tips,
      };
    } catch (error) {
      console.error("generateDailyGuide", error);
      return fallback;
    }
  });
