import {SafeError} from './contracts.mjs';

const finishes={Normal:'normal',Holo:'holo','Reverse holo':'reverse'};
export const marketIdentity=x=>JSON.stringify(['cardID','language','finish','edition','variant'].map(k=>x[k]??null));
export function reviewedMappings(mappings,now=Date.now()){
  if(!Array.isArray(mappings)||mappings.length>100000)throw new Error('Invalid marketplace mappings.');
  for(const m of mappings){
    const i=m.identity;
    if(!i||Object.keys(i).some(k=>!['cardID','language','finish','edition','variant'].includes(k))||!finishes[i.finish]||!['English','Japanese'].includes(i.language)||typeof i.cardID!=='string'||!i.cardID||!Number.isFinite(Date.parse(m.reviewedAt))||Date.parse(m.reviewedAt)>now||!/^https:\/\/api\.tcgdex\.net\/v2\/(en|ja)\/cards\/[a-zA-Z0-9.-]+$/.test(m.evidenceURL)||!m.evidenceURL.includes('/'+(i.language==='English'?'en':'ja')+'/')||typeof m.variantID!=='string'||!m.variantID||!Number.isSafeInteger(m.tcgplayerID)||m.tcgplayerID<=0||!Number.isSafeInteger(m.cardmarketID)||m.cardmarketID<=0||typeof m.tcgPrinting!=='string'||!m.tcgPrinting||!['trend','trend-holo'].includes(m.cardmarketTrendField)||!Array.isArray(m.expectedStamp)||m.expectedStamp.some(x=>typeof x!=='string')||!(m.expectedSubtype===null||typeof m.expectedSubtype==='string'))throw new Error('Exact reviewed printing identities and source evidence are required.');
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
  async lookup(input){
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['cardID','language','finish','edition','variant'].includes(k))||['cardID','language','finish'].some(k=>typeof input[k]!=='string'||!input[k]||input[k].length>300)||['edition','variant'].some(k=>input[k]!=null&&(typeof input[k]!=='string'||input[k].length>100)))throw new SafeError(422,'invalid_market_identity');
    const key=marketIdentity(input),maps=this.mappings.filter(m=>marketIdentity(m.identity)===key);
    if(maps.length!==1)return {identity:input,status:maps.length?'ambiguous':'unsupported',references:[]};
    if(this.cache.get(key)?.until>this.now())return this.cache.get(key).result;
    if(this.inflight.has(key))return this.inflight.get(key);
    const pending=this.load(input,maps[0]).then(result=>{if(this.cache.size>=5000)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{until:this.now()+3600000,result});return result;}).finally(()=>this.inflight.delete(key));
    this.inflight.set(key,pending);return pending;
  }
  async load(input,m){
    await this.reserve();
    let response;try{response=await this.fetcher(m.evidenceURL,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});}catch{throw new SafeError(503,'market_provider_unavailable');}
    const card=await boundedJSON(response),variants=card.variants_detailed;
    // A live provider change invalidates the reviewed mapping rather than silently changing printing.
    if(card.id!==new URL(m.evidenceURL).pathname.split('/').at(-1)||!Array.isArray(variants)||variants.length>100)return {identity:input,status:'ambiguous',references:[]};
    const matches=variants.filter(v=>v.variantId===m.variantID&&v.type===finishes[input.finish]&&v.size==='standard'&&v.thirdParty?.tcgplayer===m.tcgplayerID&&v.thirdParty?.cardmarket===m.cardmarketID);
    if(matches.length!==1||(matches[0].subtype??null)!==m.expectedSubtype||JSON.stringify(matches[0].stamp??[])!==JSON.stringify(m.expectedStamp)||variants.some(v=>v!==matches[0]&&(v.thirdParty?.tcgplayer===m.tcgplayerID||v.thirdParty?.cardmarket===m.cardmarketID)))return {identity:input,status:'ambiguous',references:[]};
    const v=matches[0],p=v.pricing??{},references=[];
    const tcg=p.tcgplayer,printing=tcg?.[m.tcgPrinting];
    if(tcg?.unit==='USD'&&printing?.productId===m.tcgplayerID){const r=reference(printing.marketPrice,'USD','TCGplayer via TCGdex',tcg.updated,'Raw market reference · condition not specified',this.now());if(r)references.push(r);}
    const snapshotRow=this.snapshot?.rows?.[String(m.cardmarketID)],cm=snapshotRow??p.cardmarket;
    if(snapshotRow&&snapshotRow.idCategory!==51)throw new SafeError(503,'invalid_market_response');
    if(cm&&cm.idProduct===m.cardmarketID&&(snapshotRow||cm.unit==='EUR')){
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
