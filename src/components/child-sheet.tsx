import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { addChild, removeChild, updateChild, type HouseholdChild } from "@/lib/household";
import {
  childRation,
  cleanFeedingStage,
  FEEDING_STAGE_LABEL,
  personColor,
  type Appetite,
  type FeedingStage,
} from "@/lib/household-shared";

const field = "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const control =
  "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40";

const APPETITES: readonly [Appetite, string][] = [
  ["poco", "Poco"],
  ["normal", "Normal"],
  ["mucho", "Mucho"],
];

const STAGES: readonly FeedingStage[] = ["pecho", "triturados", "mesa"];

type Draft = {
  name: string;
  age: string;
  appetite: Appetite;
  stage: FeedingStage;
  allergies: string;
  notes: string;
};

const emptyDraft: Draft = {
  name: "",
  age: "",
  appetite: "normal",
  stage: "mesa",
  allergies: "",
  notes: "",
};

const toDraft = (c: HouseholdChild): Draft => ({
  name: c.name,
  age: c.age != null ? String(c.age) : "",
  appetite: (c.appetite as Appetite) ?? "normal",
  stage: cleanFeedingStage(c.feeding_stage),
  allergies: c.allergies ?? "",
  notes: c.notes ?? "",
});

/**
 * Panel inferior para dar de alta o editar a un peque de la casa. Sustituye al
 * formulario en línea + pastillas de apetito en la fila del rediseño anterior.
 * Solo escribe columnas que ya existen en `household_children`
 * (`name`/`age`/`allergies`/`appetite`/`feeding_stage`/`notes`); la ración se
 * recalcula con `childRation` al guardar según la etapa de alimentación.
 */
export function ChildSheet({
  open,
  child,
  householdId,
  onClose,
  onChanged,
}: {
  open: boolean;
  /** `null` = alta de un peque nuevo; un peque = edición. */
  child: HouseholdChild | null;
  householdId: string;
  onClose: () => void;
  /** Se llama tras guardar o quitar un peque, para programar el recálculo del plan (issue 05). */
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(child ? toDraft(child) : emptyDraft);
    setConfirmDelete(false);
  }, [open, child]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const refresh = () => qc.invalidateQueries({ queryKey: ["household"] });

  const ageValue = () => {
    const n = Number(draft.age.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  const save = useMutation({
    mutationFn: async () => {
      const age = ageValue();
      const payload = {
        name: draft.name.trim(),
        age,
        allergies: draft.allergies.trim() || null,
        appetite: draft.appetite,
        feeding_stage: draft.stage,
        portion: childRation(draft.stage, age, draft.appetite),
        notes: draft.notes.trim() || null,
      };
      if (child) await updateChild(child.id, payload);
      else await addChild(householdId, payload);
    },
    onSuccess: () => {
      toast.success(child ? "Peque actualizado" : "Peque añadido");
      refresh();
      onChanged?.();
      onClose();
    },
    onError: () => toast.error("No hemos podido guardar"),
  });

  const drop = useMutation({
    mutationFn: () => removeChild(child!.id),
    onSuccess: () => {
      toast.success("Peque quitado de la familia");
      refresh();
      onChanged?.();
      onClose();
    },
    onError: () => toast.error("No hemos podido quitarlo"),
  });

  const pal = personColor(child?.id ?? (draft.name || "nuevo"));
  const initial = (draft.name.trim()[0] ?? "+").toUpperCase();

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-3">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-title text-base font-semibold"
              style={{ background: pal.soft, color: pal.ink }}
            >
              {initial}
            </span>
            <div>
              <SheetTitle>{child ? draft.name || "Peque" : "Nuevo peque"}</SheetTitle>
              <SheetDescription>
                Sus datos ayudan a que los menús de casa le sirvan también.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-[1.6fr_1fr] gap-2.5">
            <label className="space-y-1.5">
              <span className={field}>Nombre</span>
              <input
                className={control}
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Nombre"
              />
            </label>
            <label className="space-y-1.5">
              <span className={field}>Edad</span>
              <input
                className={control}
                inputMode="numeric"
                value={draft.age}
                onChange={(e) => patch({ age: e.target.value })}
                placeholder="—"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <span className={field}>¿Qué come?</span>
            <div className="grid gap-1.5">
              {STAGES.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => patch({ stage: key })}
                  className={`rounded-2xl px-4 py-2.5 text-left text-[13px] font-medium transition-colors ${
                    draft.stage === key
                      ? "bg-primary-soft text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {FEEDING_STAGE_LABEL[key]}
                </button>
              ))}
            </div>
            {draft.stage !== "mesa" ? (
              <p className="pt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {draft.stage === "pecho"
                  ? "No entra en el plan de comidas ni en la compra de la casa."
                  : "Lleva su propio triturado en el plan, aparte del plato de la mesa."}
              </p>
            ) : null}
          </div>

          {draft.stage === "mesa" ? (
            <div className="space-y-1.5">
              <span className={field}>Apetito</span>
              <div className="grid grid-cols-3 gap-1.5 rounded-full bg-muted p-1">
                {APPETITES.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => patch({ appetite: key })}
                    className={`rounded-full py-2 text-[13px] font-medium transition-colors ${
                      draft.appetite === key
                        ? "bg-surface text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="block space-y-1.5">
            <span className={field}>Alergias e intolerancias</span>
            <input
              className={control}
              value={draft.allergies}
              onChange={(e) => patch({ allergies: e.target.value })}
              placeholder="Ninguna"
            />
          </label>

          <label className="block space-y-1.5">
            <span className={field}>Notas</span>
            <textarea
              className={`${control} h-auto py-3 leading-relaxed`}
              rows={3}
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Ej. come en el cole de lunes a viernes"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !draft.name.trim()}
          className="mt-5 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {save.isPending ? "Guardando..." : "Guardar"}
        </button>

        {child ? (
          <button
            type="button"
            onClick={() => (confirmDelete ? drop.mutate() : setConfirmDelete(true))}
            disabled={drop.isPending}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete ? "Toca otra vez para quitarlo" : "Quitar de la familia"}
          </button>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
