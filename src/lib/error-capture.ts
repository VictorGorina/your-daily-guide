// Guarda aparte el Error original para que server.ts pueda recuperar la traza
// cuando h3 ya se ha tragado lo lanzado y lo ha convertido en una 500 genérica.
//
// Un cajón por petición (ARQ-03): con Fluid Compute una instancia atiende varias
// a la vez, y con una variable del módulo el error de una acababa en el log de
// la 500 de otra. `server.ts` abre el cajón con `withErrorCapture`.
import { AsyncLocalStorage } from "node:async_hooks";

type Captured = { error: unknown; at: number };
const requestSlot = new AsyncLocalStorage<{ last?: Captured }>();
const TTL_MS = 5_000;

/** Ejecuta `fn` (una petición) con su propio cajón para el último error. */
export function withErrorCapture<T>(fn: () => T): T {
  return requestSlot.run({}, fn);
}

function record(error: unknown) {
  const slot = requestSlot.getStore();
  // Fuera de una petición no hay a quién atribuirlo.
  if (slot) slot.last = { error, at: Date.now() };
}

// El HTTPError de h3 se serializa como {"status":500,"unhandled":true,"message":"HTTPError"}
// —sin traza ni causa—, así que un console.error(error) a secas llega a los logs sin el
// detalle del fallo. Los argumentos con forma de Error se expanden a un texto que conserva
// el mensaje, la traza y toda la cadena de causas.
const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === "string" ? current : safeStringify(current));
      break;
    }
    const label = depth === 0 ? "" : "caused by: ";
    const status = describeStatus(current);
    parts.push(`${label}${current.stack ?? `${current.name}: ${current.message}`}${status}`);
    current = current.cause;
  }
  return parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT);
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" ? ` (status ${value})` : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

// Se envuelve console.error para que lo que registre cualquier capa —también el log
// interno de errores no capturados de h3, al que este archivo no puede engancharse
// directamente— quede guardado para consumeLastCapturedError y expandido antes de
// serializarse.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const expanded = args.map((arg) => {
    if (!isErrorLike(arg)) return arg;
    record(arg);
    return describeError(arg);
  });
  originalConsoleError(...expanded);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  const slot = requestSlot.getStore();
  const captured = slot?.last;
  if (!slot || !captured) return undefined;
  slot.last = undefined;
  return Date.now() - captured.at > TTL_MS ? undefined : captured.error;
}
