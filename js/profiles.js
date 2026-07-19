import { supabase } from "./supabase-client.js";

export async function getMyProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

// Crée un profil avec un nom par défaut (dérivé de l'email) si l'utilisateur
// n'en a pas encore. Appelé une fois au démarrage de l'app.
export async function ensureProfile(user) {
  const existing = await getMyProfile(user.id);
  if (existing) return existing;

  const defaultName = user.email ? user.email.split("@")[0] : "Moi";
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id, display_name: defaultName })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDisplayName(userId, displayName) {
  const { error } = await supabase.from("profiles").upsert({ user_id: userId, display_name: displayName });
  if (error) throw error;
}

// Tous les profils des membres d'un foyer (pour les listes d'assignation)
export async function getHouseholdProfiles(householdId) {
  const { data: members, error: membersError } = await supabase
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId);
  if (membersError) throw membersError;

  const userIds = members.map((m) => m.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles, error } = await supabase.from("profiles").select("*").in("user_id", userIds);
  if (error) throw error;
  return profiles;
}
