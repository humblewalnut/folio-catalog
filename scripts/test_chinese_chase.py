import importlib.util,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('chase_publisher',ROOT/'scripts/publish-catalog.py')
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
class ChineseChasePublicationTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.release=publisher.merge();cls.cards={x['id']:x for x in cls.release['cards']};cls.sets={x['id']:x for x in cls.release['sets']};cls.records=json.loads((ROOT/'catalog/chinese-chase-review-2026-10-16.json').read_text())['records']
 def test_all_seven_exact_printings_retain_the_reviewed_finish(self):
  self.assertEqual(len(self.records),7)
  for r in self.records:
   c=self.cards[r['cardID']];self.assertEqual(c['number'],r['number']);self.assertEqual(c['language'],'Simplified Chinese');self.assertEqual(c['availableFinishes'],['Holo']);self.assertEqual(c['finish'],'Holo');self.assertEqual(c['confirmedFinish'],'Holo');self.assertFalse(c.get('imageURL'))
 def test_four_partial_sets_and_exact_artist_type_metadata(self):
  for code in ['CS4aC','CSV9.5C','CSV8C','CSV5C']:self.assertEqual(self.sets['folio-zh-cn-'+code]['total'],0)
  self.assertEqual(self.cards['folio-zh-cn-CS4aC-085']['number'],'085');self.assertEqual(self.cards['folio-zh-cn-CS4aC-085']['rarity'],'RRR')
  self.assertEqual(self.cards['folio-zh-cn-CSV8C-255']['artist'],'OKACHEKE');self.assertEqual(self.cards['folio-zh-cn-CSV8C-255']['year'],2026)
  self.assertEqual(self.cards['folio-zh-cn-CSV5C-155']['type'],'Darkness');self.assertEqual(self.cards['folio-zh-cn-CSV5C-155']['year'],2025)
  self.assertEqual(self.cards['folio-zh-cn-CSV9.5C-234']['artist'],'rika')
 def test_captain_pikachu_has_target_specific_evidence_not_the_wrong_number(self):
  r=next(r for r in self.release['reviews'] if r['cardID']=='folio-zh-cn-CBB1C-0709')
  self.assertFalse(any('71db1208' in u for u in r['evidence']));self.assertTrue(any('captain-pikachu-709' in u for u in r['evidence']))

 def test_publisher_rejects_duplicate_set_expectations(self):
  expectation={'set':{'id':'same-set'}}
  with self.assertRaises(ValueError):publisher.unique([expectation,expectation],lambda e:e['set']['id'],'set expectation')
