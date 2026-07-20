import { getUserPreferences, savePreferences, requestNotificationPermission, subscribeToPush } from "../notifications.js";
import { signOut } from "../auth.js";
import { goHome } from "../router.js";
import { getMyProfile, updateDisplayName } from "../profiles.js";

export async function mount(container, ctx) {
  const prefs = await getUserPreferences(ctx.userId);
  const profile = await getMyProfile(ctx.userId);

  container.innerHTML = `
    <div class="tab-preferences">
      <button class="home-btn" id="home-btn-prefs">🏠 Accueil</button>

      <h3>Profil</h3>
      <label class="field-label" for="display-name">Votre nom (visible par le foyer)</label>
      <input id="display-name" value="${profile?.display_name ?? ""}" />
      <button id="save-name">Enregistrer le nom</button>

      <h3>Notifications</h3>
      <label>
        <input type="checkbox" id="notif-enabled" ${prefs.notifications_enabled ? "checked" : ""} />
        Activer les notifications
      </label>
      <label>Plage silencieuse
        <input type="time" id="quiet-start" value="${prefs.quiet_start || ""}" />
        à
        <input type="time" id="quiet-end" value="${prefs.quiet_end || ""}" />
      </label>
      <button id="save-prefs">Enregistrer</button>
      <button id="request-permission">Activer les notifications sur cet appareil</button>

      <h3>Foyer</h3>
      <p>Code d'invitation : <strong>${ctx.household?.invite_code ?? "—"}</strong></p>

      <h3>Compte</h3>
      <button id="logout-btn">Déconnexion</button>
    </div>
  `;

  document.getElementById("home-btn-prefs").addEventListener("click", () => goHome());

  document.getElementById("save-name").addEventListener("click", async () => {
    const name = document.getElementById("display-name").value.trim();
    if (!name) return;
    await updateDisplayName(ctx.userId, name);
    alert("Nom enregistré.");
  });

  document.getElementById("save-prefs").addEventListener("click", async () => {
    await savePreferences(ctx.userId, {
      notifications_enabled: document.getElementById("notif-enabled").checked,
      quiet_start: document.getElementById("quiet-start").value || null,
      quiet_end: document.getElementById("quiet-end").value || null,
    });
    alert("Préférences enregistrées.");
  });

  document.getElementById("request-permission").addEventListener("click", async () => {
    const result = await requestNotificationPermission();
    if (result !== "granted") {
      alert("Notifications refusées ou non supportées.");
      return;
    }
    try {
      await subscribeToPush(ctx.userId);
      alert("Notifications activées sur cet appareil.");
    } catch (err) {
      alert("Erreur lors de l'activation : " + err.message);
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut();
    location.reload();
  });
}

export function unmount() {}
