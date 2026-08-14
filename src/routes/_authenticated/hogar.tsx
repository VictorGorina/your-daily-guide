import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Baby, Copy, LogOut, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { monthISO, todayISO } from "@/lib/daily";
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
  createHousehold,
  fetchHousehold,
  joinHousehold,
  leaveHousehold,
  removeChild,
  renameHousehold,
  saveSharedMeals,
} from "@/lib/household";
import { syncHouseholdPlan } from "@/lib/household.functions";

export const Route = createFileRoute("/_authenticated/hogar")({
  head: () => ({
    meta: [
      { title: "Tu hogar · Daily Guide" },
      {
        name: "description",
        content:
          "Une tu cuenta con quien vive contigo, decide qué comidas compartís y añade a los peques de casa.",
      },
      { property: "og:title", content: "Tu hogar · Daily Guide" },
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
  "h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

function Hogar() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
  const sync = useServerFn(syncHouseholdPlan);

  const [name, setName] = useState("Mi casa");
  const [code, setCode] = useState("");
  const [shared, setShared] = useState<SharedMeals | null>(null);
  const [child, setChild] = useState({ name: "", age: "", allergies: "", appetite: "" });

  useEffect(() => {
    if (state.data?.me) setShared(state.data.me.shared_meals);
  }, [state.data?.me]);

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

  const household = state.data?.household;
  const members = state.data?.members ?? [];
  const others = members.filter((m) => m.user_id !== state.data?.me?.user_id);

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      <h1 className="font-display text-3xl">Tu hogar</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Si compartes mesa con alguien, vuestros menús y la compra se ajustan juntos. Sin perder tu
        propio plan.
      </p>

      {!household ? (
        <>
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
              className="w-full rounded-full border border-input bg-surface py-3.5 text-sm font-medium disabled:opacity-60"
            >
              {join.isPending ? "Uniéndome..." : "Unirme al hogar"}
            </button>
          </section>
        </>
      ) : (
        <>
          <section className="surface-card mt-6 space-y-3 p-5">
            <h2 className="text-sm font-semibold">{household.name}</h2>
            <input
              className={input}
              defaultValue={household.name}
              onBlur={(e) => {
                void renameHousehold(household.id, e.target.value).then(refresh);
              }}
            />
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(household.invite_code);
                toast.success("Código copiado");
              }}
              className="flex w-full items-center justify-between rounded-2xl border border-dashed border-input bg-surface px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground">Código de invitación</span>
              <span className="flex items-center gap-2 font-mono text-base tracking-widest">
                {household.invite_code} <Copy className="h-4 w-4 text-muted-foreground" />
              </span>
            </button>
            <p className="text-xs text-muted-foreground">
              {members.length} adulto(s) en casa
              {others.length
                ? `: ${others.map((m) => m.display_name ?? "otra persona").join(", ")} y tú`
                : ". Comparte el código para que alguien se una."}
            </p>
          </section>

          <section className="surface-card mt-4 p-5">
            <h2 className="text-sm font-semibold">¿Qué comidas compartís?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Marca los días que coméis lo mismo en casa. Solo se sincroniza cuando la otra persona
              también lo marca.
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
                          className={`h-10 rounded-xl border text-xs font-medium transition-colors ${
                            active
                              ? "border-primary bg-primary-soft text-primary"
                              : "border-input bg-surface text-muted-foreground"
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
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-input bg-surface py-3 text-sm font-medium disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${syncNow.isPending ? "animate-spin" : ""}`} />
              Sincronizar el plan del mes
            </button>
          </section>

          <section className="surface-card mt-4 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Baby className="h-4 w-4 text-primary" /> Peques en casa
            </h2>
            <div className="mt-3 space-y-2">
              {state.data?.children.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-3 rounded-2xl border border-input bg-surface px-4 py-3 text-sm"
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
                className="flex w-full items-center justify-center gap-2 rounded-full border border-input bg-surface py-3 text-sm font-medium disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> Añadir peque
              </button>
            </div>
          </section>

          <button
            onClick={() => leave.mutate()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full border border-input py-4 text-sm font-medium text-muted-foreground"
          >
            <LogOut className="h-4 w-4" /> Salir del hogar
          </button>
        </>
      )}

      <BottomNav />
    </main>
  );
}
