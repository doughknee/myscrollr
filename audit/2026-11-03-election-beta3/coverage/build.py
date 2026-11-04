"""Build election discovery resources and the coverage ledger from saved public observations."""
import argparse
import collections
import csv
import gzip
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
READER = ROOT.parents[2] / "api/internal/ingestread"
STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
MEASURES = {"Referendum", "Ballot Measure", "Proposition"}
OPTIONS = {"yes","no","for","against","approved","rejected","approve","reject","levy yes","levy no",
           "for the levy","against the levy","retain","do not retain","recall","do not recall"}
VACANT = {"write-in","write in","no candidate filed","no candidates filed","no nomination made","none"}
GROUPS = {"governor", "us_senate", "us_house", "us_delegate", "mayor", "city_council", "other"}


def read(directory):
    meta = json.loads((directory / "metadata.json").read_text())
    raw = gzip.decompress((directory / "listing.json.gz").read_bytes())
    if meta["raw_sha256"] != hashlib.sha256(raw).hexdigest():
        raise ValueError("Capture hash mismatch")
    data = json.loads(raw)
    rows = {r["id"]:r for r in data["races"]}
    complete = (data["offset"] == 0 and len(rows) == len(data["races"]) == data["count"] < data["limit"])
    return meta, rows, complete


def exclude(r):
    if r.get("test_data") is True:
        return "provider test data"
    if r["country"] != "US" or r["province"] not in STATES:
        return "territory/national/non-US"
    if r["election_date"][:10] != "2026-11-03" or r["type"] == "Early Vote":
        return "other date/early-vote aggregate"
    people = r["candidates"]
    if "seats" in r or any("seats" in c for c in people):
        return "seat-count aggregate"
    choices = {c["name"].strip().casefold() for c in people}
    if r["type"] in MEASURES or choices and choices <= OPTIONS:
        return "ballot question/retention vote"
    if not choices or choices <= VACANT:
        return "no named candidate"
    percent_ok = lambda p: p is None or type(p) in {int,float} and 0 <= p <= 100
    if (len(people) > 128 or not r["election_name"].strip() or not isinstance(r["id"], int) or r["id"] < 1
        or not percent_ok(r.get("percent_reporting"))
        or len({c["candidate_id"] for c in people}) != len(people)
        or any(not isinstance(c["candidate_id"], int) or c["candidate_id"] < 1
               or not c["name"].strip() or len(c["name"]) > 160
               or not percent_ok(c.get("percent")) or type(c["votes"]) is not int or not 0 <= c["votes"] <= 2**53-1
               or type(c.get("winner")) is not bool for c in people)):
        return "unusable candidate payload"
    return None


def office(r):
    field, title = r["type"], r["election_name"].casefold()
    state = r["province"]
    if state=="DC" and field=="Delegate" and title=="dc delegate":
        return "us_delegate"
    fixed = {"Governor":"governor","US Senate":"us_senate","House of Representatives":"us_house",
             "Mayor":"mayor","Mayor - City of Cumberland":"mayor","City Council":"city_council",
             "Alderman / City Council Member":"city_council","Alderman / City Council at Large":"city_council",
             "Council - City of Cumberland":"city_council"}
    if field == "Mayor" and "town administrator" in title:
        return "other"
    if field == "City Council" and not re.search(r"council|alderm[ae]n|alderperson|alderwom[ae]n", title):
        # Some provider "City Council" rows are actually airport/port boards,
        # selectmen, county boards, or commissions. Keep them searchable as Other.
        return "other"
    if field in fixed:
        return fixed[field]
    # These distinct jurisdiction formats were present in the measured files.
    # Match narrowly: county councils, advisory bodies, city commissions and
    # school board districts can all contain similar words.
    if (state == "MN" and field == "Other" and re.match(r"minnesota (special election for )?council ?member\b", title)
        or state == "OK" and field == "Local" and re.match(r"oklahoma city of .+\bcouncil(?:member|man|person)?\b", title)
        or state == "FL" and field == "Special District"
        and re.match(r"(north miami|city of palm coast|groveland|port st\. lucie|fort white)\b.*\bcouncil(?:person)?\b", title)):
        return "city_council"
    if field in {"Local","Other"}:
        if re.search(r"\bmayor\b",title):
            return "mayor"
        if re.search(r"\b((city|town|borough|village|common) council|alderm[ae]n|alderperson|board of aldermen)\b",title):
            return "city_council"
    return "other"


def votes(r):
    return {str(c["candidate_id"]):c["votes"] for c in r["candidates"]}


def dump(path,obj,lines=False):
    compact = lambda v:json.dumps(v, ensure_ascii=False, separators=(",",":"), allow_nan=False)
    content = "[\n"+",\n".join(compact(x) for x in obj)+"\n]\n" if lines else compact(obj)+"\n"
    if path.suffix == ".gz":
        path.write_bytes(gzip.compress(content.encode(),compresslevel=7,mtime=0))
    else:
        with path.open("w",encoding="utf-8",newline="\n") as f:
            f.write(content)


