import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AppState } from "react-native";

import { apiPost } from "./api";
import { fetchTodayLog, updateTodayLog, type DailyGuide, type DailyLog } from "./daily";
import { guideMeals, guideReuse, mealsToRecalculate, mergeGuide } from "./macros";
import type { mealsForDate } from "./plan-shared";

// La guía del día se pide sola al abrir Hoy si falta o está incompleta. Dos
// salvaguardas para que ese reintento automático no se convierta en spam:
//   1. Si falla, no se avisa (`silent`): el aviso solo sale al pulsar "Generar"
//      a mano. Antes cada fallo encolaba un `Alert`, y como iOS los muestra de
//      uno en uno, un montaje repetido de Hoy (Fast Refresh, volver a la
//      pestaña, el backend caído un rato) dejaba una cola de avisos idénticos
//      imposible de cerrar.
//   2. No se relanza sola más de una vez por minuto entre montajes (variable a
//      nivel de módulo, no por montaje), para no martillear la IA.
const AUTO_GUIDE_MIN_INTERVAL_MS = 60_000;
const AUTO_GUIDE_BACKOFF_MS = 600_000;
let lastAutoGuideAttempt = 0;
let lastAutoGuideFailed = false;
/** Por qué se pidió la guía la última vez (ver `guideNeed`). */
let lastAutoGuideKey = "";
// Platos que quedaron "calculando" (ticket 13 de `precision-nutricional`, D13):
// se reintentan al abrir Hoy, al volver a la app y cada 2 minutos mientras está
// abierta, como mucho 5 veces seguidas; después, en el siguiente arranque (el
// contador vive en el módulo). Cada intento solo descompone lo que falta
// (`macrosOnly` + `reuse`). Mismo criterio que la web.
const CALC_RETRY_MS = 120_000;
const CALC_MAX_ATTEMPTS = 5;
let calcAttempts = 0;
let lastCalcAttempt = 0;

type TodayMeals = ReturnType<typeof mealsForDate>;

// Por qué habría que (re)generar la guía, como una cadena estable. El efecto
// depende del MOTIVO y no del id del registro: `today.id` no cambia en todo
// el día y la pantalla Hoy no se desmonta nunca (queda bajo el Stack de
// expo-router), así que un cambio de plato no volvía a disparar nada y la
// barra de macros se quedaba igual hasta pulsar "Generar" a mano.
function guideNeedOf(today: DailyLog | null | undefined, todayMeals: TodayMeals): string {
  if (!today) return "";
  const g = today.guide;
  if (!g || !g.meals?.length || !g.tips?.length) return "sin-guia";
  const dishes = todayMeals.filter((m) => m.idea);
  if (!dishes.length) return "";
  // Guía guardada de antes de que existiera la barra de macros (o el lookup
  // no salió): sin esto se queda sin barras para siempre.
  if (g.macroEstimate == null || !g.mealMacros?.length) return "sin-macros";
  // El hogar puede espejar por detrás un cambio del planificador sobre una
  // comida compartida: el plato de hoy cambia sin pasar por `use-meal-swap`.
  const stale = dishes.filter((m) => {
    const cached = g.mealMacros?.find((mm) => mm.moment === m.moment);
    return !!cached?.idea && cached.idea !== m.idea;
  });
  if (stale.length) return `platos:${stale.map((m) => `${m.moment}=${m.idea}`).join("|")}`;
  // Platos que siguen "calculando" (D13): se reintentan, con su propia pauta.
  const pending = mealsToRecalculate(g.mealMacros).filter((mm) =>
    dishes.some((m) => m.moment === mm.moment && m.idea === mm.idea),
  );
  return pending.length ? `por-calcular:${pending.map((m) => m.moment).join("|")}` : "";
}

/**
 * La guía de hoy: pedirla a mano (`requestGuide`), y pedirla sola cuando falta,
 * cuando un plato de hoy ha cambiado por detrás o cuando queda algo
 * "calculando" (cada 2 min, máx. 5, y al volver a la app).
 */
