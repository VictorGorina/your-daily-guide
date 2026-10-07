import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Baby,
  Check,
  ChevronDown,
  ChevronRight,
  ChefHat,
  Copy,
  LogOut,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { ChildMealGapBanner } from "@/components/child-meal-gap-banner";
import { ChildSheet } from "@/components/child-sheet";
import { fetchMonthlyPlan, monthISO, todayISO } from "@/lib/daily";
import {
  EMPTY_SCHEDULE,
  MEAL_KEYS,
  MEAL_LABEL,
  deriveSharedSlots,
  describeSharedSlots,
  eatsTableFood,
  personColor,
  toggleDay,
  type Appetite,
  type HomeSchedule,
} from "@/lib/household-shared";
import { fetchHousehold, type HouseholdChild, type OpenSlot } from "@/lib/household";
import { childPureeGaps } from "@/lib/plan-shared";
import { useHouseholdMutations } from "@/lib/use-household-mutations";

export const Route = createFileRoute("/_authenticated/hogar")({
  head: () => ({
    meta: [
      { title: "Tu hogar · Peppers" },
      {
        name: "description",
        content:
          "Une tu cuenta con quien vive contigo, decide qué comidas compartís y añade a los peques de casa.",
      },
      { property: "og:title", content: "Tu hogar · Peppers" },
      {
        property: "og:description",
        content: "Comidas compartidas, lista de la compra común y perfiles de los niños.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Hogar,
});

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

function Hogar() {
  const { t } = useTranslation();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  const [name, setName] = useState(() => t("hogar.create.defaultName"));
  const [code, setCode] = useState("");
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [addingType, setAddingType] = useState<"adult" | "child">("adult");
  const [newAdult, setNewAdult] = useState<{ name: string; usesApp: boolean; appetite: Appetite }>({
    name: "",
    usesApp: true,
    appetite: "normal",
  });
  // La mesa o los horarios cambiaron en esta visita: el plan del mes aún no
  // cuenta con ello hasta que quien planifica lo rehaga.
  const [tableChanged, setTableChanged] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [childSheet, setChildSheet] = useState<{ open: boolean; child: HouseholdChild | null }>({
    open: false,
    child: null,
  });
  // Per-member schedule drafts (keyed by member id or child id).
  const [schedDrafts, setSchedDrafts] = useState<Record<string, HomeSchedule>>({});
  // Which member/child schedule grids are expanded.
  const [schedExpanded, setSchedExpanded] = useState<Record<string, boolean>>({});

  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });

  useEffect(() => {
    // Initialize per-member schedule drafts from server data.
    if (state.data?.members?.length || state.data?.children?.length) {
      // Sin horario propio se parte de los días compartidos del hogar (no de
      // vacío): así "Guardar horario" no deja a nadie en "nunca en casa".
      const baseline = state.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
      const drafts: Record<string, HomeSchedule> = {};
      for (const m of state.data?.members ?? []) {
        drafts[m.id] = m.home_schedule ?? baseline;
      }
      for (const c of state.data?.children ?? []) {
        drafts[c.id] = c.home_schedule ?? baseline;
      }
      setSchedDrafts(drafts);
    }
  }, [state.data?.household, state.data?.members, state.data?.children]);

  const isCreator = state.data?.household?.created_by === state.data?.me?.user_id;
  const isPlanner = !!state.data?.me?.is_planner;
  const plannerName = state.data?.planner?.display_name ?? t("hogar.roster.plannerFallback");
  // Gestionar la mesa (añadir, renombrar, quitar, cambiar ración, ceder quién
  // planifica) lo puede hacer el creador o quien planifica ese hogar — así lo
  // permite ahora la policy de household_members (migración
  // 20260907120000_household_roster_planner_manages.sql). Antes solo miraba
  // isCreator: la base de datos ya dejaba pasar a un planificador que no fuera
  // el creador, pero el formulario seguía escondido.
  const canManageRoster = isCreator || isPlanner;

  // Un cambio en la mesa (entra/sale alguien, cambia una ración) invalida los
  // platos Y las cantidades del plan, pero ya no se rehace solo: lo pide quien
  // planifica con "Rehacer plan con la familia" (ver `rebuildPlanWithHousehold`).
  // Aquí solo se deja constancia para avisarle.
  const recalcRoster = () => setTableChanged(true);

  const {
    create,
    lookup,
    claim,
    addAdult,
    markUsesApp,
    dropMember,
    makePlanner,
    renameMember,
    setMemberPortion,
    renameHousehold,
    leave,
    persistSchedule,
    rebuild,
    fillKids: fillKidsMut,
  } = useHouseholdMutations({
    householdId: state.data?.household?.id,
    month,
    onTableChanged: recalcRoster,
    onPlanRebuilt: () => setTableChanged(false),
  });

  const household = state.data?.household;
  const members = state.data?.members ?? [];
  const children = state.data?.children ?? [];
  // Los bebés que aún no comen de la mesa van en su propio grupo, no con los
  // peques que sí comparten plato.
  const tableKids = children.filter((c) => eatsTableFood(c.feeding_stage));
  const babies = children.filter((c) => !eatsTableFood(c.feeding_stage));
  // A un bebé de triturados recién dado de alta (o recién cambiado de etapa)
  // le falta su puré en el plan hasta que se regenera — `childPureeGaps` mira
  // de hoy en adelante. Dispara el aviso de "Actualizar" bajo la lista.
  const today = todayISO();
  const householdBaseline = state.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
  const pendingKidMeals = babies.filter(
    (c) =>
      c.feeding_stage === "triturados" &&
      childPureeGaps(
        planQ.data?.plan ?? null,
        { id: c.id, stage: c.feeding_stage, homeSchedule: c.home_schedule ?? householdBaseline },
        today,
      ).length > 0,
  );

  const openChild = (child: HouseholdChild | null) => setChildSheet({ open: true, child });

  const renderChildRow = (c: HouseholdChild) => {
    const pal = personColor(c.id);
    // Quien aún no come de la mesa enseña su etapa en vez de alergias y apetito.
    const note = eatsTableFood(c.feeding_stage)
      ? ""
      : t(`hogar.child.stageNote.${c.feeding_stage}`);
    return (
      <button
        key={c.id}
        onClick={() => openChild(c)}
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
  };

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      {!household ? (
        <Fragment key="no-household">
          <h1 className="font-title text-[34px] font-semibold tracking-[-0.03em]">
            {t("hogar.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("hogar.intro")}</p>

          <section className="mt-6 rounded-[1.25rem] bg-primary-soft p-5">
            <h2 className="text-sm font-semibold">{t("hogar.join.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("hogar.join.hint")}
            </p>
            {!slots ? (
              <Fragment key="ask-code">
                <input
                  className="mt-3.5 h-[60px] w-full rounded-2xl bg-surface px-4 text-center font-title text-[26px] font-semibold uppercase tracking-[0.14em] outline-none focus:ring-2 focus:ring-ring/40"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  aria-label={t("hogar.join.codeLabel")}
                />
                <button
                  onClick={() => lookup.mutate(code, { onSuccess: (found) => setSlots(found) })}
                  disabled={lookup.isPending || code.trim().length < 4}
                  className="mt-2.5 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {lookup.isPending ? t("hogar.join.searching") : t("hogar.join.submit")}
                </button>
              </Fragment>
            ) : slots.length ? (
              <Fragment key="pick-who">
                <p className="mt-3 text-xs text-muted-foreground">{t("hogar.join.pickWho")}</p>
                <div className="mt-2 space-y-2">
                  {slots.map((s) => {
                    const pal = personColor(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() =>
                          claim.mutate(
                            { code, memberId: s.id },
                            {
                              onSuccess: () => {
                                setCode("");
                                setSlots(null);
                              },
                            },
                          )
                        }
                        disabled={claim.isPending}
                        className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-sm font-medium disabled:opacity-60"
                      >
                        <span
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-title text-sm font-semibold"
                          style={{ background: pal.soft, color: pal.ink }}
                        >
                          {(s.display_name.trim()[0] ?? "?").toUpperCase()}
                        </span>
                        {s.display_name}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setSlots(null)}
                  className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t("hogar.join.otherCode")}
                </button>
              </Fragment>
            ) : (
              <Fragment key="no-slots">
                <p className="mt-3 text-xs text-muted-foreground">{t("hogar.join.noSlots")}</p>
                <button
                  onClick={() => setSlots(null)}
                  className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t("hogar.join.otherCode")}
                </button>
              </Fragment>
            )}
          </section>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t("hogar.orStart")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <section className="surface-card space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4 text-primary-ink" /> {t("hogar.create.title")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("hogar.create.hint")}</p>
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("hogar.create.nameLabel")}
              aria-label={t("hogar.create.nameLabel")}
            />
            <button
              onClick={() => create.mutate(name)}
              disabled={create.isPending}
              className="w-full rounded-full bg-secondary py-3.5 text-sm font-semibold disabled:opacity-60"
            >
              {create.isPending ? t("hogar.create.creating") : t("hogar.create.submit")}
            </button>
          </section>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" />
            <p>{t("hogar.privacy")}</p>
          </div>
        </Fragment>
      ) : (
        <Fragment key="household">
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {t("hogar.eyebrow")}
              </span>
              {editingName ? (
                <input
                  autoFocus
                  defaultValue={household.name}
                  onBlur={(e) => {
                    renameHousehold(household.id, e.target.value);
                    setEditingName(false);
                  }}
                  className="mt-0.5 w-full rounded-xl bg-muted px-2 py-1 font-title text-[30px] font-semibold tracking-[-0.02em] outline-none focus:ring-2 focus:ring-ring/40"
                />
              ) : (
                <h1 className="mt-0.5 font-title text-[34px] font-semibold leading-tight tracking-[-0.03em]">
                  {household.name}
                </h1>
              )}
            </div>
            {!editingName ? (
              <button
                onClick={() => setEditingName(true)}
                aria-label={t("hogar.rename")}
                className="mt-4 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-border"
              >
                <Pencil className="h-[15px] w-[15px]" />
              </button>
            ) : null}
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" />
            <p>{t("hogar.privacyShared")}</p>
          </div>

          <section className="mt-4 rounded-[1.25rem] bg-primary-soft p-5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t("hogar.code.title")}
            </span>
            <div className="mt-2.5 flex items-center gap-3">
              <span className="flex-1 font-title text-[32px] font-semibold leading-none tracking-[0.14em]">
                {household.invite_code}
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(household.invite_code);
                  setCopied(true);
                  toast.success(t("hogar.code.copiedToast"));
                  window.setTimeout(() => setCopied(false), 1900);
                }}
                className="flex shrink-0 items-center gap-2 rounded-full bg-surface px-4 py-3 text-sm font-medium transition-colors hover:bg-secondary"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? t("hogar.code.copied") : t("hogar.code.copy")}
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {t("hogar.code.hint")}
            </p>
          </section>

          <section className="surface-card mt-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{t("hogar.roster.title")}</h2>
              <span className="text-[11px] text-muted-foreground">
                {t("hogar.roster.count", { count: members.length + children.length })}
              </span>
            </div>

            {/* --- Lista unificada: adultos primero, luego peques --- */}
            <div className="mt-4 space-y-2">
              {members.map((m) => {
                const isMe = !!m.user_id && m.user_id === state.data?.me?.user_id;
                const initial = (m.display_name.trim()[0] ?? "?").toUpperCase();
                const pal = personColor(m.id);
                return (
                  <div key={m.id} className="rounded-2xl bg-secondary px-4 py-3">
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
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {m.display_name}
                        </span>
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
                      <span className="text-[11px] text-muted-foreground">
                        {t("hogar.roster.portion")}
                      </span>
                      {APPETITES.map(([key, value]) => {
                        const active = Math.abs(m.portion - value) < 0.01;
                        return (
                          <button
                            key={key}
                            disabled={!canManageRoster}
                            onClick={() => setMemberPortion(m.id, value)}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                              active
                                ? "bg-primary-soft text-primary-ink"
                                : "bg-surface text-muted-foreground"
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
              })}

              {tableKids.map(renderChildRow)}
            </div>

            {babies.length ? (
              <div className="mt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {t("hogar.roster.babies")}
                </p>
                <div className="space-y-2">{babies.map(renderChildRow)}</div>
                <ChildMealGapBanner
                  names={pendingKidMeals.map((c) => c.name)}
                  pending={fillKidsMut.isPending}
                  onUpdate={() => fillKidsMut.mutate()}
                />
              </div>
            ) : null}

            {/* --- Añadir miembro: adulto o peque --- */}
            {canManageRoster ? (
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
                      <span className="text-[11px] text-muted-foreground">
                        {t("hogar.roster.portion")}
                      </span>
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
                            onSuccess: () =>
                              setNewAdult({ name: "", usesApp: true, appetite: "normal" }),
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
                    onClick={() => openChild(null)}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-2.5 text-sm font-medium text-foreground"
                  >
                    <Baby className="h-4 w-4" /> {t("hogar.add.addChild")}
                  </button>
                )}
              </div>
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

          <section className="surface-card mt-4 p-5">
            <h2 className="text-sm font-semibold">{t("hogar.schedule.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("hogar.schedule.intro")}
            </p>
            <button
              onClick={() => setShowHelp((v) => !v)}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary-ink"
            >
              {showHelp ? t("hogar.schedule.hideHelp") : t("hogar.schedule.showHelp")}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showHelp ? "rotate-180" : ""}`}
              />
            </button>
            {showHelp ? (
              <p className="mt-2.5 rounded-[14px] bg-muted px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                {t("hogar.schedule.help", { planner: plannerName })}
              </p>
            ) : null}

            {/* Per-member schedule grids */}
            <div className="mt-4 space-y-3">
              {[
                ...members.map((m) => ({
                  key: m.id,
                  name: m.display_name,
                  isChild: false,
                  canEdit: m.user_id === state.data?.me?.user_id || isPlanner,
                  colors: personColor(m.id),
                  memberId: m.id,
                  childId: undefined as string | undefined,
                })),
                ...children.map((c) => ({
                  key: c.id,
                  name: c.name,
                  isChild: true,
                  canEdit: isPlanner,
                  colors: personColor(c.id),
                  memberId: undefined as string | undefined,
                  childId: c.id,
                })),
              ].map((person) => {
                const expanded = schedExpanded[person.key] ?? false;
                const scheduleBaseline = state.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
                const draft = schedDrafts[person.key] ?? scheduleBaseline;
                const serverSched = person.isChild
                  ? children.find((c) => c.id === person.key)?.home_schedule
                  : members.find((m) => m.id === person.key)?.home_schedule;
                // Sin horario propio, el punto de partida es el del hogar: así no
                // se marca "sin guardar" nada más abrir.
                const hasChanges =
                  JSON.stringify(draft) !== JSON.stringify(serverSched ?? scheduleBaseline);

                return (
                  <div key={person.key} className="rounded-[14px] bg-secondary/50 p-3">
                    <button
                      type="button"
                      onClick={() => setSchedExpanded((p) => ({ ...p, [person.key]: !expanded }))}
                      className="flex w-full items-center gap-2.5"
                    >
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                        style={{
                          background: person.colors.soft,
                          color: person.colors.ink,
                        }}
                      >
                        {person.isChild ? (
                          <Baby className="h-3.5 w-3.5" />
                        ) : (
                          person.name.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="flex-1 text-left text-sm font-medium">
                        {person.name}
                        {person.memberId &&
                        members.find((m) => m.id === person.memberId)?.is_planner ? (
                          <ChefHat className="ml-1.5 inline h-3.5 w-3.5 text-primary-ink" />
                        ) : null}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {t("hogar.schedule.mealsPerWeek", {
                          n: MEAL_KEYS.reduce((sum, m) => sum + draft[m].length, 0),
                        })}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          expanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {expanded ? (
                      <div className="mt-3 space-y-3">
                        {MEAL_KEYS.map((meal) => {
                          const picked = draft[meal];
                          const mealLabel = t(`moments.${MEAL_LABEL[meal]}`);
                          return (
                            <div key={meal}>
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-xs font-medium">{mealLabel}</p>
                                <span className="text-[11px] text-muted-foreground">
                                  {picked.length
                                    ? t("hogar.schedule.ofSeven", { n: picked.length })
                                    : "—"}
                                </span>
                              </div>
                              <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                                {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                                  const active = picked.includes(day);
                                  return (
                                    <button
                                      key={day}
                                      disabled={!person.canEdit}
                                      aria-label={t("hogar.schedule.dayLabel", {
                                        name: person.name,
                                        meal: mealLabel,
                                        day: t(`weekdaysLong.${day}`),
                                      })}
                                      onClick={() =>
                                        setSchedDrafts((prev) => ({
                                          ...prev,
                                          [person.key]: {
                                            ...draft,
                                            [meal]: toggleDay(draft[meal], day),
                                          },
                                        }))
                                      }
                                      className={`h-[38px] rounded-[12px] text-xs font-medium transition-colors ${
                                        active
                                          ? "bg-primary-soft text-primary-ink"
                                          : "bg-secondary text-muted-foreground"
                                      } disabled:opacity-60`}
                                    >
                                      {t(`weekdaysInitial.${day}`)}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {person.canEdit && hasChanges ? (
                          <button
                            onClick={() =>
                              persistSchedule.mutate({
                                memberId: person.isChild ? undefined : person.memberId,
                                childId: person.isChild ? person.childId : undefined,
                                schedule: draft,
                              })
                            }
                            disabled={persistSchedule.isPending}
                            className="w-full rounded-full bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                          >
                            {persistSchedule.isPending
                              ? t("hogar.schedule.saving")
                              : t("hogar.schedule.save")}
                          </button>
                        ) : null}
                        {!person.canEdit ? (
                          <p className="text-[11px] text-muted-foreground">
                            {t("hogar.schedule.onlyPlanner", { planner: plannerName })}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Derived shared-slots summary */}
            {(() => {
              const baseline = state.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
              const derivedSlots = deriveSharedSlots(
                members.map((m) => ({
                  id: m.id,
                  isPlanner: m.is_planner,
                  homeSchedule: schedDrafts[m.id] ?? m.home_schedule ?? baseline,
                })),
                children.map((c) => ({
                  id: c.id,
                  homeSchedule: schedDrafts[c.id] ?? c.home_schedule ?? baseline,
                  stage: c.feeding_stage,
                })),
              );
              const anyShared = MEAL_KEYS.some((m) => derivedSlots[m].length);
              return anyShared ? (
                <div className="mt-4 rounded-[14px] bg-muted px-3.5 py-3">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t("hogar.schedule.shared", { slots: describeSharedSlots(derivedSlots, t) })}
                  </p>
                </div>
              ) : null;
            })()}
          </section>

          {isPlanner && (members.length > 1 || children.length > 0) ? (
            <section className="surface-card mt-4 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <RefreshCw className="h-4 w-4 text-primary-ink" /> {t("hogar.rebuild.title")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("hogar.rebuild.intro")}</p>
              {tableChanged ? (
                <p className="mt-3 rounded-2xl bg-primary-soft px-4 py-3 text-xs text-primary-ink">
                  {t("hogar.rebuild.changed")}
                </p>
              ) : null}
              <button
                onClick={() => rebuild.mutate()}
                disabled={rebuild.isPending || !planQ.data?.plan}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${rebuild.isPending ? "animate-spin" : ""}`} />
                {rebuild.isPending ? t("hogar.rebuild.running") : t("hogar.rebuild.submit")}
              </button>
              {rebuild.isPending ? (
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  {t("hogar.rebuild.wait")}
                </p>
              ) : !planQ.data?.plan ? (
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  {t("hogar.rebuild.noPlan")}
                </p>
              ) : null}
            </section>
          ) : null}

          <button
            onClick={() => leave.mutate()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-surface py-4 text-sm font-medium text-muted-foreground transition-colors hover:text-destructive"
          >
            <LogOut className="h-4 w-4" /> {t("hogar.leave.submit")}
          </button>

          <ChildSheet
            key={childSheet.child?.id ?? "new"}
            open={childSheet.open}
            child={childSheet.child}
            householdId={household.id}
            onClose={() => setChildSheet((s) => ({ ...s, open: false }))}
            onChanged={recalcRoster}
          />
        </Fragment>
      )}

      <BottomNav />
    </main>
  );
}
