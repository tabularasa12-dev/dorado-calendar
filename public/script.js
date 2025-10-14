/* ======================================================================
   Dorado Week — JS
   - Repeats: edit/delete prompts; “This & future” is left-most
   - Drag-move & drag-resize support vertical/horizontal wrap within week
   - NEW: Event card time text updates live while dragging/resizing
   - Day names row: gray rule under labels; today underline above
   - Drag/move/resize; solid click hitbox; current-time line; hidden red-hours
   - Auto dark/light (system)
   ====================================================================== */

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOUR_PX = 40;
const MINUTE_PX = HOUR_PX / 60;
const SNAP_MIN = 15;
const EVENT_X_GAP = 6;
const CLICK_DRAG_THRESHOLD = 4;

const pad2 = (n)=> String(n).padStart(2,"0");
const hhmm = (d, twelve=false)=> new Date(d).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", hour12:twelve });

function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfWeekLocal(d){ const x=startOfDay(d); x.setDate(x.getDate()-x.getDay()); return x; }
function endOfWeekLocal(d){ return addDays(startOfWeekLocal(d),7); }
function dateKeyLocal(d){ const x=startOfDay(d); return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`; }
function fromKey(key){ return new Date(`${key}T00:00`); }
function toLocalInputValue(dt){ const d=new Date(dt); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function minutesSinceMidnight(d=new Date()){ return d.getHours()*60 + d.getMinutes() + d.getSeconds()/60; }
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function zForDuration(mins){ return 1000 + Math.max(1, 1440 - Math.min(1440, Math.round(mins))); }

/* ---------- Auto dark/light ---------- */
const mqlDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
function applySystemTheme(){
  if (mqlDark && mqlDark.matches){
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}
function wireThemeListener(){
  if (!mqlDark) return;
  if (typeof mqlDark.addEventListener === "function"){
    mqlDark.addEventListener("change", applySystemTheme);
  } else if (typeof mqlDark.addListener === "function"){
    mqlDark.addListener(applySystemTheme);
  }
}

/* ---------- State ---------- */
let currentWeekStart = startOfWeekLocal(new Date());
let events = [];
let timeFormat = localStorage.getItem("timeFmt") || "24";

/* ---------- Header helpers ---------- */
function labelWeek(){
  const end = addDays(endOfWeekLocal(currentWeekStart), -1);
  const s = currentWeekStart.toLocaleDateString();
  const e = end.toLocaleDateString();
  const lab = document.getElementById("week-label");
  if (lab) lab.textContent = `${s} — ${e}`;
}
function formatHourLabel(h){
  if (timeFormat === "24") return `${pad2(h)}:00`;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${ampm}`;
}

/* ---------- Current-time line ---------- */
function renderCurrentTimeLine(){
  document.querySelectorAll(".current-time-line").forEach(n=>n.remove());
  const todayKey = dateKeyLocal(new Date());
  const todayCol = document.querySelector(`.day-body[data-date="${todayKey}"]`);
  if (!todayCol) return;
  const topPx = minutesSinceMidnight() * MINUTE_PX;
  const line = document.createElement("div");
  line.className = "current-time-line";
  line.style.top = `${topPx}px`;
  todayCol.appendChild(line);
}

/* ---------- Hidden red-hours tracking ---------- */
function computeActivitiesHoursBeforeNow(){
  const todayKey = dateKeyLocal(new Date());
  const todayCol = document.querySelector(`.day-body[data-date="${todayKey}"]`);
  let totalMinutes = 0;
  if (todayCol){
    const nowTop = minutesSinceMidnight() * MINUTE_PX;
    const reds = todayCol.querySelectorAll(".event-block.category-activities");
    reds.forEach(el=>{
      const top = parseFloat(el.style.top||'0');
      const height = parseFloat(el.style.height||el.offsetHeight||0);
      const clipped = Math.min(Math.max(nowTop - top, 0), height);
      const minutes = clipped / MINUTE_PX;
      el.dataset.hoursBeforeNowToday = (minutes/60).toFixed(6);
      totalMinutes += minutes;
    });
  }
  window.__dorado = window.__dorado || {};
  window.__dorado.activitiesHoursBeforeNowToday = +(totalMinutes/60).toFixed(6);
}

/* ---------- Repeat helpers ---------- */
const addWeeks  = (d,n)=> addDays(d,7*n);
const addMonths = (d,n)=> { const x=new Date(d); const day=x.getDate(); x.setMonth(x.getMonth()+n); if(x.getDate()<day) x.setDate(0); return x; };
const addYears  = (d,n)=> { const x=new Date(d); x.setFullYear(x.getFullYear()+n); return x; };

function nthDowOfMonth(y,m,dow,nth,h,mi){
  const first = new Date(y,m,1,h||0,mi||0);
  const delta = (dow - first.getDay() + 7) % 7;
  const day = 1 + delta + (nth-1)*7;
  const dt = new Date(y,m,day,h||0,mi||0);
  return dt.getMonth() === m ? dt : null;
}

