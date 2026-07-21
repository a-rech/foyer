// ⚠️ Incrémentez ce numéro à CHAQUE modification de fichiers JS/CSS/HTML avant
// de déployer. C'est ce qui force les navigateurs des membres du foyer à
// récupérer la nouvelle version plutôt que de resservir l'ancienne en cache.
const CACHE_VERSION = 30.5;
const CACHE_NAME = `foyer-cache-v${CACHE_VERSION}`;
const APP_SHELL = [
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/supabase-client.js",
  "js/auth.js",
  "js/household.js",
  "js/profiles.js",
  "js/tasks.js",
  "js/meals.js",
  "js/sync.js",
  "js/lists.js",
  "js/categories.js",
  "js/badges.js",
  "js/notifications.js",
  "js/router.js",
  "js/utils/db.js",
  "js/utils/toast.js",
  "js/utils/format.js",
  "js/utils/tileBoard.js",
  "js/tabs/home.js",
  "js/tabs/shopping.js",
  "js/tabs/recipes.js",
  "js/tabs/calendar.js",
  "js/tabs/notes.js",
  "js/tabs/tasks.js",
  "js/tabs/meals.js",
  "js/tabs/preferences.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // On met chaque fichier en cache individuellement : si l'un d'eux
      // est manquant ou 404, ça ne fait pas échouer toute l'installation
      // (contrairement à cache.addAll qui est tout-ou-rien).
      const results = await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
      results.forEach((r, i) => {
        if (r.status === "rejected") console.warn("Précache échoué pour", APP_SHELL[i], r.reason);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie : réseau d'abord (données à jour), cache en secours si hors-ligne
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Réception d'une vraie notification Web Push envoyée par l'Edge Function
self.addEventListener("push", (event) => {
  let data = { title: "Foyer", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    data.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: data.url || "./index.html" },
    })
  );
});

// Clic sur la notification : ouvre l'app, ou remet le focus sur un onglet déjà ouvert
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./index.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
