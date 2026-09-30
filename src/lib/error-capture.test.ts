import { afterAll, describe, expect, it, spyOn } from "bun:test";

// El módulo envuelve `console.error` al importarse: se importa con la salida ya
// silenciada, y al acabar se devuelve el `console.error` de siempre.
const quiet = spyOn(console, "error").mockImplementation(() => {});
const { consumeLastCapturedError, withErrorCapture } = await import("./error-capture");
afterAll(() => quiet.mockRestore());

const tick = () => new Promise((r) => setTimeout(r, 5));

// ARQ-03: con Fluid Compute una instancia atiende varias peticiones a la vez;
// el error de una no puede acabar en el log de la 500 de otra.
describe("consumeLastCapturedError", () => {
  it("cada petición recupera su propio error aunque se intercalen", async () => {
    const errorA = new Error("falla A");
    const errorB = new Error("falla B");
    const [a, b] = await Promise.all([
      withErrorCapture(async () => {
        console.error(errorA);
        await tick(); // entretanto B registra el suyo
        await tick();
        return consumeLastCapturedError();
      }),
      withErrorCapture(async () => {
        await tick();
        console.error(errorB);
        return consumeLastCapturedError();
      }),
    ]);
    expect(a).toBe(errorA);
    expect(b).toBe(errorB);
  });

  it("se consume una sola vez", async () => {
    await withErrorCapture(async () => {
      const error = new Error("una vez");
      console.error(error);
      expect(consumeLastCapturedError()).toBe(error);
      expect(consumeLastCapturedError()).toBeUndefined();
    });
  });

  it("fuera de una petición no guarda nada", () => {
    console.error(new Error("suelto"));
    expect(consumeLastCapturedError()).toBeUndefined();
  });
});
