"""Strict public artwork references. Source permission and identity review are separate."""
import re
from urllib.parse import urlsplit

LANGS = {'English': 'en', 'Japanese': 'ja', 'Simplified Chinese': 'zh-cn'}

def allowed_artwork(value, language=None):
    try:
        u = urlsplit(value)
        if u.scheme != 'https' or u.port is not None or u.username or u.password or u.query or u.fragment or '%' in u.path:
            return False
        if u.hostname == 'assets.tcgdex.net':
            match = re.fullmatch(r'/(en|ja|zh-cn)/[A-Za-z0-9+_.-]+/[A-Za-z0-9+_.-]+/[A-Za-z0-9+_.-]+/high\.jpg', u.path)
            return bool(match) and (language is None or LANGS.get(language) == match[1])
        if u.hostname == 'images.pokemontcg.io':
            return language in (None, 'English') and bool(re.fullmatch(r'/[A-Za-z0-9-]+/[A-Za-z0-9]+_hires\.png', u.path))
        return False
    except (TypeError, ValueError):
        return False


def apply_artwork(cards, document):
    """Reviewed patches can fill artwork only; they cannot alter any catalog identity."""
    if document.get('schemaVersion') != 1:
        raise ValueError('Unsupported artwork review schema')
    byid = {c['id']: c for c in cards}
    seen = set()
    for patch in document.get('records', []):
        cid = patch['cardID']
        if cid in seen or cid not in byid:
            raise ValueError('Duplicate/missing artwork target: ' + cid)
        seen.add(cid)
        card = byid[cid]
        if any(card[k] != patch[k] for k in ('setID', 'name', 'number', 'language')) or card.get('imageURL') != patch.get('previousImageURL'):
            raise ValueError('Artwork patch no longer matches printing: ' + cid)
        if not allowed_artwork(patch['imageURL'], card['language']) or not patch.get('evidence') or patch.get('httpStatus') != 200 or patch.get('contentType') not in ('image/png','image/jpeg') or not patch.get('checkedAt'):
            raise ValueError('Artwork patch lacks source/availability review: ' + cid)
        card['imageURL'] = patch['imageURL']
    return cards
