import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";

import {
  monthISO,
  saveProfile,
  todayISO,
  updateTodayLog,
  type DailyGuide,
  type DailyLog,
  type MonthlyPlanRow,
  type Profile,
} from "@/lib/daily";
import { generateDailyGuide } from "@/lib/guide.functions";
import { adjustMonthlyPlan, goalImpact, setChildMeal, setPlanMeal } from "@/lib/plan.functions";
import { mealsForDate, type MonthlyPlan } from "@/lib/plan-shared";
import { CHAT_EDITABLE_PROFILE_FIELDS, PROFILE_FIELD_LABELS } from "@/lib/profile-fields";

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Acciones que el coach puede ejecutar sobre la pantalla y sobre el plan.
 * Se comparte entre la pestaña de chat y el botón flotante.
 *
 * `getPlan` devuelve el plan **compuesto** del mes en curso: para un no
 * planificador de hogar incluye las comidas compartidas del planificador, que la
 * fila propia no lleva. Al regenerar los macros tras un `cambiar_plato` de hoy se
 * usa esta vista completa (con la comida cambiada sustituida) para que la barra de
 * macros refleje TODAS las comidas, no solo las del slot que se acaba de tocar.
 */
export function useCoachActions(
  getLog: () => DailyLog | undefined,
  getPlan?: () => MonthlyPlanRow | null | undefined,
) {
  const qc = useQueryClient();
  const makeGuide = useServerFn(generateDailyGuide);
  const adjustPlan = useServerFn(adjustMonthlyPlan);
  const changeMeal = useServerFn(setPlanMeal);
  const changeChildMeal = useServerFn(setChildMeal);
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
        const slot = String(input.comida ?? "");
        const { plan, label, off, previousIdea } = await changeMeal({
          data: { date: targetDate, slot, dish, today: date },
        });
        // Si el plato cambiado es el de HOY, la estimación de macros guardada en
        // la guía (`macroEstimate`/`mealMacros`) queda desactualizada — todavía
        // habla del plato viejo. Se regenera solo para eso, para que la barra de
        // macros de Hoy refleje el plato real en cuanto el coach lo cambia, en
        // vez de esperar a la siguiente recarga.
        if (targetDate === date) {
          // Se parte del plan COMPUESTO (que para un no planificador trae las
          // comidas compartidas del planificador, no de la fila propia donde
          // están vacías), y se sustituye el slot cambiado por el plato nuevo.
          // Así la regeneración de macros recibe TODAS las comidas de hoy, no
          // solo la que se acaba de tocar. Para un usuario en solitario o un
          // planificador, `composedPlan` y `plan` son equivalentes — el
          // fallback a `plan` cubre el caso de que el caller no pase `getPlan`.
          const composedPlan: MonthlyPlan | null = getPlan?.()?.plan ?? plan;
          const meals = mealsForDate(composedPlan, date)
            .map((m) =>
              m.slot === slot
                ? { moment: m.moment, idea: dish }
                : { moment: m.moment, idea: m.idea },
            )
            .filter((m) => m.idea);
          const freshGuide = await makeGuide({ data: { meals } });
          // El objetivo de la barra de macros (`macroEstimate`) se fija la
          // primera vez que hay guía del día, a partir del plan original — un
          // cambio de plato después de eso (como este) tiene que poder quedar
          // por encima o por debajo de ese objetivo, no desplazarlo para que
          // el cambio siempre parezca "dentro de lo previsto". `mealMacros` sí
          // se actualiza entero: es lo que compara cada plato real contra ese
          // objetivo fijo.
          const currentGuide = getLog()?.guide ?? null;
          const guide: DailyGuide = {
            ...freshGuide,
            macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate,
          };
          // Guarda qué había antes en ese momento, solo la primera vez que se
          // cambia hoy (si ya tenía `wasIdea`, se respeta para no perder el
          // plan original tras varios cambios seguidos) — así Hoy puede tachar
          // el plato viejo bajo el nuevo en cuanto el coach lo cambia, tanto si
          // se pidió desde el botón de "comí otra cosa" como desde el chat.
          const nextHabits =
            previousIdea && previousIdea !== dish
              ? habits.map((h) =>
                  h.label === label ? { ...h, wasIdea: h.wasIdea ?? previousIdea } : h,
                )
              : habits;
          await updateTodayLog({ guide, habits: nextHabits });
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
      if (toolName === "cambiar_plato_nino") {
        const targetDate = String(input.fecha ?? "");
        const dish = String(input.plato ?? "").trim();
        const { childName, label, off } = await changeChildMeal({
          data: {
            date: targetDate,
            slot: String(input.comida ?? ""),
            childId: String(input.nino ?? ""),
            dish,
            today: date,
          },
        });
        const dayLabel = /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
          ? new Date(`${targetDate}T00:00:00`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
          : targetDate;
        if (!dish) {
          return `${label} del ${dayLabel}: ${childName} vuelve a comer el plato compartido.`;
        }
        const base = `${label} del ${dayLabel} · para ${childName}: ${dish}`;
        return off.length
          ? `${base}. Ojo: ${off.join(", ")} no está en la lista de la compra.`
          : `${base} (con lo que ya hay comprado)`;
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
    [adjustPlan, changeMeal, changeChildMeal, checkGoal, date, getLog, getPlan, makeGuide],
  );

  return { runTool, refresh };
}
