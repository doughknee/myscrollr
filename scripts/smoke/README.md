# Smoke tests

Scripts to verify the scrollr platform is healthy end-to-end before cutting a
release or promoting a candidate to production.

## `production-readiness.sh`

Runs a readiness probe against every service in the cluster. Exits 0 iff
every service returns HTTP 200 on its configured readiness endpoint.

```sh
# Against the default (scrollr) namespace of the currently-active kubecontext
scripts/smoke/production-readiness.sh

# Against a different namespace
NAMESPACE=scrollr-staging scripts/smoke/production-readiness.sh

# Shorter per-service timeout (useful in CI)
READINESS_TIMEOUT=30 scripts/smoke/production-readiness.sh
```

### What it checks

| Service | Endpoint | Port |
|---|---|---|
| `core-api` | `/health` | 8080 |
| `sports-service` | `/health/ready` | 3002 |
| `finance-service` | `/health/ready` | 3001 |
| `rss-service` | `/health/ready` | 3004 |
| `sports-api` | `/internal/health` | 8082 |
| `rss-api` | `/internal/health` | 8083 |
| `fantasy-api` | `/internal/health` | 8084 |

These are the same endpoints Kubernetes' `readinessProbe` hits for each
deployment (see `k8s/*.yaml`). If the smoke test passes, the probes pass too.

### Output

Each service gets one `OK` / `FAIL` line. On failure the script dumps a JSON
summary of every service's result — including the HTTP status code and any
response body — so you can see exactly what's broken without having to run
the checks manually:

```
core-api             /health              OK (HTTP 200)
sports-service       /health/ready        FAIL (HTTP 404, readiness timeout)
…

==================================================
3 OF 8 SERVICES NOT READY
==================================================
```

### Exit status

| Code | Meaning |
|---|---|
| 0 | All services healthy. |
| 1 | One or more services returned non-200. Details on stdout. |
| 2 | Usage error (unknown flag, missing kubectl/curl/jq). |

### When to run

- **Before cutting a release.** Run against the staging namespace after
  the release candidate is deployed. An exit 0 is a prerequisite for
  promotion.
- **After a deploy to production.** Run against the scrollr namespace
  once the rollout completes, to catch anything the Kubernetes probes
  might have missed (e.g. a race between container start and the first
  successful poll cycle).
- **In a pre-deploy CI gate.** Wire it into GitHub Actions as a required
  check on `main` — `KUBECONFIG` lives in a secret, the job runs on a
  self-hosted runner that can reach the cluster, and a non-zero exit
  blocks the merge.

### Design

- One `kubectl port-forward` per service, torn down immediately after
  the check completes. Per-service fresh tunnel avoids state
  contamination between checks.
- 503 responses are expected during a rolling deploy (a pod is honestly
  telling us it's still Starting). The script waits up to
  `READINESS_TIMEOUT` seconds before giving up, so a brief blip doesn't
  fail the check.
- No dependencies beyond `kubectl`, `curl`, `jq`, and `bash 4+`.
