import { supabase } from "../supabase-client.js";
import { subscribeToTable } from "../sync.js";
import { markTabSeen, getLastSeenMap, shouldShowBadge } from "../badges.js";
import { goHome, pushView, goBack } from "../router.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";
import { COLOR_CYCLE, randomTileColor } from "../utils/tileBoard.js";

let unsubscribe = null;
let notes = [];
let view = "board"; // "board" | "detail"
let currentNote = null;
let currentHouseholdId = null;
let currentUserId = null;
let containerRef = null;
let pendingDeleteIds = new Set();
let notesLastSeenAt = null; // capturé avant markTabSeen, pour les badges "nouveau" par tuile

// Drag & drop (pointer events, compatible souris + tactile)
let draggedEl = null;

export async function mount(container, ctx) {
  containerRef = container;
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;
  view = "board";
  currentNote = null;

  // Capturé AVANT markTabSeen : sinon toute note serait déjà "vue" dès l'ouverture
  const previousLastSeen = await getLastSeenMap(currentUserId);
  notesLastSeenAt = previousLastSeen["notes"];
  await markTabSeen(currentUserId, "notes");

  await renderBoardView();

  unsubscribe = subscribeToTable("notes", currentHouseholdId, async () => {
    if (view === "board") await loadNotes();
  });
}

export function unmount() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

// ==========================================
// VUE 1 : le mur de notes
// ==========================================
async function renderBoardView() {
  containerRef.innerHTML = `
    <div class="tab-notes">
      <button class="home-btn" id="home-btn-notes">🏠 Accueil</button>
      <form id="note-form" class="add-form">
        <input id="note-content" placeholder="Un post-it… (texte ou emoji)" required />
        <button type="submit">+</button>
      </form>
      <div id="note-board" class="note-board"></div>
    </div>
  `;

  document.getElementById("home-btn-notes").addEventListener("click", () => goHome());
  document.getElementById("note-form").addEventListener("submit", handleAdd);

  await loadNotes();
}

async function loadNotes() {
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("household_id", currentHouseholdId)
    .eq("archived", false)
    .order("position", { ascending: true });
  if (error) return console.error(error);
  notes = data;
  renderBoard();
}

async function handleAdd(e) {
  e.preventDefault();
  const input = document.getElementById("note-content");
  const content = input.value.trim();
  if (!content) return;
  input.value = "";

  const newNote = {
    household_id: currentHouseholdId,
    content,
    created_by: currentUserId,
    position: notes.length,
    favorite: false,
    color: randomTileColor(),
  };

  // Affichage optimiste immédiat (corrige l'absence d'affichage à la création)
  const tempId = `temp-${Date.now()}`;
  notes.push({ ...newNote, id: tempId, archived: false });
  renderBoard();

  const { data, error } = await supabase.from("notes").insert(newNote).select().single();
  if (error) {
    notes = notes.filter((n) => n.id !== tempId);
    renderBoard();
    return alert("Erreur: " + error.message);
  }
  // Remplace la note temporaire par la vraie (avec son id définitif)
  notes = notes.map((n) => (n.id === tempId ? data : n));
  renderBoard();
}

function renderBoard() {
  const board = document.getElementById("note-board");
  if (!board) return;

  const visible = notes.filter((n) => !pendingDeleteIds.has(n.id));

  if (visible.length === 0) {
    board.innerHTML = `<p class="empty-state">Aucune note pour l'instant.</p>`;
    return;
  }

  board.innerHTML = visible
    .map(
      (n) => `
    <div class="note-card ${n.color || "card-yellow"}" data-id="${n.id}">
      ${isNoteNew(n) ? `<span class="tile-badge-new" aria-label="Nouveau">N</span>` : ""}
      <div class="note-card-header">
        <span class="drag-handle" aria-label="Déplacer">⠿</span>
        <div class="note-card-actions">
          <button class="favorite-btn" data-action="color" aria-label="Changer la couleur">🎨</button>
          <button class="favorite-btn ${n.favorite ? "is-favorite" : ""}" data-action="favorite" aria-label="Favori">
            ${n.favorite ? "⭐" : "☆"}
          </button>
        </div>
      </div>
      <div class="tile-color-picker" hidden>
        ${COLOR_CYCLE.map((c) => `<button type="button" class="tile-color-swatch ${c}" data-color="${c}" aria-label="Couleur"></button>`).join("")}
      </div>
      <p class="note-card-content" data-action="open">${escapeHtml(n.content)}</p>
    </div>
  `
    )
    .join("");

  board.querySelectorAll('[data-action="open"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      const note = notes.find((n) => n.id === e.target.closest(".note-card").dataset.id);
      openNote(note);
    });
  });
  board.querySelectorAll('[data-action="favorite"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      handleToggleFavorite(e.target.closest(".note-card").dataset.id);
    });
  });
  board.querySelectorAll('[data-action="color"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const picker = el.closest(".note-card").querySelector(".tile-color-picker");
      const wasHidden = picker.hidden;
      board.querySelectorAll(".tile-color-picker").forEach((p) => (p.hidden = true));
      picker.hidden = !wasHidden;
    });
  });
  board.querySelectorAll(".tile-color-swatch").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = el.closest(".note-card").dataset.id;
      handleChangeNoteColor(id, el.dataset.color);
    });
  });
  board.querySelectorAll(".drag-handle").forEach((el) => {
    el.addEventListener("pointerdown", onDragHandlePointerDown);
  });
}

