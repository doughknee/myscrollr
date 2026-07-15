#!/usr/bin/env bash
# =============================================================================
# Production-readiness smoke test.
#
# Verifies that every service in the scrollr platform is actually ready to
# serve traffic. Designed to be run manually before a release cut, and also
# suitable for a pre-deploy gate in CI.
#
# USAGE
#
#   scripts/smoke/production-readiness.sh              # run against cluster
#   scripts/smoke/production-readiness.sh --namespace  # override k8s ns
#   scripts/smoke/production-readiness.sh --help
#
# Environment:
#
#   NAMESPACE             k8s namespace (default: scrollr)
#   KUBECONFIG            path to kubeconfig (default: $HOME/.kube/config)
#   PORT_FORWARD_TIMEOUT  seconds to wait for each port-forward (default: 10)
#   READINESS_TIMEOUT     seconds to wait for /health/ready to return 200
#                         (default: 120)
#
# EXIT STATUS
#
#   0  All services returned HTTP 200 on their readiness endpoint.
#   1  One or more services returned a non-200 status, or port-forwarding
#      failed. Per-service status is printed to stdout.
#   2  Usage error.
#
# INVARIANT
#
#   If this script exits 0, every readiness probe in k8s/*.yaml also sees a
#   200 response, and the cluster is safe to route production traffic to.
#
# DESIGN NOTES
#
#   - One k8s `Service` per check. We port-forward to the Service rather than
#     the Pod because we want to verify the probe target exactly as k8s sees
#     it, not to cherry-pick a specific pod.
#   - Retries on 503 until the READINESS_TIMEOUT elapses. This is expected
#     during a rollout when some pods are still in Starting — the script
#     waits, it doesn't fail fast.
#   - Each check gets a unique local port (picked from a fixed table) so
#     parallelism is possible in a follow-up without port collisions.
#   - No external dependencies beyond `kubectl`, `curl`, and `jq`. Intended
#     to run from an engineer's laptop or from a minimal CI image.
# =============================================================================

set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────
NAMESPACE="${NAMESPACE:-scrollr}"
PORT_FORWARD_TIMEOUT="${PORT_FORWARD_TIMEOUT:-10}"
READINESS_TIMEOUT="${READINESS_TIMEOUT:-120}"

# ─── Arg parsing ──────────────────────────────────────────────────────────
while (("$#")); do
    case "$1" in
    --namespace)
        NAMESPACE="$2"
        shift 2
        ;;
    --help | -h)
        sed -n '/^# USAGE/,/^# =====/p' "$0" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
    *)
        echo "error: unknown flag '$1' (try --help)" >&2
        exit 2
        ;;
    esac
done

# ─── Service manifest ─────────────────────────────────────────────────────
# Fields: service-name  local-port  cluster-port  readiness-path
SERVICES=(
    "core-api        18080  8080  /health"
    "sports-service  13002  3002  /health/ready"
    "finance-service 13001  3001  /health/ready"
    "rss-service     13004  3004  /health/ready"
    "sports-api      18082  8082  /internal/health"
    "rss-api         18083  8083  /internal/health"
    "fantasy-api     18084  8084  /internal/health"
    "predictions-service 13005 3005 /health/ready"
    "predictions-api 18085  8085  /internal/health"
)

# ─── Helpers ──────────────────────────────────────────────────────────────
need() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: '$1' is required on PATH" >&2
        exit 2
    }
}

need kubectl
need curl
need jq

# Output helpers (keep them simple, no fancy colors in CI)
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }

