// Dorado Calendar — local datetime inputs (no UTC shift), snap-to-15 drag/resize,
// custom confirm (red/yellow/gray order), repeats future-only, overlap layout, sticky bars.

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOUR_PX = 40;
const MINUTE_PX = HOUR_PX / 60;
const SNAP_MIN = 15;
const EV_GAP_PX = 6;

const pad2 = n => String(n).padStart(2,"0");
const hhmm = d => new Date(d).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});

// ---- local datetime <-> input helpers (fixes 7h shift) ----
function toLocalInputValue(dt){
  const d = new Date(dt);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fromLocalInputValue(s){ return new Date(s); } // keep for clarity

// ===== Custom Confirm Utilities =====
async function showConfirm({ title = "Confirm", message = "", buttons = [] } = {}) {
  return new Promise(resolve => {
    const root = document.getElementById("confirm-root");
    const backdrop = document.getElementById("confirm-backdrop");
    const titleEl = document.getElementById("confirm-title");
    const msgEl = document.getElementById("confirm-message");
    const actions = document.getElementById("confirm-actions");

    titleEl.textContent = title;
    msgEl.textContent = message;
    actions.innerHTML = "";

    const makeBtn = ({id,label,variant}) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = "btn";
      if (variant === "primary") b.classList.add("btn-primary");
      else if (variant === "danger") b.classList.add("btn-danger");
      else if (variant === "warning") b.classList.add("btn-warning");
      b.addEventListener("click", () => cleanup(id));
      return b;
    };

    buttons.forEach(cfg => actions.appendChild(makeBtn(cfg)));

    function onKey(e){ if(e.key === "Escape") cleanup("escape"); }
    function onBackdrop(){ cleanup("cancel"); }
    function cleanup(result){
      root.classList.add("hidden");
      root.setAttribute("aria-hidden","true");
      document.removeEventListener("keydown", onKey);
      backdrop.removeEventListener("click", onBackdrop);
      resolve(result);
    }

    root.classList.remove("hidden");
    root.setAttribute("aria-hidden","false");
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", onBackdrop);
  });
}

async function askRepeatScope(kind = "edit") {
  const isEdit = kind === "edit";
  const title = isEdit ? "Edit repeating event" : "Delete repeating event";
  const message = isEdit
    ? "Apply changes to this occurrence only, or this and all future occurrences?"
    : "Delete this occurrence only, or this and all future occurrences?";

  // Order: LEFT red (future), MIDDLE yellow (single), RIGHT gray (cancel)
  return await showConfirm({
    title, message,
    buttons: [
      { id: "future", label: "This & future", variant: "danger" },
      { id: "single", label: "Only this",     variant: "warning" },
      { id: "cancel", label: "Cancel",        variant: "neutral" }
    ]
  });
}

// ===== Date utils =====
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function addWeeks(d,n){ return addDays(d, n*7); }
function addMonths(d,n){ const x=new Date(d); const day=x.getDate(); x.setMonth(x.getMonth()+n); if(x.getDate()<day) x.setDate(0); return x; }
function addYears(d,n){ const x=new Date(d); x.setFullYear(x.getFullYear()+n); return x; }

function startOfWeekLocal(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-x.getDay()); return x; }
function endOfWeekLocal(d){ const s=startOfWeekLocal(d); const e=new Date(s); e.setDate(e.getDate()+7); return e; }
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }

