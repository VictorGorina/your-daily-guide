import { describe, expect, it } from "bun:test";

import en from "@/locales/en.json";
import es from "@/locales/es.json";

import {
  BIO_Q,
  BUDGET_Q,
  buildFlat,
  chipsOfAnswer,
  displayQuestion,
  errorKey,
  formatDatePretty,
  hintKey,
  MEALS_TO_PLAN_Q,
  mealSlotsFromAnswer,
  nutritionNumbersFromAnswer,
  parseBiometrics,
  parseDatePretty,
  PARTNER_APP_Q,
  partnerUsesApp,
  PREGNANCY_Q,
  type Question,
  SCREENS,
} from "./onboarding-script";

type Copy = { text?: string; hint?: string; hintTyped?: string; chips?: Record<string, string> };
const CATALOGS: [string, Record<string, Copy>][] = [
  ["es", es.onboarding.q as unknown as Record<string, Copy>],
  ["en", en.onboarding.q as unknown as Record<string, Copy>],
];

/** Todas las preguntas del guion, con sus follow-ups y la variante de presupuesto. */
const allQuestions = (): Question[] => {
  const out: Question[] = [];
  const walk = (q: Question) => {
    out.push(q);
    if (q.followUp) walk(q.followUp.question);
  };
  SCREENS.forEach((screen) => screen.questions.forEach(walk));
  out.push(displayQuestion(BUDGET_Q, false));
  return out;
};

const keyOf = (q: Question, answers: Record<string, string> = {}) =>
  buildFlat(answers).find((n) => n.q === q)!.key;

describe("guion del onboarding · catálogo", () => {
  it("cada pregunta, ayuda y chip tiene texto en los dos idiomas", () => {
    for (const [lang, copy] of CATALOGS) {
      for (const q of allQuestions()) {
        const entry = copy[q.id];
        expect(entry?.text, `${lang}: ${q.id}.text`).toBeTruthy();
        expect(!!entry?.hint, `${lang}: ${q.id}.hint`).toBe(!!q.hint);
        if (q.dateInput) expect(entry?.hintTyped, `${lang}: ${q.id}.hintTyped`).toBeTruthy();
        const chips = q.literalChips ? [] : (q.chips ?? []);
        expect(Object.keys(entry?.chips ?? {}), `${lang}: ${q.id}.chips`).toEqual([...chips]);
      }
    }
  });

  it("el catálogo no tiene preguntas que el guion ya no usa", () => {
    const ids = allQuestions()
      .map((q) => q.id)
      .sort();
    for (const [, copy] of CATALOGS) expect(Object.keys(copy).sort()).toEqual(ids);
  });

  it("cada pantalla tiene título y subtítulo", () => {
    for (const catalog of [es, en]) {
      expect(Object.keys(catalog.onboarding.screens)).toEqual(SCREENS.map((s) => s.id));
    }
  });

  it("un chip de selección múltiple no lleva comas: la respuesta se parte por ellas", () => {
    for (const [lang, copy] of CATALOGS) {
      for (const q of allQuestions().filter((q) => q.multi)) {
        for (const label of Object.values(copy[q.id]!.chips ?? {})) {
          expect(label.includes(","), `${lang}: ${q.id} "${label}"`).toBe(false);
        }
      }
    }
  });

  it("la fecha tecleada tiene su propia ayuda y su propio error", () => {
    const birthdate = SCREENS[0]!.questions[1]!;
    expect(hintKey(birthdate)).toBe("onboarding.q.birthdate.hint");
    expect(hintKey(birthdate, true)).toBe("onboarding.q.birthdate.hintTyped");
    expect(hintKey(BIO_Q, true)).toBe("onboarding.q.bio.hint");
    expect(hintKey(MEALS_TO_PLAN_Q)).toBeNull();
    expect(errorKey("dobFormat", true)).toBe("onboarding.errors.dobFormatTyped");
    expect(errorKey("dobAge", true)).toBe("onboarding.errors.dobAge");
  });
});

