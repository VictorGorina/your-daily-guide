import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Baby,
  Copy,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { fetchMonthlyPlan, monthISO, todayISO } from "@/lib/daily";
import {
  DAY_LABEL,
  DAY_SHORT,
  MEAL_KEYS,
  MEAL_LABEL,
  toggleDay,
  type SharedMeals,
} from "@/lib/household-shared";
import {
  addChild,
  clearHouseholdGoal,
  createHousehold,
  fetchHousehold,
  joinHousehold,
  leaveHousehold,
  removeChild,
  renameHousehold,
  saveHouseholdGoal,
  saveSharedMeals,
  type HouseholdGoalType,
} from "@/lib/household";
import { syncHouseholdPlan } from "@/lib/household.functions";
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

function Hogar() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
  const sync = useServerFn(syncHouseholdPlan);

  const [name, setName] = useState("Mi casa");
  const [code, setCode] = useState("");
  const [shared, setShared] = useState<SharedMeals | null>(null);
  const [child, setChild] = useState({ name: "", age: "", allergies: "", appetite: "" });
  const [goalType, setGoalType] = useState<HouseholdGoalType>("comportamiento");
  const [goalText, setGoalText] = useState("");
  const [goalBudget, setGoalBudget] = useState("");

  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const monthSpend = shoppingTotal(planQ.data?.shopping);

  useEffect(() => {
    if (state.data?.me) setShared(state.data.me.shared_meals);
  }, [state.data?.me]);

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

  const join = useMutation({
    mutationFn: () => joinHousehold(code),
    onSuccess: () => {
      toast.success("Te has unido al hogar");
      setCode("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leave = useMutation({
    mutationFn: leaveHousehold,
    onSuccess: () => {
      toast.success("Has salido del hogar");
      refresh();
    },
  });

  const persistShared = useMutation({
    mutationFn: async (next: SharedMeals) => {
      await saveSharedMeals(next);
      await sync({ data: { month: monthISO(), today: todayISO() } });
    },
    onSuccess: () => {
      toast.success("Comidas compartidas actualizadas");
      refresh();
      qc.invalidateQueries({ queryKey: ["plan", monthISO()] });
    },
    onError: () => toast.error("No hemos podido guardar"),
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
      await addChild(householdId, {
        name: child.name.trim(),
        age: Number.isFinite(age) && age > 0 ? Math.round(age) : null,
        allergies: child.allergies.trim() || null,
        appetite: child.appetite.trim() || null,
        notes: null,
      });
    },
    onSuccess: () => {
      setChild({ name: "", age: "", allergies: "", appetite: "" });
      toast.success("Peque añadido");
      refresh();
    },
    onError: () => toast.error("Falta el nombre del peque"),
  });

  const dropChild = useMutation({
    mutationFn: (id: string) => removeChild(id),
    onSuccess: refresh,
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
            <h2 className="text-sm font-semibold">Unirme con un código</h2>
            <input
              className={`${input} uppercase tracking-widest`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
            />
            <button
              onClick={() => join.mutate()}
              disabled={join.isPending || code.trim().length < 4}
              className="w-full rounded-full bg-secondary py-3.5 text-sm font-medium disabled:opacity-60"
            >
              {join.isPending ? "Uniéndome..." : "Unirme al hogar"}
            </button>
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
              <Users className="h-3.5 w-3.5" /> Miembros
            </h3>
            <div className="mt-2 space-y-2">
              {members.map((m) => {
                const isMe = m.user_id === state.data?.me?.user_id;
                const initial = (m.display_name?.trim()?.[0] ?? "?").toUpperCase();
                return (
                  <div
                    key={m.user_id}
                    className="flex items-center gap-3 rounded-2xl bg-secondary px-4 py-3 text-sm"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft font-title text-sm font-semibold text-primary">
                      {initial}
                    </span>
                    <span className="flex-1 font-medium">
                      {m.display_name ?? "Sin nombre todavía"}
                    </span>
                    {isMe ? (
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        Tú
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="surface-card mt-4 p-5">
            <h2 className="text-sm font-semibold">¿Qué comidas compartís?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Marca los días que coméis lo mismo en casa. Solo se sincroniza cuando la otra persona
              también lo marca: los dos partís de un plato base común, salido de la misma compra. Si
              ese día quieres tu ración distinta (menos cantidad, sin un ingrediente...), dilo en
              "Comí distinto" desde Hoy — es tu ajuste personal, no cambia el plato del otro.
            </p>
            <div className="mt-4 space-y-4">
              {MEAL_KEYS.map((meal) => (
                <div key={meal}>
                  <p className="text-xs font-medium">{MEAL_LABEL[meal]}</p>
                  <div className="mt-2 grid grid-cols-7 gap-1.5">
                    {DAY_SHORT.map((label, day) => {
                      const active = shared?.[meal].includes(day) ?? false;
                      return (
                        <button
                          key={day}
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
            <button
              onClick={() => shared && persistShared.mutate(shared)}
              disabled={!shared || persistShared.isPending}
              className="mt-4 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {persistShared.isPending ? "Guardando y ajustando..." : "Guardar y ajustar planes"}
            </button>
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
                <div
                  key={c.id}
                  className="flex items-start gap-3 rounded-2xl bg-secondary px-4 py-3 text-sm"
                >
                  <span className="flex-1">
                    <span className="block font-medium">
                      {c.name}
                      {c.age ? ` · ${c.age} años` : ""}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Alergias: {c.allergies ?? "ninguna"} · Apetito: {c.appetite ?? "normal"}
                    </span>
                  </span>
                  <button onClick={() => dropChild.mutate(c.id)} aria-label={`Quitar ${c.name}`}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </button>
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
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={input}
                  inputMode="numeric"
                  value={child.age}
                  onChange={(e) => setChild({ ...child, age: e.target.value })}
                  placeholder="Edad"
                />
                <input
                  className={input}
                  value={child.appetite}
                  onChange={(e) => setChild({ ...child, appetite: e.target.value })}
                  placeholder="Apetito (poco, normal...)"
                />
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