function dateKeyLocal(d){ const x=new Date(d); x.setHours(0,0,0,0); return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`; }
function fromKey(key){ return new Date(`${key}T00:00`); }
function localStr(key,mins){ const h=Math.floor(mins/60), m=mins%60; return `${key}T${pad2(h)}:${pad2(m)}`; }

function zForDuration(mins){ return 1000 + Math.max(1, 1440 - Math.min(1440, Math.round(mins))); }

// ===== State =====
let currentWeekStart = startOfWeekLocal(new Date());
let events = [];
let justDragged = false;

// ===== Auto theme (system, no UI) =====
const mqlDark = window.matchMedia('(prefers-color-scheme: dark)');
function applySystemTheme(){ document.documentElement.setAttribute('data-theme', mqlDark.matches ? 'dark' : 'light'); }

// ===== Repeat helpers =====
function ordinal(n){ const s=["th","st","nd","rd"], v=n%100; return n + (s[(v-20)%10] || s[v] || s[0]); }
function nthWeekdayOfMonth(date){ const d=new Date(date); const nth=Math.floor((d.getDate()-1)/7)+1; return { nth, weekday:d.getDay() }; }
function weekdayName(i){ return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][i]; }
function monthName(i){ return ["January","February","March","April","May","June","July","August","September","October","November","December"][i]; }

function buildRepeatLabels(dt){
  const d = new Date(dt);
  const { nth, weekday } = nthWeekdayOfMonth(d);
  return {
    weeklyLabel: `Weekly on ${weekdayName(d.getDay())}`,
    monthDayLabel: `Monthly on the ${ordinal(d.getDate())}`,
    monthNthLabel: `Monthly on the ${ordinal(nth)} ${weekdayName(weekday)}`,
    yearlyLabel: `Yearly on ${monthName(d.getMonth())} ${ordinal(d.getDate())}`
  };
}

function nthDowOfMonth(year, month, dow, nth, hour, minute){
  const first = new Date(year, month, 1, hour||0, minute||0);
  const delta = (dow - first.getDay() + 7) % 7;
  const day = 1 + delta + (nth - 1)*7;
  const dt = new Date(year, month, day, hour||0, minute||0);
  if (dt.getMonth() !== month) return null;
  return dt;
}

/* Expand repeats within [rangeStart, rangeEnd), future-only, respecting until/exDates */
function* expandRepeats(ev, rangeStart, rangeEnd){
  const baseStart = new Date(ev.start);
  const baseEnd   = new Date(ev.end);
  const durMs = baseEnd - baseStart;
  const nowFloor = startOfDay(new Date());
  const minStart = new Date(Math.max(baseStart, nowFloor));
  const until = ev.until ? new Date(ev.until) : null;
  const ex = new Set(ev.exDates || []);

  switch((ev.repeat||"none")){
    case "none": {
      if(baseStart >= minStart && baseEnd > rangeStart && baseStart < rangeEnd){
        yield { start: new Date(baseStart), end: new Date(baseEnd) };
      }
      break;
    }
    case "daily": {
      let cur = new Date(baseStart);
      while (cur < minStart) cur = addDays(cur,1);
      while (cur < rangeEnd){
        if(until && cur >= until) break;
        const key = cur.toISOString();
        if(!ex.has(key)){
          const end = new Date(cur.getTime()+durMs);
          if(end > rangeStart) yield { start: new Date(cur), end };
        }
        cur = addDays(cur,1);
      }
      break;
    }
    case "weekly": {
      let cur = new Date(baseStart);
      while (cur < minStart) cur = addWeeks(cur,1);
      while (cur < rangeEnd){
        if(until && cur >= until) break;
        const key = cur.toISOString();
        if(!ex.has(key)){
          const end = new Date(cur.getTime()+durMs);
          if(end > rangeStart) yield { start: new Date(cur), end };
        }
        cur = addWeeks(cur,1);
      }
      break;
    }
    case "monthly_day": {
      let cur = new Date(baseStart);
      while (cur < minStart){ cur = addMonths(cur,1); }
      while (cur < rangeEnd){
        if(until && cur >= until) break;
        const key = cur.toISOString();
        if(!ex.has(key)){
          const end = new Date(cur.getTime()+durMs);
          if(end > rangeStart) yield { start: new Date(cur), end };
        }
        const want = baseStart.getDate();
        cur = addMonths(cur,1);
        if (cur.getDate() !== want) {
          const tmp = new Date(cur.getFullYear(), cur.getMonth(), want, baseStart.getHours(), baseStart.getMinutes());
          if (tmp.getMonth() === cur.getMonth()) cur = tmp;
        }
      }
      break;
    }
    case "monthly_nth_weekday": {
      const base = new Date(baseStart);
      const targetNth = Math.floor((base.getDate()-1)/7)+1;
      const targetDow = base.getDay();
      let curMonth = new Date(base.getFullYear(), base.getMonth(), 1, base.getHours(), base.getMinutes());
      while (addMonths(curMonth,0) < startOfDay(minStart)) curMonth = addMonths(curMonth,1);
      while (curMonth < rangeEnd){
        const inst = nthDowOfMonth(curMonth.getFullYear(), curMonth.getMonth(), targetDow, targetNth, base.getHours(), base.getMinutes());
        if (inst){
          if(until && inst >= until) break;
          const key = inst.toISOString();
          if(!ex.has(key)){
            const end = new Date(inst.getTime()+durMs);
            if (inst >= minStart && end > rangeStart && inst < rangeEnd) yield { start: inst, end };
          }
        }
        curMonth = addMonths(curMonth,1);
      }
      break;
    }
    case "yearly": {
      let cur = new Date(baseStart);
      while (cur < minStart) cur = addYears(cur,1);
      while (cur < rangeEnd){
        if(until && cur >= until) break;
        const key = cur.toISOString();
        if(!ex.has(key)){
          const end = new Date(cur.getTime()+durMs);
          if(end > rangeStart) yield { start: new Date(cur), end };
        }
        cur = addYears(cur,1);
      }
      break;
    }
  }
}

// ===== Header & time column rendering =====
let timeFormat = localStorage.getItem('timeFmt') || '24';

function renderWeekHeader(ws){
  const head = document.getElementById("days-head");
  head.innerHTML = "";
  const todayKey = dateKeyLocal(new Date());
  for(let i=0;i<7;i++){
    const d = addDays(ws,i), key = dateKeyLocal(d);
    const cell = document.createElement("div");
    cell.className = "day-name";
    if(key === todayKey) cell.classList.add("is-today");
    cell.textContent = `${DAYS[i]} ${d.getMonth()+1}/${d.getDate()}`;
    head.appendChild(cell);
  }
}

function formatHourLabel(h){
  if (timeFormat === '24') return `${pad2(h)}:00`;
  const ampm = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${ampm}`;
}

