import { normName, tripDayRange, type PlanCoverage, type ShoppingItem } from "@/lib/plan-shared";

/**
 * Cuántos días aguanta en casa un ingrediente antes de estropearse. Se usa para
 * avisar cuando una compra tiene que cubrir más días de los que un fresco
 * resiste (p. ej. pescado en una compra bisemanal o mensual): la lista no se
 * reestructura — se sesga el plan hacia larga vida y se avisa de lo que no
 * llega. `Infinity` = despensa/congelado/conserva, no caduca a efectos de plan.
 *
 * Los valores son deliberadamente conservadores (nevera doméstica normal, sin
 * congelar) y aproximados: el objetivo es decidir "esto no aguanta dos semanas",
 * no gestionar caducidades reales.
 */

/** Palabra clave del nombre → días que aguanta. El primer match gana. */
const SHELF_LIFE_BY_KEYWORD: { match: string[]; days: number }[] = [
  {
    match: ["pescado", "merluza", "salmon", "atun fresco", "dorada", "lubina", "bacalao fresco"],
    days: 2,
  },
  {
    match: ["marisco", "gamba", "langostino", "mejillon", "almeja", "calamar", "sepia", "pulpo"],
    days: 2,
  },
  { match: ["carne picada", "pollo", "pavo", "higado"], days: 2 },
  { match: ["ternera", "cerdo", "cordero", "filete", "solomillo", "carne"], days: 3 },
  {
    match: [
      "espinaca",
      "acelga",
      "canonigo",
      "rucula",
      "lechuga",
      "escarola",
      "brote",
      "hoja",
      "berro",
    ],
    days: 4,
  },
  { match: ["fresa", "frambuesa", "mora", "arandano", "cereza", "higo", "frutos rojos"], days: 4 },
  {
    match: ["champinon", "seta", "brocoli", "esparrago", "guisante fresco", "haba fresca"],
    days: 5,
  },
  {
    match: [
      "aguacate",
      "platano",
      "pera",
      "melocoton",
      "nectarina",
      "ciruela",
      "albaricoque",
      "kiwi",
      "mango",
    ],
    days: 5,
  },
  { match: ["tomate", "pepino", "calabacin", "pimiento", "berenjena", "judia verde"], days: 7 },
  {
    match: ["leche fresca", "nata", "yogur", "queso fresco", "requeson", "queso de burgos"],
    days: 7,
  },
  { match: ["pan", "pan de molde"], days: 4 },
  {
    match: [
      "manzana",
      "naranja",
      "mandarina",
      "pomelo",
      "limon",
      "zanahoria",
      "remolacha",
      "col",
      "puerro",
      "apio",
    ],
    days: 15,
  },
  { match: ["huevo", "huevos"], days: 21 },
  // Larga vida en despensa fresca: no deberían saltar el aviso ni en una compra mensual.
  { match: ["patata", "cebolla", "ajo", "boniato", "calabaza", "nabo"], days: 32 },
];

/** Vida útil por categoría de la lista de la compra, cuando el nombre no da pistas. */
const SHELF_LIFE_BY_CATEGORY: Record<string, number> = {
  "Verdura y fruta": 6,
  Proteína: 3,
  Lácteos: 7,
  Despensa: Infinity,
  Otros: 10,
};

/**
 * Días que un ingrediente aguanta en casa. `perishable === false` (despensa,
 * congelado, conserva) nunca caduca a efectos del plan. Si el nombre encaja con
 * una palabra clave conocida se usa ese valor; si no, el de su categoría; y si
 * la categoría tampoco se reconoce, 10 días (fresco genérico prudente).
 */
export const shelfLifeDays = (name: string, category: string, perishable: boolean): number => {
  if (!perishable) return Infinity;
  const n = normName(name);
  for (const entry of SHELF_LIFE_BY_KEYWORD) {
    if (entry.match.some((kw) => n.includes(kw))) return entry.days;
  }
  return SHELF_LIFE_BY_CATEGORY[category] ?? 10;
};

/**
 * Nombres de los frescos de una compra que no aguantan todos los días que esa
 * compra tiene que cubrir (p. ej. pescado en una compra bisemanal). No cambia
 * la lista: alimenta el aviso "cómpralo más cerca de cuando lo cocines".
 */
export const freshRisksForTrip = (
  groups: { category: string; items: ShoppingItem[] }[],
  coverage: PlanCoverage,
  trips: number,
  tripIndex: number,
): string[] => {
  const { from, to } = tripDayRange(coverage, trips, tripIndex);
  const spanDays = to - from + 1;
  const seen = new Set<string>();
  const risks: string[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (item.owned) continue;
      if (shelfLifeDays(item.name, group.category, item.perishable) >= spanDays) continue;
      const key = normName(item.name);
      if (seen.has(key)) continue;
      seen.add(key);
      risks.push(item.name);
    }
  }
  return risks;
};

/** "Pescado", "Pescado y espinacas", "Pescado, espinacas y 3 más" — para el aviso. */
export const freshRiskNames = (names: string[], shown = 2): string => {
  if (names.length <= shown + 1) {
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  }
  return `${names.slice(0, shown).join(", ")} y ${names.length - shown} más`;
};
