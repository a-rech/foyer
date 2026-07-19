import { supabase } from "./supabase-client.js";

export const MEAL_SLOTS = [
  { key: "lunch", label: "Déjeuner" },
  { key: "dinner", label: "Dîner" },
];

export async function getWeekEntries(householdId, weekStart, weekEndExclusive) {
  const { data, error } = await supabase
    .from("meal_plan_entries")
    .select("*, recipes(id, title, ingredients)")
    .eq("household_id", householdId)
    .gte("meal_date", weekStart)
    .lt("meal_date", weekEndExclusive);
  if (error) throw error;
  return data;
}

// Assigne (ou remplace) le repas d'un jour/créneau donné
export async function setMealEntry({ householdId, mealDate, mealSlot, recipeId, customTitle, userId }) {
  const { error } = await supabase.from("meal_plan_entries").upsert(
    {
      household_id: householdId,
      meal_date: mealDate,
      meal_slot: mealSlot,
      recipe_id: recipeId ?? null,
      custom_title: customTitle ?? null,
      created_by: userId,
    },
    { onConflict: "household_id,meal_date,meal_slot" }
  );
  if (error) throw error;
}

export async function clearMealEntry(id) {
  const { error } = await supabase.from("meal_plan_entries").delete().eq("id", id);
  if (error) throw error;
}

// Toutes les recettes du foyer, à plat (pour le sélecteur de repas)
export async function getAllRecipesFlat(householdId) {
  const { data, error } = await supabase
    .from("recipes")
    .select("id, title, ingredients")
    .eq("household_id", householdId)
    .order("title", { ascending: true });
  if (error) throw error;
  return data;
}

// Crée une nouvelle liste de courses à partir des recettes planifiées sur la semaine
export async function generateShoppingListFromWeek(householdId, userId, weekLabel, entries) {
  const { data: list, error: listError } = await supabase
    .from("shopping_lists")
    .insert({ household_id: householdId, name: `Courses – ${weekLabel}`, created_by: userId })
    .select()
    .single();
  if (listError) throw listError;

  const items = [];
  for (const entry of entries) {
    if (!entry.recipes?.ingredients) continue;
    const lines = entry.recipes.ingredients
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      items.push({
        household_id: householdId,
        list_id: list.id,
        name: line,
        checked: false,
        added_by: userId,
      });
    }
  }

  if (items.length > 0) {
    const { error: itemsError } = await supabase.from("shopping_items").insert(items);
    if (itemsError) throw itemsError;
  }

  return { list, itemCount: items.length };
}
