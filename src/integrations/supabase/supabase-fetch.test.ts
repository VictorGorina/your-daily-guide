import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import { createSupabaseFetch } from "./supabase-fetch";

describe("createSupabaseFetch", () => {
  let fetchSpy: ReturnType<typeof spyOn> | undefined;
  afterEach(() => fetchSpy?.mockRestore());

  const sent = async (key: string, headers: Record<string, string>) => {
    const fake = mock(async () => new Response("{}"));
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fake as never);
    await createSupabaseFetch(key)("https://x.supabase.co/rest/v1/profiles", { headers });
    return (fake.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
  };

  it("siempre manda la clave como apikey", async () => {
    const h = await sent("sb_publishable_abc", {});
    expect(h.get("apikey")).toBe("sb_publishable_abc");
  });

  it("con una clave nueva, quita el Authorization que solo repite la clave (no es un JWT)", async () => {
    const h = await sent("sb_publishable_abc", { Authorization: "Bearer sb_publishable_abc" });
    expect(h.get("Authorization")).toBeNull();
  });

  it("conserva el token de sesión de la persona", async () => {
    const h = await sent("sb_publishable_abc", { Authorization: "Bearer eyJ.sesion" });
    expect(h.get("Authorization")).toBe("Bearer eyJ.sesion");
  });

  it("con una clave antigua (JWT) no toca el Authorization", async () => {
    const h = await sent("eyJ.anon", { Authorization: "Bearer eyJ.anon" });
    expect(h.get("Authorization")).toBe("Bearer eyJ.anon");
    expect(h.get("apikey")).toBe("eyJ.anon");
  });
});
