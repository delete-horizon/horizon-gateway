use std::ffi::OsString;
use std::path::PathBuf;

/// Must match `tauri.conf.json` identifier and `logs.mjs` app id.
pub const APP_IDENTIFIER: &str = hg_core::APP_IDENTIFIER;

/// Test/CI override for [`resolve_app_data_dir`].
///
/// Unset or empty: `dirs::data_dir()/APP_IDENTIFIER` (same path as before this variable existed).
/// Set to a non-empty path: that path is the app data directory, with no identifier appended.
pub const HG_DATA_DIR_ENV: &str = "HG_DATA_DIR";

/// Resolves the Horizon Gateway app data directory (same layout as Tauri `app_data_dir`).
pub fn resolve_app_data_dir() -> Result<PathBuf, String> {
    resolve_app_data_dir_from(std::env::var_os(HG_DATA_DIR_ENV), dirs::data_dir())
}

/// `true` when [`HG_DATA_DIR_ENV`] is set to a non-empty path.
pub(crate) fn app_data_dir_overridden() -> bool {
    app_data_dir_override(std::env::var_os(HG_DATA_DIR_ENV)).is_some()
}

fn resolve_app_data_dir_from(
    override_raw: Option<OsString>,
    platform_data_dir: Option<PathBuf>,
) -> Result<PathBuf, String> {
    if let Some(dir) = app_data_dir_override(override_raw) {
        return Ok(dir);
    }
    let base =
        platform_data_dir.ok_or_else(|| "failed to resolve platform data directory".to_string())?;
    Ok(base.join(APP_IDENTIFIER))
}

fn app_data_dir_override(override_raw: Option<OsString>) -> Option<PathBuf> {
    let raw = override_raw?;
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
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

    #[test]
    fn unset_override_matches_platform_data_dir_join() {
        let platform = PathBuf::from("/var/lib/hg-platform");
        let resolved =
            resolve_app_data_dir_from(None, Some(platform.clone())).expect("platform dir");
        assert_eq!(resolved, platform.join(APP_IDENTIFIER));
        assert_eq!(
            resolved.join(hg_core::SERVE_TOKEN_FILE),
            hg_core::serve_token_path(&platform)
        );
    }

    #[test]
    fn empty_override_matches_unset() {
        let platform = PathBuf::from("/var/lib/hg-platform");
        let unset = resolve_app_data_dir_from(None, Some(platform.clone())).expect("unset");
        let empty =
            resolve_app_data_dir_from(Some(OsString::new()), Some(platform)).expect("empty");
        assert_eq!(unset, empty);
    }

    #[test]
    fn override_is_the_app_data_dir_verbatim() {
        let platform = PathBuf::from("/var/lib/hg-platform");
        let custom = PathBuf::from("/tmp/hg-isolated");
        let resolved =
            resolve_app_data_dir_from(Some(custom.as_os_str().to_os_string()), Some(platform))
                .expect("override");
        assert_eq!(resolved, custom);
        assert_ne!(
            resolved.file_name().and_then(|name| name.to_str()),
            Some(APP_IDENTIFIER)
        );
    }

    #[test]
    fn missing_platform_dir_errors_when_override_unset() {
        let err = resolve_app_data_dir_from(None, None).expect_err("missing platform dir");
        assert_eq!(err, "failed to resolve platform data directory");
    }
}
