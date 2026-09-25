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
 * la portada (index.tsx). Un plato que no se ha podido descomponer NO lleva
 * cifras de respaldo (D13 de `precision-nutricional`): queda "calculando" y se
 * reintenta (ver `MealMacroEstimate.status`).
 */
export type MacroEstimate = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

/** Estimación de macros de un plato concreto de hoy, para poder sumar solo
 * las comidas que la persona ya marcó como comidas (ver `mealMacros`).
 * `idea` es el plato contra el que se calculó — permite detectar cuándo el
 * plan ya no coincide (un cambio del hogar espejado por detrás) y hace falta
 * regenerar en vez de seguir sumando kcal de un plato que ya no es ese. */
export type MealMacroEstimate = MacroEstimate & {
  moment: string;
  idea?: string;
  /**
   * Ticket 13 de `precision-nutricional` (D13): un plato sale de su receta
   * (`calculado`) o se está calculando (`calculando`, cifras a 0 que NO se
   * suman ni miden ningún desvío). No hay tercera opción: ningún promedio por
   * tipo de comida. Una guía guardada antes de este campo cuenta como
   * calculada. Ver `isMealCalculated` en `macros.ts`.
   */
  status?: "calculado" | "calculando";
  /** El texto no dice qué se comió: se le pregunta a la persona, no se reintenta. */
  vague?: boolean;
  /** La cifra la escribió la persona (texto vago en "comí distinto"): solo kcal. */
  manual?: boolean;
};

/** Macros de un plato suelto que se pidió aparte (`extraDishes`), p. ej. el del plan. */
export type DishMacros = MacroEstimate & { dish: string; status: "calculado" | "calculando" };

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
  /**
   * Objetivo del día (ticket 07 de `precision-nutricional`), calculado en
   * código con `energyTargets` y guardado en la guía: así el semáforo de un
   * día pasado se mide contra el objetivo que tenía ese día, no contra el de
   * hoy. `null` sin datos suficientes (o menor de 18).
   */
  targets?: MacroEstimate | null;
  behaviors: string[];
  meals: { moment: string; idea: string }[];
  tips: string[];
  /**
   * Macros de `extraDishes`, en el mismo orden. No se guarda en la guía: lo usa
   * el cambio de plato para medir contra el plato del plan cuando su cifra no
   * estaba calculada todavía.
   */
  dishMacros?: DishMacros[];
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

const ZERO: MacroEstimate = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

const addMacros = (a: MacroEstimate, b: MacroEstimate): MacroEstimate => ({
  kcal: a.kcal + b.kcal,
  protein_g: a.protein_g + b.protein_g,
  carbs_g: a.carbs_g + b.carbs_g,
  fat_g: a.fat_g + b.fat_g,
  fiber_g: a.fiber_g + b.fiber_g,
});

const num = (v: unknown, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0;
};

/** Una comida ya calculada que manda el cliente para no volver a descomponerla. */
type ReusedMeal = MealMacroEstimate & { idea: string };

const cleanReused = (raw: unknown): ReusedMeal | null => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const moment = String(o.moment ?? "").slice(0, 40);
  const idea = String(o.idea ?? "").slice(0, 200);
  if (!moment || !idea || o.status === "calculando") return null;
  return {
    moment,
    idea,
    kcal: num(o.kcal, 5000),
    protein_g: num(o.protein_g, 400),
    carbs_g: num(o.carbs_g, 800),
    fat_g: num(o.fat_g, 400),
    fiber_g: num(o.fiber_g, 200),
    status: "calculado",
    ...(o.manual === true ? { manual: true } : {}),
  };
};

/**
 * Macros del día por lookup de ingredientes (Fase 2). Para cada plato real de
 * hoy: descomponer en ingredientes con el modelo (una sola llamada para todos,
 * con la cadena de reintentos de `decomposeDishes`) y sumar contra la tabla de
 * composición. Un plato que la cadena no consigue calcular queda `calculando`,
 * sin cifras (D13): nunca un promedio. Nunca lanza.
 *
 * `reuse` son las comidas que el cliente ya tiene calculadas para ese mismo
 * plato: no se vuelven a pedir. Es lo que hace barato reintentar solo lo que
 * faltaba, o regenerar tras cambiar UN plato.
 */
