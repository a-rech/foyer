import { supabase } from "./supabase-client.js";
import { getTasks, isTaskDue } from "./tasks.js";

// Marque un onglet comme "vu" par l'utilisateur courant (à appeler à l'ouverture de l'onglet)
export async function markTabSeen(userId, tabName) {
  await supabase
    .from("tab_last_seen")
    .upsert({ user_id: userId, tab_name: tabName, last_seen_at: new Date().toISOString() });
}

// Récupère la date de dernière visite de chaque onglet pour l'utilisateur
export async function getLastSeenMap(userId) {
  const { data, error } = await supabase
    .from("tab_last_seen")
    .select("tab_name, last_seen_at")
    .eq("user_id", userId);
  if (error) throw error;

  const map = {};
  for (const row of data) map[row.tab_name] = row.last_seen_at;
  return map;
}

// Affiche/masque le badge vert "N" (nouveau contenu ajouté par un autre membre du foyer)
export function setNewBadgeVisible(tabName, visible) {
  const el = document.querySelector(`.badge-new[data-tab-badge="${tabName}"]`);
  if (el) el.style.display = visible ? "flex" : "none";
}

// Affiche/masque la pastille rouge (événement ou tâche à accomplir aujourd'hui)
export function setTodayBadgeVisible(tabName, visible) {
  const el = document.querySelector(`.badge-today[data-tab-badge-today="${tabName}"]`);
  if (el) el.style.display = visible ? "block" : "none";
}

// À appeler quand un événement realtime arrive sur une table liée à un onglet
// non actuellement ouvert : compare la date de l'event à last_seen_at.
export function shouldShowBadge(eventUpdatedAt, lastSeenAt) {
  if (!lastSeenAt) return true;
  return new Date(eventUpdatedAt) > new Date(lastSeenAt);
}

// Recalcule et applique les pastilles rouges "à accomplir aujourd'hui" du
// calendrier et des tâches. Indépendant de la notion de dernière visite :
// reflète un fait objectif (échéance du jour), pas une nouveauté.
export async function refreshTodayBadges(householdId) {
  const [eventToday, taskToday] = await Promise.all([
    hasEventToday(householdId),
    hasTaskDueToday(householdId),
  ]);
  setTodayBadgeVisible("calendar", eventToday);
  setTodayBadgeVisible("tasks", taskToday);
}

async function hasEventToday(householdId) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const { data: todays, error: err1 } = await supabase
    .from("events")
    .select("id")
    .eq("household_id", householdId)
    .eq("is_birthday", false)
    .gte("start_at", startOfDay.toISOString())
    .lt("start_at", endOfDay.toISOString())
    .limit(1);
  if (!err1 && todays && todays.length > 0) return true;

  // Les anniversaires reviennent chaque année : on compare mois/jour uniquement.
  const { data: birthdays, error: err2 } = await supabase
    .from("events")
    .select("start_at")
    .eq("household_id", householdId)
    .eq("is_birthday", true);
  if (err2 || !birthdays) return false;
  return birthdays.some((e) => {
    const d = new Date(e.start_at);
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });
}

async function hasTaskDueToday(householdId) {
  try {
    const tasks = await getTasks(householdId);
    return tasks.some((t) => isTaskDue(t));
  } catch {
    return false;
  }
}
