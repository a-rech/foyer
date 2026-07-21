import { supabase } from "./supabase-client.js";
import { subscribeToTable } from "./sync.js";
import { getTasks, isTaskDue } from "./tasks.js";

// Tables surveillées pour le badge vert "N", et qui en est l'auteur sur chacune
const NEW_BADGE_SOURCES = [
  { table: "shopping_items", tab: "shopping", authorCol: "added_by" },
  { table: "notes", tab: "notes", authorCol: "created_by" },
  { table: "recipes", tab: "recipes", authorCol: "created_by" },
  { table: "meal_plan_entries", tab: "meals", authorCol: "created_by" },
];

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

// État des badges tenu en mémoire, indépendamment du DOM : évite qu'un badge
// calculé avant que l'accueil ne soit (re)dessiné ne soit perdu silencieusement.
const badgeState = { new: {}, today: {} };

// Affiche/masque le badge vert "N" (nouveau contenu ajouté par un autre membre du foyer)
export function setNewBadgeVisible(tabName, visible) {
  badgeState.new[tabName] = visible;
  applyBadge(".badge-new", "data-tab-badge", tabName, visible, "flex");
}

// Affiche/masque la pastille rouge (événement ou tâche à accomplir aujourd'hui)
export function setTodayBadgeVisible(tabName, visible) {
  badgeState.today[tabName] = visible;
  applyBadge(".badge-today", "data-tab-badge-today", tabName, visible, "block");
}

function applyBadge(selectorPrefix, attr, tabName, visible, displayValue) {
  const el = document.querySelector(`${selectorPrefix}[${attr}="${tabName}"]`);
  if (el) el.style.display = visible ? displayValue : "none";
}

// À appeler juste après avoir (re)dessiné les hero-cards de l'accueil, pour
// resynchroniser leurs badges avec le dernier état connu : les données des
// badges arrivent de façon asynchrone et peuvent être prêtes avant ou après
// que le DOM de l'accueil existe.
export function applyStoredBadges() {
  for (const [tab, visible] of Object.entries(badgeState.new)) applyBadge(".badge-new", "data-tab-badge", tab, visible, "flex");
  for (const [tab, visible] of Object.entries(badgeState.today)) applyBadge(".badge-today", "data-tab-badge-today", tab, visible, "block");
}

// À appeler quand un événement realtime arrive sur une table liée à un onglet
// non actuellement ouvert : compare la date de l'event à last_seen_at.
export function shouldShowBadge(eventUpdatedAt, lastSeenAt) {
  if (!lastSeenAt) return true;
  return new Date(eventUpdatedAt) > new Date(lastSeenAt);
}

// Calcule l'ensemble des ids "non vus" (ajoutés par un AUTRE membre du foyer
// après lastSeenAt) à partir de lignes déjà chargées. Réutilisable pour des
// badges par tuile (catégorie contenant une recette non vue, liste contenant
// un article non vu, note elle-même non vue...).
export function computeUnseenIds(rows, idCol, authorCol, userId, lastSeenAt) {
  const ids = new Set();
  for (const row of rows) {
    if (row[authorCol] !== userId && shouldShowBadge(row.created_at, lastSeenAt)) ids.add(row[idCol]);
  }
  return ids;
}

// Point d'entrée unique appelé une fois au démarrage de l'app : initialise puis
// maintient à jour les deux familles de badges (vert "N" et pastille rouge).
export async function initBadges(householdId, userId) {
  await watchNewBadges(householdId, userId);
  await refreshTodayBadges(householdId);
  subscribeToTable("events", householdId, () => refreshTodayBadges(householdId));
  subscribeToTable("household_tasks", householdId, () => refreshTodayBadges(householdId));
}

// Badge vert "N" : vérifie d'abord ce qui existe déjà en base (pour qu'il
// survive à un rechargement de page), puis réagit au temps réel. Ignore
// toujours les actions de l'utilisateur courant : seul le contenu ajouté par
// un AUTRE membre du foyer déclenche le badge. Une fois affiché, il ne
// disparaît qu'au clic sur la tuile correspondante (voir home.js).
async function watchNewBadges(householdId, userId) {
  const lastSeen = await getLastSeenMap(userId);

  await Promise.all(
    NEW_BADGE_SOURCES.map(async ({ table, tab, authorCol }) => {
      const hasUnseen = await hasUnseenContent(table, householdId, userId, authorCol, lastSeen[tab]);
      setNewBadgeVisible(tab, hasUnseen);
    })
  );

  for (const { table, tab, authorCol } of NEW_BADGE_SOURCES) {
    subscribeToTable(table, householdId, (payload) => {
      if (payload.eventType !== "INSERT") return; // seul un AJOUT déclenche le badge "nouveau"
      const row = payload.new;
      if (!row || row[authorCol] === userId) return; // ignore mes propres ajouts
      setNewBadgeVisible(tab, true);
    });
  }
}

async function hasUnseenContent(table, householdId, userId, authorCol, lastSeenAt) {
  const { data, error } = await supabase
    .from(table)
    .select(`id, created_at, ${authorCol}`)
    .eq("household_id", householdId);
  if (error) {
    console.error(`Badge "nouveau" : lecture de ${table} impossible`, error);
    return false;
  }
  if (!data) return false;

  const others = data.filter((row) => row[authorCol] !== userId);
  const unseen = others.filter((row) => shouldShowBadge(row.created_at, lastSeenAt));
  console.debug(
    `[badges] ${table} → ${data.length} ligne(s) au total, ${others.length} d'un autre membre, ${unseen.length} non vue(s) (last_seen=${lastSeenAt ?? "jamais"})`
  );
  return unseen.length > 0;
}

// Recalcule et applique les pastilles rouges "à accomplir aujourd'hui" du
// calendrier et des tâches. Indépendant de la notion de dernière visite :
// reflète un fait objectif (échéance du jour ou en retard), pas une nouveauté.
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