function renderTimeCol(){
  const t = document.getElementById("time-body"); t.innerHTML="";
  for(let h=0; h<24; h++){
    const row = document.createElement("div");
    row.className = "tick";
    row.style.height = `${HOUR_PX}px`;
    row.textContent = formatHourLabel(h);
    row.addEventListener('click', ()=>{
      timeFormat = timeFormat === '24' ? '12' : '24';
      localStorage.setItem('timeFmt', timeFormat);
      renderTimeCol();
    });
    t.appendChild(row);
  }
  const spacer = document.querySelector('.time-head-spacer');
  if (spacer && !spacer._wiredToggle) {
    spacer.addEventListener('click', ()=>{
      timeFormat = timeFormat === '24' ? '12' : '24';
      localStorage.setItem('timeFmt', timeFormat);
      renderTimeCol();
    });
    spacer._wiredToggle = true;
  }
}

function renderDayBodies(ws){
  const wrap = document.getElementById("days-wrap"); wrap.innerHTML="";
  for(let i=0;i<7;i++){
    const key = dateKeyLocal(addDays(ws,i));
    const body = document.createElement("div");
    body.className = "day-body";
    body.dataset.date = key;

    const grid = document.createElement("div");
    grid.className = "hour-grid";
    body.appendChild(grid);

    // CLICK-TO-CREATE at clicked time (snapped to 15)
    body.addEventListener("click",(ev)=>{
      if (ev.target.closest(".event-block")) return;
      const rect = body.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      let mins = Math.max(0, Math.min(1439, Math.round(y / MINUTE_PX)));
      mins = Math.round(mins / SNAP_MIN) * SNAP_MIN;  // snap to 15
      const start = localStr(key, mins);
      const end = localStr(key, Math.min(1439, mins + 60)); // default 60m
      openModal(null, key, { defaultStart: start, defaultEnd: end });
    });

    wrap.appendChild(body);
  }
  renderEvents();
}

function renderWeek(){
  const we = endOfWeekLocal(currentWeekStart);
  document.getElementById("week-label").textContent =
    `${currentWeekStart.toLocaleDateString()} - ${addDays(we,-1).toLocaleDateString()}`;
  renderWeekHeader(currentWeekStart);
  renderTimeCol();
  renderDayBodies(currentWeekStart);
}

// ===== Modal =====
const modal = document.getElementById("modal");
const form  = document.getElementById("modal-form");
const modalAccent = document.getElementById("modal-accent");
let editingMeta = null;

function getSelectedCategory(){
  const r = document.querySelector('input[name="modal-cat"]:checked');
  return r ? r.value : "School";
}
function setSelectedCategory(cat){
  const sel = document.querySelector(`input[name="modal-cat"][value="${cat}"]`);
  (sel || document.querySelector('input[name="modal-cat"][value="School"]')).checked = true;
  updateModalAccent(cat);
}
function updateModalAccent(cat){
  let color = getCategoryColor(cat);
  modalAccent.style.background = color;
}
function getCategoryColor(cat){
  switch((cat||"").toLowerCase()){
    case "school": return getComputedStyle(document.documentElement).getPropertyValue('--school') || '#1e88e5';
    case "activities": return getComputedStyle(document.documentElement).getPropertyValue('--activities') || '#e53935';
    case "personal": return getComputedStyle(document.documentElement).getPropertyValue('--personal') || '#43a047';
    default: return '#888';
  }
}

function refreshRepeatLabels(){
  const startVal = document.getElementById("modal-start").value;
  if(!startVal) return;
  const d = new Date(startVal);
  const nth = Math.floor((d.getDate()-1)/7)+1;
  const weeklyLabel = `Weekly on ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()]}`;
  const ords = ["","1st","2nd","3rd"];
  const monthDayLabel = `Monthly on the ${ords[d.getDate()] || (d.getDate()+"th")}`;
  const monthNthLabel = `Monthly on the ${ords[nth] || (nth+"th")} ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()]}`;
  const yearlyLabel = `Yearly on ${["January","February","March","April","May","June","July","August","September","October","November","December"][d.getMonth()]} ${d.getDate()}`;

  const rep = document.getElementById("modal-repeat");
  for (const opt of rep.options){
    switch(opt.value){
      case "weekly": opt.textContent = weeklyLabel; break;
      case "monthly_day": opt.textContent = monthDayLabel; break;
      case "monthly_nth_weekday": opt.textContent = monthNthLabel; break;
      case "yearly": opt.textContent = yearlyLabel; break;
    }
  }
}

