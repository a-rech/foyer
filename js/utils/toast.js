// Affiche un toast en bas de l'écran pendant `duration` ms avec un bouton "Annuler".
// Si l'utilisateur clique sur Annuler avant la fin, `onUndo` est appelé et
// `onConfirm` n'est jamais déclenché. Sinon, `onConfirm` est appelé à l'expiration.
export function showUndoToast({ message, duration = 2000, onUndo, onConfirm }) {
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
