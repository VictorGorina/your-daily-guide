import { describe, expect, it } from "bun:test";

import { classifyPushResponse } from "./push-response";

describe("classifyPushResponse", () => {
  it("2xx es enviado", () => {
    for (const status of [200, 201, 202]) expect(classifyPushResponse(status)).toBe("sent");
  });

  it("404 y 410 son suscripción revocada", () => {
    for (const status of [404, 410]) expect(classifyPushResponse(status)).toBe("gone");
  });

  it("cualquier otro rechazo es fallo, no enviado", () => {
    for (const status of [400, 403, 413, 429, 500, 503]) {
      expect(classifyPushResponse(status)).toBe("failed");
    }
  });
});
