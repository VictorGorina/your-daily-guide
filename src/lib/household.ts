import { currentUserId } from "@/lib/auth-headers";
import { supabase } from "@/integrations/supabase/client";
import { cleanSharedSlots, type SharedSlots } from "@/lib/household-shared";

export type HouseholdGoalType = "comportamiento" | "presupuesto";

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  goal_type: HouseholdGoalType | null;
  goal_text: string | null;
  goal_budget_eur: number | null;
  /** Comidas compartidas del hogar: mismo plato para todos. La fija el planificador. */
  shared_slots: SharedSlots;
};

export type HouseholdMember = {
  /** Id del hueco de la mesa (no del usuario). Estable aunque el hueco no esté reclamado. */
  id: string;
  /** `null` mientras el hueco no lo reclama nadie, o si es un adulto que no usa la app. */
  user_id: string | null;
  display_name: string;
  role: string;
  /** `false` = adulto que no usa la app: cuenta para la compra, nunca se reclama. */
  uses_app: boolean;
  /** El planificador de la casa: su plan y su lista de la compra son los del hogar. */
  is_planner: boolean;
  /** Peso de ración para dimensionar la compra (1 = ración de adulto estándar). */
  portion: number;
};

export type HouseholdChild = {
  id: string;
  name: string;
  age: number | null;
  allergies: string | null;
  appetite: string | null;
  notes: string | null;
  /** Peso de ración para la compra (1 = ración de adulto estándar). Ver `childPortion`. */
  portion: number;
};

export type HouseholdState = {
  household: Household | null;
  members: HouseholdMember[];
  children: HouseholdChild[];
  me: HouseholdMember | null;
  /** El miembro `is_planner` del hogar, si lo hay. */
  planner: HouseholdMember | null;
};

const randomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join("");
};

const EMPTY_STATE: HouseholdState = {
  household: null,
  members: [],
  children: [],
  me: null,
  planner: null,
};

export async function fetchHousehold(): Promise<HouseholdState> {
  const userId = await currentUserId();
  if (!userId) return EMPTY_STATE;

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();

  const householdId = (membership as { household_id?: string } | null)?.household_id;
  if (!householdId) return EMPTY_STATE;

  const [{ data: household }, { data: rawMembers }, { data: children }] = await Promise.all([
    supabase.from("households").select("*").eq("id", householdId).maybeSingle(),
    supabase.rpc("household_member_list"),
    supabase
      .from("household_children")
      .select("id, name, age, allergies, appetite, notes, portion")
      .eq("household_id", householdId)
      .order("created_at", { ascending: true }),
  ]);

  const members: HouseholdMember[] = (
    (rawMembers ?? []) as {
      id: string;
      user_id: string | null;
      display_name: string;
      role: string;
      uses_app: boolean;
      is_planner: boolean;
      portion: number;
    }[]
  ).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    display_name: m.display_name,
    role: m.role,
    uses_app: m.uses_app,
    is_planner: m.is_planner,
    portion: Number(m.portion) || 1,
  }));

  const rawHousehold = household as (Household & { shared_slots?: unknown }) | null;

  return {
    household: rawHousehold
      ? { ...rawHousehold, shared_slots: cleanSharedSlots(rawHousehold.shared_slots) }
      : null,
    members,
    children: ((children ?? []) as (HouseholdChild & { portion: unknown })[]).map((c) => ({
      ...c,
      portion: Number(c.portion) || 0.5,
    })),
    me: members.find((m) => m.user_id === userId) ?? null,
    planner: members.find((m) => m.is_planner) ?? null,
  };
}

export async function createHousehold(name: string): Promise<string> {
  const userId = await currentUserId();
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  const displayName =
    ((profile as { display_name?: string | null } | null)?.display_name ?? "").trim() || "Yo";

  // Quien crea el hogar es el primer miembro y el planificador de la casa.
  const { error: memberError } = await supabase.from("household_members").insert({
    household_id: householdId,
    user_id: userId,
    role: "adulto",
    display_name: displayName,
    is_planner: true,
  } as never);
  if (memberError) throw memberError;
  return householdId;
}

/** Un hueco de la mesa que aún nadie ha reclamado, para la pantalla "¿quién eres?". */
export type OpenSlot = { id: string; display_name: string };

/** Huecos adultos con app y sin reclamar del hogar de ese código de invitación. */
export async function openSlots(code: string): Promise<OpenSlot[]> {
  const { data, error } = await supabase.rpc("household_open_slots", {
    _invite_code: code.trim(),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as OpenSlot[];
}

/** Reclama un hueco concreto de la familia ("soy yo"). Devuelve el id del hogar. */
export async function claimSlot(code: string, memberId: string): Promise<string> {
  const { data, error } = await supabase.rpc("claim_household_slot", {
    _invite_code: code.trim(),
    _member_id: memberId,
  });
  if (error) {
    throw new Error(error.message.includes("Código") ? "Código no válido" : error.message);
  }
  return data as string;
}

/** @deprecated El alta ahora es en dos pasos: `openSlots` y luego `claimSlot`. */
export async function joinHousehold(code: string) {
  const { error } = await supabase.rpc("join_household", { _invite_code: code.trim() });
  if (error) throw new Error(error.message);
}

/** El creador añade a alguien a la mesa (hueco sin reclamar). */
export async function addAdultSlot(
  householdId: string,
  slot: { display_name: string; uses_app: boolean; portion?: number },
) {
  const { error } = await supabase.from("household_members").insert({
    household_id: householdId,
    user_id: null,
    role: "adulto",
    display_name: slot.display_name.trim() || "Miembro",
    uses_app: slot.uses_app,
    portion: slot.portion ?? 1,
  } as never);
  if (error) throw error;
}

/** Edita un hueco: nombre, ración, o marcar "ya usa la app" (D4). */
export async function updateMember(
  id: string,
  patch: Partial<Pick<HouseholdMember, "display_name" | "uses_app" | "portion">>,
) {
  const { error } = await supabase
    .from("household_members")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

/** Quita un hueco de la mesa (lo hace el creador). */
export async function removeMember(id: string) {
  const { error } = await supabase.from("household_members").delete().eq("id", id);
  if (error) throw error;
}

/** Nombra planificador a otro miembro con cuenta (creador o planificador actual). */
export async function setPlanner(householdId: string, memberId: string) {
  const { error } = await supabase.rpc("set_household_planner", {
    _household_id: householdId,
    _member_id: memberId,
  });
  if (error) throw new Error(error.message);
}

export async function leaveHousehold() {
  const userId = await currentUserId();
  if (!userId) throw new Error("Sin sesión");
  const { error } = await supabase.from("household_members").delete().eq("user_id", userId);
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
