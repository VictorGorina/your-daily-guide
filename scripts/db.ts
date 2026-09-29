/**
 * Inspector de solo lectura de la base de datos, para verificar cambios sin
 * salir de la terminal. Ver docs/agents/verification.md §3.
 *
 * NO ejecuta SQL: este proyecto no tiene la contraseña de Postgres ni la CLI de
 * Supabase en local (ver docs/agents/verification.md). Va por PostgREST con
 * `@supabase/supabase-js`, el mismo camino que usa la app, y solo expone
 * `.select()` / count / probe — nunca insert, update, delete ni rpc.
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY, así que se salta las políticas RLS: es una
 * herramienta de desarrollo, no se despliega. Para probar flujos que MUTAN
 * datos, entra en la app con el perfil demo, no escribas aquí.
 *
 * Datos de salud, texto libre y nombres de personas reales salen enmascarados
 * (`SENSITIVE_COLUMNS` en `db-mask.ts`): sin `--select` ni aparecen, y pedidos
 * con `--select` salen como "[oculto]". `--unmask` los enseña, con un aviso.
 *
 * Uso:
 *   bun scripts/db.ts <tabla> [opciones]
 *
 * Opciones:
 *   --select <cols>   columnas separadas por coma (por defecto, todas menos las sensibles)
 *   --eq <col=valor>  filtro de igualdad (repetible)
 *   --order <col>     ordenar por columna; prefijo "-" para descendente
 *   --limit <n>       máximo de filas (por defecto 20)
 *   --count           solo el número de filas, sin traerlas
 *   --probe <col>     comprueba si <col> existe en <tabla> (útil tras una migración)
 *   --unmask          enseña las columnas sensibles (datos de salud de personas reales)
 *
 * Ejemplos:
 *   bun scripts/db.ts profiles --select id,tone,onboarding_completed --limit 5
 *   bun scripts/db.ts daily_logs --eq log_date=2026-08-29 --count
 *   bun scripts/db.ts profiles --probe menstrual_cycle
 */
import { createClient } from "@supabase/supabase-js";

import { maskRows, sensitiveInSelect } from "./db-mask";

const USAGE = `Uso: bun scripts/db.ts <tabla> [--select cols] [--eq col=valor] [--order col] [--limit n] [--count] [--probe col] [--unmask]`;

function fail(message: string): never {
  console.error(`\x1b[31m${message}\x1b[0m`);
  process.exit(1);
}

// --- argumentos -----------------------------------------------------------

const args = process.argv.slice(2);
if (!args.length || args[0]?.startsWith("--")) fail(USAGE);

const table = args[0]!;
const opts: {
  select: string;
  eq: [string, string][];
  order?: string;
  limit: number;
  count: boolean;
  probe?: string;
  explicitSelect: boolean;
  unmask: boolean;
} = { select: "*", eq: [], limit: 20, count: false, explicitSelect: false, unmask: false };

for (let i = 1; i < args.length; i++) {
  const flag = args[i];
  const next = () => args[++i] ?? fail(`Falta el valor de ${flag}`);
  if (flag === "--select") {
    opts.select = next();
    opts.explicitSelect = true;
  } else if (flag === "--unmask") opts.unmask = true;
  else if (flag === "--order") opts.order = next();
  else if (flag === "--limit") opts.limit = Number(next());
  else if (flag === "--count") opts.count = true;
  else if (flag === "--probe") opts.probe = next();
  else if (flag === "--eq") {
    const raw = next();
    const eq = raw.indexOf("=");
    if (eq < 0) fail(`--eq espera col=valor, recibí "${raw}"`);
    opts.eq.push([raw.slice(0, eq), raw.slice(eq + 1)]);
  } else fail(`Opción desconocida: ${flag}\n${USAGE}`);
}

// --- cliente ------------------------------------------------------------

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");

// Las claves nuevas de Supabase (sb_secret_...) son opacas, no JWT: PostgREST
// las quiere en la cabecera `apikey`, no como Bearer. Mismo ajuste que hace la
// app en src/integrations/supabase/client.server.ts.
const isOpaqueKey = key.startsWith("sb_secret_") || key.startsWith("sb_publishable_");
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (isOpaqueKey && headers.get("Authorization") === `Bearer ${key}`) {
        headers.delete("Authorization");
      }
      headers.set("apikey", key);
      return fetch(input, { ...init, headers });
    },
  },
});

console.error(
  `\x1b[2m[db] ${url} · service-role (RLS desactivada) · solo lectura` +
    `${opts.unmask ? "" : " · datos sensibles ocultos"}\x1b[0m`,
);

// --- probe: ¿existe la columna? ---------------------------------------

if (opts.probe) {
  const { error } = await supabase.from(table).select(opts.probe).limit(1);
  if (!error) {
    console.log(`\x1b[32m✓\x1b[0m ${table}.${opts.probe} existe`);
    process.exit(0);
  }
  // 42703 = undefined_column en Postgres
  if (error.code === "42703" || /column .* does not exist/i.test(error.message)) {
    console.log(`\x1b[33m✗\x1b[0m ${table}.${opts.probe} no existe`);
    process.exit(0);
  }
  fail(`Error consultando ${table}.${opts.probe}: ${error.message}`);
}

// --- consulta ---------------------------------------------------------

let query = opts.count
  ? supabase
      .from(table)
      .select(opts.select === "*" ? "*" : opts.select, { count: "exact", head: true })
  : supabase.from(table).select(opts.select).limit(opts.limit);

for (const [col, val] of opts.eq) query = query.eq(col, val);
if (opts.order && !opts.count) {
  query = query.order(opts.order.replace(/^-/, ""), { ascending: !opts.order.startsWith("-") });
}

const { data, error, count } = await query;
if (error) fail(`${error.message}${error.hint ? ` (${error.hint})` : ""}`);

if (opts.count) {
  console.log(
    `${count} fila(s) en ${table}${opts.eq.length ? ` con ${opts.eq.map(([c, v]) => `${c}=${v}`).join(", ")}` : ""}`,
  );
} else {
  if (opts.unmask) {
    const shown = opts.explicitSelect ? sensitiveInSelect(table, opts.select) : [];
    console.error(
      `\x1b[1;31mAVISO: estás mostrando datos de salud de personas reales` +
        `${shown.length ? ` (${shown.join(", ")})` : ""}. No los copies a un chat ni a un issue.\x1b[0m`,
    );
  }
  const mode = opts.unmask ? "show" : opts.explicitSelect ? "hide" : "omit";
  console.log(JSON.stringify(maskRows(table, data, mode), null, 2));
  console.error(`\x1b[2m${data?.length ?? 0} fila(s)\x1b[0m`);
}
