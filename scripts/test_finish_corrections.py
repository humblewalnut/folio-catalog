import unittest
from finish_corrections import apply_finishes


def card(cid, finishes, finish=None):
    return {'id': cid, 'language': 'English', 'number': '1', 'availableFinishes': finishes,
            'finish': finish or (finishes[0] if len(finishes) == 1 else 'Unconfirmed')}


def document(rows=(), records=()):
    return {'schemaVersion': 1, 'records': list(records),
            'replacements': {'columns': ['cardID', 'language', 'number', 'from', 'to', 'tcgplayerProductID', 'basis'], 'rows': list(rows)}}


class FinishCorrectionTests(unittest.TestCase):
    def test_replacement_keeps_other_finishes_and_confirms_a_single_finish(self):
        cards = [card('a', ['Normal']), card('b', ['Normal', 'Reverse holo'])]
        apply_finishes(cards, document([['a', 'English', '1', 'Normal', 'Holo', 1, 'promo'], ['b', 'English', '1', 'Normal', 'Holo', 2, 'promo']]))
        self.assertEqual((cards[0]['availableFinishes'], cards[0]['finish']), (['Holo'], 'Holo'))
        self.assertEqual((cards[1]['availableFinishes'], cards[1]['finish']), (['Holo', 'Reverse holo'], 'Unconfirmed'))

    def test_added_finish_and_reapplication_are_idempotent(self):
        cards = [card('a', ['Normal']), card('b', ['Holo'])]
        doc = document([['b', 'English', '1', 'Normal', 'Holo', 1, 'promo']],
                       [{'cardID': 'a', 'language': 'English', 'number': '1', 'addedFinish': 'Reverse holo'}])
        apply_finishes(cards, doc)
        apply_finishes(cards, doc)
        self.assertEqual(cards[0]['availableFinishes'], ['Normal', 'Reverse holo'])
        self.assertEqual(cards[0]['finish'], 'Normal')
        self.assertEqual(cards[1]['availableFinishes'], ['Holo'])

    def test_reviewed_crystal_kabutops_is_holo_without_changing_edition(self):
        import json
        from pathlib import Path
        doc = json.loads((Path(__file__).resolve().parents[1] / 'catalog/reviewed-finish-corrections.json').read_text())
        rows = [r for r in doc['replacements']['rows'] if r[0] == 'tcgdex-ja-E4-090']
        self.assertEqual(len(rows), 1)
        crystal = {'id': 'tcgdex-ja-E4-090', 'language': 'Japanese', 'number': '090',
                   'finish': 'Normal', 'availableFinishes': ['Normal'],
                   'availableEditions': ['1st Edition', 'Unlimited']}
        correction = document(rows)
        apply_finishes([crystal], correction)
        apply_finishes([crystal], correction)
        self.assertEqual(crystal['availableFinishes'], ['Holo'])
        self.assertEqual(crystal['finish'], 'Holo')
        self.assertEqual(crystal['availableEditions'], ['1st Edition', 'Unlimited'])

    def test_identity_mismatch_stale_and_duplicate_corrections_fail(self):
        with self.assertRaises(ValueError):
            apply_finishes([card('a', ['Normal'])], document([['a', 'Japanese', '1', 'Normal', 'Holo', 1, 'promo']]))
        with self.assertRaises(ValueError):
            apply_finishes([card('a', ['Reverse holo'])], document([['a', 'English', '1', 'Normal', 'Holo', 1, 'promo']]))
        with self.assertRaises(ValueError):
            apply_finishes([card('a', ['Normal'])], document([['a', 'English', '1', 'Normal', 'Holo', 1, 'promo']] * 2))
        with self.assertRaises(ValueError):
            apply_finishes([card('a', ['Normal'])], document([['missing', 'English', '1', 'Normal', 'Holo', 1, 'promo']]))


if __name__ == '__main__':
    unittest.main()
