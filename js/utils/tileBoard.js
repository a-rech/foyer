import { escapeHtml } from "./format.js";

// Palette pastel de l'application, partagée par toutes les tuiles
// (listes, catégories, recettes, notes...)
export const COLOR_CYCLE = ["card-peach", "card-mint", "card-sky", "card-yellow", "card-lavender", "card-rose", "card-teal"];

// Choisit une couleur au hasard dans la palette (utilisé à la création d'un élément)
export function randomTileColor() {
  return COLOR_CYCLE[Math.floor(Math.random() * COLOR_CYCLE.length)];
}

let draggedEl = null;

// Affiche une grille de tuiles déplaçables (glisser-déposer via Pointer Events,
// compatible souris + tactile), avec actions optionnelles ouvrir/éditer/supprimer/couleur.
//
// options:
//   getId(item)       -> identifiant unique (obligatoire)
//   getLabel(item)     -> texte affiché sur la tuile (obligatoire)
//   getColor(item)      -> classe de couleur (une valeur de COLOR_CYCLE) ; retombe sur
//                          la première couleur de la palette si absente
//   emptyMessage       -> texte si la liste est vide
//   isNew(item)         -> true pour afficher le badge vert "N" en haut à gauche
//   onOpen(item)        -> tap sur le contenu de la tuile
//   onEdit(item)        -> tap sur l'icône ✎ (omise si absente)
//   onDelete(item)      -> tap sur l'icône 🗑️ (omise si absente)
//   onColorChange(item, color) -> tap sur une pastille du sélecteur de couleur (omis si absent)
//   onReorder(orderedIds) -> appelé après un glisser-déposer avec la nouvelle liste d'ids
export function renderTileBoard(boardEl, items, options) {
  const {
    getId,
    getLabel,
    getColor,
    emptyMessage = "Rien pour l'instant.",
    isNew,
    onOpen,
    onEdit,
    onDelete,
    onColorChange,
    onReorder,
  } = options;

  if (!boardEl) return;

  if (items.length === 0) {
    boardEl.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
    return;
  }

  boardEl.innerHTML = items
    .map((item) => {
      const color = (getColor && getColor(item)) || COLOR_CYCLE[0];
      return `
    <div class="tile-card ${color}" data-id="${getId(item)}">
      ${isNew && isNew(item) ? `<span class="tile-badge-new" aria-label="Nouveau">N</span>` : ""}
      <div class="tile-card-header">
        <span class="drag-handle" aria-label="Déplacer">⠿</span>
        <div class="tile-card-actions">
          ${onColorChange ? `<button class="tile-icon-btn" data-action="color" aria-label="Changer la couleur">🎨</button>` : ""}
          ${onEdit ? `<button class="tile-icon-btn" data-action="edit" aria-label="Modifier">✎</button>` : ""}
          ${onDelete ? `<button class="tile-icon-btn" data-action="delete" aria-label="Supprimer">🗑️</button>` : ""}
        </div>
      </div>
      ${
        onColorChange
          ? `<div class="tile-color-picker" hidden>
              ${COLOR_CYCLE.map((c) => `<button type="button" class="tile-color-swatch ${c}" data-color="${c}" aria-label="Couleur"></button>`).join("")}
            </div>`
          : ""
      }
      <span class="tile-card-content" data-action="open">${escapeHtml(getLabel(item))}</span>
    </div>
  `;
    })
    .join("");

  const findItem = (el) => {
    const id = el.closest(".tile-card")?.dataset.id;
    return items.find((it) => String(getId(it)) === String(id));
  };

  if (onOpen) {
    boardEl.querySelectorAll('[data-action="open"]').forEach((el) => {
      el.addEventListener("click", () => {
        const item = findItem(el);
        if (item) onOpen(item);
      });
    });
  }
  if (onEdit) {
    boardEl.querySelectorAll('[data-action="edit"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = findItem(el);
        if (item) onEdit(item);
      });
    });
  }
  if (onDelete) {
    boardEl.querySelectorAll('[data-action="delete"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = findItem(el);
        if (item) onDelete(item);
      });
    });
  }
  if (onColorChange) {
    boardEl.querySelectorAll('[data-action="color"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const picker = el.closest(".tile-card").querySelector(".tile-color-picker");
        const wasHidden = picker.hidden;
        boardEl.querySelectorAll(".tile-color-picker").forEach((p) => (p.hidden = true));
        picker.hidden = !wasHidden;
      });
    });
    boardEl.querySelectorAll(".tile-color-swatch").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = findItem(el);
        if (item) onColorChange(item, el.dataset.color);
      });
    });
  }
  if (onReorder) {
    boardEl.querySelectorAll(".drag-handle").forEach((el) => {
      el.addEventListener("pointerdown", (e) => onDragHandlePointerDown(e, boardEl, onReorder));
    });
  }
}

function onDragHandlePointerDown(e, boardEl, onReorder) {
  e.preventDefault();
  draggedEl = e.target.closest(".tile-card");
  if (!draggedEl) return;
  draggedEl.classList.add("dragging");
  draggedEl.setPointerCapture(e.pointerId);

  const onMove = (ev) => onDragPointerMove(ev, boardEl);
  const onUp = async () => {
    draggedEl.removeEventListener("pointermove", onMove);
    draggedEl.classList.remove("dragging");
    const orderedIds = [...boardEl.children].map((el) => el.dataset.id);
    draggedEl = null;
    await onReorder(orderedIds);
  };

  draggedEl.addEventListener("pointermove", onMove);
  draggedEl.addEventListener("pointerup", onUp, { once: true });
  draggedEl.addEventListener("pointercancel", onUp, { once: true });
}

function onDragPointerMove(e, boardEl) {
  if (!draggedEl) return;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const targetCard = target?.closest(".tile-card");
  if (targetCard && targetCard !== draggedEl && boardEl.contains(targetCard)) {
    const cards = [...boardEl.children];
    const draggedIdx = cards.indexOf(draggedEl);
    const targetIdx = cards.indexOf(targetCard);
    if (draggedIdx < targetIdx) {
      boardEl.insertBefore(draggedEl, targetCard.nextSibling);
    } else {
      boardEl.insertBefore(draggedEl, targetCard);
    }
  }
}

// Ferme les sélecteurs de couleur ouverts au clic en dehors (une seule fois pour toute l'app)
document.addEventListener("click", (e) => {
  if (e.target.closest(".tile-color-picker") || e.target.closest('[data-action="color"]')) return;
  document.querySelectorAll(".tile-color-picker:not([hidden])").forEach((p) => (p.hidden = true));
});
