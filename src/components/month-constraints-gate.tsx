import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Plane } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DictateButton } from "@/components/dictate-button";
import { daysInMonth, monthTitle, type MonthConstraints } from "@/lib/plan-shared";
import { setMonthConstraints } from "@/lib/plan.functions";

type AwayPreset = "no" | "few" | "week";

const PRESETS: { key: AwayPreset; label: string }[] = [
  { key: "no", label: "No" },
  { key: "few", label: "Unos días" },
  { key: "week", label: "Una semana o más" },
];

/**
 * Un par de preguntas rápidas antes de crear el plan de un mes: si la persona
 * va a estar fuera de casa (viaje, etc.) y cualquier otra cosa que convenga
 * saber, con texto libre y dictado. Se muestra una sola vez por mes — la
 * fila que guarda `setMonthConstraints` (aunque quede vacía si se pasa de
 * largo) es la marca de que ya se preguntó, y quien llama decide cuándo
 * mostrar esto (`needsConstraints` en la pantalla Plan).
 */
export function MonthConstraintsGate({ month, onDone }: { month: string; onDone: () => void }) {
  const [preset, setPreset] = useState<AwayPreset>("no");
  const [awayStart, setAwayStart] = useState("");
  const [awayEnd, setAwayEnd] = useState("");
  const [notes, setNotes] = useState("");

  const save = useServerFn(setMonthConstraints);
  const mutation = useMutation({
    mutationFn: (data: Pick<MonthConstraints, "awayStart" | "awayEnd" | "notes">) =>
      save({ data: { month, ...data } }),
    onSuccess: onDone,
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "No hemos podido guardar esto ahora mismo"),
  });

  const minDate = `${month}-01`;
  const maxDate = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const hasRange = preset !== "no";
  const rangeIncomplete = hasRange && (!awayStart || !awayEnd || awayStart > awayEnd);

  const submit = () =>
    mutation.mutate({
      awayStart: hasRange ? awayStart : null,
      awayEnd: hasRange ? awayEnd : null,
      notes: notes.trim() || null,
    });

  const skip = () => mutation.mutate({ awayStart: null, awayEnd: null, notes: null });

  return (
    <section className="surface-card animate-rise mt-8 space-y-4 p-6">
      <div className="text-center">
        <Plane className="mx-auto h-7 w-7 text-primary" />
        <h2 className="mt-3 text-sm font-semibold">
          Antes de crear el plan de {monthTitle(month)}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Dos preguntas rápidas para que el plan lo tenga en cuenta.
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">¿Vas a estar fuera de casa algún tramo?</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(({ key, label }) => {
            const active = preset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPreset(key)}
                aria-pressed={active}
                disabled={mutation.isPending}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-transform active:scale-95 ${
                  active
                    ? "bg-foreground font-semibold text-background"
                    : "bg-muted text-foreground"
                }`}
              >
                {active ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : null}
                {label}
              </button>
            );
          })}
        </div>

        {hasRange ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="date"
              aria-label="Desde"
              disabled={mutation.isPending}
              value={awayStart}
              min={minDate}
              max={awayEnd || maxDate}
              onChange={(e) => setAwayStart(e.target.value)}
              className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm outline-none"
            />
            <span className="text-sm text-muted-foreground">a</span>
            <input
              type="date"
              aria-label="Hasta"
              disabled={mutation.isPending}
              value={awayEnd}
              min={awayStart || minDate}
              max={maxDate}
              onChange={(e) => setAwayEnd(e.target.value)}
              className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm outline-none"
            />
          </div>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">¿Algo más que debamos saber?</p>
        <div className="rounded-3xl bg-muted p-2">
          <textarea
            rows={2}
            disabled={mutation.isPending}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Opcional: eventos, cambios de rutina..."
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <div className="flex items-center px-1">
            <DictateButton onText={(t) => setNotes((v) => (v ? `${v.trim()} ${t}` : t))} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={submit}
          disabled={mutation.isPending || rangeIncomplete}
          className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {mutation.isPending ? "Guardando..." : "Continuar"}
        </button>
        <button
          type="button"
          onClick={skip}
          disabled={mutation.isPending}
          className="w-full rounded-full py-2 text-xs font-medium text-muted-foreground disabled:opacity-60"
        >
          Ahora no
        </button>
      </div>
    </section>
  );
}
