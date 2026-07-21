import {
  getUserPreferences,
  savePreferences,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
} from "../notifications.js";
import { signOut } from "../auth.js";
import { goHome } from "../router.js";
import { getMyProfile, updateDisplayName, getHouseholdProfiles } from "../profiles.js";
import { removeMember } from "../household.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";

let ctxRef = null;
let members = [];

export async function mount(container, ctx) {
  ctxRef = ctx;
  const prefs = await getUserPreferences(ctx.userId);
  const profile = await getMyProfile(ctx.userId);
  members = await getHouseholdProfiles(ctx.householdId);

  container.innerHTML = `
    <div class="tab-preferences">
      <button class="home-btn" id="home-btn-prefs">🏠 Accueil</button>

      <div class="prefs-header">
        <span class="prefs-emoji">⚙️</span>
        <h1>Réglages</h1>
      </div>

      <section class="prefs-section card-lavender">
        <h3>👤 Profil</h3>
        <label class="field-label" for="display-name">Votre nom (visible par le foyer)</label>
        <input id="display-name" value="${escapeHtml(profile?.display_name ?? "")}" />
        <button id="save-name">Enregistrer le nom</button>
        <p class="prefs-status" id="name-status"></p>
      </section>

      <section class="prefs-section card-sky">
        <h3>🔔 Notifications</h3>
        <label class="prefs-checkbox-row">
          <input type="checkbox" id="notif-enabled" ${prefs.notifications_enabled ? "checked" : ""} />
          Activer les notifications
        </label>

        <label class="field-label">Plage silencieuse</label>
        <div class="prefs-quiet-hours">
          <input type="time" id="quiet-start" value="${prefs.quiet_start || ""}" />
          <span>à</span>
          <input type="time" id="quiet-end" value="${prefs.quiet_end || ""}" />
        </div>

        <button id="save-prefs">Enregistrer</button>
        <button id="request-permission" class="secondary">Activer sur cet appareil</button>
        <button id="disable-notif-btn" class="prefs-danger-btn">🔕 Désactiver totalement les notifications</button>
        <p class="prefs-status" id="notif-status"></p>
      </section>

      <section class="prefs-section card-peach">
        <h3>🏡 Foyer</h3>
        <label class="field-label">Code d'invitation</label>
        <p class="prefs-invite-code">${escapeHtml(ctx.household?.invite_code ?? "—")}</p>

        <label class="field-label">Membres du foyer</label>
        <div id="members-list"></div>
      </section>

      <section class="prefs-section card-rose">
        <h3>🔐 Compte</h3>
        <button id="logout-btn" class="secondary">Déconnexion</button>
      </section>

      <p class="prefs-version" id="prefs-version"></p>
    </div>
  `;

  renderMembers();
  renderCacheVersion();

  document.getElementById("home-btn-prefs").addEventListener("click", () => goHome());

  document.getElementById("save-name").addEventListener("click", async () => {
    const name = document.getElementById("display-name").value.trim();
    if (!name) return;
    await updateDisplayName(ctx.userId, name);
    showStatus("name-status", "Nom enregistré ✓");
  });

  document.getElementById("save-prefs").addEventListener("click", async () => {
    await savePreferences(ctx.userId, {
      notifications_enabled: document.getElementById("notif-enabled").checked,
      quiet_start: document.getElementById("quiet-start").value || null,
      quiet_end: document.getElementById("quiet-end").value || null,
    });
    showStatus("notif-status", "Préférences enregistrées ✓");
  });

  document.getElementById("request-permission").addEventListener("click", async () => {
    const result = await requestNotificationPermission();
    if (result !== "granted") {
      showStatus("notif-status", "Notifications refusées ou non supportées.");
      return;
    }
    try {
      await subscribeToPush(ctx.userId);
      showStatus("notif-status", "Notifications activées sur cet appareil ✓");
    } catch (err) {
      showStatus("notif-status", "Erreur lors de l'activation : " + err.message);
    }
  });

  document.getElementById("disable-notif-btn").addEventListener("click", async () => {
    document.getElementById("notif-enabled").checked = false;
    await savePreferences(ctx.userId, {
      notifications_enabled: false,
      quiet_start: document.getElementById("quiet-start").value || null,
      quiet_end: document.getElementById("quiet-end").value || null,
    });
    try {
      await unsubscribeFromPush();
    } catch {
      // Pas grave si aucun abonnement actif sur cet appareil
    }
    showStatus("notif-status", "Notifications désactivées sur ce compte et cet appareil.");
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut();
    location.reload();
  });
}

function showStatus(elId, message) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  setTimeout(() => {
    if (el.textContent === message) el.textContent = "";
  }, 3500);
}

function renderMembers() {
  const el = document.getElementById("members-list");
  if (!el) return;

  if (members.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun membre.</p>`;
    return;
  }

  el.innerHTML = members
    .map(
      (m) => `
    <div class="prefs-member-row" data-id="${m.user_id}">
      <span class="prefs-member-name">${escapeHtml(m.display_name || "Sans nom")}${m.user_id === ctxRef.userId ? " (vous)" : ""}</span>
      ${m.user_id !== ctxRef.userId ? `<button type="button" class="prefs-member-remove" data-action="remove">Retirer</button>` : ""}
    </div>
  `
    )
    .join("");

  el.querySelectorAll('[data-action="remove"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".prefs-member-row").dataset.id;
      handleRemoveMember(id);
    });
  });
}

function handleRemoveMember(userId) {
  const member = members.find((m) => m.user_id === userId);
  if (!member) return;

  members = members.filter((m) => m.user_id !== userId);
  renderMembers();

  showUndoToast({
    message: `${member.display_name || "Ce membre"} retiré du foyer`,
    onUndo: () => {
      members.push(member);
      renderMembers();
    },
    onConfirm: async () => {
      await removeMember(ctxRef.householdId, userId);
    },
  });
}

// Lit le numéro de cache actif directement depuis le Cache Storage du
// navigateur (alimenté par CACHE_VERSION dans sw.js) : aucune duplication de
// constante à tenir à jour entre les deux fichiers.
async function renderCacheVersion() {
  const el = document.getElementById("prefs-version");
  if (!el || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    const match = keys.map((k) => k.match(/^foyer-cache-v(\d+)$/)).find(Boolean);
    el.textContent = match ? `Foyer · cache v${match[1]}` : "Foyer";
  } catch {
    el.textContent = "Foyer";
  }
}

export function unmount() {}
