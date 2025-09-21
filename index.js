// index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const dns = require('node:dns');
dns.setDefaultResultOrder?.('ipv4first'); // prefer IPv4

const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// -------------------- App setup --------------------
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -------------------- Supabase HTTPS client --------------------
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// -------------------- Postgres Pool (direct) --------------------
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    lookup: (hostname, _opts, cb) => dns.lookup(hostname, { family: 4 }, cb),
  });
}

// -------------------- Routes --------------------

// Direct Postgres health check
app.get('/api/health', async (_req, res) => {
  if (!pool) {
    return res.status(500).json({ status: 'error', error: 'DATABASE_URL not configured' });
  }
  try {
    const r = await pool.query('SELECT NOW() AS now');
    res.json({ status: 'ok', via: 'postgres', time: r.rows[0].now });
  } catch (err) {
    console.error('Health (postgres) failed:', err.message);
    res.status(500).json({ status: 'error', via: 'postgres', error: err.message });
  }
});

// HTTPS health check via Supabase client
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

// -------------------- Events CRUD --------------------

// List events
app.get('/api/events', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('starts_at', { ascending: true })
      .limit(Number(req.query.limit || 100));
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create event
app.post('/api/events', async (req, res) => {
  try {
    const { title, starts_at } = req.body || {};
    if (!title || !starts_at) {
      return res.status(400).json({ error: 'title and starts_at are required' });
    }
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
    if (req.body.title !== undefined) patch.title = req.body.title;
    if (req.body.starts_at !== undefined) patch.starts_at = req.body.starts_at;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
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

// Root route
app.get('/', (_req, res) => {
  res.json({
    service: 'dorado-calendar',
    endpoints: ['/api/health', '/api/health-rest', '/api/events'],
  });
});

// -------------------- Start server --------------------
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// -------------------- Graceful shutdown --------------------
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

