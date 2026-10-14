import test from 'node:test';
import assert from 'node:assert/strict';
import {compactFeed,expandCompactFeed,compactPublication} from './compact-feed.mjs';
import {automaticRoutes,validateTCGCSVMaps,tcgcsvEntry} from './tcgcsv.mjs';

const at='2026-10-14T10:00:00.000Z',older='2026-10-12T10:00:00.000Z';
const usd=(amount,observedAt=at)=>({amount,currency:'USD',source:'TCGplayer via TCGCSV',observedAt,meaning:'Raw market reference · condition not specified',status:observedAt===at?'current':'older'});
const feed={schemaVersion:1,generatedAt:at,entries:[
  {identity:{cardID:'a',language:'English',finish:'Normal'},status:'available',references:[usd('1.5')]},
  {identity:{cardID:'b',language:'Japanese',finish:'Holo',edition:'1st Edition'},status:'available',references:[usd('20',older),{amount:'18',currency:'EUR',source:'Cardmarket',observedAt:older,meaning:'European market trend · pooled languages and conditions',status:'older'}]},
  {identity:{cardID:'c',language:'English',finish:'Reverse holo',variant:'Poke Ball Pattern'},status:'unsupported',references:[]},
]};

test('compact feed round-trips to the schema-1 feed with shared source and date tables',()=>{
  const compact=compactFeed(feed);
  assert.equal(compact.sources.length,2);assert.equal(compact.dates.length,2);
  assert.deepEqual(expandCompactFeed(compact,Date.parse(at)),feed);
});

test('compact feed rejects unknown codes, dangling references and invalid prices',()=>{
  const compact=compactFeed(feed);
  for(const broken of [
    {...compact,schemaVersion:1},
    {...compact,entries:[['a',2,0,null,null,'a',[[0,'1',0]]]]},
    {...compact,entries:[['a',0,0,null,null,'x',[]]]},
    {...compact,entries:[['a',0,0,null,null,'a',[[9,'1',0]]]]},
    {...compact,entries:[['a',0,0,null,null,'a',[[0,'-1',0]]]]},
    {...compact,entries:[['a',0,0,null,null,'a',[]]]},
  ])assert.throws(()=>expandCompactFeed(broken,Date.parse(at)));
});

test('compact publication points at the pricing-v3 channel',()=>{
  const {bytes,manifest}=compactPublication(feed);
  assert.equal(manifest.schemaVersion,2);assert.equal(manifest.byteCount,bytes.length);
  assert.equal(manifest.payloadURL,`https://raw.githubusercontent.com/humblewalnut/folio-catalog/main/pricing-v3/releases/${manifest.sha256}.json`);
});

test('automatic routes expand to exact mappings and verify the product link by ID',()=>{
  const document={schemaVersion:1,matchedAt:'2026-10-13T20:00:00.000Z',methods:['tcgdex-crosswalk+number+name'],groups:{7:'Set'},
    routes:[['tcgdex-en-x-1',0,2,null,55,7,'Card','001/100','Reverse Holofoil',0],['tcgdex-ja-y-2',1,1,null,56,7,'Pikachu','002/060','Holofoil',0]]};
  const [english,japanese]=validateTCGCSVMaps(automaticRoutes(document),Date.parse(at),{automatic:true});
  assert.deepEqual(english.identity,{cardID:'tcgdex-en-x-1',language:'English',finish:'Reverse holo',edition:null,variant:null});
  assert.equal(japanese.categoryID,85);
  assert.throws(()=>validateTCGCSVMaps(automaticRoutes({...document,methods:['guess']}),Date.parse(at),{automatic:true}));
  const product=url=>({success:true,results:[{productId:55,categoryId:3,groupId:7,name:'Card',url,extendedData:[{name:'Number',value:'001/100'}]}]});
  const prices={success:true,results:[{productId:55,subTypeName:'Reverse Holofoil',marketPrice:2}]};
  assert.equal(tcgcsvEntry(english,product('https://www.tcgplayer.com/product/55/pokemon-set-card'),prices,'2026-10-13T20:00:00Z',Date.parse(at)).status,'available');
  assert.equal(tcgcsvEntry(english,product('https://www.tcgplayer.com/product/555/pokemon-set-card'),prices,'2026-10-13T20:00:00Z',Date.parse(at)).status,'ambiguous');
});
