// Affiche un toast d'information simple (pas d'annulation), qui disparaît
// tout seul après `duration` ms. Pour une confirmation légère (ex. "Nom
// enregistré") plutôt qu'un alert() intrusif.
export function showInfoToast(message, duration = 2200) {
  const toast = document.createElement("div");
  toast.className = "undo-toast info-toast";
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// Affiche un toast en bas de l'écran pendant `duration` ms avec un bouton "Annuler".
// Si l'utilisateur clique sur Annuler avant la fin, `onUndo` est appelé et
// `onConfirm` n'est jamais déclenché. Sinon, `onConfirm` est appelé à l'expiration.
export function showUndoToast({ message, duration = 3000, onUndo, onConfirm }) {
  const toast = document.createElement("div");
  toast.className = "undo-toast";
  toast.innerHTML = `<span>${message}</span><button type="button">Annuler</button>`;
  document.body.appendChild(toast);

  let cancelled = false;
  const timer = setTimeout(() => {
    if (!cancelled) {
      toast.remove();
      onConfirm?.();
    }
  }, duration);

  toast.querySelector("button").addEventListener("click", () => {
    cancelled = true;
    clearTimeout(timer);
    toast.remove();
    onUndo?.();
  });
}
