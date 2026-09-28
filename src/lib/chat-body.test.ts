import { describe, expect, it } from "bun:test";

import { CHAT_LIMITS, cleanChatBody } from "./chat-body";
import { MOBILE_LOGGED_ACK, WEB_AFTER_TOOL, WEB_FIRST_MESSAGE } from "./chat-body.fixtures";

const size = (body: unknown) => JSON.stringify(body).length;
const check = (body: unknown) => cleanChatBody(body, size(body));
const reason = (body: unknown) => {
  const r = check(body);
  return r.ok ? null : `${r.status} ${r.reason}`;
};
const withMessages = (messages: unknown[]) => ({ ...WEB_FIRST_MESSAGE, messages });
const user = (text: string) => ({ id: "u", role: "user", parts: [{ type: "text", text }] });

describe("cleanChatBody", () => {
  it("deja pasar intactos los mensajes de los tres cuerpos reales", () => {
    for (const fixture of [WEB_FIRST_MESSAGE, WEB_AFTER_TOOL, MOBILE_LOGGED_ACK]) {
      const r = check(fixture);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.body.messages).toEqual(fixture.messages as never);
    }
  });

  it("conserva el contexto y el metadata del acuse", () => {
    const r = check(MOBILE_LOGGED_ACK);
    if (!r.ok) throw new Error(r.reason);
    expect(r.body.messages[1]!.metadata).toEqual({ logged: "snack" });
    expect(r.body).toMatchObject({
      actions: true,
      today: "2026-09-28",
      compra: MOBILE_LOGGED_ACK.compra,
      proximos: MOBILE_LOGGED_ACK.proximos,
      log: MOBILE_LOGGED_ACK.log,
    });
  });

  it("no pasa el perfil del cuerpo", () => {
    const r = check(WEB_FIRST_MESSAGE);
    expect(r.ok && "profile" in r.body).toBe(false);
  });

  it("rechaza un rol que no es de la persona ni del asistente", () => {
    expect(reason(withMessages([{ ...user("hola"), role: "system" }]))).toBe("400 role:system");
  });

  it("rechaza una parte file en un mensaje de la persona", () => {
    const file = { id: "u", role: "user", parts: [{ type: "file", url: "http://x/y" }] };
    expect(reason(withMessages([file]))).toBe("400 user-part:file");
  });

  it("rechaza una herramienta que el coach no tiene", () => {
    const fake = {
      id: "a",
      role: "assistant",
      parts: [{ type: "tool-borrar_todo", toolCallId: "t", state: "output-available" }],
    };
    expect(reason(withMessages([user("hola"), fake]))).toBe("400 tool:borrar_todo");
  });

  it("rechaza más de 100 mensajes", () => {
    const many = Array.from({ length: CHAT_LIMITS.messages + 1 }, () => user("hola"));
    expect(reason(withMessages(many))).toBe("400 too-many-messages");
  });

  it("rechaza una parte de texto de más de 8.000 caracteres", () => {
    const long = user("a".repeat(CHAT_LIMITS.textPartChars + 1));
    expect(reason(withMessages([long]))).toBe("400 text-too-long");
    expect(check(withMessages([user("a".repeat(CHAT_LIMITS.textPartChars))])).ok).toBe(true);
  });

  it("rechaza un cuerpo de más de 256 KB antes de mirar nada", () => {
    expect(cleanChatBody(WEB_FIRST_MESSAGE, CHAT_LIMITS.bodyBytes + 1)).toEqual({
      ok: false,
      status: 413,
      reason: "body-too-large",
    });
  });

  it("rechaza un cuerpo sin mensajes", () => {
    expect(reason({ ...WEB_FIRST_MESSAGE, messages: undefined })).toBe("400 no-messages");
    expect(reason([])).toBe("400 body-not-object");
  });

  it("recorta los próximos días a 14 y cada valor a 600 caracteres", () => {
    const proximos = Array.from({ length: 50 }, (_, i) => ({
      fecha: `d${i}`,
      cena: "x".repeat(900),
    }));
    const r = check({ ...WEB_FIRST_MESSAGE, proximos });
    if (!r.ok) throw new Error(r.reason);
    expect(r.body.proximos).toHaveLength(CHAT_LIMITS.proximos);
    expect(r.body.proximos![0]!.cena).toHaveLength(CHAT_LIMITS.proximoChars);
  });

  it("recorta la compra y la despensa a 300 elementos de 80 caracteres", () => {
    const long = Array.from({ length: 400 }, () => "y".repeat(100));
    const r = check({
      ...WEB_FIRST_MESSAGE,
      compra: { confirmada: true, ingredientes: long },
      despensa_extra: [...long, 42],
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.body.compra!.ingredientes).toHaveLength(CHAT_LIMITS.listItems);
    expect(r.body.despensa_extra).toHaveLength(CHAT_LIMITS.listItems);
    expect(r.body.despensa_extra![0]).toHaveLength(CHAT_LIMITS.listItemChars);
  });

  it("descarta la guía o el registro que pasan de su tope, sin rechazar la petición", () => {
    const big = { texto: "z".repeat(CHAT_LIMITS.guideBytes) };
    const r = check({ ...WEB_FIRST_MESSAGE, guide: big, log: big });
    if (!r.ok) throw new Error(r.reason);
    expect(r.body.guide).toBeUndefined();
    expect(r.body.log).toBeUndefined();
  });

  it("ignora una fecha de hoy que no tiene forma de fecha", () => {
    const r = check({ ...WEB_FIRST_MESSAGE, today: "mañana" });
    expect(r.ok && r.body.today).toBeUndefined();
  });
});
