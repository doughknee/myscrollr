//! Explicit, release-pair-qualified recovery. Never a general downgrade comparator.
//! Adding a source version requires a signed installation rehearsal; see docs/beta-recovery.md.
use serde_json::Value;
use tauri::utils::{config::BundleType, platform::bundle_type};

pub fn policy() -> Value {
    serde_json::from_str(include_str!("stable-recovery.json")).expect("embedded recovery policy")
}

pub fn package_target() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH, bundle_type()) {
        ("windows", "x86_64", Some(BundleType::Nsis)) => Some("windows-x86_64-nsis"),
        ("macos", "aarch64", Some(BundleType::App | BundleType::Dmg)) => Some("darwin-aarch64"),
        ("linux", "x86_64", Some(BundleType::AppImage)) => Some("linux-x86_64"),
        _ => None, // MSI, DEB/RPM, unknown/dev hosts and other CPUs need their own qualification.
    }
}

pub fn accepts(source: &str, version: &str, target: &str) -> bool {
    let policy = policy();
    policy["sourceVersions"]
        .as_array()
        .is_some_and(|versions| versions.iter().any(|v| v == source))
        && policy["version"] == version
        && policy["platforms"].get(target).is_some()
}

pub fn matches_artifact(
    source: &str,
    version: &str,
    target: &str,
    url: &str,
    signature: &str,
) -> bool {
    let policy = policy();
    accepts(source, version, target)
        && policy["platforms"][target]["url"] == url
        && policy["platforms"][target]["signature"] == signature
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_qualified_pairs_and_signed_artifacts_are_accepted() {
        let p = policy();
        for source in ["1.8.0-beta.1", "1.8.0-beta.2", "1.8.0-beta.3"] {
            for target in ["windows-x86_64-nsis", "darwin-aarch64", "linux-x86_64"] {
                let artifact = &p["platforms"][target];
                assert!(matches_artifact(
                    source,
                    "1.7.3",
                    target,
                    artifact["url"].as_str().unwrap(),
                    artifact["signature"].as_str().unwrap()
                ));
                assert!(!matches_artifact(
                    source,
                    "1.7.3",
                    target,
                    "https://example.com/old.exe",
                    artifact["signature"].as_str().unwrap()
                ));
                assert!(!matches_artifact(
                    source,
                    "1.7.3",
                    target,
                    artifact["url"].as_str().unwrap(),
                    "different signed bytes"
                ));
            }
        }
        for (source, target) in [
            ("1.8.0", "1.7.3"),
            ("1.8.0-beta.4", "1.7.3"),
            ("1.8.0-beta.1", "1.7.2"),
            ("1.8.0-beta.1", "1.9.0"),
        ] {
            assert!(!accepts(source, target, "windows-x86_64-nsis"));
        }
        assert!(!accepts("1.8.0-beta.1", "1.7.3", "windows-x86_64-msi"));
    }
}
