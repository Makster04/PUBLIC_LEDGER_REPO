// The four A-F grades on the home page cards. Shared by the page, the monthly scoring script and the tests; the
// Methodology page and Scores/00_POLITICAL_SCORECARD_METHODOLOGY.md state the same rules.
// A grade is shown only with enough evidence; otherwise the card says "Not graded", never a zero.
// Values the methodology still lists under "Open decisions" are marked (placeholder).
export const MIN_CHECKS=3, MIN_MATCH_ISSUES=3, MIN_PVP_ACTIONS=3;
// Ethics (placeholders): a case's status points (ETHICS_COST) times its kind (CASE_KIND), halved when its latest status
// change is more than 10 years old (CASE_AGE); open cases always count in full. The trading indexes each cost a tenth of
// their value (INDEX_COST), so trading can cost at most 20 points. Trade reports are due 45 days after a trade (STOCK Act).
export const ETHICS_COST={finding:20,open:15,closed:5,allegation:0};
export const CASE_KIND={criminal:1.5,ethics:1,technical:0.5};
export const CASE_AGE={years:10,factor:0.5};
export const INDEX_COST=0.1, LATE_DAYS=45;
// Insider Trading Index parts and limits: the weights, the fewest reviewed trades for a score, the single-stock trades a
// year that count as 100, and how close to a related vote a trade is flagged (days).
export const INSIDER={weights:{conflicts:0.4,nearVotes:0.25,donors:0.2,activity:0.15},minTrades:5,activityCeiling:50,nearDays:30};
// Stock Disclosure Dodger Index parts and the fewest required filings (trade reports and annual disclosures) for a score.
export const DODGER={weights:{trades:0.7,annual:0.3},minFilings:3};
// Rule 1: actions count more than words. A statement counts only on an issue with no recorded action.
export const WEIGHT={action:1,statement:0.5};
export const ACTION_TYPES=new Set(['senate_vote','house_vote','vote','state_vote','sponsored','cosponsored','official_act']);

export function letter(pct){return pct>=90?'A':pct>=80?'B':pct>=70?'C':pct>=60?'D':'F';}

// One ID per bill, so a vote and a sponsorship on the same bill can be matched: "H.R. 1319 (117th Congress)" -> "117-hr-1319".
const BILL_TYPES=new Set(['HR','S','HJRES','SJRES','HCONRES','SCONRES','HRES','SRES']);
export function billKey(congress,measure){
  const m=String(measure||'').toUpperCase().replace(/[.\s]/g,'').match(/^([A-Z]+)(\d+)$/);
  if(!m||!BILL_TYPES.has(m[1])||!(+congress>0))return null;
  return `${+congress}-${m[1].toLowerCase()}-${+m[2]}`;
}
export function billKeyFromText(text){
  const m=String(text||'').match(/^((?:H|S)\.?\s?(?:J\.?\s?Res|Con\.?\s?Res|Res|R)?\.?)\s*(\d+)\s*\((\d+)(?:st|nd|rd|th) Congress\)/i);
  return m?billKey(m[3],m[1]+m[2]):null;
}
const isVote=t=>/vote$/.test(t||'')||t==='vote';
// Sponsoring a bill and then voting on it counts once; if both exist, the vote is the one counted ("the vote wins").
export function oneCreditPerBill(items){
  const out=[], at=new Map();
  for(const e of items){
    if(!e.bill){out.push(e);continue;}
    if(!at.has(e.bill)){at.set(e.bill,out.length);out.push(e);continue;}
    const i=at.get(e.bill);if(isVote(e.kind||e.type)&&!isVote(out[i].kind||out[i].type))out[i]=e;
  }
  return out;
}

