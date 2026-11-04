"""Capture official NC precinct returns for municipal races, aggregated by contest name.

Example: python check-nc.py > nc-first.json. Repeat after NCSBE republishes.
Includes non-geographic absentee/provisional precincts; the source has no
statewide total row. A contest spanning counties is summed across those counties.
"""
import csv
import datetime
import io
import json
import re
import urllib.request
import zipfile
from collections import defaultdict

SOURCE = "https://s3.amazonaws.com/dl.ncsbe.gov/ENRS/2026_11_03/results_pct_20261103.zip"
with urllib.request.urlopen(SOURCE, timeout=30) as response:
    source_time = response.headers["Last-Modified"]
    archive = zipfile.ZipFile(io.BytesIO(response.read()))
contests = defaultdict(lambda: defaultdict(int))
with archive.open("results_pct_20261103.txt") as file:
    rows = csv.DictReader(io.TextIOWrapper(file, encoding="cp1252"), delimiter="\t")
    for row in rows:
        name = row["Contest Name"]
        if not re.search(r"\bMAYOR|(?:CITY|TOWN) COUNCIL", name) or "REFERENDUM" in name:
            continue
        assert row["Election Date"] == "11/03/2026" and row["Precinct"] not in ("ALL", "TOTAL")
        contests[name][row["Choice"].strip()] += int(row["Total Votes"])
print(json.dumps({"source": SOURCE, "source_modified": source_time,
                  "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "contests": dict(sorted(contests.items()))}, indent=2))
