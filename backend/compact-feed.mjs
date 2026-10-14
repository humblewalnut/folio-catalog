import {createHash} from 'node:crypto';
import {validateFeed} from './market-feed.mjs';

// pricing-v3 carries catalog-scale references. Each entry is
// [cardID, language, finish, edition, variant, status, [[source, amount, date], ...]]
// with languages, finishes and statuses as small codes and sources/dates as shared tables.
// Expanding it yields exactly the schema-1 feed, so every identity and price rule still applies.
export const compactLimits={entries:100000,bytes:20_000_000};
const LANGUAGES=['English','Japanese'],FINISHES=['Normal','Holo','Reverse holo'];
const STATUSES={a:'available',u:'unavailable',m:'ambiguous',s:'unsupported'};
const CODES=Object.fromEntries(Object.entries(STATUSES).map(([k,v])=>[v,k]));
export const v3PayloadURL=sha256=>`https://raw.githubusercontent.com/humblewalnut/folio-catalog/main/pricing-v3/releases/${sha256}.json`;

export function compactFeed(feed){
  validateFeed(feed,Date.now(),{maxEntries:compactLimits.entries});
  const sources=[],sourceIndex=new Map(),dates=[],dateIndex=new Map();
  const intern=(list,index,key,value)=>{if(!index.has(key)){index.set(key,list.length);list.push(value);}return index.get(key);};
  const entries=feed.entries.map(({identity:i,status,references})=>[i.cardID,LANGUAGES.indexOf(i.language),FINISHES.indexOf(i.finish),i.edition??null,i.variant??null,CODES[status],
    references.map(r=>[intern(sources,sourceIndex,JSON.stringify([r.source,r.currency,r.meaning]),{source:r.source,currency:r.currency,meaning:r.meaning}),r.amount,intern(dates,dateIndex,r.observedAt,r.observedAt)])]);
  return {schemaVersion:2,generatedAt:feed.generatedAt,sources,dates,entries};
}

/** Reference status is relative to publication time, as in the schema-1 feed. */
export function expandCompactFeed(compact,now=Date.now()){
  if(compact?.schemaVersion!==2||!Array.isArray(compact.entries)||compact.entries.length>compactLimits.entries||!Array.isArray(compact.sources)||!Array.isArray(compact.dates)||compact.sources.length>50||compact.dates.length>compact.entries.length+50)throw Error('Invalid compact price feed.');
  const generated=Date.parse(compact.generatedAt);
  const entries=compact.entries.map(e=>{
    if(!Array.isArray(e)||e.length!==7||!LANGUAGES[e[1]]||!FINISHES[e[2]]||!STATUSES[e[5]]||!Array.isArray(e[6]))throw Error('Invalid compact price entry.');
    const identity={cardID:e[0],language:LANGUAGES[e[1]],finish:FINISHES[e[2]]};
    if(e[3]!==null)identity.edition=e[3];if(e[4]!==null)identity.variant=e[4];
    const references=e[6].map(r=>{
      const source=compact.sources[r?.[0]],observedAt=compact.dates[r?.[2]];
      if(!Array.isArray(r)||r.length!==3||!source||typeof observedAt!=='string')throw Error('Invalid compact price reference.');
      return {amount:r[1],currency:source.currency,source:source.source,observedAt,meaning:source.meaning,status:generated-Date.parse(observedAt)<=86400000?'current':'older'};
    });
    return {identity,status:STATUSES[e[5]],references};
  });
  return validateFeed({schemaVersion:1,generatedAt:compact.generatedAt,entries},now,{maxEntries:compactLimits.entries});
}

export function compactPublication(feed){
  const compact=compactFeed(feed),bytes=Buffer.from(JSON.stringify(compact)+'\n');
  if(bytes.length>compactLimits.bytes)throw Error('Compact price feed exceeds its size limit.');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  return {bytes,manifest:{schemaVersion:2,generatedAt:feed.generatedAt,sha256,byteCount:bytes.length,payloadURL:v3PayloadURL(sha256)}};
}
