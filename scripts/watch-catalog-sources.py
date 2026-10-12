#!/usr/bin/env python3
"""Public release-reference inbox. Product links are review leads, never automatic card identities."""
import argparse, html, json, re, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCES=[('Japanese','https://www.pokemon-card.com/products/','https://www.pokemon-card.com'),('Simplified Chinese','https://www.pokemon.cn/category/tcg/product','https://www.pokemon.cn')]
def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT/'catalog/source-watch.json');args=p.parse_args()
    results=[]
    for language,url,origin in SOURCES:
        raw=subprocess.check_output(['curl','-fsSL','--max-time','40','--max-filesize','10000000',url]).decode()
        if len(raw)<1000:raise ValueError('Source response unexpectedly short: '+url)
        links={}
        for href,body in re.findall(r'<a\b[^>]*href=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</a>',raw,re.S):
            if href.startswith('/'):href=origin+href
            if language=='Japanese':allowed=href.startswith(origin+'/products/') and href != url
            else:allowed=bool(re.match(r'https://www\.pokemon\.cn/(?:tcg/(?:product/)?\d+\.html|post_products/)',href))
            if not allowed:continue
            title=html.unescape(re.sub('<[^>]+>',' ',body));title=' '.join(title.split())[:240]
            if not title:
                alt=re.search(r'alt=[\"\']([^\"\']+)',body);title=html.unescape(alt.group(1)) if alt else 'Product reference'
            links[href]={'url':href,'title':title}
        if not links:raise ValueError('Product references could not be read: '+url)
        results.append(dict(language=language,source=url,references=sorted(links.values(),key=lambda v:v['url'])))
    value=dict(schemaVersion=1,note='Partial official product-reference inbox. A lead does not certify card identities, checklist totals, artwork rights or all regional releases. Review before admitting new records.',sources=results)
    args.output.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    print('Public product references:',sum(len(s['references']) for s in results))
if __name__=='__main__':main()
