// index.js
require('dotenv').config();

// Local dev: avoid TLS verify errors from pooler/self-signed chains
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const dns = require('dns');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- ENV / DB URL ----------
const connectionString =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL;

if (!connectionString || !/^postgres(ql)?:\/\//i.test(connectionString)) {
  console.error('❌ DATABASE_URL is missing or malformed. Current value:', connectionString);
  process.exit(1);
}

// ---------- DB POOL (IPv4 DNS + SSL) ----------
dns.setServers(['1.1.1.1', '8.8.8.8']); // optional but helps on flaky networks
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // hosted PG (Supabase) requires SSL
  // Force IPv4 so we don't hit EHOSTUNREACH on IPv6-only addresses
  lookup: (hostname, options, cb) => dns.lookup(hostname, { family: 4 }, cb),
});

// ---------- MIDDLEWARE ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- HELPERS ----------
const isNonEmptyString = (s) => typeof s === 'string' && s.trim().length > 0;
// Accept any RFC4122-style UUID (v1–v5)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- ROUTES ----------

// Health
app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('select 1 as ok');
    res.json({ ok: true, db: rows[0]?.ok === 1, env: process.env.NODE_ENV || 'dev' });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: e.message });
  }
});

// List events
// GET /api/events?q=<search>&category=<category>&sort=starts_at|title
app.get('/api/events', async (req, res) => {
  try {
    const { q = '', category = '', sort = 'starts_at' } = req.query;

    const clauses = [];
    const values = [];
    let i = 1;

    if (isNonEmptyString(q)) {
      clauses.push(`title ILIKE $${i++}`);
      values.push(`%${q.trim()}%`);
    }
    if (isNonEmptyString(category)) {
      clauses.push(`category = $${i++}`);
      values.push(category.trim());
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const orderBy =
      sort === 'title'
        ? 'ORDER BY title ASC, starts_at ASC, id ASC'
        : 'ORDER BY starts_at ASC, id ASC';

    const sql = `
      SELECT id, title, starts_at, created_at, category
      FROM events
      ${where}
      ${orderBy}
    `;
    const { rows } = await pool.query(sql, values);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/events error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Create event
// POST /api/events { title, starts_at(ISO), category? }
app.post('/api/events', async (req, res) => {
  try {
    const { title, starts_at, category = 'general' } = req.body || {};

    if (!isNonEmptyString(title)) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (title.length > 200) {
      return res.status(400).json({ error: 'title too long (max 200)' });
    }

    const d = new Date(starts_at);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'starts_at must be ISO datetime' });
    }

    if (typeof category !== 'string' || category.length > 50) {
      return res.status(400).json({ error: 'category must be ≤ 50 chars' });
    }

    const { rows } = await pool.query(
      `INSERT INTO events (title, starts_at, category)
       VALUES ($1, $2, $3)
       RETURNING id, title, starts_at, created_at, category`,
      [title.trim(), d.toISOString(), (category || 'general').trim()]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('POST /api/events error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Update event (any field)
// PATCH /api/events/:id { title?, starts_at?, category? }
app.patch('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const { title, starts_at, category } = req.body || {};

    const updates = [];
    const values = [];
    let i = 1;

    if (typeof title !== 'undefined') {
      if (!isNonEmptyString(title)) {
        return res.status(400).json({ error: 'title must be non-empty string' });
      }
      if (title.length > 200) {
        return res.status(400).json({ error: 'title too long (max 200)' });
      }
      updates.push(`title = $${i++}`);
      values.push(title.trim());
    }

    if (typeof starts_at !== 'undefined') {
      const d = new Date(starts_at);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'starts_at must be ISO datetime' });
      }
      updates.push(`starts_at = $${i++}`);
      values.push(d.toISOString());
    }

    if (typeof category !== 'undefined') {
      if (!isNonEmptyString(category) || category.length > 50) {
        return res.status(400).json({ error: 'category must be 1–50 chars' });
      }
      updates.push(`category = $${i++}`);
      values.push(category.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE events
         SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING id, title, starts_at, created_at, category`,
      values
    );

    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('PATCH /api/events/:id error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Delete event
// DELETE /api/events/:id
app.delete('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const { rowCount } = await pool.query('DELETE FROM events WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('DELETE /api/events/:id error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- SPA Fallback (Express 5 safe; no "*") ----------
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`🚀 Dorado Calendar server running on http://localhost:${PORT}`);
});