// Your match: per issue, the share of the record that matches the visitor's side, weighted by the importance they gave it.
// choices: [{id, side, w}]; evidence: {issueId: [{type, side, bill?}]}. Issues with no evidence are left out; an issue
// backed only by statements counts at half its importance. A grade needs evidence on 3 issues and half the importance.
export function matchScore(choices,evidence){
  let totW=0,covW=0,effW=0,num=0,nCov=0;const rows=[];
  for(const c of choices){
    totW+=c.w;
    const ev=(evidence||{})[c.id]||[], rec=oneCreditPerBill(ev.filter(e=>ACTION_TYPES.has(e.type))), st=ev.filter(e=>e.type==='stated');
    const basis=rec.length?rec:st;
    if(!basis.length){rows.push({id:c.id,status:'none',rec,st});continue;}
    const match=basis.filter(e=>e.side===c.side).length, agree=match/basis.length, iw=rec.length?c.w:c.w*WEIGHT.statement;
    covW+=c.w;effW+=iw;num+=iw*agree;nCov++;
    rows.push({id:c.id,status:rec.length?'record':'stated',match,n:basis.length,agree,iw,rec,st,stMatch:st.filter(e=>e.side===c.side).length});
  }
  const need=Math.min(MIN_MATCH_ISSUES,choices.length), enough=choices.length>0&&nCov>=need&&totW>0&&covW/totW>=0.5;
  return {score:enough?Math.round(num/effW*100):null,covW,totW,effW,nCov,nChosen:choices.length,need,rows,num};
}

// Promises delivered: each counted check is 1 if the record supports it, 1/2 if partly supported or the position changed,
// 0 if contradicted (including a promise left unacted at the end of the term, recorded as a contradiction with `unacted`).
// Left out: ambiguous and outcome checks, promises with no related bill yet ("pending"), and vague goals (`vague: true`).
const COUNTED=new Set(['consistent','partial','changed','contradiction']);
// trackers: published promise-tracker tallies (PolitiFact's Trump-O-Meter and MAGA-Meter, for a president), counted like
// checked statements: Promise Kept 1, Compromise ½, Promise Broken 0. Stalled and In the Works wait, like a promise with
// no related bill yet. [{counts:{kept, compromise, broken, stalled, inTheWorks}}]
export function promiseScore(statements,trackers){
  const list=(statements||[]).filter(x=>!x.vague), c={};
  for(const x of list)c[x.assessment]=(c[x.assessment]||0)+1;
  let kept=c.consistent||0, half=(c.partial||0)+(c.changed||0), broken=c.contradiction||0, waiting=0, rated=0;
  for(const t of trackers||[]){const n=t.counts||{};kept+=n.kept||0;half+=n.compromise||0;broken+=n.broken||0;
    const w=(n.stalled||0)+(n.inTheWorks||0);waiting+=w;rated+=(n.kept||0)+(n.compromise||0)+(n.broken||0)+w;}
  const clear=kept+half+broken;
  return {pct:clear>=MIN_CHECKS?Math.round((kept+half/2)/clear*100):null,kept,half,broken,clear,total:list.length+rated,
    notCounted:list.filter(x=>!COUNTED.has(x.assessment)).length+waiting,vague:(statements||[]).length-list.length,
    unacted:list.filter(x=>x.assessment==='contradiction'&&x.unacted).length,promises:list.filter(x=>x.promise).length+rated};
}

// Stock trading: which reviewed trades were disclosed late (or not at all) and which were individual stocks in a sector
// the member's committees oversee. trades: [{traded, filed, sector, asset}]; overseen: sector names.
const DAY=86400000;
export function tradeChecks(trades,overseen){
  const sectors=new Set(overseen||[]);let late=0,conflict=0;
  const rows=(trades||[]).map(t=>{
    const days=t.filed&&t.traded?Math.round((Date.parse(t.filed)-Date.parse(t.traded))/DAY):null;
    const isLate=!!t.missing||(days!=null&&days>LATE_DAYS);
    const isConflict=(t.asset||'stock')==='stock'&&!!t.sector&&sectors.has(t.sector);
    if(isLate)late++;if(isConflict)conflict++;
    return Object.assign({},t,{days,late:isLate,conflict:isConflict});
  });
  return {rows,late,conflict};
}

// Each index is 0-100, higher meaning more of what its name says, or null with the reason when there isn't enough data.
const pct=(n,d)=>d?n/d*100:0;
const ceiling=(v,max)=>Math.min(100,v/max*100);
// The middle of a disclosed amount range: "$1,001 - $15,000" -> 8000.5. A single amount is itself; unreadable is null.
export function amountMid(text){
  const n=String(text||'').replace(/,/g,'').match(/\$?\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*\$?\s*(\d+(?:\.\d+)?))?/);
  return n?(Number(n[1])+Number(n[2]??n[1]))/2:null;
}
const caseStatus=e=>e.outcome==='None found'?null:e.status==='finding'?'finding':e.status==='investigation'?(e.stage==='open'?'open':'closed'):e.status==='allegation'?'allegation':null;

