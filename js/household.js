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
  // Passe par une fonction RPC (security definer) qui crée le foyer ET
  // ajoute le créateur comme membre en une seule transaction. Nécessaire car
  // faire les deux inserts séparément depuis le client se heurte à RLS :
  // au moment de créer le foyer, l'utilisateur n'est pas encore membre,
  // donc la policy SELECT (utilisée par le RETURNING de l'insert) le bloque.
  const { data, error } = await supabase.rpc("create_household_with_owner", {
    household_name: name,
  });
  if (error) throw error;
  return data;
}

export async function joinHousehold(inviteCode, userId) {
  // Même raison que createHousehold : impossible de lire "households" par
  // invite_code avant d'être membre (RLS), donc on passe par une fonction RPC.
  const { data, error } = await supabase.rpc("join_household_by_code", {
    code: inviteCode.trim(),
  });
  if (error) throw new Error(error.message || "Code d'invitation invalide.");
  return data;
}

export async function getHouseholdMembers(householdId) {
  const { data, error } = await supabase
    .from("household_members")
    .select("user_id, joined_at")
    .eq("household_id", householdId);
  if (error) throw error;
  return data;
}

// Retire un membre du foyer (accès révoqué : il devra utiliser un nouveau
// code d'invitation pour rejoindre à nouveau)
export async function removeMember(householdId, userId) {
  const { error } = await supabase
    .from("household_members")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId);
  if (error) throw error;
}
