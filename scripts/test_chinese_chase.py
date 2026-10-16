import importlib.util,json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('chase_publisher',ROOT/'scripts/publish-catalog.py')
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
class ChineseChasePublicationTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.release=publisher.merge();cls.cards={x['id']:x for x in cls.release['cards']};cls.sets={x['id']:x for x in cls.release['sets']};cls.artwork={r['cardID']:r for r in json.loads((ROOT/'catalog/reviewed-artwork.json').read_text())['records']};cls.records=json.loads((ROOT/'catalog/chinese-chase-review-2026-10-16.json').read_text())['records']
 def test_all_seven_exact_printings_retain_the_reviewed_finish(self):
  self.assertEqual(len(self.records),7)
  for r in self.records:
   c=self.cards[r['cardID']];self.assertEqual(c['number'],r['number']);self.assertEqual(c['language'],'Simplified Chinese');self.assertEqual(c['availableFinishes'],['Holo']);self.assertEqual(c['finish'],'Holo');self.assertEqual(c['confirmedFinish'],'Holo');self.assertTrue(c['imageURL'].startswith('https://art.foliocollect.com/cards/'));self.assertEqual(c['imageURL'].split('/')[-2],self.artwork[c['id']]['sha256'])
 def test_two_small_images_remain_previews_and_all_seven_have_verified_provenance(self):
  previews={'folio-zh-cn-CSV9.5C-234','folio-zh-cn-CSV5C-155'}
  for r in self.records:
   p=self.artwork[r['cardID']]
   self.assertEqual(p['artworkBatch'],'zh-chase-2026-10-16');self.assertEqual(p['httpStatus'],200);self.assertTrue(p['identityReview']);self.assertTrue(p['evidence'])
   self.assertEqual(p['artworkTier'],'thumb' if r['cardID'] in previews else 'high')
   self.assertIn('/'+p['artworkTier']+'.',p['imageURL'])
  self.assertIn('images.pikaqian.com',self.artwork['folio-zh-cn-CSV5C-155']['evidence'][0])
 def test_remaining_nine_previews_match_published_hashes_and_printings(self):
  batch=json.loads((ROOT/'catalog/chinese-chase-artwork-completion-2026-10-16.json').read_text())
  self.assertEqual(len(batch['records']),9)
  for p in batch['records']:
   c=self.cards[p['cardID']]
   self.assertEqual(c['imageURL'],p['imageURL']);self.assertEqual(p['artworkTier'],'thumb');self.assertEqual(p['nativeSize'],'300x419')
   self.assertEqual(p['imageURL'].split('/')[-2],p['sha256']);self.assertTrue(p['identityReview']);self.assertTrue(p['evidence'])
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
