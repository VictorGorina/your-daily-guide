import { BLOCKED_FOOD_MESSAGE, isCleanFood } from "./content-guard";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { apiPost } from "./api";
import {
  monthISO,
  saveProfile,
  todayISO,
  updateTodayLog,
  type DailyGuide,
  type DailyLog,
  type Profile,
} from "./daily";
import { exerciseToolResult } from "./day-log-ack";
import { ensureDaySettleDeps, queueDishChange, scheduleDaySettle } from "./day-settle";
import type { DayExercise, ExerciseEntry } from "./exercise";
import {
  guideMeals,
  guideReuse,
  isMealCalculated,
  mergeGuide,
  perMealDeltas,
  showsNutritionNumbers,
} from "./macros";
import { mealsForDate, type MealChange, type MealSlot, type MonthlyPlan } from "./plan-shared";
import { CHAT_EDITABLE_PROFILE_FIELDS, chipToValue, PROFILE_FIELD_LABELS } from "./profile-fields";

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Acciones que el coach puede ejecutar sobre la pantalla y sobre el plan.
 * Portado de `src/lib/use-coach-actions.ts` de la web: la misma lógica, pero las
 * operaciones que allí eran server functions (`useServerFn`) aquí van por HTTP a
 * `/api/v1/*` con `apiPost`. El CRUD directo (peso, hábitos, perfil) sigue por
 * `supabase`, igual que la web desde el navegador.
 */
