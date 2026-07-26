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
//   onReorder(orderedIds) -> appelé après un glisser-déposer avec la nouvelle liste d'ids
//
// Couleur, renommage et suppression ne sont PAS sur la tuile : ils vivent dans
// la page vers laquelle elle mène (voir renderColorPickerHeader/wireColorPickerHeader
// ci-dessous, utilisés dans les en-têtes de détail de recipes.js/shopping.js/notes.js).
export function renderTileBoard(boardEl, items, options) {
  const { getId, getLabel, getColor, emptyMessage = "Rien pour l'instant.", isNew, onOpen, onReorder } = options;

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
      <div class="tile-card-row">
        <span class="drag-handle" aria-label="Déplacer">⠿</span>
        <span class="tile-card-content" data-action="open">${escapeHtml(getLabel(item))}</span>
      </div>
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
  if (onReorder) {
    boardEl.querySelectorAll(".drag-handle").forEach((el) => {
      el.addEventListener("pointerdown", (e) => onDragHandlePointerDown(e, boardEl, onReorder));
    });
  }
}

// Bouton "🎨" + popup de pastilles de couleur, à placer dans un en-tête de
// page de détail (à côté du titre), plutôt que sur une tuile.
export function renderColorPickerHeader() {
  return `
    <div class="detail-color-picker-wrap">
      <button type="button" class="icon-btn" data-action="color" aria-label="Changer la couleur">🎨</button>
      <div class="tile-color-picker" hidden>
        ${COLOR_CYCLE.map((c) => `<button type="button" class="tile-color-swatch ${c}" data-color="${c}" aria-label="Couleur"></button>`).join("")}
      </div>
    </div>
  `;
}

// Branche le bouton/popup ci-dessus. `container` doit contenir les deux
// éléments (bouton + popup) ; onPick(color) est appelé au choix d'une pastille.
export function wireColorPickerHeader(container, onPick) {
  const toggleBtn = container.querySelector('[data-action="color"]');
  const picker = container.querySelector(".tile-color-picker");
  if (!toggleBtn || !picker) return;
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".tile-color-picker:not([hidden])").forEach((p) => {
      if (p !== picker) p.hidden = true;
    });
    picker.hidden = !picker.hidden;
  });
  picker.querySelectorAll(".tile-color-swatch").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      picker.hidden = true;
      onPick(el.dataset.color);
    });
  });
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
