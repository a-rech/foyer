import { supabase } from "./supabase-client.js";

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  const permission = await Notification.requestPermission();
  return permission; // "granted" | "denied" | "default"
}

// Affiche une notification locale simple (pour rappels déclenchés côté client
// pendant que l'app est ouverte). Pour des rappels fiables app fermée, prévoir
// une Edge Function Supabase planifiée qui envoie de vraies Web Push - non
// incluse dans ce scaffold de départ, à ajouter en V2.
export function showLocalNotification(title, body) {
  if (Notification.permission !== "granted") return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(title, { body, icon: "/icons/icon-192.png" });
  });
}

export async function getUserPreferences(userId) {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? { notifications_enabled: true, quiet_start: null, quiet_end: null };
}

export async function savePreferences(userId, prefs) {
  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, ...prefs });
  if (error) throw error;
}

// Vérifie si l'heure actuelle tombe dans la plage "ne pas déranger"
export function isQuietHours(quietStart, quietEnd) {
  if (!quietStart || !quietEnd) return false;
  const now = new Date().toTimeString().slice(0, 5);
  return quietStart < quietEnd
    ? now >= quietStart && now <= quietEnd
    : now >= quietStart || now <= quietEnd; // plage à cheval sur minuit
}
