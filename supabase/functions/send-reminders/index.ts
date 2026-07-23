// Cette fonction est appelée périodiquement (toutes les 5 minutes, via un
// cron Postgres — voir les instructions de déploiement). À chaque appel,
// elle cherche les rappels d'événements qui arrivent à échéance dans la
// fenêtre écoulée depuis le dernier passage, et envoie une vraie
// notification push à chaque membre du foyer concerné (sauf s'il a coupé
// les notifications ou si on est dans sa plage silencieuse).

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const CHECK_WINDOW_MINUTES = 5; // doit correspondre à la fréquence du cron
const LOOKAHEAD_DAYS = 60; // horizon max pour ne pas scanner tous les événements futurs

webpush.setVapidDetails("mailto:contact@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  // Protection simple : seul un appel connaissant le secret peut déclencher l'envoi
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    console.log("Rejeté : x-cron-secret manquant ou incorrect");
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + CHECK_WINDOW_MINUTES * 60 * 1000);
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const { data: events, error } = await supabase
    .from("events")
    .select("id, household_id, title, start_at, reminders")
    .gt("start_at", now.toISOString())
    .lte("start_at", horizon.toISOString());

  if (error) {
    console.log("Erreur lecture events :", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log(`${events?.length ?? 0} événement(s) à venir dans les ${LOOKAHEAD_DAYS} jours`);

  let sentCount = 0;

  for (const event of events ?? []) {
    const reminders = Array.isArray(event.reminders) ? event.reminders : [];
    for (const reminder of reminders) {
      const ms = reminder.unit === "days" ? reminder.amount * 86400000 : reminder.amount * 3600000;
      const notifyAt = new Date(new Date(event.start_at).getTime() - ms);

      if (notifyAt < now || notifyAt >= windowEnd) continue;

      const reminderKey = `${reminder.amount}-${reminder.unit}`;

      const { data: already } = await supabase
        .from("sent_reminders")
        .select("id")
        .eq("event_id", event.id)
        .eq("reminder_key", reminderKey)
        .maybeSingle();
      if (already) {
        console.log(`"${event.title}" (${reminderKey}) déjà envoyé, ignoré`);
        continue;
      }

      console.log(`Envoi du rappel "${event.title}" (${reminderKey})`);
      await notifyHousehold(event, reminder, reminderKey);
      sentCount++;
    }
  }

  console.log(`Terminé : ${sentCount} rappel(s) envoyé(s)`);

  return new Response(JSON.stringify({ ok: true, sent: sentCount }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function notifyHousehold(event: any, reminder: any, reminderKey: string) {
  const { data: members } = await supabase
    .from("household_members")
    .select("user_id")
    .eq("household_id", event.household_id);

  const whenLabel =
    reminder.unit === "days"
      ? `dans ${reminder.amount} jour${reminder.amount > 1 ? "s" : ""}`
      : `dans ${reminder.amount} heure${reminder.amount > 1 ? "s" : ""}`;

  const payload = JSON.stringify({
    title: `Rappel : ${event.title}`,
    body: `C'est ${whenLabel}`,
    url: "./index.html",
  });

  for (const member of members ?? []) {
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("notifications_enabled, quiet_start, quiet_end")
      .eq("user_id", member.user_id)
      .maybeSingle();

    if (prefs?.notifications_enabled === false) {
      console.log(`Membre ${member.user_id} : notifications désactivées, ignoré`);
      continue;
    }
    if (isQuietHours(prefs?.quiet_start, prefs?.quiet_end)) {
      console.log(`Membre ${member.user_id} : plage silencieuse active, ignoré`);
      continue;
    }

    const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("user_id", member.user_id);
    console.log(`Membre ${member.user_id} : ${subs?.length ?? 0} abonnement(s) push`);

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        console.log(`Push envoyé à ${member.user_id} (${sub.endpoint.slice(0, 40)}...)`);
      } catch (err: any) {
        console.log(`Échec push pour ${member.user_id} : statusCode=${err.statusCode} ${err.body ?? err.message ?? ""}`);
        // Abonnement expiré ou invalide : on le retire pour ne plus réessayer
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }
  }

  await supabase.from("sent_reminders").insert({ event_id: event.id, reminder_key: reminderKey });
}

function isQuietHours(start?: string | null, end?: string | null) {
  if (!start || !end) return false;
  const now = new Date().toTimeString().slice(0, 5);
  return start < end ? now >= start && now <= end : now >= start || now <= end;
}
