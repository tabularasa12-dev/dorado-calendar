// Dorado Calendar — cross-day drag enabled
// - Drag horizontally across day columns (snaps vertically to 15m)
// - Ghost tails for wraparound remain
// - “Edit → This & future” splits series correctly
// - Custom confirm (red/yellow/gray), repeats future-only
// - Overlap layout with 75%/50% for shorter overlaps
// - Local datetime (no UTC shift)

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOUR_PX = 40, MINUTE_PX = HOUR_PX/60, SNAP_MIN = 15, EV_GAP_PX = 6;

const pad2 = n => String(n).padStart(2,"0");
const hhmm = d => new Date(d).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
const toLocalInputValue = dt => { const d=new Date(dt); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fromKey = key => new Date(`${key}T00:00`);
const localStr = (key,mins)=> `${key}T${pad2(Math.floor(mins/60))}:${pad2(mins%60)}`;
const startOfWeekLocal = d => { const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-x.getDay()); return x; };
const endOfWeekLocal   = d => { const s=startOfWeekLocal(d); const e=new Date(s); e.setDate(e.getDate()+7); return e; };
const startOfDay = d => { const x=new Date(d); x.setHours(0,0,0,0); return x; };
const dateKeyLocal = d => { const x=new Date(d); x.setHours(0,0,0,0); return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`; };
const addDays=(d,n)=>{ const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const addWeeks=(d,n)=> addDays(d,n*7);
const addMonths=(d,n)=>{ const x=new Date(d); const day=x.getDate(); x.setMonth(x.getMonth()+n); if(x.getDate()<day) x.setDate(0); return x; };
const addYears=(d,n)=>{ const x=new Date(d); x.setFullYear(x.getFullYear()+n); return x; };
const zForDuration = mins => 1000 + Math.max(1, 1440 - Math.min(1440, Math.round(mins)));

let currentWeekStart = startOfWeekLocal(new Date());
let events = [];
let justDragged = false;

let timeFormat = localStorage.getItem('timeFmt') || '24';
function formatHourLabel(h){ if(timeFormat==='24')return `${pad2(h)}:00`; const ampm=h<12?'AM':'PM'; const h12=h%12===0?12:h%12; return `${h12}:00 ${ampm}`; }

const mqlDark = window.matchMedia('(prefers-color-scheme: dark)');
function applySystemTheme(){ document.documentElement.setAttribute('data-theme', mqlDark.matches?'dark':'light'); }

/* ===== Custom confirms ===== */
async function showConfirm({ title="Confirm", message="", buttons=[] }={}) {
  return new Promise(resolve=>{
    const root=document.getElementById("confirm-root");
    const backdrop=document.getElementById("confirm-backdrop");
    const titleEl=document.getElementById("confirm-title");
    const msgEl=document.getElementById("confirm-message");
    const actions=document.getElementById("confirm-actions");
    titleEl.textContent=title; msgEl.textContent=message; actions.innerHTML="";
    const make=({id,label,variant})=>{ const b=document.createElement("button"); b.textContent=label; b.className="btn"; if(variant==="primary") b.classList.add("btn-primary"); else if(variant==="danger") b.classList.add("btn-danger"); else if(variant==="warning") b.classList.add("btn-warning"); b.onclick=()=>done(id); return b; };
    buttons.forEach(x=>actions.appendChild(make(x)));
    function key(e){ if(e.key==="Escape") done("escape"); }
    function done(res){ root.classList.add("hidden"); root.setAttribute("aria-hidden","true"); document.removeEventListener("keydown",key); backdrop.onclick=null; resolve(res); }
    root.classList.remove("hidden"); root.setAttribute("aria-hidden","false");
    document.addEventListener("keydown",key); backdrop.onclick=()=>done("cancel");
  });
}
async function askRepeatScope(kind="edit"){
  const title = kind==="edit" ? "Edit repeating event" : "Delete repeating event";
  const message= kind==="edit" ? "Apply to only this occurrence, or this and all future occurrences?" : "Delete only this occurrence, or this and all future occurrences?";
  return await showConfirm({
    title, message,
    buttons: [
      { id: "future", label: "This & future", variant: "danger" }, // left
      { id: "single", label: "Only this",     variant: "warning" },// middle
      { id: "cancel", label: "Cancel",        variant: "neutral" } // right
    ]
  });
}

/* ===== Repeat expansion ===== */
function nthDowOfMonth(y,m,dow,nth,h,mi){
  const first=new Date(y,m,1,h||0,mi||0);
  const delta=(dow-first.getDay()+7)%7;
  const day=1+delta+(nth-1)*7;
  const dt=new Date(y,m,day,h||0,mi||0);
  return dt.getMonth()===m?dt:null;
}
function* expandRepeats(ev, rangeStart, rangeEnd){
  const baseStart=new Date(ev.start), baseEnd=new Date(ev.end), dur=baseEnd-baseStart;
  const nowFloor=startOfDay(new Date()); const minStart=new Date(Math.max(baseStart, nowFloor));
  const until=ev.until?new Date(ev.until):null; const ex=new Set(ev.exDates||[]);
  const adders={daily:addDays,weekly:addWeeks,yearly:addYears};
  const rep=ev.repeat||"none";
  if(rep==="none"){
    if(baseStart>=minStart && baseEnd>rangeStart && baseStart<rangeEnd) yield {start:new Date(baseStart), end:new Date(baseEnd)};
    return;
  }
  if(rep==="daily"||rep==="weekly"||rep==="yearly"){
    let cur=new Date(baseStart); const add=adders[rep];
    while(cur<minStart) cur=add(cur,1);
    while(cur<rangeEnd){
      if(until && cur>=until) break;
      if(!ex.has(cur.toISOString())){
        const end=new Date(cur.getTime()+dur);
        if(end>rangeStart) yield {start:new Date(cur), end};
      }
      cur=add(cur,1);
    }
    return;
  }
  if(rep==="monthly_day"){
    let cur=new Date(baseStart);
    while(cur<minStart) cur=addMonths(cur,1);
    while(cur<rangeEnd){
      if(until && cur>=until) break;
      if(!ex.has(cur.toISOString())){
        const end=new Date(cur.getTime()+dur);
        if(end>rangeStart) yield {start:new Date(cur), end};
      }
      const want=baseStart.getDate();
      cur=addMonths(cur,1);
      if(cur.getDate()!==want){
        const tmp=new Date(cur.getFullYear(),cur.getMonth(),want,baseStart.getHours(),baseStart.getMinutes());
        if(tmp.getMonth()===cur.getMonth()) cur=tmp;
      }
    }
    return;
  }
  if(rep==="monthly_nth_weekday"){
    const base=new Date(baseStart);
    const nth=Math.floor((base.getDate()-1)/7)+1; const dow=base.getDay();
    let curMonth=new Date(base.getFullYear(), base.getMonth(), 1, base.getHours(), base.getMinutes());
    while(addMonths(curMonth,0)<startOfDay(minStart)) curMonth=addMonths(curMonth,1);
    while(curMonth<rangeEnd){
      const inst=nthDowOfMonth(curMonth.getFullYear(), curMonth.getMonth(), dow, nth, base.getHours(), base.getMinutes());
      if(inst){
        if(until && inst>=until) break;
        if(!ex.has(inst.toISOString())){
          const end=new Date(inst.getTime()+dur);
          if(inst>=minStart && end>rangeStart && inst<rangeEnd) yield {start:inst, end};
        }
      }
      curMonth=addMonths(curMonth,1);
    }
  }
}

/* ===== Split-series helper ===== */
function splitSeriesAtOccurrence(base, instISO, newFields){
  base.until = instISO; // old stops before inst
  const newId = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  const clone = {
    id: newId,
    title: newFields.title ?? base.title,
    start: newFields.start,
    end:   newFields.end,
    category: newFields.category ?? base.category,
    repeat:   newFields.repeat   ?? base.repeat,
    exDates: []
  };
  events.push(clone);
  return clone;
}

/* ===== Header / time / day grid ===== */
function renderWeekHeader(ws){
  const head=document.getElementById("days-head"); head.innerHTML="";
  const todayKey=dateKeyLocal(new Date());
  for(let i=0;i<7;i++){
    const d=addDays(ws,i), key=dateKeyLocal(d);
    const cell=document.createElement("div");
    cell.className="day-name";
    if(key===todayKey) cell.classList.add("is-today");
    cell.textContent=`${DAYS[i]} ${d.getMonth()+1}/${d.getDate()}`;
    head.appendChild(cell);
  }
}
function renderTimeCol(){
  const t=document.getElementById("time-body"); t.innerHTML="";
  for(let h=0;h<24;h++){
    const row=document.createElement("div");
    row.className="tick"; row.style.height=`${HOUR_PX}px`; row.textContent=formatHourLabel(h);
    row.addEventListener('click',()=>{ timeFormat=timeFormat==='24'?'12':'24'; localStorage.setItem('timeFmt',timeFormat); renderTimeCol(); });
    t.appendChild(row);
  }
  const spacer=document.querySelector('.time-head-spacer');
  if(spacer && !spacer._wiredToggle){
    spacer.addEventListener('click',()=>{ timeFormat=timeFormat==='24'?'12':'24'; localStorage.setItem('timeFmt',timeFormat); renderTimeCol(); });
    spacer._wiredToggle=true;
  }
}
function renderDayBodies(ws){
  const wrap=document.getElementById("days-wrap"); wrap.innerHTML="";
  for(let i=0;i<7;i++){
    const key=dateKeyLocal(addDays(ws,i));
    const body=document.createElement("div");
    body.className="day-body"; body.dataset.date=key;
    const grid=document.createElement("div"); grid.className="hour-grid"; body.appendChild(grid);
    body.addEventListener("click",(ev)=>{
      if(ev.target.closest(".event-block")) return;
      const rect=body.getBoundingClientRect();
      let mins=Math.max(0, Math.min(1439, Math.round((ev.clientY-rect.top)/MINUTE_PX)));
      mins=Math.round(mins/SNAP_MIN)*SNAP_MIN;
      const start=localStr(key,mins); const end=localStr(key,Math.min(1439,mins+60));
      openModal(null,key,{defaultStart:start,defaultEnd:end});
    });
    wrap.appendChild(body);
  }
  renderEvents();
}
function renderWeek(){
  const we=endOfWeekLocal(currentWeekStart);
  document.getElementById("week-label").textContent = `${currentWeekStart.toLocaleDateString()} - ${addDays(we,-1).toLocaleDateString()}`;
  renderWeekHeader(currentWeekStart); renderTimeCol(); renderDayBodies(currentWeekStart);
}

/* ===== Modal ===== */
const modal=document.getElementById("modal");
const form=document.getElementById("modal-form");
const modalAccent=document.getElementById("modal-accent");
let editingMeta=null;

function getSelectedCategory(){ const r=document.querySelector('input[name="modal-cat"]:checked'); return r ? r.value : "School"; }
function setSelectedCategory(cat){ (document.querySelector(`input[name="modal-cat"][value="${cat}"]`)||document.querySelector('input[name="modal-cat"][value="School"]')).checked=true; updateModalAccent(cat); }
function getCategoryColor(cat){
  switch((cat||"").toLowerCase()){
    case "school": return getComputedStyle(document.documentElement).getPropertyValue('--school') || '#1e88e5';
    case "activities": return getComputedStyle(document.documentElement).getPropertyValue('--activities') || '#e53935';
    case "personal": return getComputedStyle(document.documentElement).getPropertyValue('--personal') || '#43a047';
    default: return '#888';
  }
}
function updateModalAccent(cat){ modalAccent.style.background = getCategoryColor(cat); }

function buildRepeatLabels(dt){
  const d=new Date(dt);
  const nth=Math.floor((d.getDate()-1)/7)+1;
  const s=["th","st","nd","rd"], v=(n)=>{const m=n%100;return n+(s[(m-20)%10]||s[m]||s[0]);};
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
  if (justDragged){ justDragged=false; return; }
  modal.style.display="grid"; modal.setAttribute("aria-hidden","false"); document.body.classList.add("modal-open");
  if(instanceOrNull){
    const inst=instanceOrNull;
    const baseId=inst.baseId||inst.id;
    const instanceISO=inst.instanceISO||null;
    editingMeta={ baseId, instanceISO, isRepeating: !!(inst.repeat&&inst.repeat!=="none"), originalStartISO: inst.start instanceof Date ? inst.start.toISOString() : inst.start };
    document.getElementById("modal-title-text").textContent="Edit Event";
    document.getElementById("modal-title").value=inst.title;
    document.getElementById("modal-start").value = (inst.start instanceof Date) ? toLocalInputValue(inst.start) : inst.start;
    document.getElementById("modal-end").value   = (inst.end   instanceof Date) ? toLocalInputValue(inst.end)   : inst.end;
    setSelectedCategory(inst.category);
    document.getElementById("modal-repeat").value=inst.repeat||"none";
    document.getElementById("modal-delete").style.display="inline-block";
  }else{
    editingMeta={ baseId:null, instanceISO:null, isRepeating:false, originalStartISO:null };
    document.getElementById("modal-title-text").textContent="Add Event";
    form.reset();
    const start=opts.defaultStart || `${dateKey}T12:00`;
    const end  =opts.defaultEnd   || `${dateKey}T13:00`;
    document.getElementById("modal-title").value="";
    document.getElementById("modal-start").value=start;
    document.getElementById("modal-end").value=end;
    setSelectedCategory("School");
    document.getElementById("modal-repeat").value="none";
    document.getElementById("modal-delete").style.display="none";
  }
  refreshRepeatLabels();
}
function closeModal(){ modal.style.display="none"; modal.setAttribute("aria-hidden","true"); document.body.classList.remove("modal-open"); form.reset(); editingMeta=null; }
document.getElementById("modal-cancel").onclick=()=>closeModal();
document.getElementById("modal-backdrop").onclick=()=>closeModal();
document.getElementById("modal-category-group").addEventListener("change", ()=>updateModalAccent(getSelectedCategory()));
document.getElementById("modal-start").addEventListener("change", refreshRepeatLabels);

document.getElementById("modal-delete").onclick = async ()=>{
  if(!editingMeta) return;
  const base=events.find(e=>e.id===editingMeta.baseId);
  if(!base) return closeModal();
  if(base.repeat && base.repeat!=="none"){
    const scope=await askRepeatScope("delete");
    if(scope==="cancel"||scope==="escape") return;
    const instISO=editingMeta.instanceISO||editingMeta.originalStartISO;
    if(scope==="future"){ base.until=instISO; }
    else if(scope==="single"){ base.exDates=base.exDates||[]; if(!base.exDates.includes(instISO)) base.exDates.push(instISO); }
  }else{
    const r=await showConfirm({ title:"Delete event", message:"Are you sure you want to delete this event?", buttons:[{id:"cancel",label:"Cancel",variant:"neutral"},{id:"ok",label:"Delete",variant:"danger"}]});
    if(r!=="ok") return;
    const i=events.findIndex(e=>e.id===base.id); if(i>=0) events.splice(i,1);
  }
  closeModal(); renderEvents();
};

form.onsubmit = async (e)=>{
  e.preventDefault();
  const title=document.getElementById("modal-title").value.trim();
  const start=document.getElementById("modal-start").value;
  const end  =document.getElementById("modal-end").value;
  const category=getSelectedCategory();
  const repeat=document.getElementById("modal-repeat").value || "none";
  if(!title) return;
  if(new Date(end) <= new Date(start)){ alert("End must be after start"); return; }

  if(!editingMeta || !editingMeta.baseId){
    const id=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
    events.push({ id, title, start, end, category, repeat, exDates: [] });
  }else{
    const base=events.find(e=>e.id===editingMeta.baseId);
    if(!base) return;

    if(base.repeat && base.repeat!=="none"){
      const scope=await askRepeatScope("edit");
      if(scope==="cancel"||scope==="escape"){ closeModal(); return; }
      const instISO = editingMeta.instanceISO || editingMeta.originalStartISO;

      if(scope==="future"){
        splitSeriesAtOccurrence(base, instISO, { title, start, end, category, repeat });
      }else if(scope==="single"){
        base.exDates=base.exDates||[];
        if(!base.exDates.includes(instISO)) base.exDates.push(instISO);
        const id=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
        events.push({ id, title, start, end, category, repeat:"none" });
      }
    }else{
      base.title=title; base.category=category; base.repeat=repeat; base.start=start; base.end=end;
    }
  }
  closeModal(); renderEvents();
};

/* ===== Instances & rendering ===== */
function fragmentsForDay(dayKey, evs){
  const dayStart=fromKey(dayKey), dayEnd=addDays(dayStart,1), out=[];
  for(const ev of evs){
    const s=new Date(ev.start), e=new Date(ev.end);
    if(e<=dayStart || s>=dayEnd) continue;
    const startMin=Math.max(0, Math.floor((Math.max(s,dayStart)-dayStart)/60000));
    const endMin=Math.min(1440, Math.ceil((Math.min(e,dayEnd)-dayStart)/60000));
    if(endMin<=startMin) continue;
    out.push({ ev, id: ev.id, startMin, endMin });
  }
  return out;
}
function clusterRolesUpTo3(frags){
  const sorted=[...frags].sort((a,b)=> a.startMin!==b.startMin ? a.startMin-b.startMin : (b.endMin-b.startMin)-(a.endMin-a.startMin));
  const clusters=[]; let cur=null;
  for(const fr of sorted){ if(!cur || fr.startMin>=cur.maxEnd){ cur={items:[],maxEnd:fr.endMin}; clusters.push(cur);} cur.items.push(fr); if(fr.endMin>cur.maxEnd) cur.maxEnd=fr.endMin; }
  const map=new Map();
  for(const cl of clusters){
    const items=cl.items.slice().sort((a,b)=>{ const da=a.endMin-a.startMin, db=b.endMin-b.startMin; if(da!==db) return db-da; if(a.startMin!==b.startMin) return a.startMin-b.startMin; return a.id.localeCompare(b.id); });
    if(items.length===1){ map.set(items[0].id+":"+items[0].startMin,{role:"primary"}); continue; }
    map.set(items[0].id+":"+items[0].startMin,{role:"primary"});
    if(items[1]) map.set(items[1].id+":"+items[1].startMin,{role:"secondary1"});
    if(items[2]) map.set(items[2].id+":"+items[2].startMin,{role:"secondary2"});
    if(items.length>3){ const others=items.slice(3), cols=others.length; others.forEach((fr,i)=>map.set(fr.id+":"+fr.startMin,{role:"equal",col:i,cols})); }
  }
  return map;
}
function buildBlockFromFragment(fr, dayKey, roleRec){
  const duration=fr.endMin-fr.startMin, heightPx=Math.max(6, duration*MINUTE_PX);
  const block=document.createElement("div");
  block.className=`event-block category-${fr.ev.category.toLowerCase()}`;
  block.style.top=`${fr.startMin*MINUTE_PX}px`; block.style.height=`${heightPx}px`;
  block.dataset.id=fr.ev.id; block.dataset.day=dayKey; block.dataset.startMin=fr.startMin; block.dataset.endMin=fr.endMin;
  block.style.zIndex=String(zForDuration(duration));
  const setLW=(leftPct,widthPct)=>{ block.style.left=`calc(${leftPct}% + ${EV_GAP_PX}px)`; block.style.width=`calc(${widthPct}% - ${EV_GAP_PX*2}px)`; block.style.right="auto"; };
  if(!roleRec || roleRec.role==="primary"){ block.style.left=`${EV_GAP_PX}px`; block.style.right=`${EV_GAP_PX}px`; }
  else if(roleRec.role==="secondary1"){ setLW(25,75); }
  else if(roleRec.role==="secondary2"){ setLW(50,50); }
  else if(roleRec.role==="equal"){ const widthPct=100/roleRec.cols, leftPct=widthPct*roleRec.col; setLW(leftPct,widthPct); }

  const fragStart=new Date(localStr(dayKey, fr.startMin));
  const fragEnd  =new Date(localStr(dayKey, fr.endMin));
  const instanceISO=fragStart.toISOString(); const baseId=fr.ev.baseId||fr.ev.id; const repeat=fr.ev.repeat||"none";

  const content=document.createElement("div"); content.className="content";
  const titleEl=document.createElement("div"); titleEl.className="title"; titleEl.textContent=fr.ev.title;
  const timeEl =document.createElement("div"); timeEl.className ="time";  timeEl.textContent=`${hhmm(fragStart)} – ${hhmm(fragEnd)}`;
  content.append(titleEl,timeEl);
  const rt=document.createElement("div"); rt.className="resize-top";
  const rb=document.createElement("div"); rb.className="resize-bottom";
  block.append(content, rt, rb);

  applyCompactMode(block); new ResizeObserver(()=>applyCompactMode(block)).observe(block);

  block.addEventListener("click", ev=>{
    ev.stopPropagation(); if(justDragged) return;
    openModal({ id:baseId, baseId, instanceISO, title:fr.ev.title, category:fr.ev.category, start:fragStart, end:fragEnd, repeat }, dayKey);
  });

  block.addEventListener("pointerdown", ev=>{
    const tgt=ev.target; if(tgt.classList.contains("resize-top")||tgt.classList.contains("resize-bottom")) return;
    ev.preventDefault(); ev.stopPropagation();
    const durationMin=fr.endMin-fr.startMin;
    startDragMoveInstance({ baseId, instanceISO, title:fr.ev.title, category:fr.ev.category, repeat, durationMin }, block, dayKey, ev);
  });
  rt.addEventListener("pointerdown", ev=>{ ev.preventDefault(); ev.stopPropagation(); startResizeInstance({ baseId, instanceISO, title:fr.ev.title, category:fr.ev.category, repeat }, block, dayKey, "top", ev); });
  rb.addEventListener("pointerdown", ev=>{ ev.preventDefault(); ev.stopPropagation(); startResizeInstance({ baseId, instanceISO, title:fr.ev.title, category:fr.ev.category, repeat }, block, dayKey, "bottom", ev); });

  return block;
}
function renderEvents(){
  const rangeStart=startOfDay(currentWeekStart), rangeEnd=endOfWeekLocal(currentWeekStart);
  const instances=[];
  for(const ev of events){
    if(ev.repeat && ev.repeat!=="none"){
      for(const inst of expandRepeats(ev, rangeStart, rangeEnd)){
        instances.push({ id:ev.id+"|"+inst.start.toISOString(), baseId:ev.id, title:ev.title, category:ev.category, start:inst.start, end:inst.end, repeat:ev.repeat });
      }
    }else{
      const s=new Date(ev.start), e=new Date(ev.end);
      if(e>rangeStart && s<rangeEnd && s>=startOfDay(new Date())) instances.push({ id:ev.id, baseId:ev.id, title:ev.title, category:ev.category, start:s, end:e, repeat:"none" });
    }
  }
  document.querySelectorAll(".event-block").forEach(n=>n.remove());
  document.querySelectorAll(".day-body").forEach(b=>{
    const dayKey=b.dataset.date;
    const todays=instances.filter(x => x.end>fromKey(dayKey) && x.start<addDays(fromKey(dayKey),1));
    const frags=fragmentsForDay(dayKey, todays), roles=clusterRolesUpTo3(frags);
    for(const fr of frags){ const rec=roles.get(fr.id+":"+fr.startMin); b.appendChild(buildBlockFromFragment(fr, dayKey, rec)); }
  });
}

/* ===== Compact thresholds ===== */
function applyCompactMode(block){
  const h=block.getBoundingClientRect().height;
  block.classList.remove("compact","tiny","very-short","micro");
  if(h<=8) block.classList.add("micro");
  else if(h<=12) block.classList.add("very-short");
  else if(h<=22) block.classList.add("tiny");
  else if(h<=30) block.classList.add("compact");
}

/* ===== Ghost helpers ===== */
function getDayBodyByKey(key){ return document.querySelector(`.day-body[data-date="${key}"]`); }
function ensureGhost(parent, cls){
  let g = parent.querySelector(`.event-ghost.${cls}`);
  if(!g){ g=document.createElement("div"); g.className=`event-ghost ${cls}`; parent.appendChild(g); }
  return g;
}
function clearGhosts(){ document.querySelectorAll(".event-ghost").forEach(n=>n.remove()); }

/* ===== CROSS-DAY DRAG (horizontal + vertical) ===== */
async function startDragMoveInstance(meta, block, originDayKey, pDown){
  const startY=pDown.clientY, startX=pDown.clientX;
  const initTopPx=parseFloat(block.style.top)||0;
  const fragDurMin=parseInt(block.dataset.endMin)-parseInt(block.dataset.startMin);

  const daysWrap = document.getElementById('days-wrap');
  const firstCol = daysWrap.querySelector('.day-body');
  const colRect  = firstCol.getBoundingClientRect();
  const colWidth = colRect.width;

  block.classList.add("dragging");
  block.setPointerCapture(pDown.pointerId);
  document.body.style.userSelect="none";
  document.body.style.cursor="grabbing";

  let moved=false;
  // absolute minutes offset from the ORIGIN day
  let curAbsStartMin = Math.round((initTopPx)/MINUTE_PX); // relative to origin initially
  let curDayShift = 0; // how many days from origin we are while dragging

  // helpers to (re)parent on day change
  const setParentToKey = (targetKey)=>{
    if(block.dataset.day === targetKey) return;
    const targetBody = getDayBodyByKey(targetKey);
    if(!targetBody) return;
    targetBody.appendChild(block);
    block.dataset.day = targetKey;
  };

  // initial ghosts around current (origin) day
  const colorCls = meta.category.toLowerCase(); // school|activities|personal
  let prevKey = dateKeyLocal(addDays(fromKey(originDayKey), -1));
  let nextKey = dateKeyLocal(addDays(fromKey(originDayKey),  1));
  let ghostPrev = getDayBodyByKey(prevKey) ? ensureGhost(getDayBodyByKey(prevKey), colorCls) : null;
  let ghostNext = getDayBodyByKey(nextKey) ? ensureGhost(getDayBodyByKey(nextKey), colorCls) : null;
  if(ghostPrev) ghostPrev.style.display="none";
  if(ghostNext) ghostNext.style.display="none";

  let raf=null;
  const onMove=(ev)=>{
    const dy=ev.clientY-startY;
    const dx=ev.clientX-startX;

    if(!raf){
      raf=requestAnimationFrame(()=>{
        // horizontal: compute day shift based on column width
        const proposedShift = Math.round(dx / colWidth);
        const clampedShift  = Math.max(-6, Math.min(6, proposedShift));
        if(clampedShift !== curDayShift){
          // reparent into the new day column
          const newKey = dateKeyLocal(addDays(fromKey(originDayKey), clampedShift));
          setParentToKey(newKey);

          // rebuild adjacent ghosts for the new column
          prevKey = dateKeyLocal(addDays(fromKey(newKey), -1));
          nextKey = dateKeyLocal(addDays(fromKey(newKey),  1));
          clearGhosts();
          ghostPrev = getDayBodyByKey(prevKey) ? ensureGhost(getDayBodyByKey(prevKey), colorCls) : null;
          ghostNext = getDayBodyByKey(nextKey) ? ensureGhost(getDayBodyByKey(nextKey), colorCls) : null;
          if(ghostPrev) ghostPrev.style.display="none";
          if(ghostNext) ghostNext.style.display="none";
        }
        curDayShift = clampedShift;

        // vertical: snap to 15 during drag
        const proposedTop = Math.round((initTopPx + dy)/MINUTE_PX);
        curAbsStartMin = Math.round(proposedTop / SNAP_MIN) * SNAP_MIN;

        // compute total absolute mins from ORIGIN including day shift
        const totalStartAbs = curAbsStartMin;
        const totalEndAbs   = totalStartAbs + fragDurMin;
        // relative mins within CURRENT column (curDayShift)
        const visStartInCol = ((totalStartAbs - curDayShift*1440)%1440 + 1440) % 1440;

        // clamp visible top
        const visibleTop = Math.max(0, Math.min(1440 - Math.min(fragDurMin,1440), visStartInCol));
        block.style.top = `${visibleTop*MINUTE_PX}px`;

        // overflow into previous/next from CURRENT column
        const overflowPrev = Math.max(0, -visStartInCol);
        if(ghostPrev && overflowPrev>0){
          const h=Math.min(fragDurMin, overflowPrev);
          ghostPrev.style.display="block";
          ghostPrev.style.top = `${(1440 - h)*MINUTE_PX}px`;
          ghostPrev.style.height = `${h*MINUTE_PX}px`;
        } else if(ghostPrev){ ghostPrev.style.display="none"; }

        const overflowNext = Math.max(0, visStartInCol + fragDurMin - 1440);
        if(ghostNext && overflowNext>0){
          const h=Math.min(fragDurMin, overflowNext);
          ghostNext.style.display="block";
          ghostNext.style.top = `0px`;
          ghostNext.style.height = `${h*MINUTE_PX}px`;
        } else if(ghostNext){ ghostNext.style.display="none"; }

        // live label across days
        const originBase = fromKey(originDayKey);
        const sKey = dateKeyLocal(addDays(originBase, Math.floor((totalStartAbs)/1440) + curDayShift));
        const eKey = dateKeyLocal(addDays(originBase, Math.floor((totalEndAbs)/1440)   + curDayShift));
        const sMinIn = ((totalStartAbs%1440)+1440)%1440;
        const eMinIn = ((totalEndAbs%1440)+1440)%1440;
        const s = new Date(localStr(sKey, sMinIn));
        const en= new Date(localStr(eKey, eMinIn));
        const t=block.querySelector(".time"); if(t) t.textContent = `${hhmm(s)} – ${hhmm(en)}`;

        applyCompactMode(block);
        moved=true; justDragged=true; raf=null;
      });
    }
  };

  const onUp = async ()=>{
    block.releasePointerCapture(pDown.pointerId);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup",   onUp);
    document.body.style.userSelect=""; document.body.style.cursor="";
    block.classList.remove("dragging");
    clearGhosts();

    if(!moved){ justDragged=false; return; }

    // finalize absolute times (origin + dayShift)
    const originBase = fromKey(originDayKey);
    const totalStartAbs = curAbsStartMin + curDayShift*1440;
    const totalEndAbs   = totalStartAbs + meta.durationMin;

    const sShift = Math.floor(totalStartAbs/1440);
    const eShift = Math.floor(totalEndAbs/1440);
    const sMinIn = ((totalStartAbs%1440)+1440)%1440;
    const eMinIn = ((totalEndAbs%1440)+1440)%1440;

    const startKey = dateKeyLocal(addDays(originBase, sShift));
    const endKey   = dateKeyLocal(addDays(originBase, eShift));
    const newStart = localStr(startKey, sMinIn);
    const newEnd   = localStr(endKey,   eMinIn);

    const base = events.find(e => e.id === meta.baseId);
    if(!base){ justDragged=false; renderEvents(); return; }

    if(base.repeat && base.repeat!=="none"){
      const scope = await askRepeatScope("edit");
      if(scope==="cancel"||scope==="escape"){ setTimeout(()=>justDragged=false,120); renderEvents(); return; }
      const instISO = meta.instanceISO;
      if(scope==="future"){
        splitSeriesAtOccurrence(base, instISO, { title: meta.title, start: newStart, end: newEnd, category: meta.category, repeat: base.repeat });
      }else if(scope==="single"){
        base.exDates=base.exDates||[];
        if(!base.exDates.includes(instISO)) base.exDates.push(instISO);
        const id=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
        events.push({ id, title: meta.title, start: newStart, end: newEnd, category: meta.category, repeat:"none" });
      }
    }else{
      base.start=newStart; base.end=newEnd;
    }

    setTimeout(()=>justDragged=false,120);
    renderEvents();
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup",   onUp);
}

/* ===== Resize (unchanged vs previous) ===== */
function startResizeInstance(meta, block, fixedDayKey, edge, pDown){
  const startY=pDown.clientY;
  const initTopPx=parseFloat(block.style.top)||0;
  const initHpx=parseFloat(block.style.height)||(60*MINUTE_PX);
  const initTopMin=Math.round(initTopPx/MINUTE_PX);
  const initDurMin=Math.max(5, Math.round(initHpx/MINUTE_PX));
  let curTop=initTopMin, curDur=initDurMin;

  block.classList.add("dragging");
  block.setPointerCapture(pDown.pointerId);
  document.body.style.userSelect="none"; document.body.style.cursor="ns-resize";

  let raf=null;
  const onMove=(ev)=>{
    const dy=ev.clientY-startY;
    if(!raf){
      raf=requestAnimationFrame(()=>{
        if(edge==="top"){
          const nextTop = initTopMin + Math.round(dy/MINUTE_PX);
          const snappedTop = Math.round(nextTop/SNAP_MIN)*SNAP_MIN;
          curTop = snappedTop;
          curDur = Math.max(5, Math.round((initDurMin + (initTopMin - curTop))/SNAP_MIN)*SNAP_MIN);
          block.style.top = `${Math.max(0, Math.min(1440-5, curTop))*MINUTE_PX}px`;
          block.style.height = `${Math.max(5, Math.min(curDur, 1440))*MINUTE_PX}px`;
        }else{
          const nextDur = initDurMin + Math.round(dy/MINUTE_PX);
          const snapped = Math.round(nextDur/SNAP_MIN)*SNAP_MIN;
          curDur = Math.max(5, snapped);
          block.style.height = `${Math.min(curDur, 1440)*MINUTE_PX}px`;
        }

        // live label across days
        const baseDay = fromKey(fixedDayKey);
        const startAbs=curTop, endAbs=curTop+curDur;
        const sShift=Math.floor(startAbs/1440), eShift=Math.floor(endAbs/1440);
        const sMin=((startAbs%1440)+1440)%1440, eMin=((endAbs%1440)+1440)%1440;
        const sKey=dateKeyLocal(addDays(baseDay,sShift)), eKey=dateKeyLocal(addDays(baseDay,eShift));
        const s=new Date(localStr(sKey,sMin)), en=new Date(localStr(eKey,eMin));
        const t=block.querySelector(".time"); if(t) t.textContent=`${hhmm(s)} – ${hhmm(en)}`;

        applyCompactMode(block); justDragged=true; raf=null;
      });
    }
  };
  const onUp=async ()=>{
    block.releasePointerCapture(pDown.pointerId);
    document.removeEventListener("pointermove",onMove);
    document.removeEventListener("pointerup",onUp);
    document.body.style.userSelect=""; document.body.style.cursor=""; block.classList.remove("dragging");

    const baseDay=fromKey(fixedDayKey);
    const startAbs=curTop, endAbs=curTop+curDur;
    const sShift=Math.floor(startAbs/1440), eShift=Math.floor(endAbs/1440);
    const sMin=((startAbs%1440)+1440)%1440, eMin=((endAbs%1440)+1440)%1440;
    const sKey=dateKeyLocal(addDays(baseDay,sShift)), eKey=dateKeyLocal(addDays(baseDay,eShift));
    const newStart=localStr(sKey,sMin), newEnd=localStr(eKey,eMin);

    const base=events.find(e=>e.id===meta.baseId);
    if(base){
      if(base.repeat && base.repeat!=="none"){
        const scope=await askRepeatScope("edit");
        if(scope==="cancel"||scope==="escape"){ setTimeout(()=>{ justDragged=false; },120); renderEvents(); return; }
        const instISO=meta.instanceISO;
        if(scope==="future"){
          splitSeriesAtOccurrence(base, instISO, { title: meta.title, start: newStart, end: newEnd, category: meta.category, repeat: base.repeat });
        }else if(scope==="single"){
          base.exDates=base.exDates||[];
          if(!base.exDates.includes(instISO)) base.exDates.push(instISO);
          const id=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
          events.push({ id, title: meta.title, start: newStart, end: newEnd, category: meta.category, repeat:"none" });
        }
      } else { base.start=newStart; base.end=newEnd; }
    }
    setTimeout(()=>{ justDragged=false; },120); renderEvents();
  };
  document.addEventListener("pointermove",onMove);
  document.addEventListener("pointerup",onUp);
}

/* ===== Boot ===== */
document.addEventListener("DOMContentLoaded", ()=>{
  applySystemTheme(); mqlDark.addEventListener('change', applySystemTheme);
  renderWeek();
  const prev=document.getElementById("prev-week"), next=document.getElementById("next-week"), today=document.getElementById("today");
  if(prev)  prev.onclick = ()=>{ currentWeekStart=addDays(currentWeekStart,-7); renderWeek(); };
  if(next)  next.onclick = ()=>{ currentWeekStart=addDays(currentWeekStart, 7); renderWeek(); };
  if(today) today.onclick= ()=>{ currentWeekStart=startOfWeekLocal(new Date()); renderWeek(); };

  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowLeft')  { currentWeekStart = addDays(currentWeekStart, -7); renderWeek(); }
    if (e.key === 'ArrowRight') { currentWeekStart = addDays(currentWeekStart,  7); renderWeek(); }
    if (e.key.toLowerCase() === 't') { currentWeekStart = startOfWeekLocal(new Date()); renderWeek(); }
    if (e.key.toLowerCase() === 'n') { const todayKey = dateKeyLocal(new Date()); openModal(null, todayKey); }
  });
});

