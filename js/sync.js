import { supabase } from "./supabase-client.js";
import { queueMutation, getQueuedMutations, clearMutation } from "./utils/db.js";

// S'abonne aux changements temps réel d'une table, filtrés par foyer.
// callback(payload) est appelé à chaque insert/update/delete.
export function subscribeToTable(table, householdId, callback) {
  const channel = supabase
    .channel(`${table}-${householdId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` },
      callback
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// Exécute une écriture (insert/update/delete). Si hors-ligne, la met en file
// pour rejouer plus tard. L'UI doit se mettre à jour de façon optimiste
// AVANT d'appeler cette fonction (ne pas attendre la réponse réseau).
export async function writeOrQueue(table, action, payload) {
  if (!navigator.onLine) {
    await queueMutation({ table, action, payload });
    return { queued: true };
  }

  try {
    return await executeMutation(table, action, payload);
  } catch (err) {
    // En cas d'échec réseau ponctuel, on met quand même en file
    await queueMutation({ table, action, payload });
    return { queued: true, error: err };
  }
}

async function executeMutation(table, action, payload) {
  if (action === "insert") return supabase.from(table).insert(payload);
  if (action === "update") return supabase.from(table).update(payload.values).eq("id", payload.id);
  if (action === "delete") return supabase.from(table).delete().eq("id", payload.id);
  throw new Error(`Action inconnue: ${action}`);
}

// À appeler au retour de connexion (event 'online') pour rejouer la file
export async function flushQueue() {
  const pending = await getQueuedMutations();
  for (const item of pending) {
    try {
      await executeMutation(item.table, item.action, item.payload);
      await clearMutation(item.id);
    } catch (err) {
      console.warn("Échec rejeu mutation, conservée en file:", err);
    }
  }
}

window.addEventListener("online", flushQueue);
