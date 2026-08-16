import { supabase } from "./supabase";
import { cleanSharedMeals, type SharedMeals } from "./household-shared";

/**
 * Acceso al hogar, equivalente móvil de `src/lib/household.ts` (solo lectura por
 * ahora, que es lo que Hoy necesita para las comidas compartidas). Consultas
 * normales a Supabase protegidas por RLS, igual que la web. Copia, no código
 * compartido (ver AGENTS.md).
 */

export type HouseholdGoalType = "comportamiento" | "presupuesto";

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  goal_type: HouseholdGoalType | null;
  goal_text: string | null;
  goal_budget_eur: number | null;
};

export type HouseholdMember = {
  user_id: string;
  display_name: string | null;
  role: string;
  shared_meals: SharedMeals;
};

export type HouseholdChild = {
  id: string;
  name: string;
  age: number | null;
  allergies: string | null;
  appetite: string | null;
  notes: string | null;
};

export type HouseholdState = {
  household: Household | null;
  members: HouseholdMember[];
  children: HouseholdChild[];
  me: HouseholdMember | null;
};

export async function fetchHousehold(): Promise<HouseholdState> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return { household: null, members: [], children: [], me: null };

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();

  const householdId = (membership as { household_id?: string } | null)?.household_id;
  if (!householdId) return { household: null, members: [], children: [], me: null };

  const [{ data: household }, { data: rawMembers }, { data: children }] = await Promise.all([
    supabase.from("households").select("*").eq("id", householdId).maybeSingle(),
    supabase.rpc("household_member_list"),
    supabase
      .from("household_children")
      .select("id, name, age, allergies, appetite, notes")
      .eq("household_id", householdId)
      .order("created_at", { ascending: true }),
  ]);

  const members: HouseholdMember[] = (
    (rawMembers ?? []) as {
      user_id: string;
      display_name: string | null;
      role: string;
      shared_meals: unknown;
    }[]
  ).map((m) => ({
    user_id: m.user_id,
    display_name: m.display_name,
    role: m.role,
    shared_meals: cleanSharedMeals(m.shared_meals),
  }));

  return {
    household: (household as Household | null) ?? null,
    members,
    children: (children ?? []) as HouseholdChild[],
    me: members.find((m) => m.user_id === userId) ?? null,
  };
}
