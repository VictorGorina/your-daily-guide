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

/** Origen del backend (sin barra final), p. ej. para el streaming de `/api/chat`. */
export const API_BASE_URL = BASE_URL;

/** Token de la sesión de Supabase, o null si no hay sesión. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function post<TOutput>(path: string, body: unknown, token: string | null): Promise<TOutput> {
  const response = await fetch(`${BASE_URL}/api/v1/${path}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    // La API devuelve {"error": mensaje} con textos pensados para enseñarse tal
    // cual; el código de estado no distingue "dato inválido" de "fallo real",
    // así que mandan el mensaje y el 401.
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(payload?.error ?? "No hemos podido completar la acción", response.status);
  }

  return (await response.json()) as TOutput;
}

export async function apiPost<TOutput>(path: string, body?: unknown): Promise<TOutput> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("No hay sesión", 401);
  return post<TOutput>(path, body, token);
}

/**
 * Como `apiPost` pero sin sesión, para las operaciones que se piden justamente
 * cuando no se puede entrar: hoy solo recuperar la contraseña. Úsala únicamente
 * con rutas pensadas para ser públicas.
 */
export async function apiPostPublic<TOutput>(path: string, body?: unknown): Promise<TOutput> {
  return post<TOutput>(path, body, null);
}
