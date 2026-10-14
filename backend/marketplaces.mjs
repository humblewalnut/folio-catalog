import {SafeError} from './contracts.mjs';

const finishes={Normal:'normal',Holo:'holo','Reverse holo':'reverse'};
const foilLabels={cosmos:'Cosmos Holo',pokeball:'Poke Ball Pattern',masterball:'Master Ball Pattern'};
const positiveID=x=>Number.isSafeInteger(x)&&x>0;
const metadata=(v,p)=>({variantID:v.variantId,type:v.type,subtype:v.subtype??null,stamp:v.stamp??[],printing:p});
export function verifiedTCGVariant(variants,m){
  if(!positiveID(m.tcgplayerID)||!m.tcgPrinting)return false;
  const siblings=variants.filter(v=>v.thirdParty?.tcgplayer===m.tcgplayerID);
  if(!m.tcgVariants)return siblings.length===1&&siblings[0].variantId===m.variantID;
  if(siblings.length!==m.tcgVariants.length)return false;
  return m.tcgVariants.every(expected=>{
    const found=siblings.filter(v=>v.variantId===expected.variantID&&v.size==='standard');
    return found.length===1&&(!Object.hasOwn(expected,'foil')||(found[0].foil??null)===expected.foil)&&Object.entries(metadata(found[0],expected.printing)).every(([key,value])=>JSON.stringify(value)===JSON.stringify(expected[key]))&&found[0].pricing?.tcgplayer?.[expected.printing]?.productId===m.tcgplayerID;
  });
}
export const marketIdentity=x=>JSON.stringify(['cardID','language','finish','edition','variant'].map(k=>x[k]??null));
export function reviewedMappings(mappings,now=Date.now()){
  if(!Array.isArray(mappings)||mappings.length>100000)throw new Error('Invalid marketplace mappings.');
  for(const m of mappings){
    const i=m.identity;
    if(!i||Object.keys(i).some(k=>!['cardID','language','finish','edition','variant'].includes(k))||!finishes[i.finish]||!['English','Japanese'].includes(i.language)||typeof i.cardID!=='string'||!i.cardID||!Number.isFinite(Date.parse(m.reviewedAt))||Date.parse(m.reviewedAt)>now||!/^https:\/\/api\.tcgdex\.net\/v2\/(en|ja)\/cards\/[a-zA-Z0-9.-]+$/.test(m.evidenceURL)||!m.evidenceURL.includes('/'+(i.language==='English'?'en':'ja')+'/')||typeof m.variantID!=='string'||!m.variantID||!(positiveID(m.tcgplayerID)||positiveID(m.cardmarketID))||(m.tcgplayerID!=null&&!positiveID(m.tcgplayerID))||(m.cardmarketID!=null&&!positiveID(m.cardmarketID))||!(m.tcgPrinting==null||typeof m.tcgPrinting==='string'&&m.tcgPrinting.length>0)||!(m.cardmarketTrendField==null||['trend','trend-holo'].includes(m.cardmarketTrendField))||(!m.tcgPrinting&&!m.cardmarketTrendField)||m.tcgPrinting&&!positiveID(m.tcgplayerID)||m.cardmarketTrendField&&!positiveID(m.cardmarketID)||!Array.isArray(m.expectedStamp)||m.expectedStamp.some(x=>typeof x!=='string')||!(m.expectedSubtype===null||typeof m.expectedSubtype==='string'))throw new Error('Exact reviewed printing identities and source evidence are required.');
    if(Object.hasOwn(m,'expectedFoil')&&(m.expectedFoil!==null&&!Object.hasOwn(foilLabels,m.expectedFoil)||(i.variant??null)!==(foilLabels[m.expectedFoil]??null)||m.expectedFoil==='cosmos'&&i.finish!=='Holo'||['pokeball','masterball'].includes(m.expectedFoil)&&i.finish!=='Reverse holo'))throw new Error('Foil pattern requires its exact collection identity.');
    if(m.tcgVariants!=null){
      if(!Array.isArray(m.tcgVariants)||!m.tcgVariants.length||m.tcgVariants.length>20||new Set(m.tcgVariants.map(v=>v.variantID)).size!==m.tcgVariants.length||new Set(m.tcgVariants.map(v=>v.printing)).size!==m.tcgVariants.length||!m.tcgVariants.some(v=>v.variantID===m.variantID&&v.printing===m.tcgPrinting)||m.tcgVariants.some(v=>!['printing,stamp,subtype,type,variantID','foil,printing,stamp,subtype,type,variantID'].includes(Object.keys(v).sort().join(','))||v.foil!=null&&!Object.hasOwn(foilLabels,v.foil)||typeof v.variantID!=='string'||!v.variantID||!['normal','holo','reverse'].includes(v.type)||!(v.subtype===null||typeof v.subtype==='string')||!Array.isArray(v.stamp)||v.stamp.some(s=>typeof s!=='string')||typeof v.printing!=='string'||!v.printing))throw new Error('Shared TCGplayer products require distinct reviewed printing fields.');
    }
  }
  return mappings;
}
export async function boundedJSON(response,limit=1000000){
  if(!response.ok)throw new SafeError(response.status===429?429:503,'market_provider_unavailable');
  const chunks=[];let bytes=0;
  try {for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)throw new Error();chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks));}
  catch {throw new SafeError(503,'invalid_market_response');}
}
export function reference(amount,currency,source,stamp,meaning,now){
  if(amount==null||amount===0)return null; // Zero is commonly a provider's missing-price sentinel.
  const at=Date.parse(stamp);
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>1e9||!Number.isFinite(at)||at>now||at<=0)throw new SafeError(503,'invalid_market_response');
  return {amount:String(amount),currency,source,observedAt:new Date(at).toISOString(),meaning,status:now-at<=86400000?'current':'older'};
}
export class MarketReferences {
  constructor({mappings=[],snapshot=null,fetcher=fetch,now=()=>Date.now(),reserve=async()=>{throw new SafeError(503,'market_budget_unconfigured');}}={}){
    Object.assign(this,{mappings:reviewedMappings(mappings,now()),snapshot,fetcher,now,reserve});this.cache=new Map();this.inflight=new Map();
  }
  async lookup(input,{force=false,signal}={}){
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['cardID','language','finish','edition','variant'].includes(k))||['cardID','language','finish'].some(k=>typeof input[k]!=='string'||!input[k]||input[k].length>300)||['edition','variant'].some(k=>input[k]!=null&&(typeof input[k]!=='string'||input[k].length>100)))throw new SafeError(422,'invalid_market_identity');
    const key=marketIdentity(input),maps=this.mappings.filter(m=>marketIdentity(m.identity)===key);
    if(maps.length!==1)return {identity:input,status:maps.length?'ambiguous':'unsupported',references:[]};
    if(!force&&this.cache.get(key)?.until>this.now())return this.cache.get(key).result;
    if(this.inflight.has(key))return this.inflight.get(key);
    const pending=this.load(input,maps[0],signal).then(result=>{if(this.cache.size>=5000)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{until:this.now()+3600000,result});return result;}).finally(()=>this.inflight.delete(key));
    this.inflight.set(key,pending);return pending;
  }
  async load(input,m,signal){
    await this.reserve();
    let response;try{response=await this.fetcher(m.evidenceURL,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{Accept:'application/json'}});}catch{throw new SafeError(503,'market_provider_unavailable');}
    const card=await boundedJSON(response),variants=card.variants_detailed;
    // A live provider change invalidates the reviewed mapping rather than silently changing printing.
    if(card.id!==new URL(m.evidenceURL).pathname.split('/').at(-1)||m.cardName!=null&&card.name!==m.cardName||m.number!=null&&card.localId!==m.number||m.setName!=null&&card.set?.name!==m.setName||m.sourceSetID!=null&&card.set?.id!==m.sourceSetID||!Array.isArray(variants)||variants.length>100)return {identity:input,status:'ambiguous',references:[]};
    const matches=variants.filter(v=>v.variantId===m.variantID&&v.type===finishes[input.finish]&&v.size==='standard'&&(m.tcgplayerID==null||v.thirdParty?.tcgplayer===m.tcgplayerID)&&(m.cardmarketID==null||v.thirdParty?.cardmarket===m.cardmarketID));
    if(matches.length!==1||Object.hasOwn(m,'expectedFoil')&&(matches[0].foil??null)!==m.expectedFoil||(matches[0].subtype??null)!==m.expectedSubtype||JSON.stringify(matches[0].stamp??[])!==JSON.stringify(m.expectedStamp)||m.tcgPrinting&&!verifiedTCGVariant(variants,m)||m.cardmarketTrendField&&variants.some(v=>v!==matches[0]&&v.thirdParty?.cardmarket===m.cardmarketID))return {identity:input,status:'ambiguous',references:[]};
    if(variants.some(v=>v!==matches[0]&&(!Object.hasOwn(m,'expectedFoil')||(v.foil??null)===m.expectedFoil)&&v.type===matches[0].type&&v.size==='standard'&&(v.subtype??null)===m.expectedSubtype&&JSON.stringify(v.stamp??[])===JSON.stringify(m.expectedStamp)))return {identity:input,status:'ambiguous',references:[]};
    const v=matches[0],p=v.pricing??{},references=[];
    const tcg=p.tcgplayer,printing=tcg?.[m.tcgPrinting];
    if(tcg?.unit==='USD'&&printing?.productId===m.tcgplayerID){const r=reference(printing.marketPrice,'USD','TCGplayer via TCGdex',tcg.updated,'Raw market reference · condition not specified',this.now());if(r)references.push(r);}
    const snapshotRow=this.snapshot?.rows?.[String(m.cardmarketID)],cm=snapshotRow??p.cardmarket;
    if(snapshotRow&&snapshotRow.idCategory!==51)throw new SafeError(503,'invalid_market_response');
    if(m.cardmarketTrendField&&cm&&cm.idProduct===m.cardmarketID&&(snapshotRow||cm.unit==='EUR')){
      const r=reference(cm[m.cardmarketTrendField],'EUR',snapshotRow?'Cardmarket':'Cardmarket via TCGdex',snapshotRow?this.snapshot.priceCreatedAt:cm.updated,'European market trend · pooled languages and conditions',this.now());if(r)references.push(r);
    }
    return {identity:input,status:references.length?'available':'unavailable',references};
  }
}
export async function marketRoute(req,res,markets,userFor){
  if(req.url!=='/v1/market-prices')return false;
  if(req.method!=='POST')throw new SafeError(405,'method_not_allowed');
  await userFor(req.headers.authorization);
  if(!markets)throw new SafeError(503,'market_references_not_enabled');
  if(!req.headers['content-type']?.startsWith('application/json'))throw new SafeError(415,'json_required');
  let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2000)throw new SafeError(413,'request_too_large');chunks.push(chunk);}
  let input;try{input=JSON.parse(Buffer.concat(chunks));}catch{throw new SafeError(400,'invalid_json');}
  res.end(JSON.stringify(await markets.lookup(input)));return true;
}