/* Build a single instance with exDates/overrides using stable base instanceKey */
function buildInstanceForRange(ev, instStart, dur, rangeStart, rangeEnd){
  const instKey = new Date(instStart).toISOString(); // series base key
  const ex = new Set(ev.exDates || []);
  if (ex.has(instKey)) return null;

  let start = new Date(instStart);
  let end   = new Date(start.getTime() + dur);
  let title = ev.title;
  let category = ev.category;

  const ov = (ev.overrides || {})[instKey];
  if (ov){
    if (ov.start) start = new Date(ov.start);
    if (ov.end)   end   = new Date(ov.end);
    if (ov.title) title = ov.title;
    if (ov.category) category = ov.category;
  }

  if (end > rangeStart && start < rangeEnd){
    return { start, end, title, category, baseId: ev.id, instanceKey: instKey, repeat: ev.repeat || "none" };
  }
  return null;
}

function* expandRepeats(ev, rangeStart, rangeEnd){
  const baseStart = new Date(ev.start), baseEnd = new Date(ev.end);
  const dur = baseEnd - baseStart;
  const until = ev.until ? new Date(ev.until) : null;
  const rep = ev.repeat || "none";

  if (rep === "none"){
    if (baseEnd > rangeStart && baseStart < rangeEnd){
      yield { start: new Date(baseStart), end: new Date(baseEnd), title: ev.title, category: ev.category, baseId: ev.id, instanceKey: null, repeat:"none" };
    }
    return;
  }

  const adders = { daily:addDays, weekly:addWeeks, yearly:addYears };

  if (rep === "daily" || rep === "weekly" || rep === "yearly"){
    let cur = new Date(baseStart);
    while (cur < rangeStart) cur = adders[rep](cur, 1);
    while (cur < rangeEnd){
      if (until && cur >= until) break;
      const inst = buildInstanceForRange(ev, cur, dur, rangeStart, rangeEnd);
      if (inst) yield inst;
      cur = adders[rep](cur, 1);
    }
    return;
  }

  if (rep === "monthly_day"){
    let cur = new Date(baseStart);
    while (cur < rangeStart) cur = addMonths(cur, 1);
    while (cur < rangeEnd){
      if (until && cur >= until) break;
      const inst = buildInstanceForRange(ev, cur, dur, rangeStart, rangeEnd);
      if (inst) yield inst;
      const want = baseStart.getDate();
      cur = addMonths(cur, 1);
      if (cur.getDate() !== want){
        const tmp = new Date(cur.getFullYear(), cur.getMonth(), want, baseStart.getHours(), baseStart.getMinutes());
        if (tmp.getMonth() === cur.getMonth()) cur = tmp;
      }
    }
    return;
  }

  if (rep === "monthly_nth_weekday"){
    const base = new Date(baseStart);
    const nth = Math.floor((base.getDate()-1)/7)+1;
    const dow = base.getDay();
    let curMonth = new Date(base.getFullYear(), base.getMonth(), 1, base.getHours(), base.getMinutes());
    while (addMonths(curMonth, 0) < startOfDay(rangeStart)) curMonth = addMonths(curMonth, 1);
    while (curMonth < rangeEnd){
      const instStart = nthDowOfMonth(curMonth.getFullYear(), curMonth.getMonth(), dow, nth, base.getHours(), base.getMinutes());
      if (instStart){
        if (until && instStart >= until) break;
        const inst = buildInstanceForRange(ev, instStart, dur, rangeStart, rangeEnd);
        if (inst) yield inst;
      }
      curMonth = addMonths(curMonth, 1);
    }
  }
}

/* ---------- Build UI ---------- */
function renderWeekHeader(ws){
  const head = document.getElementById("days-head");
  head.innerHTML = "";
  const todayKey = dateKeyLocal(new Date());
  for (let i=0;i<7;i++){
    const d = addDays(ws, i);
    const key = dateKeyLocal(d);
    const cell = document.createElement("div");
    cell.className = "day-name";
    if (key === todayKey) cell.classList.add("is-today");
    cell.textContent = `${DAYS[i]} ${d.getMonth()+1}/${d.getDate()}`;
    head.appendChild(cell);
  }
}

function renderTimeCol(){
  const t = document.getElementById("time-body");
  t.innerHTML = "";
  for(let h=0; h<24; h++){
    const row = document.createElement("div");
    row.className = "tick";
    row.style.height = `${HOUR_PX}px`;
    row.textContent = formatHourLabel(h);
    row.addEventListener("click", ()=>{
      timeFormat = timeFormat === "24" ? "12" : "24";
      localStorage.setItem("timeFmt", timeFormat);
      renderTimeCol();
    });
    t.appendChild(row);
  }
  const spacer = document.querySelector(".time-head-spacer");
  if (spacer && !spacer._wired){
    spacer._wired = true;
    spacer.addEventListener("click", ()=>{
      timeFormat = timeFormat === "24" ? "12" : "24";
      localStorage.setItem("timeFmt", timeFormat);
      renderTimeCol();
    });
  }
}

