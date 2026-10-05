use std::path::PathBuf;

/// Must match `tauri.conf.json` identifier and `logs.mjs` app id.
pub const APP_IDENTIFIER: &str = hg_core::APP_IDENTIFIER;

/// Resolves the Horizon Gateway app data directory (same layout as Tauri `app_data_dir`).
pub fn resolve_app_data_dir() -> Result<PathBuf, String> {
    let base =
        dirs::data_dir().ok_or_else(|| "failed to resolve platform data directory".to_string())?;
    Ok(base.join(APP_IDENTIFIER))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_identifier_matches_bundle() {
        assert_eq!(APP_IDENTIFIER, "com.lurain.horizon-gateway");
    }

    #[test]
    fn resolve_app_data_dir_ends_with_identifier() {
        let dir = resolve_app_data_dir().expect("data dir");
        assert_eq!(
            dir.file_name().and_then(|n| n.to_str()),
            Some(APP_IDENTIFIER)
        );
    }
}
