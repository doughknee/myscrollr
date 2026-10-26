"""Lease one runner IPv4 address; never disable the firewall or replace operator rules."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request


def public_address(value):
    address = ipaddress.ip_address(value.strip())
    if address.version != 4 or not address.is_global:
        raise ValueError("Expected a public IPv4 address")
    return str(address) + "/32"


def change_addresses(addresses, address, remove=False):
    # Preserve the provider's order and every unrelated operator rule.
    if remove:
        return [item for item in addresses if item != address]
    if address in addresses:
        return addresses[:]
    if len(addresses) >= 500:
        raise ValueError("Control-plane firewall allowlist is full")
    return addresses + [address]


def api(cluster, body=None):
    request = urllib.request.Request(
        "https://api.digitalocean.com/v2/kubernetes/clusters/" + cluster,
        data=None if body is None else json.dumps(body).encode(),
        method="GET" if body is None else "PUT",
        headers={"Authorization": "Bearer " + os.environ["DIGITALOCEAN_ACCESS_TOKEN"],
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)["kubernetes_cluster"]


def firewall(cluster):
    # DO omits this field before initial enablement.
    return api(cluster).get("control_plane_firewall") or {"enabled": False, "allowed_addresses": []}


def grant(cluster, state_path, address):
    if state_path.exists():
        raise ValueError("Lease file already exists; reconcile it before granting access")
    current = firewall(cluster)
    added = current["enabled"] and address not in current["allowed_addresses"]
    state = {"cluster": cluster, "address": address, "added": added}
    # Journal BEFORE PUT so cleanup also handles an accepted request whose response was lost.
    state_path.write_text(json.dumps(state), encoding="utf-8")
    if added:
        desired = change_addresses(current["allowed_addresses"], address)
        api(cluster, {"control_plane_firewall": {"enabled": True, "allowed_addresses": desired}})
        actual = firewall(cluster)
        if not actual["enabled"] or set(actual["allowed_addresses"]) != set(desired):
            raise RuntimeError("Firewall update did not preserve the expected rules")
    print("Runner firewall lease recorded" if current["enabled"] else "Firewall not enabled yet; no rules changed")


def revoke(cluster, state_path):
    if not state_path.exists():
        print("No runner lease to remove")
        return
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state["cluster"] != cluster:
        raise ValueError("Lease belongs to a different cluster")
    if state["added"]:
        for attempt in range(5):
            try:
                current = firewall(cluster)
                if state["address"] not in current["allowed_addresses"]:
                    break
                desired = change_addresses(current["allowed_addresses"], state["address"], remove=True)
                api(cluster, {"control_plane_firewall": {"enabled": current["enabled"], "allowed_addresses": desired}})
                actual = firewall(cluster)
                if state["address"] in actual["allowed_addresses"]:
                    raise RuntimeError("Runner rule was not removed")
                break
            except (urllib.error.URLError, TimeoutError, RuntimeError):
                if attempt == 4:
                    raise
                time.sleep(5)
    state_path.unlink()
    print("Runner firewall lease removed; operator rules preserved")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["grant", "revoke"])
    parser.add_argument("--cluster", required=True)
    parser.add_argument("--state", required=True, type=Path)
    args = parser.parse_args()
    if args.action == "revoke":
        revoke(args.cluster, args.state)
    else:
        with urllib.request.urlopen("https://api.ipify.org", timeout=15) as response:
            address = public_address(response.read(128).decode())
        grant(args.cluster, args.state, address)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # API bodies/headers may contain sensitive account information.
        raise SystemExit("Firewall operation failed: " + type(error).__name__) from None
