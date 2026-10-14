import {createHash} from 'node:crypto';
import {marketIdentity,reviewedMappings} from './marketplaces.mjs';

export function validateFeed(feed,now=Date.now()){
  if(feed?.schemaVersion!==1||!Array.isArray(feed.entries)||feed.entries.length>10000||!Number.isFinite(Date.parse(feed.generatedAt))||Date.parse(feed.generatedAt)>now)throw new Error('Invalid price feed.');
  const seen=new Set();
  for(const entry of feed.entries){
    const i=entry.identity,key=marketIdentity(i??{});
    if(!i||Object.keys(i).some(k=>!['cardID','language','finish','edition','variant'].includes(k))||typeof i.cardID!=='string'||!i.cardID||i.cardID.length>300||!['English','Japanese'].includes(i.language)||!['Normal','Holo','Reverse holo'].includes(i.finish)||['edition','variant'].some(k=>i[k]!=null&&(typeof i[k]!=='string'||i[k].length>100))||seen.has(key)||!['available','unavailable','ambiguous','unsupported'].includes(entry.status)||!Array.isArray(entry.references)||entry.references.length>2)throw new Error('Invalid price identity.');
    seen.add(key);const currencies=new Set();
    if((entry.status==='available')!==Boolean(entry.references.length))throw new Error('Invalid price availability.');
    for(const r of entry.references){
      const stamp=Date.parse(r.observedAt),amount=Number(r.amount);
      if(typeof r.amount!=='string'||!/^\d{1,10}(?:\.\d{1,8})?$/.test(r.amount)||!Number.isFinite(amount)||amount<=0||amount>1e9||!Number.isFinite(stamp)||stamp<=0||stamp>Date.parse(feed.generatedAt)||!['USD','EUR'].includes(r.currency)||currencies.has(r.currency)||!['current','older'].includes(r.status)||typeof r.meaning!=='string'||!r.meaning||r.meaning.length>300||!(r.currency==='USD'?['TCGplayer via TCGdex','TCGplayer via TCGCSV'].includes(r.source):['Cardmarket','Cardmarket via TCGdex'].includes(r.source)))throw new Error('Invalid dated price.');
      currencies.add(r.currency);
    }
  }
  return feed;
}
// Group transport variants of a market together: changing the Cardmarket delivery
// path must not appear to withdraw its EUR prices or create independent evidence.
const sourceFor=currency=>currency==='USD'?'TCGplayer':'Cardmarket';
const expectedCurrencies=m=>[...(m.tcgPrinting?['USD']:[]),...(m.cardmarketTrendField?['EUR']:[])];
const aged=(entry,at)=>({...entry,references:entry.references.map(r=>({...r,status:at-Date.parse(r.observedAt)<=86400000?'current':'older'}))});
function hold(report,reasons){
  const error=new Error(`Price refresh held: ${reasons.map(r=>r.code+(r.source?` (${r.source}/${r.currency}/${r.language})`:'')).join(', ')}; previous publication retained.`);
  error.code='price_refresh_held';error.report={...report,publication:'held',holds:reasons};throw error;
}
// A completed request is not proof that pricing is healthy. Validate exact
// identities first, then compare real reference coverage with the last good feed.
// Isolated verified ambiguity/unavailability removes obsolete prices; a broad
// loss holds the atomic publication. Withdrawn mappings are outside the baseline.
export async function refreshFeed({markets,mappings,previous=null,now=()=>Date.now()}){
  const startedAt=now();
  reviewedMappings(mappings,startedAt);if(previous)validateFeed(previous,startedAt);
  if(new Set(mappings.map(m=>marketIdentity(m.identity))).size!==mappings.length)throw new Error('Duplicate approved mappings.');
  const old=new Map((previous?.entries??[]).map(e=>[marketIdentity(e.identity),e])),entries=[],cohorts=new Map();
  const report={reviewed:mappings.length,refreshed:0,failed:0,ambiguous:0,invalidResponses:0,identityMismatches:0,sourceDateRegressions:0,withdrawn:0,availableEntries:0,availableReferences:0,cohorts:[]};
  for(const m of mappings){
    const before=old.get(marketIdentity(m.identity));
    let result=null,received=null,regressed=new Set();
    try{
      const loaded=await markets.lookup(m.identity);
      // Validate individually so a malformed row cannot poison the whole feed or
      // masquerade as a successful request in the outage denominator.
      if(marketIdentity(loaded?.identity??{})!==marketIdentity(m.identity)){
        report.identityMismatches++;throw new Error('Mismatched response identity.');
      }
      try{
        const receivedAt=now();
        validateFeed({schemaVersion:1,generatedAt:new Date(receivedAt).toISOString(),entries:[loaded]},receivedAt);
        if(loaded.references.some(r=>!expectedCurrencies(m).includes(r.currency)))throw new Error('Unreviewed price source.');
      }catch(error){report.invalidResponses++;throw error;}
      received=loaded;
      result={...loaded,references:loaded.references.map(r=>{
        const earlier=before?.references.find(x=>x.currency===r.currency);
        if(earlier&&Date.parse(earlier.observedAt)>Date.parse(r.observedAt)){
          regressed.add(r.currency);report.sourceDateRegressions++;return earlier;
        }
        return r;
      })};
      report.refreshed++;
      if(result.status==='ambiguous')report.ambiguous++;
    }catch{
      report.failed++;result=before??null;
    }
    if(result)entries.push(result);
    for(const currency of expectedCurrencies(m)){
      // Monitor each language separately as well as the shared provider: a healthy
      // English response must not mask a Japanese or EUR-only outage.
      for(const language of [m.identity.language,'all']){
        const source=sourceFor(currency),key=JSON.stringify([source,currency,language]);
        if(!cohorts.has(key))cohorts.set(key,{source,currency,language,reviewed:0,previousAvailable:0,receivedAvailable:0,publishedAvailable:0,lost:0,failed:0,sourceDateRegressions:0,comparablePrices:0,unitScaleUp:0,unitScaleDown:0});
        const c=cohorts.get(key),prior=Boolean(before?.references.some(r=>r.currency===currency)),available=Boolean(result?.references.some(r=>r.currency===currency));
        c.reviewed++;c.previousAvailable+=Number(prior);c.receivedAvailable+=Number(Boolean(received?.references.some(r=>r.currency===currency)));c.publishedAvailable+=Number(available);
        c.lost+=Number(prior&&!available);c.failed+=Number(!received);c.sourceDateRegressions+=Number(regressed.has(currency));
        const priorPrice=before?.references.find(r=>r.currency===currency),newPrice=received?.references.find(r=>r.currency===currency);
        // Compare actual non-regressing observations, not carried-forward values.
        // Ratios diagnose a likely unit conversion; they never rewrite an amount.
        if(priorPrice&&newPrice&&!regressed.has(currency)){
          const ratio=Number(newPrice.amount)/Number(priorPrice.amount);c.comparablePrices++;
          c.unitScaleUp+=Number(ratio>=90&&ratio<=110);c.unitScaleDown+=Number(ratio>=0.009&&ratio<=0.011);
        }
      }
    }
  }
  const approved=new Set(mappings.map(m=>marketIdentity(m.identity)));
  for(const entry of old.values())if(!approved.has(marketIdentity(entry.identity))){
    entries.push({identity:entry.identity,status:'unsupported',references:[]});
    if(entry.status!=='unsupported')report.withdrawn++;
  }
  report.availableEntries=entries.filter(e=>e.references.length).length;
  report.availableReferences=entries.reduce((sum,e)=>sum+e.references.length,0);
  report.cohorts=[...cohorts.values()].map(c=>({...c,previousCoverage:c.previousAvailable/c.reviewed,receivedCoverage:c.receivedAvailable/c.reviewed,publishedCoverage:c.publishedAvailable/c.reviewed,previousNullRate:1-c.previousAvailable/c.reviewed,nullRate:1-c.publishedAvailable/c.reviewed,requestSuccessRate:1-c.failed/c.reviewed,coverageDrop:c.lost/c.reviewed}));
  const holds=[];
  if(mappings.length&&report.refreshed/mappings.length<0.8)holds.push({code:'request_failure',refreshed:report.refreshed,reviewed:mappings.length});
  if(mappings.length&&report.identityMismatches/mappings.length>0.01)holds.push({code:'identity_drift',affected:report.identityMismatches,reviewed:mappings.length});
  // A small, intentional correction remains publishable. Three losses in a
  // small cohort, or more than ten percentage points in a >=20-key cohort,
  // require investigation. Use gross losses so new matches cannot hide drops.
  for(const c of report.cohorts){
    const segment={source:c.source,currency:c.currency,language:c.language,reviewed:c.reviewed};
    if((c.reviewed<20?c.lost>=3:c.coverageDrop>0.1)||(c.previousAvailable>=3&&!c.publishedAvailable))holds.push({code:'reference_coverage_loss',...segment,affected:c.lost});
    if(c.failed>=3&&c.requestSuccessRate<0.8)holds.push({code:'segment_request_failure',...segment,affected:c.failed});
    // Three or more changes near the same 100x conversion, covering at least 80%
    // of comparable keys, are an adapter incident candidate, not price movement
    // confidence. One unusual card is never clamped or withheld by this check.
    for(const [scale,affected] of [['100x',c.unitScaleUp],['0.01x',c.unitScaleDown]])if(affected>=3&&affected*5>=c.comparablePrices*4)holds.push({code:'suspected_unit_scale_change',...segment,scale,affected,compared:c.comparablePrices});
  }
  if(!previous&&!report.availableReferences)holds.push({code:'no_initial_prices'});
  if(!mappings.length&&!old.size)holds.push({code:'no_reviewed_mappings'});
  if(holds.length)hold(report,holds);
  // A long refresh may cross a provider update or the stale-label boundary.
  // Publication time is the end of the run; evidence timestamps stay untouched.
  const publishedAt=now();
  const feed={schemaVersion:1,generatedAt:new Date(publishedAt).toISOString(),entries:entries.map(entry=>aged(entry,publishedAt))};
  validateFeed(feed,publishedAt);return {feed,report:{...report,publication:'ready',holds:[]}};
}
export function pricePublication(feed){
  validateFeed(feed);const bytes=Buffer.from(JSON.stringify(feed)+'\n'),sha256=createHash('sha256').update(bytes).digest('hex');
  return {bytes,manifest:{schemaVersion:1,generatedAt:feed.generatedAt,sha256,byteCount:bytes.length,
    payloadURL:`https://raw.githubusercontent.com/humblewalnut/folio-catalog/main/pricing/releases/${sha256}.json`}};
}
