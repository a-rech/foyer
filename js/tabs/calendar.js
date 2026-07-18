import { supabase } from "../supabase-client.js";
import { subscribeToTable } from "../sync.js";
import { markTabSeen } from "../badges.js";
import { goHome, pushView, goBack } from "../router.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const INITIAL_PAST_WEEKS = 4;
const INITIAL_FUTURE_WEEKS = 10;
const LOAD_CHUNK_WEEKS = 6;
const IMPORTANT_WINDOW_DAYS = 60;
const SCROLL_EDGE_THRESHOLD = 250; // px avant le bord pour déclencher un chargement

let unsubscribe = null;
let eventsById = new Map(); // toutes les occurrences chargées, dédupliquées par id
let loadedWeeks = []; // array de lundis (Date), trié croissant
let isLoadingMore = false;
let view = "overview"; // "overview" | "day" | "event-detail"
let currentDay = null;
let currentEvent = null;
let eventReturnTo = "day"; // "day" | "overview" - où revenir après le formulaire d'événement
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
  await renderOverview();

  unsubscribe = subscribeToTable("events", currentHouseholdId, async (payload) => {
    if (view !== "overview") return;
    await mergeEventsForLoadedRange();
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

// ==========================================
// VUE 1 : calendrier défilant + événements importants à venir
// ==========================================
async function renderOverview() {
  const todayMonday = getMonday(new Date());

  containerRef.innerHTML = `
    <div class="tab-calendar">
      <div class="calendar-top-row">
        <button class="home-btn" id="home-btn-calendar">🏠 Accueil</button>
        <button class="home-btn" id="new-event-btn">+ Nouvel événement</button>
      </div>
      <div id="month-year-label" class="month-year-label"></div>
      <div class="week-headers">
        ${WEEKDAY_LABELS.map((d) => `<span>${d}</span>`).join("")}
      </div>
      <div id="week-scroll" class="week-scroll">
        <div id="week-grid" class="week-grid"></div>
      </div>
      <h3 class="upcoming-title">⭐ Événements importants à venir</h3>
      <div id="upcoming-list"></div>
    </div>
  `;

  document.getElementById("home-btn-calendar").addEventListener("click", () => goHome());
  document.getElementById("new-event-btn").addEventListener("click", () => {
    eventReturnTo = "overview";
    openEventDetail(null, new Date());
  });

  // Fenêtre initiale : 4 semaines passées de tampon + les 4 semaines demandées + tampon futur
  loadedWeeks = [];
  for (let i = -INITIAL_PAST_WEEKS; i < 4 + INITIAL_FUTURE_WEEKS; i++) {
    loadedWeeks.push(addDays(todayMonday, i * 7));
  }

  await fetchEventsForRange(loadedWeeks[0], addDays(loadedWeeks[loadedWeeks.length - 1], 7));
  renderAllWeeks();
  renderUpcomingImportant();

  // Scroll pour amener la semaine en cours en haut de la zone visible
  requestAnimationFrame(() => {
    const scrollEl = document.getElementById("week-scroll");
    const todayRow = scrollEl.querySelector(`[data-monday="${todayMonday.toISOString()}"]`);
    if (todayRow) scrollEl.scrollTop = todayRow.offsetTop;
    updateMonthLabel();
  });

  document.getElementById("week-scroll").addEventListener("scroll", throttle(onWeekScroll, 120));
}

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

async function mergeEventsForLoadedRange() {
  if (loadedWeeks.length === 0) return;
  await fetchEventsForRange(loadedWeeks[0], addDays(loadedWeeks[loadedWeeks.length - 1], 7));
}

function eventsOnDay(day) {
  return [...eventsById.values()].filter(
    (e) => isSameDay(new Date(e.start_at), day) && !pendingDeleteIds.has(e.id)
  );
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
        row += `
          <button class="day-cell ${isToday ? "is-today" : ""}" data-date="${day.toISOString()}">
            <span class="day-number">${day.getDate()}</span>
            ${dayEvents.length > 0 ? `<span class="day-dot">${dayEvents.some((e) => e.important) ? "⭐" : "•"}</span>` : ""}
          </button>
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
  const label = document.getElementById("month-year-label");
  if (!scrollEl || !label) return;

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
  const midWeek = addDays(monday, 3); // jeudi de la semaine = mois "dominant" (convention ISO)
  label.textContent = capitalize(midWeek.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
}

function renderUpcomingImportant() {
  const el = document.getElementById("upcoming-list");
  if (!el) return;
  const now = new Date();
  const windowEnd = addDays(now, IMPORTANT_WINDOW_DAYS);
  const important = [...eventsById.values()]
    .filter((e) => e.important && !pendingDeleteIds.has(e.id) && new Date(e.start_at) >= now && new Date(e.start_at) <= windowEnd)
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));

  if (important.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun événement important dans les 2 prochains mois.</p>`;
    return;
  }

  el.innerHTML = important
    .map((e) => {
      const date = new Date(e.start_at);
      return `
      <div class="event-item" data-id="${e.id}">
        ${e.is_birthday ? "🎂" : "⭐"}
        <span class="event-title">${escapeHtml(e.title)}</span>
        <span class="event-date">${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
      </div>
    `;
    })
    .join("");

  el.querySelectorAll(".event-item").forEach((row) => {
    row.addEventListener("click", () => {
      const event = eventsById.get(row.dataset.id);
      eventReturnTo = "day";
      openDay(new Date(event.start_at), event);
    });
  });
}

// ==========================================
// VUE 2 : détail d'une journée (grille horaire)
// ==========================================
async function openDay(day, focusEvent) {
  view = "day";
  currentDay = day;

  pushView(() => {
    view = "overview";
    renderOverview();
  });

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

  if (focusEvent) {
    setTimeout(() => {
      document.getElementById(`hour-${new Date(focusEvent.start_at).getHours()}`)?.scrollIntoView({ block: "center" });
    }, 0);
  }
}

function renderHoursGrid(day) {
  const grid = document.getElementById("hours-grid");
  if (!grid) return;

  const dayEvents = eventsOnDay(day);

  let html = "";
  for (let h = 0; h < 24; h++) {
    const hourEvents = dayEvents.filter((e) => new Date(e.start_at).getHours() === h);
    html += `
      <div class="hour-row" id="hour-${h}">
        <span class="hour-label">${String(h).padStart(2, "0")}h</span>
        <div class="hour-content">
          ${hourEvents
            .map(
              (e) => `
            <button class="hour-event" data-id="${e.id}">
              ${e.important ? "⭐ " : ""}${e.is_birthday ? "🎂 " : ""}${escapeHtml(e.title)}
            </button>
          `
            )
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
  const returnTo = eventReturnTo;

  pushView(() => {
    if (returnTo === "overview") {
      view = "overview";
      renderOverview();
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

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-previous" class="back-btn">${backLabel}</button>
      <form id="event-detail-form" class="recipe-form">
        <input id="ev-title" placeholder="Intitulé de l'événement" value="${event ? escapeHtml(event.title) : ""}" required />
        <input id="ev-date" type="date" value="${toDateInputValue(startDate)}" required />
        <input id="ev-time" type="time" value="${toTimeInputValue(startDate)}" required />
        <label><input id="ev-birthday" type="checkbox" ${event?.is_birthday ? "checked" : ""} /> 🎂 Anniversaire</label>
        <label><input id="ev-important" type="checkbox" ${event?.important ? "checked" : ""} /> ⭐ Important</label>
        <button type="submit">Enregistrer</button>
      </form>
      ${event ? `<button type="button" id="delete-event-btn" class="danger-btn">Supprimer</button>` : ""}
    </div>
  `;

  document.getElementById("back-to-previous").addEventListener("click", () => goBack());
  document.getElementById("event-detail-form").addEventListener("submit", (e) => handleSaveEvent(e, day));
  document.getElementById("delete-event-btn")?.addEventListener("click", () => handleDeleteEvent(event));
}

async function handleSaveEvent(e, day) {
  e.preventDefault();
  const title = document.getElementById("ev-title").value.trim();
  const dateVal = document.getElementById("ev-date").value;
  const timeVal = document.getElementById("ev-time").value;
  const isBirthday = document.getElementById("ev-birthday").checked;
  const important = document.getElementById("ev-important").checked;
  if (!title || !dateVal || !timeVal) return;

  const startAt = new Date(`${dateVal}T${timeVal}`);
  const payload = { title, start_at: startAt.toISOString(), is_birthday: isBirthday, important };

  if (currentEvent) {
    await supabase.from("events").update(payload).eq("id", currentEvent.id);
  } else {
    await supabase.from("events").insert({
      ...payload,
      household_id: currentHouseholdId,
      created_by: currentUserId,
    });
  }

  await mergeEventsForLoadedRange();
  goBack();
}

function handleDeleteEvent(event) {
  pendingDeleteIds.add(event.id);
  goBack();

  showUndoToast({
    message: `Événement « ${event.title} » supprimé`,
    onUndo: () => {
      pendingDeleteIds.delete(event.id);
      refreshCurrentView();
    },
    onConfirm: async () => {
      pendingDeleteIds.delete(event.id);
      await supabase.from("events").delete().eq("id", event.id);
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
