#!/usr/bin/env node
// Public approved matches only. No credentials, collections or full provider archive is published.
import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {MarketReferences} from '../backend/marketplaces.mjs';
import {refreshFeed,pricePublication,validateFeed} from '../backend/market-feed.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((rows,arg,i,all)=>i%2?rows:[...rows,[arg,all[i+1]]],[]));
for(const key of ['--mappings','--cardmarket-index','--output'])if(!args[key])throw new Error('Provide --mappings, --cardmarket-index and --output.');
const output=resolve(args['--output']),manifestPath=join(output,'manifest.json');
let previous=null;
if(existsSync(manifestPath)){
  const manifest=JSON.parse(readFileSync(manifestPath));
  if(!/^[a-f0-9]{64}$/.test(manifest.sha256))throw new Error('Invalid previous manifest.');
  const bytes=readFileSync(join(output,'releases',basename(manifest.payloadURL)));
  previous=validateFeed(JSON.parse(bytes));
  const rebuilt=pricePublication(previous).manifest;
  if(rebuilt.sha256!==manifest.sha256||rebuilt.byteCount!==manifest.byteCount||rebuilt.payloadURL!==manifest.payloadURL||rebuilt.generatedAt!==manifest.generatedAt||manifest.schemaVersion!==1)throw new Error('Previous publication failed integrity check.');
}else if(args['--seed']){
  const seed=JSON.parse(readFileSync(args['--seed']));previous=validateFeed({...seed,schemaVersion:1});
}
const mappings=JSON.parse(readFileSync(args['--mappings'])),snapshot=JSON.parse(readFileSync(args['--cardmarket-index']));
if(mappings.length>500)throw new Error('Review the daily request budget before expanding beyond 500 mappings.');
const markets=new MarketReferences({mappings,snapshot,reserve:async()=>{}});
const {feed,report}=await refreshFeed({markets,mappings,previous});
const {bytes,manifest}=pricePublication(feed);
mkdirSync(join(output,'releases'),{recursive:true});
const path=join(output,'releases',manifest.sha256+'.json');
if(existsSync(path)&&!readFileSync(path).equals(bytes))throw new Error('Existing publication changed.');
writeFileSync(path,bytes);
writeFileSync(join(output,'report.json'),JSON.stringify({...report,checkedAt:feed.generatedAt},null,2)+'\n');
writeFileSync(manifestPath+'.tmp',JSON.stringify(manifest,null,2)+'\n');renameSync(manifestPath+'.tmp',manifestPath);
console.log(JSON.stringify(report));
