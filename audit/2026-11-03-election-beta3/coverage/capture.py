"""Capture civicAPI's public election-day index; Python 3.10+ and curl."""
import argparse
import gzip
import hashlib
import json
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

URL = "https://civicapi.org/api/v2/race/search?startDate=2026-11-03&endDate=2026-11-03&limit=50000"
ROOT = Path(__file__).resolve().parent


def save(raw, headers, output, observed_at):
    body = raw.read_bytes()
    source = json.loads(body)
    assert isinstance(source["races"], list)
    lines = headers.read_text(errors="replace").splitlines()
    fields = {key.strip().lower(): value.strip() for line in lines if ":" in line
              for key, value in [line.split(":", 1)]}
    output.mkdir(parents=True, exist_ok=True)
    (output / "listing.json.gz").write_bytes(gzip.compress(body, compresslevel=7, mtime=0))
    meta = {
        "url": URL, "observed_at": observed_at, "response_date": fields.get("date"),
        "cache": fields.get("x-cache"), "age": fields.get("age"),
        "cache_control": fields.get("cache-control"), "raw_sha256": hashlib.sha256(body).hexdigest(),
        "count": source["count"], "offset": source["offset"], "limit": source["limit"],
        "returned": len(source["races"]),
    }
    (output / "metadata.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    if (args.output / "listing.json.gz").exists():
        p.error("choose a new directory for each observation")
    curl = shutil.which("curl")
    if not curl:
        p.error("curl is required")
    with tempfile.TemporaryDirectory() as path:
        raw, headers = Path(path)/"listing", Path(path)/"headers"
        for attempt in range(4):
            res = subprocess.run([curl, "--silent", "--show-error", "--compressed", "--connect-timeout", "8",
                 "--max-time", "85", "--max-filesize", str(96 << 20), "-o", str(raw), "-D", str(headers),
                 "-w", "%{http_code}", URL], stdout=subprocess.PIPE, text=True)
            observed = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            if res.returncode == 0 and res.stdout == "200":
                save(raw, headers, args.output, observed)
                return
            print(observed, "HTTP",res.stdout,"curl",res.returncode, flush=True)
            if attempt == 3:
                raise SystemExit("No valid observation; existing captures preserved")
            delay = 60 * 2**attempt
            if headers.exists():
                for line in headers.read_text(errors="replace").splitlines():
                    if line.lower().startswith("retry-after:") and line.split(":")[1].strip().isdigit():
                        delay = max(delay, int(line.split(":")[1].strip()))
            time.sleep(delay)


if __name__ == "__main__":
    main()
