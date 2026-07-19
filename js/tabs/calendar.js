import { supabase } from "../supabase-client.js";
import { subscribeToTable } from "../sync.js";
import { markTabSeen } from "../badges.js";
import { goHome, pushView, goBack, popViews } from "../router.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";
import { createTask, updateTask as updateLinkedTask, deleteTask as deleteLinkedTask } from "../tasks.js";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const INITIAL_PAST_WEEKS = 4;
const INITIAL_FUTURE_WEEKS = 10;
const LOAD_CHUNK_WEEKS = 6;
const IMPORTANT_WINDOW_DAYS = 60;
const SCROLL_EDGE_THRESHOLD = 250;
const MAX_BARS_PER_DAY = 3;

const MONTH_HUES = [225, 200, 165, 135, 100, 70, 45, 20, 355, 325, 290, 255];
function monthBg(monthIndex) {
  return `hsl(${MONTH_HUES[monthIndex]}, 48%, 88%)`;
}
function monthText(monthIndex) {
  return `hsl(${MONTH_HUES[monthIndex]}, 55%, 38%)`;
}

let unsubscribe = null;
let eventsById = new Map();
let loadedWeeks = [];
let isLoadingMore = false;
let view = "overview"; // "overview" | "day" | "event-detail"
let currentDay = null;
let currentEvent = null;
let eventReturnTo = "day";
let reminderDraft = [];
let depthSinceOverview = 0;
let overviewScrollTop = 0;
let containerRef = null;
let currentHouseholdId = null;
let currentUserId = null;
let pendingDeleteIds = new Set();

export async function mount(container, ctx) {
  containerRef = container;
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;
  view = "overview";
  eventsById = new Map();
  loadedWeeks = [];

  await markTabSeen(currentUserId, "calendar");
  await initOverviewFresh();

  unsubscribe = subscribeToTable("events", currentHouseholdId, async () => {
    if (view !== "overview") return;
    await refreshData();
    renderAllWeeks();
    renderUpcomingImportant();
  });
}

export function unmount() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

// ==========================================
// Helpers dates
// ==========================================
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function toDateInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function toTimeInputValue(date) {
  return date.toTimeString().slice(0, 5);
}
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function throttle(fn, wait) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    }
  };
}

function eventOccursOnDay(event, day) {
  const start = new Date(event.start_at);
  if (event.is_birthday) {
    return start.getMonth() === day.getMonth() && start.getDate() === day.getDate();
  }
  return isSameDay(start, day);
}

function nextOccurrence(event, from) {
  const start = new Date(event.start_at);
  if (!event.is_birthday) return start;
  let occurrence = new Date(from.getFullYear(), start.getMonth(), start.getDate());
  if (occurrence < from) occurrence = new Date(from.getFullYear() + 1, start.getMonth(), start.getDate());
  return occurrence;
}

// ==========================================
// Chargement des données
// ==========================================
async function fetchEventsForRange(fromDate, toDate) {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("household_id", currentHouseholdId)
    .gte("start_at", fromDate.toISOString())
    .lt("start_at", toDate.toISOString());
  if (error) return console.error(error);
  for (const e of data) eventsById.set(e.id, e);
}

// Les anniversaires reviennent chaque année : impossible de les filtrer par
// plage de dates (leur ligne garde l'année de création). On les charge tous,
// séparément, indépendamment de la fenêtre de semaines affichée.
async function fetchAllBirthdays() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("household_id", currentHouseholdId)
    .eq("is_birthday", true);
  if (error) return console.error(error);
  for (const e of data) eventsById.set(e.id, e);
}

async function refreshData() {
  if (loadedWeeks.length > 0) {
    await fetchEventsForRange(loadedWeeks[0], addDays(loadedWeeks[loadedWeeks.length - 1], 7));
  }
  await fetchAllBirthdays();
}

function eventsOnDay(day) {
  return [...eventsById.values()].filter((e) => eventOccursOnDay(e, day) && !pendingDeleteIds.has(e.id));
}

