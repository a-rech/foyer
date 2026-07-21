import { subscribeToTable } from "../sync.js";
import { markTabSeen } from "../badges.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";
import { renderTileBoard } from "../utils/tileBoard.js";
import { pushView, goBack, goHome } from "../router.js";
import {
  getCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  getRecipesForCategory,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  updateCategoryPosition,
  updateRecipePosition,
} from "../categories.js";

let unsubscribeCategories = null;
let unsubscribeRecipes = null;
let categories = [];
let recipes = [];
let view = "categories"; // "categories" | "recipes" | "recipe-detail"
let currentCategory = null;
let currentRecipe = null; // null = création, objet = édition
let currentHouseholdId = null;
let currentUserId = null;
let containerRef = null;
let pendingDeleteCategoryIds = new Set();
let pendingDeleteRecipeIds = new Set();

export async function mount(container, ctx) {
  containerRef = container;
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;
  view = "categories";
  currentCategory = null;
  currentRecipe = null;

  await markTabSeen(currentUserId, "recipes");
  await renderCategoriesView();

  unsubscribeCategories = subscribeToTable("recipe_categories", currentHouseholdId, async () => {
    if (view === "categories") await loadCategories();
  });
}

export function unmount() {
  if (unsubscribeCategories) unsubscribeCategories();
  if (unsubscribeRecipes) unsubscribeRecipes();
  unsubscribeCategories = null;
  unsubscribeRecipes = null;
}

// ==========================================
// VUE 1 : catégories
// ==========================================
async function loadCategories() {
  categories = await getCategories(currentHouseholdId);
  renderCategories();
}

async function renderCategoriesView() {
  containerRef.innerHTML = `
    <div class="lists-overview">
      <button class="home-btn" id="home-btn-recipes">🏠 Accueil</button>
      <form id="new-category-form" class="add-form">
        <input id="new-category-name" placeholder="Nouvelle catégorie…" required />
        <button type="submit">+</button>
      </form>
      <div id="categories-container" class="tile-board"></div>
    </div>
  `;
  document.getElementById("home-btn-recipes").addEventListener("click", () => goHome());
  document.getElementById("new-category-form").addEventListener("submit", handleCreateCategory);
  await loadCategories();
}

function renderCategories() {
  const el = document.getElementById("categories-container");
  if (!el) return;

  const visible = categories.filter((c) => !pendingDeleteCategoryIds.has(c.id));

  renderTileBoard(el, visible, {
    getId: (c) => c.id,
    getLabel: (c) => c.name,
    emptyMessage: "Aucune catégorie pour l'instant.",
    onOpen: (cat) => openCategory(cat),
    onEdit: (cat) => startRenameCategory(cat.id),
    onDelete: (cat) => handleDeleteCategory(cat.id),
    onReorder: handleReorderCategories,
  });
}

async function handleReorderCategories(orderedIds) {
  categories = orderedIds
    .map((id, index) => {
      const cat = categories.find((c) => c.id === id);
      if (cat) cat.position = index;
      return cat;
    })
    .filter(Boolean);

  await Promise.all(categories.map((c) => updateCategoryPosition(c.id, c.position)));
}

async function handleCreateCategory(e) {
  e.preventDefault();
  const input = document.getElementById("new-category-name");
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  await createCategory(currentHouseholdId, name, currentUserId);
  await loadCategories();
}

function startRenameCategory(id) {
  const tile = document.querySelector(`.tile-card[data-id="${id}"]`);
  const category = categories.find((c) => c.id === id);
  if (!tile || !category) return;

  const content = tile.querySelector(".tile-card-content");
  content.outerHTML = `
    <form class="inline-rename-form tile-inline-rename">
      <input type="text" value="${escapeHtml(category.name)}" required />
      <button type="submit">OK</button>
    </form>
  `;
  const form = tile.querySelector("form");
  const input = tile.querySelector("input");
  input.focus();
  form.addEventListener("click", (e) => e.stopPropagation());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const newName = input.value.trim();
    if (!newName) return;
    await renameCategory(id, newName);
    await loadCategories();
  });
}

function handleDeleteCategory(id) {
  const category = categories.find((c) => c.id === id);
  if (!category) return;

  pendingDeleteCategoryIds.add(id);
  renderCategories();

  showUndoToast({
    message: `Catégorie « ${category.name} » supprimée`,
    onUndo: () => {
      pendingDeleteCategoryIds.delete(id);
      renderCategories();
    },
    onConfirm: async () => {
      pendingDeleteCategoryIds.delete(id);
      await deleteCategory(id);
      await loadCategories();
    },
  });
}

