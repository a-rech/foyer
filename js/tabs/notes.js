import { supabase } from "../supabase-client.js";
import { subscribeToTable } from "../sync.js";
import { markTabSeen } from "../badges.js";
import { navigateTo } from "../router.js";

let unsubscribe = null;
let notes = [];
let currentHouseholdId = null;
let currentUserId = null;

export async function mount(container, ctx) {
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;

  container.innerHTML = `
    <div class="tab-notes">
      <button class="home-btn" id="home-btn-notes">🏠 Accueil</button>
      <form id="note-form" class="add-form">
        <input id="note-content" placeholder="Un post-it… (texte ou emoji)" required />
        <button type="submit">+</button>
      </form>
      <div id="note-board" class="note-board"></div>
    </div>
  `;

  document.getElementById("home-btn-notes").addEventListener("click", () => navigateTo("home"));
  document.getElementById("note-form").addEventListener("submit", handleAdd);

  await loadNotes();
  await markTabSeen(currentUserId, "notes");

  unsubscribe = subscribeToTable("notes", currentHouseholdId, loadNotes);
}

export function unmount() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

async function loadNotes() {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("household_id", currentHouseholdId)
    .eq("archived", false)
    .order("created_at", { ascending: false });
  if (error) return console.error(error);
  notes = data;
  render();
}

async function handleAdd(e) {
  e.preventDefault();
  const input = document.getElementById("note-content");
  const content = input.value.trim();
  if (!content) return;

  const { error } = await supabase.from("notes").insert({
    household_id: currentHouseholdId,
    content,
    created_by: currentUserId,
  });
  if (error) return alert("Erreur: " + error.message);
  input.value = "";
}

async function handleArchive(id) {
  await supabase.from("notes").update({ archived: true }).eq("id", id);
}

function render() {
  const board = document.getElementById("note-board");
  if (!board) return;
  board.innerHTML = notes
    .map(
      (n) => `
    <div class="sticky-note" data-id="${n.id}">
      <p>${n.content}</p>
      <button data-action="archive">Archiver</button>
    </div>
  `
    )
    .join("");

  board.querySelectorAll('[data-action="archive"]').forEach((el) => {
    el.addEventListener("click", (e) => handleArchive(e.target.closest(".sticky-note").dataset.id));
  });
}
