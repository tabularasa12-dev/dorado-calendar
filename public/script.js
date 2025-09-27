// public/script.js

const els = {
  form: document.getElementById('eventForm'),
  title: document.getElementById('title'),
  startsAt: document.getElementById('starts_at'),
  category: document.getElementById('category'),
  addBtn: document.getElementById('addBtn'),
  list: document.getElementById('events'),
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  filterCategory: document.getElementById('filterCategory'),
  toast: document.getElementById('toast'),
};

// ---- UI helpers ----
function toast(msg, ok = true, ms = 2000) {
  const t = els.toast;
  t.textContent = msg;
  t.style.background = ok ? '#16a34a' : '#dc2626';
  t.style.display = 'block';
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => (t.style.display = 'none'), ms);
}

function toLocalReadable(iso) {
  try {
    const d = new Date(iso);
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

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---- API helper ----
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data;
}

// ---- Load / render ----
async function loadEvents() {
  const params = new URLSearchParams();
  const q = els.search.value.trim();
  const sort = els.sort.value;
  const cat = els.filterCategory.value.trim();

  if (q) params.set('q', q);
  if (sort) params.set('sort', sort);
  if (cat) params.set('category', cat);

  els.list.innerHTML = `<li class="empty"><span class="spinner"></span> Loading events…</li>`;

  try {
    const events = await api('GET', `/api/events?${params.toString()}`);
    renderEvents(events);
    refreshCategoryFilter(events);
    if (events.length === 0) {
      els.list.innerHTML = `<li class="empty">No events found.</li>`;
    }
  } catch (e) {
    els.list.innerHTML = `<li class="empty">Failed to load: ${escapeHtml(e.message || 'error')}</li>`;
  }
}

function renderEvents(events) {
  const frag = document.createDocumentFragment();

  events.forEach(ev => {
    const li = document.createElement('li');
    li.className = 'event';
    li.dataset.id = ev.id;

    const left = document.createElement('div');
    const catClass = (ev.category || 'general').toLowerCase();
    left.innerHTML = `
      <div><strong>${escapeHtml(ev.title)}</strong>
        <span class="chip ${escapeHtml(catClass)}">${escapeHtml(ev.category || 'general')}</span>
      </div>
      <div class="meta">${toLocalReadable(ev.starts_at)}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-warn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openInlineEditor(ev));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this event?')) return;
      try {
        await api('DELETE', `/api/events/${ev.id}`);
        toast('Event deleted');
        loadEvents();
      } catch (e) {
        toast(e.message || 'Delete failed', false);
      }
    });

    actions.append(editBtn, delBtn);
    li.append(left, actions);
    frag.appendChild(li);
  });

  els.list.innerHTML = '';
  els.list.appendChild(frag);
}

function refreshCategoryFilter(events) {
  const sel = els.filterCategory;
  const current = sel.value;
  const cats = Array.from(new Set(events.map(e => (e.category || 'general')))).sort();
  sel.innerHTML = `<option value="">All categories</option>` + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

// ---- Inline editor ----
function openInlineEditor(ev) {
  const li = document.querySelector(`li[data-id="${ev.id}"]`);
  if (!li) return;

  const isoValue = new Date(ev.starts_at).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"

  li.innerHTML = `
    <form class="editForm">
      <input name="title" value="${escapeHtml(ev.title)}" required />
      <input type="datetime-local" name="starts_at" value="${isoValue}" required />
      <input name="category" value="${escapeHtml(ev.category || 'general')}" />
      <button type="submit">Save</button>
      <button type="button" class="btn-secondary cancelBtn">Cancel</button>
    </form>
  `;

  const form = li.querySelector('.editForm');
  const cancelBtn = li.querySelector('.cancelBtn');

  cancelBtn.addEventListener('click', () => loadEvents());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    const starts = form.starts_at.value;
    const category = form.category.value.trim() || 'general';

    if (!title || !starts) {
      toast('Title & time required', false);
      return;
    }

    const iso = new Date(starts).toISOString();

    try {
      await api('PATCH', `/api/events/${ev.id}`, { title, starts_at: iso, category });
      toast('Event updated');
      loadEvents();
    } catch (err) {
      toast(err.message || 'Update failed', false);
    }
  });
}

// ---- Create ----
els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = els.title.value.trim();
  const raw = els.startsAt.value;
  const category = (els.category.value.trim() || 'general');

  if (!title || !raw) {
    toast('Title and start time are required', false);
    return;
  }

  const iso = new Date(raw).toISOString();

  try {
    els.addBtn.disabled = true;
    els.addBtn.textContent = '…';
    await api('POST', '/api/events', { title, starts_at: iso, category });
    els.form.reset();
    toast('Event added');
    loadEvents();
  } catch (e2) {
    toast(e2.message || 'Create failed', false);
  } finally {
    els.addBtn.disabled = false;
    els.addBtn.textContent = 'Add';
  }
});

// ---- Filters ----
let searchDebounce = null;
els.search.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadEvents, 250);
});
els.sort.addEventListener('change', loadEvents);
els.filterCategory.addEventListener('change', loadEvents);

// Initial load
loadEvents();

