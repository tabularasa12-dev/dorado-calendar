/* ---------- State & Storage ---------- */
const state = {
  weeks: [],
  completed: {},          // event completion by id
  goalsDone: {            // monthly/yearly bold toggles
    monthly: {},          // keyed by "YYYY-MM:text"
    longterm: {}
  }
};

function load(){
  try{
    const raw = JSON.parse(localStorage.getItem("xc_state")||"{}");
    if(raw.completed) state.completed = raw.completed;
    if(raw.goalsDone) state.goalsDone = raw.goalsDone;
  }catch(e){}
}
function save(){
  localStorage.setItem("xc_state", JSON.stringify({
    completed: state.completed,
    goalsDone: state.goalsDone
  }));
}

/* ---------- Utils ---------- */
function pickTodayWeekKey(){
  const d = new Date(); const day = d.getDay();
  d.setDate(d.getDate()-day); d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}
function yyyymm(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
function monthLabel(d){ return d.toLocaleString(undefined, { month:"long", year:"numeric" }); }

/* ---------- Calendar (center) ---------- */
function makeEventEl(evt){
  const tpl = document.getElementById("tplEvent");
  const node = tpl.content.firstElementChild.cloneNode(true);
  const text = node.querySelector(".evt-text");
  text.textContent = evt.text || "";

  if(evt.cat) node.dataset.cat = evt.cat;
  if(evt.variant) node.dataset.variant = evt.variant;

  if(state.completed[evt.id]) node.classList.add("done");

  node.addEventListener("click", ()=>{
    state.completed[evt.id] = !state.completed[evt.id];
    node.classList.toggle("done", !!state.completed[evt.id]);
    save();
  });
  return node;
}

function renderWeekRow(week){
  const row = document.createElement("div");
  row.className = "week-row";
  row.dataset.weekStart = week.weekKey;

  const label = document.createElement("div");
  label.className = "week-label";
  label.textContent = week.rangeLabel;
  row.appendChild(label);

  for(let d=0; d<7; d++){
    const cell = document.createElement("div");
    cell.className = "day-cell";
    const items = week.days[d] || [];
    items.forEach(evt=>{
      if(state.completed.hasOwnProperty(evt.id)){
        evt.done = !!state.completed[evt.id];
      }
      cell.appendChild(makeEventEl(evt));
    });
    row.appendChild(cell);
  }
  return row;
}

function renderWeeks(){
  const vp = document.getElementById("weeksViewport");
  vp.innerHTML = "";
  state.weeks.forEach(w => vp.appendChild(renderWeekRow(w)));
}

/* ---------- Monthly Goals (left) ---------- */

function inferCatVariant(text){
  const t = (text||"").toLowerCase();
  if(/ap\b|advanced placement/.test(t)) return {cat:"ap", variant:"work"};
  if(/\btest\b|\bexam\b|sat\b|act\b/.test(t)) return {cat:"test", variant:/due|deadline/.test(t)?"deadline":"work"};
  if(/volunteer|service/.test(t)) return {cat:"vol", variant:"work"};
  if(/intern|program|fellowship/.test(t)) return {cat:"intern", variant:/due|deadline/.test(t)?"deadline":"work"};
  if(/application|essay|common app|supplement/.test(t)) return {cat:"app", variant:/due|deadline/.test(t)?"deadline":"work"};
  if(/club|competition|pitch/.test(t)) return {cat:"biz", variant:/due|deadline/.test(t)?"deadline":"work"};
  if(/dorado/.test(t)) return {cat:"dorado", variant:"work"};
  if(/due|deadline|submit/.test(t)) return {cat:"app", variant:"deadline"};
  return {cat:"app", variant:"work"};
}

/* Generate months from now until May 2027 with random-ish goals */
function generateMonthlyGoals(fromDate, toYear=2027, toMonth=5){
  const out = [];
  const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1, 0,0,0,0);
  const end = new Date(toYear, toMonth-1, 1);

  const templates = [
    {t:"AP study block x3", cat:"ap", variant:"work"},
    {t:"Complete SAT practice set", cat:"test", variant:"work"},
    {t:"Volunteer 4 hours", cat:"vol", variant:"work"},
    {t:"Polish Common App essay draft", cat:"app", variant:"work"},
    {t:"Club event planning checkpoint", cat:"biz", variant:"work"},
    {t:"Competition registration deadline", cat:"biz", variant:"deadline"},
    {t:"Internship outreach (5 emails)", cat:"intern", variant:"work"},
    {t:"Dorado feature sprint", cat:"dorado", variant:"work"},
    {t:"Supplemental essay outline", cat:"app", variant:"work"},
    {t:"Practice exam due", cat:"test", variant:"deadline"}
  ];

  function pick(n){
    const arr = [];
    const used = new Set();
    while(arr.length<n){
      const i = Math.floor(Math.random()*templates.length);
      if(used.has(i)) continue;
      used.add(i); arr.push(templates[i]);
    }
    return arr;
  }

  while(d <= end){
    const label = monthLabel(d);
    const key = yyyymm(d);
    const picks = pick(3); // 3 goals per month
    out.push({
      ym: key,
      label,
      items: picks.map(p => ({ text: p.t, cat: p.cat, variant: p.variant }))
    });
    d.setMonth(d.getMonth()+1);
  }
  return out;
}

