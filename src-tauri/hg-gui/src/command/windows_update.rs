//! Windows perMachine NSIS updates need an elevated installer that outlives this process.
//!
//! Stock tauri-plugin-updater uses ShellExecute("open") and always `process::exit(0)`.
//! Exiting this process while the installer still shares our job (KILL_ON_JOB_CLOSE) kills
//! the setup before its window stays up — the user only sees a brief console flash from
//! the NSIS preinstall `taskkill` and no UAC / wizard.
//!
//! This command downloads via the updater plugin, stops companions that hold install
//! files, then starts the setup from an interactive scheduled task with `/UPDATE`
//! (tauri basicUi). `Shell.Application.ShellExecute` cannot be used here: it is in-proc,
//! returns void (so a `<= 32` check always fails), and the setup stays in this job.
//! NSIS then `taskkill`s this process and the job takes the installer with it.
//! A perMachine NSIS manifest raises UAC from the task, so the setup is neither our
//! child nor in our job. We do **not** call `process::exit`. UAC cancel or a dead
//! installer returns an error and restarts serve. A file log is always written under
//! `%LOCALAPPDATA%\com.lurain.horizon-gateway\update.log`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::AppHandle;

/// NSIS args for a visible update. Matches tauri-plugin-updater `basicUi`
/// (`nsis_args()` is empty) plus the `/UPDATE` flag the plugin always appends.
/// `/R` is ignored unless the installer is passive or silent.
const VISIBLE_NSIS_ARGS: &str = "/UPDATE";

/// How long the elevated setup must stay alive outside our tree before we trust it.
const INSTALLER_STABLE: Duration = Duration::from_secs(3);
const INSTALLER_WAIT: Duration = Duration::from_secs(180);

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
    use std::fs;

    use tauri_plugin_updater::UpdaterExt;

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
    update_log(&format!(
        "[gui] install_windows_update: downloading v{} from {}",
        update.version, update.download_url
    ));

    let bytes = update
        .download(
            |chunk, total| {
                tracing::trace!("[gui] update download chunk={chunk} total={total:?}");
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

    let setup_path: PathBuf = dir.join(format!("horizon-gateway_{}_x64-setup.exe", update.version));
    fs::write(&setup_path, &bytes).map_err(|e| format!("write setup.exe: {e}"))?;
    tracing::info!(
        "[gui] install_windows_update: wrote {} ({} bytes)",
        setup_path.display(),
        bytes.len()
    );
    update_log(&format!(
        "[gui] install_windows_update: wrote {} ({} bytes)",
        setup_path.display(),
        bytes.len()
    ));

    // Stop companions only after a good download, so a UAC cancel can bring serve back.
    update_log("[gui] install_windows_update: stopping companions before installer launch");
    stop_companions_for_update();

    let setup_for_launch = setup_path.clone();
    let launched =
        tokio::task::spawn_blocking(move || ensure_detached_installer(&setup_for_launch))
            .await
            .map_err(|e| format!("installer launch task failed: {e}"))?;

    match launched {
        Ok(()) => {
            update_log(
                "[gui] install_windows_update: detached installer is running; waiting for NSIS to stop this process",
            );
            tracing::info!(
                "[gui] install_windows_update: detached installer is running; waiting for NSIS to stop this process"
            );
            // Do not process::exit. Exiting tears down the job and can kill a setup that
            // still shares our lifetime. NSIS PREINSTALL taskkill's this image instead.
            Ok(())
        }
        Err(message) => {
            update_log(&format!("[gui] install_windows_update: failed: {message}"));
            restart_serve_best_effort();
            Err(message)
        }
    }
}

#[cfg(windows)]
fn update_log_path() -> Option<PathBuf> {
    Some(
        dirs::data_local_dir()?
            .join("com.lurain.horizon-gateway")
            .join("update.log"),
    )
}

#[cfg(windows)]
fn update_log(message: &str) {
    use std::fs::OpenOptions;
    use std::io::Write;

    tracing::info!("{message}");
    let Some(path) = update_log_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(
            file,
            "{} {message}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f")
        );
    }
}