async function macrosFromLookup(
  todayMeals: { moment: string; idea: string }[],
  reuse: ReusedMeal[],
  extraDishes: string[],
  apiKey: string,
  userId: string,
): Promise<{
  macroEstimate: MacroEstimate | null;
  mealMacros: MealMacroEstimate[];
  dishMacros: DishMacros[];
}> {
  const { decomposeDishes, isCalculated } = await import("@/lib/nutrition/resolve-dish.server");
  const { normName } = await import("@/lib/plan-shared");
  const reusedFor = (meal: { moment: string; idea: string }) =>
    reuse.find((r) => r.moment === meal.moment && normName(r.idea) === normName(meal.idea));

  const toDecompose = [
    ...todayMeals.filter((m) => !reusedFor(m)).map((m) => m.idea),
    ...extraDishes,
  ];
  const breakdowns = toDecompose.length
    ? await decomposeDishes(toDecompose, { servings: 1, apiKey, userId })
    : new Map();

  const mealMacros = todayMeals.map((meal): MealMacroEstimate => {
    const reused = reusedFor(meal);
    if (reused) return { ...reused, moment: meal.moment, idea: meal.idea };
    const b = breakdowns.get(meal.idea.trim());
    if (isCalculated(b)) {
      return { moment: meal.moment, idea: meal.idea, ...b.perServing, status: "calculado" };
    }
    return {
      moment: meal.moment,
      idea: meal.idea,
      ...ZERO,
      status: "calculando",
      ...(b?.vague ? { vague: true } : {}),
    };
  });

  const dishMacros = extraDishes.map((dish): DishMacros => {
    const b = breakdowns.get(dish.trim());
    return isCalculated(b)
      ? { dish, ...b.perServing, status: "calculado" }
      : { dish, ...ZERO, status: "calculando" };
  });

  const calculated = mealMacros.filter((m) => m.status !== "calculando");
  const macroEstimate = calculated.length
    ? calculated.reduce<MacroEstimate>(addMacros, { ...ZERO })
    : null;
  return { macroEstimate, mealMacros, dishMacros };
}