// Capture la position de scroll uniquement au moment où on quitte réellement
// la vue d'ensemble (pas à chaque sous-navigation ultérieure)
function captureOverviewExitPoint() {
  if (depthSinceOverview === 0) {
    const scrollEl = document.getElementById("week-scroll");
    overviewScrollTop = scrollEl ? scrollEl.scrollTop : 0;
  }
  depthSinceOverview++;
}

// ==========================================
// VUE 1 : calendrier défilant + événements importants à venir
// ==========================================
function renderOverviewShell() {
  containerRef.innerHTML = `
    <div class="tab-calendar">
      <div class="calendar-top-row">
        <button class="home-btn" id="home-btn-calendar">🏠 Accueil</button>
        <button class="home-btn" id="new-event-btn">+ Nouvel événement</button>
      </div>
      <div class="month-year-label">
        <span id="month-label"></span> <span id="year-label"></span>
      </div>
      <div class="week-headers">
        ${WEEKDAY_LABELS.map((d) => `<span>${d}</span>`).join("")}
      </div>
      <div id="week-scroll" class="week-scroll">
        <div id="week-grid" class="week-grid"></div>
      </div>
      <h3 class="upcoming-title">⭐ Événements importants à venir</h3>
      <div id="upcoming-list" class="upcoming-list"></div>
    </div>
  `;

  document.getElementById("home-btn-calendar").addEventListener("click", () => goHome());
  document.getElementById("new-event-btn").addEventListener("click", () => {
    eventReturnTo = "overview";
    openEventDetail(null, new Date());
  });
  document.getElementById("week-scroll").addEventListener("scroll", throttle(onWeekScroll, 120));
}

// Premier chargement de l'onglet : réinitialise tout et centre sur aujourd'hui
async function initOverviewFresh() {
  view = "overview";
  depthSinceOverview = 0;
  const todayMonday = getMonday(new Date());
  renderOverviewShell();

  loadedWeeks = [];
  for (let i = -INITIAL_PAST_WEEKS; i < 4 + INITIAL_FUTURE_WEEKS; i++) {
    loadedWeeks.push(addDays(todayMonday, i * 7));
  }

  await fetchEventsForRange(loadedWeeks[0], addDays(loadedWeeks[loadedWeeks.length - 1], 7));
  await fetchAllBirthdays();
  renderAllWeeks();
  renderUpcomingImportant();
  scrollToToday();
}

// Retour depuis une journée : réutilise les données déjà en mémoire et
// restaure la position de scroll exacte, sans recharger ni recentrer.
function restoreOverview(scrollTop) {
  view = "overview";
  depthSinceOverview = 0;
  renderOverviewShell();
  renderAllWeeks();
  renderUpcomingImportant();
  const scrollEl = document.getElementById("week-scroll");
  scrollEl.scrollTop = scrollTop;
  updateMonthLabel();
}

// Après enregistrement d'un événement : va à l'accueil du calendrier centré
// sur la semaine de cet événement (recharge la fenêtre autour de cette date,
// que la semaine ait déjà été chargée ou non).
async function goToOverviewAtDate(targetDate) {
  view = "overview";
  depthSinceOverview = 0;
  const targetMonday = getMonday(targetDate);
  renderOverviewShell();

  loadedWeeks = [];
  for (let i = -INITIAL_PAST_WEEKS; i < 4 + INITIAL_FUTURE_WEEKS; i++) {
    loadedWeeks.push(addDays(targetMonday, i * 7));
  }

  await fetchEventsForRange(loadedWeeks[0], addDays(loadedWeeks[loadedWeeks.length - 1], 7));
  await fetchAllBirthdays();
  renderAllWeeks();
  renderUpcomingImportant();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const scrollEl = document.getElementById("week-scroll");
      const row = scrollEl.querySelector(`[data-monday="${targetMonday.toISOString()}"]`);
      if (row) row.scrollIntoView({ block: "start" });
      updateMonthLabel();
    });
  });
}

function scrollToToday() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const scrollEl = document.getElementById("week-scroll");
      const todayMonday = getMonday(new Date()).toISOString();
      const todayRow = scrollEl.querySelector(`[data-monday="${todayMonday}"]`);
      if (todayRow) todayRow.scrollIntoView({ block: "start" });
      updateMonthLabel();
    });
  });
}

