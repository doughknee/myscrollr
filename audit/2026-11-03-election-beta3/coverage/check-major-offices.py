"""Check whether each state has a listed contest in each scheduled major office.

This is an office-presence check, not district completeness. Louisiana holds its
House primary on this date; DC elects a delegate. Municipal election calendars
are jurisdiction-specific and do not have a national denominator here.
"""
import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Senate flags from FEC 2026 Congressional Primary Dates, including FL/OH specials.
# https://www.fec.gov/documents/5910/2026pdates.pdf
SENATE = set("AL AK AR CO DE FL GA ID IL IA KS KY LA ME MA MI MN MS MT NE NH NJ NM NC OH OK OR RI SC SD TN TX VA WV WY".split())
# NGA general-election map (states only).
# https://www.nga.org/governors/elections/
GOVERNOR = set("AL AK AZ AR CA CO CT FL GA HI ID IL IA KS ME MD MA MI MN NE NV NH NM NY OH OK OR PA RI SC SD TN TX VT WI WY".split())
STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
assert len(set(STATES)) == 51 and len(SENATE) == 35 and len(GOVERNOR) == 36


def main():
    races = json.loads((HERE.parents[2] / "api/internal/ingestread/elections_catalog.json").read_text(encoding="utf-8"))
    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(("state", "house_or_delegate", "us_senate", "governor"))
    for state in sorted(STATES):
        offices = {r["office"] for r in races if r["state"] == state}
        delegate = any(r["state"] == "DC" and r["name"] == "DC Delegate" for r in races)
        def check(expected, found):
            if expected:
                return "listed" if found else "check source"
            return "unexpected listing" if found else "not scheduled"
        writer.writerow((state, check(True, "us_house" in offices or (state == "DC" and delegate)),
                         check(state in SENATE, "us_senate" in offices),
                         check(state in GOVERNOR, "governor" in offices)))


if __name__ == "__main__":
    main()
