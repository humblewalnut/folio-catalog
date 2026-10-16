#!/usr/bin/env node
// Publish the catalog-scale pricing-v3 channel: the reviewed primary feed plus every reviewed
// and automatically matched TCGplayer raw route, in the compact format. pricing/ and
// pricing-v2/ keep serving older builds unchanged.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,readdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {validateTCGCSVMaps,automaticRoutes,tcgcsvEntry,tcgcsvSource,tcgcsvKey} from '../backend/tcgcsv.mjs';
import {validateFeed} from '../backend/market-feed.mjs';
import {compactPublication,expandCompactFeed,compactLimits} from '../backend/compact-feed.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,s)=>i%2?a:[...a,[x,s[i+1]]],[]));
for(const k of ['--primary','--reviewed','--automatic','--output'])if(!args[k])throw Error('Provide --primary, --reviewed, --automatic and --output');
const output=resolve(args['--output']),archive=args['--archive']?resolve(args['--archive']):null;mkdirSync(join(output,'releases'),{recursive:true});
const read=p=>JSON.parse(readFileSync(p));
const sha=b=>createHash('sha256').update(b).digest('hex');

function publication(dir,expand){
  const m=read(join(dir,'manifest.json'));if(!/^[a-f0-9]{64}$/.test(m.sha256))throw Error('Invalid manifest');
  const b=readFileSync(join(dir,'releases',m.sha256+'.json'));if(b.length!==m.byteCount||sha(b)!==m.sha256)throw Error('Publication integrity mismatch');
  const feed=expand(JSON.parse(b));if(feed.generatedAt!==m.generatedAt)throw Error('Date mismatch');return feed;
}
const base=publication(resolve(args['--primary']),f=>validateFeed(f));
const reviewed=validateTCGCSVMaps(read(resolve(args['--reviewed'])));
const reviewedKeys=new Set(reviewed.map(m=>tcgcsvKey(m.identity)));
// A hand-reviewed route always wins over an automatic match for the same printing.
const automatic=validateTCGCSVMaps(automaticRoutes(read(resolve(args['--automatic']))),Date.now(),{automatic:true}).filter(m=>!reviewedKeys.has(tcgcsvKey(m.identity)));
const maps=[...reviewed,...automatic],revision=sha(JSON.stringify(maps));
const previous=existsSync(join(output,'manifest.json'))?publication(output,expandCompactFeed):null;
const statePath=join(output,'state.json'),state=existsSync(statePath)?read(statePath):null;
let requests=0;
const fetchText=async url=>{
  if(++requests>3000)throw Error('Request budget exceeded');
  const response=await fetch(url,{headers:{'User-Agent':'Folio-Pricing/1.1'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('TCGCSV unavailable');
  let n=0;const chunks=[];for await(const chunk of response.body){n+=chunk.length;if(n>20000000)throw Error('Oversized response');chunks.push(chunk);}
  await new Promise(r=>setTimeout(r,150));return Buffer.concat(chunks).toString();
};
const source=async(path,file)=>archive?read(join(archive,file)):JSON.parse(await fetchText(`https://tcgcsv.com/tcgplayer/${path}`));
const finish=(outcome,extra={})=>{
  const report={checkedAt:new Date().toISOString(),outcome,requests,routes:maps.length,reviewed:reviewed.length,automatic:automatic.length,...extra};
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,reviews:undefined}));
};

// TCGCSV builds once a day; reread only for a newer build, and only route changes on a new build.
const recent=state&&Number.isFinite(Date.parse(state.fetchedAt))&&new Date(state.fetchedAt).toISOString().slice(0,10)===new Date().toISOString().slice(0,10);
if(!archive&&recent&&previous){finish(state.mappingRevision===revision?'cached':'routes_wait_for_next_daily_build');process.exit(0);}
let stamp;
try{stamp=new Date((archive?readFileSync(join(archive,'last-updated.txt'),'utf8'):await fetchText('https://tcgcsv.com/last-updated.txt')).trim()).toISOString();}
catch{finish('source_unavailable_retained');process.exit(0);}
if(Date.parse(stamp)>Date.now()||Date.now()-Date.parse(stamp)>7*86400000)throw Error('Invalid source timestamp');
if(state&&Date.parse(stamp)<Date.parse(state.sourceStamp))throw Error('Source timestamp regressed');
if(previous&&state?.sourceStamp===stamp&&state.mappingRevision===revision){
  writeFileSync(statePath,JSON.stringify({...state,fetchedAt:new Date().toISOString()},null,2)+'\n');finish('unchanged');process.exit(0);
}

