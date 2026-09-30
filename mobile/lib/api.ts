import Constants from "expo-constants";
import { supabase } from "./supabase";

/**
 * Cliente de las rutas /api/v1/* de la app web (ver AGENTS.md en la raíz).
 * Son las operaciones que no se pueden hacer desde el cliente: las que llaman
 * a la IA o necesitan la clave de servicio. El CRUD normal (perfil, registros
 * del día, hogar) va directo por `supabase`, igual que en la web.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error("Falta EXPO_PUBLIC_API_URL. Copia mobile/.env.example a mobile/.env.");
}

const BASE_URL = API_URL.replace(/\/$/, "");

// El token de sesión viaja en cada petición: fuera de desarrollo, solo por https.
if (!__DEV__ && !BASE_URL.startsWith("https://")) {
  throw new Error(`EXPO_PUBLIC_API_URL debe ser https:// en una build (es ${BASE_URL}).`);
}

/** Origen del backend (sin barra final), p. ej. para el streaming de `/api/chat`. */
export const API_BASE_URL = BASE_URL;

/**
 * Versión de la app que hace la petición («1.0.0+1»). Con ella el servidor
 * sabe qué builds siguen vivas antes de retirar un alias legacy de la API.
 */
export const CLIENT_VERSION_HEADERS = {
  "X-Client-Version": `${Constants.expoConfig?.version ?? "?"}+${Constants.expoConfig?.ios?.buildNumber ?? "?"}`,
};

/** Token de la sesión de Supabase, o null si no hay sesión. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Segundos que pide esperar el servidor (429, cabecera `retry-after`). */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
// Un poco por encima del presupuesto del servidor (270 s, src/lib/deadline.ts)
// y por debajo de los 300 s de la función de Vercel: antes llega su respuesta
// («Calculando…») que nuestro aborto.
const LONG_TIMEOUT_MS = 280_000;

/**
 * Rutas que llaman a la IA y pueden tardar minutos. Sacada de
 * src/routes/api/v1/ (ticket 27): si se añade una ruta con IA, va aquí.
 */
const LONG_ROUTES = new Set([
  "guide",
  "onboarding/parse",
  "plan/adjust",
  "plan/child-meal",
  "plan/child-meal-fill",
  "plan/compensate",
  "plan/compensate-future",
  "plan/fit",
  "plan/generate",
  "plan/goal-impact",
  "plan/meal",
  "plan/receipt",
  "plan/recipe",
  "plan/reflow",
  "plan/welcome",
  "recipes/warm",
  "snacks/estimate",
  "day/settle",
  "exercise/settle",
  "snacks/settle",
]);

const TIMEOUT_MESSAGE = "La conexión ha tardado demasiado. Inténtalo de nuevo.";

async function post<TOutput>(path: string, body: unknown, token: string | null): Promise<TOutput> {
  // Hermes puede no traer `AbortSignal.timeout`: controlador + temporizador.
  // Cubre también la lectura del cuerpo, no solo la llegada de las cabeceras.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    LONG_ROUTES.has(path) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${BASE_URL}/api/v1/${path}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...CLIENT_VERSION_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      // La API devuelve {"error": mensaje}; 400, 429 y algunos 500 traen un texto
      // pensado para enseñarse tal cual, el resto de 500 uno genérico. Así que
      // se enseña siempre el mensaje, y el código solo decide qué hacer (401).
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new ApiError(
        payload?.error ?? "No hemos podido completar la acción",
        response.status,
        response.status === 429 && retryAfter > 0 ? retryAfter : undefined,
      );
    }

    return (await response.json()) as TOutput;
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(TIMEOUT_MESSAGE, 408);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Un solo refresco en vuelo: varias peticiones con 401 a la vez comparten el
// mismo, en vez de gastar cada una el refresh token (Supabase lo rota).
let refreshing: Promise<string | null> | null = null;

function refreshedToken(): Promise<string | null> {
  refreshing ??= supabase.auth
    .refreshSession()
    .then(({ data }) => data.session?.access_token ?? null)
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function apiPost<TOutput>(path: string, body?: unknown): Promise<TOutput> {
  const token = await getAccessToken();
  if (!token) throw new ApiError("No hay sesión", 401);
  try {
    return await post<TOutput>(path, body, token);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    // Lo normal es un token caducado que el auto-refresh aún no ha renovado
    // (la app vuelve del fondo): se renueva una vez y se repite.
    const fresh = await refreshedToken();
    // Sin token nuevo no se cierra la sesión aquí: si el refresh token no vale,
    // supabase-js ya la ha borrado; si ha fallado la red, se conserva.
    if (!fresh) throw error;
    try {
      return await post<TOutput>(path, body, fresh);
    } catch (retryError) {
      // Token recién emitido y el servidor sigue sin aceptarlo: la sesión no
      // sirve. Se cierra solo en este dispositivo (el guard de sesión del
      // layout lleva a la pantalla de acceso).
      if (retryError instanceof ApiError && retryError.status === 401) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      }
      throw retryError;
    }
  }
}

/**
 * Como `apiPost` pero sin sesión, para las operaciones que se piden justamente
 * cuando no se puede entrar: hoy solo recuperar la contraseña. Úsala únicamente
 * con rutas pensadas para ser públicas.
 */
export async function apiPostPublic<TOutput>(path: string, body?: unknown): Promise<TOutput> {
  return post<TOutput>(path, body, null);
}
