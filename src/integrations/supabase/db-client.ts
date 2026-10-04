import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * El cliente de Supabase con el esquema de la base de datos: el tipo que piden
 * los helpers de servidor. Vale igual para el cliente con la sesión de la
 * persona (`context.supabase`) y para `supabaseAdmin`.
 */
export type DbClient = SupabaseClient<Database>;
