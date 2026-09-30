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

// SEC-S-10: si la respuesta esperase al correo, que solo se manda cuando la
// cuenta existe, el tiempo de respuesta diría quién tiene cuenta.
describe("el correo no retrasa la respuesta", () => {
  const never = () => new Promise<void>(() => {});
  const settles = (p: Promise<unknown>) =>
    Promise.race([p.then(() => "ok"), new Promise((r) => setTimeout(() => r("colgada"), 50))]);

  it("reset: responde sin esperar al envío y lo deja en waitUntil", async () => {
    adminWith(() => link("https://auth.example/recover?t=9"));
    const background: Promise<unknown>[] = [];
    const result = requestPasswordResetHandler(
      { email: "lenta@example.com", platform: "web" },
      { sendEmail: never, waitUntil: (p) => void background.push(p) },
    );
    expect(await settles(result)).toBe("ok");
    expect(background).toHaveLength(1);
  });

  it("alta: tampoco espera, ni al enlace nuevo ni al aviso de cuenta existente", async () => {
    const background: Promise<unknown>[] = [];
    const deps = { sendEmail: never, waitUntil: (p: Promise<unknown>) => void background.push(p) };
    adminWith(() => link("https://auth.example/confirm?t=9"));
    expect(
      await settles(
        requestSignupConfirmationHandler(
          { email: "lenta-nueva@example.com", password: "secreta123", platform: "web" },
          deps,
        ),
      ),
    ).toBe("ok");
    adminWith(() => ({ data: null, error: { code: "email_exists" } }));
    expect(
      await settles(
        requestSignupConfirmationHandler(
          { email: "lenta-existe@example.com", password: "secreta123", platform: "web" },
          deps,
        ),
      ),
    ).toBe("ok");
    expect(background).toHaveLength(2);
  });

  it("un envío que falla en segundo plano queda en el log, no rompe nada", async () => {
    adminWith(() => link("https://auth.example/recover?t=10"));
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const background: Promise<unknown>[] = [];
    await requestPasswordResetHandler(
      { email: "falla-fondo@example.com", platform: "web" },
      {
        sendEmail: async () => {
          throw new Error("Resend 500");
        },
        waitUntil: (p) => void background.push(p),
      },
    );
    await Promise.all(background);
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
