import { markTabSeen } from "../badges.js";
import { subscribeToTable } from "../sync.js";
import { goHome, pushView, goBack } from "../router.js";
import { escapeHtml } from "../utils/format.js";
import {
  MEAL_SLOTS,
  getWeekEntries,
  setMealEntry,
  clearMealEntry,
  getAllRecipesFlat,
  generateShoppingListFromWeek,
} from "../meals.js";

const WEEKDAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

let unsubscribe = null;
let entries = new Map(); // clé "yyyy-mm-dd_slot" -> entry
let recipesFlat = [];
let currentWeekStart = null;
let view = "week"; // "week" | "picker"
let pickerContext = null; // { date, slot }
let containerRef = null;
let currentHouseholdId = null;
let currentUserId = null;

export async function mount(container, ctx) {
  containerRef = container;
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;
  view = "week";
  currentWeekStart = getMonday(new Date());

  await markTabSeen(currentUserId, "meals");
  await renderWeekView();

  unsubscribe = subscribeToTable("meal_plan_entries", currentHouseholdId, async () => {
    if (view === "week") await loadWeek();
  });
}

export function unmount() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

// ==========================================
// Helpers dates
// ==========================================
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function toDateInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function entryKey(dateStr, slot) {
  return `${dateStr}_${slot}`;
}

// ==========================================
// VUE 1 : semaine
// ==========================================
async function renderWeekView() {
  containerRef.innerHTML = `
    <div class="tab-meals">
      <button class="home-btn" id="home-btn-meals">🏠 Accueil</button>
      <div class="week-nav">
        <button id="prev-week-btn" class="secondary">‹ Semaine préc.</button>
        <span id="week-range-label" class="week-range-label"></span>
        <button id="next-week-btn" class="secondary">Semaine suiv. ›</button>
      </div>
      <div id="meals-grid" class="meals-grid"></div>
      <button id="generate-list-btn">🛒 Générer la liste de courses</button>
    </div>
  `;

  document.getElementById("home-btn-meals").addEventListener("click", () => goHome());
  document.getElementById("prev-week-btn").addEventListener("click", () => changeWeek(-7));
  document.getElementById("next-week-btn").addEventListener("click", () => changeWeek(7));
  document.getElementById("generate-list-btn").addEventListener("click", handleGenerateList);

  await loadWeek();
}

async function changeWeek(deltaDays) {
  currentWeekStart = addDays(currentWeekStart, deltaDays);
  await loadWeek();
}

async function loadWeek() {
  const weekStartStr = toDateInputValue(currentWeekStart);
  const weekEndStr = toDateInputValue(addDays(currentWeekStart, 7));

  const data = await getWeekEntries(currentHouseholdId, weekStartStr, weekEndStr);
  entries = new Map(data.map((e) => [entryKey(e.meal_date, e.meal_slot), e]));

  renderWeekLabel();
  renderMealsGrid();
}

function renderWeekLabel() {
  const label = document.getElementById("week-range-label");
  if (!label) return;
  const end = addDays(currentWeekStart, 6);
  const fmt = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  label.textContent = `${fmt(currentWeekStart)} – ${fmt(end)}`;
}