function renderDayBodies(ws){
  const wrap = document.getElementById("days-wrap");
  wrap.innerHTML = "";
  for (let i=0;i<7;i++){
    const key = dateKeyLocal(addDays(ws,i));
    const body = document.createElement("div");
    body.className = "day-body";
    body.dataset.date = key;

    const grid = document.createElement("div");
    grid.className = "hour-grid";
    body.appendChild(grid);

    // Create by clicking empty space
    body.addEventListener("click", (ev)=>{
      if (ev.target.closest(".event-block")) return;
      const rect = body.getBoundingClientRect();
      let y = ev.clientY - rect.top;
      y = clamp(y, 0, body.scrollHeight - 1);
      let mins = Math.round((y / MINUTE_PX) / SNAP_MIN) * SNAP_MIN;
      mins = clamp(mins, 0, 1440 - SNAP_MIN);
      const start = `${key}T${pad2(Math.floor(mins/60))}:${pad2(mins%60)}`;
      const end   = `${key}T${pad2(Math.floor((mins+60)/60))}:${pad2((mins+60)%60)}`;
      openModal(null, key, { defaultStart: start, defaultEnd: end });
    });

    wrap.appendChild(body);
  }
  renderEvents();
}

/* ---------- Fragments + overlap ---------- */
function fragmentsForDay(dayKey, insts){
  const dayStart = fromKey(dayKey), dayEnd = addDays(dayStart, 1);
  const out = [];
  for (const inst of insts){
    const s = new Date(inst.start), e = new Date(inst.end);
    if (e <= dayStart || s >= dayEnd) continue;
    const startMin = Math.max(0, Math.floor((Math.max(s, dayStart) - dayStart) / 60000));
    const endMin   = Math.min(1440, Math.ceil((Math.min(e, dayEnd) - dayStart) / 60000));
    if (endMin <= startMin) continue;
    out.push({ ev: inst, id: inst.baseId, startMin, endMin });
  }
  return out;
}

function clusterRolesUpTo3(frags){
  const sorted = [...frags].sort((a,b)=>{
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    const da = a.endMin - a.startMin, db = b.endMin - b.startMin;
    return db - da;
  });
  const clusters = []; let cur = null;
  for (const fr of sorted){
    if (!cur || fr.startMin >= cur.maxEnd){
      cur = { items: [], maxEnd: fr.endMin };
      clusters.push(cur);
    }
    cur.items.push(fr);
    if (fr.endMin > cur.maxEnd) cur.maxEnd = fr.endMin;
  }
  const map = new Map();
  for (const cl of clusters){
    const items = cl.items.slice().sort((a,b)=>{
      const da=a.endMin-a.startMin, db=b.endMin-b.startMin;
      if (da!==db) return db-da;
      if (a.startMin!==b.startMin) return a.startMin-b.startMin;
      return (a.id+"").localeCompare(b.id+"");
    });
    if (items.length === 1){
      map.set(items[0].id+":"+items[0].startMin, { role:"primary" });
      continue;
    }
    map.set(items[0].id+":"+items[0].startMin, { role:"primary" });
    if (items[1]) map.set(items[1].id+":"+items[1].startMin, { role:"secondary1" });
    if (items[2]) map.set(items[2].id+":"+items[2].startMin, { role:"secondary2" });
    if (items.length > 3){
      const others = items.slice(3);
      others.forEach((fr,i)=> map.set(fr.id+":"+fr.startMin, { role:"equal", col:i, cols: others.length }));
    }
  }
  return map;
}

/* ---------- Live time label helper ---------- */
function setBlockTimeRange(block, dayKey, startMin, endMin){
  const s = new Date(`${dayKey}T${pad2(Math.floor(startMin/60))}:${pad2(startMin%60)}`);
  const e = new Date(`${dayKey}T${pad2(Math.floor(endMin/60))}:${pad2(endMin%60)}`);
  const el = block.querySelector(".time");
  if (el) el.textContent = `${hhmm(s, timeFormat!=="24")} – ${hhmm(e, timeFormat!=="24")}`;
}