function renderMonthlyGoals(){
  const host = document.getElementById("monthlyGoals");
  if(!host) return;

  // If you later define MONTHLY_GOALS_BY_MONTH in seed-data.js, we’ll use it;
  // otherwise generate from now through May 2027.
  let blocks = (typeof MONTHLY_GOALS_BY_MONTH !== "undefined" && Array.isArray(MONTHLY_GOALS_BY_MONTH))
    ? MONTHLY_GOALS_BY_MONTH
    : generateMonthlyGoals(new Date(), 2027, 5);

  host.innerHTML = "";
  blocks.forEach(block=>{
    const wrap = document.createElement("div");
    wrap.className = "mmonth";

    const h = document.createElement("h3");
    h.className = "month-hdr";
    h.textContent = block.label;
    wrap.appendChild(h);

    (block.items||[]).forEach(item=>{
      const row = document.createElement("div");
      row.className = "mgoal";
      row.dataset.cat = item.cat || inferCatVariant(item.text).cat;
      row.dataset.variant = item.variant || inferCatVariant(item.text).variant;

      const txt = document.createElement("span");
      txt.className = "g-text";
      txt.textContent = item.text || "";
      row.appendChild(txt);

      const key = `${block.ym}:${item.text}`;
      if(state.goalsDone.monthly[key]) row.classList.add("done");

      row.addEventListener("click", ()=>{
        const cur = !!state.goalsDone.monthly[key];
        state.goalsDone.monthly[key] = !cur;
        row.classList.toggle("done", !cur);
        save();
      });

      wrap.appendChild(row);
    });

    host.appendChild(wrap);
  });
}

/* ---------- All ---------- */
function renderAll(){
  // Calendar weeks rely on SEED_WEEKS (seed-data.js)
  if(typeof SEED_WEEKS !== "undefined") state.weeks = SEED_WEEKS;
  renderWeeks();
  renderMonthlyGoals();
}

/* ---------- Controls ---------- */
function attachEvents(){
  const btnToday = document.getElementById("btnJumpToday");
  const btnReset = document.getElementById("btnResetDone");
  const btnToggleGoals = document.getElementById("btnToggleGoals");

  if(btnToday){
    btnToday.addEventListener("click", ()=>{
      const vp = document.getElementById("weeksViewport");
      const todayKey = pickTodayWeekKey();
      const idx = state.weeks.findIndex(w => w.weekKey === todayKey);
      if(idx>=0){ vp.children[idx]?.scrollIntoView({block:"center"}); }
    });
  }

  if(btnReset){
    btnReset.addEventListener("click", ()=>{
      if(confirm("Clear all completions (events + goals)?")){
        state.completed = {};
        state.goalsDone = {monthly:{}, longterm:{}};
        save();
        renderAll();
      }
    });
  }

  if(btnToggleGoals){
    btnToggleGoals.addEventListener("click", ()=>{
      const layout = document.getElementById("layout");
      const rail = document.querySelector(".rail-monthly");
      const collapsed = layout.classList.toggle("goals-collapsed");
      if(rail) rail.classList.toggle("collapsed", collapsed);
      btnToggleGoals.classList.toggle("collapsed", collapsed);
    });
  }
}

/* ---------- Boot ---------- */
function boot(){
  load();
  renderAll();
  attachEvents();
}

document.addEventListener("DOMContentLoaded", boot);

