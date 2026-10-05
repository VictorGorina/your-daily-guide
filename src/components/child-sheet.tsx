import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  personColor,
  type Appetite,
  type FeedingStage,
} from "@/lib/household-shared";

const field = "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const control =
  "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40";

const APPETITES: readonly Appetite[] = ["poco", "normal", "mucho"];

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
  const { t } = useTranslation();
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
      toast.success(child ? t("childSheet.updated") : t("childSheet.added"));
      refresh();
      onChanged?.();
      onClose();
    },
    onError: () => toast.error(t("childSheet.saveFailed")),
  });

  const drop = useMutation({
    mutationFn: () => removeChild(child!.id),
    onSuccess: () => {
      toast.success(t("childSheet.removed"));
      refresh();
      onChanged?.();
      onClose();
    },
    onError: () => toast.error(t("childSheet.removeFailed")),
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
              <SheetTitle>
                {child ? draft.name || t("childSheet.fallbackName") : t("childSheet.newTitle")}
              </SheetTitle>
              <SheetDescription>{t("childSheet.description")}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-[1.6fr_1fr] gap-2.5">
            <label className="space-y-1.5">
              <span className={field}>{t("childSheet.name")}</span>
              <input
                className={control}
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder={t("childSheet.name")}
              />
            </label>
            <label className="space-y-1.5">
              <span className={field}>{t("childSheet.age")}</span>
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
            <span className={field}>{t("childSheet.stage")}</span>
            <div className="grid gap-1.5">
              {STAGES.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => patch({ stage: key })}
                  className={`rounded-2xl px-4 py-2.5 text-left text-[13px] font-medium transition-colors ${
                    draft.stage === key
                      ? "bg-primary-soft text-primary-ink"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t(`feedingStage.${key}`)}
                </button>
              ))}
            </div>
            {draft.stage !== "mesa" ? (
              <p className="pt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {t(`childSheet.stageHint.${draft.stage}`)}
              </p>
            ) : null}
          </div>

          {draft.stage === "mesa" ? (
            <div className="space-y-1.5">
              <span className={field}>{t("childSheet.appetite")}</span>
              <div className="grid grid-cols-3 gap-1.5 rounded-full bg-muted p-1">
                {APPETITES.map((key) => (
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
                    {t(`appetite.${key}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="block space-y-1.5">
            <span className={field}>{t("childSheet.allergies")}</span>
            <input
              className={control}
              value={draft.allergies}
              onChange={(e) => patch({ allergies: e.target.value })}
              placeholder={t("childSheet.allergiesNone")}
            />
          </label>

          <label className="block space-y-1.5">
            <span className={field}>{t("childSheet.notes")}</span>
            <textarea
              className={`${control} h-auto py-3 leading-relaxed`}
              rows={3}
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder={t("childSheet.notesPlaceholder")}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !draft.name.trim()}
          className="mt-5 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {save.isPending ? t("childSheet.saving") : t("common.save")}
        </button>

        {child ? (
          <button
            type="button"
            onClick={() => (confirmDelete ? drop.mutate() : setConfirmDelete(true))}
            disabled={drop.isPending}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete ? t("childSheet.removeConfirm") : t("childSheet.remove")}
          </button>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
