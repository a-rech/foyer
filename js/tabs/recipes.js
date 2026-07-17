import { supabase } from "../supabase-client.js";
import { subscribeToTable } from "../sync.js";
import { markTabSeen } from "../badges.js";

let unsubscribe = null;
let recipes = [];
let currentHouseholdId = null;
let currentUserId = null;

export async function mount(container, ctx) {
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;

  container.innerHTML = `
    <div class="tab-recipes">
      <button id="new-recipe-btn">+ Nouvelle recette</button>
      <div id="recipe-form-wrap"></div>
      <div id="recipe-list"></div>
    </div>
  `;

  document.getElementById("new-recipe-btn").addEventListener("click", showForm);

  await loadRecipes();
  await markTabSeen(currentUserId, "recipes");

  unsubscribe = subscribeToTable("recipes", currentHouseholdId, loadRecipes);
}

export function unmount() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

async function loadRecipes() {
  const { data, error } = await supabase
    .from("recipes")
    .select("*")
    .eq("household_id", currentHouseholdId)
    .order("created_at", { ascending: false });
  if (error) return console.error(error);
  recipes = data;
  render();
}

function showForm() {
  document.getElementById("recipe-form-wrap").innerHTML = `
    <form id="recipe-form" class="recipe-form">
      <input id="r-title" placeholder="Titre" required />
      <textarea id="r-ingredients" placeholder="Ingrédients"></textarea>
      <textarea id="r-instructions" placeholder="Préparation"></textarea>
      <textarea id="r-notes" placeholder="Notes perso (optionnel)"></textarea>
      <div class="form-actions">
        <button type="submit">Enregistrer</button>
        <button type="button" id="cancel-recipe">Annuler</button>
      </div>
    </form>
  `;
  document.getElementById("recipe-form").addEventListener("submit", handleSave);
  document.getElementById("cancel-recipe").addEventListener("click", () => {
    document.getElementById("recipe-form-wrap").innerHTML = "";
  });
}

async function handleSave(e) {
  e.preventDefault();
  const payload = {
    household_id: currentHouseholdId,
    title: document.getElementById("r-title").value.trim(),
    ingredients: document.getElementById("r-ingredients").value.trim(),
    instructions: document.getElementById("r-instructions").value.trim(),
    notes: document.getElementById("r-notes").value.trim(),
    created_by: currentUserId,
  };
  const { error } = await supabase.from("recipes").insert(payload);
  if (error) return alert("Erreur: " + error.message);
  document.getElementById("recipe-form-wrap").innerHTML = "";
}

function render() {
  const listEl = document.getElementById("recipe-list");
  if (!listEl) return;
  listEl.innerHTML = recipes
    .map(
      (r) => `
    <details class="recipe-card">
      <summary>${r.title}</summary>
      <p><strong>Ingrédients</strong><br>${(r.ingredients || "").replace(/\n/g, "<br>")}</p>
      <p><strong>Préparation</strong><br>${(r.instructions || "").replace(/\n/g, "<br>")}</p>
      ${r.notes ? `<p><strong>Notes</strong><br>${r.notes.replace(/\n/g, "<br>")}</p>` : ""}
    </details>
  `
    )
    .join("");
}
