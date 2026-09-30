import { describe, expect, it } from "bun:test";
import { notFound, redirect } from "@tanstack/react-router";

import { GENERIC_ERROR_MESSAGE, HiddenServerError, publicError } from "./public-error";
import { RateLimitError } from "./rate-limit-error";
import { UserFacingError, ValidationError } from "./validation-error";

// SEC-S-14: lo que lanza una server function llega a la web serializado con
// sus propiedades (un error de PostgREST trae `details`, `hint` y `code`).
describe("publicError", () => {
  it("deja pasar tal cual lo que está escrito para la persona", () => {
    for (const error of [
      new ValidationError("Fecha no válida"),
      new UserFacingError("No hemos podido guardar el horario"),
      new RateLimitError(120, "hablar con el coach"),
    ]) {
      expect(publicError(error)).toBe(error);
    }
  });

  it("deja pasar la falta de sesión: apiPost la convierte en 401 por su prefijo", () => {
    const error = new Error("Unauthorized: Invalid token");
    expect(publicError(error)).toBe(error);
  });

  it("deja pasar las redirecciones y los notFound del router", () => {
    const r = redirect({ to: "/auth" });
    const n = notFound();
    expect(publicError(r)).toBe(r);
    expect(publicError(n)).toBe(n);
  });

  it("un error de PostgREST sale genérico y sin ninguna de sus propiedades", () => {
    const postgrest = Object.assign(new Error('duplicate key value violates "profiles_pkey"'), {
      code: "23505",
      details: "Key (id)=(ana) already exists.",
      hint: null,
    });
    const shown = publicError(postgrest);
    expect(shown).toBeInstanceOf(HiddenServerError);
    expect((shown as Error).message).toBe(GENERIC_ERROR_MESSAGE);
    expect(Object.keys(shown as object)).toEqual(["name"]);
    expect((shown as Error).cause).toBeUndefined();
  });

  it("un objeto plano de PostgREST, un Error interno o cualquier cosa, también", () => {
    for (const error of [
      { message: "column profiles.foo does not exist", code: "42703" },
      new Error("Falta RESEND_API_KEY"),
      "texto suelto",
      undefined,
    ]) {
      const shown = publicError(error);
      expect(shown).toBeInstanceOf(HiddenServerError);
      expect((shown as Error).message).toBe(GENERIC_ERROR_MESSAGE);
    }
  });
});
