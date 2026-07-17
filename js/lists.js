import { supabase } from "./supabase-client.js";

export async function getLists(householdId) {
  const { data, error } = await supabase
    .from("shopping_lists")
    .select("*")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createList(householdId, name, userId) {
  const { data, error } = await supabase
    .from("shopping_lists")
    .insert({ household_id: householdId, name, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Suppression réelle en base (appelée seulement après expiration du délai d'annulation)
export async function deleteList(id) {
  const { error } = await supabase.from("shopping_lists").delete().eq("id", id);
  if (error) throw error;
}

export async function getItemsForList(listId) {
  const { data, error } = await supabase
    .from("shopping_items")
    .select("*")
    .eq("list_id", listId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}
