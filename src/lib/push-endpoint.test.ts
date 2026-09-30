import { describe, expect, test } from "bun:test";

import { isAllowedPushEndpoint } from "./push-endpoint";

describe("isAllowedPushEndpoint", () => {
  test.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://android.googleapis.com/gcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://push.services.mozilla.com/abc",
    "https://web.push.apple.com/QGx",
    // Edge / WNS (NUEVO-02): hoy se rechazaba y Edge no podía suscribirse.
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://fcm.googleapis.com:443/fcm/send/abc",
  ])("acepta %s", (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  test.each([
    ["un host que solo empieza igual", "https://fcm.googleapis.com.evil.com/x"],
    ["http", "http://fcm.googleapis.com/x"],
    ["usuario y contraseña", "https://user:pw@fcm.googleapis.com/x"],
    ["otro puerto", "https://fcm.googleapis.com:8443/x"],
    ["barra invertida antes de @", "https://evil.com\\@fcm.googleapis.com/x"],
    ["sufijo sin punto delante", "https://xfcm.googleapis.com/x"],
    ["host ajeno", "https://evil.example/x"],
    ["demasiado largo", `https://fcm.googleapis.com/${"a".repeat(600)}`],
    ["vacío", ""],
    ["no es una URL", "fcm.googleapis.com/x"],
  ])("rechaza %s", (_label, url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });

  test("no es texto → no", () => {
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
    expect(isAllowedPushEndpoint(42)).toBe(false);
  });
});
