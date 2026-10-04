// Copia de `src/lib/perishability.ts` de la web (no hay código compartido, ver
// AGENTS.md). Si cambia allí, hay que replicarlo aquí.
import {
  normName,
  tripDayRange,
  type PlanCoverage,
  type ShoppingCadence,
  type ShoppingItem,
} from "./plan-shared";
import { freezesWell, shelfLifeDays } from "./shelf-life";

export { freezesWell, shelfLifeDays };

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
 * o comprarlo el día. Congelar, solo lo que se congela (`freezesWell`): a una
 * lechuga o un plátano se les dice que se compren el día, y si hay de los dos
 * el aviso los separa. `shop` es el modo compra, con la lista ya en la mano.
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
    const frozen = names.filter(freezesWell);
    const fresh = names.filter((name) => !freezesWell(name));
    if (!fresh.length) {
      return `${head} hasta la próxima compra. Congélalo${s} al llegar o cómpralo${s} el día que lo${s} cocines.`;
    }
    const p = fresh.length === 1 ? "" : "s";
    const buy = `ómpralo${p} el día que lo${p} vayas a usar.`;
    if (!frozen.length) return `${head} hasta la próxima compra. C${buy}`;
    const f = frozen.length === 1 ? "" : "s";
    return (
      `${freshRiskNames(frozen)} no aguanta${f ? "n" : ""} hasta la próxima compra: congélalo${f} al llegar. ` +
      `${freshRiskNames(fresh)} tampoco y no se congela${p ? "n" : ""} bien: c${buy}`
    );
  }
  return shop
    ? `${head} los ${spanDays} días hasta la próxima compra. Cógelo${s} justo para los primeros platos.`
    : `${head} los ${spanDays} días de esta compra. Cómpralo${s} más cerca de cuando los vayas a cocinar.`;
};
