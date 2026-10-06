import { afterEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import { setFakeAdmin } from "@/test/admin";

import {
  createSendThrottle,
  requestPasswordResetHandler,
  requestSignupConfirmationHandler,
} from "./auth.server";

type LinkResult = {
  data: { properties?: { action_link?: string } } | null;
  error: { code?: string } | null;
};

/** `supabaseAdmin` con la cuota siempre libre y el `generateLink` que se pida. */
function adminWith(generateLink: (args: { email: string; type: string }) => LinkResult) {
  const linkCalls: { email: string; type: string }[] = [];
  setFakeAdmin({
    rpc: async () => ({ data: [{ allowed: true }], error: null }),
    auth: {
      admin: {
        generateLink: async (args: { email: string; type: string }) => {
          linkCalls.push(args);
          return generateLink(args);
        },
      },
    },
  });
  return linkCalls;
}

const link = (url: string): LinkResult => ({
  data: { properties: { action_link: url } },
  error: null,
});

function mailbox() {
  const sent: { to: string; subject: string; html: string }[] = [];
  return {
    sent,
    sendEmail: async (m: { to: string; subject: string; html: string }) => void sent.push(m),
    minResponseMs: 0,
  };
}

describe("requestPasswordResetHandler", () => {
  it("con una cuenta que no existe responde ok y no manda nada", async () => {
    adminWith(() => ({ data: null, error: { code: "user_not_found" } }));
    const box = mailbox();
    const result = await requestPasswordResetHandler(
      { email: "nadie@example.com", platform: "web" },
      box,
    );
    expect(result).toEqual({ ok: true });
    expect(box.sent).toEqual([]);
  });

  it("con una cuenta que existe manda el enlace a ese correo", async () => {
    adminWith(() => link("https://auth.example/recover?t=1"));
    const box = mailbox();
    const result = await requestPasswordResetHandler(
      { email: "ana@example.com", platform: "web" },
      box,
    );
    expect(result).toEqual({ ok: true });
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]!.to).toBe("ana@example.com");
    expect(box.sent[0]!.html).toContain("https://auth.example/recover?t=1");
  });

  it("un segundo intento en menos de un minuto no pide otro enlace", async () => {
    const calls = adminWith(() => link("https://auth.example/recover?t=2"));
    const box = mailbox();
    await requestPasswordResetHandler({ email: "rep@example.com", platform: "web" }, box);
    await requestPasswordResetHandler({ email: "rep@example.com", platform: "web" }, box);
    expect(calls).toHaveLength(1);
    expect(box.sent).toHaveLength(1);
  });

  it("si el correo falla, responde ok igual", async () => {
    adminWith(() => link("https://auth.example/recover?t=3"));
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const result = await requestPasswordResetHandler(
      { email: "falla@example.com", platform: "web" },
      {
        sendEmail: async () => {
          throw new Error("Resend 500");
        },
        minResponseMs: 0,
      },
    );
    expect(result).toEqual({ ok: true });
    quiet.mockRestore();
  });
});

describe("requestSignupConfirmationHandler", () => {
  const signup = (email: string) => ({
    email,
    password: "secreta123",
    platform: "web" as const,
  });

  it("una cuenta nueva recibe el enlace de confirmación", async () => {
    adminWith(() => link("https://auth.example/confirm?t=1"));
    const box = mailbox();
    expect(await requestSignupConfirmationHandler(signup("nueva@example.com"), box)).toEqual({
      ok: true,
    });
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]!.html).toContain("https://auth.example/confirm?t=1");
  });

  it("una cuenta ya confirmada recibe el aviso, y la respuesta es la misma", async () => {
    adminWith(() => ({ data: null, error: { code: "email_exists" } }));
    const box = mailbox();
    expect(await requestSignupConfirmationHandler(signup("existe@example.com"), box)).toEqual({
      ok: true,
    });
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]!.to).toBe("existe@example.com");
    expect(box.sent[0]!.html).not.toContain("auth.example/confirm");
  });
});

