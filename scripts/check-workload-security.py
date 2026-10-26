"""Fail closed if a production manifest widens secrets or runtime permissions."""
from pathlib import Path
import os
import subprocess
import tempfile
import yaml

root = Path(__file__).resolve().parent.parent
allowed = {
    "finance-service": {"DATABASE_URL", "TWELVEDATA_API_KEY", "ENVIRONMENT", "GIT_SHA"},
    "sports-service": {"DATABASE_URL", "API_SPORTS_KEY", "ENVIRONMENT", "GIT_SHA"},
    "rss-service": {"DATABASE_URL", "ENVIRONMENT", "GIT_SHA"},
    "website": set(),
}
for name in ["core-api", *allowed]:
    doc = next(yaml.safe_load_all((root / "k8s" / (name + ".yaml")).read_text()))
    pod = doc["spec"]["template"]["spec"]
    assert pod["automountServiceAccountToken"] is False, name
    assert pod["securityContext"]["runAsNonRoot"] is True, name
    assert pod["securityContext"]["runAsUser"] > 0, name
    assert pod["securityContext"]["seccompProfile"]["type"] == "RuntimeDefault", name
    container = pod["containers"][0]
    security = container["securityContext"]
    assert security["allowPrivilegeEscalation"] is False, name
    assert security["readOnlyRootFilesystem"] is True, name
    assert security["capabilities"] == {"drop": ["ALL"]}, name
    assert all("secretRef" not in entry for entry in container.get("envFrom", [])), name
    keys = {entry["valueFrom"]["secretKeyRef"]["key"] for entry in container.get("env", [])
            if "secretKeyRef" in entry.get("valueFrom", {})}
    if name in allowed:
        assert keys == allowed[name], (name, keys)
    else:
        assert not keys & {"API_SPORTS_KEY", "TWELVEDATA_API_KEY", "GITHUB_APP_WEBHOOK_SECRET", "RESEND_WEBHOOK_SECRET"}
        assert {"DATABASE_URL", "REDIS_URL", "LOGTO_M2M_APP_ID", "LOGTO_M2M_APP_SECRET", "LOGTO_WEB_APP_ID",
                "LOGTO_EXTENSION_APP_ID", "OSTICKET_API_KEY", "SCROLLR_WEBHOOK_SECRET", "STRIPE_SECRET_KEY",
                "STRIPE_WEBHOOK_SECRET", "SUPPORT_APPROVAL_HMAC_SECRET", "SENTRY_USER_SALT", "GIT_SHA"} <= keys
    for volume in pod["volumes"]:
        assert set(volume) == {"name", "emptyDir"}, name
        assert volume["emptyDir"]["sizeLimit"], name
    expected_paths = {"/tmp", "/var/cache/nginx", "/var/run"} if name == "website" else {"/tmp"}
    assert {entry["mountPath"] for entry in container["volumeMounts"]} == expected_paths, name

workflow = yaml.safe_load((root / ".github/workflows/deploy.yml").read_text())
deploy = workflow["jobs"]["deploy"]
assert deploy["concurrency"] == {"group": "scrollr-production-deploy", "cancel-in-progress": False}
steps = deploy["steps"]
grant = next(i for i, step in enumerate(steps) if "doks-firewall.py grant" in step.get("run", ""))
configure = next(i for i, step in enumerate(steps) if "kubeconfig save" in step.get("run", ""))
assert grant < configure
assert steps[-1]["if"] == "always()"
assert "doks-firewall.py revoke" in steps[-1]["run"]
assert any('"path":"/spec/template"' in step.get("run", "") for step in steps)
rollback = next(step for step in steps if step.get("name", "").startswith("Restore pod templates"))
assert "steps.rollout.outcome" in rollback["if"] and "steps.smoke.outcome" in rollback["if"]
assert "--patch-file=" in rollback["run"]
rollout = next(step for step in steps if step.get("id") == "rollout")["run"]
# Execute the real rollout shell with a fake cluster, including config-only and
# non-template spec changes. Both must reload env; a new template must roll once.
with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    pins = work / "pins"
    pins.write_text("\n".join(name + "=registry.digitalocean.com/scrollr/" + name + ":sha-previous"
                              for name in ["core-api", *allowed]))
    source = rollout.replace("/tmp/live-images.env", pins.as_posix())
    source = source.replace("${{ needs.detect-changes.outputs.image-tag }}", "sha-candidate")
    source = source.replace("${{ needs.detect-changes.outputs.k8s }}", "true")
    for name in ["core-api", *allowed]:
        source = source.replace("${{ needs.detect-changes.outputs." + name + " }}", "false")
    mock = r'''
set -euo pipefail
kubectl() {
  if [ "$1" = get ]; then
    case "$*" in
      *spec.template*)
        if [ "$MODE" = changed ]; then cat "$TESTDIR/count"; else echo stable-template; fi ;;
      *) echo "unexpected get: $*" >&2; return 1 ;;
    esac
  elif [ "$1" = apply ]; then
    body=$(cat)
    if echo "$body" | grep -q ':latest'; then return 1; fi
    echo $(( $(cat "$TESTDIR/count") + 1 )) > "$TESTDIR/count"
  elif [ "$1 $2" = 'rollout restart' ]; then
    echo restart >> "$TESTDIR/restarts"
  elif [ "$1 $2" != 'rollout status' ]; then
    echo "unexpected mutation: $*" >&2; return 1
  fi
}
'''
    bash = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else "bash"
    for mode in ["unchanged", "changed"]:
        (work / "count").write_text("0")
        (work / "restarts").write_text("")
        subprocess.run([bash, "-c", mock + source], cwd=root, check=True,
                       env={**os.environ, "MODE": mode, "TESTDIR": work.as_posix(),
                            "REGISTRY": "registry.digitalocean.com/scrollr"})
        count = len((work / "restarts").read_text().splitlines())
        assert count == (5 if mode == "unchanged" else 0), (mode, count)
print("Five workload boundaries, deployment ordering, cleanup and full-template rollback verified")
