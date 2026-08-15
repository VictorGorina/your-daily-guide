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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiPost<TOutput>(path: string, body?: unknown): Promise<TOutput> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("No hay sesión", 401);

  const response = await fetch(`${BASE_URL}/api/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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
