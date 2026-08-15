import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COACH_MODEL, coachSystemPrompt, createAiProvider } from "@/lib/ai-provider.server";

export type GeneratedGuide = {
  intro: string;
  calories: string;
  macros: string;
  behaviors: string[];
  meals: { moment: string; idea: string }[];
  tips: string[];
};

const fallback: GeneratedGuide = {
  intro: "Hoy vamos a lo sencillo: comer con calma y moverte un poco.",
  calories: "Rango orientativo según tu día, sin obsesión por la cifra.",
  macros: "Prioriza proteína en cada comida, verdura en dos de ellas y grasas buenas.",
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

export const generateDailyGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GeneratedGuide> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return fallback;

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();

    const ai = createAiProvider(key);
    try {
      const { text } = await generateText({
        model: ai(COACH_MODEL),
        system: coachSystemPrompt(profile as never),
        prompt:
          "Genera la guía de HOY. Devuelve solo JSON válido con esta forma: " +
          '{"intro": string (1 frase cálida y motivadora, sin presión), "calories": string (rango orientativo, nunca una cifra rígida), "macros": string (orientación de macros en una frase), "behaviors": [3 hábitos concretos y cortos para hoy], "meals": [4 objetos {"moment": "Desayuno"|"Comida"|"Cena"|"Snack", "idea": plato sugerido concreto pero flexible, sin gramajes}], "tips": [3 consejos de nutrición prácticos y cortos, estilo "Bebe 2L de agua"]}. ' +
          "Adapta los platos a sus horarios, restricciones y vida real. Sin markdown, sin explicaciones.",
      });
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as GeneratedGuide;
      if (!parsed.behaviors?.length) return fallback;
      return {
        intro: String(parsed.intro ?? fallback.intro),
        calories: String(parsed.calories ?? fallback.calories),
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
      };
    } catch (error) {
      console.error("generateDailyGuide", error);
      return fallback;
    }
  });