export function useCoachActions(getLog: () => DailyLog | undefined) {
  const qc = useQueryClient();
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
        // El hábito solo lo escribe el coach, pero su texto sale de lo que le
        // dicte la persona y se queda en `daily_logs.habits`.
        if (!isCleanFood(label)) return BLOCKED_FOOD_MESSAGE;
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
        const fresh = await apiPost<DailyGuide>("guide");
        // Sin platos no trae cifras: nunca deja el día con menos de las que tenía.
        await updateTodayLog({ guide: mergeGuide(getLog()?.guide, fresh) });
        return "Guía de hoy regenerada";
      }
      if (toolName === "cambiar_plato") {
        const fecha = String(input.fecha ?? "");
        const plato = String(input.plato ?? "").trim();
        const slot = String(input.comida ?? "");
        const { plan, label, off, previousIdea } = await apiPost<{
          plan: MonthlyPlan;
          label: string;
          off: string[];
          previousIdea: string;
        }>("plan/meal", {
          date: fecha,
          slot,
          dish: plato,
          today: date,
        });
        // Compensación EN CÓDIGO del cambio (ver `use-coach-actions.ts` de la
        // web) — el modelo ya no estima un `kcal_extra` para este plato.
        let adjustedNote = "";
        // Si el plato cambiado es el de HOY, la estimación de macros guardada en
        // la guía (`macroEstimate`/`mealMacros`) queda desactualizada — todavía
        // habla del plato viejo. Se regenera solo para eso, para que la barra de
        // macros de Hoy refleje el plato real en cuanto el coach lo cambia, en
        // vez de esperar a la siguiente recarga.
        if (fecha === date) {
          const meals = mealsForDate(plan, date)
            .filter((m) => m.idea)
            .map((m) => ({ moment: m.moment, idea: m.idea }));
          const logNow = getLog();
          const freshGuide = await apiPost<DailyGuide>("guide", {
            // Con el plato del plan congelado: el día se cierra con él.
            meals: guideMeals(meals, logNow?.habits),
            reuse: guideReuse(logNow?.guide?.mealMacros, logNow?.habits),
          });
          // El objetivo de la barra de macros (`macroEstimate`) se fija la
          // primera vez que hay guía del día, a partir del plan original — un
          // cambio de plato después de eso tiene que poder quedar por encima o
          // por debajo de ese objetivo, no desplazarlo. `mealMacros` sí se
          // actualiza entero. Mismo criterio que la web (src/lib/use-coach-actions.ts).
          const currentGuide = getLog()?.guide ?? null;
          const guide: DailyGuide = {
            ...mergeGuide(currentGuide, freshGuide),
            macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate,
          };
          // Guarda qué había antes en ese momento, solo la primera vez que se
          // cambia hoy — mismo criterio que la web (src/lib/use-coach-actions.ts).
          const nextHabits =
            previousIdea && previousIdea !== plato
              ? habits.map((h) =>
                  h.label === label ? { ...h, wasIdea: h.wasIdea ?? previousIdea } : h,
                )
              : habits;
          await updateTodayLog({ guide, habits: nextHabits });

          if (previousIdea && previousIdea !== plato) {
            const habit = habits.find((h) => h.label === label);
            // Solo una cifra calculada vale como referencia (D13).
            const plannedMacros = currentGuide?.mealMacros?.find(
              (m) => m.moment === label && isMealCalculated(m),
            );
            const prevKcal = habit?.plannedKcal ?? plannedMacros?.kcal ?? null;
            const prevProtein =
              habit?.plannedKcal != null
                ? (habit.plannedProtein ?? null)
                : (plannedMacros?.protein_g ?? null);
            const { resolved: deltas } = perMealDeltas(
              [{ label, prevKcal, prevProtein }],
              freshGuide.mealMacros,
            );
            if (!deltas.length) {
              // El plato nuevo (o el del plan) aún está "calculando": el cambio
              // entra en la cola del día y se asienta cuando tenga cifra.
              queueDishChange(date, {
                label,
                slot: slot as MealSlot,
                dish: plato,
                plannedDish: previousIdea,
                prevKcal,
                prevProtein,
              });
            }
            if (deltas.length) {
              try {
                // Un cambio de plato de HOY pedido al coach va por el MISMO
                // asentamiento que el de la pestaña Hoy: la decisión de
                // recolocar es del día entero, no de ese plato (ver
                // `day-balance.ts`).
                const result = await apiPost<{ outcome: string; changes?: MealChange[] }>(
                  "day/settle",
                  {
                    today: date,
                    changes: [
                      {
                        label,
                        slot,
                        dish: plato,
                        plannedDish: previousIdea,
                        kcalDelta: deltas[0].kcalDelta,
                        proteinDelta: deltas[0].proteinDelta,
                      },
                    ],
                  },
                );
                if (result.outcome === "adjusted") {
                  adjustedNote = ` He ajustado ${result.changes?.length ?? 0} comida(s) de los próximos días para compensarlo.`;
                }
              } catch (err) {
                console.error("cambiar_plato: compensate", err);
              }
            }
          }
        } else if (previousIdea && previousIdea !== plato) {
          try {
            const result = await apiPost<{ adjusted: boolean; changes?: MealChange[] }>(
              "plan/compensate-future",
              { today: date, date: fecha, label, slot, dish: plato, plannedDish: previousIdea },
            );
            if (result.adjusted) {
              adjustedNote = ` He ajustado ${result.changes?.length ?? 0} comida(s) de los próximos días para compensarlo.`;
            }
          } catch (err) {
            console.error("cambiar_plato: compensateFuture", err);
          }
        }
        const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
          ? new Date(`${fecha}T00:00:00`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
          : fecha;
        const base = `${label} del ${dia}: ${plato}`;
        return (
          (off.length
            ? `${base}. Ojo: ${off.join(", ")} no está en tu lista de la compra.`
            : `${base} (con lo que ya tienes comprado)`) + adjustedNote
        );
      }
      if (toolName === "cambiar_plato_nino") {
        const fecha = String(input.fecha ?? "");
        const plato = String(input.plato ?? "").trim();
        const { childName, label, off } = await apiPost<{
          childName: string;
          label: string;
          off: string[];
        }>("plan/child-meal", {
          date: fecha,
          slot: String(input.comida ?? ""),
          childId: String(input.nino ?? ""),
          dish: plato,
          today: date,
        });
        const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
          ? new Date(`${fecha}T00:00:00`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })
          : fecha;
        if (!plato) {
          return `${label} del ${dia}: ${childName} vuelve a comer el plato compartido.`;
        }
        const base = `${label} del ${dia} · para ${childName}: ${plato}`;
        return off.length
          ? `${base}. Ojo: ${off.join(", ")} no está en la lista de la compra.`
          : `${base} (con lo que ya hay comprado)`;
      }
      if (toolName === "registrar_deporte") {
        // Mismo camino que "Registrar deporte" en Hoy: `/api/v1/exercise/log`
        // calcula las kcal con la tabla y separa lo que ya va en la rutina (D9),
        // y el día se asienta UNA vez con todo lo demás (`settleDay`). Antes el
        // coach lo compensaba con `ajustar_plan_mensual` y su propia
        // estimación, que decidía por origen (ver `day-log-ack.ts`).
        const { entry } = await apiPost<{ exercise: DayExercise; entry: ExerciseEntry }>(
          "exercise/log",
          {
            today: date,
            activity: String(input.actividad ?? ""),
            minutes: Number(input.minutos),
            intensity: String(input.intensidad ?? ""),
          },
        );
        // Desde el chat abierto por enlace, Hoy todavía no ha registrado las suyas.
        ensureDaySettleDeps({ onDone: refresh });
        scheduleDaySettle(date);
        const profile = qc.getQueryData<Profile | null>(["profile"]);
        return exerciseToolResult(entry, showsNutritionNumbers(profile));
      }
      if (toolName === "ajustar_plan_mensual") {
        const kcal = Number(input.kcal_extra);
        const { summary } = await apiPost<{ summary: string }>("plan/adjust", {
          month: monthISO(),
          note: String(input.motivo ?? "Ajuste del plan"),
          today: date,
          kcalDelta: Number.isFinite(kcal) ? kcal : null,
        });
        return `Días futuros del plan reajustados (hoy no se toca, misma compra). ${summary}`.trim();
      }
      if (toolName === "recalcular_objetivo") {
        const { text, suggested_target_date } = await apiPost<{
          text: string;
          suggested_target_date: string | null;
        }>("plan/goal-impact", { note: String(input.motivo ?? ""), today: date });
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
          } else if (field.kind === "chips" && field.valueMap) {
            // El modelo puede mandar la etiqueta ("No, prefiero no verlas") o el
            // valor guardado ("ocultar"): se acepta cualquiera de los dos, y
            // nada más.
            const text = String(raw).trim();
            const value = chipToValue(field, text);
            if (!Object.values(field.valueMap).includes(value)) continue;
            (patch as Record<string, unknown>)[field.key] = value;
          } else {
            (patch as Record<string, unknown>)[field.key] = String(raw).trim();
          }
          updated.push(PROFILE_FIELD_LABELS[field.key] ?? field.key);
        }
        if (!updated.length) return "No había ningún dato válido que actualizar en el perfil";
        // Si el coach tocó `meals_to_plan` (texto libre), `saveProfile` limpia
        // solo el `meal_slots` estructurado del onboarding — si no,
        // `effectiveMealSlots` seguiría prefiriendo la elección vieja.
        await saveProfile(patch);
        return `Perfil actualizado: ${updated.join(", ")}.`;
      }
      return "Acción desconocida";
    },
    [date, getLog, qc, refresh],
  );

  return { runTool, refresh };
}
