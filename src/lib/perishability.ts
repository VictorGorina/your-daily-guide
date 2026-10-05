import {
  freezesWell,
  normName,
  shelfLifeDays,
  tripDayRange,
  type PlanCoverage,
  type ShoppingCadence,
  type ShoppingItem,
} from "@/lib/plan-shared";
import type { Translate } from "@/lib/week-nav";

// La tabla de vida útil vive en `shopping/shelf-life.ts`: también la usa
// `projectTrips` para la cadencia optimizada, y desde aquí habría un ciclo.
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
export const freshRiskNames = (names: string[], t: Translate, shown = 2): string => {
  if (names.length <= shown + 1) {
    if (names.length <= 1) return names[0] ?? "";
    return t("common.listAnd", {
      rest: names.slice(0, -1).join(", "),
      last: names[names.length - 1] ?? "",
    });
  }
  return t("freshRisk.more", {
    shown: names.slice(0, shown).join(", "),
    n: names.length - shown,
  });
};

/**
 * El aviso entero. Con la cadencia optimizada lo que no llega ya se compra en
 * cada salida, así que "cómpralo más cerca" no dice nada: se propone congelar
 * o comprarlo el día. Congelar, solo lo que se congela (`freezesWell`): a una
 * lechuga o un plátano se les dice que se compren el día, y si hay de los dos
 * el aviso los separa. `shop` es el modo compra, con la lista ya en la mano.
 * El texto sale del catálogo (`freshRisk.*`): `t` es el traductor de la pantalla.
 */
export const freshRiskText = (
  names: string[],
  spanDays: number,
  cadence: ShoppingCadence,
  t: Translate,
  shop = false,
): string => {
  // El plural va con cuántos nombres hay, no con los que se enseñan ("A, B y 3 más").
  const say = (key: string, list: string[]) =>
    t(`freshRisk.${key}`, { names: freshRiskNames(list, t), days: spanDays, count: list.length });
  if (cadence === "optimizada") {
    const frozen = names.filter(freezesWell);
    const fresh = names.filter((name) => !freezesWell(name));
    if (!fresh.length) return say("freezeAll", names);
    if (!frozen.length) return say("buyOnDay", names);
    return `${say("mixedFrozen", frozen)} ${say("mixedFresh", fresh)}`;
  }
  return say(shop ? "shop" : "trip", names);
};
