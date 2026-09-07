import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Baby,
  Check,
  ChevronDown,
  ChevronRight,
  ChefHat,
  Copy,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { ChildMealGapBanner } from "@/components/child-meal-gap-banner";
import { ChildSheet } from "@/components/child-sheet";
import { fetchMonthlyPlan, monthISO, todayISO } from "@/lib/daily";
import {
  DAY_LABEL,
  DAY_SHORT,
  EMPTY_SCHEDULE,
  MEAL_KEYS,
  MEAL_LABEL,
  cleanHomeSchedule,
  deriveSharedSlots,
  describeSharedSlots,
  eatsTableFood,
  FEEDING_STAGE_NOTE,
  personColor,
  toggleDay,
  type Appetite,
  type HomeSchedule,
  type SharedSlots,
} from "@/lib/household-shared";
import {
  addAdultSlot,
  claimSlot,
  clearHouseholdGoal,
  createHousehold,
  fetchHousehold,
  leaveHousehold,
  openSlots,
  removeMember,
  renameHousehold,
  saveHouseholdGoal,
  setPlanner,
  updateMember,
  type HouseholdChild,
  type HouseholdGoalType,
  type OpenSlot,
} from "@/lib/household";
import { saveHomeSchedule, saveSharedSlots, syncHouseholdPlan } from "@/lib/household.functions";
import { childPureeGaps, eur, shoppingTotal } from "@/lib/plan-shared";
import { fillChildMeals } from "@/lib/plan.functions";

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

/** Apetito → peso de ración para dimensionar la compra (adultos; los niños usan `childPortion`). */
const APPETITES: readonly [Appetite, string, number][] = [
  ["poco", "Poco", 0.8],
  ["normal", "Normal", 1],
  ["mucho", "Mucho", 1.2],
];
const portionFor = (a: Appetite) => APPETITES.find(([key]) => key === a)![2];

