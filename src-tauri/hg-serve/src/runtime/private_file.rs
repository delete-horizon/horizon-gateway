//! Owner-only files for secrets (CA key, serve token).
//! Unix: mode 0600. Windows: files inherit the per-user app data dir ACL.

use std::fs;
use std::io::Write;
use std::path::Path;

/// Write `contents` to `path` readable by the owner only. Replaces the file atomically.
pub fn write_private_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let _ = fs::remove_file(&tmp);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&tmp)
        .map_err(|e| format!("create {}: {e}", tmp.display()))?;
    file.write_all(contents)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("write {}: {e}", tmp.display()))?;
    drop(file);
    restrict_permissions(&tmp)?;
    fs::rename(&tmp, path).map_err(|e| format!("rename to {}: {e}", path.display()))
}

/// Tighten an existing secret file to owner-only (installs from older versions used 0644).
#[allow(clippy::unnecessary_wraps)]
pub fn restrict_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = fs::metadata(path).map_err(|e| format!("stat {}: {e}", path.display()))?;
        if meta.permissions().mode() & 0o077 != 0 {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("chmod {}: {e}", path.display()))?;
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_replaces_contents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret");
        write_private_file(&path, b"one").unwrap();
        write_private_file(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        assert!(!path.with_extension("tmp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret");
        write_private_file(&path, b"x").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let loose = dir.path().join("loose");
        fs::write(&loose, b"x").unwrap();
        fs::set_permissions(&loose, fs::Permissions::from_mode(0o644)).unwrap();
        restrict_permissions(&loose).unwrap();
        assert_eq!(
            fs::metadata(&loose).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
