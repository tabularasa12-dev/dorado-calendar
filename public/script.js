// public/script.js

const els = {
  form: document.getElementById('eventForm'),
  title: document.getElementById('title'),
  startsAt: document.getElementById('starts_at'),
  category: document.getElementById('category'),
  addBtn: document.getElementById('addBtn'),
  status: document.getElementById('status'),
  list: document.getElementById('events'),
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  filterCategory: document.getElementById('filterCategory'),
};

function setStatus(msg, ok = false) {
  els.status.textContent = msg || '';
  els.status.className = 'status ' + (msg ? (ok ? 'ok' : 'err') : '');
}

function setLoading(isLoading, msg = 'Loading…') {
  els.addBtn.disabled = isLoading;
  if (isLoading) {
    els.addBtn.textContent = '…';
    setStatus(msg);
  } else {
    els.addBtn.textContent = 'Add';
    setStatus('');
  }
}

function toLocalReadable(iso) {
  try {
    const d = new Date(iso);
    // e.g., "Thu, Sep 25, 6:00 PM"
    return d.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    throw new Error((data && data.error) || `HTTP ${r.status}`);
  }
  return data;
}

async function loadEvents() {
  const params = new URLSearchParams();
  const q = els.search.value.trim();
  const sort = els.sort.value;
  const cat = els.filterCategory.value.trim();

  if (q) params.set('q', q);
  if (sort) params.set('sort', sort);
  if (cat) params.set('category', cat);

  els.list.innerHTML = '';
  setStatus('Loading events…');

  try {
    const events = await api('GET', `/api/events?${params.toString()}`);
    renderEvents(events);
    if (events.length === 0) {
      els.list.innerHTML = `<li class="empty">No events found.</li>`;
    }
    setStatus('');
  } catch (e) {
    setStatus(e.message || 'Failed to load', false);
  }
}

function renderEvents(events) {
  const frag = document.createDocumentFragment();

  events.forEach(ev => {
    const li = document.createElement('li');
    li.className = 'event';
    li.dataset.id = ev.id;

    const left = document.createElement('div');
    left.innerHTML = `
      <div><strong>${escapeHtml(ev.title)}</strong>
        <span class="chip">${escapeHtml(ev.category || 'general')}</span>
      </div>
      <div class="meta">${toLocalReadable(ev.starts_at)}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-warn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => handleEdit(ev));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this event?')) return;
      try {
        await api('DELETE', `/api/events/${ev.id}`);
        setStatus('Event deleted', true);
        loadEvents();
      } catch (e) {
        setStatus(e.message || 'Delete failed');
      }
    });

    actions.append(editBtn, delBtn);
    li.append(left, actions);
    frag.appendChild(li);
  });

  els.list.innerHTML = '';
  els.list.appendChild(frag);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// -------- Add Event --------
els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = els.title.value.trim();
  const raw = els.startsAt.value;             // "YYYY-MM-DDTHH:mm" (local)
  const category = (els.category.value.trim() || 'general');

  if (!title || !raw) return setStatus('Title and start time are required');

  // Convert local datetime-local value to ISO (UTC)
  const iso = new Date(raw).toISOString();

  try {
    setLoading(true, 'Adding…');
    await api('POST', '/api/events', { title, starts_at: iso, category });
    els.form.reset();
    setStatus('Event added', true);
    loadEvents();
  } catch (e2) {
    setStatus(e2.message || 'Create failed');
  } finally {
    setLoading(false);
  }
});

// -------- Edit Event (prompt-based) --------
async function handleEdit(ev) {
  // Title
  const newTitle = prompt('New title (leave blank to keep):', ev.title ?? '') ?? ev.title;
  // Start time (accept e.g. "2025-10-12 18:30" or leave blank)
  const newStartsRaw = prompt('New start datetime (YYYY-MM-DD HH:MM, blank to keep):', '') || '';
  // Category
  const newCategory = prompt('New category (blank to keep):', ev.category || 'general') ?? ev.category;

  const payload = {};

  if (newTitle && newTitle !== ev.title) payload.title = newTitle;

  if (newStartsRaw.trim() !== '') {
    const candidate = new Date(newStartsRaw.replace(' ', 'T'));
    if (Number.isNaN(candidate.getTime())) {
      return setStatus('Invalid date/time; not updated');
    }
    payload.starts_at = candidate.toISOString();
  }

  if (newCategory && newCategory !== ev.category) payload.category = newCategory;

  if (Object.keys(payload).length === 0) {
    return setStatus('Nothing changed');
  }

  try {
    setStatus('Updating…');
    await api('PATCH', `/api/events/${ev.id}`, payload);
    setStatus('Event updated', true);
    loadEvents();
  } catch (e) {
    setStatus(e.message || 'Update failed');
  }
}

// -------- Filters: live update --------
let searchDebounce = null;
els.search.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadEvents, 250);
});
els.sort.addEventListener('change', loadEvents);
els.filterCategory.addEventListener('change', loadEvents);

// Initial load
loadEvents();

