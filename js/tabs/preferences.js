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
import { removeMember, renameHousehold } from "../household.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";
import { getStoredTheme, setTheme } from "../theme.js";

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
        <button id="save-name" class="btn-primary">Enregistrer le nom</button>
        <p class="prefs-status" id="name-status"></p>
      </section>

      <section class="prefs-section card-yellow">
        <h3>🎨 Apparence</h3>
        <label class="field-label">Thème</label>
        <div class="prefs-theme-toggle" id="theme-toggle">
          <button type="button" data-theme-choice="light">☀️ Clair</button>
          <button type="button" data-theme-choice="dark">🌙 Sombre</button>
          <button type="button" data-theme-choice="auto">🖥️ Auto</button>
        </div>
      </section>

      <section class="prefs-section card-sky">
        <h3>🔔 Notifications</h3>
        <div id="notif-status-block"></div>

        <label class="field-label">Plage silencieuse (optionnel)</label>
        <div class="prefs-quiet-hours">
          <input type="time" id="quiet-start" value="${prefs.quiet_start || ""}" />
          <span>à</span>
          <input type="time" id="quiet-end" value="${prefs.quiet_end || ""}" />
        </div>
        <button id="save-quiet-hours" class="btn-secondary">Enregistrer la plage silencieuse</button>
        <p class="prefs-status" id="notif-status"></p>
      </section>

      <section class="prefs-section card-peach">
        <h3>🏡 Foyer</h3>
        <label class="field-label" for="household-name">Nom du foyer</label>
        <input id="household-name" value="${escapeHtml(ctx.household?.name ?? "")}" />
        <button id="save-household-name" class="btn-primary">Renommer le foyer</button>
        <p class="prefs-status" id="household-status"></p>

        <label class="field-label">Code d'invitation</label>
        <p class="prefs-invite-code">${escapeHtml(ctx.household?.invite_code ?? "—")}</p>

        <label class="field-label">Membres du foyer</label>
        <div id="members-list"></div>
      </section>

      <section class="prefs-section card-rose">
        <h3>🔐 Compte</h3>
        <button id="prefs-check-update" class="btn-secondary">🔄 Vérifier les mises à jour</button>
        <p class="prefs-status" id="update-status"></p>
        <button id="prefs-logout" class="btn-danger">Déconnexion</button>
      </section>

      <p class="prefs-version" id="prefs-version">Foyer</p>
    </div>
  `;

  renderMembers();
  renderCacheVersion();
  renderThemeToggle();
  renderNotifStatusBlock(prefs);

  document.getElementById("home-btn-prefs").addEventListener("click", () => goHome());

  document.getElementById("save-name").addEventListener("click", async () => {
    const name = document.getElementById("display-name").value.trim();
    if (!name) return;
    await updateDisplayName(ctx.userId, name);
    showStatus("name-status", "Nom enregistré ✓");
  });

  document.getElementById("save-quiet-hours").addEventListener("click", async () => {
    await savePreferences(ctx.userId, {
      notifications_enabled: prefs.notifications_enabled,
      quiet_start: document.getElementById("quiet-start").value || null,
      quiet_end: document.getElementById("quiet-end").value || null,
    });
    showStatus("notif-status", "Plage silencieuse enregistrée ✓");
  });

  document.getElementById("save-household-name").addEventListener("click", async () => {
    const name = document.getElementById("household-name").value.trim();
    if (!name) return;
    await renameHousehold(ctx.householdId, name);
    if (ctx.household) ctx.household.name = name; // reflète le changement partout (accueil...) sans recharger
    showStatus("household-status", "Foyer renommé ✓");
  });

  document.getElementById("prefs-check-update").addEventListener("click", handleCheckForUpdate);

  document.getElementById("prefs-logout").addEventListener("click", async () => {
    await signOut();
    location.reload();
  });
}

async function handleCheckForUpdate() {
  showStatus("update-status", "Recherche d'une mise à jour...");
  try {
    if (!("serviceWorker" in navigator)) throw new Error("non supporté sur ce navigateur");
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) throw new Error("service worker non disponible");

    const versionBefore = await getServiceWorkerVersion().catch(() => null);
    await reg.update();
    // sw.js appelle skipWaiting() : une éventuelle nouvelle version s'active
    // très vite plutôt que de rester "en attente" — on laisse un court
    // instant pour ça avant de revérifier.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const versionAfter = await getServiceWorkerVersion().catch(() => null);

    if (versionAfter && versionBefore && versionAfter !== versionBefore) {
      showStatus("update-status", `Nouvelle version trouvée (v${versionAfter}) — rechargement...`);
      setTimeout(() => location.reload(), 600);
    } else {
      showStatus("update-status", "Vous êtes déjà à jour ✓");
    }
  } catch (err) {
    showStatus("update-status", "Erreur : " + err.message);
  }
}

function renderThemeToggle() {
  const wrap = document.getElementById("theme-toggle");
  if (!wrap) return;

  const current = getStoredTheme() || "auto";
  wrap.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.themeChoice === current);
    btn.addEventListener("click", () => {
      const choice = btn.dataset.themeChoice;
      setTheme(choice === "auto" ? null : choice);
      wrap.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b === btn));
    });
  });
}

// Un seul bloc qui reflète l'état réel (préférence en base ET abonnement
// navigateur), avec une seule action qui fait tout d'un coup : demande de
// permission + abonnement push + enregistrement de la préférence. Avant, il
// fallait cocher une case ET cliquer "Activer sur cet appareil" ET penser à
// "Enregistrer" séparément — source d'oublis.
async function renderNotifStatusBlock(prefs) {
  const el = document.getElementById("notif-status-block");
  if (!el) return;

  const hasDeviceSubscription = await getHasActiveSubscription();
  const isActive = !!prefs.notifications_enabled && hasDeviceSubscription;

  if (isActive) {
    el.innerHTML = `
      <p class="prefs-notif-active">✅ Notifications activées sur cet appareil</p>
      <button id="prefs-disable-notif" class="btn-danger">🔕 Désactiver les notifications</button>
    `;
    document.getElementById("prefs-disable-notif").addEventListener("click", async () => {
      try {
        await unsubscribeFromPush();
      } catch {
        // Pas grave si aucun abonnement actif sur cet appareil
      }
      await savePreferences(ctxRef.userId, {
        notifications_enabled: false,
        quiet_start: document.getElementById("quiet-start").value || null,
        quiet_end: document.getElementById("quiet-end").value || null,
      });
      prefs.notifications_enabled = false;
      showStatus("notif-status", "Notifications désactivées sur ce compte et cet appareil.");
      renderNotifStatusBlock(prefs);
    });
  } else {
    el.innerHTML = `<button id="prefs-enable-notif" class="btn-primary">🔔 Activer les notifications</button>`;
    document.getElementById("prefs-enable-notif").addEventListener("click", async () => {
      showStatus("notif-status", "Activation en cours...");
      const result = await requestNotificationPermission();
      if (result !== "granted") {
        showStatus("notif-status", "Permission refusée dans le navigateur.");
        return;
      }
      try {
        await subscribeToPush(ctxRef.userId);
        await savePreferences(ctxRef.userId, {
          notifications_enabled: true,
          quiet_start: document.getElementById("quiet-start").value || null,
          quiet_end: document.getElementById("quiet-end").value || null,
        });
        prefs.notifications_enabled = true;
        showStatus("notif-status", "Notifications activées ✓");
        renderNotifStatusBlock(prefs);
      } catch (err) {
        showStatus("notif-status", "Erreur lors de l'activation : " + err.message);
      }
    });
  }
}

async function getHasActiveSubscription() {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
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

  const ownerId = ctxRef.household?.owner_id;
  const isOwner = ownerId && ownerId === ctxRef.userId;

  if (members.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun membre.</p>`;
    return;
  }

  el.innerHTML = members
    .map((m) => {
      const isMe = m.user_id === ctxRef.userId;
      const isMemberOwner = ownerId && m.user_id === ownerId;
      const canRemove = isOwner && !isMe;
      return `
    <div class="prefs-member-row" data-id="${m.user_id}">
      <span class="prefs-member-name">
        ${isMemberOwner ? "👑 " : ""}${escapeHtml(m.display_name || "Sans nom")}${isMe ? " (vous)" : ""}
      </span>
      ${canRemove ? `<button type="button" class="prefs-member-remove" data-action="remove">Retirer</button>` : ""}
    </div>
  `;
    })
    .join("");

  if (!isOwner) {
    el.insertAdjacentHTML(
      "beforeend",
      `<p class="prefs-hint">👑 Seul le propriétaire du foyer peut retirer un membre.</p>`
    );
  }

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

// Lit la version directement depuis le service worker actif via un message
// (plus fiable qu'une déduction depuis le nom du cache, qui peut être absent
// ou en transition juste après un déploiement).
async function renderCacheVersion() {
  const el = document.getElementById("prefs-version");
  if (!el) return;
  try {
    const version = await getServiceWorkerVersion();
    el.textContent = version ? `Foyer · version ${version}` : "Foyer";
  } catch {
    el.textContent = "Foyer";
  }
}

function getServiceWorkerVersion() {
  return new Promise((resolve, reject) => {
    if (!("serviceWorker" in navigator)) {
      reject(new Error("non supporté"));
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => {
        const worker = reg.active;
        if (!worker) {
          reject(new Error("pas de worker actif"));
          return;
        }
        const channel = new MessageChannel();
        const timeout = setTimeout(() => reject(new Error("timeout")), 2000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          resolve(event.data?.version);
        };
        worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      })
      .catch(reject);
  });
}

export function unmount() {}