export function useGuideAutoGeneration({
  today,
  todayMeals,
  date,
}: {
  today: DailyLog | null | undefined;
  todayMeals: TodayMeals;
  date: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const requestGuide = async ({
    silent = false,
    macrosOnly = false,
  }: { silent?: boolean; macrosOnly?: boolean } = {}) => {
    setGenerating(true);
    try {
      const { dishMacros: _none, ...g } = await apiPost<DailyGuide & { dishMacros?: unknown }>(
        "guide",
        {
          // Con lo que se comió de verdad en cada "comí distinto" (ticket 17).
          meals: guideMeals(
            todayMeals.map((m) => ({ moment: m.moment, idea: m.idea })),
            today?.habits,
          ),
          // Lo que ya tiene cifra no se vuelve a descomponer.
          reuse: guideReuse(today?.guide?.mealMacros, today?.habits),
          macrosOnly,
          today: date,
        },
      );
      // Solo cifras: el texto de la guía se queda como estaba.
      const fresh: DailyGuide =
        macrosOnly && today?.guide
          ? { ...today.guide, macroEstimate: g.macroEstimate, mealMacros: g.mealMacros }
          : g;
      // Si la generación vuelve con el texto de respaldo y sin cifras, se
      // conservan las que ya tuviera el día: regenerar nunca debe dejar la
      // barra de macros peor de como estaba (ver `mergeGuide`).
      await updateTodayLog({ guide: mergeGuide(today?.guide, fresh) });
      lastAutoGuideFailed = false;
      qc.invalidateQueries({ queryKey: ["today"] });
    } catch {
      if (silent) {
        lastAutoGuideFailed = true;
      } else {
        lastAutoGuideFailed = false;
        Alert.alert(t("hoy.errors.coachFailed"));
      }
    } finally {
      setGenerating(false);
    }
  };

  const guideNeed = guideNeedOf(today, todayMeals);

  // Reloj del reintento de "calculando": cada 2 minutos mientras quede algo, y
  // al volver a la app. Solo cambia un contador; decide el efecto de abajo.
  const recalculating = guideNeed.startsWith("por-calcular");
  const [calcTick, setCalcTick] = useState(0);
  const calcForceRef = useRef(true); // al abrir Hoy se intenta ya
  useEffect(() => {
    if (!recalculating) {
      calcAttempts = 0;
      return;
    }
    const id = setInterval(() => setCalcTick((n) => n + 1), CALC_RETRY_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      calcForceRef.current = true;
      setCalcTick((n) => n + 1);
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [recalculating]);

  // Evento y no dependencia: `requestGuide` se crea en cada render (lee el
  // registro y el plan del momento), y lo que dispara el intento es el MOTIVO
  // (`guideNeed`), que acabe una generación o el reloj de "calculando".
  const autoRequest = useEffectEvent(requestGuide);
  useEffect(() => {
    if (!guideNeed || generating) return;
    if (guideNeed.startsWith("por-calcular")) {
      if (calcAttempts >= CALC_MAX_ATTEMPTS) return;
      const due = Date.now() - lastCalcAttempt >= CALC_RETRY_MS;
      if (!due && !calcForceRef.current) return;
      calcForceRef.current = false;
      calcAttempts += 1;
      lastCalcAttempt = Date.now();
      void autoRequest({ silent: true, macrosOnly: true });
      return;
    }
    const cooldown = lastAutoGuideFailed ? AUTO_GUIDE_BACKOFF_MS : AUTO_GUIDE_MIN_INTERVAL_MS;
    // El tope de un intento por minuto es para no repetir EL MISMO intento (el
    // bucle de alertas de 2026-09-01). Un motivo nuevo — cambió un plato de
    // hoy — no tiene por qué esperar al minuto del intento anterior.
    if (guideNeed === lastAutoGuideKey && Date.now() - lastAutoGuideAttempt < cooldown) return;
    lastAutoGuideKey = guideNeed;
    lastAutoGuideAttempt = Date.now();
    void autoRequest({ silent: true });
  }, [guideNeed, generating, calcTick]);

  return { generating, requestGuide };
}

type DayTarget = NonNullable<DailyGuide["targets"]>;

/**
 * La copia del objetivo en la guía de hoy se mantiene al día: es la que usa el
 * semáforo de este día cuando ya sea pasado. Se relee la fila antes de escribir
 * para no pisar una regeneración recién guardada. Igual que la web.
 */
export function useGuideTargetsSync(
  today: DailyLog | null | undefined,
  dayTarget: DayTarget | null,
  generating: boolean,
) {
  const qc = useQueryClient();
  const dayId = today?.id;
  const storedKcal = today?.guide?.targets?.kcal;
  const targetKcal = dayTarget?.kcal;

  // Evento: `dayTarget` es un objeto nuevo en cada render; lo que dispara la
  // copia es que cambie su cifra de kcal (o la guardada, o que acabe una
  // generación), no su identidad ni que llegue la guía.
  const copyTarget = useEffectEvent(() => {
    if (!today?.guide || !dayTarget) return;
    void fetchTodayLog()
      .then((fresh) => {
        if (!fresh?.guide || fresh.guide.targets?.kcal === dayTarget.kcal) return;
        return updateTodayLog({ guide: { ...fresh.guide, targets: dayTarget } }).then(() =>
          qc.invalidateQueries({ queryKey: ["today"] }),
        );
      })
      .catch(() => {});
  });
  useEffect(() => {
    if (targetKcal == null || generating) return;
    if (storedKcal === targetKcal) return;
    copyTarget();
  }, [dayId, storedKcal, targetKcal, generating]);
}
