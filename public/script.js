// script.js

async function loadEvents() {
  const q = document.getElementById('search').value.trim();
  const category = document.getElementById('filterCategory').value;
  const params = new URLSearchParams();
  if (q) params.append('q', q);
  if (category) params.append('category', category);

  const r = await fetch('/api/events?' + params.toString());
  const events = await r.json().catch(() => []);
  const list = document.getElementById('events');
  list.innerHTML = '';

  if (!Array.isArray(events) || events.length === 0) {
    list.innerHTML = `<li class="text-gray-500">No events found</li>`;
    return;
  }

  // Build category filter dynamically
  const filterSelect = document.getElementById('filterCategory');
  const cats = Array.from(new Set(events.map(ev => ev.category || 'general')));
  filterSelect.innerHTML = `<option value="">All categories</option>` +
    cats.map(c => `<option value="${c}">${c}</option>`).join('');

  events.forEach(ev => {
    const li = document.createElement('li');
    li.className = "flex justify-between items-start bg-white p-3 rounded shadow";

    li.innerHTML = `
      <div>
        <strong>${ev.title}</strong>
        <span class="text-gray-500">[${ev.category || 'general'}]</span>
        — ${new Date(ev.starts_at).toLocaleString()}
        ${ev.repeat && ev.repeat !== 'none' ? `<span class="ml-2 text-sm bg-purple-200 text-purple-800 px-2 py-0.5 rounded">${ev.repeat}</span>` : ''}
        ${ev.description ? `<div class="text-gray-700 text-sm mt-1">${ev.description}</div>` : ''}
      </div>
      <div class="space-x-2">
        <button class="bg-amber-600 text-white px-2 py-1 rounded"
          onclick="editEvent('${ev.id}', ${JSON.stringify(ev)})">
          Edit
        </button>
        <button class="bg-red-600 text-white px-2 py-1 rounded"
          onclick="if (confirm('Delete this event?')) deleteEvent('${ev.id}')">
          Delete
        </button>
      </div>
    `;

    list.appendChild(li);
  });
}

// Add Event
document.getElementById('eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const raw = document.getElementById('starts_at').value;
  const category = document.getElementById('category').value.trim() || 'general';
  const description = document.getElementById('description').value.trim();
  const repeat = document.getElementById('repeat').value;

  if (!title || !raw) return showToast('Title and start time are required', false);

  const iso = new Date(raw).toISOString();

  const r = await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, starts_at: iso, category, description, repeat })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return showToast(body.error || 'Create failed', false);
  e.target.reset();
  showToast('Event added', true);
  loadEvents();
});

// Edit Event
async function editEvent(id, ev) {
  const title = prompt('New title (blank=keep)', ev.title || '') ?? ev.title;
  const startsRaw = prompt('New start datetime (YYYY-MM-DD HH:MM, blank=keep)', '') || '';
  const category = prompt('New category (blank=keep)', ev.category || 'general') ?? ev.category;
  const description = prompt('New description (blank=keep)', ev.description || '') ?? ev.description;
  const repeat = prompt('New repeat (none/daily/weekly/monthly, blank=keep)', ev.repeat || 'none') ?? ev.repeat;

  const payload = {};
  if (title && title !== ev.title) payload.title = title;
  if (startsRaw.trim() !== '') {
    const candidate = new Date(startsRaw.replace(' ', 'T'));
    if (Number.isNaN(candidate.getTime())) return showToast('Invalid date/time; not updated', false);
    payload.starts_at = candidate.toISOString();
  }
  if (category && category !== ev.category) payload.category = category;
  if (description && description !== ev.description) payload.description = description;
  if (repeat && repeat !== ev.repeat) payload.repeat = repeat;

  if (Object.keys(payload).length === 0) return showToast('Nothing changed', false);

  const r = await fetch('/api/events/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return showToast(body.error || 'Update failed', false);
  showToast('Event updated', true);
  loadEvents();
}

// Delete Event
async function deleteEvent(id) {
  const r = await fetch('/api/events/' + id, { method: 'DELETE' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return showToast(body.error || 'Delete failed', false);
  showToast('Event deleted', true);
  loadEvents();
}

// Toast notifications
function showToast(msg, success = true) {
  const container = document.getElementById('toast-container');
  const div = document.createElement('div');
  div.className = `px-4 py-2 rounded shadow text-white ${success ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  container.appendChild(div);
  setTimeout(() => div.remove(), success ? 2000 : 5000);
}

// Initial load
window.addEventListener('DOMContentLoaded', loadEvents);

