//! Windows perMachine NSIS updates need an elevated installer.
//! Stock tauri-plugin-updater launches with ShellExecute("open") and always
//! `process::exit(0)` without checking the result — so when elevation fails
//! (or UAC never appears), the app just dies and nothing installs.
//!
//! This command downloads via the updater plugin, writes a persistent setup.exe,
//! then ShellExecuteW("runas") so UAC is requested. On cancel/failure we return
//! an error instead of exiting, and restart serve if it was stopped.

use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub async fn install_windows_update(app: AppHandle) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("install_windows_update is only available on Windows".into())
    }

    #[cfg(windows)]
    {
        install_windows_update_inner(app).await
    }
}

#[cfg(windows)]
fn restart_serve_best_effort() {
    if let Err(e) = crate::serve::ensure_running() {
        tracing::warn!("[gui] failed to restart serve after update failure: {e}");
    }
}

#[cfg(windows)]
async fn install_windows_update_inner(app: AppHandle) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::time::Duration;
    use std::{fs, path::PathBuf};

    use tauri_plugin_updater::UpdaterExt;
    use windows_sys::w;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let updater = app.updater().map_err(|e| format!("updater: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("update check failed: {e}"))?
        .ok_or_else(|| "No update available".to_string())?;

    tracing::info!(
        "[gui] install_windows_update: downloading v{} from {}",
        update.version,
        update.download_url
    );

    let bytes = update
        .download(
            |chunk, total| {
                tracing::trace!(
                    "[gui] update download chunk={chunk} total={total:?}"
                );
            },
            || tracing::info!("[gui] update download finished"),
        )
        .await
        .map_err(|e| format!("update download failed: {e}"))?;

    if bytes.len() < 1024 {
        return Err(format!(
            "Downloaded update is too small ({} bytes)",
            bytes.len()
        ));
    }

    let dir = dirs::data_local_dir()
        .ok_or_else(|| "LOCALAPPDATA not found".to_string())?
        .join("com.lurain.horizon-gateway")
        .join("pending-update");
    fs::create_dir_all(&dir).map_err(|e| format!("create update dir: {e}"))?;

    let setup_path: PathBuf = dir.join(format!(
        "horizon-gateway_{}_x64-setup.exe",
        update.version
    ));
    fs::write(&setup_path, &bytes).map_err(|e| format!("write setup.exe: {e}"))?;
    tracing::info!(
        "[gui] install_windows_update: wrote {} ({} bytes)",
        setup_path.display(),
        bytes.len()
    );

    // Stop serve only after a good download, so UAC cancel / launch failure can recover.
    crate::serve::kill_serve_process();
    crate::serve::mark_inactive();
    for _ in 0..30 {
        if crate::serve::leftover_is_gone() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // Keep the file around for the elevated process (do not use tempfile Drop).
    let setup_wide: Vec<u16> = setup_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // Passive + updater mode + relaunch after install (same as updater installMode=passive).
    let params = to_wide("/P /UPDATE /R");

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            w!("runas"),
            setup_wide.as_ptr(),
            params.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    let code = result as isize;
    if code <= 32 {
        restart_serve_best_effort();
        let msg = match code {
            0 => "out of memory / resources",
            2 => "file not found",
            5 => "access denied or UAC cancelled",
            31 => "no association",
            32 => "DLL not found",
            _ => "unknown ShellExecute failure",
        };
        return Err(format!(
            "Failed to start elevated installer ({msg}, code {code}). Approve the UAC prompt, or install manually from GitHub Releases."
        ));
    }

    tracing::info!(
        "[gui] install_windows_update: elevated installer started (ShellExecute={code})"
    );
    // Allow UAC / installer to attach before this process disappears.
    std::thread::sleep(Duration::from_secs(2));
    std::process::exit(0);
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}