// ==========================================
// VUE 2 : recettes d'une catégorie
// ==========================================

// Navigation "avant" depuis la liste des catégories : empile le retour
async function openCategory(category) {
  pushView(() => {
    if (unsubscribeRecipes) unsubscribeRecipes();
    unsubscribeRecipes = null;
    view = "categories";
    renderCategoriesView();
  });
  await renderCategoryScreen(category);
}

// Dessine l'écran des recettes d'une catégorie (réutilisé aussi comme
// restauration lors d'un retour depuis le détail d'une recette)
async function renderCategoryScreen(category) {
  view = "recipes";
  currentCategory = category;
  if (unsubscribeRecipes) unsubscribeRecipes();

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-categories" class="back-btn">‹ Toutes les catégories</button>
      <h2 class="list-detail-title">${category.name}</h2>
      <button id="new-recipe-btn">+ Nouvelle recette</button>
      <div id="recipes-container" class="tile-board"></div>
    </div>
  `;

  document.getElementById("back-to-categories").addEventListener("click", () => goBack());
  document.getElementById("new-recipe-btn").addEventListener("click", () => openRecipeDetail(null));

  await loadRecipes();

  unsubscribeRecipes = subscribeToTable("recipes", currentHouseholdId, async () => {
    if (view === "recipes" && currentCategory?.id === category.id) await loadRecipes();
  });
}

async function loadRecipes() {
  if (!currentCategory) return;
  recipes = await getRecipesForCategory(currentCategory.id);
  renderRecipes();
}

function renderRecipes() {
  const el = document.getElementById("recipes-container");
  if (!el) return;

  const visible = recipes.filter((r) => !pendingDeleteRecipeIds.has(r.id));

  renderTileBoard(el, visible, {
    getId: (r) => r.id,
    getLabel: (r) => r.title,
    emptyMessage: "Aucune recette dans cette catégorie.",
    onOpen: (recipe) => openRecipeDetail(recipe),
    onDelete: (recipe) => handleDeleteRecipe(recipe.id),
    onReorder: handleReorderRecipes,
  });
}

async function handleReorderRecipes(orderedIds) {
  recipes = orderedIds
    .map((id, index) => {
      const recipe = recipes.find((r) => r.id === id);
      if (recipe) recipe.position = index;
      return recipe;
    })
    .filter(Boolean);

  await Promise.all(recipes.map((r) => updateRecipePosition(r.id, r.position)));
}

function handleDeleteRecipe(id) {
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe) return;

  pendingDeleteRecipeIds.add(id);
  renderRecipes();

  showUndoToast({
    message: `Recette « ${recipe.title} » supprimée`,
    onUndo: () => {
      pendingDeleteRecipeIds.delete(id);
      renderRecipes();
    },
    onConfirm: async () => {
      pendingDeleteRecipeIds.delete(id);
      await deleteRecipe(id);
      await loadRecipes();
    },
  });
}

// ==========================================
// VUE 3 : détail / édition d'une recette
// ==========================================
function openRecipeDetail(recipe) {
  view = "recipe-detail";
  currentRecipe = recipe;

  pushView(() => renderCategoryScreen(currentCategory));

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-recipes" class="back-btn">‹ ${currentCategory.name}</button>
      <form id="recipe-form" class="recipe-form">
        <input id="r-title" placeholder="Titre" value="${recipe?.title ?? ""}" required />
        <textarea id="r-ingredients" placeholder="Ingrédients">${recipe?.ingredients ?? ""}</textarea>
        <textarea id="r-instructions" placeholder="Préparation">${recipe?.instructions ?? ""}</textarea>
        <textarea id="r-notes" placeholder="Notes perso (optionnel)">${recipe?.notes ?? ""}</textarea>
        <button type="submit">Enregistrer</button>
      </form>
    </div>
  `;

  document.getElementById("back-to-recipes").addEventListener("click", () => goBack());
  document.getElementById("recipe-form").addEventListener("submit", handleSaveRecipe);
}

async function handleSaveRecipe(e) {
  e.preventDefault();
  const values = {
    title: document.getElementById("r-title").value.trim(),
    ingredients: document.getElementById("r-ingredients").value.trim(),
    instructions: document.getElementById("r-instructions").value.trim(),
    notes: document.getElementById("r-notes").value.trim(),
  };

  if (currentRecipe) {
    await updateRecipe(currentRecipe.id, values);
  } else {
    await createRecipe({
      household_id: currentHouseholdId,
      category_id: currentCategory.id,
      created_by: currentUserId,
      ...values,
    });
  }

  goBack();
}
