// Each person's three reviewed grades (Promises delivered, Ethics, Workers > Profit) from the reviewed research, the
// committee lists and the committee sectors. The page and the monthly recalculation (scripts/scores-monthly.mjs) both
// use this, so they always agree. Your match is not here: it depends on each visitor's own choices.
import {billKey,billKeyFromText,promiseScore,tradeChecks,ethicsScore,pvpScore,pvpActions} from './grades.js';
import {tradesInDonors} from './influence.js';

export const voteBill=v=>billKeyFromText((v.bill||{}).measure);
// A president's record entries on bills and orders ({bill: "119-hr-1" or "eo-14251", position: "Signed" or "Vetoed"}).
export function executiveActions(s){
  return (s.record||[]).map((r,i)=>r.bill&&/^(Signed|Vetoed)/.test(r.position||'')?{bill:r.bill,kind:r.position==='Vetoed'?'vetoed':/^eo-/.test(r.bill)?'order':'signed',ref:`${s.id}:rec:${i}`}:null).filter(Boolean);
}
export function makeScorer(data,committees={committees:{},people:{}},sectors={}){
  const votes=data.votes.concat(data.hvotes);
  // Workers > Profit: bills marked People or Profit (research.json "bills"), and each person's votes and sponsorships on them.
  const marks=new Map((data.bills||[]).filter(b=>b.pvp==='people'||b.pvp==='profit').map(b=>[b.id,b]));
  // A subcommittee seat counts under its full committee.
  const committeesOf=s=>committees.people[s.id]||[];
  const fullCommittee=id=>(committees.committees[id]||{}).parent||id;
  const overseen=s=>[...new Set(committeesOf(s).flatMap(c=>(sectors[fullCommittee(c.id)]||{}).sectors||[]))];
  // The disclosures cover members of Congress (Periodic Transaction Reports). A president files OGE Form 278-T, which is
  // not imported yet, and anyone else has no trading data.
  const coveredBy=s=>!!s.bioguide&&!s.office;
  // Donors: the PACs that gave to the campaign and the groups whose positions are compared, matched to traded companies.
  const donorsOf=s=>[...(s.pac?.rows||[]).map(r=>({org:(data.pacNames||[])[r[0]]})),...(s.funderPos||[]).map(g=>({org:g.org}))].filter(d=>d.org);
  const trading=s=>{const t=tradeChecks(s.trades,overseen(s));
    return Object.assign(t,{covered:coveredBy(s),annual:s.annualDisclosures||[],inDonors:new Set(tradesInDonors(t.rows,donorsOf(s)).map(x=>x.trade)).size});};
  // Cases are aged against the date of the reviewed research ("asof"), so the page and the monthly log agree.
  const asOfYear=Number(String(data.asof||'').match(/\b(19|20)\d{2}\b/)?.[0])||null;
  return {
    marks,committeesOf,fullCommittee,overseen,trading,asOfYear,
    promises:s=>promiseScore(s.statements,s.promiseTrackers),
    ethics:s=>ethicsScore(s.ethics,trading(s),{asOfYear}),
    pvp(s){
      const v=votes.filter(v=>v.pos&&s.id in v.pos).map(v=>({bill:voteBill(v),pos:v.pos[s.id],ref:v.id}));
      const spons=(s.bills||[]).map((b,i)=>({bill:billKey(b.congress,b.num),kind:'sponsored',ref:`${s.id}:bill:${i}`}))
        .concat((s.cosponsored||[]).map(b=>({bill:b.bill||billKey(b.congress,b.num),kind:'cosponsored'})))
        .concat(executiveActions(s));
      return pvpScore(pvpActions(marks,v,spons));
    },
  };
}