function buildBlockFromFragment(fr, dayKey, roleRec){
  const duration = fr.endMin - fr.startMin;
  const heightPx = Math.max(18, duration * MINUTE_PX);

  const block = document.createElement("div");
  block.className = `event-block category-${fr.ev.category.toLowerCase()}`;
  block.style.top = `${fr.startMin * MINUTE_PX}px`;
  block.style.height = `${heightPx}px`;
  block.dataset.id = fr.ev.baseId;
  block.dataset.day = dayKey;
  block.dataset.startMin = fr.startMin;
  block.dataset.endMin = fr.endMin;
  block.dataset.instanceKey = fr.ev.instanceKey || "";
  block.style.zIndex = String(zForDuration(duration));

  const setLW = (leftPct, widthPct)=>{
    block.style.left = `calc(${leftPct}% + ${EVENT_X_GAP}px)`;
    block.style.width = `calc(${widthPct}% - ${EVENT_X_GAP*2}px)`;
    block.style.right = "auto";
  };
  if (!roleRec || roleRec.role === "primary"){ block.style.left=`${EVENT_X_GAP}px`; block.style.right=`${EVENT_X_GAP}px`; }
  else if (roleRec.role === "secondary1"){ setLW(25,75); }
  else if (roleRec.role === "secondary2"){ setLW(50,50); }
  else if (roleRec.role === "equal"){ const widthPct=100/roleRec.cols, leftPct=widthPct*roleRec.col; setLW(leftPct,widthPct); }

  const fragStart = new Date(`${dayKey}T${pad2(Math.floor(fr.startMin/60))}:${pad2(fr.startMin%60)}`);
  const fragEnd   = new Date(`${dayKey}T${pad2(Math.floor(fr.endMin/60))}:${pad2(fr.endMin%60)}`);
  const instanceKey = block.dataset.instanceKey || null;
  const baseId = fr.ev.baseId;
  const repeat = fr.ev.repeat || "none";

  const content = document.createElement("div"); content.className = "content";
  const titleEl = document.createElement("div"); titleEl.className = "title"; titleEl.textContent = fr.ev.title;
  const timeEl  = document.createElement("div"); timeEl.className = "time";  timeEl.textContent = `${hhmm(fragStart, timeFormat!=="24")} – ${hhmm(fragEnd, timeFormat!=="24")}`;
  content.append(titleEl, timeEl);
  const rt = document.createElement("div"); rt.className = "resize-top";
  const rb = document.createElement("div"); rb.className = "resize-bottom";
  block.append(content, rt, rb);

  applyCompactMode(block); new ResizeObserver(()=>applyCompactMode(block)).observe(block);

  let downXY = null, dragging = false, pointerId = null;

  block.addEventListener("pointerdown", (e)=>{
    if (e.target.classList.contains("resize-top") || e.target.classList.contains("resize-bottom")) return;
    e.preventDefault(); e.stopPropagation();
    pointerId = e.pointerId;
    downXY = { x: e.clientX, y: e.clientY };
    dragging = false;
    block.setPointerCapture?.(e.pointerId);
  });

  block.addEventListener("pointermove", (e)=>{
    if (pointerId !== e.pointerId || !downXY) return;
    const dx = Math.abs(e.clientX - downXY.x);
    const dy = Math.abs(e.clientY - downXY.y);
    if (dx > CLICK_DRAG_THRESHOLD || dy > CLICK_DRAG_THRESHOLD){
      dragging = true; downXY = null;
      const durationMin = fr.endMin - fr.startMin;
      startDragMoveInstance({ baseId, instanceKey, title: fr.ev.title, category: fr.ev.category, repeat, durationMin }, block, dayKey, e);
    }
  });

  block.addEventListener("pointerup", (e)=>{
    if (pointerId !== e.pointerId) return;
    block.releasePointerCapture?.(e.pointerId);
    const wasClick = downXY && !dragging;
    downXY = null; dragging = false; pointerId = null;
    if (wasClick){
      openModal({ id: baseId, baseId, instanceKey, title: fr.ev.title, category: fr.ev.category, start: fragStart, end: fragEnd, repeat }, dayKey);
    }
  });

  rt.addEventListener("pointerdown", (e)=>{ e.preventDefault(); e.stopPropagation(); startResizeInstance({ baseId, instanceKey, anchor:"top" }, block, dayKey, e); });
  rb.addEventListener("pointerdown", (e)=>{ e.preventDefault(); e.stopPropagation(); startResizeInstance({ baseId, instanceKey, anchor:"bottom" }, block, dayKey, e); });

  return block;
}

/* ---------- Render events ---------- */
function renderEvents(){
  const rangeStart = startOfDay(currentWeekStart);
  const rangeEnd   = endOfWeekLocal(currentWeekStart);

  const instances = [];
  for (const ev of events){
    for (const inst of expandRepeats(ev, rangeStart, rangeEnd)){
      instances.push({
        id: ev.id + "|" + (inst.instanceKey || inst.start.toISOString()),
        baseId: ev.id,
        title: inst.title,
        category: inst.category,
        start: inst.start,
        end: inst.end,
        repeat: ev.repeat,
        instanceKey: inst.instanceKey || null
      });
    }
  }

  document.querySelectorAll(".event-block").forEach(n=>n.remove());

  document.querySelectorAll(".day-body").forEach(day=>{
    const dayKey = day.dataset.date;
    const todays = instances.filter(x => x.end > fromKey(dayKey) && x.start < addDays(fromKey(dayKey),1));
    const frags  = fragmentsForDay(dayKey, todays);
    const roles  = clusterRolesUpTo3(frags);
    for (const fr of frags){
      const rec = roles.get(fr.id+":"+fr.startMin);
      day.appendChild(buildBlockFromFragment(fr, dayKey, rec));
    }
  });

  renderCurrentTimeLine();
  computeActivitiesHoursBeforeNow();
}

