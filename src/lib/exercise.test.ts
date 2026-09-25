import { describe, expect, it } from "bun:test";

import {
  cleanDayExercise,
  estimateExerciseKcal,
  isoWeekDaysUntil,
  onlyRoutineExercise,
  pendingExerciseKcal,
  routineSessionsIn,
  splitRoutineSession,
  type DayExercise,
} from "./exercise";
import { parseTraining } from "./nutrition/exercise-energy";

describe("estimateExerciseKcal — neto y con el peso (ticket 16, H20)", () => {
  it("30 min de correr: el doble a 100 kg que a 50 kg, y neto (sin el reposo)", () => {
    const light = estimateExerciseKcal("Correr", 30, "Normal", 50);
    const heavy = estimateExerciseKcal("Correr", 30, "Normal", 100);
    // (MET 9 − 1) × kg × 0,5 h. El ticket daba ~220/~440 con MET 9,8, a verificar;
    // la tabla del 07 usa 9 (Compendio, carrera genérica).
    expect(light).toBe(200);
    expect(heavy).toBe(400);
  });

  it("sin peso usa 70 kg", () => {
    expect(estimateExerciseKcal("Caminar", 60, "Normal", null)).toBe(
      estimateExerciseKcal("Caminar", 60, "Normal", 70),
    );
  });
});

describe("splitRoutineSession — la rutina no se compensa dos veces (D9)", () => {
  const routine = parseTraining("3 × 45 min · Gimnasio / pesas · Normal");
  const gym = (minutes: number, before: number) =>
    splitRoutineSession({
      activity: "Gimnasio / pesas",
      minutes,
      intensity: "Normal",
      weightKg: 80,
      routine,
      routineSessionsBefore: before,
    });

  it("las sesiones 1-3 de la semana no desvían el día; la 4.ª sí, entera", () => {
    for (const before of [0, 1, 2]) {
      const s = gym(45, before);
      expect(s.routine).toBe(true);
      expect(s.extraKcal).toBe(0);
      expect(s.routineIndex).toBe(before + 1);
      expect(s.routineOf).toBe(3);
    }
    const fourth = gym(45, 3);
    expect(fourth.routine).toBe(false);
    expect(fourth.extraKcal).toBe(fourth.totalKcal);
    expect(fourth.extraKcal).toBeGreaterThan(0);
  });

  it("una sesión de 90 min con una rutina de 45 cuenta 45 min de extra", () => {
    const long = gym(90, 0);
    const typical = gym(45, 0);
    expect(long.routine).toBe(true);
    expect(long.extraKcal).toBe(long.totalKcal - typical.totalKcal);
    expect(long.extraKcal).toBe(typical.totalKcal);
  });

  it("sin rutina (o perfil antiguo), todo es extra", () => {
    const s = splitRoutineSession({
      activity: "Correr",
      minutes: 30,
      intensity: "Normal",
      weightKg: 70,
      routine: null,
      routineSessionsBefore: 0,
    });
    expect(s.routine).toBe(false);
    expect(s.extraKcal).toBe(s.totalKcal);
  });

  it("'no entreno' es un dato: todo lo registrado es extra", () => {
    const s = splitRoutineSession({
      activity: "Correr",
      minutes: 30,
      intensity: "Normal",
      weightKg: 70,
      routine: parseTraining("no entreno"),
      routineSessionsBefore: 0,
    });
    expect(s.routine).toBe(false);
  });
});

describe("entradas guardadas", () => {
  it("una entrada antigua, sin `routine`, cuenta entera como extra", () => {
    const day = cleanDayExercise({
      entries: [{ id: "a", activity: "Correr", minutes: 30, intensity: "Normal", kcal: -300 }],
      compensatedKcal: 0,
    });
    expect(pendingExerciseKcal(day)).toBe(-300);
    expect(routineSessionsIn([day])).toBe(0);
  });

  it("una sesión de rutina se lee con sus campos y solo desvía su parte extra", () => {
    const day = cleanDayExercise({
      entries: [
        {
          id: "a",
          activity: "Gimnasio / pesas",
          minutes: 90,
          intensity: "Normal",
          kcal: -180,
          routine: true,
          routineKcal: 180,
          routineIndex: 2,
          routineOf: 3,
        },
      ],
      compensatedKcal: 0,
    }) as DayExercise;
    expect(day.entries[0]).toMatchObject({ routine: true, routineKcal: 180, routineIndex: 2 });
    expect(pendingExerciseKcal(day)).toBe(-180);
    expect(routineSessionsIn([day, null])).toBe(1);
    expect(onlyRoutineExercise(day)).toBe(false);
  });

  it("solo rutina sin extra → la tarjeta puede decir que ya va en el plan", () => {
    const day = cleanDayExercise({
      entries: [
        {
          id: "a",
          activity: "Correr",
          minutes: 40,
          intensity: "Normal",
          kcal: 0,
          routine: true,
          routineKcal: 300,
        },
      ],
      compensatedKcal: 0,
    });
    expect(onlyRoutineExercise(day)).toBe(true);
  });
});

describe("isoWeekDaysUntil", () => {
  it("de lunes a la fecha, ambos incluidos", () => {
    // 2026-09-25 es viernes.
    expect(isoWeekDaysUntil("2026-09-25")).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
    // Un lunes es solo él mismo; un domingo, la semana entera.
    expect(isoWeekDaysUntil("2026-09-21")).toEqual(["2026-09-21"]);
    expect(isoWeekDaysUntil("2026-09-27")).toHaveLength(7);
  });
});
