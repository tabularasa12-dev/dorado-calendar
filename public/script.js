// ===== Dorado Calendar Script (sorted, filter, edit) =====

function normalizeCategory(c) {
  const x = String(c || "").toLowerCase().trim();
  if (["activities","activity","work","job","internship"].includes(x)) return "activities";
  if (["personal","life","home"].includes(x)) return "personal";
  if (["school","class","academic"].includes(x)) return "school";
  return "personal";
}

function formatDateISO(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

function sortByDateAsc(arr) {
  return [...arr].sort((a,b) => new Date(a.date) - new Date(b.date));
}

function isUpcoming(iso) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const d = new Date(iso);
  return d >= today;
}

let BASE = "/events";
let FILTER_MODE = "upcoming"; // "upcoming" | "all"

async function fetchAll() {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(`GET ${BASE} -> ${res.status}`);
  return await res.json();
}

function eventRow(ev) {
  const cat = normalizeCategory(ev.category);
  const div = document.createElement("div");
  div.classList.add("event", `category-${cat}`);
  div.dataset.id = ev.id;

  div.innerHTML = `
    <span class="event-text">${ev.title} — ${formatDateISO(ev.date)}</span>
    <div class="actions">
      <button class="edit-btn" data-id="${ev.id}">Edit</button>
      <button class="delete-btn" data-id="${ev.id}">Delete</button>
    </div>
  `;
  return div;
}

async function render() {
  const list = document.getElementById("events");
  const empty = document.getElementById("no-events");
  list.innerHTML = "<p>Loading events...</p>";

  try {
    let events = await fetchAll();
    // filter
    if (FILTER_MODE === "upcoming") events = events.filter(e => isUpcoming(e.date));
    // sort
    events = sortByDateAsc(events);

    list.innerHTML = "";
    if (!events.length) {
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";

    events.forEach(ev => list.appendChild(eventRow(ev)));
  } catch (e) {
    console.error(e);
    list.innerHTML = `<p>Error loading events.</p>`;
  }
}

// Add new
document.getElementById("event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("title").value.trim();
  const date = document.getElementById("date").value.trim();
  const category = document.getElementById("category").value.trim();
  if (!title || !date || !category) return alert("Please fill all fields.");

  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, date, category }),
  });
  if (!res.ok) { alert("Failed to add."); return; }
  e.target.reset();
  render();
});

// Delete / Edit handlers
document.getElementById("events").addEventListener("click", async (e) => {
  // Delete
  if (e.target.classList.contains("delete-btn")) {
    const id = e.target.dataset.id;
    if (!confirm("Delete this event?")) return;
    const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) return alert("Failed to delete.");
    render();
    return;
  }

  // Edit (inline)
  if (e.target.classList.contains("edit-btn")) {
    const id = e.target.dataset.id;
    const row = e.target.closest(".event");
    const textSpan = row.querySelector(".event-text");

    // Build inline editor
    const [titlePart, datePart] = textSpan.textContent.split(" — ");
    const currentTitle = titlePart ?? "";
    const currentDateISO = row.dataset.date || ""; // not stored; we’ll re-fetch value
    // Quick way: fetch existing via GET list and find it
    let events = await fetchAll();
    const cur = events.find(x => String(x.id) === String(id));
    if (!cur) return alert("Could not load event for edit.");

    const editor = document.createElement("div");
    editor.style.display = "flex";
    editor.style.gap = "6px";
    editor.innerHTML = `
      <input type="text" class="edit-title" value="${cur.title}" />
      <input type="date" class="edit-date" value="${cur.date}" />
      <select class="edit-category">
        <option value="School" ${cur.category==="School"?"selected":""}>School</option>
        <option value="Activities" ${cur.category==="Activities"?"selected":""}>Activities</option>
        <option value="Personal" ${cur.category==="Personal"?"selected":""}>Personal</option>
      </select>
      <button class="save-btn">Save</button>
      <button class="cancel-btn">Cancel</button>
    `;

    // Swap UI
    const actions = row.querySelector(".actions");
    textSpan.style.display = "none";
    actions.style.display = "none";
    row.appendChild(editor);

    // Wire save/cancel
    editor.querySelector(".cancel-btn").addEventListener("click", () => {
      editor.remove();
      textSpan.style.display = "";
      actions.style.display = "";
    });

    editor.querySelector(".save-btn").addEventListener("click", async () => {
      const newTitle = editor.querySelector(".edit-title").value.trim();
      const newDate = editor.querySelector(".edit-date").value.trim();
      const newCat = editor.querySelector(".edit-category").value.trim();
      if (!newTitle || !newDate || !newCat) return alert("Fill all fields.");

      const res = await fetch(`${BASE}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, date: newDate, category: newCat }),
      });
      if (!res.ok) return alert("Failed to save changes.");
      render();
    });
  }
});

// Filter toggle
document.getElementById("toggle-filter").addEventListener("click", () => {
  FILTER_MODE = (FILTER_MODE === "upcoming") ? "all" : "upcoming";
  const btn = document.getElementById("toggle-filter");
  btn.dataset.mode = FILTER_MODE;
  btn.textContent = `Showing: ${FILTER_MODE === "upcoming" ? "Upcoming" : "All"}`;
  render();
});

// Initial
document.addEventListener("DOMContentLoaded", () => {
  render();
});