function renderAllWeeks() {
  const grid = document.getElementById("week-grid");
  if (!grid) return;
  const today = new Date();

  grid.innerHTML = loadedWeeks
    .map((weekStart) => {
      let row = `<div class="week-row" data-monday="${weekStart.toISOString()}">`;
      for (let i = 0; i < 7; i++) {
        const day = addDays(weekStart, i);
        const dayEvents = eventsOnDay(day);
        const isToday = isSameDay(day, today);
        const bars = dayEvents
          .slice(0, MAX_BARS_PER_DAY)
          .map((e) => `<span class="day-event-bar ${e.important ? "is-important" : ""}"></span>`)
          .join("");
        const extra = dayEvents.length > MAX_BARS_PER_DAY ? `<span class="day-event-extra">+${dayEvents.length - MAX_BARS_PER_DAY}</span>` : "";
        row += `
          <div class="day-slot" style="background:${monthBg(day.getMonth())}">
            <button class="day-cell ${isToday ? "is-today" : ""}" data-date="${day.toISOString()}">
              <span class="day-number">${day.getDate()}</span>
              <div class="day-event-bars">${bars}${extra}</div>
            </button>
          </div>
        `;
      }
      row += `</div>`;
      return row;
    })
    .join("");

  grid.querySelectorAll(".day-cell").forEach((el) => {
    el.addEventListener("click", () => {
      eventReturnTo = "day";
      openDay(new Date(el.dataset.date));
    });
  });
}

async function onWeekScroll(e) {
  const scrollEl = e.target;
  updateMonthLabel();

  if (isLoadingMore) return;

  if (scrollEl.scrollTop < SCROLL_EDGE_THRESHOLD) {
    isLoadingMore = true;
    const firstWeek = loadedWeeks[0];
    const newWeeks = [];
    for (let i = LOAD_CHUNK_WEEKS; i >= 1; i--) newWeeks.push(addDays(firstWeek, -i * 7));
    loadedWeeks = [...newWeeks, ...loadedWeeks];

    const prevScrollHeight = scrollEl.scrollHeight;
    await fetchEventsForRange(newWeeks[0], firstWeek);
    renderAllWeeks();
    scrollEl.scrollTop += scrollEl.scrollHeight - prevScrollHeight;
    isLoadingMore = false;
  } else if (scrollEl.scrollTop + scrollEl.clientHeight > scrollEl.scrollHeight - SCROLL_EDGE_THRESHOLD) {
    isLoadingMore = true;
    const lastWeek = loadedWeeks[loadedWeeks.length - 1];
    const newWeeks = [];
    for (let i = 1; i <= LOAD_CHUNK_WEEKS; i++) newWeeks.push(addDays(lastWeek, i * 7));
    loadedWeeks = [...loadedWeeks, ...newWeeks];

    await fetchEventsForRange(addDays(lastWeek, 7), addDays(newWeeks[newWeeks.length - 1], 7));
    renderAllWeeks();
    isLoadingMore = false;
  }
}

function updateMonthLabel() {
  const scrollEl = document.getElementById("week-scroll");
  const monthLabel = document.getElementById("month-label");
  const yearLabel = document.getElementById("year-label");
  if (!scrollEl || !monthLabel) return;

  const rows = [...scrollEl.querySelectorAll(".week-row")];
  const containerTop = scrollEl.getBoundingClientRect().top;
  let current = rows[0];
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.top - containerTop <= 30) {
      current = row;
    } else {
      break;
    }
  }
  if (!current) return;
  const monday = new Date(current.dataset.monday);
  const midWeek = addDays(monday, 3);

  monthLabel.textContent = capitalize(midWeek.toLocaleDateString("fr-FR", { month: "long" }));
  monthLabel.style.color = monthText(midWeek.getMonth());
  yearLabel.textContent = midWeek.getFullYear();
}