// Legal Trouble Index: each case's status points × its kind × its age, totaled, with a ceiling of 100. It keeps its exact
// value (a case can be worth 22.5 or 3.75), and only the Ethics grade is rounded, so the shown math adds up. Each case counts
// once, at its current status; "None found" checks are ignored. asOfYear is the year of the reviewed research.
// stockActCovered: when the person's trades are reviewed, a STOCK Act late-disclosure case counts in the Stock
// Disclosure Dodger Index instead, so the same late report never costs twice.
export function legalTrouble(ethics,{asOfYear=null,stockActCovered=false}={}){
  const rows=[],n={finding:0,open:0,closed:0,allegation:0};
  (ethics||[]).forEach((e,i)=>{
    const status=caseStatus(e);if(!status)return;
    n[status]++;
    const kind=CASE_KIND[e.kind]?e.kind:'ethics';
    const old=status!=='open'&&!!asOfYear&&e.decided!=null&&e.decided<asOfYear-CASE_AGE.years;
    const covered=stockActCovered&&e.type==='STOCK Act';
    const points=covered?0:ETHICS_COST[status]*CASE_KIND[kind]*(old?CASE_AGE.factor:1);
    rows.push({i,status,kind,old,covered,points});
  });
  const total=rows.reduce((t,r)=>t+r.points,0);
  return Object.assign({index:Math.min(100,Math.round(total*100)/100),total,rows},n);
}

// Insider Trading Index, from reviewed trades (tradeChecks rows). covered: false when the disclosures don't cover the
// person (not in Congress). inDonors: how many of the trades were in a donor's company. Late reports are left to the
// Stock Disclosure Dodger Index.
export function insiderTrading(rows,{covered=true,inDonors=0}={}){
  rows=rows||[];
  if(!covered)return {index:null,why:'No trading data',n:0,parts:null};
  if(!rows.length)return {index:0,why:'No trades',n:0,parts:null};
  const single=rows.filter(r=>(r.asset||'stock')==='stock');
  // Dollar values are the middle of each disclosed range; if any is missing, each trade counts once instead.
  const dollars=single.map(r=>amountMid(r.amount)),byDollar=dollars.every(v=>v!=null);
  const conflictShare=byDollar?pct(single.reduce((t,r,i)=>t+(r.conflict?dollars[i]:0),0),dollars.reduce((t,v)=>t+v,0)):pct(single.filter(r=>r.conflict).length,single.length);
  const dates=rows.map(r=>Date.parse(r.traded)).filter(Number.isFinite),years=Math.max(1,dates.length?(Math.max(...dates)-Math.min(...dates))/(365.25*DAY):1);
  const parts={conflicts:conflictShare,nearVotes:pct(rows.filter(r=>r.flag||r.nearVote).length,rows.length),donors:pct(Math.min(inDonors,rows.length),rows.length),activity:ceiling(single.length/years,INSIDER.activityCeiling)};
  const W=INSIDER.weights,index=Math.round(Object.keys(W).reduce((t,k)=>t+W[k]*parts[k],0));
  if(rows.length<INSIDER.minTrades)return {index:null,why:'Not enough data',n:rows.length,parts};
  return {index,why:null,n:rows.length,single:single.length,byDollar,parts};
}

// Stock Disclosure Dodger Index: late or missing trade reports (required), and annual financial disclosures filed after
// their due date. annual: [{year, due, filed}] from the reviewed research; when there are none the trade part counts alone.
export function disclosureDodger(rows,annual=[],{covered=true}={}){
  rows=rows||[];annual=annual||[];
  if(!covered)return {index:null,why:'No trading data',n:0,parts:null};
  const lateAnnual=annual.filter(a=>!a.filed||(a.due&&a.filed>a.due)).length;
  const parts={trades:rows.length?pct(rows.filter(r=>r.late).length,rows.length):null,annual:annual.length?pct(lateAnnual,annual.length):null};
  if(parts.trades==null)return {index:null,why:'No trades',n:annual.length,parts};
  if(rows.length+annual.length<DODGER.minFilings)return {index:null,why:'Not enough data',n:rows.length+annual.length,parts};
  const W=DODGER.weights,use=Object.keys(W).filter(k=>parts[k]!=null),w=use.reduce((t,k)=>t+W[k],0);
  return {index:Math.round(use.reduce((t,k)=>t+W[k]*parts[k],0)/w),why:null,n:rows.length+annual.length,late:rows.filter(r=>r.late).length,lateAnnual,parts};
}

