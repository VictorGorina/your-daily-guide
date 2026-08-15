import { supabase } from "@/integrations/supabase/client";
import { cleanSharedMeals, type SharedMeals } from "@/lib/household-shared";

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

const randomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]!,
  ).join("");
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

export async function createHousehold(name: string): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Sin sesión");

  const { data, error } = await supabase
    .from("households")
    .insert({
      name: name.trim() || "Mi casa",
      invite_code: randomCode(),
      created_by: userId,
    } as never)
    .select("id")
    .single();
  if (error) throw error;

  const householdId = (data as { id: string }).id;
  const { error: memberError } = await supabase
    .from("household_members")
    .insert({ household_id: householdId, user_id: userId, role: "adulto" } as never);
  if (memberError) throw memberError;
  return householdId;
}

export async function joinHousehold(code: string) {
  const { error } = await supabase.rpc("join_household", { _invite_code: code.trim() });
  if (error) throw new Error(error.message.includes("Código") ? "Código no válido" : error.message);
}

export async function leaveHousehold() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sin sesión");
  const { error } = await supabase.from("household_members").delete().eq("user_id", auth.user.id);
  if (error) throw error;
}

export async function renameHousehold(id: string, name: string) {
  const { error } = await supabase
    .from("households")
    .update({ name: name.trim() || "Mi casa" } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function saveHouseholdGoal(
  id: string,
  goal: { goal_type: HouseholdGoalType; goal_text: string | null; goal_budget_eur: number | null },
) {
  const { error } = await supabase
    .from("households")
    .update({
      goal_type: goal.goal_type,
      goal_text: goal.goal_type === "comportamiento" ? goal.goal_text?.trim() || null : null,
      goal_budget_eur: goal.goal_type === "presupuesto" ? goal.goal_budget_eur : null,
    } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function clearHouseholdGoal(id: string) {
  const { error } = await supabase
    .from("households")
    .update({ goal_type: null, goal_text: null, goal_budget_eur: null } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function saveSharedMeals(shared: SharedMeals) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sin sesión");
  const { error } = await supabase
    .from("household_members")
    .update({ shared_meals: shared as never } as never)
    .eq("user_id", auth.user.id);
  if (error) throw error;
}

export async function addChild(householdId: string, child: Omit<HouseholdChild, "id">) {
  const { error } = await supabase
    .from("household_children")
    .insert({ household_id: householdId, ...child } as never);
  if (error) throw error;
}

export async function updateChild(id: string, patch: Partial<Omit<HouseholdChild, "id">>) {
  const { error } = await supabase
    .from("household_children")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function removeChild(id: string) {
  const { error } = await supabase.from("household_children").delete().eq("id", id);
  if (error) throw error;
}
