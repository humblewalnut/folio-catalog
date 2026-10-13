#!/usr/bin/env python3
"""Archive Cardmarket's published Pokémon downloads locally and build a singles-only index.

No scraping, credentials, currency conversion, fuzzy card matching, or artwork downloading.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone

BASE = 'https://downloads.s3.cardmarket.com/productCatalog/'
FILES = {'products_singles_6.json': BASE+'productList/products_singles_6.json',
         'price_guide_6.json': BASE+'priceGuide/price_guide_6.json'}

def build(products, prices, now=None):
    now = now or datetime.now(timezone.utc)
    for value, field in [(products, 'products'), (prices, 'priceGuides')]:
        try: stamp = datetime.fromisoformat(value['createdAt'])
        except ValueError: stamp = datetime.strptime(value['createdAt'], '%Y-%m-%dT%H:%M:%S%z')
        if stamp.tzinfo is None or stamp > now or not isinstance(value.get(field), list) or len(value[field]) > 200000:
            raise ValueError('Invalid source date or record count')
    singles = {}
    for row in products['products']:
        ident = row.get('idProduct')
        if not isinstance(ident, int) or isinstance(ident, bool) or ident <= 0 or ident in singles:
            raise ValueError('Invalid or duplicate product ID')
        singles[ident] = row
    rows = {}; seen = set()
    for row in prices['priceGuides']:
        ident = row.get('idProduct')
        if not isinstance(ident, int) or isinstance(ident, bool) or ident <= 0 or ident in seen:
            raise ValueError('Invalid or duplicate price ID')
        seen.add(ident)
        product = singles.get(ident)
        if row.get('idCategory') != 51 or not product or product.get('idCategory') != 51:
            continue
        for key in ['avg','low','trend','avg1','avg7','avg30','avg-holo','low-holo','trend-holo','avg1-holo','avg7-holo','avg30-holo']:
            value = row.get(key)
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 1e9):
                raise ValueError('Invalid price')
        rows[str(ident)] = row
    return {'version':1, 'currency':'EUR', 'productCreatedAt':products['createdAt'],
            'priceCreatedAt':prices['createdAt'], 'rows':rows,
            'stats':{'products':len(singles),'priceRows':len(prices['priceGuides']),'matchedSingles':len(rows)}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True, help='Private local archive directory')
    parser.add_argument('--source-dir', type=Path, help='Use already downloaded official files')
    args = parser.parse_args()
    args.archive.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.cardmarket-', dir=args.archive) as temp:
        staging = Path(temp); provenance = []
        for name, url in FILES.items():
            target = staging/name
            if args.source_dir:
                raw = (args.source_dir/name).read_bytes()
                if len(raw)>30000000: raise ValueError('Source file too large')
                target.write_bytes(raw)
            else:
                subprocess.run(['curl','--fail','--silent','--show-error','--proto','=https','--max-time','90',
                                '--max-filesize','30000000',url,'-o',str(target)], check=True)
                raw = target.read_bytes()
            provenance.append({'file':name,'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
        index = build(json.loads((staging/'products_singles_6.json').read_bytes()), json.loads((staging/'price_guide_6.json').read_bytes()))
        (staging/'index.json').write_text(json.dumps(index, separators=(',',':')))
        fingerprint = hashlib.sha256(json.dumps(provenance,sort_keys=True).encode()).hexdigest()
        manifest = {'fetchedAt':datetime.now(timezone.utc).isoformat(),'files':provenance,'stats':index['stats'],
                    'scope':'EUR reference; condition and language unspecified; excluded from USD portfolio totals'}
        (staging/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        destination = args.archive/fingerprint
        if destination.exists():
            for path in staging.iterdir():
                if path.name != 'manifest.json' and path.read_bytes() != (destination/path.name).read_bytes():
                    raise ValueError('Existing archive failed integrity check')
        else:
            os.rename(staging,destination)
        pointer = args.archive/'.latest.tmp'
        pointer.write_text(json.dumps({'directory':fingerprint,'index':str(destination/'index.json')})+'\n')
        os.replace(pointer,args.archive/'latest.json')
        print(json.dumps({'archive':str(destination), **index['stats']}))

if __name__ == '__main__': main()
