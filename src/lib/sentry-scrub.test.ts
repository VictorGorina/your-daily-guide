import { describe, expect, it } from "bun:test";

import { scrubSentryEvent } from "./sentry-scrub";

describe("scrubSentryEvent", () => {
  it("un evento con correo, token, notas y medicación sale limpio", () => {
    const out = scrubSentryEvent({
      message: "Falló el alta de ana.perez@example.com",
      exception: {
        values: [{ type: "Error", value: "duplicate key (email)=(ana.perez@example.com)" }],
      },
      user: { id: "u-1", email: "ana.perez@example.com", ip_address: "1.2.3.4" },
      request: {
        url: "https://www.peppersfam.es/restablecer?code=abc123&email=ana.perez@example.com",
        headers: { authorization: "Bearer eyJ...", "user-agent": "x" },
        cookies: { sb: "secreto" },
        data: { notes: "no le gusta el pescado", medications: "sertralina", month: "2026-09" },
      },
      extra: { token: "eyJ...", dish: "Lentejas", userId: "u-1" },
      contexts: { profile: { medical_conditions: "diabetes" } },
      breadcrumbs: [
        { category: "fetch", data: { url: "https://x.supabase.co/rest/v1/profiles?id=eq.u-1" } },
        { category: "console", message: "hola ana.perez@example.com" },
      ],
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain("ana.perez@example.com");
    expect(text).not.toContain("eyJ");
    expect(text).not.toContain("secreto");
    expect(text).not.toContain("pescado");
    expect(text).not.toContain("sertralina");
    expect(text).not.toContain("diabetes");
    expect(text).not.toContain("Lentejas");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("1.2.3.4");
    // Lo que sirve para investigar se queda.
    expect(out.user as unknown).toEqual({ id: "u-1" });
    expect(out.request?.url).toBe("https://www.peppersfam.es/restablecer");
    expect(out.breadcrumbs?.[0]?.data?.url).toBe("https://x.supabase.co/rest/v1/profiles");
    expect(out.exception?.values?.[0]?.value).toBe("duplicate key (email)=([email])");
    expect((out.request?.data as Record<string, unknown>).month).toBe("2026-09");
  });

  it("sin nada que limpiar, no rompe", () => {
    expect(scrubSentryEvent({})).toEqual({});
  });
});
