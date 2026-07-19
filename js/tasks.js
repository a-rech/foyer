import { supabase } from "./supabase-client.js";

export const WEEKDAY_LABELS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Prochaine occurrence du jour de semaine `weekday` (0-6) à partir de `from` inclus
export function nextWeekday(from, weekday) {
  const d = startOfDay(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  return addDays(d, diff);
}

// Calcule la prochaine date d'échéance d'une tâche selon sa récurrence
export function computeNextDue(task) {
  if (task.recurrence === "none") {
    return task.last_completed_at ? null : startOfDay(task.created_at);
  }

  if (task.recurrence === "daily") {
    if (!task.last_completed_at) return startOfDay(new Date());
    return addDays(startOfDay(task.last_completed_at), task.recurrence_interval || 1);
  }

  if (task.recurrence === "monthly") {
    if (!task.last_completed_at) return startOfDay(new Date());
    const next = startOfDay(task.last_completed_at);
    next.setMonth(next.getMonth() + (task.recurrence_interval || 1));
    return next;
  }

  if (task.recurrence === "weekly") {
    const interval = task.recurrence_interval || 1;
    const weekday = task.recurrence_weekday ?? new Date(task.created_at).getDay();
    const anchor = task.recurrence_anchor ? startOfDay(task.recurrence_anchor) : nextWeekday(task.created_at, weekday);

    if (!task.last_completed_at) return anchor;

    const searchFrom = addDays(startOfDay(task.last_completed_at), 1);
    if (searchFrom <= anchor) return anchor;

    const msPerCycle = interval * 7 * 24 * 60 * 60 * 1000;
    const cyclesElapsed = Math.ceil((searchFrom - anchor) / msPerCycle);
    return new Date(anchor.getTime() + cyclesElapsed * msPerCycle);
  }

  return startOfDay(new Date());
}

export function isTaskDue(task) {
  const due = computeNextDue(task);
  if (!due) return false;
  return due <= startOfDay(new Date());
}

// Nombre de jours avant l'échéance (négatif = en retard), null si jamais due (tâche unique déjà faite)
export function daysUntilDue(task) {
  const due = computeNextDue(task);
  if (!due) return null;
  return Math.round((due - startOfDay(new Date())) / (24 * 60 * 60 * 1000));
}

export function dueLabel(task) {
  const days = daysUntilDue(task);
  if (days === null) return "";
  if (days < 0) return `En retard de ${-days} jour${-days > 1 ? "s" : ""}`;
  if (days === 0) return "À faire aujourd'hui";
  if (days === 1) return "À faire demain";
  return `À faire dans ${days} jours`;
}

export function recurrenceLabel(task) {
  if (task.recurrence === "none") return "Une fois";
  if (task.recurrence === "daily") {
    return task.recurrence_interval > 1 ? `Tous les ${task.recurrence_interval} jours` : "Tous les jours";
  }
  if (task.recurrence === "monthly") {
    return task.recurrence_interval > 1 ? `Tous les ${task.recurrence_interval} mois` : "Tous les mois";
  }
  if (task.recurrence === "weekly") {
    const weekday = task.recurrence_weekday ?? new Date(task.created_at).getDay();
    const dayName = WEEKDAY_LABELS[weekday].toLowerCase();
    return task.recurrence_interval > 1 ? `Un ${dayName} sur ${task.recurrence_interval}` : `Tous les ${dayName}s`;
  }
  return "";
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
