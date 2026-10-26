import { describe, expect, test } from "bun:test";

import {
  INTERACTIVE_TIMEOUT_MS,
  INVISIBLE_TIMEOUT_MS,
  parseCaptchaMessage,
} from "./captcha-bridge";
import { MAX_CAPTCHA_TOKEN } from "./turnstile";

const message = (value: unknown) => JSON.stringify(value);

describe("parseCaptchaMessage: el mensaje del WebView del CAPTCHA (ticket 29)", () => {
  test("lee cada aviso de la página", () => {
    for (const type of ["off", "interactive", "unsupported", "timeout"] as const) {
      expect(parseCaptchaMessage(message({ type }))).toEqual({ type });
    }
    expect(parseCaptchaMessage(message({ type: "token", token: "abc" }))).toEqual({
      type: "token",
      token: "abc",
    });
    expect(parseCaptchaMessage(message({ type: "error", code: "600010" }))).toEqual({
      type: "error",
      code: "600010",
    });
  });

  test("un token vacío, que no es texto o enorme no vale", () => {
    expect(parseCaptchaMessage(message({ type: "token", token: "" }))).toBeNull();
    expect(parseCaptchaMessage(message({ type: "token", token: 42 }))).toBeNull();
    expect(parseCaptchaMessage(message({ type: "token" }))).toBeNull();
    expect(
      parseCaptchaMessage(message({ type: "token", token: "x".repeat(MAX_CAPTCHA_TOKEN + 1) })),
    ).toBeNull();
    expect(
      parseCaptchaMessage(message({ type: "token", token: "x".repeat(MAX_CAPTCHA_TOKEN) })),
    ).toEqual({ type: "token", token: "x".repeat(MAX_CAPTCHA_TOKEN) });
  });

  test("el código de un error se recorta y, si falta, queda vacío", () => {
    expect(parseCaptchaMessage(message({ type: "error", code: "9".repeat(100) }))).toEqual({
      type: "error",
      code: "9".repeat(32),
    });
    expect(parseCaptchaMessage(message({ type: "error" }))).toEqual({ type: "error", code: "" });
  });

  test("lo que no es un mensaje de la página se descarta sin lanzar", () => {
    for (const raw of [
      undefined,
      null,
      42,
      "",
      "no es json",
      "null",
      "[]",
      '"off"',
      message({ type: "otro" }),
      message({}),
      message({ type: "off", relleno: "x".repeat(9_000) }),
    ]) {
      expect(parseCaptchaMessage(raw)).toBeNull();
    }
  });

  test("con la casilla a la vista se espera más que sin ella", () => {
    expect(INTERACTIVE_TIMEOUT_MS).toBeGreaterThan(INVISIBLE_TIMEOUT_MS);
  });
});
