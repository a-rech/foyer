import { enterTab } from "../router.js";
import { setNewBadgeVisible, refreshTodayBadges } from "../badges.js";
import { getMyProfile } from "../profiles.js";

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

  // Recalcule les pastilles rouges à chaque retour à l'accueil (ex. après avoir
  // coché une tâche ou passé minuit) en plus de la mise à jour en temps réel.
  refreshTodayBadges(ctx.householdId);
}

export function unmount() {}

function greeting(name) {
  const who = name ? ` ${name}` : "";
  const hour = new Date().getHours();
  if (hour < 12) return `Bonjour${who} ☀️`;
  if (hour < 18) return `Bon après-midi${who} 🌤️`;
  return `Bonsoir${who} 🌙`;
}
