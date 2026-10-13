import {createHash} from 'node:crypto';
import {marketIdentity,reviewedMappings} from './marketplaces.mjs';

export function validateFeed(feed,now=Date.now()){
  if(feed?.schemaVersion!==1||!Array.isArray(feed.entries)||feed.entries.length>10000||!Number.isFinite(Date.parse(feed.generatedAt))||Date.parse(feed.generatedAt)>now)throw new Error('Invalid price feed.');
  const seen=new Set();
  for(const entry of feed.entries){
    const i=entry.identity,key=marketIdentity(i??{});
    if(!i||Object.keys(i).some(k=>!['cardID','language','finish','edition','variant'].includes(k))||typeof i.cardID!=='string'||!i.cardID||i.cardID.length>300||!['English','Japanese'].includes(i.language)||!['Normal','Holo','Reverse holo'].includes(i.finish)||['edition','variant'].some(k=>i[k]!=null&&(typeof i[k]!=='string'||i[k].length>100))||seen.has(key)||!['available','unavailable','ambiguous','unsupported'].includes(entry.status)||!Array.isArray(entry.references)||entry.references.length>2)throw new Error('Invalid price identity.');
    seen.add(key);const currencies=new Set();
    if((entry.status==='available')!==Boolean(entry.references.length))throw new Error('Invalid price availability.');
    for(const r of entry.references){
      const stamp=Date.parse(r.observedAt),amount=Number(r.amount);
      if(typeof r.amount!=='string'||!r.amount.trim()||!Number.isFinite(amount)||amount<=0||amount>1e9||!Number.isFinite(stamp)||stamp<=0||stamp>Date.parse(feed.generatedAt)||!['USD','EUR'].includes(r.currency)||currencies.has(r.currency)||!['current','older'].includes(r.status)||typeof r.meaning!=='string'||!r.meaning||r.meaning.length>300||!(r.currency==='USD'?r.source==='TCGplayer via TCGdex':['Cardmarket','Cardmarket via TCGdex'].includes(r.source)))throw new Error('Invalid dated price.');
      currencies.add(r.currency);
    }
  }
  return feed;
}
// Failed requests preserve old dates. Verified ambiguity/unavailability removes obsolete prices.
// Successful but lagging sources cannot roll an existing observation backwards.
export async function refreshFeed({markets,mappings,previous=null,now=()=>Date.now()}){
  reviewedMappings(mappings,now());if(previous)validateFeed(previous,now());
  if(new Set(mappings.map(m=>marketIdentity(m.identity))).size!==mappings.length)throw new Error('Duplicate approved mappings.');
  const old=new Map((previous?.entries??[]).map(e=>[marketIdentity(e.identity),e])),entries=[];
  let refreshed=0,failed=0,ambiguous=0;
  for(const m of mappings){
    const before=old.get(marketIdentity(m.identity));
    try{
      const result=await markets.lookup(m.identity);refreshed++;
      if(result.status==='available')result.references=result.references.map(r=>{
        const earlier=before?.references.find(x=>x.currency===r.currency);
        return earlier&&Date.parse(earlier.observedAt)>Date.parse(r.observedAt)?earlier:r;
      });
      if(result.status==='ambiguous')ambiguous++;
      entries.push(result);
    }catch{
      failed++;if(before)entries.push(before);
    }
  }
  // Do not replace the last good publication during a provider-wide outage.
  if(!mappings.length||refreshed/mappings.length<0.8)throw new Error(`Price refresh incomplete: ${refreshed}/${mappings.length} verified requests; previous publication retained.`);
  const approved=new Set(mappings.map(m=>marketIdentity(m.identity)));
  for(const entry of old.values())if(!approved.has(marketIdentity(entry.identity)))entries.push({identity:entry.identity,status:'unsupported',references:[]});
  const feed={schemaVersion:1,generatedAt:new Date(now()).toISOString(),entries};
  validateFeed(feed,now());return {feed,report:{reviewed:mappings.length,refreshed,failed,ambiguous}};
}
export function pricePublication(feed){
  validateFeed(feed);const bytes=Buffer.from(JSON.stringify(feed)+'\n'),sha256=createHash('sha256').update(bytes).digest('hex');
  return {bytes,manifest:{schemaVersion:1,generatedAt:feed.generatedAt,sha256,byteCount:bytes.length,
    payloadURL:`https://raw.githubusercontent.com/humblewalnut/folio-catalog/main/pricing/releases/${sha256}.json`}};
}
