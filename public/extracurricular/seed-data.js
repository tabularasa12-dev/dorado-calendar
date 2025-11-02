// Seed weeks & goals used by the calendar. Safe defaults included.

function startOfWeek(d){
  const x=new Date(d); const day=x.getDay();
  x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x;
}
function fmtShort(d){ return d.toLocaleDateString(undefined,{month:"short", day:"numeric"}); }
function key(d){ return d.toISOString().slice(0,10); }

const SEED_WEEKS = (function(){
  const out = [];
  const now = new Date();
  let cur = startOfWeek(now);
  for(let i=0;i<12;i++){
    const end = new Date(cur); end.setDate(end.getDate()+6);
    out.push({
      weekKey: key(cur),
      rangeLabel: `${fmtShort(cur)} – ${fmtShort(end)}, ${cur.getFullYear()}`,
      days: [
        [ {id:`${i}-0-a`, text:"Club practice", cat:"biz", variant:"work"} ],
        [ {id:`${i}-1-a`, text:"AP study block", cat:"ap", variant:"work"} ],
        [ {id:`${i}-2-a`, text:"Volunteer shift", cat:"vol", variant:"work"} ],
        [ {id:`${i}-3-a`, text:"Dorado feature work", cat:"dorado", variant:"work"} ],
        [ {id:`${i}-4-a`, text:"Competition due soon", cat:"biz", variant:"deadline"} ],
        [ {id:`${i}-5-a`, text:"SAT practice set", cat:"test", variant:"work"} ],
        [ {id:`${i}-6-a`, text:"Intern program task", cat:"intern", variant:"work"} ]
      ]
    });
    cur = new Date(cur); cur.setDate(cur.getDate()+7);
  }
  return out;
})();

const MONTHLY_GOALS = [
  "Finish Common App essay draft",
  "Volunteer 8 hours",
  "AP Chem practice set x3",
  "Lock in club event venue"
];

const LONGTERM_GOALS = [
  "Submit 3 competition entries",
  "Secure internship lead",
  "Reach 1450+ SAT practice average",
  "Ship 2 Dorado features"
];