#[cfg(windows)]
fn stop_companions_for_update() {
    crate::serve::kill_serve_process();
    crate::serve::mark_inactive();
    // Workspace and hgc hold binaries next to the GUI. The NSIS preinstall hook
    // kills them too, but a passive installer that dies first never gets there.
    hidden_command(
        "taskkill",
        &["/IM", "horizon-gateway-workspace.exe", "/F", "/T"],
    );
    hidden_command("taskkill", &["/IM", "hgc.exe", "/F", "/T"]);
    hidden_command("net", &["stop", "WinDivert"]);
    hidden_command("sc", &["stop", "WinDivert"]);

    for _ in 0..30 {
        let serve_gone = crate::serve::leftover_is_gone();
        let workspace_gone = !tasklist_contains("horizon-gateway-workspace");
        let hgc_gone = !tasklist_contains("hgc.exe");
        if serve_gone && workspace_gone && hgc_gone {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    tracing::warn!(
        "[gui] install_windows_update: a companion was still running after stop; the elevated installer will retry"
    );
}

#[cfg(windows)]
fn hidden_command(program: &str, args: &[&str]) {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(windows)]
fn tasklist_contains(needle: &str) -> bool {
    use std::process::Command;

    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output();
    let Ok(output) = output else {
        return false;
    };
    let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    if text.contains("no tasks") && !text.contains(needle) {
        return false;
    }
    text.contains(&needle.to_ascii_lowercase())
}

/// Start setup outside this process and its job. Returns after the installer has
/// stayed alive outside this process tree, or an error that must keep the app open.
#[cfg(windows)]
fn ensure_detached_installer(setup: &Path) -> Result<(), String> {
    let image = setup
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| fail(setup, "Setup path has no file name."))?;
    let our_pid = std::process::id();
    let consent_baseline = list_processes("consent.exe");
    let script = installer_launch_script(setup);
    update_log(&format!(
        "[gui] install_windows_update: launching {} via scheduled task",
        setup.display()
    ));
    let helper = run_powershell(&script, true).map_err(|e| fail(setup, &e))?;
    update_log(&format!(
        "[gui] install_windows_update: task helper pid={} exit={} stderr={}",
        helper.pid,
        helper.code,
        helper.stderr.trim()
    ));
    tracing::info!(
        "[gui] install_windows_update: task helper pid={} exit={}",
        helper.pid,
        helper.code
    );
    if helper.code != 0 {
        let detail = helper.stderr.trim();
        let message = if detail.is_empty() {
            format!("Could not start the installer task (exit {}).", helper.code)
        } else {
            format!(
                "Could not start the installer task (exit {}): {detail}",
                helper.code
            )
        };
        return Err(fail(setup, &message));
    }

    let started = std::time::Instant::now();
    let mut saw_consent = false;
    let mut stable_since: Option<std::time::Instant> = None;
    loop {
        if started.elapsed() > INSTALLER_WAIT {
            kill_installers_parented_by_us(image, our_pid);
            return Err(fail(
                setup,
                "The installer did not stay open. Approve the UAC prompt if it is still visible, or run the setup file.",
            ));
        }

        let rows = list_processes(image);
        if let Some((pid, ppid)) = rows
            .iter()
            .copied()
            .find(|(_, ppid)| is_outside_our_tree(our_pid, *ppid))
        {
            let since = stable_since.get_or_insert_with(std::time::Instant::now);
            if since.elapsed() >= INSTALLER_STABLE {
                update_log(&format!(
                    "[gui] install_windows_update: installer pid={pid} parent={ppid} stable for {}ms",
                    since.elapsed().as_millis()
                ));
                tracing::info!(
                    "[gui] install_windows_update: installer pid={pid} parent={ppid} is outside this process"
                );
                return Ok(());
            }
        } else {
            stable_since = None;
        }

        let fresh_consent = list_processes("consent.exe").into_iter().any(|(pid, _)| {
            !consent_baseline
                .iter()
                .any(|(baseline_pid, _)| *baseline_pid == pid)
        });
        if fresh_consent {
            saw_consent = true;
        } else if saw_consent {
            std::thread::sleep(Duration::from_secs(1));
            if list_processes(image).is_empty() {
                return Err(fail(
                    setup,
                    "UAC was cancelled. Approve the prompt to install the update.",
                ));
            }
            saw_consent = false;
        }

        std::thread::sleep(Duration::from_millis(400));
    }
}

#[cfg(windows)]
fn kill_installers_parented_by_us(image: &str, our_pid: u32) {
    for (pid, ppid) in list_processes(image) {
        if ppid == our_pid {
            tracing::warn!(
                "[gui] install_windows_update: killing installer pid={pid} still parented by this app"
            );
            let pid_text = pid.to_string();
            hidden_command("taskkill", &["/PID", &pid_text, "/F", "/T"]);
        }
    }
}

#[cfg(windows)]
struct PowershellOutput {
    code: i32,
    pid: u32,
    stderr: String,
}

#[cfg(windows)]
fn run_powershell(script: &str, breakaway: bool) -> Result<PowershellOutput, String> {
    match spawn_powershell(script, breakaway) {
        Ok(output) => Ok(output),
        Err(err) if breakaway && err.breakaway_denied => {
            tracing::warn!(
                "[gui] install_windows_update: job breakaway denied ({}); retrying helper in-job",
                err.message
            );
            spawn_powershell(script, false).map_err(|e| e.message)
        }
        Err(err) => Err(err.message),
    }
}

#[cfg(windows)]
struct SpawnError {
    breakaway_denied: bool,
    message: String,
}

#[cfg(windows)]
fn spawn_powershell(script: &str, breakaway: bool) -> Result<PowershellOutput, SpawnError> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    let mut flags = CREATE_NEW_PROCESS_GROUP;
    if breakaway {
        flags |= CREATE_BREAKAWAY_FROM_JOB;
    }

    let child = Command::new("powershell.exe")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(flags)
        .spawn()
        .map_err(|err| SpawnError {
            breakaway_denied: breakaway && err.raw_os_error() == Some(5),
            message: format!("failed to start powershell: {err}"),
        })?;
    let pid = child.id();
    let output = child.wait_with_output().map_err(|err| SpawnError {
        breakaway_denied: false,
        message: format!("powershell failed: {err}"),
    })?;
    Ok(PowershellOutput {
        code: output.status.code().unwrap_or(1),
        pid,
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

#[cfg(windows)]
fn list_processes(image: &str) -> Vec<(u32, u32)> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let script = process_rows_script(image);
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            "[gui] install_windows_update: process query failed: {}",
            stderr.trim()
        );
        return Vec::new();
    }
    parse_pid_pairs(&String::from_utf8_lossy(&output.stdout))
}

