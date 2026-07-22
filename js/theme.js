const STORAGE_KEY = "foyer-theme"; // "light" | "dark" | absent = automatique (système)

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Applique le thème au document. theme: "light" | "dark" | null (null = suit le système)
export function applyTheme(theme) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function setTheme(theme) {
  try {
    if (theme === "dark" || theme === "light") localStorage.setItem(STORAGE_KEY, theme);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage indisponible (navigation privée...) : le thème reste actif pour la session en cours
  }
  applyTheme(theme);
}

// À appeler le plus tôt possible (avant le premier rendu) pour éviter un flash de thème clair
export function initTheme() {
  applyTheme(getStoredTheme());
}
