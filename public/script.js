// Dorado Calendar — stable week view, overlap roles, local time writes,
// modal above grid with colored category pills & primary/danger buttons.

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOUR_PX = 40;
const MINUTE_PX = HOUR_PX / 60;
const SNAP_MIN = 15;
const EV_GAP_PX = 6;

const pad2 = n => String(n).padStart(2,"0");
const hhmm = d => new Date(d).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});

// Local helpers (avoid ISO/UTC issues)
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfWeekLocal(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-x.getDay()); return x; }
function endOfWeekLocal(d){ const s=startOfWeekLocal(d); const e=new Date(s); e.setDate(e.getDate()+7); return e; }
function dateKeyLocal(d){ const x=new Date(d); x.setHours(0,0,0,0); return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`; }
function fromKey(key){ return new Date(`${key}T00:00`); }
function localStr(key,mins){ const h=Math.floor(mins/60), m=mins%60; return `${key}T${pad2(h)}:${pad2(m)}`; }

function zForDuration(mins){ return 1000 + Math.max(1, 1440 - Math.min(1440, Math.round(mins))); }

let currentWeekStart = startOfWeekLocal(new Date());
let events = [];
let justDragged = false;

/* ===== Frame ===== */
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
function renderTimeCol(){
  const t = document.getElementById("time-body"); t.innerHTML="";
  for(let h=0; h<24; h++){
    const row = document.createElement("div");
    row.className = "tick";
    row.style.height = `${HOUR_PX}px`;
    row.textContent = `${pad2(h)}:00`;
    t.appendChild(row);
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

    body.addEventListener("click",()=>openModal(null, key));
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

/* ===== Modal ===== */
const modal = document.getElementById("modal");
const form  = document.getElementById("modal-form");
const modalDialog = document.getElementById("modal-dialog");
const modalAccent = document.getElementById("modal-accent");
let editingId = null;

function getSelectedCategory(){
  const r = document.querySelector('input[name="modal-cat"]:checked');
  return r ? r.value : "Personal";
}
function setSelectedCategory(cat){
  const sel = document.querySelector(`input[name="modal-cat"][value="${cat}"]`);
  (sel || document.querySelector('input[name="modal-cat"][value="Personal"]')).checked = true;
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

function openModal(event, dateKey){
  if (justDragged){ justDragged = false; return; }
  modal.style.display = "grid";
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");
  document.getElementById("modal-title-text").textContent = event ? "Edit Event" : "Add Event";

  if(event){
    editingId = event.id;
    document.getElementById("modal-title").value   = event.title;
    document.getElementById("modal-start").value   = event.start;
    document.getElementById("modal-end").value     = event.end;
    setSelectedCategory(event.category);
    document.getElementById("modal-delete").style.display = "inline-block";
  }else{
    editingId = null;
    form.reset();
    const start = `${dateKey}T12:00`;
    const end   = `${dateKey}T13:00`;
    document.getElementById("modal-title").value   = "";
    document.getElementById("modal-start").value   = start;
    document.getElementById("modal-end").value     = end;
    setSelectedCategory("Personal");
    document.getElementById("modal-delete").style.display = "none";
  }
}
function closeModal(){
  modal.style.display = "none";
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
  form.reset();
}
document.getElementById("modal-cancel").onclick = ()=>closeModal();
document.getElementById("modal-backdrop").onclick = ()=>closeModal();
document.getElementById("modal-delete").onclick = ()=>{
  events = events.filter(e => e.id !== editingId);
  closeModal();
  renderEvents();
};

// update accent when user picks a category pill
document.getElementById("modal-category-group").addEventListener("change", ()=>{
  updateModalAccent(getSelectedCategory());
});

form.onsubmit = (e)=>{
  e.preventDefault();
  const title    = document.getElementById("modal-title").value.trim();
  const start    = document.getElementById("modal-start").value;
  const end      = document.getElementById("modal-end").value;
  const category = getSelectedCategory();
  if(!title) return;
  if(new Date(end) <= new Date(start)){ alert("End must be after start"); return; }

  if(editingId){
    const ev = events.find(x => x.id === editingId);
    Object.assign(ev, {title, start, end, category});
  }else{
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    events.push({id, title, start, end, category});
  }
  closeModal();
  renderEvents();
};

/* ===== Per-day fragments ===== */
function fragmentsForDay(dayKey, allEvents){
  const dayStart = fromKey(dayKey), dayEnd = addDays(dayStart,1);
  const out = [];
  for(const ev of allEvents){
    const s = new Date(ev.start), e = new Date(ev.end);
    if(e <= dayStart || s >= dayEnd) continue;
    const startMin = Math.max(0, Math.floor((Math.max(s,dayStart) - dayStart)/60000));
    const endMin   = Math.min(24*60, Math.ceil((Math.min(e,dayEnd)   - dayStart)/60000));
    if(endMin <= startMin) continue;
    out.push({ ev, id: ev.id, startMin, endMin });
  }
  return out;
}

/* ===== Overlap roles: primary/full, secondary1 75%@25%, secondary2 50%@50%, 4+ equal ===== */
function clusterRolesUpTo3(frags){
  const sorted = [...frags].sort((a,b)=>{
    if(a.startMin !== b.startMin) return a.startMin - b.startMin;
    const da=a.endMin-a.startMin, db=b.endMin-b.startMin;
    return db - da; // longest first
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

/* ===== Build event block ===== */
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
  block.style.zIndex = String(zForDuration(duration)); // shorter on top

  const setLW = (leftPct, widthPct)=>{
    block.style.left  = `calc(${leftPct}% + ${EV_GAP_PX}px)`;
    block.style.width = `calc(${widthPct}% - ${EV_GAP_PX*2}px)`;
    block.style.right = "auto";
  };

  if(!roleRec || roleRec.role==="primary"){
    block.style.left  = `${EV_GAP_PX}px`;
    block.style.right = `${EV_GAP_PX}px`;
    block.style.width = "";
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
  const content = document.createElement("div"); content.className="content";
  const titleEl = document.createElement("div"); titleEl.className="title"; titleEl.textContent = fr.ev.title;
  const timeEl  = document.createElement("div"); timeEl.className="time";  timeEl.textContent  = `${hhmm(fragStart)} – ${hhmm(fragEnd)}`;
  content.append(titleEl,timeEl);

  const rt = document.createElement("div"); rt.className="resize-top";
  const rb = document.createElement("div"); rb.className="resize-bottom";
  block.append(content, rt, rb);

  applyCompactMode(block);
  new ResizeObserver(()=>applyCompactMode(block)).observe(block);

  block.addEventListener("click", ev => { ev.stopPropagation(); if(!justDragged) openModal(fr.ev, dayKey); });
  block.addEventListener("pointerdown", ev => {
    const tgt = ev.target;
    if(tgt.classList.contains("resize-top") || tgt.classList.contains("resize-bottom")) return;
    ev.preventDefault(); ev.stopPropagation();
    startDragMoveFragment(fr, block, dayKey, ev);
  });
  rt.addEventListener("pointerdown", ev => { ev.preventDefault(); ev.stopPropagation(); startResizeFragment(fr, block, dayKey, "top", ev); });
  rb.addEventListener("pointerdown", ev => { ev.preventDefault(); ev.stopPropagation(); startResizeFragment(fr, block, dayKey, "bottom", ev); });

  return block;
}

function renderEvents(){
  document.querySelectorAll(".event-block").forEach(n=>n.remove());
  document.querySelectorAll(".day-body").forEach(b=>{
    const dayKey = b.dataset.date;
    const frags = fragmentsForDay(dayKey, events);
    const roles = clusterRolesUpTo3(frags);
    for(const fr of frags){
      const rec = roles.get(fr.id + ":" + fr.startMin);
      b.appendChild(buildBlockFromFragment(fr, dayKey, rec));
    }
  });
}

/* ===== Compact sizing ===== */
function applyCompactMode(block){
  const h = block.getBoundingClientRect().height;
  block.classList.remove("compact","tiny","very-short","micro");
  if (h <= 8) block.classList.add("micro");
  else if (h <= 12) block.classList.add("very-short");
  else if (h <= 22) block.classList.add("tiny");
  else if (h <= 30) block.classList.add("compact");
}

/* ===== Drag / Resize (pointer capture + local writes) ===== */
function startDragMoveFragment(fr, block, dayKey, pDown){
  const startY = pDown.clientY;
  const initTopPx = parseFloat(block.style.top) || 0;
  const fragDurMin = fr.endMin - fr.startMin;
  let targetBody = block.closest(".day-body");
  let moved=false;

  const originalZ = block.style.zIndex;
  block.style.zIndex = "9999";
  block.setPointerCapture(pDown.pointerId);
  document.body.style.userSelect = "none";
  document.body.style.cursor = "grabbing";

  let raf=null;
  const onMove = (ev)=>{
    const dy = ev.clientY - startY;
    if(!raf){
      raf=requestAnimationFrame(()=>{
        const propMin = Math.round((initTopPx + dy)/MINUTE_PX);
        const snapped = Math.round(propMin/SNAP_MIN)*SNAP_MIN;
        const clamped = Math.max(0, Math.min(24*60 - fragDurMin, snapped));
        block.style.top = `${clamped*MINUTE_PX}px`;

        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const u = el ? (el.closest(".day-body") || targetBody) : targetBody;
        if(u && u!==targetBody){ targetBody=u; targetBody.appendChild(block); }

        moved=true; justDragged=true;

        const s = new Date(localStr(targetBody.dataset.date, clamped));
        const en= new Date(localStr(targetBody.dataset.date, clamped+fragDurMin));
        const t = block.querySelector(".time"); if(t) t.textContent = `${hhmm(s)} – ${hhmm(en)}`;

        applyCompactMode(block);
        raf=null;
      });
    }
  };
  const onUp = ()=>{
    block.releasePointerCapture(pDown.pointerId);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup",   onUp);
    document.body.style.userSelect=""; document.body.style.cursor="";

    if(!moved){ block.style.zIndex=originalZ; justDragged=false; return; }

    const newTopMin = Math.round((parseFloat(block.style.top)||0)/MINUTE_PX);
    const ev = fr.ev;
    const duration = (new Date(ev.end) - new Date(ev.start))/60000;
    ev.start = localStr(targetBody.dataset.date, newTopMin);
    ev.end   = localStr(targetBody.dataset.date, newTopMin + duration);

    block.style.zIndex = String(zForDuration(duration));
    setTimeout(()=>{ justDragged=false; },120);
    renderEvents();
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup",   onUp);
}

function startResizeFragment(fr, block, fixedDayKey, edge, pDown){
  const startY = pDown.clientY;
  const initTopPx = parseFloat(block.style.top) || 0;
  const initHpx   = parseFloat(block.style.height) || (60*MINUTE_PX);
  const initTopMin= Math.round(initTopPx/MINUTE_PX);
  const initDurMin= Math.max(5, Math.round(initHpx/MINUTE_PX));
  let curTop=initTopMin, curDur=initDurMin;

  const originalZ = block.style.zIndex;
  block.style.zIndex = "9999";
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
          const boundedTop = Math.max(0, Math.min(initTopMin+initDurMin-5, snappedTop));
          curTop=boundedTop;
          curDur=Math.max(5, initDurMin-(curTop-initTopMin));
          block.style.top = `${curTop*MINUTE_PX}px`;
          block.style.height = `${curDur*MINUTE_PX}px`;
        }else{
          const nextDur = initDurMin + Math.round(dy/MINUTE_PX);
          const snappedDur = Math.round(nextDur/SNAP_MIN)*SNAP_MIN;
          const maxDur=(24*60)-initTopMin;
          curDur=Math.max(5, Math.min(maxDur, snappedDur));
          block.style.height = `${curDur*MINUTE_PX}px`;
        }
        const s=new Date(localStr(fixedDayKey, curTop));
        const en=new Date(localStr(fixedDayKey, curTop+curDur));
        const t=block.querySelector(".time"); if(t) t.textContent = `${hhmm(s)} – ${hhmm(en)}`;
        applyCompactMode(block);
        justDragged=true;
        raf=null;
      });
    }
  };
  const onUp = ()=>{
    block.releasePointerCapture(pDown.pointerId);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup",   onUp);
    document.body.style.userSelect=""; document.body.style.cursor="";

    const ev = fr.ev;
    if(edge==="top"){
      const newStart = localStr(fixedDayKey, curTop);
      ev.start = newStart;
      if(new Date(ev.end) <= new Date(newStart)) ev.end = localStr(fixedDayKey, curTop+5);
    }else{
      const newEnd = localStr(fixedDayKey, curTop+curDur);
      ev.end = newEnd;
      if(new Date(newEnd) <= new Date(ev.start)) ev.start = localStr(fixedDayKey, curTop+curDur-5);
    }
    const newDur = (new Date(ev.end)-new Date(ev.start))/60000;
    block.style.zIndex = String(zForDuration(newDur));
    setTimeout(()=>{ justDragged=false; },120);
    renderEvents();
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup",   onUp);
}

/* ===== Boot ===== */
document.addEventListener("DOMContentLoaded", ()=>{
  renderWeek();

  const prev = document.getElementById("prev-week");
  const next = document.getElementById("next-week");
  const today= document.getElementById("today");
  if(prev) prev.onclick = ()=>{ currentWeekStart = addDays(currentWeekStart,-7); renderWeek(); };
  if(next) next.onclick = ()=>{ currentWeekStart = addDays(currentWeekStart, 7); renderWeek(); };
  if(today) today.onclick= ()=>{ currentWeekStart = startOfWeekLocal(new Date()); renderWeek(); };

  const btn = document.getElementById("theme-toggle");
  if(btn){
    btn.addEventListener("click", ()=>{
      const html=document.documentElement;
      const next= html.getAttribute("data-theme")==="dark" ? "light" : "dark";
      html.setAttribute("data-theme", next);
      btn.textContent = next==="dark" ? "☀️ Light" : "🌙 Dark";
    });
  }
});