/* ---------- Helpers for wrap ---------- */
function allDayBodies(){
  return Array.from(document.querySelectorAll(".day-body"));
}
function dayBodyAtX(clientX){
  const days = allDayBodies();
  for (const d of days){
    const r = d.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) return d;
  }
  return null;
}
function prevDayBody(d){ const days=allDayBodies(); const i=days.indexOf(d); return i>0 ? days[i-1] : null; }
function nextDayBody(d){ const days=allDayBodies(); const i=days.indexOf(d); return i>=0 && i<days.length-1 ? days[i+1] : null; }

/* ---------- Move (wrap within week + prompts scope for repeats) ---------- */
async function startDragMoveInstance(meta, block, originDayKey, pDown){
  const durationMin = Number(meta.durationMin ?? (Number(block.dataset.endMin) - Number(block.dataset.startMin))) || 60;

  const rectAtDown = block.getBoundingClientRect();
  const grabOffsetY = pDown.clientY - rectAtDown.top;

  block.setPointerCapture?.(pDown.pointerId);
  block.classList.add("dragging");

  let currentParent = block.parentElement;
  let currentTopPx  = parseFloat(block.style.top) || 0;

  function getDayBodyUnderPointer(ev){
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    let over = el ? el.closest(".day-body") : null;
    if (!over) over = dayBodyAtX(ev.clientX); // snap to nearest column by X if we're in the gutter
    return over;
  }

  function pointerMove(ev){
    let over = getDayBodyUnderPointer(ev) || currentParent;
    if (over !== currentParent){
      currentParent = over;
      over.appendChild(block);
    }
    let rect = over.getBoundingClientRect();

    // Provisional Y relative to the 'over' day
    let y = ev.clientY - rect.top - grabOffsetY;

    // Vertical wrap: move across days while y spills out
    while (y < 0){
      const prev = prevDayBody(over);
      if (!prev) break; // week boundary
      over = prev; currentParent = over; over.appendChild(block);
      rect = over.getBoundingClientRect();
      y += rect.height;
    }
    while (y > rect.height){
      const nxt = nextDayBody(over);
      if (!nxt) break; // week boundary
      y -= rect.height; over = nxt; currentParent = over; over.appendChild(block);
      rect = over.getBoundingClientRect();
    }

    // Snap to grid and apply
    const mins = Math.round((y / MINUTE_PX) / SNAP_MIN) * SNAP_MIN;
    const startMin = clamp(mins, 0, 1440 - SNAP_MIN);
    const endMin = Math.min(1440, startMin + durationMin);
    currentTopPx = startMin * MINUTE_PX;
    block.style.top = `${currentTopPx}px`;

    // LIVE label update
    setBlockTimeRange(block, currentParent.dataset.date, startMin, endMin);
  }

  async function pointerUp(){
    block.classList.remove("dragging");
    block.releasePointerCapture?.(pDown.pointerId);
    window.removeEventListener("pointermove", pointerMove);
    window.removeEventListener("pointerup", pointerUp);

    const dayKey = currentParent?.dataset?.date || originDayKey;
    let startMin = Math.round((currentTopPx / MINUTE_PX) / SNAP_MIN) * SNAP_MIN;
    startMin = clamp(startMin, 0, 1440 - SNAP_MIN);
    const endMin = Math.min(1440, startMin + durationMin);

    const newStartISO = `${dayKey}T${pad2(Math.floor(startMin/60))}:${pad2(startMin%60)}`;
    const newEndISO   = `${dayKey}T${pad2(Math.floor(endMin/60))}:${pad2(endMin%60)}`;

    const base = events.find(e => e.id === meta.baseId);
    if (!base){ renderEvents(); return; }

    // Ask scope when moving a repeating instance
    if (base.repeat && base.repeat !== "none" && meta.instanceKey){
      const scope = await askRepeatScope("edit");
      if (scope === "cancel" || scope === "escape"){ renderEvents(); return; }

      if (scope === "future"){
        base.until = meta.instanceKey;
        const id = Date.now().toString(36)+Math.random().toString(36).slice(2,5);
        events.push({
          id,
          title: base.title,
          category: base.category,
          start: newStartISO,
          end: newEndISO,
          repeat: base.repeat,
          exDates: [],
          overrides: {}
        });
      } else { // "Only this"
        base.overrides = base.overrides || {};
        base.overrides[meta.instanceKey] = { ...(base.overrides[meta.instanceKey]||{}), start: newStartISO, end: newEndISO };
      }
    } else {
      base.start = newStartISO; base.end = newEndISO;
    }

    renderEvents();
  }

  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
}

