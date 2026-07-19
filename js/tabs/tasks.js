import { markTabSeen } from "../badges.js";
import { subscribeToTable } from "../sync.js";
import { goHome, pushView, goBack } from "../router.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";
import { getHouseholdProfiles } from "../profiles.js";
import { getTasks, createTask, updateTask, deleteTask, completeTask, isTaskDue } from "../tasks.js";

const RECURRENCE_LABELS = { none: "Une fois", daily: "Tous les jours", weekly: "Toutes les semaines", monthly: "Tous les mois" };

let unsubscribe = null;
let tasks = [];
let profilesById = new Map();
let view = "list"; // "list" | "detail"
let currentTask = null;
let containerRef = null;
let currentHouseholdId = null;
let currentUserId = null;
let pendingDeleteIds = new Set();

export async function mount(container, ctx) {
  containerRef = container;
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;
  view = "list";

  await markTabSeen(currentUserId, "tasks");

  const profiles = await getHouseholdProfiles(currentHouseholdId);
  profilesById = new Map(profiles.map((p) => [p.user_id, p]));

  await renderListView();

  unsubscribe = subscribeToTable("household_tasks", currentHouseholdId, async () => {
    if (view === "list") await loadTasks();
  });
}

export function unmount() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

function profileName(userId) {
  if (!userId) return "Non assignée";
  return profilesById.get(userId)?.display_name ?? "Membre";
}

// ==========================================
// VUE 1 : liste des tâches
// ==========================================
async function renderListView() {
  containerRef.innerHTML = `
    <div class="lists-overview">
      <button class="home-btn" id="home-btn-tasks">🏠 Accueil</button>
      <form id="new-task-form" class="add-form">
        <input id="new-task-title" placeholder="Nouvelle tâche…" required />
        <button type="submit">+</button>
      </form>
      <h3 class="upcoming-title">À faire</h3>
      <div id="due-tasks"></div>
      <h3 class="upcoming-title">Pas encore dues</h3>
      <div id="upcoming-tasks"></div>
    </div>
  `;

  document.getElementById("home-btn-tasks").addEventListener("click", () => goHome());
  document.getElementById("new-task-form").addEventListener("submit", handleQuickAdd);

  await loadTasks();
}

async function loadTasks() {
  tasks = await getTasks(currentHouseholdId);
  renderTaskLists();
}

function renderTaskLists() {
  const dueEl = document.getElementById("due-tasks");
  const upcomingEl = document.getElementById("upcoming-tasks");
  if (!dueEl || !upcomingEl) return;

  const visible = tasks.filter((t) => !pendingDeleteIds.has(t.id));
  const due = visible.filter(isTaskDue);
  const upcoming = visible.filter((t) => !isTaskDue(t));

  dueEl.innerHTML =
    due.length === 0
      ? `<p class="empty-state">Rien à faire pour l'instant 🎉</p>`
      : due.map((t) => taskRowHtml(t)).join("");

  upcomingEl.innerHTML =
    upcoming.length === 0 ? `<p class="empty-state">Aucune tâche en attente.</p>` : upcoming.map((t) => taskRowHtml(t)).join("");

  [dueEl, upcomingEl].forEach((container) => {
    container.querySelectorAll('[data-action="complete"]').forEach((el) => {
      el.addEventListener("change", (e) => handleComplete(e.target.closest(".task-row").dataset.id));
    });
    container.querySelectorAll('[data-action="open"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        const task = tasks.find((t) => t.id === e.target.closest(".task-row").dataset.id);
        openTaskDetail(task);
      });
    });
  });
}

function taskRowHtml(task) {
  return `
    <div class="task-row" data-id="${task.id}">
      <input type="checkbox" data-action="complete" aria-label="Marquer comme fait" />
      <div class="task-row-info" data-action="open">
        <span class="task-row-title">${escapeHtml(task.title)}</span>
        <span class="task-row-meta">${profileName(task.assigned_to)} · ${RECURRENCE_LABELS[task.recurrence]}</span>
      </div>
    </div>
  `;
}

async function handleQuickAdd(e) {
  e.preventDefault();
  const input = document.getElementById("new-task-title");
  const title = input.value.trim();
  if (!title) return;
  input.value = "";

  await createTask({
    household_id: currentHouseholdId,
    title,
    assigned_to: null,
    recurrence: "none",
    created_by: currentUserId,
  });
  await loadTasks();
}

async function handleComplete(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  await completeTask(task);
  await loadTasks();
}

// ==========================================
// VUE 2 : détail / édition d'une tâche
// ==========================================
function openTaskDetail(task) {
  view = "detail";
  currentTask = task;

  pushView(() => {
    view = "list";
    renderListView();
  });

  const memberOptions = [...profilesById.values()]
    .map((p) => `<option value="${p.user_id}" ${task.assigned_to === p.user_id ? "selected" : ""}>${escapeHtml(p.display_name)}</option>`)
    .join("");

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-tasks" class="back-btn">‹ Tâches</button>
      <form id="task-detail-form" class="event-form">
        <label class="field-label" for="t-title">Intitulé</label>
        <input id="t-title" value="${escapeHtml(task.title)}" required />

        <label class="field-label" for="t-assignee">Assignée à</label>
        <select id="t-assignee">
          <option value="">Non assignée</option>
          ${memberOptions}
        </select>

        <label class="field-label" for="t-recurrence">Récurrence</label>
        <select id="t-recurrence">
          <option value="none" ${task.recurrence === "none" ? "selected" : ""}>Une fois</option>
          <option value="daily" ${task.recurrence === "daily" ? "selected" : ""}>Tous les jours</option>
          <option value="weekly" ${task.recurrence === "weekly" ? "selected" : ""}>Toutes les semaines</option>
          <option value="monthly" ${task.recurrence === "monthly" ? "selected" : ""}>Tous les mois</option>
        </select>

        <button type="submit">Enregistrer</button>
      </form>
      <button type="button" id="delete-task-btn" class="danger-btn">Supprimer</button>
    </div>
  `;

  document.getElementById("back-to-tasks").addEventListener("click", () => goBack());
  document.getElementById("task-detail-form").addEventListener("submit", handleSaveTask);
  document.getElementById("delete-task-btn").addEventListener("click", () => handleDeleteTask(task));
}

async function handleSaveTask(e) {
  e.preventDefault();
  const title = document.getElementById("t-title").value.trim();
  const assignee = document.getElementById("t-assignee").value || null;
  const recurrence = document.getElementById("t-recurrence").value;
  if (!title) return;

  await updateTask(currentTask.id, { title, assigned_to: assignee, recurrence });
  goBack();
}

function handleDeleteTask(task) {
  pendingDeleteIds.add(task.id);
  goBack();

  showUndoToast({
    message: `Tâche « ${task.title} » supprimée`,
    onUndo: () => {
      pendingDeleteIds.delete(task.id);
      renderTaskLists();
    },
    onConfirm: async () => {
      pendingDeleteIds.delete(task.id);
      await deleteTask(task.id);
      await loadTasks();
    },
  });
}