describe("chipsOfAnswer", () => {
  it("reconoce la etiqueta en cualquiera de los idiomas", () => {
    expect(chipsOfAnswer(MEALS_TO_PLAN_Q, "Comida, Cena")).toEqual(["lunch", "dinner"]);
    expect(chipsOfAnswer(MEALS_TO_PLAN_Q, "Lunch, Dinner")).toEqual(["lunch", "dinner"]);
    expect(chipsOfAnswer(MEALS_TO_PLAN_Q, "cena,desayuno")).toEqual(["breakfast", "dinner"]);
  });

  it("una etiqueta de un solo chip puede llevar comas", () => {
    expect(chipsOfAnswer(PREGNANCY_Q, "Sí, embarazada")).toEqual(["pregnant"]);
    expect(chipsOfAnswer(PREGNANCY_Q, "Yes, breastfeeding")).toEqual(["breastfeeding"]);
  });

  it("un texto libre no elige ningún chip", () => {
    expect(chipsOfAnswer(MEALS_TO_PLAN_Q, "las de entre semana")).toEqual([]);
    expect(chipsOfAnswer(MEALS_TO_PLAN_Q, undefined)).toEqual([]);
    expect(chipsOfAnswer(BIO_Q, "mujer, 60 kg, 165 cm")).toEqual([]);
  });

  it("los chips numéricos son su propia etiqueta", () => {
    const mealsPerDay = SCREENS[1]!.questions[2]!;
    expect(chipsOfAnswer(mealsPerDay, "3")).toEqual(["3"]);
  });
});

describe("lo que se guarda sale del chip, en español canónico", () => {
  it("meal_slots", () => {
    expect(mealSlotsFromAnswer("Desayuno, Comida, Cena, Merienda")).toEqual([
      "desayuno",
      "comida",
      "cena",
      "snack",
    ]);
    expect(mealSlotsFromAnswer("Breakfast, Snack")).toEqual(["desayuno", "snack"]);
    expect(mealSlotsFromAnswer("lo que tú veas")).toBeNull();
    expect(mealSlotsFromAnswer(undefined)).toBeNull();
  });

  it("nutrition_numbers", () => {
    expect(nutritionNumbersFromAnswer("Sí, enséñamelas")).toBe("mostrar");
    expect(nutritionNumbersFromAnswer("No, I'd rather not see them")).toBe("ocultar");
    expect(nutritionNumbersFromAnswer("no sé")).toBeUndefined();
    expect(nutritionNumbersFromAnswer(undefined)).toBeUndefined();
  });
});

describe("buildFlat", () => {
  it("las claves no se mueven: un progreso guardado sigue apuntando a su pregunta", () => {
    expect(buildFlat({}).map((n) => `${n.key}:${n.q.id}`)).toEqual([
      "0-0:name",
      "0-1:birthdate",
      "0-2:bio",
      "0-3:medical",
      "0-4:smoking",
      "0-5:allergies",
      "1-0:activity",
      "1-1:schedule",
      "1-2:mealsPerDay",
      "1-3:mealsToPlan",
      "2-0:cooking",
      "2-1:kitchen",
      "2-2:cookingSkill",
      "2-3:dietPattern",
      "2-4:foods",
      "2-5:cuisine",
      "2-6:alcohol",
      "2-7:foodRelationship",
      "2-8:edHistory",
      "3-0:livesWith",
      "3-1:kids",
      "3-2:othersDiet",
      "3-3:portions",
      "4-0:targetWeight",
      "4-1:numbers",
      "4-2:deadline",
      "4-3:scope",
      "4-4:struggles",
      "4-5:budget",
      "5-0:tone",
      "5-1:times",
    ]);
  });

  it("marca la última pregunta de cada pantalla", () => {
    const last = buildFlat({})
      .filter((n) => n.lastOfScreen)
      .map((n) => n.q.id);
    expect(last).toEqual(["allergies", "mealsToPlan", "edHistory", "portions", "budget", "times"]);
  });

  const followUps = (answers: Record<string, string>) =>
    buildFlat(answers)
      .filter((n) => n.isFollowUp)
      .map((n) => n.q.id);

  it("encadena embarazo y ciclo solo a quien se identifica como mujer", () => {
    const bio = keyOf(BIO_Q);
    expect(followUps({ [bio]: "hombre, 78 kg, 172 cm" })).toEqual([]);
    expect(followUps({ [bio]: "mujer, 60 kg, 165 cm" })).toEqual(["pregnancy"]);
    expect(followUps({ [bio]: "Female, 60 kg, 165 cm" })).toEqual(["pregnancy"]);
    expect(followUps({ [bio]: "mujer, 60 kg", [`${bio}>fu`]: "No" })).toEqual([
      "pregnancy",
      "cycle",
    ]);
    expect(followUps({ [bio]: "mujer, 60 kg", [`${bio}>fu`]: "Prefiero no decirlo" })).toEqual([
      "pregnancy",
      "cycle",
    ]);
    for (const answer of [
      "Sí, embarazada",
      "Yes, breastfeeding",
      "estoy embarazada de 5 meses",
      "I'm pregnant",
    ]) {
      expect(followUps({ [bio]: "mujer, 60 kg", [`${bio}>fu`]: answer })).toEqual(["pregnancy"]);
    }
  });

  it("pregunta la gravedad solo si hay alergias", () => {
    for (const none of ["ninguna", "No", "nada", "None", "nothing really"]) {
      expect(followUps({ "0-5": none })).toEqual([]);
    }
    expect(followUps({ "0-5": "marisco y lactosa" })).toEqual(["allergySeverity"]);
    expect(followUps({ "0-5": "nuts" })).toEqual(["allergySeverity"]);
  });

  it("pregunta por la app de la pareja si se la menciona", () => {
    expect(followUps({ "3-0": "vivo solo" })).toEqual([]);
    expect(followUps({ "3-0": "vivo con mi pareja" })).toEqual(["partnerApp"]);
    expect(followUps({ "3-0": "I live with my wife and two kids" })).toEqual(["partnerApp"]);
  });

  it("pregunta la experiencia de fuerza si el objetivo habla de músculo", () => {
    expect(followUps({ "4-0": "75 kg" })).toEqual([]);
    expect(followUps({ "4-0": "80 kg, quiero ganar músculo" })).toEqual(["trainingExperience"]);
    expect(followUps({ "4-0": "80 kg, I want to build muscle" })).toEqual(["trainingExperience"]);
  });
});

