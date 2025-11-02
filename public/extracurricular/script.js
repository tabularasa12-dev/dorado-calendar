/* ---------- State & Storage ---------- */
const state = {
  weeks: [],
  completed: {},          // event completion by id
  goalsDone: {            // monthly/yearly bold toggles
    monthly: {},
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

/* ---------- Event Element ---------- */
function makeEventEl(evt){
  const tpl = document.getElementById("tplEvent");
  const node = tpl.content.firstElementChild.cloneNode(true);
  const text = node.querySelector(".evt-text");
  text.textContent = evt.text || "";

  if(evt.cat) node.dataset.cat = evt.cat;
  if(evt.variant) node.dataset.variant = evt.variant;

  // Restore persisted completion
  if(state.completed[evt.id]) node.classList.add("done");

  node.addEventListener("click", ()=>{
    state.completed[evt.id] = !state.completed[evt.id];
    node.classList.toggle("done", !!state.completed[evt.id]);
    save();
  });
  return node;
}

/* ---------- Render Calendar ---------- */
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

/* ---------- Goals (Monthly + Yearly) ---------- */
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

function renderGoalList(hostEl, items, bucket){
  if(!hostEl) return;
  hostEl.innerHTML = "";

  const list = document.createElement("div");
  list.className = "goal-list";

  (items || []).forEach(txt=>{
    const key = String(txt||"").trim();
    const {cat, variant} = inferCatVariant(key);

    const row = document.createElement("div");
    row.className = "goal";
    row.dataset.cat = cat;
    row.dataset.variant = variant;

    const sw = document.createElement("span");
    sw.className = "g-swatch";
    const text = document.createElement("span");
    text.className = "g-text";
    text.textContent = key;

    row.appendChild(sw);
    row.appendChild(text);

    if(state.goalsDone[bucket][key]) row.classList.add("done");

    row.addEventListener("click", ()=>{
      const cur = !!state.goalsDone[bucket][key];
      state.goalsDone[bucket][key] = !cur;
      row.classList.toggle("done", !cur);
      save();
    });

    list.appendChild(row);
  });

  hostEl.appendChild(list);
}

function renderMonthlyGoals(){
  const host = document.getElementById("monthlyGoals");
  if(typeof MONTHLY_GOALS === "undefined") return;
  renderGoalList(host, MONTHLY_GOALS, "monthly");
}

function renderGuide(){
  const host = document.getElementById("guideList");
  if(typeof LONGTERM_GOALS === "undefined") return;
  renderGoalList(host, LONGTERM_GOALS, "longterm");
}

/* ---------- All ---------- */
function renderAll(){
  renderWeeks();
  renderMonthlyGoals();
  renderGuide();
}

/* ---------- Controls ---------- */
function attachEvents(){
  const btnToday = document.getElementById("btnJumpToday");
  const btnReset = document.getElementById("btnResetDone");

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
}

/* ---------- Boot ---------- */
function boot(){
  load();
  // Seed
  if(typeof SEED_WEEKS !== "undefined") state.weeks = SEED_WEEKS;
  else state.weeks = []; // if missing, render empty

  renderAll();
  attachEvents();
}

document.addEventListener("DOMContentLoaded", boot);

