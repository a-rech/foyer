import { supabase } from "./supabase-client.js";

export async function getCategories(householdId) {
  const { data, error } = await supabase
    .from("recipe_categories")
    .select("*")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createCategory(householdId, name, userId) {
  const { data, error } = await supabase
    .from("recipe_categories")
    .insert({ household_id: householdId, name, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameCategory(id, name) {
  const { error } = await supabase.from("recipe_categories").update({ name }).eq("id", id);
  if (error) throw error;
}

// Suppression réelle en base (appelée seulement après expiration du délai d'annulation)
export async function deleteCategory(id) {
  const { error } = await supabase.from("recipe_categories").delete().eq("id", id);
  if (error) throw error;
}

export async function getRecipesForCategory(categoryId) {
  const { data, error } = await supabase
    .from("recipes")
    .select("*")
    .eq("category_id", categoryId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createRecipe(payload) {
  const { data, error } = await supabase.from("recipes").insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateRecipe(id, values) {
  const { error } = await supabase.from("recipes").update(values).eq("id", id);
  if (error) throw error;
}

// Suppression réelle en base (appelée seulement après expiration du délai d'annulation)
export async function deleteRecipe(id) {
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw error;
}