function renderMealsGrid() {
  const grid = document.getElementById("meals-grid");
  if (!grid) return;

  let html = "";
  for (let i = 0; i < 7; i++) {
    const day = addDays(currentWeekStart, i);
    const dateStr = toDateInputValue(day);
    html += `
      <div class="meal-day-row">
        <div class="meal-day-label">${WEEKDAY_LABELS[i]} <span>${day.getDate()}</span></div>
        <div class="meal-slots">
          ${MEAL_SLOTS.map((slot) => slotButtonHtml(dateStr, slot)).join("")}
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;

  grid.querySelectorAll("[data-date][data-slot]").forEach((el) => {
    el.addEventListener("click", () => openPicker(el.dataset.date, el.dataset.slot));
  });
}

function slotButtonHtml(dateStr, slot) {
  const entry = entries.get(entryKey(dateStr, slot));
  const title = entry ? entry.recipes?.title ?? entry.custom_title : null;
  return `
    <button class="meal-slot ${entry ? "is-filled" : ""}" data-date="${dateStr}" data-slot="${slot.key}">
      <span class="meal-slot-label">${slot.label}</span>
      <span class="meal-slot-content">${title ? escapeHtml(title) : "+ Ajouter"}</span>
    </button>
  `;
}

async function handleGenerateList() {
  const weekEntries = [...entries.values()];
  if (weekEntries.every((e) => !e.recipe_id)) {
    alert("Aucune recette planifiée cette semaine — rien à ajouter à une liste.");
    return;
  }
  const weekLabel = `semaine du ${currentWeekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
  const { itemCount } = await generateShoppingListFromWeek(currentHouseholdId, currentUserId, weekLabel, weekEntries);
  alert(`Liste créée avec ${itemCount} article${itemCount > 1 ? "s" : ""}. Retrouvez-la dans l'onglet Listes.`);
}

// ==========================================
// VUE 2 : choisir un repas pour un créneau
// ==========================================
async function openPicker(dateStr, slotKey) {
  view = "picker";
  pickerContext = { dateStr, slotKey };

  pushView(() => {
    view = "week";
    renderWeekView();
  });

  if (recipesFlat.length === 0) {
    recipesFlat = await getAllRecipesFlat(currentHouseholdId);
  }

  const slot = MEAL_SLOTS.find((s) => s.key === slotKey);
  const day = new Date(dateStr);
  const existing = entries.get(entryKey(dateStr, slotKey));
  const dayLabel = day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-week" class="back-btn">‹ Semaine</button>
      <h2 class="list-detail-title">${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} — ${slot.label}</h2>

      <form id="custom-meal-form" class="add-form">
        <input id="custom-meal-title" placeholder="Repas libre (ex : resto, restes…)" value="${
          existing && !existing.recipe_id ? escapeHtml(existing.custom_title ?? "") : ""
        }" />
        <button type="submit">OK</button>
      </form>

      <p class="field-hint">Ou choisissez une recette :</p>
      <input id="recipe-search" placeholder="Rechercher une recette…" />
      <div id="recipe-picker-list" class="lists-overview"></div>

      ${existing ? `<button type="button" id="clear-slot-btn" class="danger-btn">Retirer ce repas</button>` : ""}
    </div>
  `;

  document.getElementById("back-to-week").addEventListener("click", () => goBack());
  document.getElementById("custom-meal-form").addEventListener("submit", handleSetCustom);
  document.getElementById("recipe-search").addEventListener("input", (e) => renderRecipePicker(e.target.value));
  document.getElementById("clear-slot-btn")?.addEventListener("click", () => handleClearSlot(existing));

  renderRecipePicker("");
}

function renderRecipePicker(filter) {
  const el = document.getElementById("recipe-picker-list");
  if (!el) return;
  const q = filter.trim().toLowerCase();
  const filtered = q ? recipesFlat.filter((r) => r.title.toLowerCase().includes(q)) : recipesFlat;

  if (filtered.length === 0) {
    el.innerHTML = `<p class="empty-state">${recipesFlat.length === 0 ? "Aucune recette enregistrée pour l'instant." : "Aucun résultat."}</p>`;
    return;
  }

  el.innerHTML = filtered
    .map((r) => `<div class="list-row" data-id="${r.id}"><span class="list-row-name" data-action="pick">${escapeHtml(r.title)}</span></div>`)
    .join("");

  el.querySelectorAll('[data-action="pick"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const recipeId = e.target.closest(".list-row").dataset.id;
      handleSetRecipe(recipeId);
    });
  });
}

async function handleSetCustom(e) {
  e.preventDefault();
  const title = document.getElementById("custom-meal-title").value.trim();
  if (!title) return;
  await setMealEntry({
    householdId: currentHouseholdId,
    mealDate: pickerContext.dateStr,
    mealSlot: pickerContext.slotKey,
    recipeId: null,
    customTitle: title,
    userId: currentUserId,
  });
  goBack();
}

async function handleSetRecipe(recipeId) {
  await setMealEntry({
    householdId: currentHouseholdId,
    mealDate: pickerContext.dateStr,
    mealSlot: pickerContext.slotKey,
    recipeId,
    customTitle: null,
    userId: currentUserId,
  });
  goBack();
}

async function handleClearSlot(existing) {
  if (!existing) return;
  await clearMealEntry(existing.id);
  goBack();
}
