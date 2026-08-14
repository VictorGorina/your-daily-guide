import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";

import { monthISO, saveProfile, todayISO, updateTodayLog, type DailyLog } from "@/lib/daily";
import { generateDailyGuide } from "@/lib/guide.functions";
import { adjustMonthlyPlan, goalImpact } from "@/lib/plan.functions";

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Acciones que el coach puede ejecutar sobre la pantalla y sobre el plan.
 * Se comparte entre la pestaña de chat y el botón flotante.
 */
export function useCoachActions(getLog: () => DailyLog | undefined) {
  const qc = useQueryClient();
  const makeGuide = useServerFn(generateDailyGuide);
  const adjustPlan = useServerFn(adjustMonthlyPlan);
  const checkGoal = useServerFn(goalImpact);
  const date = todayISO();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["profile"] });
    qc.invalidateQueries({ queryKey: ["plan", monthISO()] });
  }, [qc]);

  const runTool = useCallback(
    async (toolName: string, input: Record<string, unknown>): Promise<string> => {
      const habits = getLog()?.habits ?? [];

      if (toolName === "actualizar_peso") {
        const kg = Number(input.kg);
        if (!Number.isFinite(kg)) return "Peso no válido";
        await updateTodayLog({ weight_kg: kg });
        await saveProfile({ current_weight_kg: kg });
        return `Peso de hoy guardado: ${kg} kg`;
      }
      if (toolName === "marcar_habito") {
        const label = String(input.label ?? "");
        const done = Boolean(input.done);
        const next = habits.map((h) =>
          norm(h.label).includes(norm(label)) || norm(label).includes(norm(h.label))
            ? { ...h, done }
            : h,
        );
        await updateTodayLog({ habits: next });
        return `Hábito "${label}" marcado como ${done ? "hecho" : "pendiente"}`;
      }
      if (toolName === "anadir_habito") {
        const label = String(input.label ?? "").trim();
        if (!label) return "Falta el nombre del hábito";
        await updateTodayLog({ habits: [...habits, { label, done: false }] });
        return `Hábito añadido: ${label}`;
      }
      if (toolName === "quitar_habito") {
        const label = String(input.label ?? "");
        const next = habits.filter((h) => !norm(h.label).includes(norm(label)));
        await updateTodayLog({ habits: next });
        return `Hábito quitado: ${label}`;
      }
      if (toolName === "regenerar_guia") {
        const guide = await makeGuide({ data: undefined } as never);
        await updateTodayLog({ guide });
        return "Guía de hoy regenerada";
      }
      if (toolName === "ajustar_plan_mensual") {
        const kcal = Number(input.kcal_extra);
        const { summary } = await adjustPlan({
          data: {
            month: monthISO(),
            note: String(input.motivo ?? "Ajuste del plan"),
            today: date,
            kcalDelta: Number.isFinite(kcal) ? kcal : null,
          },
        });
        return `Días futuros del plan reajustados (hoy no se toca, misma compra). ${summary}`.trim();
      }
      if (toolName === "recalcular_objetivo") {
        const { text, suggested_target_date } = await checkGoal({
          data: { note: String(input.motivo ?? ""), today: date },
        });
        return suggested_target_date
          ? `${text}\n(Fecha objetivo posible si mantienes el ritmo: ${suggested_target_date})`
          : text;
      }
      if (toolName === "cambiar_fecha_objetivo") {
        const fecha = String(input.fecha ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "Fecha no válida";
        await saveProfile({ goal_target_date: fecha });
        return `Nueva fecha objetivo guardada: ${fecha}`;
      }
      return "Acción desconocida";
    },
    [adjustPlan, checkGoal, date, getLog, makeGuide],
  );

  return { runTool, refresh };
}
