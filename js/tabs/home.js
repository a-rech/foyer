import { enterTab } from "../router.js";
import { setBadgeVisible } from "../badges.js";
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
            <span class="badge-dot" data-tab-badge="${s.tab}"></span>
          </button>
        `
        ).join("")}
      </div>
    </div>
  `;

  container.querySelectorAll(".hero-card").forEach((el) => {
    el.addEventListener("click", () => {
      setBadgeVisible(el.dataset.tab, false);
      enterTab(el.dataset.tab);
    });
  });
}

export function unmount() {}

function greeting(name) {
  const who = name ? ` ${name}` : "";
  const hour = new Date().getHours();
  if (hour < 12) return `Bonjour${who} ☀️`;
  if (hour < 18) return `Bon après-midi${who} 🌤️`;
  return `Bonsoir${who} 🌙`;
}
