// index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const dns = require('node:dns');
dns.setDefaultResultOrder?.('ipv4first'); // prefer IPv4 if possible

const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const path = require('node:path');

// -------------------- App setup --------------------
const app = express();
app.use(cors());
app.use(express.json());

// 👉 Serve static files (UI in /public)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// -------------------- Supabase HTTPS client (port 443) --------------------
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// -------------------- Optional direct Postgres (5432) --------------------
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // Force IPv4 host resolution
    lookup: (hostname, _opts, cb) => dns.lookup(hostname, { family: 4 }, cb),
  });
}

// -------------------- Validators --------------------
const isIsoDate = (s) => {
  if (typeof s !== 'string') return false;
  const d = new Date(s);
  return !isNaN(d.getTime()) && s.includes('T') && /Z$|[+-]\d{2}:\d{2}$/.test(s);
};
const ensureEventPayload = (body) => {
  const errors = [];
  if (body.title === undefined) errors.push('title is required');
  if (body.starts_at === undefined) errors.push('starts_at is required');
  if (body.title && (typeof body.title !== 'string' || body.title.length < 1 || body.title.length > 200)) {
    errors.push('title must be 1–200 chars');
  }
  if (body.starts_at && !isIsoDate(body.starts_at)) {
    errors.push('starts_at must be ISO datetime, e.g. 2025-09-21T18:00:00Z');
  }
  return errors;
};

// -------------------- Health routes --------------------
app.get('/api/health', async (_req, res) => {
  if (!pool) return res.status(500).json({ status: 'error', error: 'DATABASE_URL not configured' });
  try {
    const r = await pool.query('SELECT NOW() AS now');
    res.json({ status: 'ok', via: 'postgres', time: r.rows[0].now });
  } catch (err) {
    console.error('Health (postgres) failed:', err.message);
    res.status(500).json({ status: 'error', via: 'postgres', error: err.message });
  }
});

app.get('/api/health-rest', async (_req, res) => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    res.json({ status: 'ok', via: 'https', hasSessionObject: !!data });
  } catch (err) {
    console.error('Health (https) failed:', err.message);
    res.status(500).json({ status: 'error', via: 'https', error: err.message });
  }
});

// -------------------- Events CRUD (via supabase-js) --------------------

// List events with limit and optional date filters
app.get('/api/events', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
    const from = req.query.from;
    const to = req.query.to;

    let q = supabase.from('events').select('*').order('starts_at', { ascending: true }).limit(limit);

    if (from) {
      if (!isIsoDate(from)) return res.status(400).json({ error: 'from must be ISO datetime' });
      q = q.gte('starts_at', from);
    }
    if (to) {
      if (!isIsoDate(to)) return res.status(400).json({ error: 'to must be ISO datetime' });
      q = q.lte('starts_at', to);
    }

    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create event
app.post('/api/events', async (req, res) => {
  try {
    const errors = ensureEventPayload(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const { title, starts_at } = req.body;
    const { data, error } = await supabase
      .from('events')
      .insert([{ title, starts_at }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update event
app.patch('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const patch = {};

    if ('title' in req.body) {
      if (typeof req.body.title !== 'string' || req.body.title.length < 1 || req.body.title.length > 200) {
        return res.status(400).json({ error: 'title must be 1–200 chars' });
      }
      patch.title = req.body.title;
    }

    if ('starts_at' in req.body) {
      if (!isIsoDate(req.body.starts_at)) {
        return res.status(400).json({ error: 'starts_at must be ISO datetime, e.g. 2025-09-21T18:00:00Z' });
      }
      patch.starts_at = req.body.starts_at;
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' });

    const { data, error } = await supabase
      .from('events')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete event
app.delete('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) throw error;
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------- Root & server --------------------
app.get('/', (_req, res) => {
  res.json({
    service: 'dorado-calendar',
    endpoints: ['/api/health', '/api/health-rest', '/api/events'],
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down...`);
  try {
    server.close();
    if (pool) await pool.end();
  } catch (e) {
    console.error('Shutdown error:', e.message);
  } finally {
    process.exit(0);
  }
};
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => shutdown(sig)));

