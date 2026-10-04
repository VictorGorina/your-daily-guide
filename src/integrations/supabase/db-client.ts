import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "./types";

/**
 * El cliente de Supabase con el esquema de la base de datos: el tipo que piden
 * los helpers de servidor. Vale igual para el cliente con la sesión de la
 * persona (`context.supabase`) y para `supabaseAdmin`.
 */
export type DbClient = SupabaseClient<Database>;

/** La fila de `profiles` tal cual llega de la base de datos (`select("*")`). */
export type ProfileRow = Tables<"profiles">;

/**
 * Columnas de `profiles`, las que traiga la lectura: lo que reciben las
 * funciones que solo miran unas cuantas (objetivo energético, prompt del coach).
 */
export type ProfilePart = Partial<ProfileRow>;
