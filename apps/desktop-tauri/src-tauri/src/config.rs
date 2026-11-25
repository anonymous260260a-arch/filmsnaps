use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("desktop config not found — expected filters.txt and providers.json in the bundle or the repo root")]
    Missing,
    #[error("failed to read {path}: {source}")]
    Read {
        path: String,
        source: std::io::Error,
    },
    #[error("providers.json does not match its Ed25519 signature — refusing to load a tampered config")]
    BadSignature,
    #[error("invalid config JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub struct AppConfig {
    pub config_dir: PathBuf,
    pub providers: serde_json::Value,
    pub filters_txt: String,
    pub signature_verified: bool,
}

impl AppConfig {
    pub fn provider_count(&self) -> usize {
        self.providers
            .get("providers")
            .and_then(|p| p.as_object())
            .map_or(0, |p| p.len())
    }
}

pub fn load(resource_dir: Option<PathBuf>) -> Result<AppConfig, ConfigError> {
    let dir = locate(resource_dir)?;
    let providers_bytes = read(&dir.join("providers.json"))?;
    let filters_txt = String::from_utf8_lossy(&read(&dir.join("filters.txt"))?).into_owned();
    let providers: serde_json::Value = serde_json::from_slice(&providers_bytes)?;
    let signature_verified = verify_signature(&dir, &providers_bytes)?;

    Ok(AppConfig {
        config_dir: dir,
        providers,
        filters_txt,
        signature_verified,
    })
}

fn locate(resource_dir: Option<PathBuf>) -> Result<PathBuf, ConfigError> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir);
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."));

    candidates
        .into_iter()
        .find(|dir| dir.join("filters.txt").is_file() && dir.join("providers.json").is_file())
        .ok_or(ConfigError::Missing)
}

fn read(path: &Path) -> Result<Vec<u8>, ConfigError> {
    fs::read(path).map_err(|source| ConfigError::Read {
        path: path.display().to_string(),
        source,
    })
}

/// Returns whether a signature was actually checked. A missing public key is not
/// fatal (dev checkouts may not carry `.keys/`), but a present key with a bad
/// signature is: shipping an unsigned config silently would defeat the point.
fn verify_signature(dir: &Path, providers_bytes: &[u8]) -> Result<bool, ConfigError> {
    let key_pem = read_if_present(&dir.join("filmsnaps-ed25519.pub"))
        .or_else(|| read_if_present(&dir.join(".keys/filmsnaps-ed25519.pub")));
    let Some(key_pem) = key_pem else {
        eprintln!("[config] no Ed25519 public key found — providers.json is NOT signature-verified");
        return Ok(false);
    };
    let Some(sig_b64) = read_if_present(&dir.join("providers.json.sig")) else {
        eprintln!("[config] providers.json.sig missing — config is NOT signature-verified");
        return Ok(false);
    };

    let key = VerifyingKey::from_bytes(&raw_public_key(&key_pem)?)
        .map_err(|_| ConfigError::BadSignature)?;
    let sig_text = String::from_utf8_lossy(&sig_b64);
    let sig_bytes = B64.decode(sig_text.trim()).map_err(|_| ConfigError::BadSignature)?;
    let signature = Signature::from_slice(&sig_bytes).map_err(|_| ConfigError::BadSignature)?;

    key.verify(providers_bytes, &signature)
        .map_err(|_| ConfigError::BadSignature)?;
    Ok(true)
}

fn read_if_present(path: &Path) -> Option<Vec<u8>> {
    fs::read(path).ok()
}

/// SPKI PEM for Ed25519 ends with the 32-byte raw key.
fn raw_public_key(pem: &[u8]) -> Result<[u8; 32], ConfigError> {
    let text = String::from_utf8_lossy(pem);
    let der_b64: String = text
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    let der = B64.decode(der_b64.trim()).map_err(|_| ConfigError::BadSignature)?;
    let key = der.get(der.len() - 32..).ok_or(ConfigError::BadSignature)?;
    key.try_into().map_err(|_| ConfigError::BadSignature)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_signature_from_a_different_key() {
        let dir = std::env::temp_dir().join("filmsnaps-sig-test");
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("providers.json"), br#"{"version":11}"#).unwrap();
        fs::write(dir.join("providers.json.sig"), "AAAA").unwrap();
        fs::write(
            dir.join("filmsnaps-ed25519.pub"),
            "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAuL54sRMa4NpYZnl4TiQgl4Dib93hrSrWxcvqQ78Sv+Y=\n-----END PUBLIC KEY-----\n",
        )
        .unwrap();

        let result = verify_signature(&dir, br#"{"version":11}"#);
        assert!(result.is_err(), "a bad signature must never be accepted");
    }

    #[test]
    fn raw_key_is_32_bytes() {
        let pem = b"-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAuL54sRMa4NpYZnl4TiQgl4Dib93hrSrWxcvqQ78Sv+Y=\n-----END PUBLIC KEY-----\n";
        assert_eq!(raw_public_key(pem).unwrap().len(), 32);
    }
}
