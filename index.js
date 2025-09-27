// index.js
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const rateLimit = require('express-rate-limit');
const dns = require('dns');

// Local dev only: avoid self-signed cert errors from Supabase pooler
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not configured');
  process.exit(1);
}

// Optional but helps on some networks: prefer known resolvers
dns.setServers(['1.1.1.1', '8.8.8.8']);

// ---- DB pool (SSL + IPv4 lookup) ----
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Force IPv4 to avoid EHOSTUNREACH when a v6 address is returned
  lookup: (hostname, options, cb) => dns.lookup(hostname, { family: 4 }, cb),
});

// ---- Middleware ----
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/api/',
  rateLimit({
    windowMs: 60_000,
    max: 100,
  })
);

// ---- Health ----
app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, db: rows.length > 0, env: process.env.NODE_ENV || 'dev' });
  } catch (e) {
    res.json({ ok: false, db: false, error: e.message });
  }
});

// ---- Helpers ----
const isNonEmptyString = (s) => typeof s === 'string' && s.trim().length > 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Events API ----

// List
app.get('/api/events', async (req, res) => {
  try {
    const { q, sort, category } = req.query;
    const where = [];
    const values = [];
    let i = 1;

    if (q) { where.push(`title ILIKE $${i++}`); values.push(`%${q}%`); }
    if (category) { where.push(`category = $${i++}`); values.push(category); }

    let sql = `SELECT id, title, starts_at, created_at, category, description, repeat FROM events`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += sort === 'title' ? ' ORDER BY title ASC, starts_at ASC' : ' ORDER BY starts_at ASC, id ASC';

    const { rows } = await pool.query(sql, values);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/events error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Create
app.post('/api/events', async (req, res) => {
  try {
    const { title, starts_at, category = 'general', description = '', repeat = 'none' } = req.body || {};

    if (!isNonEmptyString(title)) return res.status(400).json({ error: 'title is required' });
    if (title.length > 200) return res.status(400).json({ error: 'title too long (max 200)' });

    const d = new Date(starts_at);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'starts_at must be ISO datetime' });

    if (typeof category !== 'string' || category.length > 50)
      return res.status(400).json({ error: 'category must be a string ≤ 50 chars' });

    if (typeof description !== 'string' || description.length > 1000)
      return res.status(400).json({ error: 'description must be ≤ 1000 chars' });

    const allowedRepeats = new Set(['none', 'daily', 'weekly', 'monthly']);
    if (typeof repeat !== 'string' || !allowedRepeats.has(repeat))
      return res.status(400).json({ error: "repeat must be one of: 'none','daily','weekly','monthly'" });

    const { rows } = await pool.query(
      `INSERT INTO events (title, starts_at, category, description, repeat)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, starts_at, created_at, category, description, repeat`,
      [title.trim(), d.toISOString(), category.trim(), description.trim(), repeat]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('POST /api/events error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Update
app.patch('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid id' });

    const { title, starts_at, category, description, repeat } = req.body || {};

    const updates = [];
    const values = [];
    let i = 1;

    if (typeof title !== 'undefined') {
      if (!isNonEmptyString(title)) return res.status(400).json({ error: 'title must be non-empty string' });
      if (title.length > 200) return res.status(400).json({ error: 'title too long (max 200)' });
      updates.push(`title = $${i++}`); values.push(title.trim());
    }

    if (typeof starts_at !== 'undefined') {
      const d = new Date(starts_at);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'starts_at must be ISO datetime' });
      updates.push(`starts_at = $${i++}`); values.push(d.toISOString());
    }

    if (typeof category !== 'undefined') {
      if (!isNonEmptyString(category) || category.length > 50)
        return res.status(400).json({ error: 'category must be 1–50 chars' });
      updates.push(`category = $${i++}`); values.push(category.trim());
    }

    if (typeof description !== 'undefined') {
      if (typeof description !== 'string' || description.length > 1000)
        return res.status(400).json({ error: 'description must be ≤ 1000 chars' });
      updates.push(`description = $${i++}`); values.push(description.trim());
    }

    if (typeof repeat !== 'undefined') {
      const allowedRepeats = new Set(['none', 'daily', 'weekly', 'monthly']);
      if (typeof repeat !== 'string' || !allowedRepeats.has(repeat))
        return res.status(400).json({ error: "repeat must be one of: 'none','daily','weekly','monthly'" });
      updates.push(`repeat = $${i++}`); values.push(repeat);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'no fields to update' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE events SET ${updates.join(', ')} WHERE id = $${i}
       RETURNING id, title, starts_at, created_at, category, description, repeat`,
      values
    );

    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('PATCH /api/events/:id error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Delete
app.delete('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid id' });

    const { rowCount } = await pool.query('DELETE FROM events WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('DELETE /api/events/:id error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Fallback to SPA
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Dorado Calendar server running on http://localhost:${PORT}`);
});

