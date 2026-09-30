import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { buildCsp, PERMISSIONS_POLICY } from "@/lib/csp";
import { errorText, logEvent } from "@/lib/log.server";
import { publicError } from "@/lib/public-error";
import { captureServerException } from "@/lib/sentry.server";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    captureServerException(error, { where: "ssr" });
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// SEC-S-14: lo que lanza una server function viaja a la web serializado con
// todas sus propiedades (un error de PostgREST, con `details` y `hint`). Aquí se
// sustituye por uno genérico lo que no está escrito para la persona, y el
// original queda en el log y en Sentry. Va el primero: envuelve también el
// validador y `requireSupabaseAuth`. `apiPost` recibe ya el sustituto.
const publicErrorMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    const shown = publicError(error);
    if (shown !== error) {
      const code = (error as { code?: unknown } | null)?.code;
      logEvent("warn", "server_fn_failed", {
        code: typeof code === "string" ? code : undefined,
        error: errorText(error),
      });
      captureServerException(error, { where: "serverFn" });
    }
    throw shown;
  }
});

// TanStack Start lo instala solo cuando no existe src/start.ts; al definir el
// archivo se pierde, así que se vuelve a añadir a mano para que las server
// functions sigan protegidas frente a peticiones de otros sitios (CSRF).
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Los mismos orígenes que usa el navegador: el cliente de Supabase y Sentry
// leen estas variables, que Vite incrusta en el build (ticket 16).
const CSP = buildCsp({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  sentryDsn: import.meta.env.VITE_SENTRY_DSN,
  dev: import.meta.env.DEV,
});

// H-07: Cabeceras de seguridad en todas las respuestas del servidor.
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const response = await next();
  const headers = new Headers(response.response.headers);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Solo observa (ticket 16); se aplica en el ticket 37.
  headers.set("Content-Security-Policy-Report-Only", CSP);
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  return new Response(response.response.body, {
    status: response.response.status,
    headers,
  });
});

export const startInstance = createStart(() => ({
  functionMiddleware: [publicErrorMiddleware, attachSupabaseAuth],
  requestMiddleware: [securityHeadersMiddleware, errorMiddleware, csrfMiddleware],
}));
