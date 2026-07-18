import { supabase } from "../supabase-client.js";
import { subscribeToTable } from "../sync.js";
import { markTabSeen } from "../badges.js";
import { goHome, pushView, goBack } from "../router.js";
import { showUndoToast } from "../utils/toast.js";
import { escapeHtml } from "../utils/format.js";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const WEEKS_VISIBLE = 4;
const IMPORTANT_WINDOW_DAYS = 60;

let unsubscribe = null;
let events = []; // fenêtre chargée : du lundi de cette semaine à +60 jours
let view = "overview"; // "overview" | "day" | "event-detail"
let currentDay = null;
let currentEvent = null;
let containerRef = null;
let currentHouseholdId = null;
let currentUserId = null;
let pendingDeleteIds = new Set();

export async function mount(container, ctx) {
  containerRef = container;
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;
  view = "overview";

  await markTabSeen(currentUserId, "calendar");
  await renderOverview();

  unsubscribe = subscribeToTable("events", currentHouseholdId, async () => {
    if (view === "overview") await loadEvents();
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

// ==========================================
// VUE 1 : semaines glissantes + événements importants à venir
// ==========================================
async function renderOverview() {
  containerRef.innerHTML = `
    <div class="tab-calendar">
      <button class="home-btn" id="home-btn-calendar">🏠 Accueil</button>
      <div class="week-headers">
        ${WEEKDAY_LABELS.map((d) => `<span>${d}</span>`).join("")}
      </div>
      <div id="week-grid" class="week-grid"></div>
      <h3 class="upcoming-title">⭐ Événements importants à venir</h3>
      <div id="upcoming-list"></div>
    </div>
  `;

  document.getElementById("home-btn-calendar").addEventListener("click", () => goHome());

  await loadEvents();
}

async function loadEvents() {
  const monday = getMonday(new Date());
  const calendarEnd = addDays(monday, WEEKS_VISIBLE * 7);
  const importantEnd = addDays(new Date(), IMPORTANT_WINDOW_DAYS);
  const fetchEnd = calendarEnd > importantEnd ? calendarEnd : importantEnd;

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("household_id", currentHouseholdId)
    .gte("start_at", monday.toISOString())
    .lte("start_at", fetchEnd.toISOString())
    .order("start_at", { ascending: true });

  if (error) return console.error(error);
  events = data;
  renderWeekGrid(monday);
  renderUpcomingImportant();
}

function renderWeekGrid(monday) {
  const grid = document.getElementById("week-grid");
  if (!grid) return;
  const today = new Date();

  let html = "";
  for (let w = 0; w < WEEKS_VISIBLE; w++) {
    const weekStart = addDays(monday, w * 7);
    html += `<div class="week-row">`;
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const dayEvents = events.filter((e) => isSameDay(new Date(e.start_at), day) && !pendingDeleteIds.has(e.id));
      const isToday = isSameDay(day, today);
      html += `
        <button class="day-cell ${isToday ? "is-today" : ""}" data-date="${day.toISOString()}">
          <span class="day-number">${day.getDate()}</span>
          ${dayEvents.length > 0 ? `<span class="day-dot">${dayEvents.some((e) => e.important) ? "⭐" : "•"}</span>` : ""}
        </button>
      `;
    }
    html += `</div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".day-cell").forEach((el) => {
    el.addEventListener("click", () => openDay(new Date(el.dataset.date)));
  });
}

function renderUpcomingImportant() {
  const el = document.getElementById("upcoming-list");
  if (!el) return;
  const now = new Date();
  const important = events
    .filter((e) => e.important && !pendingDeleteIds.has(e.id) && new Date(e.start_at) >= now)
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
      const event = events.find((e) => e.id === row.dataset.id);
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
      <h2 class="list-detail-title">${label.charAt(0).toUpperCase() + label.slice(1)}</h2>
      <button id="add-event-btn">+ Ajouter un événement</button>
      <div id="hours-grid" class="hours-grid"></div>
    </div>
  `;

  document.getElementById("back-to-overview").addEventListener("click", () => goBack());
  document.getElementById("add-event-btn").addEventListener("click", () => openEventDetail(null, day));

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

  const dayEvents = events.filter((e) => isSameDay(new Date(e.start_at), day) && !pendingDeleteIds.has(e.id));

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
      const event = events.find((e) => e.id === el.dataset.id);
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

  pushView(() => {
    view = "day";
    renderHoursGrid(currentDay);
  });

  const startDate = event ? new Date(event.start_at) : new Date(day);
  if (!event) startDate.setHours(9, 0, 0, 0);

  containerRef.innerHTML = `
    <div class="list-detail">
      <button id="back-to-day" class="back-btn">‹ ${day.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</button>
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

  document.getElementById("back-to-day").addEventListener("click", () => goBack());
  document.getElementById("event-detail-form").addEventListener("submit", handleSaveEvent);
  document.getElementById("delete-event-btn")?.addEventListener("click", () => handleDeleteEvent(event));
}

async function handleSaveEvent(e) {
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

  await loadEvents();
  goBack();
}

function handleDeleteEvent(event) {
  pendingDeleteIds.add(event.id);
  goBack();

  showUndoToast({
    message: `Événement « ${event.title} » supprimé`,
    onUndo: async () => {
      pendingDeleteIds.delete(event.id);
      await loadEvents();
    },
    onConfirm: async () => {
      pendingDeleteIds.delete(event.id);
      await supabase.from("events").delete().eq("id", event.id);
      await loadEvents();
    },
  });
}
