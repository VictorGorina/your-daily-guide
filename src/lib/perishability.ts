import {
  normName,
  shelfLifeDays,
  tripDayRange,
  type PlanCoverage,
  type ShoppingCadence,
  type ShoppingItem,
} from "@/lib/plan-shared";

// La tabla de vida útil vive en `shopping/shelf-life.ts`: también la usa
// `projectTrips` para la cadencia optimizada, y desde aquí habría un ciclo.
export { shelfLifeDays };

/**
 * Nombres de los frescos de una compra que no aguantan todos los días que esa
 * compra tiene que cubrir (p. ej. pescado en una compra bisemanal). No cambia
 * la lista: alimenta el aviso "cómpralo más cerca de cuando lo cocines".
 *
 * Misma cuenta que `stockUpAmounts`: comprado el día `from`, dura hasta
 * `from + vida`. Un tomate de 7 días llega al último de una compra de 8.
 */
export const freshRisksForTrip = (
  groups: { category: string; items: ShoppingItem[] }[],
  coverage: PlanCoverage,
  trips: number,
  tripIndex: number,
): string[] => {
  const { from, to } = tripDayRange(coverage, trips, tripIndex);
  const lastDay = to - from;
  const seen = new Set<string>();
  const risks: string[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (item.owned) continue;
      if (shelfLifeDays(item.name, group.category, item.perishable) >= lastDay) continue;
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

/**
 * El aviso entero. Con la cadencia optimizada lo que no llega ya se compra en
 * cada salida, así que "cómpralo más cerca" no dice nada: se propone congelar
 * o comprarlo el día. `shop` es el modo compra, con la lista ya en la mano.
 */
export const freshRiskText = (
  names: string[],
  spanDays: number,
  cadence: ShoppingCadence,
  shop = false,
): string => {
  const one = names.length === 1;
  const s = one ? "" : "s";
  const head = `${freshRiskNames(names)} no ${one ? "aguanta" : "aguantan"}`;
  if (cadence === "optimizada") {
    return `${head} hasta la próxima compra. Congélalo${s} al llegar o cómpralo${s} el día que lo${s} cocines.`;
  }
  return shop
    ? `${head} los ${spanDays} días hasta la próxima compra. Cógelo${s} justo para los primeros platos.`
    : `${head} los ${spanDays} días de esta compra. Cómpralo${s} más cerca de cuando los vayas a cocinar.`;
};
