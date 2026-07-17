// Router à pile : chaque écran (onglet principal ou sous-vue interne comme le
// détail d'une liste) empile une "action de retour" et un point d'historique.
// Le bouton retour matériel (Android) comme les boutons "‹" internes passent
// tous par la même pile, pour un retour toujours logique jusqu'à l'accueil.

const routes = {};
let currentTab = null;
let backActions = [];

// Enregistre un onglet : { mount(container), unmount() }
export function registerTab(name, module) {
  routes[name] = module;
}

// Montage direct d'un onglet, sans toucher à l'historique (usage interne)
async function mountTab(tabName) {
  const container = document.getElementById("tab-content");
  if (!routes[tabName]) {
    console.error(`Onglet inconnu: ${tabName}`);
    return;
  }
  if (currentTab && routes[currentTab]?.unmount) {
    routes[currentTab].unmount();
  }
  container.innerHTML = "";
  currentTab = tabName;
  await routes[tabName].mount(container);
}

// Entrer dans un onglet depuis l'accueil : empile "retour à l'accueil"
export async function enterTab(tabName) {
  backActions.push(() => mountTab("home"));
  history.pushState({ depth: backActions.length }, "");
  await mountTab(tabName);
}

// Retour explicite à l'accueil (bouton 🏠) : réinitialise la pile de retour,
// c'est un raccourci "vers la racine", pas un retour hiérarchique classique.
export async function goHome() {
  backActions = [];
  history.replaceState({ depth: 0 }, "");
  await mountTab("home");
}

// Pour une sous-vue interne à un onglet (détail d'une liste, d'une catégorie,
// d'une recette...) : `restorePrevious` doit redessiner l'écran qu'on quitte,
// il sera appelé automatiquement si l'utilisateur revient en arrière.
export function pushView(restorePrevious) {
  backActions.push(restorePrevious);
  history.pushState({ depth: backActions.length }, "");
}

// Retour en arrière logique (bouton "‹" ou bouton retour matériel du téléphone)
export function goBack() {
  history.back();
}

window.addEventListener("popstate", () => {
  const restore = backActions.pop();
  if (restore) restore();
  // Pile vide : on est à l'accueil, le comportement par défaut du navigateur
  // (quitter l'app / revenir à la page précédente hors app) s'applique.
});

export function initRouter(defaultTab) {
  mountTab(defaultTab);
  history.replaceState({ depth: 0 }, "");
}
