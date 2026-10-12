#!/usr/bin/env python3
"""Merge reviewed supplements, audit, and emit a digest-addressed data release.
No collection exports, ownership, prices or private photos are inputs.
"""
import argparse, collections, datetime, hashlib, json, re, subprocess, concurrent.futures
from pathlib import Path
from artwork_policy import allowed_artwork, apply_artwork
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'inputs' if (ROOT/'inputs').is_dir() else ROOT/'iOS/Folio/DemoCatalog'
CAT=ROOT/'catalog'
LANGS={'English','Japanese','Simplified Chinese'}
def read(path): return json.loads(path.read_text())
def encode(value): return (json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True)+'\n').encode()
def unique(items,key,label):
    ids=[key(i) for i in items]
    if len(set(ids)) != len(ids): raise ValueError('Duplicate '+label)
def mappingkey(m): return tuple(m[k].strip().lower() for k in ['sourceSet','sourceName','sourceNumber'])
def merge():
    sup=read(CAT/'reviewed-supplements.json')
    cards=read(DEST/'catalog.json')+read(DEST/'extended-catalog.json')
    sets=read(DEST/'sets.json')+read(DEST/'extended-sets.json')
    known={c['id'] for c in cards}
    # Supplements never silently override provider identities; corrections need explicit review.
    for c in sup['cards']:
        if c['id'] in known: raise ValueError('Supplement ID collides with base catalog: '+c['id'])
        cards.append(c);known.add(c['id'])
    sets+=sup['sets']
    if (CAT/'reviewed-artwork.json').exists(): apply_artwork(cards, read(CAT/'reviewed-artwork.json'))
    unique(cards,lambda c:c['id'],'card ID');unique(sets,lambda s:s['id'],'set ID')
    unique(sup['mappings'],mappingkey,'mapping');unique(sup['reviews'],lambda r:r['cardID'],'review')
    byset={s['id']:s for s in sets};byid={c['id']:c for c in cards}
    for c in cards:
        if c['language'] not in LANGS or c['id'].startswith('personal-') or c['setID'] not in byset or byset[c['setID']].get('language','English') != c['language']:raise ValueError('Invalid regional identity: '+c['id'])
        url=c.get('imageURL')
        if url and not allowed_artwork(url,c['language']):raise ValueError('Unapproved artwork URL: '+c['id'])
    for m in sup['mappings']:
        if m['cardID'] not in byid or byid[m['cardID']]['language']!=m['language'] or not m['evidence']:raise ValueError('Unverified mapping')
    for r in sup['reviews']:
        if r['cardID'] not in byid or not r['evidence']:raise ValueError('Invalid review')
    for e in sup['expectations']:
        if e['expectedDesigns'] is not None and e['expectedDesigns']<=0:raise ValueError('Invalid expected denominator')
    return dict(schemaVersion=1,revision='',publishedAt='',cards=cards,sets=sets,mappings=sup['mappings'],reviews=sup['reviews'],expectations=sup['expectations'])
def audit(release):
    groups=collections.defaultdict(list)
    for c in release['cards']:groups[c['setID']].append(c)
    bundled=set(read(DEST/'bundled-artwork.json')) if (DEST/'bundled-artwork.json').exists() else set()
    reviews={r['cardID'] for r in release['reviews']};variants={r['cardID'] for r in release['reviews'] if r['variantsVerified']}
    mappings=collections.Counter(m['cardID'] for m in release['mappings']);expected={e['set']['id']:e for e in release['expectations']}
    sets={s['id']:s for s in release['sets']}
    sets.update({k:e['set'] for k,e in expected.items() if k not in sets})
    rows=[]
    for s in sorted(sets.values(),key=lambda s:(s.get('language','English'),s['name'])):
        cs=groups[s['id']];numbers=[c['number'] for c in cs];counts=collections.Counter(numbers)
        numeric=bool(numbers) and all(re.fullmatch(r'\d+',n) for n in numbers)
        inferred=[]
        # A diagnostic against provider counts, not an independently certified checklist.
        if numeric and s['total']>0:inferred=[str(n) for n in range(1,s['total']+1) if n not in {int(v) for v in numbers}]
        e=expected.get(s['id'],{})
        rows.append(dict(setID=s['id'],name=s['name'],language=s.get('language','English'),providerExpectedDesigns=s['total'] or None,reviewedExpectedDesigns=e.get('expectedDesigns'),records=len(cs),reviewedIdentities=sum(c['id'] in reviews for c in cs),artworkAvailable=sum(bool(c.get('imageURL')) or (DEST/(c['imageName']+'.jpg')).exists() or c['imageName'] in bundled for c in cs),variantsVerified=sum(c['id'] in variants for c in cs),importMappings=sum(mappings[c['id']] for c in cs),missingReviewedNumbers=[n for n in e.get('expectedNumbers') or [] if n not in numbers],missingProviderNumericNumbers=inferred,duplicateNumbers=[n for n,count in counts.items() if count>1],note=e.get('note','Provider denominator only; independent checklist, identity and finish audit pending.')))
    totals={lang:dict(records=sum(r['records'] for r in rows if r['language']==lang),sets=sum(r['language']==lang for r in rows),artworkAvailable=sum(r['artworkAvailable'] for r in rows if r['language']==lang),reviewedIdentities=sum(r['reviewedIdentities'] for r in rows if r['language']==lang)) for lang in sorted(LANGS)}
    return dict(schemaVersion=1,revision=release['revision'],scope='Physical English, Japanese and Simplified Chinese. Records are catalog printings; some Chinese checklists include separately numbered finishes. Artwork, variants and worldwide checklist coverage remain incomplete.',totals=totals,sets=rows)
