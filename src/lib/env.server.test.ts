import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { emailFrom } from "./env.server";

describe("emailFrom", () => {
  const saved = { from: process.env.RESEND_FROM, env: process.env.VERCEL_ENV };
  let errors: ReturnType<typeof spyOn>;

  beforeEach(() => {
    errors = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
    for (const [key, value] of [
      ["RESEND_FROM", saved.from],
      ["VERCEL_ENV", saved.env],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const missingEvents = () =>
    (errors.mock.calls as unknown[][])
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .filter((line) => line.event === "env_missing");

  test("usa RESEND_FROM cuando está definida, sin avisar", () => {
    process.env.RESEND_FROM = "Peppers <hola@peppersfam.es>";
    process.env.VERCEL_ENV = "production";
    expect(emailFrom()).toBe("Peppers <hola@peppersfam.es>");
    expect(missingEvents()).toEqual([]);
  });

  test("en producción sin RESEND_FROM cae al respaldo y deja env_missing", () => {
    delete process.env.RESEND_FROM;
    process.env.VERCEL_ENV = "production";
    expect(emailFrom()).toBe("Peppers <onboarding@resend.dev>");
    expect(missingEvents()).toMatchObject([
      { level: "error", variable: "RESEND_FROM", fallback: "onboarding@resend.dev" },
    ]);
  });

  test("fuera de producción el respaldo no avisa", () => {
    delete process.env.RESEND_FROM;
    delete process.env.VERCEL_ENV;
    expect(emailFrom()).toBe("Peppers <onboarding@resend.dev>");
    expect(missingEvents()).toEqual([]);
  });
});
