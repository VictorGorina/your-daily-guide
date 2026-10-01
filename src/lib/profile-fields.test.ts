import { describe, expect, test } from "bun:test";

import {
  profilePatchFromTool,
  profileToolResult,
  SENSITIVE_PROFILE_FIELDS,
  sensitiveChanges,
  sensitiveConfirmCopy,
  splitProfilePatch,
} from "./profile-fields";

describe("profilePatchFromTool", () => {
  test("se queda con lo válido de cada tipo y descarta lo demás", () => {
    const { patch, invalid } = profilePatchFromTool({
      meals_per_day: "3",
      morning_time: "08:30",
      evening_time: "25:00",
      nutrition_numbers: "No, prefiero no verlas",
      tone: "  exigente ",
      height_cm: 999,
      restrictions: "",
      current_weight_kg: 70, // tiene su propia herramienta
      inventado: "x",
    });
    expect(patch).toEqual({
      meals_per_day: 3,
      morning_time: "08:30",
      nutrition_numbers: "ocultar",
      tone: "exigente",
    });
    expect(invalid).toEqual([
      "Altura («999»; entre 100 y 250 cm)",
      "Repaso de la noche («25:00»; hora HH:MM)",
    ]);
  });

  test("un chip con valueMap que no es ni etiqueta ni valor se descarta", () => {
    expect(profilePatchFromTool({ nutrition_numbers: "a veces" }).patch).toEqual({});
  });

  test("un chip sin valueMap solo acepta una de sus opciones, en su forma canónica", () => {
    // El modelo mandó «Primer trimestre» en una prueba real: guardado tal cual,
    // el perfil decía embarazo pero las reglas del prompt (que miran
    // "embarazada") no se aplicaban.
    const rejected = profilePatchFromTool({ pregnancy_status: "Primer trimestre" });
    expect(rejected.patch).toEqual({});
    expect(rejected.invalid).toEqual([
      "Embarazo o lactancia («Primer trimestre»; valores válidos: no, embarazada, lactancia, prefiero no decirlo)",
    ]);
    expect(profilePatchFromTool({ pregnancy_status: " Embarazada " }).patch).toEqual({
      pregnancy_status: "embarazada",
    });
    expect(profilePatchFromTool({ ed_history: "a veces" }).patch).toEqual({});
    expect(profilePatchFromTool({ tone: "EXIGENTE" }).patch).toEqual({ tone: "exigente" });
  });
});

describe("splitProfilePatch", () => {
  test("separa lo sensible de lo normal", () => {
    const { sensitive, normal } = splitProfilePatch({
      meals_per_day: 3,
      pregnancy_status: "embarazada",
      medications: "levotiroxina",
      tone: "relajado",
    });
    expect(sensitive).toEqual({ pregnancy_status: "embarazada", medications: "levotiroxina" });
    expect(normal).toEqual({ meals_per_day: 3, tone: "relajado" });
  });

  test("la lista sensible es la del ticket 31 (sin goal_type, que no es un campo)", () => {
    expect([...SENSITIVE_PROFILE_FIELDS].map(String).sort()).toEqual(
      [
        "allergy_severity",
        "diet_pattern",
        "ed_history",
        "medical_conditions",
        "medications",
        "nutrition_numbers",
        "pregnancy_status",
        "restrictions",
        "target_weight_kg",
      ].sort(),
    );
  });
});

describe("sensitiveChanges", () => {
  test("cada campo con su etiqueta, el valor de antes y el nuevo, en lenguaje claro", () => {
    const lines = sensitiveChanges(
      { pregnancy_status: "embarazada", nutrition_numbers: "ocultar", target_weight_kg: 62 },
      { pregnancy_status: "no", nutrition_numbers: "mostrar", target_weight_kg: null },
    );
    expect(lines).toEqual([
      { key: "pregnancy_status", label: "Embarazo o lactancia", before: "no", after: "embarazada" },
      {
        key: "nutrition_numbers",
        label: "Ver calorías y macros",
        before: "Sí, enséñamelas",
        after: "No, prefiero no verlas",
      },
      { key: "target_weight_kg", label: "Peso objetivo", before: "sin dato", after: "62 kg" },
    ]);
  });

  test("sin perfil cargado, lo de antes sale como «sin dato»", () => {
    expect(sensitiveChanges({ medications: "x" }, null)[0]?.before).toBe("sin dato");
  });
});

describe("profileToolResult", () => {
  test("todo guardado", () => {
    expect(profileToolResult(["Comidas al día"], [], [])).toBe(
      "Perfil actualizado: Comidas al día.",
    );
  });

  test("lo sensible no confirmado: el modelo sabe que no debe insistir", () => {
    const text = profileToolResult(["Tono del coach"], ["Medicación"], []);
    expect(text).toContain("Perfil actualizado: Tono del coach.");
    expect(text).toContain("Medicación");
    expect(text).toContain("ha elegido no guardar");
    expect(text).toContain("No insistas");
  });

  test("nada guardado porque no confirmó", () => {
    const text = profileToolResult([], ["Embarazo o lactancia"], []);
    expect(text).not.toContain("Perfil actualizado");
    expect(text).toContain("Embarazo o lactancia");
    expect(text).toContain("No insistas");
  });
});

describe("profileToolResult con valores no válidos", () => {
  test("dice qué no se guardó y con qué valores reintentar; nunca que está guardado", () => {
    const text = profileToolResult(
      [],
      [],
      ["Embarazo o lactancia («Primer trimestre»; valores válidos: no, embarazada)"],
    );
    expect(text).not.toContain("Perfil actualizado");
    expect(text).toContain("«Primer trimestre»");
    expect(text).toContain("valores válidos");
    expect(text).toContain("No digas que está guardado");
  });

  test("sin nada guardado, rechazado ni inválido", () => {
    expect(profileToolResult([], [], [])).toBe(
      "No había ningún dato válido que actualizar en el perfil.",
    );
  });
});

describe("sensitiveConfirmCopy", () => {
  const change = (key: string, label: string) => ({ key, label, before: "no", after: "sí" });

  test("una línea por cambio y los dos botones", () => {
    const copy = sensitiveConfirmCopy([change("medications", "Medicación")]);
    expect(copy.title).toBe("¿Guardo este cambio en tu perfil?");
    expect(copy.lines).toEqual(["Medicación: no → sí"]);
    expect(copy.note).toBeNull();
    expect(copy.confirm).toBe("Guardar");
    expect(copy.cancel).toBe("No, déjalo como estaba");
  });

  test("varios cambios en plural; con las cifras, recuerda que se cambia en Ajustes", () => {
    const copy = sensitiveConfirmCopy([
      change("medications", "Medicación"),
      change("nutrition_numbers", "Ver calorías y macros"),
    ]);
    expect(copy.title).toBe("¿Guardo estos cambios en tu perfil?");
    expect(copy.lines).toHaveLength(2);
    expect(copy.note).toContain("Ajustes");
  });
});
