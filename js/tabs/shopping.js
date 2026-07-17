import { supabase } from "../supabase-client.js";
import { subscribeToTable, writeOrQueue } from "../sync.js";
import { markTabSeen } from "../badges.js";

let unsubscribe = null;
let items = [];
let currentHouseholdId = null;
let currentUserId = null;

const CATEGORIES = ["Fruits & légumes", "Épicerie", "Frais", "Surgelés", "Hygiène", "Autre"];

export async function mount(container, ctx) {
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;

  container.innerHTML = `
    <div class="tab-shopping">
      <form id="add-item-form" class="add-form">
        <input id="item-name" placeholder="Ajouter un article…" required />
        <select id="item-category">
          ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
        </select>
        <button type="submit">+</button>
      </form>
      <div id="shopping-list"></div>
    </div>
  `;

  document.getElementById("add-item-form").addEventListener("submit", handleAdd);

  await loadItems();
  await markTabSeen(currentUserId, "shopping");

  unsubscribe = subscribeToTable("shopping_items", currentHouseholdId, async () => {
    // Simplicité MVP : on recharge la liste complète à chaque event.
    // Optimisation possible en V2 : merge du payload directement dans `items`.
    await loadItems();
  });
}

export function unmount() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

async function loadItems() {
  const { data, error } = await supabase
    .from("shopping_items")
    .select("*")
    .eq("household_id", currentHouseholdId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  items = data;
  render();
}

function render() {
  const listEl = document.getElementById("shopping-list");
  if (!listEl) return;

  const byCategory = {};
  for (const item of items) {
    byCategory[item.category] ??= [];
    byCategory[item.category].push(item);
  }

  listEl.innerHTML = Object.entries(byCategory)
    .map(
      ([category, catItems]) => `
      <div class="category-group">
        <h3>${category}</h3>
        ${catItems
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
          .join("")}
      </div>
    `
    )
    .join("");

  listEl.querySelectorAll('[data-action="toggle"]').forEach((el) => {
    el.addEventListener("change", (e) => handleToggle(e.target.closest(".shopping-item").dataset.id, e.target.checked));
  });
  listEl.querySelectorAll('[data-action="delete"]').forEach((el) => {
    el.addEventListener("click", (e) => handleDelete(e.target.closest(".shopping-item").dataset.id));
  });
}

async function handleAdd(e) {
  e.preventDefault();
  const nameInput = document.getElementById("item-name");
  const categorySelect = document.getElementById("item-category");
  const name = nameInput.value.trim();
  if (!name) return;

  const newItem = {
    household_id: currentHouseholdId,
    name,
    category: categorySelect.value,
    checked: false,
    added_by: currentUserId,
  };

  // Optimiste : on affiche tout de suite
  items.push({ ...newItem, id: `temp-${Date.now()}`, created_at: new Date().toISOString() });
  render();
  nameInput.value = "";

  await writeOrQueue("shopping_items", "insert", newItem);
}

async function handleToggle(id, checked) {
  const item = items.find((i) => i.id === id);
  if (item) item.checked = checked;
  render();

  await writeOrQueue("shopping_items", "update", { id, values: { checked, updated_at: new Date().toISOString() } });

  // Si coché : on archive dans l'historique (utile pour "souvent ajouté" en V2)
  if (checked && item) {
    await supabase.from("shopping_history").insert({
      household_id: currentHouseholdId,
      item_name: item.name,
    });
  }
}

async function handleDelete(id) {
  items = items.filter((i) => i.id !== id);
  render();
  await writeOrQueue("shopping_items", "delete", { id });
}
