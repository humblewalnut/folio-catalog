import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pricePublication} from './market-feed.mjs';
import {expandCompactFeed} from './compact-feed.mjs';
const script=new URL('../scripts/refresh-pricing-v3.mjs',import.meta.url);

test('pricing-v3 publishes automatic routes, holds large moves, guards coverage and withdraws removed routes',()=>{
  const root=mkdtempSync(join(tmpdir(),'folio-v3-'));
  try{
    const primary=join(root,'primary'),output=join(root,'output'),archive=join(root,'archive'),reviewed=join(root,'reviewed.json'),automatic=join(root,'automatic.json');
    mkdirSync(join(primary,'releases'),{recursive:true});mkdirSync(archive);
    const write=(path,value)=>writeFileSync(path,JSON.stringify(value));
    const stamp=n=>new Date(Date.now()-n*60000).toISOString();
    const pub=pricePublication({schemaVersion:1,generatedAt:stamp(120),entries:[]});write(join(primary,'manifest.json'),pub.manifest);writeFileSync(join(primary,'releases',pub.manifest.sha256+'.json'),pub.bytes);
    write(reviewed,[]);
    const ids=Array.from({length:60},(_,i)=>i+1);
    const routes=keep=>({schemaVersion:1,matchedAt:stamp(200),methods:['tcgdex-crosswalk+number+name'],groups:{1:'Set'},
      routes:ids.filter(keep).map(i=>[`tcgdex-en-set-${i}`,0,0,null,1000+i,1,`Card ${i}`,`${i}/60`,'Normal',0])});
    write(automatic,routes(()=>true));
    write(join(archive,'groups.json'),{success:true,results:[{groupId:1,categoryId:3,name:'Set'}]});
    write(join(archive,'1-products.json'),{success:true,results:ids.map(i=>({productId:1000+i,categoryId:3,groupId:1,name:`Card ${i}`,url:`https://www.tcgplayer.com/product/${1000+i}/card-${i}`,extendedData:[{name:'Number',value:`${i}/60`}]}))});
    const prices=price=>write(join(archive,'1-prices.json'),{success:true,results:ids.map(i=>({productId:1000+i,subTypeName:'Normal',marketPrice:price(i)}))});
    const build=n=>writeFileSync(join(archive,'last-updated.txt'),stamp(n));
    const preload=join(root,'offline.mjs');writeFileSync(preload,"globalThis.fetch=async()=>{throw Error('offline');};");
    const run=(archived=true,status=0)=>{const r=spawnSync(process.execPath,['--import',preload,script.pathname,'--primary',primary,'--reviewed',reviewed,'--automatic',automatic,'--output',output,...(archived?['--archive',archive]:[])],{encoding:'utf8'});assert.equal(r.status,status,r.stderr);return JSON.parse(r.stdout.trim().split('\n').pop());};
    const feed=()=>{const m=JSON.parse(readFileSync(join(output,'manifest.json')));return expandCompactFeed(JSON.parse(readFileSync(join(output,'releases',m.sha256+'.json'))));};
    const amount=id=>feed().entries.find(e=>e.identity.cardID===`tcgdex-en-set-${id}`)?.references[0]?.amount;

    prices(i=>i===1?10:0.1);build(100);
    assert.equal(run().available,60);assert.equal(amount(1),'10');
    assert.equal(run(false).outcome,'cached');

    prices(i=>i===1?100:0.5);build(90);
    const moved=run();assert.equal(moved.held,1);assert.equal(amount(1),'10');assert.equal(amount(2),'0.5');
    assert.equal(JSON.parse(readFileSync(join(output,'report.json'))).reviews[0].candidate,'100');

    const before=JSON.parse(readFileSync(join(output,'manifest.json'))).sha256;
    prices(i=>i>10?null:1);build(80);
    assert.equal(run(true,1).outcome,'coverage_loss_held');
    assert.equal(JSON.parse(readFileSync(join(output,'manifest.json'))).sha256,before);

    write(join(output,'state.json'),{...JSON.parse(readFileSync(join(output,'state.json'))),fetchedAt:stamp(1500)});
    assert.equal(run(false).outcome,'source_unavailable_retained');
    assert.equal(JSON.parse(readFileSync(join(output,'manifest.json'))).sha256,before);

    prices(()=>1);build(70);write(automatic,routes(i=>i!==5));run();
    const withdrawn=feed().entries.find(e=>e.identity.cardID==='tcgdex-en-set-5');
    assert.equal(withdrawn.status,'unsupported');assert.equal(withdrawn.references.length,0);
    assert.ok(readdirSync(join(output,'releases')).length<=2);
  }finally{rmSync(root,{recursive:true,force:true});}
});
