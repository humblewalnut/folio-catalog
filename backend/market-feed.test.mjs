import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {refreshFeed,validateFeed,pricePublication} from './market-feed.mjs';
const mapping=JSON.parse(readFileSync(new URL('./marketplace-mappings.json',import.meta.url)))[0];
const now=Date.now(),stamp=new Date(now-3600000).toISOString();
const row=()=>({identity:mapping.identity,status:'available',references:[{amount:'12.50',currency:'USD',source:'TCGplayer via TCGdex',observedAt:stamp,status:'current',meaning:'Raw reference'}]});
const seed=()=>({schemaVersion:1,generatedAt:new Date(now).toISOString(),entries:[row()]});
const mappings=Array.from({length:5},(_,i)=>({...mapping,identity:{...mapping.identity,cardID:'card-'+i}}));
test('partial failure keeps original prices/dates; lagging sources do not roll back',async()=>{
  const old=seed();old.entries=mappings.map(m=>({...row(),identity:m.identity}));
  const result=await refreshFeed({mappings,previous:old,now:()=>now,markets:{lookup:async identity=>{
    if(identity.cardID==='card-0')throw new Error('offline');
    const r={...row(),identity};r.references[0].observedAt=new Date(now-7200000).toISOString();r.references[0].amount='1';return r;
  }}});
  assert.equal(result.report.failed,1);assert.equal(result.feed.entries.length,5);
  assert.ok(result.feed.entries.every(e=>e.references[0].amount==='12.50'&&e.references[0].observedAt===stamp));
});
test('outage fails publication and explicit ambiguity/unavailability removes stale values',async()=>{
  await assert.rejects(()=>refreshFeed({mappings:[mapping],previous:seed(),now:()=>now,markets:{lookup:async()=>{throw new Error('offline');}}}));
  for(const status of ['ambiguous','unavailable']){
    const r=await refreshFeed({mappings:[mapping],previous:seed(),now:()=>now,markets:{lookup:async()=>({identity:mapping.identity,status,references:[]})}});
    assert.equal(r.feed.entries[0].references.length,0);assert.equal(r.feed.entries[0].status,status);
  }
});
test('rejects duplicate identities, invalid/future/zero values and inconsistent currency',()=>{
  for(const mutate of [f=>f.entries.push(row()),f=>f.entries[0].references[0].amount='0',f=>f.entries[0].references[0].observedAt='2099-01-01',f=>f.entries[0].references[0].currency='EUR',f=>f.entries[0].status='unavailable']){
    const f=seed();mutate(f);assert.throws(()=>validateFeed(f,now));
  }
});
test('immutable publication hashes payload and preserves source dates',()=>{
  const {bytes,manifest}=pricePublication(seed());assert.equal(bytes.length,manifest.byteCount);
  assert.ok(manifest.payloadURL.endsWith(manifest.sha256+'.json'));assert.equal(JSON.parse(bytes).entries[0].references[0].observedAt,stamp);
});

test('withdrawing a reviewed mapping publishes a tombstone instead of reviving bundled prices',async()=>{
  const previous=seed();previous.entries.push({...row(),identity:{...mapping.identity,cardID:'retired'}});
  const r=await refreshFeed({mappings:[mapping],previous,now:()=>now,markets:{lookup:async()=>row()}});
  assert.equal(r.feed.entries.find(e=>e.identity.cardID==='retired').status,'unsupported');
  assert.equal(r.feed.entries.find(e=>e.identity.cardID==='retired').references.length,0);
});
