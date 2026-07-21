import { supabase } from "./supabase-client.js";
import { signIn, signUp, getCurrentUser, onAuthChange } from "./auth.js";
import { getMyHousehold, createHousehold, joinHousehold } from "./household.js";
import { registerTab, initRouter } from "./router.js";
import { initBadges } from "./badges.js";
import { ensureProfile } from "./profiles.js";

import * as homeTab from "./tabs/home.js";
import * as shoppingTab from "./tabs/shopping.js";
import * as recipesTab from "./tabs/recipes.js";
import * as calendarTab from "./tabs/calendar.js";
import * as notesTab from "./tabs/notes.js";
import * as tasksTab from "./tabs/tasks.js";
import * as mealsTab from "./tabs/meals.js";
import * as preferencesTab from "./tabs/preferences.js";

const appEl = document.getElementById("app");

async function boot() {
  const user = await getCurrentUser();
  if (!user) return renderAuthScreen();

  const household = await getMyHousehold(user.id);
  if (!household) return renderHouseholdScreen(user);

  await ensureProfile(user);
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
  appEl.innerHTML = `<div id="tab-content"></div>`;

  const ctx = { userId: user.id, householdId: household.id, household };

  // Enregistre chaque onglet avec son contexte (foyer + user) injecté au mount
  registerTab("home", { mount: (c) => homeTab.mount(c, ctx), unmount: homeTab.unmount });
  registerTab("shopping", { mount: (c) => shoppingTab.mount(c, ctx), unmount: shoppingTab.unmount });
  registerTab("recipes", { mount: (c) => recipesTab.mount(c, ctx), unmount: recipesTab.unmount });
  registerTab("calendar", { mount: (c) => calendarTab.mount(c, ctx), unmount: calendarTab.unmount });
  registerTab("notes", { mount: (c) => notesTab.mount(c, ctx), unmount: notesTab.unmount });
  registerTab("tasks", { mount: (c) => tasksTab.mount(c, ctx), unmount: tasksTab.unmount });
  registerTab("meals", { mount: (c) => mealsTab.mount(c, ctx), unmount: mealsTab.unmount });
  registerTab("preferences", { mount: (c) => preferencesTab.mount(c, ctx), unmount: preferencesTab.unmount });

  initRouter("home");
  initBadges(ctx.householdId, ctx.userId);
}

// onAuthChange() déclenche déjà son callback immédiatement avec la session en
// cours à l'enregistrement (comportement standard de Supabase) : il ne faut
// PAS appeler boot() une seconde fois ici, sinon tout s'exécute en double
// (abonnements realtime dupliqués sur le même nom de canal, badges recalculés
// deux fois...), ce qui rend le temps réel peu fiable.
onAuthChange(() => boot());

// Enregistrement du service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}
