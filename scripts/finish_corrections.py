"""Reviewed finish corrections, applied on every publication so a provider refresh cannot drop them."""
FINISHES = ['Normal', 'Holo', 'Reverse holo']


def apply_finishes(cards, document):
    """Corrections change a printing's finishes only, never its identity, and fail once the provider disagrees."""
    if document.get('schemaVersion') != 1:
        raise ValueError('Unsupported finish correction schema')
    byid = {c['id']: c for c in cards}
    seen = set()

    def target(cid, language, number):
        if cid in seen or cid not in byid:
            raise ValueError('Duplicate/missing finish correction target: ' + cid)
        seen.add(cid)
        card = byid[cid]
        if card['language'] != language or str(card['number']) != str(number):
            raise ValueError('Finish correction identity mismatch: ' + cid)
        return card

    def current(card):
        return set(card.get('availableFinishes') or ([card['finish']] if card['finish'] in FINISHES else []))

    def store(card, finishes, keep_default=False):
        card['availableFinishes'] = [f for f in FINISHES if f in finishes]
        if not (keep_default and card['finish'] in finishes):
            card['finish'] = card['availableFinishes'][0] if len(card['availableFinishes']) == 1 else 'Unconfirmed'

    for record in document.get('records', []):
        card = target(record['cardID'], record['language'], record['number'])
        if record['addedFinish'] not in FINISHES:
            raise ValueError('Unknown finish: ' + record['cardID'])
        store(card, current(card) | {record['addedFinish']}, keep_default=True)
    table = document.get('replacements')
    if table:
        for row in table['rows']:
            r = dict(zip(table['columns'], row))
            card = target(r['cardID'], r['language'], r['number'])
            if r['from'] not in FINISHES or r['to'] not in FINISHES or r['from'] == r['to']:
                raise ValueError('Unknown finish: ' + r['cardID'])
            finishes = current(card)
            if r['from'] not in finishes:
                # The provider has since corrected the record itself.
                if r['to'] in finishes:
                    continue
                raise ValueError('Stale finish correction: ' + r['cardID'])
            store(card, (finishes - {r['from']}) | {r['to']})
    return len(seen)
