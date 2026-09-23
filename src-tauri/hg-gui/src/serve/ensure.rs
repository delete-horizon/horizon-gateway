use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use super::client;
use super::spawn;

static SERVE_ENSURED: AtomicBool = AtomicBool::new(false);

const SERVE_GONE_TIMEOUT: Duration = Duration::from_secs(5);
const SERVE_READY_ATTEMPTS: u32 = 25;
const PROXY_PORT_PROBE: &str = "0.0.0.0:8888";
const SERVE_IPC_PROBE: &str = "127.0.0.1:17345";

/// How the GUI should attach to hg-serve at process start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ServeEnsureMode {
    /// Installed/release app: reconnect so tray and proxy keep running.
    ReuseIfReachable,
    /// `tauri dev` / debug: kill leftover serve (frees 8888/17345) and spawn fresh.
    KillAndSpawnFresh,
}

/// Returns true once we've confirmed serve is running this session.
pub fn is_backend_active() -> bool {
    SERVE_ENSURED.load(Ordering::Relaxed)
}

pub fn mark_inactive() {
    SERVE_ENSURED.store(false, Ordering::Relaxed);
}

/// Companion / second GUI: never kill an existing serve (see `HG_SERVE_ATTACH_ONLY`).
pub(crate) fn serve_ensure_mode(
    debug_assertions: bool,
    tauri_env_debug: bool,
    attach_only: bool,
) -> ServeEnsureMode {
    if attach_only {
        return ServeEnsureMode::ReuseIfReachable;
    }
    if debug_assertions || tauri_env_debug {
        ServeEnsureMode::KillAndSpawnFresh
    } else {
        ServeEnsureMode::ReuseIfReachable
    }
}

pub(crate) fn is_env_truthy_value(value: &str) -> bool {
    matches!(value, "1" | "true" | "TRUE" | "yes" | "YES")
}

fn tauri_env_debug() -> bool {
    std::env::var("TAURI_ENV_DEBUG")
        .ok()
        .as_deref()
        .is_some_and(is_env_truthy_value)
}

/// When set, this process only attaches to (or spawns) serve — never kills leftovers.
/// Used by companion GUIs (workspace) that share Hub's serve.
pub(crate) fn serve_attach_only() -> bool {
    std::env::var("HG_SERVE_ATTACH_ONLY")
        .ok()
        .as_deref()
        .is_some_and(is_env_truthy_value)
}

/// Ensure the serve backend is reachable, spawning and waiting if needed.
/// Called once at GUI startup. On success, `events_client` will keep connectivity.
///
/// Debug / `tauri dev`: always reset leftover `horizon-gateway-serve` so ports like
/// 8888 are not held by a previous session — unless `HG_SERVE_ATTACH_ONLY` is set.
/// Release: reuse a reachable same-version serve.
pub fn ensure_running() -> Result<(), String> {
    let attach_only = serve_attach_only();
    match serve_ensure_mode(cfg!(debug_assertions), tauri_env_debug(), attach_only) {
        ServeEnsureMode::KillAndSpawnFresh => reset_and_spawn(),
        ServeEnsureMode::ReuseIfReachable => {
            if attach_only {
                attach_or_spawn_no_kill()
            } else {
                reuse_or_spawn()
            }
        }
    }
}

fn reuse_or_spawn() -> Result<(), String> {
    if client::ping().is_ok() {
        if client::serve_matches_gui_version() {
            SERVE_ENSURED.store(true, Ordering::Relaxed);
            return Ok(());
        }
        tracing::warn!(
            "[gui] serve is running but version != {}; restarting backend",
            env!("CARGO_PKG_VERSION")
        );
        kill_leftover_serve();
    }

    spawn_and_wait()
}

/// Companion path: never call kill. Attach if reachable (even on version mismatch);
/// otherwise spawn only.
fn attach_or_spawn_no_kill() -> Result<(), String> {
    if client::ping().is_ok() {
        if !client::serve_matches_gui_version() {
            tracing::warn!(
                "[gui] attach-only: serve version != {}; attaching without restart",
                env!("CARGO_PKG_VERSION")
            );
        } else {
            tracing::info!("[gui] attach-only: reusing reachable serve");
        }
        SERVE_ENSURED.store(true, Ordering::Relaxed);
        return Ok(());
    }

    tracing::info!("[gui] attach-only: no serve reachable; spawning without kill");
    if cfg!(debug_assertions) || tauri_env_debug() {
        spawn_and_wait_debug()
    } else {
        spawn_and_wait()
    }
}

fn reset_and_spawn() -> Result<(), String> {
    tracing::info!("[gui] debug session: resetting leftover horizon-gateway-serve before spawn");
    kill_leftover_serve();
    spawn_and_wait_debug()
}

