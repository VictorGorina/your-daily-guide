import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";

import { patchTodayHabits, type DailyLog } from "./daily";
import { reconcileHabits, sameHabits, type mealsForDate } from "./plan-shared";

/**
 * El registro del día se casa con las comidas que esta persona planifica de
 * verdad: `daily_logs.habits` se escribe UNA vez, al crear el día, y lo crea
 * quien lo toque primero (abrir el chat antes que Hoy lo dejaba vacío), así
 * que sin esto una comida descartada en el onboarding seguía saliendo en Hoy.
 * Mismo criterio que la web (src/lib/use-day-reconcile.ts).
 *
 * Devuelve las comidas ya reconciliadas, que es lo que se pinta; guardarlas es
 * una reparación de fondo.
 *
 * @param settled El plan y el registro del día se invalidan juntos tras un
 *   cambio de plato, pero no vuelven a la vez: no se escribe hasta tener los dos.
 */
export function useDayReconcile(
  today: DailyLog | null | undefined,
  todayMeals: ReturnType<typeof mealsForDate>,
  settled: boolean,
) {
  const qc = useQueryClient();
  const reconciled = reconcileHabits(today?.habits, todayMeals);
  // Las comidas TAL Y COMO están guardadas, que es contra lo que se reconcilió.
  // React Query reusa el objeto si la fila vuelve igual, así que su identidad
  // sirve de disparador: cambia solo cuando el registro cambia de verdad.
  const storedHabits = today?.habits;
  const dayId = today?.id;

  // Evento y no dependencia: `reconciled.habits` es una lista nueva en cada
  // render, y como dependencia relanzaría la escritura sin que nada cambiara.
  const repair = useEffectEvent(() => {
    // `habits` es una única columna JSON y este camino manda la lista entera
    // derivada de la caché, así que se escribe solo si la fila sigue siendo la
    // que se reconcilió: si entre medias la ha tocado otro camino
    // (`patchTodayHabits` de un cambio de plato, el lote del picoteo, la web),
    // se abandona en vez de pisarlo. Lo reconciliado se pinta igual, y el
    // siguiente render lo reintenta ya con datos frescos.
    void patchTodayHabits((stored) => (sameHabits(stored, storedHabits) ? reconciled.habits : null))
      .then((next) => {
        if (!next) return;
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["logs"] });
      })
      // Sin aviso: es una reparación de fondo, no una acción de la persona.
      .catch(() => {});
  });
  useEffect(() => {
    if (!dayId || !reconciled.changed || !settled) return;
    repair();
  }, [dayId, storedHabits, reconciled.changed, settled]);

  return reconciled.habits;
}
