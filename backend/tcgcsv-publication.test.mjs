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
 const run=(archived=false)=>{const r=spawnSync(process.execPath,['--import',preload,script.pathname,'--mappings',mapping,'--primary',primary,'--output',output,...(archived?['--archive',archive]:[])],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const state=()=>JSON.parse(readFileSync(join(output,'tcgcsv-state.json')));
 assert.equal(run(true).available,1);assert.equal(run().requests,0);assert.equal(state().entries[0].references[0].observedAt,stamp);
 prices(100);writeFileSync(join(archive,'last-updated.txt'),new Date(Date.now()-1800000).toISOString());assert.equal(run(true).held,1);assert.equal(state().entries[0].references[0].amount,'10');assert.equal(state().reviews[0].candidate.amount,'100');
 write(join(output,'tcgcsv-state.json'),{...state(),fetchedAt:new Date(Date.now()-86400001).toISOString()});assert.equal(run().outcome,'source_unavailable_retained');assert.equal(state().entries[0].references[0].observedAt,stamp);
 write(mapping,[]);run(true);const manifest=JSON.parse(readFileSync(join(output,'manifest.json')));const feed=JSON.parse(readFileSync(join(output,'releases',manifest.sha256+'.json')));assert.equal(feed.entries[0].status,'unsupported');assert.equal(feed.entries[0].references.length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
