// Router à pile : chaque écran (onglet principal ou sous-vue interne comme le
// détail d'une liste) empile une "action de retour" et un point d'historique.
// Le bouton retour matériel (Android) comme les boutons "‹" internes passent
// tous par la même pile, pour un retour toujours logique jusqu'à l'accueil.

const routes = {};
let currentTab = null;
let backActions = [];

// Sur mobile, changer d'appli puis revenir peut faire recharger complètement
// la page (le système décharge l'onglet en arrière-plan) — sans ça, on
// atterrissait toujours sur l'accueil. sessionStorage survit à ce rechargement
// forcé (mais pas à une fermeture réelle de l'onglet), ce qui correspond
// exactement au cas qu'on veut couvrir.
const LAST_TAB_KEY = "foyer-last-tab";

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
  try {
    sessionStorage.setItem(LAST_TAB_KEY, tabName);
  } catch {
    // stockage indisponible (navigation privée...) : tant pis, pas de restauration
  }
  await routes[tabName].mount(container);
}

// À appeler à la déconnexion : évite qu'un rechargement après ré-authentification
// (potentiellement avec un autre compte, sur le même onglet de navigateur)
// ne restaure l'onglet d'une session précédente.
export function clearLastTab() {
  try {
    sessionStorage.removeItem(LAST_TAB_KEY);
  } catch {
    // ignore
  }
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

let suppressNextPopstate = 0;

// Retour en arrière logique (bouton "‹" ou bouton retour matériel du téléphone)
export function goBack() {
  history.back();
}

// Saute directement `count` niveaux en arrière sans redessiner les écrans
// intermédiaires (utile après une action comme "Enregistrer" ou "Supprimer"
// qui doit ramener directement à un écran plus haut dans la pile). L'appelant
// est responsable d'afficher lui-même l'écran final.
export function popViews(count) {
  for (let i = 0; i < count && backActions.length > 0; i++) {
    backActions.pop();
  }
  if (count > 0) {
    suppressNextPopstate = 1;
    history.go(-count);
  }
}

window.addEventListener("popstate", () => {
  if (suppressNextPopstate > 0) {
    suppressNextPopstate--;
    return;
  }
  const restore = backActions.pop();
  if (restore) restore();
  // Pile vide : on est à l'accueil, le comportement par défaut du navigateur
  // (quitter l'app / revenir à la page précédente hors app) s'applique.
});

export function initRouter(defaultTab) {
  let startTab = defaultTab;
  try {
    const saved = sessionStorage.getItem(LAST_TAB_KEY);
    if (saved && routes[saved]) startTab = saved;
  } catch {
    // stockage indisponible : on démarre simplement sur l'onglet par défaut
  }
  mountTab(startTab);
  history.replaceState({ depth: 0 }, "");
}