/* Open modal — supports defaults when creating: opts={defaultStart,defaultEnd} */
function openModal(instanceOrNull, dateKey, opts={}){
  if (justDragged){ justDragged = false; return; }
  modal.style.display = "grid";
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");

  if(instanceOrNull){
    const inst = instanceOrNull;
    const baseId = inst.baseId || inst.id;
    const instanceISO = inst.instanceISO || null;
    editingMeta = {
      baseId,
      instanceISO,
      isRepeating: !!(inst.repeat && inst.repeat!=="none"),
      originalStartISO: inst.start instanceof Date ? inst.start.toISOString() : inst.start
    };

    document.getElementById("modal-title-text").textContent = "Edit Event";
    document.getElementById("modal-title").value   = inst.title;
    // !!! Use local input format (NO toISOString) to avoid timezone shift
    const sVal = (inst.start instanceof Date) ? toLocalInputValue(inst.start) : inst.start;
    const eVal = (inst.end   instanceof Date) ? toLocalInputValue(inst.end)   : inst.end;
    document.getElementById("modal-start").value   = sVal;
    document.getElementById("modal-end").value     = eVal;
    setSelectedCategory(inst.category);
    document.getElementById("modal-repeat").value  = inst.repeat || "none";
    document.getElementById("modal-delete").style.display = "inline-block";
  } else {
    editingMeta = { baseId: null, instanceISO: null, isRepeating: false, originalStartISO: null };
    document.getElementById("modal-title-text").textContent = "Add Event";
    form.reset();
    const start = opts.defaultStart || `${dateKey}T12:00`;
    const end   = opts.defaultEnd   || `${dateKey}T13:00`;
    document.getElementById("modal-title").value   = "";
    document.getElementById("modal-start").value   = start;
    document.getElementById("modal-end").value     = end;
    setSelectedCategory("School");
    document.getElementById("modal-repeat").value  = "none";
    document.getElementById("modal-delete").style.display = "none";
  }
  refreshRepeatLabels();
}

function closeModal(){
  modal.style.display = "none";
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
  form.reset();
  editingMeta = null;
}

document.getElementById("modal-cancel").onclick = ()=>closeModal();
document.getElementById("modal-backdrop").onclick = ()=>closeModal();

document.getElementById("modal-delete").onclick = async () => {
  if(!editingMeta) return;
  const base = events.find(e => e.id === editingMeta.baseId);
  if(!base) return closeModal();

  if(base.repeat && base.repeat !== "none"){
    const scope = await askRepeatScope("delete");
    if(scope === "cancel" || scope === "escape") return;
    const instISO = editingMeta.instanceISO || editingMeta.originalStartISO;
    if(scope === "future"){
      base.until = instISO;
    }else if(scope === "single"){
      base.exDates = base.exDates || [];
      if(!base.exDates.includes(instISO)) base.exDates.push(instISO);
    }
  }else{
    const r = await showConfirm({
      title: "Delete event",
      message: "Are you sure you want to delete this event?",
      buttons: [
        { id: "cancel", label: "Cancel", variant: "neutral" },
        { id: "ok",     label: "Delete", variant: "danger" }
      ]
    });
    if (r !== "ok") return;
    const idx = events.findIndex(e => e.id === base.id);
    if(idx >= 0) events.splice(idx,1);
  }
  closeModal();
  renderEvents();
};

document.getElementById("modal-category-group").addEventListener("change", ()=>{
  updateModalAccent(getSelectedCategory());
});
document.getElementById("modal-start").addEventListener("change", refreshRepeatLabels);

form.onsubmit = async (e)=>{
  e.preventDefault();
  const title    = document.getElementById("modal-title").value.trim();
  const start    = document.getElementById("modal-start").value;
  const end      = document.getElementById("modal-end").value;
  const category = getSelectedCategory();
  const repeat   = document.getElementById("modal-repeat").value || "none";
  if(!title) return;
  if(new Date(end) <= new Date(start)){ alert("End must be after start"); return; }

  if(!editingMeta || !editingMeta.baseId){
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    events.push({ id, title, start, end, category, repeat, exDates: [] });
  }else{
    const base = events.find(e => e.id === editingMeta.baseId);
    if(!base) return;

    if(base.repeat && base.repeat!=="none"){
      const scope = await askRepeatScope("edit");
      if(scope === "cancel" || scope === "escape"){ closeModal(); return; }
      const instISO = editingMeta.instanceISO || editingMeta.originalStartISO;

      if(scope === "future"){
        base.title = title;
        base.category = category;
        base.repeat = repeat;
        base.start = start;
        base.end   = end;
        if(base.until && new Date(base.until) < new Date(base.start)) base.until = null;
      }else if(scope === "single"){
        base.exDates = base.exDates || [];
        if(!base.exDates.includes(instISO)) base.exDates.push(instISO);
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
        events.push({ id, title, start, end, category, repeat: "none" });
      }
    }else{
      base.title = title;
      base.category = category;
      base.repeat = repeat;
      base.start = start;
      base.end = end;
    }
  }
  closeModal();
  renderEvents();
};