/* ---------- Resize (wrap within week + prompts scope for repeats) ---------- */
async function startResizeInstance(meta, block, dayKey, pDown){
  const anchor = meta.anchor; // "top" or "bottom"
  block.setPointerCapture?.(pDown.pointerId);
  block.classList.add("dragging");

  let currentParent = block.parentElement;

  let startTop = parseFloat(block.style.top)||0;
  let startH   = parseFloat(block.style.height)||block.offsetHeight;

  function pointerMove(ev){
    // Snap to a column under pointer X if in gutter
    const overByX = dayBodyAtX(ev.clientX);
    if (overByX && overByX !== currentParent){
      currentParent = overByX;
      overByX.appendChild(block);
    }
    let rect = currentParent.getBoundingClientRect();

    let y = ev.clientY - rect.top;

    if (anchor === "top"){
      // Wrap upwards
      while (y < 0){
        const prev = prevDayBody(currentParent);
        if (!prev) break;
        currentParent = prev; prev.appendChild(block);
        rect = currentParent.getBoundingClientRect();
        y += rect.height;
        const delta = startTop;
        startTop = 0;
        startH += delta;
      }
      const snapMin = Math.round((y) / MINUTE_PX / SNAP_MIN) * SNAP_MIN;
      const snapY = clamp(snapMin, 0, 1440 - SNAP_MIN) * MINUTE_PX;

      const newHeight = clamp(startH + (startTop - snapY), MINUTE_PX*SNAP_MIN, currentParent.scrollHeight);
      block.style.top = `${snapY}px`;
      block.style.height = `${newHeight}px`;
    } else {
      // Wrap downwards
      while (y > rect.height){
        const nxt = nextDayBody(currentParent);
        if (!nxt) break;
        y -= rect.height; currentParent = nxt; nxt.appendChild(block);
        rect = currentParent.getBoundingClientRect();
      }
      const snapMin = Math.round((y) / MINUTE_PX / SNAP_MIN) * SNAP_MIN;
      const snapY = clamp(snapMin, 0, 1440) * MINUTE_PX;

      const newHeight = clamp(snapY - startTop, MINUTE_PX*SNAP_MIN, currentParent.scrollHeight);
      block.style.height = `${newHeight}px`;
    }

    // LIVE label update
    const topPx = parseFloat(block.style.top)||0;
    const heightPx = parseFloat(block.style.height)||block.offsetHeight;
    const startMin = clamp(Math.round(topPx / MINUTE_PX), 0, 1440 - SNAP_MIN);
    const endMin   = clamp(Math.round((topPx + heightPx) / MINUTE_PX), startMin + SNAP_MIN, 1440);
    setBlockTimeRange(block, currentParent.dataset.date, startMin, endMin);
  }

  async function pointerUp(){
    block.classList.remove("dragging");
    block.releasePointerCapture?.(pDown.pointerId);
    window.removeEventListener("pointermove", pointerMove);
    window.removeEventListener("pointerup", pointerUp);

    const finalDayKey = currentParent.dataset.date;
    const topPx = parseFloat(block.style.top)||0;
    const heightPx = parseFloat(block.style.height)||block.offsetHeight;
    let startMin = Math.round((topPx / MINUTE_PX) / SNAP_MIN) * SNAP_MIN;
    let endMin   = Math.round(((topPx + heightPx) / MINUTE_PX) / SNAP_MIN) * SNAP_MIN;
    startMin = clamp(startMin, 0, 1440 - SNAP_MIN);
    endMin   = clamp(endMin, startMin + SNAP_MIN, 1440);

    const newStartISO = `${finalDayKey}T${pad2(Math.floor(startMin/60))}:${pad2(startMin%60)}`;
    const newEndISO   = `${finalDayKey}T${pad2(Math.floor(endMin/60))}:${pad2(endMin%60)}`;

    const base = events.find(e => e.id === meta.baseId);
    if (!base){ renderEvents(); return; }

    if (base.repeat && base.repeat !== "none" && meta.instanceKey){
      const scope = await askRepeatScope("edit");
      if (scope === "cancel" || scope === "escape"){ renderEvents(); return; }

      if (scope === "future"){
        base.until = meta.instanceKey;
        const id = Date.now().toString(36)+Math.random().toString(36).slice(2,5);
        events.push({
          id,
          title: base.title,
          category: base.category,
          start: newStartISO,
          end: newEndISO,
          repeat: base.repeat,
          exDates: [],
          overrides: {}
        });
      } else { // "Only this"
        base.overrides = base.overrides || {};
        base.overrides[meta.instanceKey] = { ...(base.overrides[meta.instanceKey]||{}), start: newStartISO, end: newEndISO };
      }
    } else {
      base.start = newStartISO; base.end = newEndISO;
    }

    renderEvents();
  }

  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
}

/* ---------- Modal & confirm ---------- */
const modal = document.getElementById("modal");
const form  = document.getElementById("modal-form");
const modalAccent = document.getElementById("modal-accent");
let editingMeta = null;

function getSelectedCategory(){ const r=document.querySelector('input[name="modal-cat"]:checked'); return r ? r.value : "School"; }
function setSelectedCategory(cat){ const el=document.querySelector(`input[name="modal-cat"][value="${cat}"]`) || document.querySelector('input[name="modal-cat"][value="School"]'); if(el) el.checked=true; updateModalAccent(cat); }
function getCategoryColor(cat){
  const css = (k)=> getComputedStyle(document.documentElement).getPropertyValue(k) || "";
  switch((cat||"").toLowerCase()){
    case "school": return css("--school") || "#1e88e5";
    case "activities": return css("--activities") || "#e53935";
    case "personal": return css("--personal") || "#43a047";
    default: return "#888";
  }
}
function updateModalAccent(cat){ modalAccent.style.background = getCategoryColor(cat); }

