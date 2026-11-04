import unittest

import build


class ElectionDiscoveryTests(unittest.TestCase):
    def test_municipal_labels_and_similar_offices(self):
        examples = [
            ("MN","Other","Minnesota Council Member (Bigfork) (Elect 2)","city_council"),
            ("MN","Other","Minnesota Special Election for Council Member (Raymond)","city_council"),
            ("MN","Other","Minnesota Mayor (Randolph)","mayor"),
            ("OK","Local","Oklahoma City of Clinton Councilman Ward 4","city_council"),
            ("FL","Special District","Groveland Council Member, District 3, Lake County","city_council"),
            ("FL","City Council","City of Naples Airport Authority, Seat 4, Collier County","other"),
            ("RI","Mayor","Bristol Town Administrator","other"),
            ("MD","Education","Maryland Board of Education Cecil Councilmanic District 5","other"),
            ("IN","County Council","Wabash County Council, District 2","other"),
            ("DC","Delegate","DC Delegate","us_delegate"),
        ]
        for state, field, name, expected in examples:
            with self.subTest(name=name):
                self.assertEqual(build.office({"province":state,"type":field,"election_name":name}), expected)

    def test_salary_measure_mislabeled_mayor(self):
        race={"country":"US","province":"WA","election_date":"2026-11-03T05:00:00Z","type":"Mayor",
              "candidates":[{"name":"Yes"},{"name":"No"}]}
        self.assertEqual(build.exclude(race), "ballot question/retention vote")


if __name__=="__main__":
    unittest.main()