def imagecheck(release,limit):
    urls=sorted({c['imageURL'] for c in release['cards'] if c.get('imageURL')})
    # Scheduled checks rotate deterministically; explicit --image-limit 0 checks every URL.
    if limit and urls:
        offset=(datetime.date.today().toordinal()*limit)%len(urls);urls=(urls[offset:]+urls[:offset])[:limit]
    def check(u):
        p=subprocess.run(['curl','-s','-o','/dev/null','-w','%{http_code}','-I','--max-time','15',u],capture_output=True,text=True)
        return dict(url=u,status=p.stdout.strip(),available=p.returncode==0 and p.stdout.strip()=='200')
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(check,urls))
    return dict(checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),checked=len(results),failures=[r for r in results if not r['available']],note='HTTP availability check, not visual printing verification or artwork permission.')
def main():
    p=argparse.ArgumentParser();p.add_argument('--check-images',action='store_true');p.add_argument('--image-limit',type=int,default=128);p.add_argument('--validate-only',action='store_true');p.add_argument('--previous-release',type=Path);args=p.parse_args()
    release=merge()
    identity=hashlib.sha256(encode({k:v for k,v in release.items() if k not in ['revision','publishedAt']})).hexdigest()
    revision='v1-'+identity[:16]
    current=read(CAT/'manifest.json') if (CAT/'manifest.json').exists() else None
    if current and current['revision']==revision:
        stored=CAT/'releases'/Path(current['payloadURL']).name
        raw=stored.read_bytes()
        if len(raw)!=current['byteCount'] or hashlib.sha256(raw).hexdigest()!=current['sha256']:raise ValueError('Published payload integrity mismatch')
        saved=read(stored)
        if encode({k:v for k,v in saved.items() if k not in ['revision','publishedAt']}) != encode({k:v for k,v in release.items() if k not in ['revision','publishedAt']}):raise ValueError('Published payload disagrees with reviewed inputs')
        release=saved
    else:release.update(revision=revision,publishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    report=audit(release)
    previous=args.previous_release or (CAT/'releases'/Path(current['payloadURL']).name if current else None)
    if previous:
        old=read(previous)
        oldid={c['id']:c for c in old['cards']};newid={c['id']:c for c in release['cards']}
        for cid,c in oldid.items():
            if cid not in newid or any(c[k]!=newid[cid][k] for k in ['setID','number','language']):raise ValueError('Printing identity removed or changed: '+cid)
        if len(release['cards'])<len(old['cards']):raise ValueError('Coverage regression')
    data=encode(release);digest=hashlib.sha256(data).hexdigest()
    if len(data)>40_000_000:raise ValueError('Catalog payload too large')
    if args.validate_only:print(json.dumps({'revision':revision,'cards':len(release['cards']),'sets':len(release['sets']),'validated':True}));return
    (CAT/'releases').mkdir(exist_ok=True)
    payload=CAT/'releases'/(digest+'.json');payload.write_bytes(data)
    manifest=dict(schemaVersion=1,revision=revision,payloadURL='https://raw.githubusercontent.com/humblewalnut/folio-catalog/main/catalog/releases/'+payload.name,sha256=digest,byteCount=len(data))
    (CAT/'manifest.json').write_bytes(encode(manifest));(CAT/'coverage-audit.json').write_bytes(encode(report))
    # The app joins this small metadata envelope to existing bundled provider snapshots.
    supplement=read(CAT/'reviewed-supplements.json')
    patch_ids={p['cardID'] for p in read(CAT/'reviewed-artwork.json').get('records',[])} if (CAT/'reviewed-artwork.json').exists() else set()
    supplement_ids={c['id'] for c in supplement['cards']}
    bundled=dict(release,cards=[c for c in release['cards'] if c['id'] in supplement_ids or c['id'] in patch_ids],sets=supplement['sets']);(DEST/'catalog-release.json').write_bytes(encode(bundled))
    if args.check_images:(CAT/'artwork-health.json').write_bytes(encode(imagecheck(release,args.image_limit)))
    print(json.dumps({'revision':revision,'cards':len(release['cards']),'sets':len(release['sets']),'bytes':len(data),'coverage':report['totals']},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
