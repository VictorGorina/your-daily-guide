import { describe, expect, it } from "bun:test";

import {
  EXERCISE_ACK_PREFIX,
  exerciseAckMessage,
  exerciseToolResult,
  LOGGED_ACK_METADATA,
  loggedAckKind,
  SNACK_ACK_PREFIX,
  snackAckMessage,
} from "./day-log-ack";

const run = { activity: "Correr", minutes: 30, intensity: "Normal", kcal: -300 };
const snack = { text: "Un puñado de frutos secos", kcal: 178.4 };

describe("exerciseAckMessage", () => {
  it("cuenta la sesión con la cifra que entra en el balance del día", () => {
    expect(exerciseAckMessage(run, true)).toBe(
      "He registrado deporte: correr 30 min, intensidad normal (≈ 300 kcal de gasto extra).",
    );
  });

  it("sin cifra con la preferencia de no verlas", () => {
    expect(exerciseAckMessage(run, false)).toBe(
      "He registrado deporte: correr 30 min, intensidad normal.",
    );
  });

  it("sin cifra cuando no hay gasto extra (sesión de la rutina, ya en el objetivo)", () => {
    expect(exerciseAckMessage({ ...run, kcal: 0 }, true)).toBe(
      "He registrado deporte: correr 30 min, intensidad normal.",
    );
  });

  it("empieza por el prefijo que el prompt del coach reconoce en el historial", () => {
    expect(exerciseAckMessage(run, true).startsWith(EXERCISE_ACK_PREFIX)).toBe(true);
  });

  it("no pide al coach que ajuste nada", () => {
    expect(exerciseAckMessage(run, true)).not.toMatch(/ajusta|compensa|kcal_extra/i);
  });
});

describe("snackAckMessage", () => {
  it("cuenta el picoteo con su cifra redondeada", () => {
    expect(snackAckMessage(snack, true)).toBe(
      "He apuntado un picoteo: Un puñado de frutos secos (≈ 178 kcal).",
    );
  });

  it("sin cifra con la preferencia de no verlas", () => {
    expect(snackAckMessage(snack, false)).toBe(
      "He apuntado un picoteo: Un puñado de frutos secos.",
    );
  });

  it("sin cifra si no suma nada (un refresco sin azúcar)", () => {
    expect(snackAckMessage({ ...snack, kcal: 0 }, true)).toBe(
      "He apuntado un picoteo: Un puñado de frutos secos.",
    );
  });

  it("empieza por el prefijo que el prompt reconoce y no pide ajustar", () => {
    const text = snackAckMessage(snack, true);
    expect(text.startsWith(SNACK_ACK_PREFIX)).toBe(true);
    expect(text).not.toMatch(/ajusta|compensa|kcal_extra/i);
  });
});

describe("exerciseToolResult", () => {
  it("dice qué ha quedado apuntado y que no toca reajustar a mano", () => {
    const text = exerciseToolResult(run, true);
    expect(text).toContain("correr 30 min, intensidad normal (≈ 300 kcal de gasto extra)");
    expect(text).toContain("No llames a ajustar_plan_mensual");
  });

  it("sin cifra con la preferencia de no verlas", () => {
    expect(exerciseToolResult(run, false)).not.toMatch(/kcal/);
  });
});

describe("loggedAckKind", () => {
  it("reconoce las dos marcas del registro guiado", () => {
    expect(loggedAckKind(LOGGED_ACK_METADATA.exercise)).toBe("exercise");
    expect(loggedAckKind(LOGGED_ACK_METADATA.snack)).toBe("snack");
    expect(loggedAckKind({ ...LOGGED_ACK_METADATA.snack, other: 1 })).toBe("snack");
  });

  it("un mensaje sin marca, u otra marca, no lo es", () => {
    expect(loggedAckKind(undefined)).toBeNull();
    expect(loggedAckKind(null)).toBeNull();
    expect(loggedAckKind("exercise")).toBeNull();
    expect(loggedAckKind({ logged: "weight" })).toBeNull();
  });
});
