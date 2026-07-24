import { supabase } from "./supabase-client.js";
import { randomTileColor } from "./utils/tileBoard.js";

export async function getLists(householdId) {
  const { data, error } = await supabase
    .from("shopping_lists")
    .select("*")
    .eq("household_id", householdId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createList(householdId, name, userId) {
  // Nouvelle liste toujours ajoutée en dernière position
  const { count } = await supabase
    .from("shopping_lists")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);

  const { data, error } = await supabase
    .from("shopping_lists")
    .insert({ household_id: householdId, name, created_by: userId, position: count ?? 0, color: randomTileColor() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Persiste la nouvelle position d'une liste après réordonnancement par glisser-déposer
export async function updateListPosition(id, position) {
  const { error } = await supabase.from("shopping_lists").update({ position }).eq("id", id);
  if (error) throw error;
}

// Persiste la couleur choisie manuellement sur la tuile
export async function updateListColor(id, color) {
  const { error } = await supabase.from("shopping_lists").update({ color }).eq("id", id);
  if (error) throw error;
}

export async function renameList(id, name) {
  const { error } = await supabase.from("shopping_lists").update({ name }).eq("id", id);
  if (error) throw error;
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
