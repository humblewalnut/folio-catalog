#!/usr/bin/env node
// Publish a separately versioned enhanced feed. Build 38 keeps its original feed.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {validateTCGCSVMaps,tcgcsvEntry,tcgcsvSource,tcgcsvKey} from '../backend/tcgcsv.mjs';
import {validateFeed,pricePublication} from '../backend/market-feed.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,s)=>i%2?a:[...a,[x,s[i+1]]],[]));
for(const k of ['--mappings','--primary','--output'])if(!args[k])throw Error('Provide mappings, primary and output');
const output=resolve(args['--output']),primary=resolve(args['--primary']);mkdirSync(output,{recursive:true});
const read=p=>JSON.parse(readFileSync(p));
function publication(dir){const m=read(join(dir,'manifest.json'));if(!/^[a-f0-9]{64}$/.test(m.sha256))throw Error('Invalid manifest');const b=readFileSync(join(dir,'releases',m.sha256+'.json'));if(b.length!==m.byteCount||createHash('sha256').update(b).digest('hex')!==m.sha256)throw Error('Publication integrity mismatch');const f=validateFeed(JSON.parse(b));if(f.generatedAt!==m.generatedAt)throw Error('Date mismatch');return f;}
const base=publication(primary),maps=validateTCGCSVMaps(read(args['--mappings'])),revision=createHash('sha256').update(JSON.stringify(maps)).digest('hex');
const previous=existsSync(join(output,'manifest.json'))?publication(output):null;
const statePath=join(output,'tcgcsv-state.json'),state=existsSync(statePath)?read(statePath):null;
let entries=[],newState=state,requests=0,outcome='cached';
const archive=args['--archive']?resolve(args['--archive']):null;
const fetchText=async url=>{requests++;const response=await fetch(url,{headers:{'User-Agent':'Folio-Pricing/1.0'},redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('TCGCSV unavailable');const length=Number(response.headers.get('content-length'));if(length>6000000)throw Error('Oversized response');let n=0,chunks=[];for await(const chunk of response.body){n+=chunk.length;if(n>6000000)throw Error('Oversized response');chunks.push(chunk);}await new Promise(r=>setTimeout(r,150));return Buffer.concat(chunks).toString();};
try{
 // Schedules drift by minutes. A rolling 24-hour cache skips the next daily
 // run when yesterday finished later, even though today's source is available.
 const recent=state&&Number.isFinite(Date.parse(state.fetchedAt))&&new Date(state.fetchedAt).toISOString().slice(0,10)===new Date().toISOString().slice(0,10);
 const deferRoutes=()=>{
  if(!previous)throw Error('No prior enhanced publication to retain');
  const report={checkedAt:new Date().toISOString(),outcome:'routes_wait_for_next_daily_build',requests,reviewed:maps.length,available:state.entries.filter(e=>e.references.length).length,held:state.held??0,sourceStamp:state.sourceStamp};
  writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));process.exit(0);
 };
 if(!archive&&recent){if(state.mappingRevision!==revision)deferRoutes();entries=state.entries;}
 else{
  const rawStamp=archive?readFileSync(join(archive,'last-updated.txt'),'utf8'):await fetchText('https://tcgcsv.com/last-updated.txt');const stamp=new Date(rawStamp.trim()).toISOString();
  if(state&&Date.parse(stamp)<Date.parse(state.sourceStamp))throw Error('Source timestamp regressed');
  if(Date.parse(stamp)>Date.now()||Date.now()-Date.parse(stamp)>7*86400000)throw Error('Invalid source timestamp');
  if(!archive&&state?.sourceStamp===stamp){if(state.mappingRevision!==revision)deferRoutes();entries=state.entries;newState={...state,fetchedAt:new Date().toISOString()};}
  else{
   const categories=new Map(),groups=new Map();
   for(const c of new Set(maps.map(m=>m.categoryID))){const name=c===3?'groups.json':'japanese-groups.json';const data=archive?read(join(archive,name)):JSON.parse(await fetchText(`https://tcgcsv.com/tcgplayer/${c}/groups`));if(!data.success||!Array.isArray(data.results))throw Error('Invalid category');categories.set(c,data.results);}
   for(const m of maps){
    const category=categories.get(m.categoryID).filter(g=>g.groupId===m.groupID&&g.categoryId===m.categoryID&&g.name===m.groupName);if(category.length!==1)throw Error('Set identity changed');
    const key=`${m.categoryID}/${m.groupID}`;
    if(!groups.has(key)){const pair={};for(const kind of ['products','prices'])pair[kind]=archive?read(join(archive,`${m.groupID}-${kind}.json`)):JSON.parse(await fetchText(`https://tcgcsv.com/tcgplayer/${key}/${kind}`));groups.set(key,pair);}
    const data=groups.get(key);entries.push(tcgcsvEntry(m,data.products,data.prices,stamp));
   }
   if(!archive&&new Date((await fetchText('https://tcgcsv.com/last-updated.txt')).trim()).toISOString()!==stamp)throw Error('Source changed during snapshot read');
   // Hold unusual movements against the prior published value for manual review.
   const old=new Map((state?.entries??[]).map(e=>[tcgcsvKey(e.identity),e]));let held=0;const reviews=[];
   entries=entries.map(e=>{const p=old.get(tcgcsvKey(e.identity)),a=Number(e.references[0]?.amount),b=Number(p?.references[0]?.amount);if(a&&b&&Math.abs(a/b-1)>.35){held++;reviews.push({identity:e.identity,reason:'movement_over_35_percent',previous:p.references[0],candidate:e.references[0]});return p;}return e;});
   newState={sourceStamp:stamp,fetchedAt:new Date().toISOString(),mappingRevision:revision,held,reviews,entries};outcome=held?'needs_review':'updated';
  }
 }
}catch(error){if(!state||state.mappingRevision!==revision)throw error;entries=state.entries;outcome='source_unavailable_retained';}
const merged=new Map(base.entries.map(e=>[tcgcsvKey(e.identity),e]));
for(const e of entries){const old=merged.get(tcgcsvKey(e.identity));const references=[...e.references,...(old?.references??[]).filter(r=>r.currency!=='USD')];merged.set(tcgcsvKey(e.identity),{identity:e.identity,status:references.length?'available':e.status,references});}
// Removed enhanced routes cannot silently revive a previously cached quote.
for(const e of previous?.entries??[])if(e.references.some(r=>r.source===tcgcsvSource)&&!merged.has(tcgcsvKey(e.identity)))merged.set(tcgcsvKey(e.identity),{identity:e.identity,status:'unsupported',references:[]});
const feed=validateFeed({schemaVersion:1,generatedAt:new Date().toISOString(),entries:[...merged.values()]});
const {bytes,manifest}=pricePublication(feed);manifest.payloadURL=manifest.payloadURL.replace('/pricing/','/pricing-v2/');
mkdirSync(join(output,'releases'),{recursive:true});writeFileSync(join(output,'releases',manifest.sha256+'.json'),bytes);
writeFileSync(statePath+'.tmp',JSON.stringify(newState,null,2)+'\n');renameSync(statePath+'.tmp',statePath);
writeFileSync(join(output,'report.json'),JSON.stringify({checkedAt:feed.generatedAt,outcome,requests,reviewed:maps.length,available:entries.filter(e=>e.references.length).length,held:newState?.held??0,sourceStamp:newState?.sourceStamp},null,2)+'\n');
writeFileSync(join(output,'manifest.json.tmp'),JSON.stringify(manifest,null,2)+'\n');renameSync(join(output,'manifest.json.tmp'),join(output,'manifest.json'));
console.log(JSON.stringify({outcome,requests,reviewed:maps.length,available:entries.filter(e=>e.references.length).length,held:newState?.held??0}));
