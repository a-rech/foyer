const routes = {};
let currentTab = null;

// Enregistre un onglet : { mount(container), unmount() }
export function registerTab(name, module) {
  routes[name] = module;
}

export async function navigateTo(tabName) {
  const container = document.getElementById("tab-content");
  if (!routes[tabName]) {
    console.error(`Onglet inconnu: ${tabName}`);
    return;
  }

  if (currentTab && routes[currentTab]?.unmount) {
    routes[currentTab].unmount();
  }

  container.innerHTML = "";
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tabName);
  });

  currentTab = tabName;
  await routes[tabName].mount(container);
  location.hash = tabName;
}

export function initRouter(defaultTab) {
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", () => navigateTo(el.dataset.tab));
  });

  const initial = location.hash?.replace("#", "") || defaultTab;
  navigateTo(initial);
}