// ===== Instances + rendering =====
function fragmentsForDay(dayKey, evs){
  const dayStart = fromKey(dayKey), dayEnd = addDays(dayStart,1);
  const out = [];
  for(const ev of evs){
    const s = new Date(ev.start), e = new Date(ev.end);
    if(e <= dayStart || s >= dayEnd) continue;
    const startMin = Math.max(0, Math.floor((Math.max(s,dayStart) - dayStart)/60000));
    const endMin   = Math.min(24*60, Math.ceil((Math.min(e,dayEnd)   - dayStart)/60000));
    if(endMin <= startMin) continue;
    out.push({ ev, id: ev.id, startMin, endMin });
  }
  return out;
}

function clusterRolesUpTo3(frags){
  const sorted = [...frags].sort((a,b)=>{
    if(a.startMin !== b.startMin) return a.startMin - b.startMin;
    const da=a.endMin-a.startMin, db=b.endMin-b.startMin;
    return db - da;
  });
  const clusters=[]; let cur=null;
  for(const fr of sorted){
    if(!cur || fr.startMin >= cur.maxEnd){ cur={items:[],maxEnd:fr.endMin}; clusters.push(cur); }
    cur.items.push(fr); if(fr.endMin>cur.maxEnd) cur.maxEnd=fr.endMin;
  }
  const map=new Map();
  for(const cl of clusters){
    const items = cl.items.slice().sort((a,b)=>{
      const da=a.endMin-a.startMin, db=b.endMin-b.startMin;
      if(da!==db) return db-da;
      if(a.startMin!==b.startMin) return a.startMin-b.startMin;
      return a.id.localeCompare(b.id);
    });
    if(items.length===1){ map.set(items[0].id+":"+items[0].startMin,{role:"primary"}); continue; }
    map.set(items[0].id+":"+items[0].startMin,{role:"primary"});
    if(items[1]) map.set(items[1].id+":"+items[1].startMin,{role:"secondary1"});
    if(items[2]) map.set(items[2].id+":"+items[2].startMin,{role:"secondary2"});
    if(items.length>3){
      const others=items.slice(3), cols=others.length;
      others.forEach((fr,i)=>map.set(fr.id+":"+fr.startMin,{role:"equal",col:i,cols}));
    }
  }
  return map;
}

