import { supabase } from "./supabase-client.js";

// Intervalle en jours avant qu'une tâche récurrente redevienne "à faire"
// après sa dernière réalisation.
const RECURRENCE_DAYS = { daily: 1, weekly: 7, monthly: 30 };

// Une tâche "none" (unique) n'est jamais "due à nouveau" une fois faite :
// elle est archivée automatiquement à la complétion (voir completeTask).
export function isTaskDue(task) {
  if (!task.last_completed_at) return true;
  if (task.recurrence === "none") return false;
  const dueDate = new Date(task.last_completed_at);
  dueDate.setDate(dueDate.getDate() + (RECURRENCE_DAYS[task.recurrence] ?? 0));
  return new Date() >= dueDate;
}

export async function getTasks(householdId) {
  const { data, error } = await supabase
    .from("household_tasks")
    .select("*")
    .eq("household_id", householdId)
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createTask(payload) {
  const { error } = await supabase.from("household_tasks").insert(payload);
  if (error) throw error;
}

export async function updateTask(id, values) {
  const { error } = await supabase.from("household_tasks").update(values).eq("id", id);
  if (error) throw error;
}

// Suppression réelle en base (appelée seulement après expiration du délai d'annulation)
export async function deleteTask(id) {
  const { error } = await supabase.from("household_tasks").delete().eq("id", id);
  if (error) throw error;
}

export async function completeTask(task) {
  const values = { last_completed_at: new Date().toISOString() };
  if (task.recurrence === "none") values.archived = true;
  const { error } = await supabase.from("household_tasks").update(values).eq("id", task.id);
  if (error) throw error;
}
