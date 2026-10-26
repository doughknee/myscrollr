# Production workload and management access

SCROLLR-388 restricts the five Scrollr workloads. Core receives explicit
`secretKeyRef` entries for the keys it uses; the three ingesters receive only
their database/provider keys and release metadata. The website receives no
runtime secrets. Secret values remain in `scrollr-secrets`; this change does
not rotate them or create extra copies. New integrations must add their required
key explicitly. Removing a key from injection does not revoke it.

All five containers run as a numeric non-root user with a read-only image,
all Linux capabilities dropped, privilege escalation disabled and the runtime's
default seccomp filter. Small, bounded in-memory scratch volumes provide `/tmp`
and nginx's PID/cache directories. Core's executable, migrations and country
database live in readable `/app`, not root's private home. Ingester logs already
go to stdout. Kubernetes service-account tokens remain unmounted and metadata
egress remains blocked by the existing network policies.

## DigitalOcean control-plane firewall

The management firewall protects Kubernetes API access. It does not filter the
public website, signup, feeds or support endpoints. DigitalOcean automatically
allows cluster workers and its management systems; it is not a replacement for
pod network policies or revocation of exposed provider-managed credentials.

Permanent allowed addresses are operator public IPv4 `/32` entries. Keep the
current list in DigitalOcean, not in this public repository. Before enabling or
changing it, verify the operator's public IPv4, save the existing firewall JSON,
and verify DigitalOcean API credentials can update the cluster independently
of Kubernetes. That API/control-panel path is the recovery route if an operator's
home IP changes. Do not add all GitHub/Azure address ranges.

The deployment job is serialized with `scrollr-production-deploy` and never
cancels a running rollout. `scripts/doks-firewall.py` adds only that runner's
public IPv4 before Kubernetes access, preserving existing addresses, then
removes its own added rule in an `always()` step after rollout/rollback. It never
enables or disables the firewall. The state file is written before the API
update so a lost response still permits cleanup; a preexisting rule is never
removed. Do not edit the firewall concurrently with a deployment: DigitalOcean
updates replace the entire address list, with no compare-and-swap operation.

This is job cleanup, not a provider-enforced expiry. A hard-killed runner or
provider outage can leave its `/32` behind. On an interrupted/red cleanup job,
compare the firewall list to the approved operator addresses and remove the
orphan through DigitalOcean after confirming no deployment is active. Never
blindly restore an old full list over someone else's new operator rule.

### Recovery

From an authenticated `doctl` outside the cluster, inspect the current firewall
using the DigitalOcean cluster GET API (older `doctl get` output may omit it).
To regain operator access, preserve every existing rule and add the verified new
public IPv4 through the cluster PUT API's `control_plane_firewall` object. As an
emergency fallback only:

```sh
doctl kubernetes cluster update scrollr-cluster --enable-control-plane-firewall=false
```

This temporarily exposes the management endpoint to the internet; Kubernetes
authentication still applies. Re-enable with the corrected narrow list promptly.
Node recycling and firewall enablement do not prove old credentials are revoked.

## Deployment and verification

Apply one workload at a time with its final immutable image; never apply new
non-root settings to an old core image under `/root`. ConfigMap-only changes
still restart affected pods. Before rollout, the workflow saves each live pod
template. Rollout or readiness failure restores the old image, permissions,
mounts and environment together. ConfigMap contents and schema migrations are
not reverted by that rollback; keep those changes additive and separately
recoverable.

Run `python scripts/check-workload-security.py` (PyYAML),
`python scripts/doks-firewall.test.py` and the production readiness smoke test.
Before shipping a new runtime restriction, start the actual images with a
disposable PostgreSQL/Redis database on an isolated network; confirm migrations,
config reads, health, logs, scratch writes and rejected image filesystem writes.
After deployment check actual process UID/capabilities, all workload readiness,
normal public/auth/support routes, feed output and subscriptions. Verify a real
GitHub deployment with the firewall enabled and confirm its runner rule is gone.
From an unlisted external host verify a new management connection is blocked.

Provider credential revocation/history is tracked separately in SCROLLR-368.
