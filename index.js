// ===== Dorado Calendar minimal backend (file-based) =====
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "events.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
}
ensureStore();

function readEvents() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); }
  catch { return []; }
}
function writeEvents(arr) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

// GET all events
app.get("/events", (req, res) => res.json(readEvents()));

// POST new event { title, date, category }
app.post("/events", (req, res) => {
  const { title, date, category } = req.body || {};
  if (!title || !date || !category) {
    return res.status(400).json({ error: "Missing title, date, or category" });
  }
  const ev = {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 8),
    title, date, category
  };
  const events = readEvents();
  events.push(ev);
  writeEvents(events);
  res.status(201).json(ev);
});

// PUT update event by id { title?, date?, category? }
app.put("/events/:id", (req, res) => {
  const id = String(req.params.id);
  const { title, date, category } = req.body || {};
  const events = readEvents();
  const idx = events.findIndex(e => String(e.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const cur = events[idx];
  events[idx] = {
    ...cur,
    title: title ?? cur.title,
    date: date ?? cur.date,
    category: category ?? cur.category,
  };
  writeEvents(events);
  res.json(events[idx]);
});

// DELETE
app.delete("/events/:id", (req, res) => {
  const id = String(req.params.id);
  const events = readEvents();
  const idx = events.findIndex(e => String(e.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const [deleted] = events.splice(idx, 1);
  writeEvents(events);
  res.json({ ok: true, deleted });
});

app.listen(PORT, () => {
  console.log(`🚀 Dorado Calendar server running on http://localhost:${PORT}`);
});

