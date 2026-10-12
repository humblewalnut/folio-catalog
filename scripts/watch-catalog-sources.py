#!/usr/bin/env python3
"""Partial official release inbox; links are review leads, never automatic identities."""
import argparse, datetime, html, json, re, subprocess
from pathlib import Path
from urllib.parse import urljoin, urlparse
ROOT=Path(__file__).resolve().parents[1]
SOURCES=[('Japanese','https://www.pokemon-card.com/products/topList.php','https://www.pokemon-card.com'),('Simplified Chinese','https://www.pokemon.cn/category/tcg/product','https://www.pokemon.cn')]
def fetch(url):
    return subprocess.check_output(['curl','-fsSL','--retry','2','--retry-delay','2','--max-time','20','--max-filesize','10000000',url]).decode()
def references(language,url,origin,raw):
    links={}
    if language=='Japanese':
        for item in json.loads(raw).get('products',[]):
            href=urljoin(origin,item.get('link_detailPage') or item.get('link_cardList') or '')
            host=urlparse(href).hostname
            if not item.get('link_cardList') or host not in ['www.pokemon-card.com','www.30th.pokemon-card.com']:continue
            links[href]=dict(url=href,title=item.get('productTitle','Product reference')[:240],releaseDate=item.get('releaseDate',''))
    else:
        for href,body in re.findall(r'<a\b[^>]*href=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</a>',raw,re.S):
            href=urljoin(origin,href)
            if not re.match(r'https://www\.pokemon\.cn/(?:tcg/(?:product/)?\d+\.html|post_products/)',href):continue
            title=' '.join(html.unescape(re.sub('<[^>]+>',' ',body)).split())[:240]
            links[href]=dict(url=href,title=title or 'Product reference')
    if not links:raise ValueError('No product reference leads could be read')
    return sorted(links.values(),key=lambda v:v['url'])
def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT/'catalog/source-watch.json');args=p.parse_args()
    old=json.loads(args.output.read_text()) if args.output.exists() else dict(sources=[])
    prior={s['language']:s for s in old['sources']};results=[];failures=[]
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    for language,url,origin in SOURCES:
        try:
            leads=references(language,url,origin,fetch(url))
            results.append(dict(language=language,source=url,status='available',lastVerifiedAt=now,references=leads))
        except (subprocess.CalledProcessError,ValueError) as error:
            previous=prior.get(language,{})
            results.append(dict(language=language,source=url,status='unavailable',lastVerifiedAt=previous.get('lastVerifiedAt'),references=previous.get('references',[]),error='Source unavailable; retained previous unverified-age leads.'))
            failures.append(language);print('::warning::'+language+' official reference check unavailable; prior leads retained.')
    args.output.write_text(json.dumps(dict(schemaVersion=1,checkedAt=now,note='Partial official product-reference inbox. A lead does not certify identities, checklists, artwork rights or all regional releases. Review before admission.',sources=results),ensure_ascii=False,indent=2)+'\n')
    print('Product references:',sum(len(s['references']) for s in results),'unavailable sources:',failures)
    if len(failures)==len(SOURCES):raise SystemExit(1)
if __name__=='__main__':main()
