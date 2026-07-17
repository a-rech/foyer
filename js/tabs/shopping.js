import { supabase } from "../supabase-client.js";
import { subscribeToTable, writeOrQueue } from "../sync.js";
import { markTabSeen } from "../badges.js";
import { getLists, createList, deleteList, getItemsForList } from "../lists.js";
import { showUndoToast } from "../utils/toast.js";
import { navigateTo } from "../router.js";

let unsubscribeLists = null;
let unsubscribeItems = null;
let lists = [];
let items = [];
let view = "lists"; // "lists" | "detail"
let currentList = null;
let currentHouseholdId = null;
let currentUserId = null;
let containerRef = null;
let pendingDeleteIds = new Set(); // listes masquées le temps du toast d'annulation

export async function mount(container, ctx) {
  containerRef = container;
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;
  view = "lists";
  currentList = null;

  await markTabSeen(currentUserId, "shopping");
  await renderListsView();

  unsubscribeLists = subscribeToTable("shopping_lists", currentHouseholdId, async () => {
    if (view === "lists") await loadLists();
  });
}

export function unmount() {
  if (unsubscribeLists) unsubscribeLists();
  if (unsubscribeItems) unsubscribeItems();
  unsubscribeLists = null;
  unsubscribeItems = null;
}

// ==========================================
// VUE 1 : liste des listes
// ==========================================
async function loadLists() {
  lists = await getLists(currentHouseholdId);
  renderLists();
}

async function renderListsView() {
  containerRef.innerHTML = `
    <div class="lists-overview">
      <button class="home-btn" id="home-btn-lists">🏠 Accueil</button>
      <form id="new-list-form" class="add-form">
        <input id="new-list-name" placeholder="Nouvelle liste…" required />
        <button type="submit">+</button>
      </form>
      <div id="lists-container"></div>
    </div>
  `;
  document.getElementById("home-btn-lists").addEventListener("click", () => navigateTo("home"));
  document.getElementById("new-list-form").addEventListener("submit", handleCreateList);
  await loadLists();
}

function renderLists() {
  const el = document.getElementById("lists-container");
  if (!el) return;

  const visible = lists.filter((l) => !pendingDeleteIds.has(l.id));

  if (visible.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucune liste pour l'instant.</p>`;
    return;
  }

  el.innerHTML = visible
    .map(
      (l) => `
    <div class="list-row" data-id="${l.id}">
      <span class="list-row-name" data-action="open">${l.name}</span>
      <button class="list-row-delete" data-action="delete" aria-label="Supprimer la liste">✕</button>
    </div>
  `
    )
    .join("");

  el.querySelectorAll('[data-action="open"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const list = lists.find((l) => l.id === e.target.closest(".list-row").dataset.id);
      openList(list);
    });
  });
  el.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", (e) => handleDeleteList(e.target.closest(".list-row").dataset.id));
  });
}

async function handleCreateList(e) {
  e.preventDefault();
  const input = document.getElementById("new-list-name");
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  await createList(currentHouseholdId, name, currentUserId);
  await loadLists();
}

function handleDeleteList(id) {
  const list = lists.find((l) => l.id === id);
  if (!list) return;

  // Masquage optimiste immédiat + toast d'annulation 2s avant suppression réelle
  pendingDeleteIds.add(id);
  renderLists();

  showUndoToast({
    message: `Liste « ${list.name} » supprimée`,
    onUndo: () => {
      pendingDeleteIds.delete(id);
      renderLists();
    },
    onConfirm: async () => {
      pendingDeleteIds.delete(id);
      await deleteList(id);
      await loadLists();
    },
  });
}

// ==========================================
// VUE 2 : détail d'une liste
// ==========================================
async function openList(list) {
  view = "detail";
  currentList = list;

  if (unsubscribeItems) unsubscribeItems();

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-lists" class="back-btn">‹ Toutes les listes</button>
      <h2 class="list-detail-title">${list.name}</h2>
      <form id="add-item-form" class="add-form">
        <input id="item-name" placeholder="Ajouter un article…" required />
        <input id="item-quantity" placeholder="Quantité…" />
        <button type="submit">+</button>
      </form>
      <div id="shopping-list"></div>
    </div>
  `;

  document.getElementById("back-to-lists").addEventListener("click", async () => {
    view = "lists";
    if (unsubscribeItems) unsubscribeItems();
    await renderListsView();
  });
  document.getElementById("add-item-form").addEventListener("submit", handleAddItem);

  await loadItems();

  unsubscribeItems = subscribeToTable("shopping_items", currentHouseholdId, async () => {
    if (view === "detail" && currentList?.id === list.id) await loadItems();
  });
}

async function loadItems() {
  if (!currentList) return;
  items = await getItemsForList(currentList.id);
  renderItems();
}

function renderItems() {
  const listEl = document.getElementById("shopping-list");
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = `<p class="empty-state">Cette liste est vide.</p>`;
    return;
  }

  listEl.innerHTML = items
    .map(
      (item) => `
    <div class="shopping-item ${item.checked ? "checked" : ""}" data-id="${item.id}">
      <input type="checkbox" ${item.checked ? "checked" : ""} data-action="toggle" />
      <span class="item-name">${item.name}</span>
      ${item.quantity ? `<span class="item-qty">${item.quantity}</span>` : ""}
      <button data-action="delete" aria-label="Supprimer">✕</button>
    </div>
  `
    )
    .join("");

  listEl.querySelectorAll('[data-action="toggle"]').forEach((el) => {
    el.addEventListener("change", (e) =>
      handleToggleItem(e.target.closest(".shopping-item").dataset.id, e.target.checked)
    );
  });
  listEl.querySelectorAll('[data-action="delete"]').forEach((el) => {
    el.addEventListener("click", (e) => handleDeleteItem(e.target.closest(".shopping-item").dataset.id));
  });
}

async function handleAddItem(e) {
  e.preventDefault();
  const nameInput = document.getElementById("item-name");
  const quantityInput = document.getElementById("item-quantity");
  const name = nameInput.value.trim();
  if (!name) return;

  const newItem = {
    household_id: currentHouseholdId,
    list_id: currentList.id,
    name,
    quantity: quantityInput.value.trim() || null,
    checked: false,
    added_by: currentUserId,
  };

  items.push({ ...newItem, id: `temp-${Date.now()}`, created_at: new Date().toISOString() });
  renderItems();
  nameInput.value = "";
  quantityInput.value = "";

  await writeOrQueue("shopping_items", "insert", newItem);
}

async function handleToggleItem(id, checked) {
  const item = items.find((i) => i.id === id);
  if (item) item.checked = checked;
  renderItems();

  await writeOrQueue("shopping_items", "update", { id, values: { checked, updated_at: new Date().toISOString() } });

  if (checked && item) {
    await supabase.from("shopping_history").insert({
      household_id: currentHouseholdId,
      item_name: item.name,
    });
  }
}

async function handleDeleteItem(id) {
  items = items.filter((i) => i.id !== id);
  renderItems();
  await writeOrQueue("shopping_items", "delete", { id });
}
