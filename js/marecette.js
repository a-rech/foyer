// Connexion avec l'appli MaRecette (https://a-rech.github.io/marecette/).
//
// Deux usages :
//  1. Réception d'une recette envoyée depuis MaRecette (bouton « Envoyer vers
//     Foyer ») : le lien Foyer contient la recette encodée dans le fragment
//     « #mr=<données> » (même encodage que les liens de partage MaRecette).
//  2. Catalogue MaRecette consultable depuis le sélecteur de repas : la
//     recette choisie est copiée dans les recettes du foyer.
//
// Dans les deux cas, la recette est copiée dans la catégorie « MaRecette » du
// foyer (créée au besoin) : le planning et la liste de courses fonctionnent
// ensuite exactement comme avec n'importe quelle recette Foyer.

import { getCategories, createCategory, createRecipe } from "./categories.js";
import { supabase } from "./supabase-client.js";
import { showInfoToast } from "./utils/toast.js";
import { escapeHtml } from "./utils/format.js";

export const MARECETTE_CATEGORY_NAME = "MaRecette";
const CATALOGUE_URL = "https://a-rech.github.io/marecette/index.html";
const HASH_PREFIX = "#mr=";
const PENDING_KEY = "foyer-pending-mr-import";

// ==========================================
// Décodage / conversion
// ==========================================
function b64urlDecode(b64) {
  let t = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Données de partage MaRecette (clés courtes) -> recette « complète »
function decodeSharePayload(b64) {
  const d = JSON.parse(b64urlDecode(b64));
  if (!d || typeof d.t !== "string" || !d.t.trim() || !Array.isArray(d.i) || !Array.isArray(d.s)) {
    throw new Error("recette invalide");
  }
  return {
    title: d.t.trim(),
    emoji: d.e || "",
    cat: d.c || "",
    origin: d.o || "",
    diff: d.d || "",
    prep: Number(d.p) || 0,
    cook: Number(d.k) || 0,
    portions: Number(d.n) || 1,
    price: Number(d.pr) || 0,
    vegetarian: !!d.vg,
    creator: d.cr || "",
    ingredients: d.i,
    steps: d.s,
  };
}

// Même mise en forme que le « Texte à partager » de MaRecette : « Nom - 200 g »
function ingredientsToText(ingredients) {
  return (ingredients || [])
    .map((ing) => {
      const [name, qty, unit] = Array.isArray(ing) ? ing : [String(ing)];
      const amount = qty ? ` - ${qty}${unit ? " " + unit : ""}` : unit ? ` - ${unit}` : "";
      return `${name ?? ""}${amount}`.trim();
    })
    .filter(Boolean)
    .join("\n");
}

function recipeToFoyerValues(r) {
  const total = (r.prep || 0) + (r.cook || 0);
  const euro = ["", "€", "€€", "€€€"][r.price] || "";
  let meta = `⏱️ ${total} min (prép. ${r.prep || 0} · cuisson ${r.cook || 0}) | 👥 ${r.portions || 1} portion(s)`;
  if (euro) meta += ` | ${euro}`;
  if (r.vegetarian) meta += " | 🥗 Végé";

  const notes = [
    "📖 Importée de MaRecette",
    [r.cat, r.origin, r.diff].filter(Boolean).join(" | "),
    meta,
    r.creator ? `✨ Création de ${r.creator}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: r.title,
    ingredients: ingredientsToText(r.ingredients),
    instructions: (r.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n"),
    notes,
    link: "",
  };
}

// ==========================================
// Copie dans Foyer (catégorie « MaRecette », sans doublon)
// ==========================================
const categoryLocks = new Map(); // évite de créer la catégorie deux fois si deux imports se chevauchent

async function ensureCategory(householdId, userId) {
  if (categoryLocks.has(householdId)) return categoryLocks.get(householdId);
  const promise = (async () => {
    const categories = await getCategories(householdId);
    const existing = categories.find((c) => (c.name || "").trim().toLowerCase() === MARECETTE_CATEGORY_NAME.toLowerCase());
    return existing ?? (await createCategory(householdId, MARECETTE_CATEGORY_NAME, userId));
  })();
  categoryLocks.set(householdId, promise);
  try {
    return await promise;
  } finally {
    categoryLocks.delete(householdId);
  }
}

// Retourne { recipeId, created } ; created = false si la recette existait déjà
export async function importRecipeToFoyer({ householdId, userId }, recipe) {
  const values = recipeToFoyerValues(recipe);
  const category = await ensureCategory(householdId, userId);

  const { data: existing, error } = await supabase
    .from("recipes")
    .select("id")
    .eq("household_id", householdId)
    .eq("category_id", category.id)
    .eq("title", values.title)
    .limit(1);
  if (error) throw error;
  if (existing && existing.length > 0) return { recipeId: existing[0].id, created: false };

  const created = await createRecipe({
    household_id: householdId,
    category_id: category.id,
    created_by: userId,
    ...values,
  });
  return { recipeId: created.id, created: true };
}

// ==========================================
// Réception d'un envoi depuis MaRecette
// ==========================================
let pendingMemory = null; // secours si localStorage est indisponible
let importCtx = null;

// À appeler le plus tôt possible : met l'envoi de côté et nettoie l'URL.
// L'import n'a lieu qu'une fois l'utilisateur connecté et son foyer chargé.
export function captureIncomingImport() {
  const h = location.hash || "";
  if (!h.startsWith(HASH_PREFIX)) return false;
  const payload = h.slice(HASH_PREFIX.length);
  pendingMemory = payload;
  try {
    localStorage.setItem(PENDING_KEY, payload);
  } catch {
    // ignore : on garde la copie en mémoire
  }
  try {
    history.replaceState(history.state, "", location.pathname + location.search);
  } catch {
    // ignore
  }
  return true;
}

// Appli déjà ouverte quand un nouveau lien d'envoi arrive
window.addEventListener("hashchange", () => {
  if (captureIncomingImport() && importCtx) processPendingImport(importCtx);
});

// À appeler une fois l'appli affichée (utilisateur + foyer connus)
export async function processPendingImport(ctx) {
  importCtx = ctx;
  let payload = pendingMemory;
  try {
    payload = payload || localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
  pendingMemory = null;
  if (!payload) return;

  let recipe;
  try {
    recipe = decodeSharePayload(payload);
  } catch (err) {
    console.error("[MaRecette] Lien d'envoi invalide:", err);
    showInfoToast("❌ Recette MaRecette illisible (lien incomplet ou invalide)", 4000);
    return;
  }

  try {
    const { created } = await importRecipeToFoyer(ctx, recipe);
    const name = escapeHtml(recipe.title);
    showInfoToast(
      created
        ? `✅ « ${name} » ajoutée aux recettes (catégorie ${MARECETTE_CATEGORY_NAME})`
        : `ℹ️ « ${name} » est déjà dans vos recettes (catégorie ${MARECETTE_CATEGORY_NAME})`,
      4500
    );
  } catch (err) {
    console.error("[MaRecette] Erreur lors de l'import:", err);
    showInfoToast(`❌ Import impossible : ${escapeHtml(err.message || "erreur inconnue")}`, 4500);
  }
}

// ==========================================
// Catalogue MaRecette (lecture seule)
// ==========================================
let cataloguePromise = null;

// Le catalogue est un tableau JS (« const RECIPES = [...] ») dans l'index.html
// de MaRecette : on le télécharge (même domaine github.io) et on en extrait le tableau.
function parseCatalogue(html) {
  const marker = "const RECIPES = ";
  const start = html.indexOf(marker);
  const end = start < 0 ? -1 : html.indexOf("const ACCOMPAGNEMENTS", start);
  if (start < 0 || end < 0) throw new Error("format du catalogue non reconnu");

  const segment = html.slice(start + marker.length, end);
  const closing = segment.lastIndexOf("]");
  if (closing < 0) throw new Error("format du catalogue non reconnu");
  const literal = segment.slice(0, closing + 1);

  let list;
  try {
    // Cas normal : JSON pur, hors lignes de commentaires
    list = JSON.parse(literal.replace(/^\s*\/\/.*$/gm, ""));
  } catch {
    // Secours : littéral JavaScript (clés sans guillemets, virgules finales...)
    list = new Function(`return ${literal}`)();
  }
  return list.filter((r) => r && r.title && Array.isArray(r.ingredients) && Array.isArray(r.steps));
}

export function loadCatalogue() {
  if (!cataloguePromise) {
    cataloguePromise = fetch(CATALOGUE_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`catalogue indisponible (${res.status})`);
        return res.text();
      })
      .then(parseCatalogue)
      .catch((err) => {
        cataloguePromise = null; // permet de réessayer
        throw err;
      });
  }
  return cataloguePromise;
}
