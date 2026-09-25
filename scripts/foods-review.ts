/**
 * Revisión de los alimentos traídos de USDA (`foods_extra`, ticket 22 de
 * `precision-nutricional`): los que están sin revisar, con su descripción y su
 * fdcId de USDA, para pasarlos a la tabla (`foods.data.ts`, con su fuente) o
 * corregirlos. Sustituye a la tabla `unmatched_ingredients` que proponía el 04.
 *
 * Solo lee, salvo `--mark <key>`, que la marca como revisada.
 *
 *   bun run foods:review
 *   bun run foods:review --mark usda-171401
 */
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: { limit: { type: "string", default: "50" }, mark: { type: "string" } },
});

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (en .env).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

if (args.mark) {
  const { data, error } = await db
    .from("foods_extra")
    .update({ reviewed: true })
    .eq("key", args.mark)
    .select("key");
  if (error) throw error;
  console.log(data?.length ? `✓ ${args.mark} revisada` : `No existe «${args.mark}».`);
  process.exit(0);
}

const { data, error } = await db
  .from("foods_extra")
  .select("key, label, category, kcal, protein_g, carbs_g, fat_g, source_id, source_label, hits")
  .eq("reviewed", false)
  .order("hits", { ascending: false })
  .order("created_at", { ascending: false })
  .limit(Math.max(1, Number(args.limit) || 50));
if (error) {
  console.error(
    error.code === "PGRST205" ? "La tabla foods_extra no existe: aplica la migración." : error,
  );
  process.exit(1);
}
for (const f of data ?? []) {
  console.log(
    `${f.key.padEnd(14)} «${f.label}» (${f.category}) → USDA ${f.source_id} «${f.source_label}»: ` +
      `${f.kcal} kcal · P ${f.protein_g} · H ${f.carbs_g} · G ${f.fat_g} · ${f.hits} usos`,
  );
}
if (!data?.length) console.log("Nada por revisar.");
