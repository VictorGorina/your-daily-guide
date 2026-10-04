import {
  normName,
  shelfLifeDays,
  tripDayRange,
  type PlanCoverage,
  type ShoppingItem,
} from "@/lib/plan-shared";

// La tabla de vida útil vive en `shopping/shelf-life.ts`: también la usa
// `projectTrips` para la cadencia optimizada, y desde aquí habría un ciclo.
export { shelfLifeDays };

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
