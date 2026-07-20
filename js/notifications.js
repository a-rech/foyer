import { supabase } from "./supabase-client.js";

// ⚠️ Clé publique VAPID de ce projet (sans risque à exposer côté client)
const VAPID_PUBLIC_KEY = "BJE7UpNgxW3K2RbEW9No2emnqlNHZ-z3fzixYJ2JAGawF7iMucoHU2CMt3f2qb2kEzs5GjaglBc0HHLKjGUTCD4";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  const permission = await Notification.requestPermission();
  return permission; // "granted" | "denied" | "default"
}

// Abonne cet appareil aux notifications push et enregistre l'abonnement en
// base. À appeler une fois la permission navigateur accordée.
export async function subscribeToPush(userId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Les notifications push ne sont pas supportées sur ce navigateur.");
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
}

export async function unsubscribeFromPush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    await subscription.unsubscribe();
  }
}

// Affiche une notification locale simple (pour rappels déclenchés côté client
// pendant que l'app est ouverte). Pour des rappels fiables app fermée, prévoir
// une Edge Function Supabase planifiée qui envoie de vraies Web Push - non
// incluse dans ce scaffold de départ, à ajouter en V2.
export function showLocalNotification(title, body) {
  if (Notification.permission !== "granted") return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(title, { body, icon: "icons/icon-192.png" });
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
