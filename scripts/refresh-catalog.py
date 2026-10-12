#!/usr/bin/env python3
"""Build-time TCGdex metadata snapshot. Never imports prices or translates printings.
--snapshot-dir uses cached folio-tcgdex-{locale}.json files (English: catalog).
"""
import argparse, collections, datetime, hashlib, json, re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT/'inputs' if (ROOT/'inputs').is_dir() else ROOT / 'iOS/Folio/DemoCatalog'
LANGUAGES = {'en': 'English', 'ja': 'Japanese', 'zh-cn': 'Simplified Chinese'}
# Current zh-cn also contains Traditional Chinese SV records. Admit only the
# reviewed mainland release; adding sets requires checking regional identity.
CN_REVIEWED_SETS = {'CSMPiC'}
def query(lang):
    rarity = 'rarity' if lang == 'en' else ''  # Provider marks absent rarity non-null.
    return ('{cards @locale(lang: "LANG"){id name localId illustrator image RARITY dexId types category variants{normal holo reverse firstEdition} set{id name cardCount{total official}}} sets @locale(lang: "LANG"){id name releaseDate cardCount{total official} serie{id name}}}').replace('LANG', lang).replace('RARITY', rarity)
def normalized(value): return ''.join(c for c in value.lower() if c.isalnum())
def generation(ids):
    ids = [v for v in (ids or []) if isinstance(v, int)]
    if not ids: return 'Unknown'
    return 'Generation ' + ['I','II','III','IV','V','VI','VII','VIII','IX'][next((i for i,n in enumerate([151,251,386,493,649,721,809,905,1025]) if min(ids)<=n),8)]
def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--snapshot-dir', type=Path); args=parser.parse_args()
    base=json.loads((DEST/'catalog.json').read_text()); original_sets=json.loads((DEST/'sets.json').read_text())
    sets_by_name={normalized(s['name']):s for s in original_sets}
    existing={(normalized(c['setName']),normalized(c['number']),normalized(c['name'])):c for c in base}
    extended=[]; extra_sets=[]; seen=set(); reports={}
    for lang, language in LANGUAGES.items():
        file='folio-tcgdex-'+('catalog' if lang=='en' else lang)+'.json'
        raw = (args.snapshot_dir/file).read_bytes() if args.snapshot_dir else subprocess.check_output(['curl','-fsSL','--max-time','120','--max-filesize','30000000','https://api.tcgdex.net/v2/graphql','-H','Content-Type: application/json','--data',json.dumps({'query':query(lang)})])
        response=json.loads(raw)
        # Four Japanese entries have malformed optional dex IDs. Keep their
        # actual printings, but leave generation unknown. All other errors fail.
        errors=response.get('errors', [])
        if any(e.get('path', [None])[0]!='cards' or 'dexId' not in e.get('path', []) or not e.get('message','').startswith('Int cannot represent') for e in errors):
            raise ValueError('Provider GraphQL errors; existing snapshot preserved')
        data=response['data']; matched=set(); added=[]
        source_sets={s['id']:s for s in data['sets'] if s['serie']['id']!='tcgp' and (lang!='zh-cn' or s['id'] in CN_REVIEWED_SETS)}
        for s in source_sets.values():
            local=sets_by_name.get(normalized(s['name'])) if lang=='en' else None
            if not local: extra_sets.append({'id':'tcgdex-'+lang+'-'+s['id'],'name':s['name'],'series':s['serie']['name'],'total':s['cardCount']['total'],'releaseDate':s['releaseDate'] or '', 'language':language})
        for c in data['cards']:
            if not c or c['set']['id'] not in source_sets: continue
            s=source_sets[c['set']['id']]; key=(normalized(s['name']),normalized(c['localId']),normalized(c['name']))
            if lang=='en' and key in existing: matched.add(existing[key]['id']); continue
            cid='tcgdex-'+lang+'-'+c['id']
            if cid in seen: raise ValueError('Duplicate card identity')
            seen.add(cid); variants=c.get('variants') or {}; finishes=[v for k,v in [('normal','Normal'),('holo','Holo'),('reverse','Reverse holo')] if variants.get(k)]
            image=c.get('image'); url=(image+'/high.jpg') if image and image.startswith('https://assets.tcgdex.net/'+lang+'/') else None
            local_set=sets_by_name.get(normalized(s['name'])) if lang=='en' else None
            added.append({'id':cid,'name':c['name'],'setID':local_set['id'] if local_set else 'tcgdex-'+lang+'-'+s['id'],'setName':local_set['name'] if local_set else s['name'],'number':c['localId'],'artist':c.get('illustrator') or 'Unknown','year':int((s['releaseDate'] or '0000')[:4]),'type':(c.get('types') or [c.get('category') or 'Unknown'])[0],'generation':generation(c.get('dexId')),'color':'Unknown','rarity':c.get('rarity') or 'Unknown','language':language,'finish':finishes[0] if len(finishes)==1 else 'Unconfirmed','imageName':cid,'imageURL':url,'isEReader':(lang=='en' and s['id'] in ['ecard1','ecard2','ecard3']) or (lang=='ja' and s['serie']['id']=='e'),'availableFinishes':finishes,'catalogSource':'TCGdex'})
        if lang=='en':
            if len(added)<15000 or len(matched)<160: raise ValueError('English coverage regression')
            base_prints={(normalized(c['setName']),normalized(c['number'])) for c in base}
            if any((normalized(c['setName']),normalized(c['number'])) in base_prints for c in added): raise ValueError('Printing conflict needs review')
        if lang=='ja' and len(added)<12000: raise ValueError('Japanese coverage regression')
        if lang=='zh-cn' and len(added)!=48: raise ValueError('Chinese reviewed set changed; recheck coverage')
        extended.extend(added)
        reports[language]={'cards':len(added)+(len(base) if lang=='en' else 0),'sets':len(source_sets), 'cardsWithoutArtwork':sum(not c['imageURL'] for c in added),'sourceSHA256':hashlib.sha256(raw).hexdigest(),'optionalDexIDErrors':len(errors),'excludedUnreviewedCards':sum(bool(c and c['set']['id'] not in source_sets) for c in data['cards'])}
    manifest={'source':'TCGdex','endpoint':'https://api.tcgdex.net/v2/graphql','retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'languages':reports,'cards':len(base)+len(extended),'sets':len(original_sets)+len(extra_sets),'excluded':'Digital Pocket cards; Traditional Chinese; unreviewed Simplified Chinese records','notes':'Partial community catalog, not all cards. Simplified Chinese limited to CSMPiC; broader regional checklist and artwork coverage pending. No prices. Colors and missing rarity unknown; finish requires confirmation.'}
    for name,value in [('extended-catalog.json',extended),('extended-sets.json',extra_sets),('catalog-manifest.json',manifest)]:
        (DEST/name).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps(manifest,indent=2))
if __name__=='__main__': main()
