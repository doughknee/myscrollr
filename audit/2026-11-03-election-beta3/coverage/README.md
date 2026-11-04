# November 3 election coverage in the private beta

At **9:10:02 pm CST**, civicAPI listed 34,282 candidate contests that Scrollr could follow in the 50 states and Washington, DC. Of those, 7,270 had positive candidate vote totals. We compared every one with the **9:00:23 pm CST** observation and found changed candidate counts in 1,546 contests. Both reads returned every row the source counted. Times in the CSV files use November 4 UTC. [Election-day index](https://civicapi.org/results/elections/november-3-2026) · [Source API](https://civicapi.org/api/v2/race/search?startDate=2026-11-03&endDate=2026-11-03&limit=50000)

| Office | Followable | Had votes at 9:10 | Counts changed since 9:00 |
| --- | ---: | ---: | ---: |
| Mayor | 2,139 | 327 | 3 |
| Municipal council / alderman | 3,863 | 776 | 45 |
| Governor | 36 | 27 | 23 |
| U.S. House voting seats | 435 | 331 | 200 |
| U.S. Senate | 35 | 29 | 24 |
| DC delegate | 1 | 0 | 0 |
| Other candidate contests | 27,773 | 5,780 | 1,251 |
| **Total** | **34,282** | **7,270** | **1,546** |

Municipal coverage varied substantially. The survey found a mayor or council listing in 27 states/DC jurisdictions and a positive local tally in 11. All 51 jurisdictions had at least one followable race. The full local inventory contains **1,103** vote-bearing mayor and council races sorted by state, office and name. [Local returns](local-returns.csv) · [All 51 jurisdiction counts](states.csv) · [Every changed race](changes.csv)

## Where votes came in

| Contest | First candidate vote sum | Last candidate vote sum |
| --- | ---: | ---: |
| [Providence mayor, RI](https://civicapi.org/results/elections/179658) | 32,848 | 36,992 |
| [East Providence mayor, RI](https://civicapi.org/results/elections/179553) | 13,741 | 15,974 |
| [Johnston mayor, RI](https://civicapi.org/results/elections/179591) | 7,381 | 7,875 |
| [South Kingstown Town Council, RI](https://civicapi.org/results/elections/179686) | 21,023 | 37,854 |
| [Bucksport Town Council at-large, ME](https://civicapi.org/results/elections/178144) | 0 | 3,638 |
| [Statesboro City Council District 2 special, GA](https://civicapi.org/results/elections/187095) | 1,120 | 1,630 |
| [Tennessee governor](https://civicapi.org/results/elections/87476) | 1,554,654 | 1,641,859 |
| [Pennsylvania U.S. House District 3](https://civicapi.org/results/elections/87378) | 70,684 | 189,391 |
| [Ohio U.S. Senate special](https://civicapi.org/results/elections/87527) | 3,292,762 | 3,456,154 |

For multi-seat contests, a voter may select several candidates. The sums above count candidate votes. The city clerk identifies the Georgia race as Statesboro’s District 2 special election, and its election notice matches all three civicAPI candidates. The source calls it “Bulloch County City Council - District 2 (Special)”. Scrollr preserves that provider identifier and adds Statesboro to search. [City clerk](https://statesboroga.gov/departments/city_clerk/elections.php) · [Candidate notice](https://www.statesboroga.gov/alert/index.php)

## Where the source falls short

- Tennessee returned 129 entries, including 127 candidate contests. Its governor row showed Marsha Blackburn at 735,411 and Jerri Green at 720,945, with 71% reporting at the last check. Both municipal office groups were empty. Shelby County scheduled the Bartlett mayor and municipal alderman elections, and Davidson County published ballots for municipal elections in Belle Meade, Forest Hills and Goodlettsville. Those local elections were absent from this provider directory. [Tennessee governor](https://civicapi.org/results/elections/87476) · [Shelby County election notice](https://electionsshelbytn.gov/wp-content/uploads/2026/03/Nov-3-2026-Key-Dates-3.3.26.pdf) · [Davidson County ballots](https://www.nashville.gov/departments/elections/voters/sample-ballots)
- In North Carolina, the elections board’s 9:02:51 pm CST file contained 84 municipal contest name matches with votes. At 9:03:24 civicAPI had 97 qualifying mayor/council listings there and zero with positive votes. These two classifications have different inclusion rules. Asheville’s mayor alone already had 42,475 candidate votes in the state file. [North Carolina board data](https://s3.amazonaws.com/dl.ncsbe.gov/ENRS/2026_11_03/results_pct_20261103.zip) · [State spot check](nc-spot-check.json) · [Matching provider observation](nc-civicapi-comparison.json)
- Every expected major office was present in the jurisdiction-level comparison: a U.S. House or DC delegate listing in 51 jurisdictions, Senate races in 35 states and governor races in 36 states. This comparison checks scheduled **office presence**, while a municipal completeness percentage requires an independent official contest list for each jurisdiction. [Major office checks](major-offices.csv) · [FEC congressional schedule](https://www.fec.gov/documents/5910/2026pdates.pdf) · [NGA governor elections](https://www.nga.org/governors/elections/)

## Measurement and replay

civicAPI's results-day client requests a date-limited search with a 50,000-row ceiling. Both captured responses reported offset 0 and 38,778 unique IDs. The generator verifies the response hash and rejects a truncated final survey. We excluded 59 territorial/nationwide rows, 88 legislative seat summaries, 3,157 ballot questions or retention votes, and 1,192 rows without a named candidate. [First receipt](observation-a/metadata.json) · [Last receipt](observation-c/metadata.json) · [Machine-readable findings](summary.json)

A changed mark requires a different vote count for at least one candidate ID across the two captures. A successful fetch, a percent-reporting change, an unchanged positive count, or a newly listed zero-vote candidate does not meet that test. The first and last columns in the inventory always refer to the same two observations. Some provider requests in between returned HTTP 502 or timed out. Collection honored Retry-After and used a national request each time; the private app does not independently poll all 34,282 detail URLs.

The generator keeps explicit mayor/council offices and checks municipal naming conventions when provider categories are generic, including Minnesota council members under Other. Conversely, civicAPI grouped some port authorities and county boards under City Council. The beta groups ambiguous offices under Other, where they remain searchable by the source name. New catalog entries show candidate counts only. Tennessee Governor retains its existing single-seat behavior.

The provider's public search response has candidates, current totals and reporting percentages. It omits per-race update time, test-data and dispute flags. The beta's embedded fallback carries the observation time, omits calls, and only includes positive counts. Direct polling still validates the race identity, source timestamp and non-test status. The search observations are preliminary. [Provider data and attribution FAQ](https://civicapi.org/faq)

To reproduce the final resources offline, run from this coverage directory. Use Python 3.11+.

```sh
python build.py observation-a observation-c
```

To collect a new observation, use a fresh directory, wait beyond the provider cache lifetime, and capture a second time. The capture tool retains the raw response compressed alongside its hash, HTTP date and receipt time. The build tool takes `--output` and `--embedded` for comparison runs in a scratch directory.

```sh
python capture.py /tmp/scrollr-observation-first
# Capture again later.
python capture.py /tmp/scrollr-observation-last
python build.py /tmp/scrollr-observation-first /tmp/scrollr-observation-last --output /tmp/scrollr-survey --embedded /tmp/scrollr-directory
```
