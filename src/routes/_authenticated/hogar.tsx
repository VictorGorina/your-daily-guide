import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, LogOut, Pencil, ShieldCheck } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { ChildSheet } from "@/components/child-sheet";
import { JoinOrCreateHousehold } from "@/components/hogar/join-or-create";
import { HouseholdRebuildCard } from "@/components/hogar/rebuild-card";
import { HouseholdRosterCard } from "@/components/hogar/roster-card";
import { HouseholdScheduleSection } from "@/components/hogar/schedule-section";
import { fetchMonthlyPlan, monthISO, todayISO } from "@/lib/daily";
import { EMPTY_SCHEDULE, eatsTableFood } from "@/lib/household-shared";
import { fetchHousehold, type HouseholdChild } from "@/lib/household";
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

function Hogar() {
  const { t } = useTranslation();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  // La mesa o los horarios cambiaron en esta visita: el plan del mes aún no
  // cuenta con ello hasta que quien planifica lo rehaga.
  const [tableChanged, setTableChanged] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [copied, setCopied] = useState(false);
  const [childSheet, setChildSheet] = useState<{ open: boolean; child: HouseholdChild | null }>({
    open: false,
    child: null,
  });

  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });

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
  // Los bebés que aún no comen de la mesa (la tarjeta los pinta en su grupo).
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

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      {!household ? (
        <Fragment key="no-household">
          <JoinOrCreateHousehold create={create} lookup={lookup} claim={claim} />
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

          <HouseholdRosterCard
            members={members}
            kids={children}
            meUserId={state.data?.me?.user_id}
            canManageRoster={canManageRoster}
            pendingKidNames={pendingKidMeals.map((c) => c.name)}
            addAdult={addAdult}
            fillKids={fillKidsMut}
            onOpenChild={openChild}
            renameMember={renameMember}
            setMemberPortion={setMemberPortion}
            markUsesApp={markUsesApp}
            makePlanner={makePlanner}
            dropMember={dropMember}
          />

          <HouseholdScheduleSection
            members={members}
            kids={children}
            sharedSlots={household.shared_slots}
            meUserId={state.data?.me?.user_id}
            isPlanner={isPlanner}
            plannerName={plannerName}
            persistSchedule={persistSchedule}
          />

          {isPlanner && (members.length > 1 || children.length > 0) ? (
            <HouseholdRebuildCard
              tableChanged={tableChanged}
              hasPlan={!!planQ.data?.plan}
              rebuild={rebuild}
            />
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
