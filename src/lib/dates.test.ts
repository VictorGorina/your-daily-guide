import { describe, expect, it } from "bun:test";

import {
  addDaysISO,
  dateInMonth,
  daysBetween,
  daysInMonth,
  localISODate,
  weekdayIndex,
} from "./dates";

describe("addDaysISO", () => {
  it("cruza meses y años en los dos sentidos", () => {
    expect(addDaysISO("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysISO("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("el cambio de hora no salta ni repite una fecha", () => {
    expect(addDaysISO("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDaysISO("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDaysISO("2026-03-29", 1)).toBe("2026-03-30");
  });
});

describe("daysBetween", () => {
  it("cuenta días naturales, con signo", () => {
    expect(daysBetween("2026-10-20", "2026-10-30")).toBe(10);
    expect(daysBetween("2026-10-30", "2026-10-20")).toBe(-10);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("weekdayIndex", () => {
  it("lunes es 0 y domingo 6", () => {
    expect(weekdayIndex("2026-09-28")).toBe(0);
    expect(weekdayIndex("2026-09-27")).toBe(6);
    expect(weekdayIndex("2026-10-25")).toBe(6);
  });
});

describe("daysInMonth", () => {
  it("meses de 28, 29, 30 y 31", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2026-12")).toBe(31);
  });
});

describe("dateInMonth", () => {
  it("rellena el día a dos cifras", () => {
    expect(dateInMonth("2026-09", 1)).toBe("2026-09-01");
    expect(dateInMonth("2026-09", 30)).toBe("2026-09-30");
  });
});

describe("localISODate", () => {
  it("usa los campos locales, no los de UTC", () => {
    // 23:30 del 27 en hora local: en cualquier zona al oeste de UTC,
    // `toISOString()` ya diría 28.
    expect(localISODate(new Date(2026, 8, 27, 23, 30))).toBe("2026-09-27");
    expect(localISODate(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });
});