function renderUpcomingImportant() {
  const el = document.getElementById("upcoming-list");
  if (!el) return;
  const now = new Date();
  const windowEnd = addDays(now, IMPORTANT_WINDOW_DAYS);

  const important = [...eventsById.values()]
    .filter((e) => e.important && !pendingDeleteIds.has(e.id))
    .map((e) => ({ event: e, occursAt: nextOccurrence(e, now) }))
    .filter((x) => x.occursAt >= now && x.occursAt <= windowEnd)
    .sort((a, b) => a.occursAt - b.occursAt);

  if (important.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun événement important dans les 2 prochains mois.</p>`;
    return;
  }

  el.innerHTML = important
    .map(
      ({ event: e, occursAt }) => `
      <div class="event-item" data-id="${e.id}">
        ${e.is_birthday ? "🎂" : "⭐"}
        <span class="event-title">${escapeHtml(e.title)}</span>
        <span class="event-date">${occursAt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
      </div>
    `
    )
    .join("");

  el.querySelectorAll(".event-item").forEach((row) => {
    row.addEventListener("click", () => {
      const item = important.find((x) => x.event.id === row.dataset.id);
      eventReturnTo = "day";
      openDay(item.occursAt, item.event);
    });
  });
}

// ==========================================
// VUE 2 : détail d'une journée (grille horaire)
// ==========================================
async function openDay(day, focusEvent) {
  view = "day";
  currentDay = day;

  captureOverviewExitPoint();
  const scrollTopAtEntry = overviewScrollTop;
  pushView(() => restoreOverview(scrollTopAtEntry));

  const label = day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-overview" class="back-btn">‹ Calendrier</button>
      <h2 class="list-detail-title">${capitalize(label)}</h2>
      <button id="add-event-btn">+ Ajouter un événement</button>
      <div id="hours-grid" class="hours-grid"></div>
    </div>
  `;

  document.getElementById("back-to-overview").addEventListener("click", () => goBack());
  document.getElementById("add-event-btn").addEventListener("click", () => {
    eventReturnTo = "day";
    openEventDetail(null, day);
  });

  renderHoursGrid(day);

  if (focusEvent && !focusEvent.is_birthday) {
    setTimeout(() => {
      document.getElementById(`hour-${new Date(focusEvent.start_at).getHours()}`)?.scrollIntoView({ block: "center" });
    }, 0);
  }
}

function renderHoursGrid(day) {
  const grid = document.getElementById("hours-grid");
  if (!grid) return;

  const dayEvents = eventsOnDay(day);
  const allDayEvents = dayEvents.filter((e) => e.is_birthday);
  const timedEvents = dayEvents.filter((e) => !e.is_birthday);

  let html = "";
  if (allDayEvents.length > 0) {
    html += `
      <div class="all-day-section">
        <span class="all-day-label">Toute la journée</span>
        ${allDayEvents
          .map((e) => `<button class="hour-event all-day-event" data-id="${e.id}">🎂 ${escapeHtml(e.title)}</button>`)
          .join("")}
      </div>
    `;
  }

  for (let h = 0; h < 24; h++) {
    const hourEvents = timedEvents.filter((e) => new Date(e.start_at).getHours() === h);
    html += `
      <div class="hour-row" id="hour-${h}">
        <span class="hour-label">${String(h).padStart(2, "0")}h</span>
        <div class="hour-content">
          ${hourEvents
            .map((e) => `<button class="hour-event" data-id="${e.id}">${e.important ? "⭐ " : ""}${escapeHtml(e.title)}</button>`)
            .join("")}
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".hour-event").forEach((el) => {
    el.addEventListener("click", () => {
      const event = eventsById.get(el.dataset.id);
      eventReturnTo = "day";
      openEventDetail(event, day);
    });
  });
}

// ==========================================
// VUE 3 : création / édition d'un événement
// ==========================================
function openEventDetail(event, day) {
  view = "event-detail";
  currentEvent = event;
  reminderDraft = event?.reminders ? event.reminders.map((r) => ({ ...r })) : [];
  const returnTo = eventReturnTo;

  captureOverviewExitPoint();
  const scrollTopAtEntry = overviewScrollTop;
  pushView(() => {
    if (returnTo === "overview") {
      restoreOverview(scrollTopAtEntry);
    } else {
      view = "day";
      renderHoursGrid(currentDay);
    }
  });

  const startDate = event ? new Date(event.start_at) : new Date(day);
  if (!event) {
    const now = new Date();
    startDate.setHours(now.getHours(), 0, 0, 0);
  }

  const backLabel = returnTo === "overview" ? "‹ Calendrier" : `‹ ${day.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
  const isBirthday = event?.is_birthday ?? false;

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-previous" class="back-btn">${backLabel}</button>
      <form id="event-detail-form" class="event-form">
        <label class="field-label" for="ev-title">Intitulé</label>
        <input id="ev-title" placeholder="Ex : Anniversaire de Léa" value="${event ? escapeHtml(event.title) : ""}" required />

        <label class="field-label" for="ev-date">Date</label>
        <input id="ev-date" type="date" value="${toDateInputValue(startDate)}" required />

        <div id="time-field-wrap">
          <label class="field-label" for="ev-time">Heure</label>
          <input id="ev-time" type="time" value="${toTimeInputValue(startDate)}" required />
        </div>

        <label class="checkbox-row">
          <input id="ev-birthday" type="checkbox" ${isBirthday ? "checked" : ""} />
          <span>🎂 Anniversaire</span>
        </label>
        <p id="birthday-hint" class="field-hint" style="display:${isBirthday ? "block" : "none"}">
          Affiché toute la journée, chaque année.
        </p>

        <label class="checkbox-row">
          <input id="ev-important" type="checkbox" ${event?.important ? "checked" : ""} />
          <span>⭐ Important</span>
        </label>

        <label class="checkbox-row">
          <input id="ev-add-task" type="checkbox" ${event?.linked_task_id ? "checked" : ""} />
          <span>🗒️ Ajouter aux tâches</span>
        </label>

        <label class="field-label">Rappels</label>
        <div id="reminders-list" class="reminders-list"></div>
        <button type="button" id="add-reminder-btn" class="secondary">+ Ajouter un rappel</button>

        <button type="submit">Enregistrer</button>
      </form>
      ${event ? `<button type="button" id="delete-event-btn" class="danger-btn">Supprimer</button>` : ""}
    </div>
  `;

  const birthdayCheckbox = document.getElementById("ev-birthday");
  const timeFieldWrap = document.getElementById("time-field-wrap");
  const birthdayHint = document.getElementById("birthday-hint");
  const syncBirthdayUI = () => {
    const checked = birthdayCheckbox.checked;
    timeFieldWrap.style.display = checked ? "none" : "block";
    birthdayHint.style.display = checked ? "block" : "none";
  };
  birthdayCheckbox.addEventListener("change", syncBirthdayUI);
  syncBirthdayUI();

  renderReminders();
  document.getElementById("add-reminder-btn").addEventListener("click", () => {
    reminderDraft.push({ amount: 1, unit: "hours" });
    renderReminders();
  });

  document.getElementById("back-to-previous").addEventListener("click", () => goBack());
  document.getElementById("event-detail-form").addEventListener("submit", (e) => handleSaveEvent(e, day));
  document.getElementById("delete-event-btn")?.addEventListener("click", () => handleDeleteEvent(event));
}

function renderReminders() {
  const el = document.getElementById("reminders-list");
  if (!el) return;

  if (reminderDraft.length === 0) {
    el.innerHTML = `<p class="field-hint">Aucun rappel programmé.</p>`;
  } else {
    el.innerHTML = reminderDraft
      .map(
        (r, i) => `
      <div class="reminder-row" data-index="${i}">
        <input type="number" min="1" class="reminder-amount" value="${r.amount}" />
        <select class="reminder-unit">
          <option value="hours" ${r.unit === "hours" ? "selected" : ""}>heure(s) avant</option>
          <option value="days" ${r.unit === "days" ? "selected" : ""}>jour(s) avant</option>
        </select>
        <button type="button" class="reminder-remove" data-index="${i}">✕</button>
      </div>
    `
      )
      .join("");
  }

  el.querySelectorAll(".reminder-amount").forEach((input) => {
    input.addEventListener("change", (e) => {
      const idx = +e.target.closest(".reminder-row").dataset.index;
      reminderDraft[idx].amount = Math.max(1, parseInt(e.target.value) || 1);
    });
  });
  el.querySelectorAll(".reminder-unit").forEach((select) => {
    select.addEventListener("change", (e) => {
      const idx = +e.target.closest(".reminder-row").dataset.index;
      reminderDraft[idx].unit = e.target.value;
    });
  });
  el.querySelectorAll(".reminder-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = +e.target.dataset.index;
      reminderDraft.splice(idx, 1);
      renderReminders();
    });
  });
}

async function handleSaveEvent(e, day) {
  e.preventDefault();
  const title = document.getElementById("ev-title").value.trim();
  const dateVal = document.getElementById("ev-date").value;
  const isBirthday = document.getElementById("ev-birthday").checked;
  const important = document.getElementById("ev-important").checked;
  const addToTasks = document.getElementById("ev-add-task").checked;
  const timeVal = isBirthday ? "00:00" : document.getElementById("ev-time").value;
  if (!title || !dateVal || !timeVal) return;

  const startAt = new Date(`${dateVal}T${timeVal}`);
  const payload = {
    title,
    start_at: startAt.toISOString(),
    is_birthday: isBirthday,
    important,
    reminders: reminderDraft,
  };

  let eventRow;
  if (currentEvent) {
    const { data } = await supabase.from("events").update(payload).eq("id", currentEvent.id).select().single();
    eventRow = data;
  } else {
    const { data } = await supabase
      .from("events")
      .insert({ ...payload, household_id: currentHouseholdId, created_by: currentUserId })
      .select()
      .single();
    eventRow = data;
  }

  if (eventRow) await syncLinkedTask(eventRow, addToTasks, dateVal);

  // Pour un anniversaire, on centre sur sa prochaine occurrence plutôt que
  // sur l'année saisie (qui peut être ancienne, ex. année de naissance)
  const centerDate = isBirthday ? nextOccurrence({ start_at: startAt.toISOString(), is_birthday: true }, new Date()) : startAt;

  popViews(depthSinceOverview);
  await goToOverviewAtDate(centerDate);
}

// Crée, met à jour ou supprime la tâche liée à un événement selon l'état
// de la case "Ajouter aux tâches"
async function syncLinkedTask(eventRow, shouldLink, dueDateVal) {
  if (shouldLink) {
    if (eventRow.linked_task_id) {
      await updateLinkedTask(eventRow.linked_task_id, { title: eventRow.title, due_date: dueDateVal });
    } else {
      const newTask = await createTask({
        household_id: currentHouseholdId,
        title: eventRow.title,
        recurrence: "none",
        recurrence_interval: 1,
        due_date: dueDateVal,
        created_by: currentUserId,
      });
      await supabase.from("events").update({ linked_task_id: newTask.id }).eq("id", eventRow.id);
    }
  } else if (eventRow.linked_task_id) {
    await deleteLinkedTask(eventRow.linked_task_id);
    await supabase.from("events").update({ linked_task_id: null }).eq("id", eventRow.id);
  }
}

function handleDeleteEvent(event) {
  pendingDeleteIds.add(event.id);

  const depth = depthSinceOverview;
  const scrollTop = overviewScrollTop;
  popViews(depth);
  restoreOverview(scrollTop);

  showUndoToast({
    message: `Événement « ${event.title} » supprimé`,
    onUndo: () => {
      pendingDeleteIds.delete(event.id);
      refreshCurrentView();
    },
    onConfirm: async () => {
      pendingDeleteIds.delete(event.id);
      await supabase.from("events").delete().eq("id", event.id);
      if (event.linked_task_id) await deleteLinkedTask(event.linked_task_id);
      eventsById.delete(event.id);
    },
  });
}

function refreshCurrentView() {
  if (view === "day" && currentDay) {
    renderHoursGrid(currentDay);
  } else if (view === "overview") {
    renderAllWeeks();
    renderUpcomingImportant();
  }
}
