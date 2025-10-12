// Dorado Calendar — week view with drag/move, resize, compact modes

const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOUR_PX=40, MINUTE_PX=HOUR_PX/60, SNAP_MIN=15;
const pad2=n=>String(n).padStart(2,"0");
const hhmm=d=>new Date(d).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function startOfWeekLocal(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-x.getDay());return x;}
function endOfWeekLocal(d){const s=startOfWeekLocal(d);const e=new Date(s);e.setDate(e.getDate()+7);return e;}
function dateKeyLocal(d){const x=new Date(d);x.setHours(0,0,0,0);return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;}
function localStr(key,mins){const h=Math.floor(mins/60),m=mins%60;return `${key}T${pad2(h)}:${pad2(m)}`;}

let currentWeekStart=startOfWeekLocal(new Date());
let events=[]; let justDragged=false;

/* Header & grid */
function renderWeekHeader(ws){
  const head=document.getElementById("days-head"); head.innerHTML="";
  const todayKey=dateKeyLocal(new Date());
  for(let i=0;i<7;i++){
    const d=addDays(ws,i), key=dateKeyLocal(d);
    const cell=document.createElement("div"); cell.className="day-name";
    if(key===todayKey) cell.classList.add("is-today");
    cell.textContent=`${DAYS[i]} ${d.getMonth()+1}/${d.getDate()}`;
    head.appendChild(cell);
  }
}
function renderTimeCol(){
  const t=document.getElementById("time-body"); t.innerHTML="";
  for(let h=0;h<24;h++){ const r=document.createElement("div"); r.className="tick"; r.style.height=`${HOUR_PX}px`; r.textContent=`${pad2(h)}:00`; t.appendChild(r); }
}
function renderDayBodies(ws){
  const wrap=document.getElementById("days-wrap"); wrap.innerHTML="";
  for(let i=0;i<7;i++){
    const key=dateKeyLocal(addDays(ws,i));
    const body=document.createElement("div"); body.className="day-body"; body.dataset.date=key;
    const grid=document.createElement("div"); grid.className="hour-grid"; body.appendChild(grid);
    body.addEventListener("click",()=>openModal(null,key));
    wrap.appendChild(body);
  }
  renderEvents();
}
function renderWeek(){
  const we=endOfWeekLocal(currentWeekStart);
  document.getElementById("week-label").textContent=`${currentWeekStart.toLocaleDateString()} - ${addDays(we,-1).toLocaleDateString()}`;
  renderWeekHeader(currentWeekStart); renderTimeCol(); renderDayBodies(currentWeekStart);
}

/* Modal */
const modal=document.getElementById("modal"), form=document.getElementById("modal-form");
let editingId=null;
function openModal(event,dateKey){
  if(justDragged){ justDragged=false; return; }
  modal.style.display="grid"; modal.setAttribute("aria-hidden","false");
  document.getElementById("modal-title-text").textContent=event?"Edit Event":"Add Event";
  if(event){
    editingId=event.id;
    document.getElementById("modal-title").value=event.title;
    document.getElementById("modal-start").value=event.start;
    document.getElementById("modal-end").value=event.end;
    document.getElementById("modal-category").value=event.category;
    document.getElementById("modal-delete").style.display="inline-block";
  }else{
    editingId=null; form.reset();
    const start=`${dateKey}T12:00`, end=`${dateKey}T13:00`;
    document.getElementById("modal-title").value="";
    document.getElementById("modal-start").value=start;
    document.getElementById("modal-end").value=end;
    document.getElementById("modal-category").value="Personal";
    document.getElementById("modal-delete").style.display="none";
  }
}
function closeModal(){ modal.style.display="none"; modal.setAttribute("aria-hidden","true"); form.reset(); }
document.getElementById("modal-cancel").onclick=closeModal;
document.getElementById("modal-backdrop").onclick=closeModal;
document.getElementById("modal-delete").onclick=()=>{ events=events.filter(e=>e.id!==editingId); closeModal(); renderEvents(); };
form.onsubmit=e=>{
  e.preventDefault();
  const title=document.getElementById("modal-title").value.trim();
  const start=document.getElementById("modal-start").value;
  const end=document.getElementById("modal-end").value;
  const category=document.getElementById("modal-category").value;
  if(!title) return;
  if(new Date(end)<=new Date(start)){ alert("End must be after start"); return; }
  if(editingId){ Object.assign(events.find(x=>x.id===editingId),{title,start,end,category}); }
  else{ const id=Date.now().toString(36)+Math.random().toString(36).slice(2,5); events.push({id,title,start,end,category}); }
  closeModal(); renderEvents();
};

