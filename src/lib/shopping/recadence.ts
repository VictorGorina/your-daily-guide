import type { MonthlyPlan } from "../plan/types";
import {
  cadenceOf,
  isCanonicalShopping,
  monthCoverage,
  type ShoppingCadence,
  type ShoppingList,
  tripsForCoverage,
} from "./model";
import { withoutStoreMarks } from "./state";
import { carryOwnedByName, repartitionTrips, stockUpStart } from "./trips";

/**
 * El plan y la lista tras cambiar de cadencia, sin IA. `rewrite` dice si la
 * lista cambia y hay que guardarla.
 *
 * Una lista canónica no cambia al cambiar de cadencia (la pantalla la
 * re-proyecta): no se reescribe, para no pisar una marca que llegue a la vez.
 * Salvo al entrar o salir de la optimizada, que cambia qué lleva cada compra:
 * ahí se quitan las marcas "comprado" (`withoutStoreMarks`). Una antigua se
 * reparte entre EXACTAMENTE las compras que la pantalla va a enseñar para esta
 * cobertura: repartir entre más las dejaría fuera de la vista (ver
 * `repartitionTrips`).
 *
 * La optimizada elegida a mitad de mes rige desde la compra que toca hoy
 * (`cadenceFrom`): las anteriores ya pasaron y se quedan con lo de su semana.
 * Mientras no se salga de ella, ese ancla no se mueve.
 */
export function recadencePlan(
  current: MonthlyPlan,
  prevShopping: ShoppingList,
  cadence: ShoppingCadence,
  month: string,
  today: string,
): { plan: MonthlyPlan; shopping: ShoppingList; rewrite: boolean } {
  const { cadenceFrom: prevFrom = 0, ...rest } = current;
  const coverage = current.coverage ?? monthCoverage(month, today);
  const before = current.cadence ?? cadenceOf(prevShopping);
  const regrouped = (before === "optimizada") !== (cadence === "optimizada");
  const entering = regrouped && cadence === "optimizada";
  const cadenceFrom = entering
    ? month === today.slice(0, 7)
      ? stockUpStart(tripsForCoverage(cadence, coverage), Number(today.slice(8, 10)), coverage)
      : 0
    : cadence === "optimizada"
      ? prevFrom
      : 0;
  const plan: MonthlyPlan = { ...rest, cadence, ...(cadenceFrom > 0 ? { cadenceFrom } : {}) };

  if (isCanonicalShopping(prevShopping)) {
    if (!regrouped) return { plan, shopping: prevShopping, rewrite: false };
    // Las compras anteriores al ancla llevan lo mismo en semanal y en
    // optimizada: sus marcas valen. Con otra cadencia no casan los tramos.
    const anchor = entering ? cadenceFrom : prevFrom;
    const other = entering ? before : cadence;
    return {
      plan,
      shopping: withoutStoreMarks(prevShopping, other === "semanal" ? anchor : 0),
      rewrite: true,
    };
  }
  const shopping = carryOwnedByName(
    prevShopping,
    repartitionTrips(prevShopping, cadence, tripsForCoverage(cadence, coverage)),
  );
  return { plan, shopping, rewrite: true };
}