function buildBlockFromFragment(fr, dayKey, roleRec){
  const duration = fr.endMin - fr.startMin;
  const heightPx = Math.max(6, duration * MINUTE_PX);

  const block = document.createElement("div");
  block.className = `event-block category-${fr.ev.category.toLowerCase()}`;
  block.style.top    = `${fr.startMin*MINUTE_PX}px`;
  block.style.height = `${heightPx}px`;
  block.dataset.id   = fr.ev.id;
  block.dataset.day  = dayKey;
  block.dataset.startMin = fr.startMin;
  block.dataset.endMin   = fr.endMin;
  block.style.zIndex = String(zForDuration(duration));

  const setLW = (leftPct, widthPct)=>{
    block.style.left  = `calc(${leftPct}% + ${EV_GAP_PX}px)`;
    block.style.width = `calc(${widthPct}% - ${EV_GAP_PX*2}px)`;
    block.style.right = "auto";
  };

  if(!roleRec || roleRec.role==="primary"){
    block.style.left  = `${EV_GAP_PX}px`;
    block.style.right = `${EV_GAP_PX}px`;
  } else if(roleRec.role==="secondary1"){
    setLW(25,75);
  } else if(roleRec.role==="secondary2"){
    setLW(50,50);
  } else if(roleRec.role==="equal"){
    const widthPct = 100/roleRec.cols;
    const leftPct  = widthPct*roleRec.col;
    setLW(leftPct,widthPct);
  }

  const fragStart = new Date(localStr(dayKey, fr.startMin));
  const fragEnd   = new Date(localStr(dayKey, fr.endMin));

  const instanceISO = fragStart.toISOString();
  const baseId = fr.ev.baseId || fr.ev.id;
  const repeat = fr.ev.repeat || "none";

  const content = document.createElement("div"); content.className="content";
  const titleEl = document.createElement("div"); titleEl.className="title"; titleEl.textContent = fr.ev.title;
  const timeEl  = document.createElement("div"); timeEl.className="time";  timeEl.textContent  = `${hhmm(fragStart)} – ${hhmm(fragEnd)}`;
  content.append(titleEl,timeEl);

  const rt = document.createElement("div"); rt.className="resize-top";
  const rb = document.createElement("div"); rb.className="resize-bottom";
  block.append(content, rt, rb);

  applyCompactMode(block);
  new ResizeObserver(()=>applyCompactMode(block)).observe(block);

  block.addEventListener("click", ev => {
    ev.stopPropagation();
    if(justDragged) return;
    openModal({
      id: baseId,
      baseId,
      instanceISO,
      title: fr.ev.title,
      category: fr.ev.category,
      start: fragStart,
      end: fragEnd,
      repeat
    }, dayKey);
  });

  block.addEventListener("pointerdown", ev => {
    const tgt = ev.target;
    if(tgt.classList.contains("resize-top") || tgt.classList.contains("resize-bottom")) return;
    ev.preventDefault(); ev.stopPropagation();
    const duration = fr.endMin - fr.startMin;
    startDragMoveInstance({ baseId, instanceISO, title: fr.ev.title, category: fr.ev.category, repeat, durationMin: duration }, block, dayKey, ev);
  });
  rt.addEventListener("pointerdown", ev => { ev.preventDefault(); ev.stopPropagation(); startResizeInstance({ baseId, instanceISO, title: fr.ev.title, category: fr.ev.category, repeat }, block, dayKey, "top", ev); });
  rb.addEventListener("pointerdown", ev => { ev.preventDefault(); ev.stopPropagation(); startResizeInstance({ baseId, instanceISO, title: fr.ev.title, category: fr.ev.category, repeat }, block, dayKey, "bottom", ev); });

  return block;
}

function renderEvents(){
  const rangeStart = startOfDay(currentWeekStart);
  const rangeEnd   = endOfWeekLocal(currentWeekStart);

  const instances = [];
  for(const ev of events){
    if(ev.repeat && ev.repeat!=="none"){
      for(const inst of expandRepeats(ev, rangeStart, rangeEnd)){
        instances.push({
          id: ev.id + "|" + inst.start.toISOString(),
          baseId: ev.id,
          title: ev.title,
          category: ev.category,
          start: inst.start,
          end: inst.end,
          repeat: ev.repeat
        });
      }
    } else {
      const s=new Date(ev.start), e=new Date(ev.end);
      if(e > rangeStart && s < rangeEnd && s >= startOfDay(new Date())){
        instances.push({ id: ev.id, baseId: ev.id, title: ev.title, category: ev.category, start: s, end: e, repeat: "none" });
      }
    }
  }

  document.querySelectorAll(".event-block").forEach(n=>n.remove());
  document.querySelectorAll(".day-body").forEach(b=>{
    const dayKey = b.dataset.date;
    const dayStart = fromKey(dayKey), dayEnd = addDays(dayStart,1);
    const todays = instances.filter(x => x.end > dayStart && x.start < dayEnd);
    const frags = fragmentsForDay(dayKey, todays);
    const roles = clusterRolesUpTo3(frags);
    for(const fr of frags){
      const rec = roles.get(fr.id + ":" + fr.startMin);
      b.appendChild(buildBlockFromFragment(fr, dayKey, rec));
    }
  });
}

// ===== Compact thresholds =====
function applyCompactMode(block){
  const h = block.getBoundingClientRect().height;
  block.classList.remove("compact","tiny","very-short","micro");
  if (h <= 8) block.classList.add("micro");
  else if (h <= 12) block.classList.add("very-short");
  else if (h <= 22) block.classList.add("tiny");
  else if (h <= 30) block.classList.add("compact");
}