/* Events */
function buildBlock(e, columnKey){
  const s=new Date(e.start), en=new Date(e.end);
  const minutes=s.getHours()*60+s.getMinutes();
  const duration=Math.max(5,(en-s)/60000);
  const heightPx=Math.max(6,duration*MINUTE_PX);

  const block=document.createElement("div");
  block.className=`event-block category-${e.category.toLowerCase()}`;
  block.style.top=`${minutes*MINUTE_PX}px`;
  block.style.height=`${heightPx}px`;
  block.title=`${e.title}\n${hhmm(s)} – ${hhmm(en)}`;

  // content wrapper (clips text, like spreadsheet cells)
  const content=document.createElement("div"); content.className="content";
  const titleEl=document.createElement("div"); titleEl.className="title"; titleEl.textContent=e.title;
  const timeEl=document.createElement("div"); timeEl.className="time"; timeEl.textContent=`${hhmm(s)} – ${hhmm(en)}`;
  content.append(titleEl,timeEl);

  const rt=document.createElement("div"); rt.className="resize-top";
  const rb=document.createElement("div"); rb.className="resize-bottom";

  block.append(content, rt, rb);

  applyCompactMode(block);
  const ro=new ResizeObserver(()=>applyCompactMode(block)); ro.observe(block);

  block.addEventListener("click",ev=>{ev.stopPropagation(); if(!justDragged) openModal(e,columnKey);});
  block.addEventListener("mousedown",ev=>{
    const tgt=ev.target;
    if(tgt.classList.contains("resize-top")||tgt.classList.contains("resize-bottom")) return;
    ev.preventDefault(); ev.stopPropagation(); startDragMove(e,block,columnKey,ev);
  });
  rt.addEventListener("mousedown",ev=>{ev.preventDefault();ev.stopPropagation();startResize(e,block,columnKey,"top",ev);});
  rb.addEventListener("mousedown",ev=>{ev.preventDefault();ev.stopPropagation();startResize(e,block,columnKey,"bottom",ev);});

  return block;
}
function applyCompactMode(block){
  const h=block.getBoundingClientRect().height;
  block.classList.remove("compact","tiny","very-short","micro");
  if(h<=10){ block.classList.add("micro"); }
  else if(h<=16){ block.classList.add("very-short"); }
  else if(h<=22){ block.classList.add("tiny"); }
  else if(h<=30){ block.classList.add("compact"); }
}
function renderEvents(){
  document.querySelectorAll(".event-block").forEach(n=>n.remove());
  document.querySelectorAll(".day-body").forEach(b=>{
    const key=b.dataset.date;
    const list=events.filter(ev=>ev.start.startsWith(key));
    list.forEach(ev=> b.appendChild(buildBlock(ev,key)));
  });
}

