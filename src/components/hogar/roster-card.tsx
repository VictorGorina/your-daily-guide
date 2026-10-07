import { Baby, ChefHat, ChevronRight, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ChildMealGapBanner } from "@/components/child-meal-gap-banner";
import type { HouseholdChild, HouseholdMember } from "@/lib/household";
import { eatsTableFood, personColor, type Appetite } from "@/lib/household-shared";
import type { useHouseholdMutations } from "@/lib/use-household-mutations";

type Mutations = ReturnType<typeof useHouseholdMutations>;
type RowActions = Pick<
  Mutations,
  "renameMember" | "setMemberPortion" | "markUsesApp" | "makePlanner" | "dropMember"
>;

const input =
  "h-12 w-full rounded-2xl bg-muted px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

/**
 * Apetito → peso de ración para dimensionar la compra (adultos; los niños usan
 * `childPortion`). La etiqueta sale del catálogo (`appetite.<clave>`).
 */
const APPETITES: readonly [Appetite, number][] = [
  ["poco", 0.8],
  ["normal", 1],
  ["mucho", 1.2],
];
const portionFor = (a: Appetite) => APPETITES.find(([key]) => key === a)![1];

/**
 * La mesa del hogar: adultos primero, luego los peques que comen de la mesa y,
 * en su propio grupo, los bebés. Debajo, el formulario de añadir — solo para
 * quien gestiona la mesa (`canManageRoster`: el creador o quien planifica).
 * Abrir la ficha de un peque (o una nueva, con `null`) lo hace la pantalla.
 */
export function HouseholdRosterCard({
  members,
  kids,
  meUserId,
  canManageRoster,
  pendingKidNames,
  addAdult,
  fillKids,
  onOpenChild,
  ...rowActions
}: {
  members: HouseholdMember[];
  kids: HouseholdChild[];
  meUserId: string | null | undefined;
  canManageRoster: boolean;
  /** Bebés de triturados a los que aún les falta su puré en el plan. */
  pendingKidNames: string[];
  addAdult: Mutations["addAdult"];
  fillKids: Mutations["fillKids"];
  onOpenChild: (child: HouseholdChild | null) => void;
} & RowActions) {
  const { t } = useTranslation();
  // Los bebés que aún no comen de la mesa van en su propio grupo, no con los
  // peques que sí comparten plato.
  const tableKids = kids.filter((c) => eatsTableFood(c.feeding_stage));
  const babies = kids.filter((c) => !eatsTableFood(c.feeding_stage));
  const renderChild = (c: HouseholdChild) => (
    <ChildRow key={c.id} c={c} onOpen={() => onOpenChild(c)} />
  );
  return (
    <section className="surface-card mt-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t("hogar.roster.title")}</h2>
        <span className="text-[11px] text-muted-foreground">
          {t("hogar.roster.count", { count: members.length + kids.length })}
        </span>
      </div>

      {/* --- Lista unificada: adultos primero, luego peques --- */}
      <div className="mt-4 space-y-2">
        {members.map((m) => (
          <AdultRow
            key={m.id}
            m={m}
            meUserId={meUserId}
            canManageRoster={canManageRoster}
            {...rowActions}
          />
        ))}

        {tableKids.map(renderChild)}
      </div>

      {babies.length ? (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t("hogar.roster.babies")}
          </p>
          <div className="space-y-2">{babies.map(renderChild)}</div>
          <ChildMealGapBanner
            names={pendingKidNames}
            pending={fillKids.isPending}
            onUpdate={() => fillKids.mutate()}
          />
        </div>
      ) : null}

      {/* --- Añadir miembro: adulto o peque --- */}
      {canManageRoster ? (
        <AddMemberForm addAdult={addAdult} onAddChild={() => onOpenChild(null)} />
      ) : (
        // Explicar en vez de ocultar: antes este bloque simplemente
        // desaparecía para quien no era el creador, sin decir por qué.
        <p className="mt-3 rounded-2xl bg-secondary/60 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
          {t("hogar.roster.onlyManagers")}
        </p>
      )}

      <div className="mt-4 flex items-start gap-2.5 rounded-[14px] bg-muted px-3.5 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{t("hogar.roster.profileNote")}</p>
      </div>
    </section>
  );
}