function buildRepeatLabels(dt){
  const d=new Date(dt);
  const nth=Math.floor((d.getDate()-1)/7)+1;
  const s=["th","st","nd","rd"], v=(n)=>{ const m=n%100; return n + (s[(m-20)%10]||s[m]||s[0]); };
  const weekday=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
  const month=["January","February","March","April","May","June","July","August","September","October","November","December"][d.getMonth()];
  return {
    weekly:`Weekly on ${weekday}`,
    mday:`Monthly on the ${v(d.getDate())}`,
    mnth:`Monthly on the ${v(nth)} ${weekday}`,
    yearly:`Yearly on ${month} ${v(d.getDate())}`
  };
}
function refreshRepeatLabels(){
  const v=document.getElementById("modal-start").value; if(!v) return;
  const L=buildRepeatLabels(new Date(v));
  const rep=document.getElementById("modal-repeat");
  for(const opt of rep.options){
    if(opt.value==="weekly") opt.textContent=L.weekly;
    if(opt.value==="monthly_day") opt.textContent=L.mday;
    if(opt.value==="monthly_nth_weekday") opt.textContent=L.mnth;
    if(opt.value==="yearly") opt.textContent=L.yearly;
  }
}

function openModal(instanceOrNull, dateKey, opts={}){
  modal.style.display = "grid";
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");

  if (instanceOrNull){
    const inst = instanceOrNull;
    const baseId = inst.baseId || inst.id;
    const instanceKey = inst.instanceKey || null; // IMPORTANT: true base key
    editingMeta = {
      baseId, instanceKey,
      isRepeating: !!(inst.repeat && inst.repeat !== "none")
    };
    document.getElementById("modal-title-text").textContent = "Edit Event";
    document.getElementById("modal-title").value = inst.title;
    document.getElementById("modal-start").value = (inst.start instanceof Date)? toLocalInputValue(inst.start) : inst.start;
    document.getElementById("modal-end").value   = (inst.end   instanceof Date)? toLocalInputValue(inst.end)   : inst.end;
    setSelectedCategory(inst.category);
    document.getElementById("modal-repeat").value = inst.repeat || "none";
    document.getElementById("modal-delete").style.display = "inline-block";
  } else {
    editingMeta = { baseId:null, instanceKey:null, isRepeating:false };
    document.getElementById("modal-title-text").textContent = "Add Event";
    form.reset();
    const start = opts.defaultStart || `${dateKey}T12:00`;
    const end   = opts.defaultEnd   || `${dateKey}T13:00`;
    document.getElementById("modal-title").value = "";
    document.getElementById("modal-start").value = start;
    document.getElementById("modal-end").value   = end;
    setSelectedCategory("School");
    document.getElementById("modal-repeat").value = "none";
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

document.getElementById("modal-cancel").onclick = ()=> closeModal();
document.getElementById("modal-backdrop").onclick = ()=> closeModal();
document.getElementById("modal-category-group").addEventListener("change", ()=> updateModalAccent(getSelectedCategory()));
document.getElementById("modal-start").addEventListener("change", refreshRepeatLabels);

/* Delete with scope for repeating events */
document.getElementById("modal-delete").onclick = async ()=>{
  if (!editingMeta) return;
  const base = events.find(e => e.id === editingMeta.baseId);
  if (!base) return closeModal();

  if (base.repeat && base.repeat !== "none" && editingMeta.instanceKey){
    const scope = await askRepeatScope("delete");
    if (scope === "cancel" || scope === "escape") return;
    const instKey = editingMeta.instanceKey;

    if (scope === "future"){
      base.until = instKey; // stop series at this occurrence (keeps chain)
    } else if (scope === "single"){
      base.exDates = base.exDates || [];
      if (!base.exDates.includes(instKey)) base.exDates.push(instKey);
      if (base.overrides && base.overrides[instKey]) delete base.overrides[instKey];
    }
  } else {
    const r = await showConfirm({
      title: "Delete event",
      message: "Are you sure you want to delete this event?",
      buttons: [
        { id:"cancel", label:"Cancel", variant:"neutral" },
        { id:"ok",     label:"Delete", variant:"danger" },
      ]
    });
    if (r !== "ok") return;
    const i = events.findIndex(e => e.id === base.id);
    if (i >= 0) events.splice(i,1);
  }

  closeModal();
  renderEvents();
};

/* Save — prompt scope when editing a repeating event (modal flow) */
form.onsubmit = async (e)=>{
  e.preventDefault();
  const title = document.getElementById("modal-title").value.trim();
  const start = document.getElementById("modal-start").value;
  const end   = document.getElementById("modal-end").value;
  const category = getSelectedCategory();
  const repeat   = document.getElementById("modal-repeat").value || "none";

  if (!title) return;
  if (new Date(end) <= new Date(start)){ alert("End must be after start"); return; }

  if (!editingMeta || !editingMeta.baseId){
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    const base = { id, title, start, end, category, repeat, exDates: [], overrides: {} };
    events.push(base);
  } else {
    const base = events.find(e => e.id === editingMeta.baseId);
    if (!base) { closeModal(); return; }

    if (base.repeat && base.repeat !== "none" && editingMeta.instanceKey){
      const scope = await askRepeatScope("edit");
      if (scope === "cancel" || scope === "escape"){ closeModal(); return; }

      if (scope === "future"){
        base.until = editingMeta.instanceKey;
        const id = Date.now().toString(36)+Math.random().toString(36).slice(2,5);
        events.push({ id, title, start, end, category, repeat, exDates: [], overrides: {} });
      } else { // "Only this" — per-instance override
        base.overrides = base.overrides || {};
        base.overrides[editingMeta.instanceKey] = { start, end, title, category };
      }
    } else {
      base.title = title; base.category = category; base.repeat = repeat;
      base.start = start; base.end = end;
      if (!base.exDates) base.exDates = [];
      if (!base.overrides) base.overrides = {};
    }
  }

  closeModal();
  renderEvents();
};

/* ---------- Confirm helpers ---------- */
async function showConfirm({ title="Confirm", message="", buttons=[] } = {}){
  return new Promise(resolve=>{
    const root = document.getElementById("confirm-root");
    const backdrop = document.getElementById("confirm-backdrop");
    const titleEl = document.getElementById("confirm-title");
    const msgEl   = document.getElementById("confirm-message");
    const actions = document.getElementById("confirm-actions");
    titleEl.textContent = title; msgEl.textContent = message; actions.innerHTML = "";
    const make = ({ id, label, variant })=>{
      const b=document.createElement("button"); b.textContent=label; b.className="btn";
      if (variant==="primary") b.classList.add("btn-primary");
      else if (variant==="danger") b.classList.add("btn-danger");
      else if (variant==="warning") b.classList.add("btn-warning");
      actions.appendChild(b); b.onclick=()=>done(id);
    };
    buttons.forEach(make);
    function key(e){ if (e.key==="Escape") done("escape"); }
    function done(res){ root.classList.add("hidden"); root.setAttribute("aria-hidden","true"); document.removeEventListener("keydown",key); backdrop.onclick=null; resolve(res); }
    root.classList.remove("hidden"); root.setAttribute("aria-hidden","false");
    document.addEventListener("keydown",key); backdrop.onclick=()=>done("cancel");
  });
}

/* Ask scope when editing/deleting repeats — “This & future” first (left-most) */
async function askRepeatScope(kind="edit"){
  const title = kind==="edit" ? "Edit repeating event" : "Delete repeating event";
  const message = kind==="edit"
    ? "Apply changes to this and all future occurrences, or only this occurrence?"
    : "Delete this and all future occurrences, or only this occurrence?";
  return await showConfirm({
    title, message,
    buttons: [
      { id:"future", label:"This & future", variant:"danger"  }, // left-most
      { id:"single", label:"Only this",     variant:"warning" },
      { id:"cancel", label:"Cancel",        variant:"neutral" }
    ]
  });
}

/* ---------- Compact thresholds ---------- */
function applyCompactMode(block){
  const h = block.getBoundingClientRect().height;
  block.classList.remove("compact","tiny","very-short","micro");
  if (h <= 10) block.classList.add("micro");
  else if (h <= 16) block.classList.add("very-short");
  else if (h <= 26) block.classList.add("tiny");
  else if (h <= 36) block.classList.add("compact");
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", ()=>{
  applySystemTheme();
  wireThemeListener();

  // controls
  const prev = document.getElementById("prev-week");
  const next = document.getElementById("next-week");
  const today= document.getElementById("today");
  if (prev)  prev.onclick  = ()=>{ currentWeekStart = addDays(currentWeekStart, -7); renderWeek(); };
  if (next)  next.onclick  = ()=>{ currentWeekStart = addDays(currentWeekStart,  7); renderWeek(); };
  if (today) today.onclick = ()=>{ currentWeekStart = startOfWeekLocal(new Date()); renderWeek(); };

  // shortcuts
  document.addEventListener("keydown",(e)=>{
    if (e.target && ["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
    if (e.key === "ArrowLeft")  { currentWeekStart = addDays(currentWeekStart,-7); renderWeek(); }
    if (e.key === "ArrowRight") { currentWeekStart = addDays(currentWeekStart, 7); renderWeek(); }
    if (e.key.toLowerCase() === "t") { currentWeekStart = startOfWeekLocal(new Date()); renderWeek(); }
    if (e.key.toLowerCase() === "n") { const todayKey = dateKeyLocal(new Date()); openModal(null, todayKey); }
  });

  renderWeek();

  // keep now-line & hidden hours fresh
  setInterval(()=>{ renderCurrentTimeLine(); computeActivitiesHoursBeforeNow(); }, 60000);
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden){ renderCurrentTimeLine(); computeActivitiesHoursBeforeNow(); }});
});

function renderWeek(){
  labelWeek();
  renderWeekHeader(currentWeekStart);
  renderTimeCol();
  renderDayBodies(currentWeekStart);
}