// ===== Drag/Resize with cross-day & SNAP =====
function startDragMoveInstance(meta, block, dayKey, pDown){
  const startY = pDown.clientY;
  const initTopPx = parseFloat(block.style.top) || 0;
  const fragDurMin = parseInt(block.dataset.endMin) - parseInt(block.dataset.startMin);

  let targetBody = block.closest(".day-body");
  let moved=false;

  const originalZ = block.style.zIndex;
  block.style.zIndex = "8000"; // below sticky header
  block.setPointerCapture(pDown.pointerId);
  document.body.style.userSelect = "none";
  document.body.style.cursor = "grabbing";

  let curTopMin = Math.round(initTopPx/MINUTE_PX);

  let raf=null;
  const onMove = (ev)=>{
    const dy = ev.clientY - startY;
    if(!raf){
      raf=requestAnimationFrame(()=>{
        const propMin = Math.round((initTopPx + dy)/MINUTE_PX);
        // SNAP to 15, allow negative/overflow (cross-day)
        curTopMin = Math.round(propMin / SNAP_MIN) * SNAP_MIN;

        // switch days if pointer crosses
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const u = el ? (el.closest(".day-body") || targetBody) : targetBody;
        if(u && u!==targetBody){ targetBody=u; targetBody.appendChild(block); }

        // visible top clamped to column for display
        const visTop = Math.max(0, Math.min(24*60 - Math.min(fragDurMin, 24*60), curTopMin));
        block.style.top = `${visTop*MINUTE_PX}px`;

        moved=true; justDragged=true;

        // live time text
        const totalStartAbs = curTopMin;
        const totalEndAbs   = curTopMin + fragDurMin;

        const startShift = Math.floor(totalStartAbs / 1440);
        const endShift   = Math.floor(totalEndAbs   / 1440);
        const startMinInDay = ((totalStartAbs % 1440)+1440)%1440;
        const endMinInDay   = ((totalEndAbs   % 1440)+1440)%1440;

        const baseDay = fromKey(targetBody.dataset.date);
        const startDate = addDays(baseDay, startShift);
        const endDate   = addDays(baseDay, endShift);

        const s = new Date(`${dateKeyLocal(startDate)}T${pad2(Math.floor(startMinInDay/60))}:${pad2(startMinInDay%60)}`);
        const e = new Date(`${dateKeyLocal(endDate)}T${pad2(Math.floor(endMinInDay/60))}:${pad2(endMinInDay%60)}`);

        const t = block.querySelector(".time"); if(t) t.textContent = `${hhmm(s)} – ${hhmm(e)}`;
        applyCompactMode(block);
        raf=null;
      });
    }
  };

  const onUp = async ()=>{
    block.releasePointerCapture(pDown.pointerId);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup",   onUp);
    document.body.style.userSelect = ""; document.body.style.cursor="";

    if(!moved){ block.style.zIndex=originalZ; justDragged=false; return; }

    const baseDay = fromKey(targetBody.dataset.date);
    const totalStartAbs = curTopMin;
    const totalEndAbs   = curTopMin + meta.durationMin;

    const startShift = Math.floor(totalStartAbs / 1440);
    const endShift   = Math.floor(totalEndAbs   / 1440);
    const startMinInDay = ((totalStartAbs % 1440)+1440)%1440;
    const endMinInDay   = ((totalEndAbs   % 1440)+1440)%1440;

    const startKey = dateKeyLocal(addDays(baseDay, startShift));
    const endKey   = dateKeyLocal(addDays(baseDay, endShift));
    const newStart = localStr(startKey, startMinInDay);
    const newEnd   = localStr(endKey,   endMinInDay);

    const base = events.find(e => e.id === meta.baseId);
    if(!base){ justDragged=false; renderEvents(); return; }

    if(base.repeat && base.repeat!=="none"){
      const scope = await askRepeatScope("edit");
      if(scope === "cancel" || scope === "escape"){ setTimeout(()=>{ justDragged=false; },120); renderEvents(); return; }
      const instISO = meta.instanceISO;
      if(scope === "future"){
        base.start = newStart; base.end = newEnd;
        if(base.until && new Date(base.until) < new Date(base.start)) base.until = null;
      }else if(scope === "single"){
        base.exDates = base.exDates || [];
        if(!base.exDates.includes(instISO)) base.exDates.push(instISO);
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
        events.push({ id, title: meta.title, start: newStart, end: newEnd, category: meta.category, repeat: "none" });
      }
    }else{
      base.start = newStart; base.end = newEnd;
    }

    setTimeout(()=>{ justDragged=false; },120);
    renderEvents();
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup",   onUp);
}

function startResizeInstance(meta, block, fixedDayKey, edge, pDown){
  const startY = pDown.clientY;
  const initTopPx = parseFloat(block.style.top) || 0;
  const initHpx   = parseFloat(block.style.height) || (60*MINUTE_PX);
  const initTopMin= Math.round(initTopPx/MINUTE_PX);
  const initDurMin= Math.max(5, Math.round(initHpx/MINUTE_PX));
  let curTop=initTopMin, curDur=initDurMin;

  block.style.zIndex = "8000"; // below sticky header
  block.setPointerCapture(pDown.pointerId);
  document.body.style.userSelect="none";
  document.body.style.cursor="ns-resize";

  let raf=null;
  const onMove = (ev)=>{
    const dy = ev.clientY - startY;
    if(!raf){
      raf=requestAnimationFrame(()=>{
        if(edge==="top"){
          const nextTop = initTopMin + Math.round(dy/MINUTE_PX);
          const snappedTop = Math.round(nextTop/SNAP_MIN)*SNAP_MIN;
          curTop = snappedTop;
          curDur = Math.max(5, Math.round((initDurMin + (initTopMin - curTop))/SNAP_MIN)*SNAP_MIN);
          const visTop = Math.max(0, Math.min(24*60 - 5, curTop));
          block.style.top = `${visTop*MINUTE_PX}px`;
          block.style.height = `${Math.max(5, Math.min(curDur, 24*60))*MINUTE_PX}px`;
        }else{
          const nextDur = initDurMin + Math.round(dy/MINUTE_PX);
          const snappedDur = Math.round(nextDur/SNAP_MIN)*SNAP_MIN;
          curDur = Math.max(5, snappedDur);
          block.style.height = `${Math.min(curDur, 24*60)*MINUTE_PX}px`;
        }

        const baseDay = fromKey(fixedDayKey);
        const startAbs = curTop;
        const endAbs   = curTop + curDur;

        const sShift = Math.floor(startAbs/1440);
        const eShift = Math.floor(endAbs/1440);
        const sMinIn = ((startAbs%1440)+1440)%1440;
        const eMinIn = ((endAbs%1440)+1440)%1440;

        const sKey = dateKeyLocal(addDays(baseDay, sShift));
        const eKey = dateKeyLocal(addDays(baseDay, eShift));

        const s = new Date(`${sKey}T${pad2(Math.floor(sMinIn/60))}:${pad2(sMinIn%60)}`);
        const en= new Date(`${eKey}T${pad2(Math.floor(eMinIn/60))}:${pad2(eMinIn%60)}`);
        const t=block.querySelector(".time"); if(t) t.textContent = `${hhmm(s)} – ${hhmm(en)}`;

        applyCompactMode(block);
        justDragged=true;
        raf=null;
      });
    }
  };

  const onUp = async ()=>{
    block.releasePointerCapture(pDown.pointerId);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup",   onUp);
    document.body.style.userSelect="";
    document.body.style.cursor="";

    const baseDay = fromKey(fixedDayKey);
    const startAbs = curTop;
    const endAbs   = curTop + curDur;

    const sShift = Math.floor(startAbs/1440);
    const eShift = Math.floor(endAbs/1440);
    const sMinIn = ((startAbs%1440)+1440)%1440;
    const eMinIn = ((endAbs%1440)+1440)%1440;

    const sKey = dateKeyLocal(addDays(baseDay, sShift));
    const eKey = dateKeyLocal(addDays(baseDay, eShift));
    const newStart = localStr(sKey, sMinIn);
    const newEnd   = localStr(eKey, eMinIn);

    const base = events.find(e => e.id === meta.baseId);
    if(base){
      if(base.repeat && base.repeat!=="none"){
        const scope = await askRepeatScope("edit");
        if(scope === "cancel" || scope === "escape"){ setTimeout(()=>{ justDragged=false; },120); renderEvents(); return; }
        const instISO = meta.instanceISO;
        if(scope === "future"){
          base.start = newStart; base.end = newEnd;
          if(base.until && new Date(base.until) < new Date(base.start)) base.until = null;
        }else if(scope === "single"){
          base.exDates = base.exDates || [];
          if(!base.exDates.includes(instISO)) base.exDates.push(instISO);
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
          events.push({ id, title: meta.title, start: newStart, end: newEnd, category: meta.category, repeat: "none" });
        }
      }else{
        base.start = newStart; base.end = newEnd;
      }
    }

    setTimeout(()=>{ justDragged=false; },120);
    renderEvents();
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup",   onUp);
}

// ===== Boot =====
document.addEventListener("DOMContentLoaded", ()=>{
  applySystemTheme();
  mqlDark.addEventListener('change', applySystemTheme);

  renderWeek();

  const prev = document.getElementById("prev-week");
  const next = document.getElementById("next-week");
  const today= document.getElementById("today");
  if(prev) prev.onclick = ()=>{ currentWeekStart = addDays(currentWeekStart,-7); renderWeek(); };
  if(next) next.onclick = ()=>{ currentWeekStart = addDays(currentWeekStart, 7); renderWeek(); };
  if(today) today.onclick= ()=>{ currentWeekStart = startOfWeekLocal(new Date()); renderWeek(); };

  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { currentWeekStart = addDays(currentWeekStart, -7); renderWeek(); }
    if (e.key === 'ArrowRight'){ currentWeekStart = addDays(currentWeekStart,  7); renderWeek(); }
    if (e.key.toLowerCase() === 't') { currentWeekStart = startOfWeekLocal(new Date()); renderWeek(); }
    if (e.key.toLowerCase() === 'n') {
      const todayKey = dateKeyLocal(new Date());
      openModal(null, todayKey);
    }
  });
});

