import { afterEach, describe, expect, test } from "bun:test";

import { cleanCaptchaToken, MAX_CAPTCHA_TOKEN } from "./turnstile";
import {
  assertHuman,
  CAPTCHA_FAILED_MESSAGE,
  captchaStep,
  verifyTurnstile,
} from "./turnstile.server";
import { ValidationError } from "./validation-error";

const answering = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const failing = (async () => {
  throw new Error("network down");
}) as unknown as typeof fetch;

describe("captchaStep: el CAPTCHA se enciende por pasos", () => {
  test("sin clave secreta no hace nada, traiga token o no", () => {
    expect(captchaStep({ secretSet: false, enforce: false, hasToken: false })).toBe("skip");
    expect(captchaStep({ secretSet: false, enforce: true, hasToken: true })).toBe("skip");
  });

  test("con clave, el token que llega se comprueba siempre", () => {
    expect(captchaStep({ secretSet: true, enforce: false, hasToken: true })).toBe("verify");
    expect(captchaStep({ secretSet: true, enforce: true, hasToken: true })).toBe("verify");
  });

  test("sin token solo se corta con el modo estricto", () => {
    expect(captchaStep({ secretSet: true, enforce: false, hasToken: false })).toBe("allow-missing");
    expect(captchaStep({ secretSet: true, enforce: true, hasToken: false })).toBe("reject-missing");
  });
});

describe("cleanCaptchaToken", () => {
  test("solo texto no vacío y de tamaño razonable", () => {
    expect(cleanCaptchaToken(" abc ")).toBe("abc");
    expect(cleanCaptchaToken("")).toBeUndefined();
    expect(cleanCaptchaToken(42)).toBeUndefined();
    expect(cleanCaptchaToken(undefined)).toBeUndefined();
    expect(cleanCaptchaToken("x".repeat(MAX_CAPTCHA_TOKEN + 1))).toBeUndefined();
  });
});

describe("verifyTurnstile", () => {
  test("manda la clave y el token a Cloudflare", async () => {
    let sent = "";
    const spy = (async (_url: unknown, init?: RequestInit) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ success: true }));
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "sec", spy)).toBe("human");
    expect(sent).toBe("secret=sec&response=tok");
  });

  test("un token malo es un rechazo", async () => {
    expect(await verifyTurnstile("tok", "sec", answering({ success: false }))).toBe("rejected");
  });

  test("red caída, 5xx o respuesta rara: no se pudo preguntar", async () => {
    expect(await verifyTurnstile("tok", "sec", failing)).toBe("unavailable");
    expect(await verifyTurnstile("tok", "sec", answering({}, 503))).toBe("unavailable");
    expect(await verifyTurnstile("tok", "sec", answering({ ok: 1 }))).toBe("unavailable");
  });
});

describe("assertHuman", () => {
  const saved = {
    secret: process.env.TURNSTILE_SECRET_KEY,
    enforce: process.env.TURNSTILE_ENFORCE,
  };
  const set = (secret?: string, enforce?: string) => {
    if (secret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = secret;
    if (enforce === undefined) delete process.env.TURNSTILE_ENFORCE;
    else process.env.TURNSTILE_ENFORCE = enforce;
  };
  afterEach(() => set(saved.secret, saved.enforce));

  test("sin clave no llama a nadie", async () => {
    set(undefined);
    await assertHuman("tok", "signup", failing);
  });

  test("token bueno pasa; token malo corta con un mensaje para la persona", async () => {
    set("sec");
    await assertHuman("tok", "signup", answering({ success: true }));
    const rejected = assertHuman("tok", "signup", answering({ success: false }));
    await expect(rejected).rejects.toBeInstanceOf(ValidationError);
    await expect(rejected).rejects.toThrow(CAPTCHA_FAILED_MESSAGE);
  });

  test("sin token: pasa en modo informe y corta en modo estricto", async () => {
    set("sec");
    await assertHuman(undefined, "password-reset", failing);
    set("sec", "1");
    await expect(assertHuman(undefined, "password-reset", failing)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("si Cloudflare no contesta, se deja pasar", async () => {
    set("sec", "1");
    await assertHuman("tok", "signup", failing);
  });
});