def build(first, last, output, embedded):
    ma,a,ca = read(first)
    mb,b,cb = read(last) if last else (ma,a,ca)
    if not cb:
        raise ValueError("Truncated or incomplete national listing: no resources replaced")
    if last and mb["observed_at"] <= ma["observed_at"]:
        raise ValueError("Second observation must postdate the first")
    output.mkdir(parents=True, exist_ok=True)
    embedded.mkdir(parents=True, exist_ok=True)
    desc=[]; seed={}; changed=[]; local_returns=[]; counts=collections.defaultdict(collections.Counter)
    skips=collections.Counter()
    for rid,r in b.items():
        st=r["province"]; counter=counts[st]
        if st in STATES and r["country"]=="US":
            counter["listed"]+=1
        reason=exclude(r)
        if reason:
            skips[reason]+=1
            continue
        group=office(r)
        rv=votes(r); total=sum(rv.values())
        paired=last is not None and rid in a and not exclude(a[rid])
        # Compare votes for each candidate (including corrections); adding a
        # zero-vote candidate alone does not demonstrate vote movement.
        before=votes(a[rid]) if paired else {}
        different=paired and any(before.get(i,0)!=rv.get(i,0) for i in before.keys()|rv.keys())
        row={"id":rid,"name":r["election_name"],"state":st,"election_date":r["election_date"][:10],
             "office":group,"office_label":r["type"],
             "result_mode":"single_seat" if rid==87476 else "counts_only",
             "vote_status":"votes_reported" if total else "awaiting_votes","checked_at":mb["observed_at"]}
        if r.get("municipality"):
            row["municipality"]=r["municipality"]
        # City election notice matches date, seat and all three candidates.
        # Keep the provider's exact race name for upstream identity checks.
        elif rid==187095 and st=="GA" and r["district"]=="Bulloch":
            row["municipality"]="Statesboro"
        if r.get("district"):
            row["district"]=r["district"]
        if different:
            row["changed_at"]=mb["observed_at"]
            changed.append({"id":rid,"state":st,"office":group,"name":r["election_name"],
                            "first_total":sum(before.values()),"last_total":total})
        if total and group in {"mayor","city_council"}:
            local_returns.append({"state":st,"office":group,"name":r["election_name"],"id":rid,
                "first_total":sum(before.values()) if paired else None,"last_total":total,
                "first_checked_at":ma["observed_at"] if paired else None,"last_checked_at":mb["observed_at"],
                "changed":str(different).lower() if paired else None})
        desc.append(row)
        for key,n in [("admitted",1),("positive",int(total>0)),("rechecked",int(paired)),("changed",int(different))]:
            counter[key]+=n
            counter[group+"_"+key]+=n
        if total:
            seed[str(rid)]={"observed_at":mb["observed_at"],"percent_reporting":r["percent_reporting"],
                "candidates":[{"id":c["candidate_id"],"name":c["name"],"party":c["party"] or "",
                               "votes":c["votes"],"percent":c.get("percent"),"winner":False} for c in r["candidates"]]}
    desc.sort(key=lambda r:(r["id"]!=87476,r["state"],r["name"],r["id"]))
    dump(embedded/"elections_catalog.json",desc,True)
    dump(embedded/"elections_seed.json.gz",seed)
    fields=["listed","admitted","positive","rechecked","changed"]+[g+"_"+k for g in sorted(GROUPS) for k in ("admitted","positive","rechecked","changed")]
    states=[]
    with (output/"states.csv").open("w",encoding="utf-8",newline="") as f:
        table=csv.writer(f);table.writerow(["state"]+fields)
        for st in sorted(STATES):
            ct=counts[st]
            states.append({"state":st,"status":"listed" if ct["admitted"] else "no_listed_races"})
            table.writerow([st]+[ct[k] for k in fields])
    dump(embedded/"elections_coverage.json",{"checked_at":mb["observed_at"],"previous_checked_at":ma["observed_at"] if last else None,"states":states})
    with (output/"changes.csv").open("w",encoding="utf-8",newline="") as f:
        table=csv.DictWriter(f,fieldnames=["id","state","office","name","first_total","last_total"])
        table.writeheader()
        table.writerows(sorted(changed,key=lambda row:(row["office"],row["state"],row["id"])))
    with (output/"local-returns.csv").open("w",encoding="utf-8",newline="") as f:
        table=csv.DictWriter(f,fieldnames=["state","office","name","id","first_total","last_total","first_checked_at","last_checked_at","changed"])
        table.writeheader()
        table.writerows(sorted(local_returns,key=lambda row:(row["state"],row["office"],row["name"],row["id"])))
    totals={k:sum(counts[s][k] for s in STATES) for k in fields}
    summary={"first_observed_at":ma["observed_at"],"last_observed_at":mb["observed_at"],"first_complete":ca,"last_complete":cb,
             "raw_rows":len(b),"excluded":dict(sorted(skips.items())),"totals":totals}
    (output/"summary.json").write_text(json.dumps(summary,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(summary),flush=True)


if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("first",type=Path)
    p.add_argument("last",type=Path,nargs="?")
    p.add_argument("--output",type=Path,default=ROOT)
    p.add_argument("--embedded",type=Path,default=READER)
    args=p.parse_args()
    build(args.first,args.last,args.output,args.embedded)
