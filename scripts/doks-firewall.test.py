import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("firewall", Path(__file__).with_name("doks-firewall.py"))
fw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fw)


class FirewallTests(unittest.TestCase):
    def test_only_public_ipv4(self):
        self.assertEqual(fw.public_address("8.8.8.8\n"), "8.8.8.8/32")
        for address in ["0.0.0.0", "10.0.0.1", "169.254.169.254", "::1", "8.8.8.0/24", "garbage"]:
            with self.assertRaises(ValueError):
                fw.public_address(address)

    def test_preserves_other_rules_and_capacity(self):
        self.assertEqual(fw.change_addresses(["operator", "runner"], "runner", True), ["operator"])
        self.assertEqual(fw.change_addresses(["runner"], "runner"), ["runner"])
        with self.assertRaises(ValueError):
            fw.change_addresses([str(n) for n in range(500)], "runner")

    def exercise(self, enabled, preexisting=False, lost_response=False):
        rules = ["1.1.1.1/32"] + (["8.8.8.8/32"] if preexisting else [])
        current = {"enabled": enabled, "allowed_addresses": rules[:]}
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "lease.json"

            def api(cluster, body=None):
                if body:
                    self.assertTrue(state.exists())
                    current.update(body["control_plane_firewall"])
                    if lost_response and "8.8.8.8/32" in current["allowed_addresses"]:
                        raise TimeoutError()
                return {"control_plane_firewall": current.copy()}

            with patch.object(fw, "api", side_effect=api):
                if lost_response:
                    with self.assertRaises(TimeoutError):
                        fw.grant("cluster", state, "8.8.8.8/32")
                else:
                    fw.grant("cluster", state, "8.8.8.8/32")
                # Simulate an unrelated operator rule added while the deployment runs.
                current["allowed_addresses"].append("9.9.9.9/32")
                fw.revoke("cluster", state)
                self.assertEqual(current["allowed_addresses"], rules + ["9.9.9.9/32"])
                self.assertEqual(current["enabled"], enabled)
                self.assertFalse(state.exists())

    def test_grant_cleanup(self):
        self.exercise(True)

    def test_lost_response_still_cleans_up(self):
        self.exercise(True, lost_response=True)

    def test_preexisting_rule_not_removed(self):
        self.exercise(True, preexisting=True)

    def test_disabled_firewall_not_enabled_by_deploy(self):
        self.exercise(False)


if __name__ == "__main__":
    unittest.main()
