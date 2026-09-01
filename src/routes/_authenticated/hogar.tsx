import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Baby,
  ChefHat,
  Copy,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { fetchMonthlyPlan, monthISO, todayISO } from "@/lib/daily";
import {
  childPortion,
  DAY_LABEL,
  DAY_SHORT,
  MEAL_KEYS,
  MEAL_LABEL,
  toggleDay,
  type Appetite,
  type SharedSlots,
} from "@/lib/household-shared";
import {
  addAdultSlot,
  addChild,
  claimSlot,
  clearHouseholdGoal,
  createHousehold,
  fetchHousehold,
  leaveHousehold,
  openSlots,
  removeChild,
  removeMember,
  renameHousehold,
  saveHouseholdGoal,
  setPlanner,
  updateChild,
  updateMember,
  type HouseholdGoalType,
  type OpenSlot,
} from "@/lib/household";
import { saveSharedSlots, syncHouseholdPlan } from "@/lib/household.functions";
import { eur, shoppingTotal } from "@/lib/plan-shared";

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

  const [name, setName] = useState("Mi casa");
  const [code, setCode] = useState("");
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [shared, setShared] = useState<SharedSlots | null>(null);
  const [child, setChild] = useState<{
    name: string;
    age: string;
    allergies: string;
    appetite: Appetite;
  }>({ name: "", age: "", allergies: "", appetite: "normal" });
  const [newAdult, setNewAdult] = useState<{ name: string; usesApp: boolean; appetite: Appetite }>({
    name: "",
    usesApp: true,
    appetite: "normal",
  });
  const [goalType, setGoalType] = useState<HouseholdGoalType>("comportamiento");
  const [goalText, setGoalText] = useState("");
  const [goalBudget, setGoalBudget] = useState("");

  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const monthSpend = shoppingTotal(planQ.data?.shopping);

  useEffect(() => {
    if (state.data?.household) setShared(state.data.household.shared_slots);
  }, [state.data?.household]);

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
    onError: () => toast.error("No hemos podido añadir a esa persona"),
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

  const newChild = useMutation({
    mutationFn: async () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      const age = Number(child.age.replace(",", "."));
      const ageVal = Number.isFinite(age) && age > 0 ? Math.round(age) : null;
      await addChild(householdId, {
        name: child.name.trim(),
        age: ageVal,
        allergies: child.allergies.trim() || null,
        appetite: child.appetite,
        portion: childPortion(ageVal, child.appetite),
        notes: null,
      });
    },
    onSuccess: () => {
      setChild({ name: "", age: "", allergies: "", appetite: "normal" });
      toast.success("Peque añadido");
      refresh();
    },
    onError: () => toast.error("Falta el nombre del peque"),
  });

  const dropChild = useMutation({
    mutationFn: (id: string) => removeChild(id),
    onSuccess: refresh,
  });

  const setChildAppetite = (id: string, age: number | null, appetite: Appetite) =>
    void updateChild(id, { appetite, portion: childPortion(age, appetite) }).then(refresh);

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

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      <h1 className="font-title text-[34px] font-semibold tracking-[-0.03em]">Tu hogar</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Si compartes mesa con alguien, vuestros menús y la compra se ajustan juntos. Sin perder tu
        propio plan.
      </p>

      <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Tu progreso personal (racha, comidas registradas, peso) nunca es visible para el resto del
          hogar. Solo compartís lo que marquéis aquí como comidas comunes y el objetivo del hogar de
          abajo.
        </p>
      </div>

      {!household ? (
        <Fragment key="no-household">
          <section className="surface-card mt-6 space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4 text-primary" /> Crear un hogar
            </h2>
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del hogar"
            />
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {create.isPending ? "Creando..." : "Crear hogar"}
            </button>
          </section>

          <section className="surface-card mt-4 space-y-3 p-5">
            <h2 className="text-sm font-semibold">Unirme a una familia</h2>
            {!slots ? (
              <Fragment key="ask-code">
                <input
                  className={`${input} uppercase tracking-widest`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                />
                <button
                  onClick={() => lookup.mutate()}
                  disabled={lookup.isPending || code.trim().length < 4}
                  className="w-full rounded-full bg-secondary py-3.5 text-sm font-medium disabled:opacity-60"
                >
                  {lookup.isPending ? "Buscando..." : "Buscar mi familia"}
                </button>
              </Fragment>
            ) : slots.length ? (
              <Fragment key="pick-who">
                <p className="text-xs text-muted-foreground">¿Quién eres? Toca tu nombre.</p>
                <div className="space-y-2">
                  {slots.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => claim.mutate(s.id)}
                      disabled={claim.isPending}
                      className="flex w-full items-center gap-3 rounded-2xl bg-secondary px-4 py-3 text-sm font-medium disabled:opacity-60"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft font-title text-sm font-semibold text-primary">
                        {(s.display_name.trim()[0] ?? "?").toUpperCase()}
                      </span>
                      {s.display_name}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setSlots(null)}
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                >
                  Probar otro código
                </button>
              </Fragment>
            ) : (
              <Fragment key="no-slots">
                <p className="text-xs text-muted-foreground">
                  No hay ningún sitio libre con ese código. Comprueba que está bien escrito o pídele
                  a quien creó la familia que te añada.
                </p>
                <button
                  onClick={() => setSlots(null)}
                  className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                >
                  Probar otro código
                </button>
              </Fragment>
            )}
          </section>
        </Fragment>
      ) : (
        <Fragment key="household">
          <section className="surface-card mt-6 p-5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Tu familia
            </span>
            <input
              className="mt-1 w-full rounded-2xl bg-muted px-3.5 py-2 font-title text-3xl font-semibold tracking-[-0.02em] outline-none"
              defaultValue={household.name}
              onBlur={(e) => {
                void renameHousehold(household.id, e.target.value).then(refresh);
              }}
            />

            <h3 className="mt-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> La mesa
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Todos los que coméis en casa. La compra se calcula para esta lista.
            </p>
            <div className="mt-3 space-y-2">
              {members.map((m) => {
                const isMe = !!m.user_id && m.user_id === state.data?.me?.user_id;
                const initial = (m.display_name.trim()[0] ?? "?").toUpperCase();
                return (
                  <div key={m.id} className="rounded-2xl bg-secondary px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft font-title text-sm font-semibold text-primary">
                        {initial}
                      </span>
                      {isCreator && !isMe ? (
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
                            disabled={!isCreator}
                            onClick={() => setMemberPortion(m.id, value)}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                              active
                                ? "bg-primary-soft text-primary"
                                : "bg-surface text-muted-foreground"
                            } ${isCreator ? "" : "opacity-70"}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {isCreator && !isMe ? (
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
            </div>

            {isCreator ? (
              <div className="mt-3 rounded-2xl bg-secondary/60 p-4">
                <p className="text-xs font-semibold">Añadir a alguien a la mesa</p>
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
                  <UserPlus className="h-4 w-4" /> Añadir
                </button>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Si usa la app, podrá unirse con el código y elegir su nombre de esta lista.
                </p>
              </div>
            ) : null}
          </section>

          <section className="surface-card mt-4 p-5">
            <h2 className="text-sm font-semibold">¿Qué comidas compartís?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Estos días coméis lo mismo en casa. Lo planifica y lo compra {plannerName}; tú marcas
              si ya lo tienes. Si ese día quieres tu ración distinta (menos cantidad, sin un
              ingrediente...), dilo en "Comí distinto" desde Hoy — es tu ajuste personal, no cambia
              el plato de los demás.
            </p>
            {!isPlanner ? (
              <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                Lo decide {plannerName}, que lleva la cocina en casa.
              </p>
            ) : null}
            <div
              className={`mt-4 space-y-4 ${isPlanner ? "" : "pointer-events-none opacity-70"}`}
              aria-disabled={!isPlanner}
            >
              {MEAL_KEYS.map((meal) => (
                <div key={meal}>
                  <p className="text-xs font-medium">{MEAL_LABEL[meal]}</p>
                  <div className="mt-2 grid grid-cols-7 gap-1.5">
                    {DAY_SHORT.map((label, day) => {
                      const active = shared?.[meal].includes(day) ?? false;
                      return (
                        <button
                          key={day}
                          disabled={!isPlanner}
                          aria-label={`${MEAL_LABEL[meal]} ${DAY_LABEL[day]}`}
                          onClick={() =>
                            setShared((prev) =>
                              prev ? { ...prev, [meal]: toggleDay(prev[meal], day) } : prev,
                            )
                          }
                          className={`h-10 rounded-xl text-xs font-medium transition-colors ${
                            active
                              ? "bg-primary-soft text-primary"
                              : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {isPlanner ? (
              <button
                onClick={() => shared && persistShared.mutate(shared)}
                disabled={!shared || persistShared.isPending}
                className="mt-4 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {persistShared.isPending ? "Guardando y ajustando..." : "Guardar y ajustar planes"}
              </button>
            ) : null}
            <button
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-3 text-sm font-medium disabled:opacity-60"
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

          <section className="surface-card mt-4 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Baby className="h-4 w-4 text-primary" /> Peques en casa
            </h2>
            <div className="mt-3 space-y-2">
              {state.data?.children.map((c) => (
                <div key={c.id} className="rounded-2xl bg-secondary px-4 py-3 text-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex-1">
                      <span className="block font-medium">
                        {c.name}
                        {c.age ? ` · ${c.age} años` : ""}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Alergias: {c.allergies ?? "ninguna"}
                      </span>
                    </span>
                    <button onClick={() => dropChild.mutate(c.id)} aria-label={`Quitar ${c.name}`}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">Apetito</span>
                    {APPETITES.map(([key, label]) => {
                      const active = c.appetite === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setChildAppetite(c.id, c.age, key)}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                            active
                              ? "bg-primary-soft text-primary"
                              : "bg-surface text-muted-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!state.data?.children.length ? (
                <p className="text-xs text-muted-foreground">
                  Añade a los niños para que los menús de casa les sirvan también.
                </p>
              ) : null}
            </div>

            <div className="mt-4 space-y-2">
              <input
                className={input}
                value={child.name}
                onChange={(e) => setChild({ ...child, name: e.target.value })}
                placeholder="Nombre"
              />
              <input
                className={input}
                inputMode="numeric"
                value={child.age}
                onChange={(e) => setChild({ ...child, age: e.target.value })}
                placeholder="Edad"
              />
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Apetito</span>
                {APPETITES.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setChild((p) => ({ ...p, appetite: key }))}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      child.appetite === key
                        ? "bg-primary-soft text-primary"
                        : "bg-surface text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                className={input}
                value={child.allergies}
                onChange={(e) => setChild({ ...child, allergies: e.target.value })}
                placeholder="Alergias o intolerancias"
              />
              <button
                onClick={() => newChild.mutate()}
                disabled={newChild.isPending || !child.name.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-3 text-sm font-medium disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> Añadir peque
              </button>
            </div>
          </section>

          <section className="surface-card mt-4 space-y-3 p-5">
            <h2 className="text-sm font-semibold">Invitar a la familia</h2>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(household.invite_code);
                toast.success("Código copiado");
              }}
              className="flex w-full items-center justify-between rounded-2xl bg-secondary px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground">Código de invitación</span>
              <span className="flex items-center gap-2 font-mono text-base tracking-widest">
                {household.invite_code} <Copy className="h-4 w-4 text-muted-foreground" />
              </span>
            </button>
            <p className="text-xs text-muted-foreground">
              Comparte este código para que alguien se una a la familia.
            </p>
          </section>

          <button
            onClick={() => leave.mutate()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-surface py-4 text-sm font-medium text-muted-foreground"
          >
            <LogOut className="h-4 w-4" /> Salir del hogar
          </button>
        </Fragment>
      )}

      <BottomNav />
    </main>
  );
}
