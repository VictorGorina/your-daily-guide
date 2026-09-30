import { createFileRoute } from "@tanstack/react-router";

import { CspReportThrottle, parseCspReport } from "@/lib/csp";
import { logEvent } from "@/lib/log.server";

// Informes de la CSP en modo Report-Only (ticket 16). Sin sesión: el navegador
// los manda solo, sin cookies ni cabecera de autorización. Siempre 204, también
// con un cuerpo que no se entiende: al navegador no le sirve otra respuesta.
const MAX_REPORT_BYTES = 16 * 1024;
const throttle = new CspReportThrottle();

export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declared = Number(request.headers.get("content-length") ?? 0);
        if (declared > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
        const text = await request.text();
        if (text.length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });

        let raw: unknown = null;
        try {
          raw = JSON.parse(text);
        } catch {
          // Cuerpo que no es JSON: no hay nada que registrar.
        }
        const now = Date.now();
        for (const report of parseCspReport(raw)) {
          if (throttle.shouldLog(report, now)) logEvent("warn", "csp_violation", report);
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
