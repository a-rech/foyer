import { supabase } from "./supabase-client.js";

// Récupère le foyer de l'utilisateur courant (null si aucun)
export async function getMyHousehold(userId) {
  const { data, error } = await supabase
    .from("household_members")
    .select("household_id, households(id, name, invite_code)")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.households ?? null;
}

export async function createHousehold(name, userId) {
  const { data: household, error } = await supabase
    .from("households")
    .insert({ name })
    .select()
    .single();
  if (error) throw error;

  const { error: memberError } = await supabase
    .from("household_members")
    .insert({ household_id: household.id, user_id: userId });
  if (memberError) throw memberError;

  return household;
}

export async function joinHousehold(inviteCode, userId) {
  const { data: household, error } = await supabase
    .from("households")
    .select("*")
    .eq("invite_code", inviteCode.trim())
    .single();
  if (error || !household) throw new Error("Code d'invitation invalide.");

  const { error: memberError } = await supabase
    .from("household_members")
    .insert({ household_id: household.id, user_id: userId });
  if (memberError) throw memberError;

  return household;
}

export async function getHouseholdMembers(householdId) {
  const { data, error } = await supabase
    .from("household_members")
    .select("user_id, joined_at")
    .eq("household_id", householdId);
  if (error) throw error;
  return data;
}
