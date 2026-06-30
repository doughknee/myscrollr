//! RSA-PSS request signing for the Kalshi Trade API.
//!
//! Copied (cross-crate, per repo convention) from
//! `channels/predictions/service/src/kalshi/sign.rs`. The desktop app signs
//! the *user's own* Kalshi requests locally so the private key never leaves
//! the machine — see `commands::kalshi`. Keep this in sync with the service
//! copy if the scheme ever changes.
//!
//! Kalshi signs `timestamp_ms + METHOD + path` with RSA-PSS (MGF1-SHA256,
//! salt length == digest length == 32) and base64-encodes the signature.
//! The same scheme authenticates the WebSocket upgrade (signing the WS path).
//!
//! The `rsa` crate's `pss::SigningKey::<Sha256>` defaults to MGF1-SHA256 and
//! salt_len == hash output length (32 bytes), which matches Kalshi's
//! `PSS.DIGEST_LENGTH` reference exactly. PSS is randomized, so the signature
//! differs on every call — that is expected; do not cache or compare them.

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs8::DecodePrivateKey;
use rsa::pss::SigningKey;
use rsa::signature::{RandomizedSigner, SignatureEncoding};
use rsa::RsaPrivateKey;
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

/// Holds the API key id + the loaded RSA-PSS signing key.
#[derive(Clone)]
pub struct Signer {
    key_id: String,
    signing_key: SigningKey<Sha256>,
}

impl Signer {
    /// Loads a signer from a PEM private key. Accepts both PKCS#1
    /// (`-----BEGIN RSA PRIVATE KEY-----`) and PKCS#8
    /// (`-----BEGIN PRIVATE KEY-----`) encodings — Kalshi hands out PKCS#1.
    pub fn from_pem(key_id: impl Into<String>, pem: &str) -> Result<Self> {
        let private_key = RsaPrivateKey::from_pkcs1_pem(pem)
            .or_else(|_| RsaPrivateKey::from_pkcs8_pem(pem))
            .context("parse RSA private key (tried PKCS#1 and PKCS#8 PEM)")?;
        Ok(Self {
            key_id: key_id.into(),
            signing_key: SigningKey::<Sha256>::new(private_key),
        })
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// Signs a request. `path` MUST include the `/trade-api/v2`
    /// (or `/trade-api/ws/v2`) prefix and MUST NOT include the query string.
    /// Returns `(timestamp_ms, signature_base64)` — the SAME timestamp string
    /// must be sent in the `KALSHI-ACCESS-TIMESTAMP` header.
    pub fn sign(&self, method: &str, path: &str) -> Result<(String, String)> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock before unix epoch")?
            .as_millis()
            .to_string();

        let message = format!("{timestamp}{method}{path}");
        let signature = self
            .signing_key
            .try_sign_with_rng(&mut rand::thread_rng(), message.as_bytes())
            .map_err(|e| anyhow::anyhow!("RSA-PSS sign failed: {e}"))?;

        Ok((timestamp, STANDARD.encode(signature.to_bytes())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::pkcs1::EncodeRsaPrivateKey;

    // Generate a throwaway key in-process (1024-bit for test speed — NOT a
    // real credential, never persisted) so the signing logic is exercised in
    // CI without any network, secret, or committed key material.
    fn test_pem() -> String {
        let key = RsaPrivateKey::new(&mut rand::thread_rng(), 1024).expect("gen test key");
        key.to_pkcs1_pem(rsa::pkcs1::LineEnding::LF)
            .expect("encode test key")
            .to_string()
    }

    #[test]
    fn loads_pkcs1_pem_and_signs() {
        let signer = Signer::from_pem("test-key-id", &test_pem()).expect("load key");
        assert_eq!(signer.key_id(), "test-key-id");
        let (ts, sig) = signer.sign("GET", "/trade-api/v2/portfolio/balance").expect("sign");
        assert!(ts.len() >= 13, "timestamp should be unix millis");
        assert!(!sig.is_empty(), "signature should be non-empty base64");
    }

    #[test]
    fn signatures_are_randomized() {
        let signer = Signer::from_pem("k", &test_pem()).expect("load key");
        let (_, a) = signer.sign("GET", "/trade-api/v2/portfolio/balance").unwrap();
        let (_, b) = signer.sign("GET", "/trade-api/v2/portfolio/balance").unwrap();
        // PSS uses a random salt — two signatures of the same message differ.
        assert_ne!(a, b, "RSA-PSS signatures must be randomized");
    }
}
