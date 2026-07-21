import { supabase } from "../supabase-client.js";
import { subscribeToTable, writeOrQueue } from "../sync.js";
import { markTabSeen, getLastSeenMap, computeUnseenIds } from "../badges.js";
import { getLists, createList, deleteList, renameList, getItemsForList, updateListPosition } from "../lists.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";
import { renderTileBoard } from "../utils/tileBoard.js";
import { pushView, goBack, goHome } from "../router.js";

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
let shoppingLastSeenAt = null; // capturé avant markTabSeen, pour les badges "nouveau" par tuile
let unseenListIds = new Set(); // listes contenant un article ajouté par un autre membre, non vu

export async function mount(container, ctx) {
  containerRef = container;
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;
  view = "lists";
  currentList = null;

  // Capturé AVANT markTabSeen : sinon tout serait déjà "vu" dès l'ouverture de l'onglet
  const previousLastSeen = await getLastSeenMap(currentUserId);
  shoppingLastSeenAt = previousLastSeen["shopping"];
  await markTabSeen(currentUserId, "shopping");
  await refreshUnseenListIds();

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

// Repère les listes contenant un article ajouté par un AUTRE membre du foyer,
// non encore vu, pour afficher le badge "N" sur leur tuile
async function refreshUnseenListIds() {
  const { data, error } = await supabase
    .from("shopping_items")
    .select("list_id, added_by, created_at")
    .eq("household_id", currentHouseholdId);
  unseenListIds = error || !data ? new Set() : computeUnseenIds(data, "list_id", "added_by", currentUserId, shoppingLastSeenAt);
}

async function renderListsView() {
  containerRef.innerHTML = `
    <div class="lists-overview">
      <button class="home-btn" id="home-btn-lists">🏠 Accueil</button>
      <form id="new-list-form" class="add-form">
        <input id="new-list-name" placeholder="Nouvelle liste…" required />
        <button type="submit">+</button>
      </form>
      <div id="lists-container" class="tile-board"></div>
    </div>
  `;
  document.getElementById("home-btn-lists").addEventListener("click", () => goHome());
  document.getElementById("new-list-form").addEventListener("submit", handleCreateList);
  await loadLists();
}

function renderLists() {
  const el = document.getElementById("lists-container");
  if (!el) return;

  const visible = lists.filter((l) => !pendingDeleteIds.has(l.id));

  renderTileBoard(el, visible, {
    getId: (l) => l.id,
    getLabel: (l) => l.name,
    emptyMessage: "Aucune liste pour l'instant.",
    isNew: (list) => unseenListIds.has(list.id),
    onOpen: (list) => openList(list),
    onDelete: (list) => handleDeleteList(list.id),
    onReorder: handleReorderLists,
  });
}

async function handleReorderLists(orderedIds) {
  lists = orderedIds
    .map((id, index) => {
      const list = lists.find((l) => l.id === id);
      if (list) list.position = index;
      return list;
    })
    .filter(Boolean);

  await Promise.all(lists.map((l) => updateListPosition(l.id, l.position)));
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

  pushView(() => {
    if (unsubscribeItems) unsubscribeItems();
    unsubscribeItems = null;
    view = "lists";
    renderListsView();
  });

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-lists" class="back-btn">‹ Toutes les listes</button>
      <div class="detail-title-row" id="detail-title-row"></div>
      <form id="add-item-form" class="add-form">
        <input id="item-name" placeholder="Ajouter un article…" required />
        <input id="item-quantity" placeholder="Quantité…" />
        <button type="submit">+</button>
      </form>
      <div id="shopping-list"></div>
    </div>
  `;

  renderDetailTitleRow(list);
  document.getElementById("back-to-lists").addEventListener("click", () => goBack());
  document.getElementById("add-item-form").addEventListener("submit", handleAddItem);

  await loadItems();

  unsubscribeItems = subscribeToTable("shopping_items", currentHouseholdId, async () => {
    if (view === "detail" && currentList?.id === list.id) await loadItems();
  });
}

function renderDetailTitleRow(list) {
  const row = document.getElementById("detail-title-row");
  if (!row) return;
  row.innerHTML = `
    <h2 class="list-detail-title">${escapeHtml(list.name)}</h2>
    <div class="detail-title-actions">
      <button id="rename-list-btn" class="icon-btn" aria-label="Renommer la liste">✎</button>
      <button id="delete-list-detail-btn" class="icon-btn" aria-label="Supprimer la liste">🗑️</button>
    </div>
  `;
  document.getElementById("rename-list-btn").addEventListener("click", () => startRenameList(list));
  document.getElementById("delete-list-detail-btn").addEventListener("click", () => handleDeleteListFromDetail(list));
}

function startRenameList(list) {
  const row = document.getElementById("detail-title-row");
  if (!row) return;
  row.innerHTML = `
    <form class="inline-rename-form">
      <input type="text" value="${escapeHtml(list.name)}" required />
      <button type="submit">OK</button>
    </form>
  `;
  const input = row.querySelector("input");
  input.focus();
  row.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newName = input.value.trim();
    if (!newName) return;
    await renameList(list.id, newName);
    list.name = newName;
    const cached = lists.find((l) => l.id === list.id);
    if (cached) cached.name = newName;
    renderDetailTitleRow(list);
  });
}

function handleDeleteListFromDetail(list) {
  pendingDeleteIds.add(list.id);
  goBack();

  showUndoToast({
    message: `Liste « ${list.name} » supprimée`,
    onUndo: () => {
      pendingDeleteIds.delete(list.id);
      renderLists();
    },
    onConfirm: async () => {
      pendingDeleteIds.delete(list.id);
      await deleteList(list.id);
      await loadLists();
    },
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
