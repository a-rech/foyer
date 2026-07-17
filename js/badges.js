import { supabase } from "./supabase-client.js";

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

// Affiche/masque le point rouge sur un onglet du DOM
export function setBadgeVisible(tabName, visible) {
  const el = document.querySelector(`[data-tab-badge="${tabName}"]`);
  if (el) el.style.display = visible ? "block" : "none";
}

// À appeler quand un événement realtime arrive sur une table liée à un onglet
// non actuellement ouvert : compare la date de l'event à last_seen_at.
export function shouldShowBadge(eventUpdatedAt, lastSeenAt) {
  if (!lastSeenAt) return true;
  return new Date(eventUpdatedAt) > new Date(lastSeenAt);
}
