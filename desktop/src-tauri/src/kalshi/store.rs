//! On-device credential storage for the user's Kalshi key.
//!
//! The Key ID + RSA private key (PEM) are stored ONLY in the OS keychain
//! (Windows Credential Manager / macOS Keychain / Linux Secret Service) via the
//! `keyring` crate — encrypted at rest by the OS, never written to plaintext on
//! disk, never sent to Scrollr servers, never logged, never sent to Sentry.
//!
//! The credential is serialized to one JSON blob, then split across one or more
//! keychain entries (see `CHUNK_CHARS`) so the Key ID, environment, and PEM
//! never drift out of sync — while still fitting platform limits.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Keychain service name (the "target" on Windows Credential Manager).
const SERVICE: &str = "com.myscrollr.desktop.kalshi";
/// Meta entry: holds the chunk count and acts as the "connected" marker.
const META_ACCOUNT: &str = "kalshi-credential";

/// Max characters per keychain entry. Windows Credential Manager caps a single
/// credential blob at 2560 BYTES, and the keyring backend stores secrets as
/// UTF-16 (2 bytes/char) — so a 2048-bit RSA PEM (~1.7 KB) overflows one entry
/// and `CredWrite` fails. We split the serialized credential into chunks that
/// comfortably fit (1000 chars → ~2000 bytes UTF-16) under their own accounts,
/// with a small meta entry holding the count. macOS/Linux have no such limit
/// but chunk identically (just one or two entries) for a single code path.
const CHUNK_CHARS: usize = 1000;

/// The full credential as stored in the keychain. `pem` is the secret.
///
/// `Debug` is implemented manually to REDACT the PEM — so an accidental
/// `{:?}` (a log line, a `.unwrap()` panic, a Sentry capture) can never leak
/// the private key. Do not derive `Debug` here.
/// Older blobs also carried an `env: "prod" | "demo"` field; serde
/// ignores unknown fields on load, so pre-existing keychain entries
/// remain readable after the env plumbing was removed (prod-only).
#[derive(Serialize, Deserialize, Clone)]
pub struct StoredCredential {
    pub key_id: String,
    /// PEM-encoded RSA private key. SECRET — never log, never return to JS.
    pub pem: String,
}

impl std::fmt::Debug for StoredCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredCredential")
            .field("key_id", &self.key_id)
            .field("pem", &"<redacted>")
            .finish()
    }
}

/// Public, NON-SECRET view of the stored credential — safe to return to the
/// webview. Deliberately omits the PEM.
#[derive(Debug, Serialize, Clone)]
pub struct CredentialStatus {
    pub connected: bool,
    pub key_id: Option<String>,
}

impl CredentialStatus {
    pub fn disconnected() -> Self {
        CredentialStatus {
            connected: false,
            key_id: None,
        }
    }
}

fn entry(account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, account).context("open keychain entry")
}

fn chunk_account(i: usize) -> String {
    format!("{META_ACCOUNT}-{i}")
}

/// Persist the credential to the OS keychain (overwrites any prior one),
/// splitting it across chunk entries so it fits platform blob limits.
pub fn save(cred: &StoredCredential) -> Result<()> {
    let blob = serde_json::to_string(cred).context("serialize credential")?;
    // Chunk by chars (the blob is ASCII JSON+base64, but be boundary-safe).
    let chars: Vec<char> = blob.chars().collect();
    let chunks: Vec<String> = if chars.is_empty() {
        vec![String::new()]
    } else {
        chars.chunks(CHUNK_CHARS).map(|c| c.iter().collect()).collect()
    };
    let count = chunks.len();

    // Write the chunks first, then the meta marker — so a partial/failed write
    // never leaves a "connected" marker pointing at missing data.
    for (i, chunk) in chunks.iter().enumerate() {
        entry(&chunk_account(i))?
            .set_password(chunk)
            .with_context(|| format!("write credential chunk {i} to keychain"))?;
    }
    // Remove stale chunks left by a previously larger credential.
    let mut i = count;
    while let Ok(e) = entry(&chunk_account(i)) {
        match e.delete_credential() {
            Ok(()) => i += 1,
            _ => break,
        }
    }
    entry(META_ACCOUNT)?
        .set_password(&count.to_string())
        .context("write credential marker to keychain")?;
    Ok(())
}

/// Load the full credential (including the PEM) from the keychain, if present.
pub fn load() -> Result<Option<StoredCredential>> {
    let count_str = match entry(META_ACCOUNT)?.get_password() {
        Ok(s) => s,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(anyhow::anyhow!("read credential marker from keychain: {e}")),
    };
    let count: usize = count_str
        .trim()
        .parse()
        .context("parse credential chunk count")?;

    let mut blob = String::with_capacity(count * CHUNK_CHARS);
    for i in 0..count {
        let part = entry(&chunk_account(i))?
            .get_password()
            .with_context(|| format!("read credential chunk {i} from keychain"))?;
        blob.push_str(&part);
    }
    let cred: StoredCredential =
        serde_json::from_str(&blob).context("parse stored credential")?;
    Ok(Some(cred))
}

/// Non-secret connection status (no PEM).
pub fn status() -> Result<CredentialStatus> {
    Ok(match load()? {
        Some(cred) => CredentialStatus {
            connected: true,
            key_id: Some(cred.key_id),
        },
        None => CredentialStatus::disconnected(),
    })
}

/// Wipe the credential from the keychain. Idempotent — a missing entry is
/// treated as success (already disconnected). Removes every chunk plus the
/// marker, and sweeps a few extra chunk slots defensively.
pub fn delete() -> Result<()> {
    let count = match entry(META_ACCOUNT)?.get_password() {
        Ok(s) => s.trim().parse::<usize>().unwrap_or(0),
        _ => 0,
    };
    // Delete known chunks plus a small safety margin (in case the marker was
    // lost or undercounts).
    for i in 0..count + 4 {
        if let Ok(e) = entry(&chunk_account(i)) {
            let _ = e.delete_credential();
        }
    }
    match entry(META_ACCOUNT)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow::anyhow!("delete credential marker from keychain: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_redacts_the_pem() {
        let c = StoredCredential {
            key_id: "my-key-id".into(),
            pem: "-----BEGIN RSA PRIVATE KEY-----SECRETMATERIAL".into(),
        };
        let printed = format!("{c:?}");
        assert!(printed.contains("my-key-id"));
        assert!(printed.contains("<redacted>"));
        assert!(!printed.contains("SECRETMATERIAL"), "PEM must never appear in Debug");
    }

    #[test]
    fn serde_round_trip_preserves_fields() {
        let c = StoredCredential {
            key_id: "kid".into(),
            pem: "PEMDATA".into(),
        };
        let json = serde_json::to_string(&c).expect("serialize");
        let back: StoredCredential = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.key_id, "kid");
        assert_eq!(back.pem, "PEMDATA");
    }

    #[test]
    fn legacy_blob_with_env_field_still_loads() {
        // Pre-env-removal keychain blobs carried `"env":"prod"` — they
        // must keep deserializing after the field was dropped.
        let json = r#"{"key_id":"kid","env":"prod","pem":"PEMDATA"}"#;
        let back: StoredCredential = serde_json::from_str(json).expect("deserialize legacy blob");
        assert_eq!(back.key_id, "kid");
        assert_eq!(back.pem, "PEMDATA");
    }
}
