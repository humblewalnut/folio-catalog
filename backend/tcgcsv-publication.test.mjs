import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pricePublication} from './market-feed.mjs';
const script=new URL('../scripts/refresh-tcgcsv-feed.mjs',import.meta.url);
test('publication caches daily reads, retains outliers and outages, and withdraws removed routes',()=>{
 const root=mkdtempSync(join(tmpdir(),'folio-tcgcsv-'));
 try {
 const primary=join(root,'primary'),output=join(root,'output'),archive=join(root,'archive'),mapping=join(root,'maps.json');
 mkdirSync(join(primary,'releases'),{recursive:true});mkdirSync(archive);
 const stamp=new Date(Date.now()-3600000).toISOString();
 const write=(path,value)=>writeFileSync(path,JSON.stringify(value));
 const pub=pricePublication({schemaVersion:1,generatedAt:stamp,entries:[]});write(join(primary,'manifest.json'),pub.manifest);writeFileSync(join(primary,'releases',pub.manifest.sha256+'.json'),pub.bytes);
 const m={identity:{cardID:'test',language:'English',finish:'Normal'},categoryID:3,groupID:1,groupName:'Set',productID:2,productName:'Card',number:'1',printing:'Normal',reviewedAt:stamp,evidenceURL:'https://www.tcgplayer.com/product/2/card'};
 write(mapping,[m]);writeFileSync(join(archive,'last-updated.txt'),stamp);
 write(join(archive,'groups.json'),{success:true,results:[{groupId:1,categoryId:3,name:'Set'}]});
 write(join(archive,'1-products.json'),{success:true,results:[{productId:2,categoryId:3,groupId:1,name:'Card',url:m.evidenceURL,extendedData:[{name:'Number',value:'1'}]}]});
 const prices=n=>write(join(archive,'1-prices.json'),{success:true,results:[{productId:2,subTypeName:'Normal',marketPrice:n}]});prices(10);
 const preload=join(root,'offline.mjs');writeFileSync(preload,"globalThis.fetch=async()=>{throw Error('offline');};");
 const run=(archived=false,loader=preload)=>{const r=spawnSync(process.execPath,['--import',loader,script.pathname,'--mappings',mapping,'--primary',primary,'--output',output,...(archived?['--archive',archive]:[])],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const state=()=>JSON.parse(readFileSync(join(output,'tcgcsv-state.json')));
 assert.equal(run(true).available,1);assert.equal(run().requests,0);assert.equal(state().entries[0].references[0].observedAt,stamp);
 prices(100);writeFileSync(join(archive,'last-updated.txt'),new Date(Date.now()-1800000).toISOString());assert.equal(run(true).held,1);assert.equal(state().entries[0].references[0].amount,'10');assert.equal(state().reviews[0].candidate.amount,'100');
 write(join(output,'tcgcsv-state.json'),{...state(),fetchedAt:new Date(Date.now()-86400001).toISOString()});assert.equal(run().outcome,'source_unavailable_retained');assert.equal(state().entries[0].references[0].observedAt,stamp);
 // A route change during today's cache window must not abort the whole
 // workflow or bless new mappings with old evidence.
 write(join(output,'tcgcsv-state.json'),{...state(),fetchedAt:new Date().toISOString()});
 const originalManifest=readFileSync(join(output,'manifest.json'),'utf8');
 const changed={...m,productName:'Changed identity'};write(mapping,[changed]);
 assert.equal(run().outcome,'routes_wait_for_next_daily_build');
 assert.equal(readFileSync(join(output,'manifest.json'),'utf8'),originalManifest);
 write(mapping,[m]);
 // Yesterday's successful read can be less than 24h ago. It must still check
 // today's build, rather than skip a scheduled day due to a few minutes' drift.
 const yesterday=new Date();yesterday.setUTCDate(yesterday.getUTCDate()-1);yesterday.setUTCHours(23,59,59,0);
 write(join(output,'tcgcsv-state.json'),{...state(),fetchedAt:yesterday.toISOString()});
 prices(11);const newer=new Date(Date.now()-60000).toISOString();writeFileSync(join(archive,'last-updated.txt'),newer);
 const online=join(root,'source.mjs');writeFileSync(online,`import fs from 'node:fs';const root=${JSON.stringify(archive)};globalThis.fetch=async u=>{const path=new URL(u).pathname;const file=path==='/last-updated.txt'?'last-updated.txt':path.endsWith('/groups')?'groups.json':'1-'+path.split('/').at(-1)+'.json';return new Response(fs.readFileSync(root+'/'+file));};`);
 assert.equal(run(false,online).outcome,'updated');assert.equal(state().sourceStamp,newer);assert.equal(state().entries[0].references[0].amount,'11');
 // The same upstream build with revised mappings is a nonfatal deferral too.
 write(mapping,[changed]);write(join(output,'tcgcsv-state.json'),{...state(),fetchedAt:yesterday.toISOString()});
 assert.equal(run(false,online).outcome,'routes_wait_for_next_daily_build');
 write(mapping,[]);run(true);const manifest=JSON.parse(readFileSync(join(output,'manifest.json')));const feed=JSON.parse(readFileSync(join(output,'releases',manifest.sha256+'.json')));assert.equal(feed.entries[0].status,'unsupported');assert.equal(feed.entries[0].references.length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
