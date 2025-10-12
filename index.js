const express = require('express');
const path = require('path');

const app = express();

// log every request so we can see what's happening
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

// parse JSON for API
app.use(express.json());

// serve static files from /public with no-cache (avoid stale assets)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store');
  }
}));

// In-memory events store (simple)
let events = [];

// API: list events
app.get('/events', (req, res) => {
  res.json(events);
});

// API: create event
app.post('/events', (req, res) => {
  const { title, start, end, category, repeat } = req.body || {};
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const ev = { id, title, start, end, category, repeat: repeat || { type: 'none' } };
  events.push(ev);
  res.json(ev);
});

// API: update by id
app.put('/events/:id', (req, res) => {
  const { id } = req.params;
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  events[idx] = { ...events[idx], ...req.body };
  res.json(events[idx]);
});

// API: delete by id
app.delete('/events/:id', (req, res) => {
  const { id } = req.params;
  const before = events.length;
  events = events.filter(e => e.id !== id);
  res.json({ ok: true, deleted: before - events.length });
});

// API: delete ALL
app.delete('/events', (req, res) => {
  const n = events.length;
  events.length = 0;
  res.json({ ok: true, cleared: n });
});

// Fallback: serve index.html for "/"
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// (Optional) Fallback for unknown routes to avoid blank responses:
app.use((req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Dorado Calendar running at http://localhost:${PORT}`);
});
