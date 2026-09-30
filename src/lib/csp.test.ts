import { describe, expect, test } from "bun:test";

import {
  buildCsp,
  CspReportThrottle,
  parseCspReport,
  PERMISSIONS_POLICY,
  withoutQuery,
} from "./csp";

const SUPABASE = "https://abcd.supabase.co";
const SENTRY_DSN = "https://publickey@o1.ingest.de.sentry.io/42";

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name!, values.join(" ")];
    }),
  );
}

describe("buildCsp", () => {
  test("connect-src deja Supabase por https y por wss, y el ingest de Sentry", () => {
    const d = directives(buildCsp({ supabaseUrl: SUPABASE, sentryDsn: SENTRY_DSN }));
    expect(d.get("connect-src")).toBe(
      "'self' https://abcd.supabase.co wss://abcd.supabase.co https://o1.ingest.de.sentry.io",
    );
  });

  test("la clave pública del DSN no entra en la política", () => {
    const csp = buildCsp({ supabaseUrl: SUPABASE, sentryDsn: SENTRY_DSN });
    expect(csp).toContain("o1.ingest.de.sentry.io");
    expect(csp).not.toContain("publickey");
  });

  test("sin DSN ni URL de Supabase (o mal formadas) queda solo 'self'", () => {
    expect(directives(buildCsp({})).get("connect-src")).toBe("'self'");
    expect(
      directives(buildCsp({ supabaseUrl: "no es una url", sentryDsn: "tampoco" })).get(
        "connect-src",
      ),
    ).toBe("'self'");
  });

  test("en desarrollo deja además el websocket del HMR", () => {
    const d = directives(buildCsp({ supabaseUrl: SUPABASE, dev: true }));
    expect(d.get("connect-src")).toBe(
      "'self' https://abcd.supabase.co wss://abcd.supabase.co ws://localhost:*",
    );
  });

  test("fuentes propias (ticket 17), imágenes del tiquet y nada incrustable", () => {
    const d = directives(buildCsp({ supabaseUrl: SUPABASE }));
    expect(d.get("default-src")).toBe("'self'");
    expect(d.get("font-src")).toBe("'self'");
    expect(d.get("style-src")).toBe("'self' 'unsafe-inline'");
    expect(d.get("img-src")).toBe("'self' data: blob:");
    expect(d.get("frame-ancestors")).toBe("'none'");
    expect(d.get("object-src")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'self'");
    expect(d.get("form-action")).toBe("'self'");
    expect(d.get("report-uri")).toBe("/api/csp-report");
  });
});

describe("PERMISSIONS_POLICY", () => {
  test("micrófono (dictado) y cámara (foto del tiquet) solo para el propio origen", () => {
    expect(PERMISSIONS_POLICY).toContain("microphone=(self)");
    expect(PERMISSIONS_POLICY).toContain("camera=(self)");
    expect(PERMISSIONS_POLICY).toContain("geolocation=()");
    expect(PERMISSIONS_POLICY).toContain("payment=()");
  });
});

describe("withoutQuery", () => {
  test("quita query y fragmento, que pueden llevar tokens", () => {
    expect(withoutQuery("https://www.peppersfam.es/reset?code=abc#access_token=x")).toBe(
      "https://www.peppersfam.es/reset",
    );
  });

  test("deja tal cual las palabras clave de CSP", () => {
    expect(withoutQuery("inline")).toBe("inline");
    expect(withoutQuery("eval")).toBe("eval");
  });

  test("vacío o no texto → undefined", () => {
    expect(withoutQuery("")).toBeUndefined();
    expect(withoutQuery(42)).toBeUndefined();
  });
});

describe("parseCspReport", () => {
  test("formato report-uri", () => {
    const report = parseCspReport({
      "csp-report": {
        "document-uri": "https://www.peppersfam.es/hoy?x=1",
        "violated-directive": "img-src 'self' data: blob:",
        "effective-directive": "img-src",
        "blocked-uri": "https://evil.example/pixel.png?leak=secret",
      },
    });
    expect(report).toEqual([
      {
        directive: "img-src",
        blocked: "https://evil.example/pixel.png",
        page: "https://www.peppersfam.es/hoy",
      },
    ]);
  });

  test("sin effective-directive usa la primera palabra de violated-directive", () => {
    const [report] = parseCspReport({
      "csp-report": { "violated-directive": "script-src-elem 'self'", "blocked-uri": "inline" },
    });
    expect(report?.directive).toBe("script-src-elem");
    expect(report?.blocked).toBe("inline");
  });

  test("formato de la Reporting API (lote), ignorando lo que no es csp-violation", () => {
    const reports = parseCspReport([
      {
        type: "csp-violation",
        body: {
          documentURL: "https://www.peppersfam.es/plan#x",
          effectiveDirective: "connect-src",
          blockedURL: "https://tracker.example/collect?id=1",
        },
      },
      { type: "deprecation", body: { id: "x" } },
    ]);
    expect(reports).toEqual([
      {
        directive: "connect-src",
        blocked: "https://tracker.example/collect",
        page: "https://www.peppersfam.es/plan",
      },
    ]);
  });

  test("basura → lista vacía", () => {
    expect(parseCspReport(null)).toEqual([]);
    expect(parseCspReport("hola")).toEqual([]);
    expect(parseCspReport({ "csp-report": "x" })).toEqual([]);
    expect(parseCspReport({ "csp-report": {} })).toEqual([]);
  });

  test("como mucho 20 informes por lote", () => {
    const one = { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "a" } };
    expect(parseCspReport(Array.from({ length: 50 }, () => one))).toHaveLength(20);
  });
});

describe("CspReportThrottle", () => {
  const r = { directive: "img-src", blocked: "https://a.example/x.png" };

  test("una vez por directiva + blocked y minuto", () => {
    const t = new CspReportThrottle();
    expect(t.shouldLog(r, 0)).toBe(true);
    expect(t.shouldLog(r, 30_000)).toBe(false);
    expect(t.shouldLog({ ...r, directive: "connect-src" }, 30_000)).toBe(true);
    expect(t.shouldLog(r, 60_000)).toBe(true);
  });

  test("con el mapa lleno barre lo caducado y, si no hay hueco, deja de registrar", () => {
    const t = new CspReportThrottle(2);
    expect(t.shouldLog({ directive: "a", blocked: "1" }, 0)).toBe(true);
    expect(t.shouldLog({ directive: "a", blocked: "2" }, 0)).toBe(true);
    expect(t.shouldLog({ directive: "a", blocked: "3" }, 10)).toBe(false);
    expect(t.size).toBe(2);
    expect(t.shouldLog({ directive: "a", blocked: "3" }, 60_000)).toBe(true);
    expect(t.size).toBe(1);
  });
});
