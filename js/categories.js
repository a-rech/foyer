import { supabase } from "./supabase-client.js";

export async function getCategories(householdId) {
  const { data, error } = await supabase
    .from("recipe_categories")
    .select("*")
    .eq("household_id", householdId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createCategory(householdId, name, userId) {
  // Nouvelle catégorie toujours ajoutée en dernière position
  const { count } = await supabase
    .from("recipe_categories")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId);

  const { data, error } = await supabase
    .from("recipe_categories")
    .insert({ household_id: householdId, name, created_by: userId, position: count ?? 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Persiste la nouvelle position d'une catégorie après réordonnancement par glisser-déposer
export async function updateCategoryPosition(id, position) {
  const { error } = await supabase.from("recipe_categories").update({ position }).eq("id", id);
  if (error) throw error;
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
    .order("position", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createRecipe(payload) {
  // Nouvelle recette toujours ajoutée en dernière position dans sa catégorie
  const { count } = await supabase
    .from("recipes")
    .select("id", { count: "exact", head: true })
    .eq("category_id", payload.category_id);

  const { data, error } = await supabase
    .from("recipes")
    .insert({ ...payload, position: count ?? 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Persiste la nouvelle position d'une recette après réordonnancement par glisser-déposer
export async function updateRecipePosition(id, position) {
  const { error } = await supabase.from("recipes").update({ position }).eq("id", id);
  if (error) throw error;
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
