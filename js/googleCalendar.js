import { supabase } from "./supabase-client.js";

// Connexion Google de l'utilisateur courant (une ligne par utilisateur, pas
// par foyer : chaque membre lie son propre compte Google individuellement).
export async function getGoogleConnection(userId) {
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Démarre le flux OAuth : demande une URL d'autorisation signée (nonce
// stocké côté serveur) à l'Edge Function, puis quitte la page vers Google.
// Le retour se fait sur index.html?google_calendar=connected|error, géré
// dans main.js + tabs/preferences.js.
export async function startGoogleConnection() {
  const { data, error } = await supabase.functions.invoke("google-oauth-start");
  if (error) throw error;
  if (!data?.url) throw new Error("URL d'autorisation Google manquante.");
  window.location.href = data.url;
}

export async function disconnectGoogleCalendar(userId) {
  const { error } = await supabase.from("google_calendar_connections").delete().eq("user_id", userId);
  if (error) throw error;
}

// Liste les calendriers Google (accès écriture) du compte connecté, via
// l'Edge Function (le rafraîchissement du token s'y fait côté serveur).
export async function listGoogleCalendars() {
  const { data, error } = await supabase.functions.invoke("google-calendar-manage", {
    body: { action: "list" },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.calendars ?? [];
}

// Crée un calendrier Google secondaire dédié (ex. "Foyer") pour ne pas
// exposer l'agenda personnel du membre au reste du foyer.
export async function createDedicatedGoogleCalendar(name = "Foyer") {
  const { data, error } = await supabase.functions.invoke("google-calendar-manage", {
    body: { action: "create", name },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.calendar;
}

export async function setGoogleCalendarChoice(userId, calendarId, calendarSummary) {
  const { error } = await supabase
    .from("google_calendar_connections")
    .update({ calendar_id: calendarId, calendar_summary: calendarSummary })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function setGoogleSyncEnabled(userId, enabled) {
  const { error } = await supabase
    .from("google_calendar_connections")
    .update({ sync_enabled: enabled })
    .eq("user_id", userId);
  if (error) throw error;
}