function Hogar() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
  const sync = useServerFn(syncHouseholdPlan);
  const saveSlots = useServerFn(saveSharedSlots);
  const saveSched = useServerFn(saveHomeSchedule);
  const fillKids = useServerFn(fillChildMeals);

  const [name, setName] = useState("Mi casa");
  const [code, setCode] = useState("");
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [shared, setShared] = useState<SharedSlots | null>(null);
  const [addingType, setAddingType] = useState<"adult" | "child">("adult");
  const [newAdult, setNewAdult] = useState<{ name: string; usesApp: boolean; appetite: Appetite }>({
    name: "",
    usesApp: true,
    appetite: "normal",
  });
  const [goalType, setGoalType] = useState<HouseholdGoalType>("comportamiento");
  const [goalText, setGoalText] = useState("");
  const [goalBudget, setGoalBudget] = useState("");
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
  const monthSpend = shoppingTotal(planQ.data?.shopping);

  useEffect(() => {
    if (state.data?.household) setShared(state.data.household.shared_slots);
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

  useEffect(() => {
    const household = state.data?.household;
    if (!household) return;
    setGoalType(household.goal_type ?? "comportamiento");
    setGoalText(household.goal_text ?? "");
    setGoalBudget(household.goal_budget_eur != null ? String(household.goal_budget_eur) : "");
  }, [state.data?.household]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["household"] });

  const create = useMutation({
    mutationFn: () => createHousehold(name),
    onSuccess: () => {
      toast.success("Hogar creado");
      refresh();
    },
    onError: () => toast.error("No hemos podido crear el hogar"),
  });

  const lookup = useMutation({
    mutationFn: () => openSlots(code),
    onSuccess: (found) => setSlots(found),
    onError: () => toast.error("No hemos podido buscar tu familia"),
  });

  const claim = useMutation({
    mutationFn: (memberId: string) => claimSlot(code, memberId),
    onSuccess: () => {
      toast.success("¡Ya estás en la familia!");
      setCode("");
      setSlots(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isCreator = state.data?.household?.created_by === state.data?.me?.user_id;
  const isPlanner = !!state.data?.me?.is_planner;
  const plannerName = state.data?.planner?.display_name ?? "quien lleva la cocina";
  // Gestionar la mesa (añadir, renombrar, quitar, cambiar ración, ceder quién
  // planifica) lo puede hacer el creador o quien planifica ese hogar — así lo
  // permite ahora la policy de household_members (migración
  // 20260907120000_household_roster_planner_manages.sql). Antes solo miraba
  // isCreator: la base de datos ya dejaba pasar a un planificador que no fuera
  // el creador, pero el formulario seguía escondido.
  const canManageRoster = isCreator || isPlanner;

  const addAdult = useMutation({
    mutationFn: () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      return addAdultSlot(householdId, {
        display_name: newAdult.name.trim(),
        uses_app: newAdult.usesApp,
        portion: portionFor(newAdult.appetite),
      });
    },
    onSuccess: () => {
      setNewAdult({ name: "", usesApp: true, appetite: "normal" });
      toast.success("Añadido a la mesa");
      refresh();
    },
    // Antes se descartaba el error real y siempre salía el mismo texto
    // genérico, así que un fallo (RLS, validación, lo que fuera) no se podía
    // diagnosticar ni por el usuario ni por nosotros.
    onError: (e: Error) => toast.error(e.message),
  });

  const markUsesApp = useMutation({
    mutationFn: (id: string) => updateMember(id, { uses_app: true }),
    onSuccess: refresh,
  });

  const dropMember = useMutation({
    mutationFn: (id: string) => removeMember(id),
    onSuccess: refresh,
  });

  const makePlanner = useMutation({
    mutationFn: (id: string) => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      return setPlanner(householdId, id);
    },
    onSuccess: () => {
      toast.success("Cambiado quién planifica en casa");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameMember = (id: string, value: string) =>
    void updateMember(id, { display_name: value.trim() || "Miembro" }).then(refresh);
  const setMemberPortion = (id: string, portion: number) =>
    void updateMember(id, { portion }).then(refresh);

  const leave = useMutation({
    mutationFn: leaveHousehold,
    onSuccess: () => {
      toast.success("Has salido del hogar");
      refresh();
    },
  });

  const persistShared = useMutation({
    mutationFn: async (next: SharedSlots) => {
      await saveSlots({ data: { slots: next } });
      await sync({ data: { month: monthISO(), today: todayISO() } });
    },
    onSuccess: () => {
      toast.success("Comidas compartidas actualizadas");
      refresh();
      qc.invalidateQueries({ queryKey: ["plan", monthISO()] });
    },
    onError: (e: Error) => toast.error(e.message || "No hemos podido guardar"),
  });

  const persistSchedule = useMutation({
    mutationFn: async (opts: { memberId?: string; childId?: string; schedule: HomeSchedule }) => {
      await saveSched({ data: opts });
      // Sync plan after schedule change
      await sync({ data: { month: monthISO(), today: todayISO() } });
    },
    onSuccess: () => {
      toast.success("Horario guardado");
      refresh();
      qc.invalidateQueries({ queryKey: ["plan", monthISO()] });
    },
    onError: (e: Error) => toast.error(e.message || "No hemos podido guardar el horario"),
  });

  const syncNow = useMutation({
    mutationFn: () => sync({ data: { month: monthISO(), today: todayISO() } }),
    onSuccess: (r) =>
      toast.success(
        r.synced
          ? "Plan compartido con el resto del hogar"
          : "Nada que sincronizar todavía (aún no hay comidas compartidas o plan del otro miembro)",
      ),
    onError: () => toast.error("No hemos podido sincronizar el plan"),
  });

  const saveGoal = useMutation({
    mutationFn: async () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      const budget = Number(goalBudget.replace(",", "."));
      await saveHouseholdGoal(householdId, {
        goal_type: goalType,
        goal_text: goalText,
        goal_budget_eur:
          Number.isFinite(budget) && budget > 0 ? Math.round(budget * 100) / 100 : null,
      });
    },
    onSuccess: () => {
      toast.success("Objetivo del hogar guardado");
      refresh();
    },
    onError: () => toast.error("No hemos podido guardar el objetivo"),
  });

  const dropGoal = useMutation({
    mutationFn: async () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      await clearHouseholdGoal(householdId);
    },
    onSuccess: () => {
      setGoalText("");
      setGoalBudget("");
      refresh();
    },
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
  const fillKidsMut = useMutation({
    mutationFn: () => fillKids({ data: { today } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      toast.success(
        res.filled ? `Menú de ${res.children.join(", ")} actualizado` : "Ya estaba al día",
      );
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : "No hemos podido actualizar el menú de los peques",
      ),
  });

  const openChild = (child: HouseholdChild | null) => setChildSheet({ open: true, child });

  const renderChildRow = (c: HouseholdChild) => {
    const pal = personColor(c.id);
    const note = FEEDING_STAGE_NOTE[c.feeding_stage];
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
            {c.age ? ` · ${c.age} ${c.age === 1 ? "año" : "años"}` : ""}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {note
              ? note
              : `${c.allergies ? `Alergias: ${c.allergies.toLowerCase()}` : "Sin alergias"} · apetito ${c.appetite ?? "normal"}`}
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
          <h1 className="font-title text-[34px] font-semibold tracking-[-0.03em]">Tu hogar</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Si compartes mesa con alguien, vuestros menús y la compra se ajustan juntos. Sin perder
            tu propio plan.
          </p>

          <section className="mt-6 rounded-[1.25rem] bg-primary-soft p-5">
            <h2 className="text-sm font-semibold">¿Ya te han pasado un código?</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Lo tiene arriba del todo quien ya esté dentro de la familia.
            </p>
            {!slots ? (
              <Fragment key="ask-code">
                <input
                  className="mt-3.5 h-[60px] w-full rounded-2xl bg-surface px-4 text-center font-title text-[26px] font-semibold uppercase tracking-[0.14em] outline-none focus:ring-2 focus:ring-ring/40"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                />
                <button
                  onClick={() => lookup.mutate()}
                  disabled={lookup.isPending || code.trim().length < 4}
                  className="mt-2.5 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {lookup.isPending ? "Buscando..." : "Unirme a la familia"}
                </button>
              </Fragment>
            ) : slots.length ? (
              <Fragment key="pick-who">
                <p className="mt-3 text-xs text-muted-foreground">¿Quién eres? Toca tu nombre.</p>
                <div className="mt-2 space-y-2">
                  {slots.map((s) => {
                    const pal = personColor(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => claim.mutate(s.id)}
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
                  Probar otro código
                </button>
              </Fragment>
            ) : (
              <Fragment key="no-slots">
                <p className="mt-3 text-xs text-muted-foreground">
                  No hay ningún sitio libre con ese código. Comprueba que está bien escrito o pídele
                  a quien creó la familia que te añada.
                </p>
                <button
                  onClick={() => setSlots(null)}
                  className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                >
                  Probar otro código
                </button>
              </Fragment>
            )}
          </section>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              o empieza tú
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <section className="surface-card space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4 text-primary" /> Crear un hogar
            </h2>
            <p className="text-xs text-muted-foreground">
              Tendrás un código para invitar a quien vive contigo.
            </p>
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del hogar"
            />
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="w-full rounded-full bg-secondary py-3.5 text-sm font-semibold disabled:opacity-60"
            >
              {create.isPending ? "Creando..." : "Crear hogar"}
            </button>
          </section>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Tu progreso personal (racha, comidas registradas, peso) nunca es visible para el resto
              del hogar.
            </p>
          </div>
        </Fragment>
      ) : (
        <Fragment key="household">
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Tu familia
              </span>
              {editingName ? (
                <input
                  autoFocus
                  defaultValue={household.name}
                  onBlur={(e) => {
                    void renameHousehold(household.id, e.target.value).then(refresh);
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
                aria-label="Cambiar el nombre de la familia"
                className="mt-4 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-border"
              >
                <Pencil className="h-[15px] w-[15px]" />
              </button>
            ) : null}
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Tu progreso personal (racha, comidas registradas, peso) nunca es visible para el resto
              del hogar. Solo compartís las comidas comunes y el objetivo del hogar.
            </p>
          </div>

          <section className="mt-4 rounded-[1.25rem] bg-primary-soft p-5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Código de la familia
            </span>
            <div className="mt-2.5 flex items-center gap-3">
              <span className="flex-1 font-title text-[32px] font-semibold leading-none tracking-[0.14em]">
                {household.invite_code}
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(household.invite_code);
                  setCopied(true);
                  toast.success("Código copiado");
                  window.setTimeout(() => setCopied(false), 1900);
                }}
                className="flex shrink-0 items-center gap-2 rounded-full bg-surface px-4 py-3 text-sm font-medium transition-colors hover:bg-secondary"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Quien lo tenga puede unirse a esta familia desde su app.
            </p>
          </section>

          <section className="surface-card mt-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Familia</h2>
              <span className="text-[11px] text-muted-foreground">
                {members.length + children.length}{" "}
                {members.length + children.length === 1 ? "miembro" : "miembros"}
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
                          <span className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-1 text-[11px] font-medium text-primary">
                            <ChefHat className="h-3 w-3" /> Planifica
                          </span>
                        ) : null}
                        {isMe ? (
                          <span className="rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            Tú
                          </span>
                        ) : !m.uses_app ? (
                          <span className="rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            Sin cuenta
                          </span>
                        ) : !m.user_id ? (
                          <span className="rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            Pendiente
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Ración</span>
                      {APPETITES.map(([key, label, value]) => {
                        const active = Math.abs(m.portion - value) < 0.01;
                        return (
                          <button
                            key={key}
                            disabled={!canManageRoster}
                            onClick={() => setMemberPortion(m.id, value)}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                              active
                                ? "bg-primary-soft text-primary"
                                : "bg-surface text-muted-foreground"
                            } ${canManageRoster ? "" : "opacity-70"}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {canManageRoster && !isMe ? (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {!m.uses_app ? (
                          <button
                            onClick={() => markUsesApp.mutate(m.id)}
                            className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Ya usa la app
                          </button>
                        ) : null}
                        {m.user_id && !m.is_planner ? (
                          <button
                            onClick={() => makePlanner.mutate(m.id)}
                            className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:underline"
                          >
                            Que planifique la casa
                          </button>
                        ) : null}
                        <button
                          onClick={() => dropMember.mutate(m.id)}
                          className="text-[11px] font-medium text-destructive underline-offset-2 hover:underline"
                        >
                          Quitar
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
                  Bebés · aún no comen de la mesa
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
                <p className="text-xs font-semibold">Añadir a alguien a la mesa</p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setAddingType("adult")}
                    className={`rounded-xl py-2.5 text-xs font-medium transition-colors ${
                      addingType === "adult"
                        ? "bg-primary-soft text-primary"
                        : "bg-surface text-muted-foreground"
                    }`}
                  >
                    Adulto
                  </button>
                  <button
                    onClick={() => setAddingType("child")}
                    className={`rounded-xl py-2.5 text-xs font-medium transition-colors ${
                      addingType === "child"
                        ? "bg-primary-soft text-primary"
                        : "bg-surface text-muted-foreground"
                    }`}
                  >
                    Peque
                  </button>
                </div>

                {addingType === "adult" ? (
                  <>
                    <input
                      className={`${input} mt-2`}
                      value={newAdult.name}
                      onChange={(e) => setNewAdult((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Nombre"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(
                        [
                          [true, "Usa la app"],
                          [false, "No usa la app"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={label}
                          onClick={() => setNewAdult((p) => ({ ...p, usesApp: value }))}
                          className={`rounded-xl py-2 text-xs font-medium transition-colors ${
                            newAdult.usesApp === value
                              ? "bg-primary-soft text-primary"
                              : "bg-surface text-muted-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Ración</span>
                      {APPETITES.map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setNewAdult((p) => ({ ...p, appetite: key }))}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            newAdult.appetite === key
                              ? "bg-primary-soft text-primary"
                              : "bg-surface text-muted-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => addAdult.mutate()}
                      disabled={addAdult.isPending || !newAdult.name.trim()}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-2.5 text-sm font-medium disabled:opacity-60"
                    >
                      <UserPlus className="h-4 w-4" /> Añadir adulto
                    </button>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Si usa la app, podrá unirse con el código y elegir su nombre de esta lista.
                    </p>
                  </>
                ) : (
                  <button
                    onClick={() => openChild(null)}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-2.5 text-sm font-medium text-foreground"
                  >
                    <Baby className="h-4 w-4" /> Añadir peque
                  </button>
                )}
              </div>
            ) : (
              // Explicar en vez de ocultar: antes este bloque simplemente
              // desaparecía para quien no era el creador, sin decir por qué.
              <p className="mt-3 rounded-2xl bg-secondary/60 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Solo quien creó la familia o quien planifica puede añadir gente a la mesa.
              </p>
            )}

            <div className="mt-4 flex items-start gap-2.5 rounded-[14px] bg-muted px-3.5 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Cada adulto edita su propio perfil desde Ajustes; aquí solo ves lo que comparte con
                la casa. A los peques los editáis entre todos.
              </p>
            </div>
          </section>

          <section className="surface-card mt-4 p-5">
            <h2 className="text-sm font-semibold">¿Cuándo come cada uno en casa?</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Cada persona marca los días que come en casa. Cuando coincidís, el plato es el mismo
              para todos.
            </p>
            <button
              onClick={() => setShowHelp((v) => !v)}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary"
            >
              {showHelp ? "Ocultar detalle" : "Cómo funciona exactamente"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showHelp ? "rotate-180" : ""}`}
              />
            </button>
            {showHelp ? (
              <p className="mt-2.5 rounded-[14px] bg-muted px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                Cada persona indica qué días come en casa para cada comida. Si varios coincidís,{" "}
                {plannerName} planifica el plato compartido. Si comes solo, tu plan va aparte. El
                snack siempre es individual.
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
                          <ChefHat className="ml-1.5 inline h-3.5 w-3.5 text-primary" />
                        ) : null}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {MEAL_KEYS.reduce((sum, m) => sum + draft[m].length, 0)} comidas/sem
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
                          return (
                            <div key={meal}>
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="text-xs font-medium">{MEAL_LABEL[meal]}</p>
                                <span className="text-[11px] text-muted-foreground">
                                  {picked.length ? `${picked.length} de 7` : "—"}
                                </span>
                              </div>
                              <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                                {DAY_SHORT.map((label, day) => {
                                  const active = picked.includes(day);
                                  return (
                                    <button
                                      key={day}
                                      disabled={!person.canEdit}
                                      aria-label={`${person.name} ${MEAL_LABEL[meal]} ${DAY_LABEL[day]}`}
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
                                          ? "bg-primary-soft text-primary"
                                          : "bg-secondary text-muted-foreground"
                                      } disabled:opacity-60`}
                                    >
                                      {label}
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
                            {persistSchedule.isPending ? "Guardando..." : "Guardar horario"}
                          </button>
                        ) : null}
                        {!person.canEdit ? (
                          <p className="text-[11px] text-muted-foreground">
                            Solo {plannerName} puede cambiar este horario.
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
                    Comidas en común → {describeSharedSlots(derivedSlots)}
                  </p>
                </div>
              ) : null;
            })()}

            <button
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-3 text-sm font-medium disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${syncNow.isPending ? "animate-spin" : ""}`} />
              Sincronizar el plan del mes
            </button>
          </section>

          <section className="surface-card mt-4 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Target className="h-4 w-4 text-primary" /> Objetivo del hogar
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Un objetivo compartido, visible para todos en casa. Vuestro progreso individual sigue
              siendo privado.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-full bg-secondary/80 p-1">
              {(
                [
                  ["comportamiento", "Un hábito"],
                  ["presupuesto", "Un presupuesto"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setGoalType(key)}
                  className={`rounded-full py-2 text-xs font-medium transition-colors ${
                    goalType === key ? "bg-surface text-primary" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {goalType === "comportamiento" ? (
              <input
                key="goal-text"
                className={`${input} mt-3`}
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder="Ej. cenar juntos entre semana"
                maxLength={140}
              />
            ) : (
              <input
                key="goal-budget"
                className={`${input} mt-3`}
                inputMode="decimal"
                value={goalBudget}
                onChange={(e) => setGoalBudget(e.target.value)}
                placeholder="Presupuesto compartido del mes (€)"
              />
            )}

            <button
              onClick={() => saveGoal.mutate()}
              disabled={
                saveGoal.isPending ||
                (goalType === "comportamiento" ? !goalText.trim() : !goalBudget.trim())
              }
              className="mt-3 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saveGoal.isPending ? "Guardando..." : "Guardar objetivo"}
            </button>

            {household.goal_type === "comportamiento" && household.goal_text ? (
              <p className="mt-4 flex items-start gap-2 rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                <Target className="mt-0.5 h-4 w-4 shrink-0" />
                {household.goal_text}
              </p>
            ) : null}

            {household.goal_type === "presupuesto" && household.goal_budget_eur ? (
              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Compra de este mes vs. objetivo del hogar
                  </p>
                  <span
                    className={`font-title text-lg font-semibold tabular-nums ${
                      monthSpend > household.goal_budget_eur ? "text-destructive" : "text-primary"
                    }`}
                  >
                    {eur(monthSpend)} / {eur(household.goal_budget_eur)}
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${
                      monthSpend > household.goal_budget_eur
                        ? "bg-danger"
                        : monthSpend / household.goal_budget_eur >= 0.85
                          ? "bg-warning"
                          : "bg-success"
                    }`}
                    style={{
                      width: `${Math.min(100, (monthSpend / household.goal_budget_eur) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Es el total de tu propia lista de la compra, la que se comparte con el resto del
                  hogar cuando marcáis comidas comunes.
                </p>
              </div>
            ) : null}

            {household.goal_type ? (
              <button
                onClick={() => dropGoal.mutate()}
                disabled={dropGoal.isPending}
                className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
              >
                Quitar objetivo
              </button>
            ) : null}
          </section>

          <button
            onClick={() => leave.mutate()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-surface py-4 text-sm font-medium text-muted-foreground transition-colors hover:text-destructive"
          >
            <LogOut className="h-4 w-4" /> Salir del hogar
          </button>

          <ChildSheet
            key={childSheet.child?.id ?? "new"}
            open={childSheet.open}
            child={childSheet.child}
            householdId={household.id}
            onClose={() => setChildSheet((s) => ({ ...s, open: false }))}
          />
        </Fragment>
      )}

      <BottomNav />
    </main>
  );
}
