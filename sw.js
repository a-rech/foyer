const CACHE_NAME = "foyer-cache-v1";
const APP_SHELL = [
  "/index.html",
  "/manifest.json",
  "/css/style.css",
  "/js/supabase-client.js",
  "/js/auth.js",
  "/js/household.js",
  "/js/sync.js",
  "/js/badges.js",
  "/js/notifications.js",
  "/js/router.js",
  "/js/utils/db.js",
  "/js/tabs/shopping.js",
  "/js/tabs/recipes.js",
  "/js/tabs/calendar.js",
  "/js/tabs/notes.js",
  "/js/tabs/preferences.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
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

// Réception d'une notification Web Push (branchée en V2 via une Edge Function)
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Foyer", body: "" };
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png" }));
});