// Ethics: 100 − Legal Trouble Index − a tenth of the Insider Trading Index − a tenth of the Stock Disclosure Dodger Index,
// rounded, never below 0. An index without enough data costs nothing. trading: {rows, covered, inDonors, annual}.
export function ethicsScore(ethics,trading={},{asOfYear=null}={}){
  const rows=trading.rows||[],covered=trading.covered!==false;
  const legal=legalTrouble(ethics,{asOfYear,stockActCovered:covered&&rows.length>0});
  const insider=insiderTrading(rows,{covered,inDonors:trading.inDonors||0});
  const dodger=disclosureDodger(rows,trading.annual,{covered});
  const insiderCost=(insider.index||0)*INDEX_COST, dodgerCost=(dodger.index||0)*INDEX_COST;
  const raw=100-legal.index-insiderCost-dodgerCost;
  return {pct:Math.max(0,Math.round(raw)),raw,legal,insider,dodger,insiderCost,dodgerCost,
    finding:legal.finding,open:legal.open,closed:legal.closed,allegation:legal.allegation,
    late:rows.filter(r=>r.late).length,conflict:rows.filter(r=>r.conflict).length};
}

// Workers > Profit: actions on bills marked People or Profit by a cited nonpartisan analysis of who gains.
// actions: [{bill, kind: 'vote'|'sponsored'|'cosponsored', pos?, mark: 'people'|'profit'}]. A Yea or a sponsorship takes the
// bill's side, a Nay the other; missed votes count for nothing; one credit per bill (the vote wins). Each counts 1.0.
export function pvpScore(actions){
  let people=0,profit=0;const scored=[];
  for(const a of oneCreditPerBill((actions||[]).filter(a=>a.mark==='people'||a.mark==='profit'))){
    let took;
    if(a.kind==='vote'){if(a.pos!=='Yea'&&a.pos!=='Nay')continue;took=a.pos==='Yea'?a.mark:(a.mark==='people'?'profit':'people');}
    // A president's veto takes the other side of the bill, like a Nay; signing a bill or issuing an order takes its side.
    else if(a.kind==='vetoed')took=a.mark==='people'?'profit':'people';
    else took=a.mark;
    if(took==='people')people+=WEIGHT.action;else profit+=WEIGHT.action;
    scored.push(Object.assign({},a,{took}));
  }
  const n=scored.length;
  return {pct:n>=MIN_PVP_ACTIONS?Math.round(people/(people+profit)*100):null,people,profit,n,scored};
}
// The actions one person took on marked bills: their recorded votes, and the bills they sponsored or cosponsored (or, for
// a president, signed or vetoed, and executive orders, keyed "eo-14251").
// marks: Map billKey -> {pvp}; votes: [{bill, pos}]; sponsorships: [{bill, kind}].
export function pvpActions(marks,votes,sponsorships){
  const out=[];
  for(const v of votes||[]){const m=v.bill&&marks.get(v.bill);if(m)out.push({bill:v.bill,kind:'vote',pos:v.pos,mark:m.pvp,ref:v.ref});}
  for(const sp of sponsorships||[]){const m=sp.bill&&marks.get(sp.bill);if(m)out.push({bill:sp.bill,kind:sp.kind||'sponsored',mark:m.pvp,ref:sp.ref});}
  return out;
}

// Outside money: the for-to-against ratio, always that way round. The larger side gets the number and the other is 1
// ("2.1 : 1" more for, "1 : 2.1" more against); "no opposing spending" / "no supporting spending" when one side is zero;
// null when both are. side says which way it leans ('even' when it reads 1 : 1), for coloring.
// share = for / (for + against) places the ratio on the chart's scale: 1 is all for, 0.5 is 1 : 1, 0 is all against.
export function moneyRatio(f,a){
  f=Math.max(0,+f||0);a=Math.max(0,+a||0);
  if(!f&&!a)return null;
  const n=x=>x>=9.95?String(Math.round(x)):String(Math.round(x*10)/10);
  const text=!a?'no opposing spending':!f?'no supporting spending':f>=a?`${n(f/a)} : 1`:`1 : ${n(a/f)}`;
  return {share:f/(f+a),text,side:text==='1 : 1'?'even':f>a?'for':'against',oneSided:!a||!f};
}
