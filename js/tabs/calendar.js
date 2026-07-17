import { supabase } from "../supabase-client.js";
import { subscribeToTable } from "../sync.js";
import { markTabSeen } from "../badges.js";
import { navigateTo } from "../router.js";

let unsubscribe = null;
let events = [];
let currentHouseholdId = null;
let currentUserId = null;

export async function mount(container, ctx) {
  currentHouseholdId = ctx.householdId;
  currentUserId = ctx.userId;

  container.innerHTML = `
    <div class="tab-calendar">
      <button class="home-btn" id="home-btn-calendar">🏠 Accueil</button>
      <form id="event-form" class="add-form">
        <input id="e-title" placeholder="Titre de l'événement" required />
        <input id="e-start" type="datetime-local" required />
        <label><input id="e-birthday" type="checkbox" /> Anniversaire (récurrent)</label>
        <button type="submit">Ajouter</button>
      </form>
      <div id="event-list"></div>
    </div>
  `;

  document.getElementById("home-btn-calendar").addEventListener("click", () => navigateTo("home"));
  document.getElementById("event-form").addEventListener("submit", handleAdd);

  await loadEvents();
  await markTabSeen(currentUserId, "calendar");

  unsubscribe = subscribeToTable("events", currentHouseholdId, loadEvents);
}

export function unmount() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
}

async function loadEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("household_id", currentHouseholdId)
    .order("start_at", { ascending: true });
  if (error) return console.error(error);
  events = data;
  render();
}

async function handleAdd(e) {
  e.preventDefault();
  const payload = {
    household_id: currentHouseholdId,
    title: document.getElementById("e-title").value.trim(),
    start_at: new Date(document.getElementById("e-start").value).toISOString(),
    is_birthday: document.getElementById("e-birthday").checked,
    created_by: currentUserId,
  };
  const { error } = await supabase.from("events").insert(payload);
  if (error) return alert("Erreur: " + error.message);
  e.target.reset();
}

function render() {
  const listEl = document.getElementById("event-list");
  if (!listEl) return;
  const now = new Date();

  listEl.innerHTML = events
    .map((ev) => {
      const date = new Date(ev.start_at);
      const isPast = date < now;
      return `
      <div class="event-item ${isPast ? "past" : ""}">
        ${ev.is_birthday ? "🎂" : "📅"}
        <span class="event-title">${ev.title}</span>
        <span class="event-date">${date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>
      </div>
    `;
    })
    .join("");
}
