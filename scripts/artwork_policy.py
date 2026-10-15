"""Strict public artwork references. Source permission and identity review are separate."""
import json, re
from pathlib import Path
from urllib.parse import urlsplit

LANGS = {'English': 'en', 'Japanese': 'ja', 'Simplified Chinese': 'zh-cn'}
ORIGIN_FILE = Path(__file__).resolve().parent.parent / 'catalog' / 'artwork-origin.json'
FOLIO_PATH = re.compile(r'/cards/[a-f0-9]{64}/(high|thumb)\.(jpg|png|webp)')
# Card detail renders about 360pt wide (~1080px on 3x phones); every shipped provider image is
# 593-825px, so 560px native is the practical floor for the enlarged card. Below that, art is
# still useful in the mosaic and grids (~120pt tiles) down to 300px. Never upscale to promote a tier.
HIGH_MIN_WIDTH, THUMB_MIN_WIDTH = 560, 300
CARD_ASPECT = (0.69, 0.74)

def artwork_tier(width):
    if not width:
        return None
    return 'high' if width >= HIGH_MIN_WIDTH else 'thumb' if width >= THUMB_MIN_WIDTH else 'too-small'

def card_shaped(width, height):
    return bool(width and height) and CARD_ASPECT[0] <= width / height <= CARD_ASPECT[1]

def folio_artwork_origin(path=ORIGIN_FILE):
    """The single configured Folio artwork origin, or None before a bucket and domain exist."""
    try:
        origin = json.loads(Path(path).read_text()).get('origin')
    except (OSError, ValueError):
        return None
    if not origin:
        return None
    u = urlsplit(origin)
    if u.scheme != 'https' or not u.hostname or u.port is not None or u.username or u.password or u.path not in ('', '/') or u.query or u.fragment:
        raise ValueError('Invalid Folio artwork origin')
    return f'https://{u.hostname}'

def allowed_artwork(value, language=None, folio_origin=None):
    try:
        u = urlsplit(value)
        if u.scheme != 'https' or u.port is not None or u.username or u.password or u.query or u.fragment or '%' in u.path:
            return False
        origin = folio_artwork_origin() if folio_origin is None else folio_origin
        if origin and f'https://{u.hostname}' == origin:
            return bool(FOLIO_PATH.fullmatch(u.path))
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
        if not allowed_artwork(patch['imageURL'], card['language']) or not patch.get('evidence') or patch.get('httpStatus') != 200 or patch.get('contentType') not in ('image/png','image/jpeg','image/webp') or not patch.get('checkedAt'):
            raise ValueError('Artwork patch lacks source/availability review: ' + cid)
        path = urlsplit(patch['imageURL']).path
        if FOLIO_PATH.fullmatch(path) and path.split('/')[2] != patch.get('sha256'):
            raise ValueError('Folio-hosted artwork patch hash does not match its path: ' + cid)
        card['imageURL'] = patch['imageURL']
    return cards
