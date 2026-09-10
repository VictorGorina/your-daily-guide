import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COACH_MODEL, coachSystemPrompt, createAiProvider } from "@/lib/ai-provider.server";
import { parseJsonLoose } from "@/lib/plan-shared";

/**
 * Estimación aproximada del total del día. Desde la Fase 2 de
 * `nutricion-determinista` se calcula sumando los ingredientes de los platos
 * reales contra la tabla de composición (`src/lib/nutrition/`), no pidiéndosela
 * al modelo — así el mismo plato da el mismo número cada día. Sigue siendo
 * orientativa por diseño: ver el aviso junto a la barra de macros en Hoy y en
 * la portada (index.tsx). El respaldo, si un plato no se puede descomponer, es
 * una estimación gruesa por tipo de comida (`roughMealMacros`), no el modelo.
 */
export type MacroEstimate = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

/** Estimación de macros de un plato concreto de hoy, para poder sumar solo
 * las comidas que la persona ya marcó como comidas (ver `mealMacros`). */
export type MealMacroEstimate = MacroEstimate & { moment: string };

export type GeneratedGuide = {
  intro: string;
  calories: string;
  macros: string;
  /** null cuando aún no hay platos reales de hoy (sin plan) de los que partir. */
  macroEstimate: MacroEstimate | null;
  /** Una estimación por cada plato real de hoy (mismo "moment" que en el plan),
   * para que la barra de macros de Hoy sume solo lo ya confirmado como comido
   * en vez de todo el menú del día de golpe. null en el mismo caso que
   * `macroEstimate`. */
  mealMacros: MealMacroEstimate[] | null;
  behaviors: string[];
  meals: { moment: string; idea: string }[];
  tips: string[];
};

const fallback: GeneratedGuide = {
  intro: "Hoy vamos a lo sencillo: comer con calma y moverte un poco.",
  calories: "Rango orientativo según tu día, sin obsesión por la cifra.",
  macros: "Prioriza proteína en cada comida, verdura en dos de ellas y grasas buenas.",
  macroEstimate: null,
  mealMacros: null,
  behaviors: ["Bebe agua antes de cada comida", "Come sin pantallas", "Camina 20 minutos"],
  meals: [
    { moment: "Desayuno", idea: "Yogur con fruta y un puñado de frutos secos" },
    { moment: "Comida", idea: "Pollo o legumbre con verduras asadas y arroz" },
    { moment: "Cena", idea: "Tortilla de verduras con ensalada" },
    { moment: "Merienda", idea: "Fruta de temporada o un puñado de almendras" },
  ],
  tips: [
    "Bebe unos 2 litros de agua a lo largo del día",
    "Empieza la comida por la verdura o la ensalada",
    "Deja 2-3 horas entre la cena y la cama",
  ],
};

/**
 * Respaldo cuando un plato no se puede descomponer en ingredientes: una
 * estimación gruesa por tipo de comida, para que la barra de macros de Hoy no
 * se quede a cero. Deliberadamente conservadora y redonda — es un suelo, no un
 * cálculo.
 */
const roughMealMacros = (moment: string): MacroEstimate => {
  const key = moment.toLowerCase();
  if (key.startsWith("desayuno"))
    return { kcal: 350, protein_g: 15, carbs_g: 45, fat_g: 12, fiber_g: 5 };
  if (key.startsWith("comida") || key.startsWith("almuerzo"))
    return { kcal: 600, protein_g: 35, carbs_g: 65, fat_g: 20, fiber_g: 9 };
  if (key.startsWith("cena"))
    return { kcal: 500, protein_g: 30, carbs_g: 50, fat_g: 18, fiber_g: 8 };
  if (key.startsWith("merienda") || key.startsWith("snack"))
    return { kcal: 200, protein_g: 8, carbs_g: 25, fat_g: 7, fiber_g: 3 };
  return { kcal: 450, protein_g: 22, carbs_g: 50, fat_g: 15, fiber_g: 6 };
};