describe("presupuesto de la casa", () => {
  it("partnerUsesApp lee el chip o un sí/no al principio", () => {
    expect(partnerUsesApp(undefined)).toBeNull();
    expect(partnerUsesApp("Sí, también la usará")).toBe(true);
    expect(partnerUsesApp("No, de momento no")).toBe(false);
    expect(partnerUsesApp("Yes, they'll use it too")).toBe(true);
    expect(partnerUsesApp("No, not for now")).toBe(false);
    expect(partnerUsesApp("sí")).toBe(true);
    expect(partnerUsesApp("no creo")).toBe(false);
    expect(partnerUsesApp("nosotros compartimos cuenta")).toBeNull();
    expect(partnerUsesApp("ya veremos")).toBeNull();
  });

  it("solo cambia la pregunta de presupuesto, y solo si la pareja no usa la app", () => {
    expect(displayQuestion(BUDGET_Q, false).id).toBe("budgetHousehold");
    expect(displayQuestion(BUDGET_Q, true)).toBe(BUDGET_Q);
    expect(displayQuestion(BUDGET_Q, null)).toBe(BUDGET_Q);
    expect(displayQuestion(PARTNER_APP_Q, false)).toBe(PARTNER_APP_Q);
  });
});

describe("respuestas libres", () => {
  it("parseBiometrics lee peso y altura con o sin unidades, en los dos idiomas", () => {
    expect(parseBiometrics("hombre, 78 kg, 172 cm")).toEqual({
      age: null,
      weight: 78,
      height: 172,
    });
    expect(parseBiometrics("mujer 34 años 61,5 kilos 1,65 m")).toEqual({
      age: 34,
      weight: 61.5,
      height: 165,
    });
    expect(parseBiometrics("male, 40 years, 82 kilograms, 180 centimetres")).toEqual({
      age: 40,
      weight: 82,
      height: 180,
    });
    expect(parseBiometrics("78 172")).toEqual({ age: null, weight: 78, height: 172 });
  });

  it("los validadores devuelven la clave del error, no el texto", () => {
    expect(BIO_Q.validate!("hombre")).toBe("bioBoth");
    expect(BIO_Q.validate!("hombre, 172 cm")).toBe("bioWeight");
    expect(BIO_Q.validate!("hombre, 78 kg")).toBe("bioHeight");
    expect(BIO_Q.validate!("hombre, 78 kg, 172 cm")).toBeNull();

    const [, birthdate] = SCREENS[0]!.questions;
    expect(birthdate!.validate!("16/06/1990")).toBe("dobFormat");
    expect(birthdate!.validate!("1890-06-16")).toBe("dobAge");
    expect(birthdate!.validate!("1990-06-16")).toBeNull();

    const mealsPerDay = SCREENS[1]!.questions[2]!;
    expect(mealsPerDay.validate!("muchas")).toBe("meals");
    expect(mealsPerDay.validate!("3")).toBeNull();

    const times = SCREENS[5]!.questions[1]!;
    expect(times.validate!("a las 8")).toBe("times");
    expect(times.validate!("a las 8:00 y a las 22:00")).toBeNull();
    expect(times.validate!("at 8am and 10pm")).toBeNull();
  });

  it("la fecha va y vuelve entre ISO y DD/MM/AAAA", () => {
    expect(formatDatePretty("1990-06-16")).toBe("16/06/1990");
    expect(parseDatePretty("16/06/1990")).toBe("1990-06-16");
    expect(parseDatePretty("6-6-1990")).toBe("1990-06-06");
    expect(parseDatePretty("1990.06.16")).toBe("1990-06-16");
    expect(parseDatePretty("junio")).toBeNull();
  });
});
