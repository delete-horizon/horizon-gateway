use std::path::{Path, PathBuf};

/// Resolve `horizon-gateway-serve.exe` next to the running binary (dev + release layouts).
pub fn serve_exe_path() -> Result<PathBuf, String> {
    sidecar_exe_path(
        "horizon-gateway-serve",
        "horizon-gateway-serve not found (build with `cargo build -p horizon-gateway-serve`)",
    )
}

/// Resolve `hgc` (asInvoker console CLI). Never the elevated serve binary.
pub fn hgc_exe_path() -> Result<PathBuf, String> {
    sidecar_exe_path("hgc", "hgc not found (build with `cargo build -p hgc`)")
}

pub fn workspace_exe_path() -> Result<PathBuf, String> {
    sidecar_exe_path(
        "horizon-gateway-workspace",
        "horizon-gateway-workspace not found (cargo build -p horizon-gateway --bin horizon-gateway-workspace)",
    )
}

/// Hub GUI (`horizon-gateway`), not the workspace or serve binaries that share the prefix.
pub fn hub_exe_path() -> Result<PathBuf, String> {
    find_sidecar(
        "horizon-gateway not found (cargo build -p horizon-gateway --bin horizon-gateway)",
        |dir, out| {
            out.push(dir.join("horizon-gateway.exe"));
            out.push(dir.join("horizon-gateway"));
        },
        is_hub_sidecar_name,
    )
}

fn is_hub_sidecar_name(file_name: &str) -> bool {
    let stem = file_name.strip_suffix(".exe").unwrap_or(file_name);
    if stem == "horizon-gateway" {
        return true;
    }
    let Some(rest) = stem.strip_prefix("horizon-gateway-") else {
        return false;
    };
    !rest.starts_with("workspace") && !rest.starts_with("serve")
}

fn sidecar_exe_path(bin_name: &str, missing: &str) -> Result<PathBuf, String> {
    let prefix = bin_name.to_string();
    find_sidecar(
        missing,
        move |dir, out| push_sidecar_candidates(out, dir, &prefix),
        move |name| name.starts_with(bin_name),
    )
}

fn find_sidecar(
    missing: &str,
    mut push_exact: impl FnMut(&Path, &mut Vec<PathBuf>),
    staging_name: impl Fn(&str) -> bool,
) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            push_exact(dir, &mut candidates);
            // `cargo run` / test binaries live under target/debug/deps/
            if dir.ends_with("deps") {
                if let Some(debug) = dir.parent() {
                    push_exact(debug, &mut candidates);
                }
            }
            // macOS app bundle: Contents/MacOS/../Resources
            if dir.ends_with("MacOS") {
                if let Some(contents) = dir.parent() {
                    push_exact(&contents.join("Resources"), &mut candidates);
                }
            }
        }
    }

    // Workspace target dir when invoked from hg-gui crate paths during dev.
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("target");
    push_exact(&workspace_root.join("debug"), &mut candidates);
    push_exact(&workspace_root.join("release"), &mut candidates);

    // Tauri externalBin staging (local `tauri build` / CI).
    let sidecar_staging = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if sidecar_staging.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&sidecar_staging) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file()
                    && path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(&staging_name)
                {
                    candidates.push(path);
                }
            }
        }
    }

    for path in candidates {
        if path.is_file() {
            return Ok(path);
        }
    }

    Err(missing.to_string())
}

/// Spawn the other GUI exe. A second launch hits single-instance and focuses that window.
pub fn spawn_gui_companion(exe: PathBuf, role: &str, args: &[String]) -> Result<(), String> {
    let mut cmd = std::process::Command::new(&exe);
    cmd.args(args);
    cmd.env("HG_SERVE_ATTACH_ONLY", "1");
    cmd.env("HG_GUI_ROLE", role);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", exe.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_hub_sidecar_name;

    #[test]
    fn hub_name_skips_workspace_and_serve() {
        assert!(is_hub_sidecar_name("horizon-gateway.exe"));
        assert!(is_hub_sidecar_name("horizon-gateway"));
        assert!(is_hub_sidecar_name(
            "horizon-gateway-x86_64-pc-windows-msvc.exe"
        ));
        assert!(!is_hub_sidecar_name("horizon-gateway-workspace.exe"));
        assert!(!is_hub_sidecar_name("horizon-gateway-serve.exe"));
        assert!(!is_hub_sidecar_name(
            "horizon-gateway-workspace-x86_64-pc-windows-msvc.exe"
        ));
    }
}

fn push_sidecar_candidates(out: &mut Vec<PathBuf>, dir: &Path, bin_name: &str) {
    out.push(dir.join(format!("{bin_name}.exe")));
    out.push(dir.join(bin_name));
}

/// Spawn the serve backend detached.
///
/// Release: elevate via UAC so system proxy / CA install keep working.
/// Debug / `tauri dev`: spawn unelevated so leftovers can be killed without UAC
/// and cannot pin 8888 at a higher integrity level.
pub fn spawn_detached() -> Result<(), String> {
    spawn_detached_elevated()
}

pub fn spawn_detached_for_debug() -> Result<(), String> {
    let exe = serve_exe_path()?;
    #[cfg(windows)]
    {
        spawn_unelevated_windows(&exe)
    }
    #[cfg(not(windows))]
    {
        spawn_std(&exe)
    }
}

pub fn spawn_detached_elevated() -> Result<(), String> {
    let exe = serve_exe_path()?;
    #[cfg(windows)]
    {
        spawn_elevated_windows(&exe)
    }
    #[cfg(not(windows))]
    {
        spawn_std(&exe)
    }
}

#[cfg(not(windows))]
fn spawn_std(exe: &Path) -> Result<(), String> {
    use std::process::{Command, Stdio};
    Command::new(exe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn horizon-gateway-serve: {e}"))?;
    Ok(())
}

#[cfg(windows)]
fn spawn_unelevated_windows(exe: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

    let mut cmd = Command::new(exe);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) if e.raw_os_error() == Some(740) => {
            tracing::warn!(
                "[gui] horizon-gateway-serve requires elevation (os 740); falling back to UAC spawn"
            );
            spawn_elevated_windows(exe)
        }
        Err(_) => match Command::new(exe)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()
        {
            Ok(_) => Ok(()),
            Err(e) if e.raw_os_error() == Some(740) => {
                tracing::warn!(
                    "[gui] horizon-gateway-serve requires elevation (os 740); falling back to UAC spawn"
                );
                spawn_elevated_windows(exe)
            }
            Err(e) => Err(format!("failed to spawn horizon-gateway-serve: {e}")),
        },
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn spawn_elevated_windows(exe: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    let exe_wide = wide(exe.as_os_str());
    let verb = wide(OsStr::new("runas"));
    let work_dir = exe.parent().map(|p| wide(p.as_os_str()));

    let result = unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            exe_wide.as_ptr(),
            std::ptr::null(),
            work_dir.as_ref().map_or(std::ptr::null(), Vec::as_ptr),
            windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE,
        )
    };

    // ShellExecuteW returns > 32 on success.
    if result as isize <= 32 {
        let code = result as i32;
        let hint = if code == 1223 {
            " (UAC prompt was cancelled)"
        } else if code == 740 {
            " (elevation required — retry and approve UAC)"
        } else {
            ""
        };
        return Err(format!(
            "failed to elevate horizon-gateway-serve via UAC (ShellExecute={code}){hint}"
        ));
    }

    Ok(())
}
