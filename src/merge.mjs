// Merging the same record reported by several sources, so each trade, state bill or article appears once.
// The official record wins whenever sources disagree, and disagreements are listed for review.
import {tradeKey} from './feeds.mjs';

const fold=v=>String(v||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();
const DAY=86400000;
const gap=(a,b)=>Math.abs(Date.parse(a)-Date.parse(b))/DAY;

// Stock trades: the same member, company, date, buy or sell, and amount range from more than one service is one trade.
// Each trade is then matched to the member's official House periodic transaction report filed on (or within 3 days of)
// the disclosure date the services give; the official filing date and link win. Two services reporting the same
// company, date and type with different amounts, or different disclosure dates, are flagged for review.
// The official reports, read straight from the House Clerk and the Senate eFD site. A trade they report keeps their
// filing date and link; officialFrom is the earliest date those readers cover, so a trade only a service reports after
// it is flagged for review.
const OFFICIAL=new Set(['House Clerk','Senate eFD']);
export function mergeTrades(lists,filings=[],sectors={},{officialFrom=null}={}){
  const groups=new Map();
  for(const rows of lists)for(const t of rows||[]){
    const k=tradeKey(t)+'#'+(t.id||'').split('#')[1];
    const g=groups.get(k);
    if(!g){groups.set(k,{...t,id:k,sources:[t.source],disclosedBy:{[t.source]:t.disclosed},links:t.link?[t.link]:[]});continue;}
    if(!g.sources.includes(t.source))g.sources.push(t.source);
    g.disclosedBy[t.source]=t.disclosed;if(t.link&&!g.links.includes(t.link))g.links.push(t.link);
    g.official=g.official||t.official;g.assetType=g.assetType||t.assetType;
    // The official report's description wins over a service's.
    if(OFFICIAL.has(t.source)){g.asset=t.asset||g.asset;g.owner=t.owner||g.owner;}
    g.asset=g.asset||t.asset;g.owner=g.owner||t.owner;g.ticker=g.ticker||t.ticker;
  }
  const out=[...groups.values()];
  const ptrs=filings.filter(f=>f.ptr&&f.filed);
  for(const t of out){
    const review=[];
    const dates=[...new Set(Object.entries(t.disclosedBy).filter(([s])=>!OFFICIAL.has(s)).map(([,d])=>d).filter(Boolean))];
    if(t.official){
      t.filed=t.official.filed;
      if(dates.some(d=>d!==t.official.filed))review.push('A service gives a different disclosure date; the official report\'s date is used');
    }else{
    if(dates.length>1)review.push(`Services give different disclosure dates (${dates.join(', ')})`);
    if(officialFrom&&t.traded>=officialFrom)review.push('Not found in the official reports read so far; check the filing');
    const near=ptrs.filter(f=>dates.some(d=>gap(d,f.filed)<=3)&&Date.parse(f.filed)>=Date.parse(t.traded)).sort((a,b)=>Math.min(...dates.map(d=>gap(d,a.filed)))-Math.min(...dates.map(d=>gap(d,b.filed))));
    if(near.length){t.official={doc:near[0].id,filed:near[0].filed,url:near[0].url};t.filed=near[0].filed;if(dates.length&&!dates.includes(near[0].filed))review.push('Disclosure date differs from the official filing; the official date is used');}
    else t.filed=dates.sort()[0]||null;
    }
    const s=t.ticker&&sectors[t.ticker];if(s){t.sector=s.sector;t.industry=s.industry;}
    t.review=review;
    delete t.source;delete t.disclosed;delete t.link;delete t.doc;
  }
  // Same company, date and type but a different amount range from different services: likely one trade, needs review.
  const loose=new Map();
  for(const t of out){const k=[t.traded,t.ticker||fold(t.asset).slice(0,40),t.type].join('|');(loose.get(k)||loose.set(k,[]).get(k)).push(t);}
  for(const ts of loose.values())if(ts.length>1&&new Set(ts.flatMap(t=>t.sources)).size>1&&new Set(ts.map(t=>`${t.low}-${t.high}`)).size>1)
    for(const t of ts)t.review.push('Services disagree on the amount range');
  return out.sort((a,b)=>b.traded.localeCompare(a.traded));
}

// State bills: Open States and LegiScan records of the same bill (state, session year and bill number) are one bill.
// Open States wins on title and role; a LegiScan-only bill is kept, and a mismatch in the session is flagged.
export const stateBillKey=b=>[b.state,String(b.year||String(b.session).match(/\d{4}/)?.[0]||''),String(b.identifier||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^([A-Z]+)0+/,'$1')].join('|');
export function mergeStateBills(openstates=[],legiscan=[]){
  const out=new Map();
  for(const b of openstates)out.set(stateBillKey(b),{...b,sources:['Open States'],links:b.url?[b.url]:[]});
  for(const b of legiscan){
    const k=stateBillKey(b),m=out.get(k);
    if(!m){out.set(k,{...b,sources:['LegiScan'],links:b.url?[b.url]:[]});continue;}
    m.sources.push('LegiScan');if(b.url)m.links.push(b.url);m.title=m.title||b.title;
  }
  return [...out.values()].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
}

// News: the same article (same address, ignoring tracking parameters and "www.") from GDELT and the Times is one item.
export const articleKey=u=>{try{const x=new URL(u);return (x.host.replace(/^www\./,'')+x.pathname.replace(/\/+$/,'')).toLowerCase();}catch{return String(u);}};
export function mergeNews(...lists){
  const out=new Map();
  for(const rows of lists)for(const a of rows||[]){
    const k=articleKey(a.url),m=out.get(k);
    if(!m){out.set(k,{...a,sources:[a.source]});continue;}
    if(!m.sources.includes(a.source))m.sources.push(a.source);
    m.title=m.title||a.title;m.summary=m.summary||a.summary;m.date=[m.date,a.date].filter(Boolean).sort()[0]||null;
  }
  return [...out.values()].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
}

// Committees: the official Senate and House lists compared with the reviewed list (public/committees.json).
export function committeeDiff(official=[],reviewed=[]){
  const a=new Set(official.map(c=>c.id)),b=new Set(reviewed.map(c=>c.id));
  return {added:[...a].filter(x=>!b.has(x)),removed:[...b].filter(x=>!a.has(x))};
}