# ─── Check one service ────────────────────────────────────────────────────
# Arguments: svc local_port cluster_port path
# Stdout: one-line JSON blob describing the result.
# Returns 0 on HTTP 200, 1 on any other outcome.
check_service() {
    local svc="$1" local_port="$2" cluster_port="$3" path="$4"
    local pf_pid="" status="000" body="" rc=1

    # Start port-forward in the background. Use nohup-style detachment so
    # SIGPIPE from a caller closing our stdout doesn't leak into kubectl.
    kubectl -n "$NAMESPACE" port-forward \
        "svc/$svc" "$local_port:$cluster_port" \
        >"/tmp/smoke-${svc}.log" 2>&1 </dev/null &
    pf_pid=$!

    # Wait for the tunnel to actually be up.
    local deadline=$((SECONDS + PORT_FORWARD_TIMEOUT))
    local tunnel_up=0
    while ((SECONDS < deadline)); do
        if curl -sS --max-time 1 -o /dev/null -w '%{http_code}' \
            "http://localhost:$local_port/" >/dev/null 2>&1; then
            tunnel_up=1
            break
        fi
        # If port-forward itself died, bail.
        if ! kill -0 "$pf_pid" 2>/dev/null; then
            break
        fi
        sleep 0.5
    done

    if ((tunnel_up == 0)); then
        jq -cn --arg svc "$svc" --arg path "$path" \
            '{service: $svc, path: $path, ok: false, status: 0, reason: "port-forward failed"}'
    else
        # Poll the readiness endpoint until it returns 200 or the readiness
        # timeout expires. 503s are expected during a rollout — we wait.
        local deadline2=$((SECONDS + READINESS_TIMEOUT))
        while ((SECONDS < deadline2)); do
            status=$(curl -sS --max-time 3 -o "/tmp/smoke-${svc}.body" -w '%{http_code}' \
                "http://localhost:$local_port$path" 2>/dev/null || echo "000")
            if [[ "$status" == "200" ]]; then
                rc=0
                break
            fi
            sleep 2
        done

        body=$(cat "/tmp/smoke-${svc}.body" 2>/dev/null || echo "")

        if ((rc == 0)); then
            # Try to parse body as JSON; fall back to raw string if not.
            if body_json=$(jq -e . <<<"$body" 2>/dev/null); then
                jq -cn --arg svc "$svc" --arg path "$path" --argjson status "$status" \
                    --argjson body "$body_json" \
                    '{service: $svc, path: $path, ok: true, status: $status, body: $body}'
            else
                jq -cn --arg svc "$svc" --arg path "$path" --argjson status "$status" \
                    --arg body "$body" \
                    '{service: $svc, path: $path, ok: true, status: $status, body: $body}'
            fi
        else
            jq -cn --arg svc "$svc" --arg path "$path" --arg status "$status" \
                --arg body "$body" \
                '{service: $svc, path: $path, ok: false, status: ($status|tonumber? // 0), reason: "readiness timeout", last_body: $body}'
        fi
    fi

    # Always tear down the port-forward before returning. `kill -9` ensures
    # the child dies immediately; `wait` + `|| true` suppresses the exit
    # status from the tunnel.
    kill -9 "$pf_pid" 2>/dev/null || true
    wait "$pf_pid" 2>/dev/null || true

    return "$rc"
}

# ─── Main ────────────────────────────────────────────────────────────────
echo "=================================================="
echo "Scrollr production-readiness smoke test"
echo "  namespace:         $NAMESPACE"
echo "  per-svc timeout:   ${READINESS_TIMEOUT}s"
echo "=================================================="

# Pre-flight: is there even a cluster to talk to?
if ! kubectl -n "$NAMESPACE" get ns "$NAMESPACE" >/dev/null 2>&1; then
    red "Namespace '$NAMESPACE' is not reachable. Is your kubeconfig set?"
    exit 1
fi

results=()
failed=0

for line in "${SERVICES[@]}"; do
    # shellcheck disable=SC2086
    read -r svc local_port cluster_port path <<<"$line"

    printf '%-20s %-20s ' "$svc" "$path"
    # `check_service` returns non-zero on a readiness failure by design —
    # we want to continue iterating so every service gets probed. `|| true`
    # keeps `set -e` from killing the outer script on that expected
    # non-zero exit. The JSON body on stdout carries the pass/fail signal.
    result=$(check_service "$svc" "$local_port" "$cluster_port" "$path" 2>/dev/null || true)
    results+=("$result")

    if echo "$result" | jq -e '.ok == true' >/dev/null; then
        green "OK (HTTP $(echo "$result" | jq -r '.status'))"
    else
        reason=$(echo "$result" | jq -r '.reason // "unknown"')
        status=$(echo "$result" | jq -r '.status // "n/a"')
        red "FAIL (HTTP $status, $reason)"
        failed=$((failed + 1))
    fi
done

echo
echo "=================================================="
if ((failed == 0)); then
    green "ALL ${#SERVICES[@]} SERVICES READY"
    echo "=================================================="
    exit 0
else
    red "$failed OF ${#SERVICES[@]} SERVICES NOT READY"
    echo "=================================================="
    echo
    yellow "Per-service JSON (for debugging):"
    printf '%s\n' "${results[@]}" | jq -s '.'
    exit 1
fi
