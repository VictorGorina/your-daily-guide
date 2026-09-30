import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { cronSecretMatches } from "./cron-secret.server";

const LONG = "s".repeat(64);
const previous = process.env.CRON_SECRET;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  if (previous === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
});

describe("cronSecretMatches", () => {
  test("el mismo secreto coincide; otro, uno vacío o ninguno, no", async () => {
    process.env.CRON_SECRET = LONG;
    expect(await cronSecretMatches(LONG)).toBe(true);
    expect(await cronSecretMatches(`${LONG}x`)).toBe(false);
    expect(await cronSecretMatches("")).toBe(false);
    expect(await cronSecretMatches(null)).toBe(false);
  });

  test("sin CRON_SECRET nunca coincide", async () => {
    delete process.env.CRON_SECRET;
    expect(await cronSecretMatches("")).toBe(false);
    expect(await cronSecretMatches("cualquiera")).toBe(false);
  });

  test("un CRON_SECRET de menos de 32 caracteres no vale ni acertándolo (ticket 06)", async () => {
    process.env.CRON_SECRET = "corto";
    expect(await cronSecretMatches("corto")).toBe(false);
    const events = errorSpy.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])).event);
    expect(events).toContain("cron_secret_weak");
  });
});
