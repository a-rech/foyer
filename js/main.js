import { supabase } from "./supabase-client.js";
import { signIn, signUp, getCurrentUser, onAuthChange } from "./auth.js";
import { getMyHousehold, createHousehold, joinHousehold } from "./household.js";
import { registerTab, navigateTo, initRouter } from "./router.js";
import { subscribeToTable } from "./sync.js";
import { getLastSeenMap, shouldShowBadge, setBadgeVisible } from "./badges.js";

import * as shoppingTab from "./tabs/shopping.js";
import * as recipesTab from "./tabs/recipes.js";
import * as calendarTab from "./tabs/calendar.js";
import * as notesTab from "./tabs/notes.js";
import * as preferencesTab from "./tabs/preferences.js";

const appEl = document.getElementById("app");

async function boot() {
  const user = await getCurrentUser();
  if (!user) return renderAuthScreen();

  const household = await getMyHousehold(user.id);
  if (!household) return renderHouseholdScreen(user);

  renderAppShell(user, household);
}

// ---------- Écran connexion ----------
function renderAuthScreen() {
  appEl.innerHTML = `
    <div class="screen">
      <h1>Foyer</h1>
      <form id="auth-form">
        <input id="email" type="email" placeholder="Email" required />
        <input id="password" type="password" placeholder="Mot de passe" required />
        <button type="submit" id="login-btn">Se connecter</button>
        <button type="button" id="signup-btn">Créer un compte</button>
      </form>
      <p class="error-msg" id="auth-error"></p>
    </div>
  `;

  const email = () => document.getElementById("email").value.trim();
  const password = () => document.getElementById("password").value;
  const errorEl = document.getElementById("auth-error");

  document.getElementById("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await signIn(email(), password());
      boot();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  document.getElementById("signup-btn").addEventListener("click", async () => {
    try {
      await signUp(email(), password());
      errorEl.style.color = "#16a34a";
      errorEl.textContent = "Compte créé. Vérifiez votre email si la confirmation est activée, puis connectez-vous.";
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// ---------- Écran création/rejoindre foyer ----------
function renderHouseholdScreen(user) {
  appEl.innerHTML = `
    <div class="screen">
      <h1>Votre foyer</h1>
      <h3>Créer un nouveau foyer</h3>
      <form id="create-form">
        <input id="household-name" placeholder="Nom du foyer" required />
        <button type="submit">Créer</button>
      </form>
      <h3>Rejoindre un foyer existant</h3>
      <form id="join-form">
        <input id="invite-code" placeholder="Code d'invitation" required />
        <button type="submit">Rejoindre</button>
      </form>
      <p class="error-msg" id="household-error"></p>
    </div>
  `;

  const errorEl = document.getElementById("household-error");

  document.getElementById("create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await createHousehold(document.getElementById("household-name").value.trim(), user.id);
      boot();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  document.getElementById("join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await joinHousehold(document.getElementById("invite-code").value, user.id);
      boot();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// ---------- App principale ----------
function renderAppShell(user, household) {
  appEl.innerHTML = `
    <div id="tab-content"></div>
    <nav id="bottom-nav">
      <button class="nav-item" data-tab="shopping">🛒<br>Courses<span class="badge-dot" data-tab-badge="shopping"></span></button>
      <button class="nav-item" data-tab="recipes">🍽️<br>Recettes<span class="badge-dot" data-tab-badge="recipes"></span></button>
      <button class="nav-item" data-tab="calendar">📅<br>Calendrier<span class="badge-dot" data-tab-badge="calendar"></span></button>
      <button class="nav-item" data-tab="notes">📝<br>Notes<span class="badge-dot" data-tab-badge="notes"></span></button>
      <button class="nav-item" data-tab="preferences">⚙️<br>Réglages</button>
    </nav>
  `;

  const ctx = { userId: user.id, householdId: household.id, household };

  // Enregistre chaque onglet avec son contexte (foyer + user) injecté au mount
  registerTab("shopping", { mount: (c) => shoppingTab.mount(c, ctx), unmount: shoppingTab.unmount });
  registerTab("recipes", { mount: (c) => recipesTab.mount(c, ctx), unmount: recipesTab.unmount });
  registerTab("calendar", { mount: (c) => calendarTab.mount(c, ctx), unmount: calendarTab.unmount });
  registerTab("notes", { mount: (c) => notesTab.mount(c, ctx), unmount: notesTab.unmount });
  registerTab("preferences", { mount: (c) => preferencesTab.mount(c, ctx), unmount: preferencesTab.unmount });

  initRouter("shopping");
  watchBadgesInBackground(ctx);
}

// Écoute en tâche de fond les tables des onglets non ouverts pour afficher un badge
async function watchBadgesInBackground(ctx) {
  const lastSeen = await getLastSeenMap(ctx.userId);
  const watchedTables = { shopping_items: "shopping", recipes: "recipes", events: "calendar", notes: "notes" };

  for (const [table, tabName] of Object.entries(watchedTables)) {
    subscribeToTable(table, ctx.householdId, (payload) => {
      const updatedAt = payload.new?.updated_at || payload.new?.created_at;
      if (shouldShowBadge(updatedAt, lastSeen[tabName])) {
        setBadgeVisible(tabName, true);
      }
    });
  }
}

onAuthChange(() => boot());
boot();

// Enregistrement du service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
