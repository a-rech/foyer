import { navigateTo } from "../router.js";
import { setBadgeVisible } from "../badges.js";

const SECTIONS = [
  { tab: "shopping", label: "Listes", emoji: "🛒", color: "card-peach" },
  { tab: "recipes", label: "Recettes", emoji: "🍽️", color: "card-mint" },
  { tab: "calendar", label: "Calendrier", emoji: "📅", color: "card-sky" },
  { tab: "notes", label: "Bac à sable", emoji: "📝", color: "card-yellow" },
  { tab: "preferences", label: "Réglages", emoji: "⚙️", color: "card-lavender" },
];

export async function mount(container, ctx) {
  container.innerHTML = `
    <div class="home-screen">
      <p class="home-greeting">${greeting()}</p>
      <h1 class="home-household-name">${ctx.household?.name ?? "Votre foyer"}</h1>

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
      navigateTo(el.dataset.tab);
    });
  });
}

export function unmount() {}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bonjour ☀️";
  if (hour < 18) return "Bon après-midi 🌤️";
  return "Bonsoir 🌙";
}