export const generateDailyGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input?: {
      meals?: { moment: string; idea: string }[];
      /** Comidas ya calculadas (ver `macrosFromLookup`). */
      reuse?: MealMacroEstimate[];
      /** Solo las cifras, sin el texto: el reintento de lo que quedó "calculando". */
      macrosOnly?: boolean;
      /** Platos sueltos a calcular además de los de hoy (ver `dishMacros`). */
      extraDishes?: string[];
    }) => ({
      // Los platos reales del plan de hoy (no los que la guía se inventa en su
      // propio campo "meals"), para que la estimación de macros parta de lo que
      // la persona va a comer de verdad. Como mucho 6: es contexto, no una lista
      // a repetir en la respuesta.
      todayMeals: Array.isArray(input?.meals)
        ? input.meals
            .filter((m) => m?.idea)
            .slice(0, 6)
            .map((m) => ({
              moment: String(m.moment ?? "").slice(0, 40),
              idea: String(m.idea ?? "").slice(0, 200),
            }))
        : [],
      reuse: (Array.isArray(input?.reuse) ? input.reuse : [])
        .slice(0, 6)
        .map(cleanReused)
        .filter((m): m is ReusedMeal => !!m),
      macrosOnly: input?.macrosOnly === true,
      extraDishes: (Array.isArray(input?.extraDishes) ? input.extraDishes : [])
        .map((d) =>
          String(d ?? "")
            .trim()
            .slice(0, 200),
        )
        .filter(Boolean)
        .slice(0, 4),
    }),
  )
  .handler(async ({ data, context }): Promise<GeneratedGuide> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return fallback;

    // El tope DIARIO de gasto no corta la guía en la entrada (el mensual sí):
    // sus cifras son la descomposición de platos, que no puede quedarse sin
    // calcular por él (D13). El texto sí lo respeta: su propia llamada al
    // modelo va con el alcance normal y, al llegar al tope, cae al respaldo.
    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "guide", "month");

    const todayMeals = data.todayMeals;
    // Las macros salen del lookup de ingredientes, no del texto (Fase 2). Se
    // hace en paralelo con el texto de la guía.
    const macrosPromise =
      todayMeals.length || data.extraDishes.length
        ? macrosFromLookup(todayMeals, data.reuse, data.extraDishes, key, context.userId).catch(
            (error) => {
              console.error("macrosFromLookup", error);
              return null;
            },
          )
        : Promise.resolve(null);

    /** Las cifras del lookup se pegan a cualquier texto, propio o de respaldo. */
    const withMacros = (
      base: GeneratedGuide,
      lookup: Awaited<typeof macrosPromise>,
    ): GeneratedGuide => ({
      ...base,
      calories,
      targets,
      macroEstimate: lookup?.macroEstimate ?? null,
      mealMacros: lookup?.mealMacros.length ? lookup.mealMacros : null,
      ...(lookup?.dishMacros.length ? { dishMacros: lookup.dishMacros } : {}),
    });

    if (data.macrosOnly) return withMacros(fallback, await macrosPromise);

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();

    // Una sola cifra de objetivo en toda la app (ticket 07): el texto de
    // calorías lo escribe el código a partir de `energyTargets`, nunca el
    // modelo, que antes ponía su propio rango al lado de la barra (H13).
    const { energyTargets, caloriesText, targetsAsMacros } = await import("@/lib/nutrition/energy");
    const { showsNutritionNumbers } = await import("@/lib/macros");
    const energy = energyTargets(profile as never);
    const targets = energy ? targetsAsMacros(energy) : null;
    const calories = caloriesText(energy, showsNutritionNumbers(profile as never));

    const dishesLine = todayMeals.length
      ? `Los platos reales de HOY (de su plan mensual) son: ${todayMeals
          .map((m) => `${m.moment}: ${m.idea}`)
          .join("; ")}. Tenlos en cuenta al redactar, pero no los repitas en "meals". `
      : "Todavía no hay plan con platos para hoy. ";

    const ai = createAiProvider(key, context.userId);
    // El texto no puede tumbar las macros. Antes ambas llamadas compartían un
    // solo `try`, así que un fallo del texto (o del tope de gasto, o un corte
    // por tiempo del modelo) devolvía el `fallback` entero y se tiraban unas
    // macros que ya estaban calculadas: la barra de Hoy se quedaba a cero y solo
    // el botón manual "Generar" la recuperaba. Ahora cada mitad falla por su
    // cuenta y se devuelve lo que sí haya salido.
    const textPromise = generateText({
      model: ai(COACH_MODEL),
      system: coachSystemPrompt(profile as never),
      prompt:
        "Genera la guía de HOY. Devuelve solo JSON válido con esta forma: " +
        '{"intro": string (1 frase cálida y motivadora, sin presión), "macros": string (orientación de macros en una frase, sin cifras), ' +
        '"behaviors": [3 hábitos concretos y cortos para hoy], "meals": [4 objetos {"moment": "Desayuno"|"Comida"|"Cena"|"Merienda", "idea": plato sugerido concreto pero flexible, sin gramajes}], "tips": [3 consejos de nutrición prácticos y cortos, estilo "Bebe 2L de agua"]}. ' +
        dishesLine +
        "Adapta los platos a sus horarios, restricciones y vida real. Sin markdown, sin explicaciones.",
    }).then(
      ({ text }) => text,
      (error: unknown) => {
        console.error("generateDailyGuide text", error);
        return null;
      },
    );

    const [text, lookup] = await Promise.all([textPromise, macrosPromise]);

    let parsed: GeneratedGuide | null = null;
    if (text) {
      try {
        parsed = parseJsonLoose(text) as GeneratedGuide;
      } catch (error) {
        console.error("generateDailyGuide parse", error);
      }
    }
    if (!parsed?.behaviors?.length) return withMacros(fallback, lookup);

    return withMacros(
      {
        ...fallback,
        intro: String(parsed.intro ?? fallback.intro),
        macros: String(parsed.macros ?? fallback.macros),
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
      },
      lookup,
    );
  });
