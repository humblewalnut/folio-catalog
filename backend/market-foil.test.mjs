import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketReferences,reviewedMappings} from './marketplaces.mjs';
const date='2026-10-13T00:00:00Z';
const v=(id,foil,type,product,printing,amount)=>({variantId:id,type,foil,size:'standard',thirdParty:{tcgplayer:product},pricing:{tcgplayer:{unit:'USD',updated:date,[printing]:{productId:product,marketPrice:amount}}}});
const source={id:'test-1',variants_detailed:[v('regular',null,'reverse',1,'reverse-holofoil',1),v('poke','pokeball','reverse',2,'holofoil',2),v('master','masterball','reverse',3,'holofoil',100)]};
const mapping={identity:{cardID:'tcgdex-en-test-1',language:'English',finish:'Reverse holo',variant:'Poke Ball Pattern'},reviewedAt:date,evidenceURL:'https://api.tcgdex.net/v2/en/cards/test-1',variantID:'poke',tcgplayerID:2,tcgPrinting:'holofoil',cardmarketID:null,cardmarketTrendField:null,expectedSubtype:null,expectedStamp:[],expectedFoil:'pokeball'};
const load=(data=source,m=mapping)=>new MarketReferences({mappings:[m],reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify(data))});
test('named foil selects its reviewed product and price field, never another pattern',async()=>{
 const result=await load().lookup(mapping.identity);assert.equal(result.references[0].amount,'2');
 for(const variant of [null,'Master Ball Pattern','Cosmos Holo'])assert.equal((await load().lookup({...mapping.identity,variant})).status,'unsupported');
 for(const mutate of [d=>d.variants_detailed[1].foil='masterball',d=>d.variants_detailed[1].thirdParty.tcgplayer=3,d=>d.variants_detailed.push({...d.variants_detailed[1],variantId:'duplicate'})]){const changed=structuredClone(source);mutate(changed);assert.equal((await load(changed).lookup(mapping.identity)).status,'ambiguous');}
});
test('explicit regular holo can coexist with cosmos; unreviewed foil identity is rejected',async()=>{
 const m={...mapping,identity:{...mapping.identity,finish:'Holo',variant:null},variantID:'regular',tcgplayerID:1,expectedFoil:null};
 const data={id:'test-1',variants_detailed:[v('regular',null,'holo',1,'holofoil',4),v('cosmos','cosmos','holo',2,'holofoil',40)]};
 assert.equal((await load(data,m).lookup(m.identity)).references[0].amount,'4');
 assert.throws(()=>reviewedMappings([{...m,expectedFoil:'cosmos'}]));
 assert.throws(()=>reviewedMappings([{...mapping,expectedFoil:'unknown'}]));
 const changed=structuredClone(data);changed.variants_detailed[0].foil='cosmos';assert.equal((await load(changed,m).lookup(m.identity)).status,'ambiguous');
});
