import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";

import {
  monthISO,
  saveProfile,
  todayISO,
  updateTodayLog,
  type DailyLog,
  type Profile,
} from "@/lib/daily";
import { generateDailyGuide } from "@/lib/guide.functions";
import { adjustMonthlyPlan, goalImpact, setPlanMeal } from "@/lib/plan.functions";
import { mealsForDate } from "@/lib/plan-shared";
import { CHAT_EDITABLE_PROFILE_FIELDS, PROFILE_FIELD_LABELS } from "@/lib/profile-fields";

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Acciones que el coach puede ejecutar sobre la pantalla y sobre el plan.
 * Se comparte entre la pestaña de chat y el botón flotante.
 */
export function useCoachActions(getLog: () => DailyLog | undefined) {
  const qc = useQueryClient();
  const makeGuide = useServerFn(generateDailyGuide);
  const adjustPlan = useServerFn(adjustMonthlyPlan);
  const changeMeal = useServerFn(setPlanMeal);
  const checkGoal = useServerFn(goalImpact);
  const date = todayISO();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["profile"] });
    // Por prefijo: un plato cambiado puede caer en otro mes distinto al actual.
    qc.invalidateQueries({ queryKey: ["plan"] });
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
      if (toolName === "cambiar_plato") {
        const targetDate = String(input.fecha ?? "");
        const dish = String(input.plato ?? "").trim();
        const { plan, label, off } = await changeMeal({
          data: {
            date: targetDate,
            slot: String(input.comida ?? ""),
            dish,
            today: date,
          },
        });
        // Si el plato cambiado es el de HOY, la estimación de macros guardada en
        // la guía (`macroEstimate`/`mealMacros`) queda desactualizada — todavía
        // habla del plato viejo. Se regenera solo para eso, para que la barra de
        // macros de Hoy refleje el plato real en cuanto el coach lo cambia, en
        // vez de esperar a la siguiente recarga.
        if (targetDate === date) {
          const meals = mealsForDate(plan, date)
            .filter((m) => m.idea)
            .map((m) => ({ moment: m.moment, idea: m.idea }));
          const guide = await makeGuide({ data: { meals } });
          await updateTodayLog({ guide });
        }
        const dayLabel = /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
          ? new Date(`${targetDate}T00:00:00`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
          : targetDate;
        const base = `${label} del ${dayLabel}: ${dish}`;
        return off.length
          ? `${base}. Ojo: ${off.join(", ")} no está en tu lista de la compra.`
          : `${base} (con lo que ya tienes comprado)`;
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
        const targetDate = String(input.fecha ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return "Fecha no válida";
        await saveProfile({ goal_target_date: targetDate });
        return `Nueva fecha objetivo guardada: ${targetDate}`;
      }
      if (toolName === "actualizar_perfil") {
        const patch: Partial<Profile> = {};
        const updated: string[] = [];
        for (const field of CHAT_EDITABLE_PROFILE_FIELDS) {
          const raw = input[field.key];
          if (raw === undefined || raw === null || raw === "") continue;
          if (field.kind === "number") {
            const n = Number(raw);
            if (!Number.isFinite(n)) continue;
            if (field.min !== undefined && n < field.min) continue;
            if (field.max !== undefined && n > field.max) continue;
            (patch as Record<string, unknown>)[field.key] = n;
          } else if (field.kind === "time") {
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw))) continue;
            (patch as Record<string, unknown>)[field.key] = raw;
          } else if (field.kind === "date") {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) continue;
            (patch as Record<string, unknown>)[field.key] = raw;
          } else {
            (patch as Record<string, unknown>)[field.key] = String(raw).trim();
          }
          updated.push(PROFILE_FIELD_LABELS[field.key] ?? field.key);
        }
        if (!updated.length) return "No había ningún dato válido que actualizar en el perfil";
        await saveProfile(patch);
        return `Perfil actualizado: ${updated.join(", ")}.`;
      }
      return "Acción desconocida";
    },
    [adjustPlan, changeMeal, checkGoal, date, getLog, makeGuide],
  );

  return { runTool, refresh };
}