function AdultRow({
  m,
  meUserId,
  canManageRoster,
  renameMember,
  setMemberPortion,
  markUsesApp,
  makePlanner,
  dropMember,
}: {
  m: HouseholdMember;
  meUserId: string | null | undefined;
  canManageRoster: boolean;
} & RowActions) {
  const { t } = useTranslation();
  const isMe = !!m.user_id && m.user_id === meUserId;
  const initial = (m.display_name.trim()[0] ?? "?").toUpperCase();
  const pal = personColor(m.id);
  return (
    <div className="rounded-2xl bg-secondary px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-title text-[15px] font-semibold"
          style={{ background: pal.soft, color: pal.ink }}
        >
          {initial}
        </span>
        {canManageRoster && !isMe ? (
          <input
            className="min-w-0 flex-1 rounded-lg bg-muted px-2 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-ring/40"
            defaultValue={m.display_name}
            onBlur={(e) => renameMember(m.id, e.target.value)}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.display_name}</span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {m.is_planner ? (
            <span className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-1 text-[11px] font-medium text-primary-ink">
              <ChefHat className="h-3 w-3" /> {t("hogar.roster.planner")}
            </span>
          ) : null}
          {isMe ? (
            <span className="rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t("hogar.roster.you")}
            </span>
          ) : !m.uses_app ? (
            <span className="rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t("hogar.roster.noAccount")}
            </span>
          ) : !m.user_id ? (
            <span className="rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {t("hogar.roster.pending")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t("hogar.roster.portion")}</span>
        {APPETITES.map(([key, value]) => {
          const active = Math.abs(m.portion - value) < 0.01;
          return (
            <button
              key={key}
              disabled={!canManageRoster}
              onClick={() => setMemberPortion(m.id, value)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                active ? "bg-primary-soft text-primary-ink" : "bg-surface text-muted-foreground"
              } ${canManageRoster ? "" : "opacity-70"}`}
            >
              {t(`appetite.${key}`)}
            </button>
          );
        })}
      </div>

      {canManageRoster && !isMe ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {!m.uses_app ? (
            <button
              onClick={() => markUsesApp.mutate(m.id)}
              className="text-[11px] font-medium text-primary-ink underline-offset-2 hover:underline"
            >
              {t("hogar.roster.usesAppNow")}
            </button>
          ) : null}
          {m.user_id && !m.is_planner ? (
            <button
              onClick={() => makePlanner.mutate(m.id)}
              className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("hogar.roster.makePlanner")}
            </button>
          ) : null}
          <button
            onClick={() => dropMember.mutate(m.id)}
            className="text-[11px] font-medium text-destructive underline-offset-2 hover:underline"
          >
            {t("hogar.roster.remove")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChildRow({ c, onOpen }: { c: HouseholdChild; onOpen: () => void }) {
  const { t } = useTranslation();
  const pal = personColor(c.id);
  // Quien aún no come de la mesa enseña su etapa en vez de alergias y apetito.
  const note = eatsTableFood(c.feeding_stage) ? "" : t(`hogar.child.stageNote.${c.feeding_stage}`);
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl bg-secondary px-4 py-3 text-left transition-colors hover:bg-border"
    >
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
        style={{ background: pal.soft, color: pal.ink }}
      >
        <Baby className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {c.name}
          {c.age ? ` · ${t("hogar.child.age", { count: c.age })}` : ""}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {note
            ? note
            : t("hogar.child.summary", {
                allergies: c.allergies
                  ? t("hogar.child.allergies", { list: c.allergies.toLowerCase() })
                  : t("hogar.child.noAllergies"),
                appetite: t(`appetite.lower.${c.appetite ?? "normal"}`, {
                  defaultValue: c.appetite ?? "normal",
                }),
              })}
        </span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
    </button>
  );
}

function AddMemberForm({
  addAdult,
  onAddChild,
}: {
  addAdult: Mutations["addAdult"];
  onAddChild: () => void;
}) {
  const { t } = useTranslation();
  const [addingType, setAddingType] = useState<"adult" | "child">("adult");
  const [newAdult, setNewAdult] = useState<{ name: string; usesApp: boolean; appetite: Appetite }>({
    name: "",
    usesApp: true,
    appetite: "normal",
  });
  return (
    <div className="mt-3 rounded-2xl bg-secondary/60 p-4">
      <p className="text-xs font-semibold">{t("hogar.add.title")}</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={() => setAddingType("adult")}
          className={`rounded-xl py-2.5 text-xs font-medium transition-colors ${
            addingType === "adult"
              ? "bg-primary-soft text-primary-ink"
              : "bg-surface text-muted-foreground"
          }`}
        >
          {t("hogar.add.adult")}
        </button>
        <button
          onClick={() => setAddingType("child")}
          className={`rounded-xl py-2.5 text-xs font-medium transition-colors ${
            addingType === "child"
              ? "bg-primary-soft text-primary-ink"
              : "bg-surface text-muted-foreground"
          }`}
        >
          {t("hogar.add.child")}
        </button>
      </div>

      {addingType === "adult" ? (
        <>
          <input
            className={`${input} mt-2`}
            value={newAdult.name}
            onChange={(e) => setNewAdult((p) => ({ ...p, name: e.target.value }))}
            placeholder={t("hogar.add.name")}
            aria-label={t("hogar.add.adultNameLabel")}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                [true, "hogar.add.usesApp"],
                [false, "hogar.add.noApp"],
              ] as const
            ).map(([value, labelKey]) => (
              <button
                key={labelKey}
                onClick={() => setNewAdult((p) => ({ ...p, usesApp: value }))}
                className={`rounded-xl py-2 text-xs font-medium transition-colors ${
                  newAdult.usesApp === value
                    ? "bg-primary-soft text-primary-ink"
                    : "bg-surface text-muted-foreground"
                }`}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{t("hogar.roster.portion")}</span>
            {APPETITES.map(([key]) => (
              <button
                key={key}
                onClick={() => setNewAdult((p) => ({ ...p, appetite: key }))}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  newAdult.appetite === key
                    ? "bg-primary-soft text-primary-ink"
                    : "bg-surface text-muted-foreground"
                }`}
              >
                {t(`appetite.${key}`)}
              </button>
            ))}
          </div>
          <button
            onClick={() =>
              addAdult.mutate(
                {
                  name: newAdult.name,
                  usesApp: newAdult.usesApp,
                  portion: portionFor(newAdult.appetite),
                },
                {
                  onSuccess: () => setNewAdult({ name: "", usesApp: true, appetite: "normal" }),
                },
              )
            }
            disabled={addAdult.isPending || !newAdult.name.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-2.5 text-sm font-medium disabled:opacity-60"
          >
            <UserPlus className="h-4 w-4" /> {t("hogar.add.addAdult")}
          </button>
          <p className="mt-2 text-[11px] text-muted-foreground">{t("hogar.add.hint")}</p>
        </>
      ) : (
        <button
          onClick={() => onAddChild()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-2.5 text-sm font-medium text-foreground"
        >
          <Baby className="h-4 w-4" /> {t("hogar.add.addChild")}
        </button>
      )}
    </div>
  );
}