const addMacros = (a: MacroEstimate, b: MacroEstimate): MacroEstimate => ({
  kcal: a.kcal + b.kcal,
  protein_g: a.protein_g + b.protein_g,
  carbs_g: a.carbs_g + b.carbs_g,
  fat_g: a.fat_g + b.fat_g,
  fiber_g: a.fiber_g + b.fiber_g,
});

/**
 * Macros del día por lookup de ingredientes (Fase 2). Para cada plato real de
 * hoy: descomponer en ingredientes con el modelo (una sola llamada para todos)
 * y sumar contra la tabla de composición. Si un plato no se resuelve con
 * garantías, ese momento cae a `roughMealMacros`. Nunca lanza.
 */
async function macrosFromLookup(
  todayMeals: { moment: string; idea: string }[],
  apiKey: string,
): Promise<{ macroEstimate: MacroEstimate; mealMacros: MealMacroEstimate[] }> {
  const { decomposeDishes } = await import("@/lib/nutrition/resolve-dish.server");
  const breakdowns = await decomposeDishes(
    todayMeals.map((m) => m.idea),
    { servings: 1, apiKey },
  );

  const mealMacros = todayMeals.map((meal): MealMacroEstimate => {
    const b = breakdowns.get(meal.idea.trim());
    const usable = b && b.source === "model" && b.perServing.kcal > 0 && b.quality >= 0.4;
    const macros = usable ? b.perServing : roughMealMacros(meal.moment);
    return { moment: meal.moment, ...macros };
  });

  const macroEstimate = mealMacros.reduce<MacroEstimate>(addMacros, {
    kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
  });
  return { macroEstimate, mealMacros };
}

export const generateDailyGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { meals?: { moment: string; idea: string }[] }) => ({
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

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "guide");

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();

    const todayMeals = data.todayMeals;
    const dishesLine = todayMeals.length
      ? `Los platos reales de HOY (de su plan mensual) son: ${todayMeals
          .map((m) => `${m.moment}: ${m.idea}`)
          .join("; ")}. Tenlos en cuenta al redactar, pero no los repitas en "meals". `
      : "Todavía no hay plan con platos para hoy. ";

    // Las macros salen del lookup de ingredientes, no de esta llamada (Fase 2).
    // Se hace en paralelo con el texto de la guía.
    const macrosPromise = todayMeals.length
      ? macrosFromLookup(todayMeals, key).catch((error) => {
          console.error("macrosFromLookup", error);
          return null;
        })
      : Promise.resolve(null);

    const ai = createAiProvider(key);
    try {
      const [{ text }, lookup] = await Promise.all([
        generateText({
          model: ai(COACH_MODEL),
          system: coachSystemPrompt(profile as never),
          prompt:
            "Genera la guía de HOY. Devuelve solo JSON válido con esta forma: " +
            '{"intro": string (1 frase cálida y motivadora, sin presión), "calories": string (rango orientativo, nunca una cifra rígida), "macros": string (orientación de macros en una frase), ' +
            '"behaviors": [3 hábitos concretos y cortos para hoy], "meals": [4 objetos {"moment": "Desayuno"|"Comida"|"Cena"|"Merienda", "idea": plato sugerido concreto pero flexible, sin gramajes}], "tips": [3 consejos de nutrición prácticos y cortos, estilo "Bebe 2L de agua"]}. ' +
            dishesLine +
            "Adapta los platos a sus horarios, restricciones y vida real. Sin markdown, sin explicaciones.",
        }),
        macrosPromise,
      ]);
      const parsed = parseJsonLoose(text) as GeneratedGuide;
      if (!parsed.behaviors?.length) return fallback;
      return {
        intro: String(parsed.intro ?? fallback.intro),
        calories: String(parsed.calories ?? fallback.calories),
        macros: String(parsed.macros ?? fallback.macros),
        macroEstimate: lookup?.macroEstimate.kcal ? lookup.macroEstimate : null,
        mealMacros: lookup?.mealMacros.length ? lookup.mealMacros : null,
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
