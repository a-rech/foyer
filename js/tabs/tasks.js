import { markTabSeen } from "../badges.js";
import { subscribeToTable } from "../sync.js";
import { goHome, pushView, goBack } from "../router.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";
import { getHouseholdProfiles } from "../profiles.js";
import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  completeTask,
  postponeTaskOneDay,
  isTaskDue,
  daysUntilDue,
  dueLabel,
  recurrenceLabel,
  nextWeekday,
  addDays,
  formatDayLabel,
  WEEKDAY_LABELS,
} from "../tasks.js";

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

function toDateInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
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
  const byDueDate = (a, b) => (daysUntilDue(a) ?? 9999) - (daysUntilDue(b) ?? 9999);

  const due = visible.filter(isTaskDue).sort(byDueDate);
  const upcoming = visible.filter((t) => !isTaskDue(t)).sort(byDueDate);

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
    container.querySelectorAll('[data-action="postpone"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        handlePostpone(e.target.closest(".task-row").dataset.id);
      });
    });
  });
}

function taskRowHtml(task) {
  const overdue = (daysUntilDue(task) ?? 0) < 0;
  const showPostpone = isTaskDue(task);
  return `
    <div class="task-row" data-id="${task.id}">
      <input type="checkbox" data-action="complete" aria-label="Marquer comme fait" />
      <div class="task-row-info" data-action="open">
        <span class="task-row-title">${escapeHtml(task.title)}</span>
        <span class="task-row-meta">${profileName(task.assigned_to)} · ${recurrenceLabel(task)}</span>
        <span class="task-row-due ${overdue ? "is-overdue" : ""}">${dueLabel(task)}</span>
      </div>
      ${showPostpone ? `<button type="button" class="task-row-postpone" data-action="postpone" aria-label="Reporter d'un jour">⏰ Plus tard</button>` : ""}
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
    recurrence_interval: 1,
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

// Report rapide d'un jour ("Plus tard") : ne modifie pas le rythme de
// récurrence, seulement l'échéance affichée jusqu'au prochain "fait".
async function handlePostpone(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  await postponeTaskOneDay(task);
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

  const weekdayOptions = WEEKDAY_LABELS.map(
    (label, i) => `<option value="${i}" ${task.recurrence_weekday === i ? "selected" : ""}>${label}</option>`
  ).join("");

  // 14 prochains jours pour le menu déroulant "Prévue pour" (Aujourd'hui, Demain, puis dates)
  let dueDateOptions = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(new Date(), i);
    return { value: toDateInputValue(d), label: formatDayLabel(d, i) };
  });
  if (task.due_date && !dueDateOptions.some((o) => o.value === task.due_date)) {
    dueDateOptions = [{ value: task.due_date, label: formatDayLabel(new Date(task.due_date), 99) }, ...dueDateOptions];
  }
  const dueDateOptionsHtml = dueDateOptions
    .map((o) => `<option value="${o.value}" ${task.due_date === o.value ? "selected" : ""}>${o.label}</option>`)
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
          <option value="daily" ${task.recurrence === "daily" ? "selected" : ""}>Tous les X jours</option>
          <option value="weekly" ${task.recurrence === "weekly" ? "selected" : ""}>Un jour précis, toutes les X semaines</option>
          <option value="monthly" ${task.recurrence === "monthly" ? "selected" : ""}>Tous les X mois</option>
        </select>

        <div id="due-date-field-wrap">
          <label class="field-label" for="t-due-date">Prévue pour</label>
          <select id="t-due-date">${dueDateOptionsHtml}</select>
        </div>

        <div id="interval-field-wrap">
          <label class="field-label" id="interval-label" for="t-interval">Intervalle</label>
          <input id="t-interval" type="number" min="1" value="${task.recurrence_interval || 1}" />
        </div>

        <div id="weekday-field-wrap">
          <label class="field-label" for="t-weekday">Jour de la semaine</label>
          <select id="t-weekday">${weekdayOptions}</select>
        </div>

        <button type="submit">Enregistrer</button>
      </form>
      <button type="button" id="delete-task-btn" class="danger-btn">Supprimer</button>
    </div>
  `;

  const recurrenceSelect = document.getElementById("t-recurrence");
  const dueDateWrap = document.getElementById("due-date-field-wrap");
  const intervalWrap = document.getElementById("interval-field-wrap");
  const intervalLabel = document.getElementById("interval-label");
  const weekdayWrap = document.getElementById("weekday-field-wrap");
  const INTERVAL_LABELS = { daily: "Tous les X jours — X =", weekly: "Toutes les X semaines — X =", monthly: "Tous les X mois — X =" };

  const syncRecurrenceUI = () => {
    const type = recurrenceSelect.value;
    dueDateWrap.style.display = type === "none" ? "block" : "none";
    intervalWrap.style.display = type === "none" ? "none" : "block";
    weekdayWrap.style.display = type === "weekly" ? "block" : "none";
    if (INTERVAL_LABELS[type]) intervalLabel.textContent = INTERVAL_LABELS[type];
  };
  recurrenceSelect.addEventListener("change", syncRecurrenceUI);
  syncRecurrenceUI();

  document.getElementById("back-to-tasks").addEventListener("click", () => goBack());
  document.getElementById("task-detail-form").addEventListener("submit", handleSaveTask);
  document.getElementById("delete-task-btn").addEventListener("click", () => handleDeleteTask(task));
}

async function handleSaveTask(e) {
  e.preventDefault();
  const title = document.getElementById("t-title").value.trim();
  const assignee = document.getElementById("t-assignee").value || null;
  const recurrence = document.getElementById("t-recurrence").value;
  const interval = Math.max(1, parseInt(document.getElementById("t-interval").value) || 1);
  if (!title) return;

  const values = {
    title,
    assigned_to: assignee,
    recurrence,
    recurrence_interval: recurrence === "none" ? 1 : interval,
    postponed_to: null,
  };

  if (recurrence === "none") {
    values.due_date = document.getElementById("t-due-date").value || null;
    values.recurrence_weekday = null;
    values.recurrence_anchor = null;
  } else if (recurrence === "weekly") {
    const weekday = parseInt(document.getElementById("t-weekday").value);
    // On ne recalcule l'ancre (point de départ du cycle) que si le jour ou le
    // type de récurrence a changé, pour ne pas décaler le rythme "1 semaine
    // sur 2" à chaque simple modification (ex: changer juste l'assignation).
    const weekdayChanged = !currentTask || currentTask.recurrence !== "weekly" || currentTask.recurrence_weekday !== weekday;
    values.recurrence_weekday = weekday;
    values.recurrence_anchor = weekdayChanged || !currentTask?.recurrence_anchor
      ? toDateInputValue(nextWeekday(new Date(), weekday))
      : currentTask.recurrence_anchor;
    values.due_date = null;
  } else {
    values.recurrence_weekday = null;
    values.recurrence_anchor = null;
    values.due_date = null;
  }

  await updateTask(currentTask.id, values);
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