fn fail(setup: &Path, message: &str) -> String {
    format!("{message} Setup file: {}", setup.display())
}

fn ps_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Task name reused across attempts. No trigger, so it runs only when we start it.
const UPDATE_TASK_NAME: &str = "HorizonGatewayUpdate";

fn installer_launch_script(setup: &Path) -> String {
    let task = ps_literal(UPDATE_TASK_NAME);
    let file = ps_literal(&setup.to_string_lossy());
    let dir = ps_literal(&setup.parent().unwrap_or(Path::new(".")).to_string_lossy());
    let args = ps_literal(VISIBLE_NSIS_ARGS);
    // RunLevel Highest is access-denied for a standard user. Limited still shows UI,
    // and the perMachine installer manifest requests elevation, which breaks out of
    // this job. Unregister after Start; the task engine keeps the launch.
    format!(
        "$ErrorActionPreference='Stop'; $task={task}; Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue; $action=New-ScheduledTaskAction -Execute {file} -Argument {args} -WorkingDirectory {dir}; $principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited; Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Force | Out-Null; Start-ScheduledTask -TaskName $task; Unregister-ScheduledTask -TaskName $task -Confirm:$false"
    )
}

fn process_rows_script(image: &str) -> String {
    let name = image.replace('\'', "''");
    format!(
        "Get-CimInstance Win32_Process -Filter \"Name = '{name}'\" | ForEach-Object {{ '{{0}},{{1}}' -f $_.ProcessId, $_.ParentProcessId }}"
    )
}

/// True when the installer is not a direct child of this process.
///
/// The scheduled task parents setup under the task host, then UAC re-parents the
/// elevated process. Either parent is outside this job. A parent of this process
/// itself is still inside the tree and must not be treated as detached.
fn is_outside_our_tree(our_pid: u32, parent_pid: u32) -> bool {
    parent_pid != 0 && parent_pid != our_pid
}

fn parse_pid_pairs(stdout: &str) -> Vec<(u32, u32)> {
    stdout
        .lines()
        .filter_map(|line| {
            let (pid, parent) = line.trim().split_once(',')?;
            Some((pid.parse().ok()?, parent.parse().ok()?))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        installer_launch_script, is_outside_our_tree, parse_pid_pairs, process_rows_script,
        UPDATE_TASK_NAME, VISIBLE_NSIS_ARGS,
    };
    use std::path::Path;

    #[test]
    fn visible_update_args_skip_passive_and_silent() {
        assert_eq!(VISIBLE_NSIS_ARGS, "/UPDATE");
        assert!(!VISIBLE_NSIS_ARGS.contains("/P"));
        assert!(!VISIBLE_NSIS_ARGS.contains("/S"));
    }

    #[test]
    fn scheduled_task_script_launches_visible_update_outside_this_process() {
        let script = installer_launch_script(Path::new(
            r"C:\Users\me\AppData\Local\com.lurain.horizon-gateway\pending-update\horizon-gateway_2.8.9_x64-setup.exe",
        ));
        assert!(script.contains("Register-ScheduledTask"));
        assert!(script.contains("Start-ScheduledTask"));
        assert!(script.contains("RunLevel Limited"));
        assert!(script.contains(UPDATE_TASK_NAME));
        assert!(script.contains("'/UPDATE'"));
        assert!(!script.contains("Shell.Application"));
        assert!(!script.contains("ShellExecute"));
        assert!(!script.contains("/P"));
        assert!(!script.contains("/S"));
        assert!(script.contains("horizon-gateway_2.8.9_x64-setup.exe"));
    }

    #[test]
    fn installer_not_parented_by_us_is_outside_our_tree() {
        let our_pid = 100;
        assert!(is_outside_our_tree(our_pid, 4000));
        assert!(is_outside_our_tree(our_pid, 200));
        assert!(!is_outside_our_tree(our_pid, our_pid));
        assert!(!is_outside_our_tree(our_pid, 0));
    }

    #[test]
    fn process_query_parses_cim_rows() {
        let script = process_rows_script("horizon-gateway_2.8.9_x64-setup.exe");
        assert!(script.contains("Name = 'horizon-gateway_2.8.9_x64-setup.exe'"));
        assert!(script.contains("'{0},{1}' -f $_.ProcessId, $_.ParentProcessId"));
        let rows = parse_pid_pairs("4242,4\nnot-a-row\n9,100\n");
        assert_eq!(rows, vec![(4242, 4), (9, 100)]);
    }
}