fn kill_leftover_serve() {
    super::tray::kill_serve_process();
    if leftover_is_gone() || wait_until_leftover_gone(SERVE_GONE_TIMEOUT) {
        return;
    }
    tracing::warn!("[gui] leftover serve still holding IPC or 8888 after shutdown; retrying kill");
    super::tray::kill_serve_process();
    if !wait_until_leftover_gone(SERVE_GONE_TIMEOUT) {
        tracing::warn!(
            "[gui] leftover horizon-gateway-serve may still hold 8888/17345; spawn may fail to bind"
        );
    }
}

/// Ping-only is not enough: 17345 can be down while 8888 is still held by a leftover proxy.
pub fn leftover_is_gone() -> bool {
    client::ping().is_err()
        && tcp_addr_is_free(SERVE_IPC_PROBE)
        && tcp_addr_is_free(PROXY_PORT_PROBE)
}

pub(crate) fn tcp_addr_is_free(addr: &str) -> bool {
    std::net::TcpListener::bind(addr).is_ok()
}

fn wait_until_leftover_gone(timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if leftover_is_gone() {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn spawn_and_wait() -> Result<(), String> {
    spawn_and_wait_with(spawn::spawn_detached)
}

fn spawn_and_wait_debug() -> Result<(), String> {
    spawn_and_wait_with(spawn::spawn_detached_for_debug)
}

fn spawn_and_wait_with(spawn_fn: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    SERVE_ENSURED.store(false, Ordering::Relaxed);
    spawn_fn()?;

    for attempt in 0..SERVE_READY_ATTEMPTS {
        thread::sleep(Duration::from_millis(if attempt < 5 { 100 } else { 200 }));
        if client::ping().is_ok() {
            SERVE_ENSURED.store(true, Ordering::Relaxed);
            tracing::info!("[gui] serve backend ready after spawn");
            return Ok(());
        }
    }

    SERVE_ENSURED.store(false, Ordering::Relaxed);
    Err("horizon-gateway-serve did not become ready in time".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_profile_resets_serve() {
        assert_eq!(
            serve_ensure_mode(true, false, false),
            ServeEnsureMode::KillAndSpawnFresh
        );
    }

    #[test]
    fn tauri_dev_env_resets_serve_even_in_release_profile() {
        assert_eq!(
            serve_ensure_mode(false, true, false),
            ServeEnsureMode::KillAndSpawnFresh
        );
    }

    #[test]
    fn installed_release_reuses_serve() {
        assert_eq!(
            serve_ensure_mode(false, false, false),
            ServeEnsureMode::ReuseIfReachable
        );
    }

    #[test]
    fn attach_only_forces_reuse_even_in_debug() {
        assert_eq!(
            serve_ensure_mode(true, true, true),
            ServeEnsureMode::ReuseIfReachable
        );
        assert_eq!(
            serve_ensure_mode(true, false, true),
            ServeEnsureMode::ReuseIfReachable
        );
        assert_eq!(
            serve_ensure_mode(false, false, true),
            ServeEnsureMode::ReuseIfReachable
        );
    }

    #[test]
    fn tauri_env_debug_values() {
        assert!(is_env_truthy_value("true"));
        assert!(is_env_truthy_value("1"));
        assert!(is_env_truthy_value("YES"));
        assert!(!is_env_truthy_value("0"));
        assert!(!is_env_truthy_value("false"));
        assert!(!is_env_truthy_value(""));
    }

    #[test]
    fn serve_attach_only_reads_env() {
        let prev = std::env::var("HG_SERVE_ATTACH_ONLY").ok();
        std::env::remove_var("HG_SERVE_ATTACH_ONLY");
        assert!(!serve_attach_only());
        std::env::set_var("HG_SERVE_ATTACH_ONLY", "1");
        assert!(serve_attach_only());
        std::env::set_var("HG_SERVE_ATTACH_ONLY", "true");
        assert!(serve_attach_only());
        std::env::set_var("HG_SERVE_ATTACH_ONLY", "0");
        assert!(!serve_attach_only());
        match prev {
            Some(v) => std::env::set_var("HG_SERVE_ATTACH_ONLY", v),
            None => std::env::remove_var("HG_SERVE_ATTACH_ONLY"),
        }
    }

    #[test]
    fn tcp_addr_is_free_detects_bound_port() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        assert!(!tcp_addr_is_free(&addr));
        drop(listener);
        assert!(tcp_addr_is_free(&addr));
    }

    #[test]
    fn leftover_is_gone_requires_proxy_port_free() {
        // 17345 ping is already down in unit tests; occupying 8888 must still count as leftover.
        let Ok(_listener) = std::net::TcpListener::bind(PROXY_PORT_PROBE) else {
            return; // 8888 already taken on this machine; skip rather than flake
        };
        assert!(!tcp_addr_is_free(PROXY_PORT_PROBE));
        assert!(!leftover_is_gone());
    }
}
