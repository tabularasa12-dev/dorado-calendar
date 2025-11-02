/* ---------- State & Storage ---------- */
const state = {
  weeks: [],
  completed: {},          // event completion by id
  goalsDone: {            // monthly/yearly bold toggles
    monthly: {},          // keyed by "YYYY-MM:text"
    longterm: {}
  },
  monthlyCustom: {}       // { ym: [ {text,cat,variant} ] }
};

function load(){
  try{
    const raw = JSON.parse(localStorage.getItem("xc_state")||"{}");
    if(raw.completed) state.completed = raw.completed;
    if(raw.goalsDone) state.goalsDone = raw.goalsDone;
    if(raw.monthlyCustom) state.monthlyCustom = raw.monthlyCustom;
  }catch(e){}
}
function save(){
  localStorage.setItem("xc_state", JSON.stringify({
    completed: state.completed,
    goalsDone: state.goalsDone,
    monthlyCustom: state.monthlyCustom
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
  if(!vp) return;
  vp.innerHTML = "";
  state.weeks.forEach(w => vp.appendChild(renderWeekRow(w)));
}

/* ---------- Category mapping (guide + goals) ---------- */
const CATEGORY_OPTIONS = [
  {label:"AP Studying", cat:"ap", variant:"work"},
  {label:"AP Test", cat:"ap", variant:"deadline"},
  {label:"Club/Project Work", cat:"biz", variant:"work"},
  {label:"Competition Due", cat:"biz", variant:"deadline"},
  {label:"Volunteering", cat:"vol", variant:"work"},
  {label:"Volunteer Check", cat:"vol", variant:"deadline"},
  {label:"SAT Study", cat:"test", variant:"work"},
  {label:"SAT/Test Due", cat:"test", variant:"deadline"},
  {label:"Intern Work", cat:"intern", variant:"work"},
  {label:"Intern Due", cat:"intern", variant:"deadline"},
  {label:"Application Prep", cat:"app", variant:"work"},
  {label:"Application Due", cat:"app", variant:"deadline"},
  {label:"Dorado Work", cat:"dorado", variant:"work"},
];

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

/* ---------- Monthly Goals (left) ---------- */
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
    const arr = []; const used = new Set();
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
    const picks = pick(3);
    out.push({
      ym: key,
      label,
      items: picks.map(p => ({ text: p.t, cat: p.cat, variant: p.variant }))
    });
    d.setMonth(d.getMonth()+1);
  }
  return out;
}

let MONTH_BLOCKS = [];

function renderMonthlyGoals(){
  const host = document.getElementById("monthlyGoals");
  if(!host) return;

  if(!MONTH_BLOCKS.length){
    MONTH_BLOCKS = (typeof MONTHLY_GOALS_BY_MONTH !== "undefined" && Array.isArray(MONTHLY_GOALS_BY_MONTH))
      ? MONTHLY_GOALS_BY_MONTH
      : generateMonthlyGoals(new Date(), 2027, 5);
  }

  host.innerHTML = "";

  MONTH_BLOCKS.forEach(block=>{
    const wrap = document.createElement("div");
    wrap.className = "mmonth";
    wrap.dataset.ym = block.ym;

    const h = document.createElement("h3");
    h.className = "month-hdr";
    h.textContent = block.label;
    wrap.appendChild(h);

    // defaults + custom
    const custom = state.monthlyCustom[block.ym] || [];
    const items = [...(block.items||[]), ...custom];

    items.forEach(item=>{
      const row = document.createElement("div");
      row.className = "mgoal";
      const cat = item.cat || inferCatVariant(item.text).cat;
      const variant = item.variant || inferCatVariant(item.text).variant;
      row.dataset.cat = cat; row.dataset.variant = variant;

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

    // Add card (white)
    const addCard = document.createElement("div");
    addCard.className = "mgoal add";
    addCard.innerHTML = `<span class="plus">＋</span><span class="g-text">Add</span>`;
    addCard.addEventListener("click", ()=> openAddModal(block.ym));
    wrap.appendChild(addCard);

    host.appendChild(wrap);
  });
}

/* ---------- Yearly Guide (right) ---------- */
function renderGuide(){
  const host = document.getElementById("guideList");
  if(!host) return;
  host.innerHTML = "";

  const items = (typeof LONGTERM_GOALS !== "undefined") ? LONGTERM_GOALS : [
    "Submit 3 competition entries",
    "Secure internship lead",
    "Reach 1450+ SAT practice average",
    "Ship 2 Dorado features"
  ];

  const list = document.createElement("div");
  list.className = "goal-list";

  items.forEach(txt=>{
    const key = String(txt||"").trim();
    const {cat, variant} = inferCatVariant(key);

    const row = document.createElement("div");
    row.className = "goal";
    row.dataset.cat = cat; row.dataset.variant = variant;

    const sw = document.createElement("span");
    sw.className = "g-swatch";
    const t = document.createElement("span");
    t.className = "g-text";
    t.textContent = key;

    row.appendChild(sw); row.appendChild(t);

    if(state.goalsDone.longterm[key]) row.classList.add("done");

    row.addEventListener("click", ()=>{
      const cur = !!state.goalsDone.longterm[key];
      state.goalsDone.longterm[key] = !cur;
      row.classList.toggle("done", !cur);
      save();
    });

    list.appendChild(row);
  });

  host.appendChild(list);
}

/* ---------- Add Goal Modal + Custom Dropdown ---------- */
let modal, nameInput, catSelectEl, catTrigger, catMenu, preview, saveBtn, cancelBtn;
let pendingYM = null;
let currentCat = "app";
let currentVariant = "work";

function buildCatMenu(){
  catMenu.innerHTML = "";
  CATEGORY_OPTIONS.forEach((opt, idx)=>{
    const item = document.createElement("div");
    item.className = "cat-option";
    item.setAttribute("role","option");
    item.setAttribute("data-cat", opt.cat);
    item.setAttribute("data-variant", opt.variant);
    item.setAttribute("data-index", String(idx));
    item.innerHTML = `<span class="swatch" aria-hidden="true"></span><span class="label">${opt.label}</span>`;
    item.addEventListener("click", ()=>{
      selectCategory(opt.cat, opt.variant, opt.label);
      closeMenu();
      updatePreview();
    });
    catMenu.appendChild(item);
  });
}

function selectCategory(cat, variant, labelText){
  currentCat = cat; currentVariant = variant;
  const container = document.getElementById("goalCategory");
  container.dataset.cat = cat; container.dataset.variant = variant;
  catTrigger.querySelector(".label").textContent = labelText;
}

function openMenu(){
  catMenu.classList.add("open");
  document.getElementById("goalCategory").setAttribute("aria-expanded","true");
  catMenu.focus();
}
function closeMenu(){
  catMenu.classList.remove("open");
  document.getElementById("goalCategory").setAttribute("aria-expanded","false");
}

function toggleMenu(){
  if(catMenu.classList.contains("open")) closeMenu(); else openMenu();
}

function updatePreview(){
  preview.dataset.cat = currentCat;
  preview.dataset.variant = currentVariant;
  preview.querySelector(".g-text").textContent = nameInput.value || "Your goal";
}

function ensureModal(){
  if(modal) return;
  modal = document.getElementById("goalModal");
  nameInput = document.getElementById("goalNameInput");
  preview = document.getElementById("goalPreview");
  saveBtn = document.getElementById("goalSaveBtn");
  cancelBtn = document.getElementById("goalCancelBtn");

  // custom dropdown elements
  catSelectEl = document.getElementById("goalCategory");
  catTrigger = document.getElementById("catTrigger");
  catMenu = document.getElementById("catMenu");

  buildCatMenu();
  selectCategory("app", "work", "Application Prep");

  catTrigger.addEventListener("click", toggleMenu);
  // Close on backdrop click or Escape
  modal.querySelector(".modal-backdrop").addEventListener("click", ()=>{
    // If menu open, close menu first
    if(catMenu.classList.contains("open")) closeMenu(); else {
      modal.classList.add("hidden"); modal.setAttribute("aria-hidden","true"); pendingYM = null;
    }
  });
  document.addEventListener("keydown", (e)=>{
    if(modal.classList.contains("hidden")) return;
    if(e.key === "Escape"){
      if(catMenu.classList.contains("open")) closeMenu();
      else { modal.classList.add("hidden"); modal.setAttribute("aria-hidden","true"); pendingYM = null; }
    }
  });

  // Keyboard nav inside menu (basic)
  catMenu.addEventListener("keydown", (e)=>{
    const items = Array.from(catMenu.querySelectorAll(".cat-option"));
    const active = document.activeElement;
    let idx = items.indexOf(active);
    if(e.key === "ArrowDown"){
      e.preventDefault();
      const next = items[Math.min(items.length-1, idx+1)] || items[0];
      next.focus();
    }else if(e.key === "ArrowUp"){
      e.preventDefault();
      const prev = items[Math.max(0, idx-1)] || items[items.length-1];
      prev.focus();
    }else if(e.key === "Enter"){
      e.preventDefault();
      active?.click();
    }else if(e.key === "Tab"){
      // close when tabbing out
      closeMenu();
    }
  });

  nameInput.addEventListener("input", updatePreview);

  cancelBtn.addEventListener("click", ()=>{
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden","true");
    pendingYM = null;
  });

  saveBtn.addEventListener("click", ()=>{
    const name = (nameInput.value||"").trim();
    if(!name) { nameInput.focus(); return; }
    const ym = pendingYM;
    if(!ym) return;

    if(!state.monthlyCustom[ym]) state.monthlyCustom[ym] = [];
    state.monthlyCustom[ym].push({ text: name, cat: currentCat, variant: currentVariant });
    save();

    renderMonthlyGoals(); // refresh only left column

    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden","true");
    pendingYM = null;
  });
}

function openAddModal(ym){
  ensureModal();
  pendingYM = ym;

  // defaults
  nameInput.value = "";
  selectCategory("app", "work", "Application Prep");
  updatePreview();

  modal.classList.remove("hidden");
  modal.removeAttribute("aria-hidden");
  nameInput.focus();
}

/* ---------- All ---------- */
function renderAll(){
  if(typeof SEED_WEEKS !== "undefined") state.weeks = SEED_WEEKS;
  renderWeeks();
  renderMonthlyGoals();
  renderGuide();
}

/* ---------- Controls ---------- */
function attachEvents(){
  const btnToday = document.getElementById("btnJumpToday");
  const btnReset = document.getElementById("btnResetDone");

  btnToday?.addEventListener("click", ()=>{
    const vp = document.getElementById("weeksViewport");
    const todayKey = pickTodayWeekKey();
    const idx = state.weeks.findIndex(w => w.weekKey === todayKey);
    if(idx>=0){ vp.children[idx]?.scrollIntoView({block:"center"}); }
  });

  btnReset?.addEventListener("click", ()=>{
    if(confirm("Clear all completions (events + goals)?")){
      state.completed = {};
      state.goalsDone = {monthly:{}, longterm:{}};
      state.monthlyCustom = {};
      save();
      renderAll();
    }
  });
}

/* ---------- Boot ---------- */
function boot(){
  load();
  renderAll();
  attachEvents();
}
document.addEventListener("DOMContentLoaded", boot);

