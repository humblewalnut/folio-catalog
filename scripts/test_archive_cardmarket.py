import importlib.util
import unittest
from pathlib import Path
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('archive', Path(__file__).with_name('archive-cardmarket.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class ArchiveTests(unittest.TestCase):
    def fixture(self):
        return ({'createdAt':'2026-10-12T12:30:22+0200','products':[{'idProduct':1,'idCategory':51}]},
                {'createdAt':'2026-10-12T02:47:30+0200','priceGuides':[{'idProduct':1,'idCategory':51,'trend':10}, {'idProduct':2,'idCategory':52,'trend':99}]})
    def test_only_matched_singles_preserves_source_date(self):
        p,q=self.fixture(); result=module.build(p,q)
        self.assertEqual(list(result['rows']),['1']);self.assertEqual(result['priceCreatedAt'],q['createdAt'])
    def test_duplicate_and_negative_and_future_rejected(self):
        p,q=self.fixture();q['priceGuides'].append(q['priceGuides'][0])
        with self.assertRaises(ValueError):module.build(p,q)
        p,q=self.fixture();q['priceGuides'][0]['trend']=-1
        with self.assertRaises(ValueError):module.build(p,q)
        p,q=self.fixture();q['createdAt']='2099-01-01T00:00:00+0000'
        with self.assertRaises(ValueError):module.build(p,q)

if __name__=='__main__':unittest.main()
