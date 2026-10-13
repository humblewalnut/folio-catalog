import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketReferences,reviewedMappings} from './marketplaces.mjs';
const stamp=new Date(Date.now()-1000).toISOString();
const proof=[{variantID:'normal',type:'normal',subtype:null,stamp:[],printing:'normal'},{variantID:'reverse',type:'reverse',subtype:null,stamp:[],printing:'reverse-holofoil'}];
const mapping={identity:{cardID:'test',language:'English',finish:'Normal'},variantID:'normal',tcgplayerID:1,cardmarketID:2,tcgPrinting:'normal',reviewedAt:stamp,evidenceURL:'https://api.tcgdex.net/v2/en/cards/test',expectedSubtype:null,expectedStamp:[],cardmarketTrendField:null,tcgVariants:proof,cardName:'Test',setName:'Test Set',number:'1'};
const variants=()=>proof.map(v=>({variantId:v.variantID,type:v.type,size:'standard',stamp:[],thirdParty:{tcgplayer:1,cardmarket:2},pricing:{tcgplayer:{unit:'USD',updated:stamp,normal:{productId:1,marketPrice:1},'reverse-holofoil':{productId:1,marketPrice:10}}}}));
const record=()=>({id:'test',name:'Test',localId:'1',set:{name:'Test Set'},variants_detailed:variants()});
const market=(card,mappings=[mapping])=>new MarketReferences({mappings,reserve:async()=>{},fetcher:async()=>new Response(JSON.stringify(card))});
test('a shared product prices finishes separately and excludes pooled Cardmarket',async()=>{
 const reverse={...mapping,identity:{...mapping.identity,finish:'Reverse holo'},variantID:'reverse',tcgPrinting:'reverse-holofoil'};
 assert.equal((await market(record()).lookup(mapping.identity)).references[0].amount,'1');
 const r=await market(record(),[reverse]).lookup(reverse.identity);
 assert.deepEqual(r.references.map(p=>[p.amount,p.currency]),[['10','USD']]);
});
test('changed name, number, unknown variants and missing proof fields withdraw a match',async()=>{
 for(const mutate of [r=>r.name='Wrong',r=>r.localId='2',r=>r.variants_detailed[1].stamp=['staff'],r=>r.variants_detailed.push({...r.variants_detailed[0],variantId:'unknown'}),r=>delete r.variants_detailed[1].pricing.tcgplayer['reverse-holofoil']]){
  const r=record();mutate(r);assert.equal((await market(r).lookup(mapping.identity)).status,'ambiguous');
 }
 const duplicate=structuredClone(mapping);duplicate.tcgVariants[1].printing='normal';assert.throws(()=>reviewedMappings([duplicate]));
});
