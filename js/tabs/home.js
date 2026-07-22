import { enterTab } from "../router.js";
import { setNewBadgeVisible, refreshTodayBadges, applyStoredBadges } from "../badges.js";
import { getMyProfile } from "../profiles.js";
import { getTasks, isTaskDue } from "../tasks.js";
import { getWeekEntries } from "../meals.js";
import { supabase } from "../supabase-client.js";
import { escapeHtml } from "../utils/format.js";

const SECTIONS = [
  { tab: "shopping", label: "Listes", emoji: "🛒", color: "card-peach" },
  { tab: "notes", label: "Notes", emoji: "📝", color: "card-yellow" },
  { tab: "recipes", label: "Recettes", emoji: "🍽️", color: "card-mint" },
  { tab: "meals", label: "Repas", emoji: "🍲", color: "card-teal" },
  { tab: "calendar", label: "Calendrier", emoji: "📅", color: "card-sky" },
  { tab: "tasks", label: "Tâches", emoji: "🧹", color: "card-rose" },
  { tab: "preferences", label: "Réglages", emoji: "⚙️", color: "card-lavender" },
];

export async function mount(container, ctx) {
  const profile = await getMyProfile(ctx.userId);

  container.innerHTML = `
    <div class="home-screen">
      <h1 class="home-household-name">${ctx.household?.name ?? "Votre foyer"}</h1>
      <p class="home-greeting">${greeting(profile?.display_name)}</p>

      <section class="today-block">
        <h3>📌 Aujourd'hui</h3>
        <div id="today-block-body" class="today-block-body">
          <p class="today-empty">Chargement…</p>
        </div>
      </section>

      <div class="hero-grid">
        ${SECTIONS.map(
          (s) => `
          <button class="hero-card ${s.color}" data-tab="${s.tab}">
            <span class="hero-emoji">${s.emoji}</span>
            <span class="hero-label">${s.label}</span>
            <span class="badge-new" data-tab-badge="${s.tab}">N</span>
            <span class="badge-today" data-tab-badge-today="${s.tab}"></span>
          </button>
        `
        ).join("")}
      </div>
    </div>
  `;

  container.querySelectorAll(".hero-card").forEach((el) => {
    el.addEventListener("click", () => {
      // Seul le badge "nouveau contenu" se referme à l'ouverture de l'onglet ;
      // la pastille "à faire aujourd'hui" reflète un fait objectif et reste affichée.
      setNewBadgeVisible(el.dataset.tab, false);
      enterTab(el.dataset.tab);
    });
  });

  // Resynchronise les badges avec le dernier état connu : initBadges() calcule
  // ses résultats de façon asynchrone et peut résoudre avant ou après ce rendu.
  applyStoredBadges();

  // Recalcule les pastilles rouges à chaque retour à l'accueil (ex. après avoir
  // coché une tâche ou passé minuit) en plus de la mise à jour en temps réel.
  refreshTodayBadges(ctx.householdId);

  renderTodayBlock(ctx);
}

export function unmount() {}

function greeting(name) {
  const who = name ? ` ${name}` : "";
  const hour = new Date().getHours();
  if (hour < 12) return `Bonjour${who} ☀️`;
  if (hour < 18) return `Bon après-midi${who} 🌤️`;
  return `Bonsoir${who} 🌙`;
}

// ==========================================
// Bloc "Aujourd'hui" : tâches dues, événements et repas du jour
// ==========================================
async function renderTodayBlock(ctx) {
  const el = document.getElementById("today-block-body");
  if (!el) return;

  const [tasks, events, meals] = await Promise.all([
    getTasks(ctx.householdId).catch(() => []),
    getTodayEvents(ctx.householdId).catch(() => []),
    getTodayMeals(ctx.householdId).catch(() => []),
  ]);

  // Toujours revérifier que l'accueil est encore affiché (navigation possible pendant le chargement)
  if (!document.getElementById("today-block-body")) return;

  const dueTasks = tasks.filter((t) => isTaskDue(t));
  const groups = [];

  if (dueTasks.length > 0) {
    groups.push(`
      <div class="today-group" data-nav="tasks">
        <span class="today-group-title">🧹 Tâches</span>
        <span class="today-chips">
          ${dueTasks
            .slice(0, 5)
            .map((t) => `<span class="today-chip">${escapeHtml(t.title)}</span>`)
            .join("")}
          ${dueTasks.length > 5 ? `<span class="today-chip today-chip-more">+${dueTasks.length - 5}</span>` : ""}
        </span>
      </div>
    `);
  }

  if (events.length > 0) {
    groups.push(`
      <div class="today-group" data-nav="calendar">
        <span class="today-group-title">📅 Événements</span>
        <span class="today-chips">
          ${events.map((e) => `<span class="today-chip">${e.is_birthday ? "🎂 " : ""}${escapeHtml(e.title)}</span>`).join("")}
        </span>
      </div>
    `);
  }

  if (meals.length > 0) {
    groups.push(`
      <div class="today-group" data-nav="meals">
        <span class="today-group-title">🍲 Repas</span>
        <span class="today-chips">
          ${meals
            .map((m) => `<span class="today-chip">${escapeHtml(m.custom_title || m.recipes?.title || "Repas prévu")}</span>`)
            .join("")}
        </span>
      </div>
    `);
  }

  if (groups.length === 0) {
    el.innerHTML = `<p class="today-empty">Rien de prévu aujourd'hui ✨</p>`;
    return;
  }

  el.innerHTML = groups.join("");
  el.querySelectorAll("[data-nav]").forEach((group) => {
    group.addEventListener("click", () => enterTab(group.dataset.nav));
  });
}

async function getTodayEvents(householdId) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const { data: todays } = await supabase
    .from("events")
    .select("id, title, is_birthday")
    .eq("household_id", householdId)
    .eq("is_birthday", false)
    .gte("start_at", startOfDay.toISOString())
    .lt("start_at", endOfDay.toISOString());

  const { data: birthdays } = await supabase
    .from("events")
    .select("id, title, start_at, is_birthday")
    .eq("household_id", householdId)
    .eq("is_birthday", true);

  const todaysBirthdays = (birthdays || []).filter((e) => {
    const d = new Date(e.start_at);
    return d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });

  return [...(todays || []), ...todaysBirthdays];
}

async function getTodayMeals(householdId) {
  const todayStr = toDateInputValue(new Date());
  const tomorrowStr = toDateInputValue(addDays(new Date(), 1));
  return getWeekEntries(householdId, todayStr, tomorrowStr);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toDateInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