const entries=new Map();
try{
  const groupLists=new Map();
  for(const category of new Set(maps.map(m=>m.categoryID))){
    const data=await source(`${category}/groups`,category===3?'groups.json':'japanese-groups.json');
    if(!data.success||!Array.isArray(data.results))throw Error('Invalid category');groupLists.set(category,data.results);
  }
  const byGroup=new Map();for(const m of maps){const k=`${m.categoryID}/${m.groupID}`;byGroup.set(k,[...(byGroup.get(k)??[]),m]);}
  for(const [key,group] of byGroup){
    const [category,groupID]=key.split('/').map(Number);
    const listed=groupLists.get(category).filter(g=>g.groupId===groupID&&g.categoryId===category);
    let products=null,prices=null;
    if(listed.length===1){products=await source(`${key}/products`,`${groupID}-products.json`);prices=await source(`${key}/prices`,`${groupID}-prices.json`);}
    for(const m of group){
      let entry;
      try{entry=listed.length===1&&listed[0].name===m.groupName?tcgcsvEntry(m,products,prices,stamp):{identity:m.identity,status:'ambiguous',references:[]};}
      catch(error){if(reviewedKeys.has(tcgcsvKey(m.identity))||/snapshot|response/.test(error.message))throw error;entry={identity:m.identity,status:'ambiguous',references:[]};}
      entries.set(tcgcsvKey(m.identity),entry);
    }
  }
  if(!archive&&new Date((await fetchText('https://tcgcsv.com/last-updated.txt')).trim()).toISOString()!==stamp)throw Error('Source changed during snapshot read');
}catch(error){
  if(!previous)throw error;
  finish('source_unavailable_retained',{error:error.message.slice(0,200)});process.exit(0);
}

// Hold large moves for review against the last publication. Sub-dollar swings on cheap cards are
// ordinary noise and are not held, so the queue stays reviewable at catalog scale.
const old=new Map((previous?.entries??[]).map(e=>[tcgcsvKey(e.identity),e]));
const reviews=[];
for(const [key,e] of entries){
  const before=old.get(key)?.references.find(r=>r.source===tcgcsvSource),a=Number(e.references[0]?.amount),b=Number(before?.amount);
  if(a&&b&&Math.abs(a/b-1)>0.35&&Math.abs(a-b)>=1){reviews.push({identity:e.identity,reason:'movement_over_35_percent',previous:before.amount,candidate:e.references[0].amount});entries.set(key,{...e,references:[before]});}
}

// Coverage circuit breaker: a broad loss of still-routed prices means the source or the
// matcher changed, not the market. Keep the previous publication and report it.
const available=[...entries.values()].filter(e=>e.references.length).length;
const previouslyAvailable=[...entries.keys()].filter(k=>old.get(k)?.references.some(r=>r.source===tcgcsvSource)).length;
if(previous&&previouslyAvailable>=50&&available<previouslyAvailable*0.9){
  finish('coverage_loss_held',{available,previouslyAvailable});process.exit(1);
}

const merged=new Map(base.entries.map(e=>[tcgcsvKey(e.identity),e]));
for(const [key,e] of entries){
  const references=[...e.references,...(merged.get(key)?.references??[]).filter(r=>r.currency!=='USD')];
  merged.set(key,{identity:e.identity,status:references.length?'available':e.status,references});
}
// Removed routes cannot silently revive a previously published quote.
for(const e of previous?.entries??[])if(e.references.some(r=>r.source===tcgcsvSource)&&!merged.has(tcgcsvKey(e.identity)))merged.set(tcgcsvKey(e.identity),{identity:e.identity,status:'unsupported',references:[]});

const generatedAt=new Date().toISOString();
const feed={schemaVersion:1,generatedAt,entries:[...merged.values()].map(e=>({...e,references:e.references.map(r=>({...r,status:Date.parse(generatedAt)-Date.parse(r.observedAt)<=86400000?'current':'older'}))}))};
validateFeed(feed,Date.now(),{maxEntries:compactLimits.entries});
const {bytes,manifest}=compactPublication(feed);
writeFileSync(join(output,'releases',manifest.sha256+'.json'),bytes);
// Keep the newest few releases so a phone that read the previous manifest can still finish.
const keep=new Set([manifest.sha256+'.json',...(previous?[read(join(output,'manifest.json')).sha256+'.json']:[])]);
for(const name of readdirSync(join(output,'releases')))if(!keep.has(name))rmSync(join(output,'releases',name));
writeFileSync(statePath+'.tmp',JSON.stringify({sourceStamp:stamp,fetchedAt:generatedAt,mappingRevision:revision},null,2)+'\n');renameSync(statePath+'.tmp',statePath);
finish(reviews.length?'needs_review':'updated',{sourceStamp:stamp,available,held:reviews.length,bytes:bytes.length,reviews:reviews.slice(0,200)});
writeFileSync(join(output,'manifest.json.tmp'),JSON.stringify(manifest,null,2)+'\n');renameSync(join(output,'manifest.json.tmp'),join(output,'manifest.json'));
