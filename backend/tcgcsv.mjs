// TCGCSV exposes daily product/printing aggregates, never graded or condition-specific prices.
export const tcgcsvSource='TCGplayer via TCGCSV';
export const tcgcsvKey=i=>JSON.stringify(['cardID','language','finish','edition','variant'].map(k=>i[k]??null));
const text=v=>typeof v==='string'&&v.length>0&&v.length<300;
// Automatic routes come from scripts/match-tcgcsv.mjs: TCGdex's product (or, for Japanese
// official-site printings, a set group proven by its Pokémon) and TCGplayer's own number,
// name or card kind, and printing had to agree. Hand-reviewed routes stay capped at 500.
export const automaticMethods=['tcgdex-crosswalk+number+name','tcgdex-crosswalk+number','set-crosswalk+number+name',
  'official-set+number+species','official-set+number+kind'];
const routeLanguages=['English','Japanese'],routeFinishes=['Normal','Holo','Reverse holo'];
/** Expand the tabular backend/tcgcsv-auto-mappings.json into mapping rows. */
export function automaticRoutes(document){
  if(document?.schemaVersion!==1||!Array.isArray(document.routes)||typeof document.groups!=='object'||!Array.isArray(document.methods))throw Error('Invalid automatic TCGCSV routes');
  return document.routes.map(([cardID,language,finish,edition,productID,groupID,productName,number,printing,method])=>({
    identity:{cardID,language:routeLanguages[language],finish:routeFinishes[finish],edition,variant:null},categoryID:language===1?85:3,groupID,
    groupName:document.groups[groupID],productID,productName,number,printing,reviewedAt:document.matchedAt,
    evidenceURL:`https://www.tcgplayer.com/product/${productID}/`,method:document.methods[method]}));
}
export function validateTCGCSVMaps(rows,now=Date.now(),{automatic=false}={}){
  if(!Array.isArray(rows)||rows.length>(automatic?100000:500)||new Set(rows.map(x=>tcgcsvKey(x.identity??{}))).size!==rows.length)throw Error('Invalid TCGCSV mappings');
  if(automatic&&rows.some(m=>!automaticMethods.includes(m.method)))throw Error('Automatic TCGCSV routes need a recorded match method');
  for(const m of rows){const i=m.identity;if(!i||Object.keys(i).some(k=>!['cardID','language','finish','edition','variant'].includes(k))||!text(i.cardID)||i.cardID.startsWith('personal-')||!['English','Japanese'].includes(i.language)||m.categoryID!==(i.language==='Japanese'?85:3)||!['Normal','Holo','Reverse holo'].includes(i.finish)||!Number.isSafeInteger(m.groupID)||m.groupID<=0||!Number.isSafeInteger(m.productID)||m.productID<=0||![m.groupName,m.productName,m.printing].every(text)||m.number!==null&&!text(m.number)||!Number.isFinite(Date.parse(m.reviewedAt))||Date.parse(m.reviewedAt)>now||!m.evidenceURL?.startsWith(`https://www.tcgplayer.com/product/${m.productID}/`))throw Error('Exact reviewed TCGCSV identity required');}
  for(const m of rows){const i=m.identity;const allowed={Normal:['Normal','1st Edition','Unlimited'],Holo:['Holofoil','1st Edition Holofoil','Unlimited Holofoil'],'Reverse holo':['Reverse Holofoil']};if(!allowed[i.finish].includes(m.printing)||(i.edition==='1st Edition')!==m.printing.startsWith('1st Edition')||(i.edition==='Unlimited')!==m.printing.startsWith('Unlimited')||i.variant!=null&&(i.variant!=='Cosmos Holo'||i.finish!=='Holo'||!m.productName.includes('(Cosmos Holo)')))throw Error('Printing qualifiers do not match');}
  return rows;
}
export function tcgcsvEntry(m,products,prices,stamp,now=Date.now()){
  const empty=status=>({identity:m.identity,status,references:[]});
  if(!products?.success||!prices?.success||!Array.isArray(products.results)||!Array.isArray(prices.results))throw Error('Invalid TCGCSV response');
  const at=Date.parse(stamp);if(!Number.isFinite(at)||at<=0||at>now||now-at>7*86400000)throw Error('Expired or invalid TCGCSV snapshot');
  const matches=products.results.filter(p=>p.productId===m.productID);
  if(matches.length!==1)return empty('ambiguous');const p=matches[0];
  const nums=(p.extendedData??[]).filter(x=>x.name==='Number');
  const linked=m.method?typeof p.url==='string'&&p.url.startsWith(m.evidenceURL):p.url===m.evidenceURL;
  if(p.categoryId!==m.categoryID||p.groupId!==m.groupID||p.name!==m.productName||!linked||p.presaleInfo?.isPresale||nums.length>1||(nums[0]?.value??null)!==m.number)return empty('ambiguous');
  const candidates=prices.results.filter(p=>p.productId===m.productID&&p.subTypeName===m.printing);
  if(candidates.length>1)return empty('ambiguous');const amount=candidates[0]?.marketPrice;
  if(amount===null||amount===undefined||amount===0)return empty('unavailable');
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>1e9)throw Error('Invalid TCGCSV price');
  return {identity:m.identity,status:'available',references:[{amount:String(amount),currency:'USD',source:tcgcsvSource,observedAt:new Date(at).toISOString(),meaning:'Raw market reference · condition not specified',status:now-at>86400000?'older':'current'}]};
}
