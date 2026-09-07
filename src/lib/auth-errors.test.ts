import { describe, expect, it } from "bun:test";

import { authErrorKey, authErrorText, isEmailNotConfirmed } from "./auth-errors";

/** Error tal y como lo devuelve supabase-js: un Error con `code`. */
function supabaseError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Error nuestro: el mensaje ya está escrito en el idioma de la app. */
function ownError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** `t` de i18next reducido a lo que usan estas funciones. */
const t = (key: string) => `«${key}»`;

describe("authErrorKey", () => {
  it("traduce por código, que es lo estable entre versiones de GoTrue", () => {
    expect(authErrorKey(supabaseError("email_not_confirmed", "Email not confirmed"), "x")).toBe(
      "auth.errEmailNotConfirmed",
    );
    expect(authErrorKey(supabaseError("invalid_credentials", "…"), "x")).toBe(
      "auth.errInvalidCredentials",
    );
    expect(authErrorKey(supabaseError("over_email_send_rate_limit", "…"), "x")).toBe(
      "auth.errEmailRateLimit",
    );
  });

  it("cae al texto cuando el error no trae código", () => {
    expect(authErrorKey(new Error("Email not confirmed"), "x")).toBe("auth.errEmailNotConfirmed");
    expect(authErrorKey(new Error("Invalid login credentials"), "x")).toBe(
      "auth.errInvalidCredentials",
    );
  });

  it("el código manda sobre el texto", () => {
    const error = supabaseError("weak_password", "Invalid login credentials");
    expect(authErrorKey(error, "x")).toBe("auth.errWeakPassword");
  });

  it("devuelve el fallback si no reconoce nada", () => {
    expect(authErrorKey(new Error("boom"), "auth.errSignIn")).toBe("auth.errSignIn");
    expect(authErrorKey(undefined, "auth.errSignIn")).toBe("auth.errSignIn");
    expect(authErrorKey({ code: 42 }, "auth.errSignIn")).toBe("auth.errSignIn");
  });
});

describe("isEmailNotConfirmed", () => {
  it("reconoce la cuenta sin confirmar, que es la única con salida en la app", () => {
    expect(isEmailNotConfirmed(supabaseError("email_not_confirmed", "Email not confirmed"))).toBe(
      true,
    );
    expect(isEmailNotConfirmed(new Error("Email not confirmed"))).toBe(true);
  });

  it("no confunde otros errores de acceso con ese", () => {
    expect(isEmailNotConfirmed(supabaseError("invalid_credentials", "…"))).toBe(false);
    expect(isEmailNotConfirmed(new Error("boom"))).toBe(false);
    expect(isEmailNotConfirmed(null)).toBe(false);
  });
});

describe("authErrorText", () => {
  it("traduce los errores de Supabase", () => {
    const error = supabaseError("email_not_confirmed", "Email not confirmed");
    expect(authErrorText(error, t, "auth.errSignIn")).toBe("«auth.errEmailNotConfirmed»");
  });

  it("enseña tal cual el mensaje de nuestro propio backend", () => {
    expect(authErrorText(ownError("ValidationError", "Necesitamos un correo válido"), t, "f")).toBe(
      "Necesitamos un correo válido",
    );
    expect(authErrorText(ownError("ApiError", "No hay sesión"), t, "f")).toBe("No hay sesión");
  });

  it("nunca enseña el mensaje crudo de un error ajeno — el bug que arregla", () => {
    // Un fallo de red o de una librería llega en inglés: se enseña el genérico.
    expect(authErrorText(new Error("Failed to fetch"), t, "auth.errSignIn")).toBe(
      "«auth.errSignIn»",
    );
    expect(authErrorText("algo", t, "auth.errSignIn")).toBe("«auth.errSignIn»");
  });

  it("un error nuestro sin mensaje también cae al genérico", () => {
    expect(authErrorText(ownError("ApiError", ""), t, "auth.errSignIn")).toBe("«auth.errSignIn»");
  });
});
