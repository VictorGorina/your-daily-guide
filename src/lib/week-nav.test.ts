import { describe, expect, it } from "bun:test";

import {
  addDaysISO,
  BACKFILL_WINDOW_DAYS,
  dayKind,
  daysBetween,
  isPastDayEditable,
  mondayAt,
  monthsOfWeek,
  weekCount,
  weekDates,
  weekdayIndex,
  weekIndexOf,
  weekLabel,
  weekStartOf,
  weekStripBounds,
} from "./week-nav";

describe("addDaysISO / daysBetween", () => {
  it("cruza de mes y de año", () => {
    expect(addDaysISO("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("el cambio de hora de octubre no salta ni repite un día", () => {
    // 25 de octubre de 2026: en España ese día dura 25 horas.
    expect(addDaysISO("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDaysISO("2026-10-25", 1)).toBe("2026-10-26");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("daysBetween es negativo hacia atrás", () => {
    expect(daysBetween("2026-09-15", "2026-09-14")).toBe(-1);
  });
});

describe("weekdayIndex / weekStartOf / weekDates", () => {
  it("lunes = 0 y domingo = 6", () => {
    expect(weekdayIndex("2026-09-14")).toBe(0); // lunes
    expect(weekdayIndex("2026-09-20")).toBe(6); // domingo
  });

  it("un domingo pertenece a la semana del lunes anterior", () => {
    expect(weekStartOf("2026-09-20")).toBe("2026-09-14");
    expect(weekStartOf("2026-09-14")).toBe("2026-09-14");
  });

  it("la semana del cambio de hora tiene 7 fechas seguidas", () => {
    expect(weekDates("2026-10-19")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });
});

describe("monthsOfWeek", () => {
  it("una semana dentro de un mes toca un solo mes", () => {
    expect(monthsOfWeek("2026-09-14")).toEqual(["2026-09"]);
  });

  it("una semana que cruza de mes toca los dos", () => {
    expect(monthsOfWeek("2026-09-28")).toEqual(["2026-09", "2026-10"]);
  });
});

describe("weekStripBounds", () => {
  it("empieza en la semana del alta y acaba en la última semana del mes en curso", () => {
    // Hoy 15-sep: el mes siguiente aún no está desbloqueado (quedan > 7 días).
    const b = weekStripBounds("2026-09-15", "2026-08-12");
    expect(b.first).toBe("2026-08-10"); // el 12 de agosto es miércoles
    expect(b.last).toBe("2026-09-28"); // semana del 30 de septiembre
  });

  it("con el mes siguiente desbloqueado llega a su última semana", () => {
    // Hoy 25-sep: quedan 6 días del mes, octubre ya se puede preparar.
    const b = weekStripBounds("2026-09-25", "2026-09-01");
    expect(b.last).toBe("2026-10-26"); // semana del 31 de octubre
  });

  it("sin fecha de alta empieza en la semana de hoy", () => {
    expect(weekStripBounds("2026-09-15", null).first).toBe("2026-09-14");
  });

  it("una fecha de alta posterior a hoy o mal formada no mueve el inicio", () => {
    expect(weekStripBounds("2026-09-15", "2026-09-30").first).toBe("2026-09-14");
    expect(weekStripBounds("2026-09-15", "ayer").first).toBe("2026-09-14");
  });
});

describe("weekCount / weekIndexOf / mondayAt", () => {
  const bounds = { first: "2026-08-10", last: "2026-09-28" };

  it("cuenta las semanas con los dos extremos incluidos", () => {
    expect(weekCount(bounds)).toBe(8);
  });

  it("weekIndexOf y mondayAt son inversas", () => {
    expect(weekIndexOf("2026-09-17", bounds)).toBe(5);
    expect(mondayAt(5, bounds)).toBe("2026-09-14");
  });

  it("recorta a los límites", () => {
    expect(weekIndexOf("2026-07-01", bounds)).toBe(0);
    expect(weekIndexOf("2026-12-01", bounds)).toBe(7);
  });
});

describe("weekLabel", () => {
  const today = "2026-09-15";

  it("nombra la semana actual y sus vecinas", () => {
    expect(weekLabel("2026-09-14", today)).toBe("Esta semana");
    expect(weekLabel("2026-09-07", today)).toBe("Semana pasada");
    expect(weekLabel("2026-09-21", today)).toBe("Próxima semana");
  });

  it("el resto va como rango, con el mes solo al final si no cruza", () => {
    expect(weekLabel("2026-08-31", today)).toBe("31 ago – 6 sep");
    expect(weekLabel("2026-08-24", today)).toBe("24–30 ago");
    expect(weekLabel("2026-09-28", today)).toBe("28 sep – 4 oct");
  });
});

describe("dayKind", () => {
  it("clasifica respecto a hoy y al alta", () => {
    expect(dayKind("2026-09-15", "2026-09-15", "2026-09-01")).toBe("today");
    expect(dayKind("2026-09-16", "2026-09-15", "2026-09-01")).toBe("future");
    expect(dayKind("2026-09-02", "2026-09-15", "2026-09-01")).toBe("past");
    expect(dayKind("2026-08-31", "2026-09-15", "2026-09-01")).toBe("before-start");
    expect(dayKind("2026-08-31", "2026-09-15", null)).toBe("past");
  });
});

describe("isPastDayEditable", () => {
  const today = "2026-09-15";

  it("con registro se corrige aunque sea antiguo", () => {
    expect(isPastDayEditable("2026-06-01", today, "2026-05-01", true)).toBe(true);
  });

  it("sin registro, solo dentro de la ventana de relleno (con un día de margen)", () => {
    const inside = addDaysISO(today, -(BACKFILL_WINDOW_DAYS - 1));
    const edge = addDaysISO(today, -BACKFILL_WINDOW_DAYS);
    expect(isPastDayEditable(inside, today, null, false)).toBe(true);
    expect(isPastDayEditable(edge, today, null, false)).toBe(false);
  });

  it("nunca hoy, el futuro ni antes del alta", () => {
    expect(isPastDayEditable(today, today, null, true)).toBe(false);
    expect(isPastDayEditable("2026-09-16", today, null, true)).toBe(false);
    expect(isPastDayEditable("2026-08-31", today, "2026-09-01", true)).toBe(false);
  });
});
