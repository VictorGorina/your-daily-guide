import { describe, expect, it, spyOn } from "bun:test";

import { setFakeAdmin } from "@/test/admin";

import { requestPasswordResetHandler, requestSignupConfirmationHandler } from "./auth.server";

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
