//! Per-session IPC token. Serve writes it to `<app data>/serve.token` (owner-only) after
//! binding its sockets; GUI and CLI read it and send it with every request.
//!
//! The directory is [`crate::runtime::paths::resolve_app_data_dir`]. `HG_DATA_DIR` overrides
//! it for tests. When that variable is unset, the file is still
//! `<platform data dir>/<APP_IDENTIFIER>/serve.token`.

use std::path::PathBuf;

use rand::RngCore;

use crate::runtime::paths::resolve_app_data_dir;
use crate::runtime::private_file::write_private_file;

pub fn token_path() -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir()?.join(hg_core::SERVE_TOKEN_FILE))
}

/// 32 random bytes, hex encoded.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn publish_token(token: &str) -> Result<(), String> {
    let path = token_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    write_private_file(&path, token.as_bytes())
}

/// Token of the running serve, if readable.
pub fn read_token() -> Option<String> {
    let token = std::fs::read_to_string(token_path().ok()?).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_hex() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
