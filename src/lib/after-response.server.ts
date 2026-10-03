import { getRequest } from "@tanstack/react-start/server";

/**
 * Trabajo que sigue después de responder (ticket 15 de la auditoría).
 *
 * En Vercel la función puede congelarse en cuanto sale la respuesta: lo que
 * siga pendiente solo termina si se le pasa a `waitUntil`. El de
 * `@vercel/functions` lee un contexto global que en este despliegue (Nitro,
 * preset `vercel`) puede no existir, y entonces no hace nada y no avisa: así se
 * perdió el correo de recuperar la contraseña. El puente que sí monta Nitro es
 * otro: su entrada web recibe `fetch(req, context)` y copia
 * `req.waitUntil = context.waitUntil` en la propia petición, que TanStack Start
 * pasa tal cual a las rutas y a `getRequest()`.
 *
 * Por eso se prueba primero el de la petición y después el global, y se
 * devuelve cuál se usó: `"none"` significa que nada mantiene viva la función, y
 * quien llama decide si eso merece un log (aquí no se puede importar
 * `log.server`, que importa `sentry.server`, que importa esto). `/api/health`
 * con el secreto del cron dice cuál hay en producción.
 */

export type WaitUntilVia = "request" | "vercel-context" | "none";

type WaitUntil = (promise: Promise<unknown>) => void;

/** El global que lee `@vercel/functions` (`get-context.js`). */
export const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

/** Qué `waitUntil` hay: el de la petición, el del contexto global o ninguno. */
export function resolveWaitUntil(
  request: unknown,
  vercelContext: unknown,
): { via: WaitUntilVia; waitUntil?: WaitUntil } {
  const own = (request as { waitUntil?: unknown } | undefined)?.waitUntil;
  if (typeof own === "function") {
    // Sobre la petición, como hace h3 (`this.req.waitUntil?.(promise)`).
    return { via: "request", waitUntil: (p) => own.call(request, p) };
  }
  const get = (vercelContext as { get?: unknown } | undefined)?.get;
  const context = typeof get === "function" ? (get() as { waitUntil?: unknown } | undefined) : null;
  const fromContext = context?.waitUntil;
  if (typeof fromContext === "function") {
    return { via: "vercel-context", waitUntil: (p) => fromContext.call(context, p) };
  }
  return { via: "none" };
}

/** La petición en curso, o `undefined` fuera de una (tests, scripts). */
function currentRequest(): Request | undefined {
  try {
    return getRequest();
  } catch {
    return undefined;
  }
}

function resolveHere(request?: Request) {
  return resolveWaitUntil(
    request ?? currentRequest(),
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT],
  );
}

/** Qué puente hay para esta petición (sin usarlo): para `/api/health`. */
export function waitUntilVia(request?: Request): WaitUntilVia {
  return resolveHere(request).via;
}

/**
 * Mantiene viva la función hasta que `promise` acabe. Sin `request` usa la de
 * la petición en curso. Nunca lanza: si no hay puente, la promesa sigue igual
 * (en local el proceso no se congela) y devuelve `"none"`.
 */
export function afterResponse(promise: Promise<unknown>, request?: Request): WaitUntilVia {
  const { via, waitUntil } = resolveHere(request);
  if (!waitUntil) return "none";
  try {
    waitUntil(promise);
    return via;
  } catch {
    return "none";
  }
}