// SEC-S-10: solo hay correo cuando la cuenta existe; si la respuesta tardase
// lo que el envío, su tiempo diría quién tiene cuenta. Y el correo tiene que
// haber salido ya al responder: en producción, mandado en segundo plano con
// waitUntil, se perdía (ticket 15).
describe("tiempo de respuesta y envío", () => {
  const FLOOR = 60;
  const slowBox = () => {
    const sent: string[] = [];
    return {
      sent,
      sendEmail: async (m: { to: string }) => {
        await new Promise((r) => setTimeout(r, 15));
        sent.push(m.to);
      },
      minResponseMs: FLOOR,
    };
  };
  const timed = async (p: Promise<unknown>) => {
    const t0 = performance.now();
    await p;
    return performance.now() - t0;
  };

  it("reset: exista o no la cuenta, tarda el mínimo, y el correo ya ha salido", async () => {
    adminWith(() => ({ data: null, error: { code: "user_not_found" } }));
    const none = slowBox();
    const tNone = await timed(
      requestPasswordResetHandler({ email: "t-nadie@example.com", platform: "web" }, none),
    );
    adminWith(() => link("https://auth.example/recover?t=9"));
    const some = slowBox();
    const tSome = await timed(
      requestPasswordResetHandler({ email: "t-ana@example.com", platform: "web" }, some),
    );
    expect(tNone).toBeGreaterThanOrEqual(FLOOR - 2);
    expect(tSome).toBeGreaterThanOrEqual(FLOOR - 2);
    expect(Math.abs(tSome - tNone)).toBeLessThan(25);
    expect(none.sent).toEqual([]);
    expect(some.sent).toEqual(["t-ana@example.com"]); // enviado ANTES de responder
  });

  it("alta: el enlace nuevo y el aviso de cuenta existente salen antes de responder", async () => {
    adminWith(() => link("https://auth.example/confirm?t=9"));
    const nueva = slowBox();
    await requestSignupConfirmationHandler(
      { email: "t-nueva@example.com", password: "secreta123", platform: "web" },
      nueva,
    );
    expect(nueva.sent).toEqual(["t-nueva@example.com"]);
    adminWith(() => ({ data: null, error: { code: "email_exists" } }));
    const existe = slowBox();
    const t = await timed(
      requestSignupConfirmationHandler(
        { email: "t-existe@example.com", password: "secreta123", platform: "web" },
        existe,
      ),
    );
    expect(existe.sent).toEqual(["t-existe@example.com"]);
    expect(t).toBeGreaterThanOrEqual(FLOOR - 2);
  });

  it("un envío más lento que el mínimo se espera igual: nunca se responde antes de mandarlo", async () => {
    adminWith(() => link("https://auth.example/recover?t=12"));
    const sent: string[] = [];
    await requestPasswordResetHandler(
      { email: "t-lento@example.com", platform: "web" },
      {
        sendEmail: async (m) => {
          await new Promise((r) => setTimeout(r, 80));
          sent.push(m.to);
        },
        minResponseMs: 10,
      },
    );
    expect(sent).toEqual(["t-lento@example.com"]);
  });

  it("también el freno de un minuto tarda el mínimo", async () => {
    adminWith(() => link("https://auth.example/recover?t=11"));
    const box = slowBox();
    await requestPasswordResetHandler({ email: "t-rep@example.com", platform: "web" }, box);
    const t = await timed(
      requestPasswordResetHandler({ email: "t-rep@example.com", platform: "web" }, box),
    );
    expect(t).toBeGreaterThanOrEqual(FLOOR - 2);
    expect(box.sent).toHaveLength(1);
  });

  it("un envío que falla queda en el log y la respuesta sigue siendo ok", async () => {
    adminWith(() => link("https://auth.example/recover?t=10"));
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const result = await requestPasswordResetHandler(
      { email: "t-falla@example.com", platform: "web" },
      {
        sendEmail: async () => {
          throw new Error("Resend 500");
        },
        minResponseMs: 0,
      },
    );
    expect(result).toEqual({ ok: true });
    const lines = quiet.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some((l) => l.includes('"event":"email_send_failed"') && l.includes('"kind":"reset"')),
    ).toBe(true);
    quiet.mockRestore();
  });
});

// ARQ-03: el freno vive en memoria de la instancia y no tenía límite; muchos
// correos distintos lo hacían crecer sin fin.
describe("createSendThrottle", () => {
  afterEach(() => setSystemTime());
  const at = (s: number) => setSystemTime(new Date(Date.UTC(2026, 8, 30, 10, 0, s)));

  it("frena el mismo correo y operación durante un minuto, no otra operación", () => {
    const t = createSendThrottle(60_000, 100);
    at(0);
    expect(t.throttled("password-reset", "a@x.es")).toBe(false);
    at(30);
    expect(t.throttled("password-reset", "a@x.es")).toBe(true);
    expect(t.throttled("signup-confirm", "a@x.es")).toBe(false);
    at(61);
    expect(t.throttled("password-reset", "a@x.es")).toBe(false);
  });

  it("borra lo que ya no frena en cada llamada", () => {
    const t = createSendThrottle(60_000, 100);
    at(0);
    for (const e of ["a", "b", "c"]) t.throttled("password-reset", `${e}@x.es`);
    expect(t.size).toBe(3);
    at(61);
    t.throttled("password-reset", "d@x.es");
    expect(t.size).toBe(1);
  });

  it("no pasa del tope: sale la entrada más antigua", () => {
    const t = createSendThrottle(60_000, 3);
    at(0);
    for (const e of ["a", "b", "c", "d"]) t.throttled("password-reset", `${e}@x.es`);
    expect(t.size).toBe(3);
    expect(t.throttled("password-reset", "a@x.es")).toBe(false); // la expulsada
    expect(t.throttled("password-reset", "d@x.es")).toBe(true);
  });
});

// Ticket 38 (MOB-02): el enlace pedido desde el móvil ya no va por el esquema
// `dailyguide://`, que cualquier app puede registrar, sino por https con la
// marca que el dominio tiene asociada a la app.
describe("destino del enlace según la plataforma", () => {
  const redirectOf = (call: unknown) =>
    (call as { options?: { redirectTo?: string } }).options?.redirectTo ?? "";

  it("el móvil recibe un enlace https del dominio con `?app=1`, nunca el esquema propio", async () => {
    const calls = adminWith(() => link("https://auth.example/x"));
    await requestPasswordResetHandler(
      { email: "ul-reset@example.com", platform: "mobile" },
      mailbox(),
    );
    await requestSignupConfirmationHandler(
      { email: "ul-alta@example.com", password: "secreta123", platform: "mobile" },
      mailbox(),
    );
    const [reset, signup] = calls.map(redirectOf);
    expect(reset).toMatch(/^https?:\/\/[^/]+\/restablecer\?app=1$/);
    expect(signup).toMatch(/^https?:\/\/[^/]+\/confirmado\?app=1$/);
  });

  it("la web no lleva la marca: sus enlaces no deben abrir la app", async () => {
    const calls = adminWith(() => link("https://auth.example/x"));
    await requestPasswordResetHandler({ email: "ul-web@example.com", platform: "web" }, mailbox());
    expect(redirectOf(calls[0])).toMatch(/\/restablecer$/);
  });
});