/* Drag to move (fixed) */
function startDragMove(e, block, columnKey, mDown){
  const startY=mDown.clientY;
  const initTopPx=parseFloat(block.style.top)||0;
  const durMin=Math.max(5,Math.round(parseFloat(block.style.height)/MINUTE_PX));
  const maxTop=(24*60)-durMin;

  let targetBody=block.closest(".day-body");
  let moved=false;

  function under(x,y){ const el=document.elementFromPoint(x,y); return el ? (el.closest(".day-body")||targetBody) : targetBody; }

  function onMove(ev){
    const dy=ev.clientY-startY;
    const propMin=Math.round((initTopPx+dy)/MINUTE_PX);
    const snapped=Math.round(propMin/SNAP_MIN)*SNAP_MIN;
    const clamped=Math.max(0,Math.min(maxTop,snapped));
    block.style.top=`${clamped*MINUTE_PX}px`;

    const u=under(ev.clientX,ev.clientY);
    if(u && u!==targetBody){ targetBody=u; targetBody.appendChild(block); }

    moved=true; justDragged=true;

    const s=new Date(localStr(targetBody.dataset.date,clamped));
    const en=new Date(localStr(targetBody.dataset.date,clamped+durMin));
    const t=block.querySelector(".time"); if(t) t.textContent=`${hhmm(s)} – ${hhmm(en)}`;
  }
  function onUp(){
    document.removeEventListener("mousemove",onMove);
    document.removeEventListener("mouseup",onUp);
    if(!moved){ justDragged=false; return; }
    const topMin=Math.round((parseFloat(block.style.top)||0)/MINUTE_PX);
    e.start=localStr(targetBody.dataset.date,topMin);
    e.end=localStr(targetBody.dataset.date,topMin+durMin);
    setTimeout(()=>{justDragged=false;},120);
    renderEvents();
  }
  document.addEventListener("mousemove",onMove);
  document.addEventListener("mouseup",onUp);
}

/* Resize (top/bottom) */
function startResize(e, block, columnKey, edge, mDown){
  const startY=mDown.clientY;
  const initTopPx=parseFloat(block.style.top)||0;
  const initHpx=parseFloat(block.style.height)||(60*MINUTE_PX);
  const initTopMin=Math.round(initTopPx/MINUTE_PX);
  const initDurMin=Math.max(5,Math.round(initHpx/MINUTE_PX));

  let curTop=initTopMin, curDur=initDurMin;

  function onMove(ev){
    const dy=ev.clientY-startY;
    if(edge==="top"){
      const nextTop=initTopMin+Math.round(dy/MINUTE_PX);
      const snappedTop=Math.round(nextTop/SNAP_MIN)*SNAP_MIN;
      const boundedTop=Math.max(0,Math.min(initTopMin+initDurMin-5,snappedTop));
      curTop=boundedTop; curDur=Math.max(5,initDurMin-(curTop-initTopMin));
      block.style.top=`${curTop*MINUTE_PX}px`; block.style.height=`${curDur*MINUTE_PX}px`;
    }else{
      const nextDur=initDurMin+Math.round(dy/MINUTE_PX);
      const snappedDur=Math.round(nextDur/SNAP_MIN)*SNAP_MIN;
      const maxDur=(24*60)-initTopMin;
      curDur=Math.max(5,Math.min(maxDur,snappedDur));
      block.style.height=`${curDur*MINUTE_PX}px`;
    }
    const s=new Date(localStr(columnKey,curTop));
    const en=new Date(localStr(columnKey,curTop+curDur));
    const t=block.querySelector(".time"); if(t) t.textContent=`${hhmm(s)} – ${hhmm(en)}`;
    applyCompactMode(block);
    justDragged=true;
  }
  function onUp(){
    document.removeEventListener("mousemove",onMove);
    document.removeEventListener("mouseup",onUp);
    e.start=localStr(columnKey,curTop);
    e.end=localStr(columnKey,curTop+curDur);
    setTimeout(()=>{justDragged=false;},120);
    renderEvents();
  }
  document.addEventListener("mousemove",onMove);
  document.addEventListener("mouseup",onUp);
}

/* Boot */
document.addEventListener("DOMContentLoaded",()=>{
  renderWeek();
  document.getElementById("prev-week").onclick=()=>{currentWeekStart=addDays(currentWeekStart,-7);renderWeek();};
  document.getElementById("next-week").onclick=()=>{currentWeekStart=addDays(currentWeekStart,7);renderWeek();};
  document.getElementById("today").onclick=()=>{currentWeekStart=startOfWeekLocal(new Date());renderWeek();};
  const btn=document.getElementById("theme-toggle");
  if(btn){ btn.addEventListener("click",()=>{ const html=document.documentElement; const next=html.getAttribute("data-theme")==="dark"?"light":"dark"; html.setAttribute("data-theme",next); btn.textContent=next==="dark"?"☀️ Light":"🌙 Dark"; }); }
});