async function handleChangeNoteColor(id, color) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  note.color = color;
  renderBoard();
  await supabase.from("notes").update({ color }).eq("id", id);
}

// Une note est "nouvelle" si un AUTRE membre du foyer l'a ajoutée après notre dernière visite
function isNoteNew(note) {
  return note.created_by !== currentUserId && shouldShowBadge(note.created_at, notesLastSeenAt);
}

async function handleToggleFavorite(id) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  note.favorite = !note.favorite;
  renderBoard();
  await supabase.from("notes").update({ favorite: note.favorite }).eq("id", id);
}

// ==========================================
// Drag & drop (réordonnancement) via Pointer Events
// ==========================================
function onDragHandlePointerDown(e) {
  e.preventDefault();
  draggedEl = e.target.closest(".note-card");
  if (!draggedEl) return;
  draggedEl.classList.add("dragging");
  draggedEl.setPointerCapture(e.pointerId);
  draggedEl.addEventListener("pointermove", onDragPointerMove);
  draggedEl.addEventListener("pointerup", onDragPointerUp, { once: true });
  draggedEl.addEventListener("pointercancel", onDragPointerUp, { once: true });
}

function onDragPointerMove(e) {
  if (!draggedEl) return;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const targetCard = target?.closest(".note-card");
  if (targetCard && targetCard !== draggedEl) {
    const board = document.getElementById("note-board");
    const cards = [...board.children];
    const draggedIdx = cards.indexOf(draggedEl);
    const targetIdx = cards.indexOf(targetCard);
    if (draggedIdx < targetIdx) {
      board.insertBefore(draggedEl, targetCard.nextSibling);
    } else {
      board.insertBefore(draggedEl, targetCard);
    }
  }
}

async function onDragPointerUp() {
  if (!draggedEl) return;
  draggedEl.classList.remove("dragging");
  draggedEl.removeEventListener("pointermove", onDragPointerMove);
  const board = document.getElementById("note-board");
  const orderedIds = [...board.children].map((el) => el.dataset.id);
  draggedEl = null;

  // Met à jour l'ordre local puis persiste chaque position en base
  notes = orderedIds
    .map((id, index) => {
      const note = notes.find((n) => n.id === id);
      if (note) note.position = index;
      return note;
    })
    .filter(Boolean);

  await Promise.all(
    notes.map((n) => supabase.from("notes").update({ position: n.position }).eq("id", n.id))
  );
}

// ==========================================
// VUE 2 : détail / édition d'une note
// ==========================================
function openNote(note) {
  view = "detail";
  currentNote = note;

  pushView(() => {
    view = "board";
    renderBoardView();
  });

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-board" class="back-btn">‹ Notes</button>
      <form id="note-detail-form" class="recipe-form">
        <textarea id="note-detail-content" placeholder="Contenu de la note" required>${escapeHtml(note.content)}</textarea>
        <button type="submit">Enregistrer</button>
      </form>
      <div class="note-detail-actions">
        <button type="button" id="note-detail-favorite" class="secondary">
          ${note.favorite ? "⭐ Retirer des favoris" : "☆ Mettre en favori"}
        </button>
        <button type="button" id="note-detail-delete" class="danger-btn">Supprimer</button>
      </div>
    </div>
  `;

  document.getElementById("back-to-board").addEventListener("click", () => goBack());
  document.getElementById("note-detail-form").addEventListener("submit", handleSaveNote);
  document.getElementById("note-detail-favorite").addEventListener("click", async () => {
    currentNote.favorite = !currentNote.favorite;
    await supabase.from("notes").update({ favorite: currentNote.favorite }).eq("id", currentNote.id);
    openNote(currentNote);
  });
  document.getElementById("note-detail-delete").addEventListener("click", () => handleDeleteNote(currentNote));
}

async function handleSaveNote(e) {
  e.preventDefault();
  const content = document.getElementById("note-detail-content").value.trim();
  if (!content) return;
  await supabase.from("notes").update({ content }).eq("id", currentNote.id);
  const note = notes.find((n) => n.id === currentNote.id);
  if (note) note.content = content;
  goBack();
}

function handleDeleteNote(note) {
  pendingDeleteIds.add(note.id);
  goBack();

  showUndoToast({
    message: "Note supprimée",
    onUndo: () => {
      pendingDeleteIds.delete(note.id);
      renderBoard();
    },
    onConfirm: async () => {
      pendingDeleteIds.delete(note.id);
      await supabase.from("notes").update({ archived: true }).eq("id", note.id);
      await loadNotes();
    },
  });
}
