use axum::{
    extract::{ConnectInfo, Request, State},
    http::{HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

use crate::service::local_proxy::{is_peer_allowed, listen_ip};
use crate::service::proxy_settings_service::ProxySettingsService;

/// Setup / connect page server for mobile devices (Tailscale) and the Cloudflare tunnel.
pub const SETUP_SERVER_PORT: u16 = 13030;

/// Webview origins of this app. Pages here are opened by navigation, so no other origin needs CORS.
const APP_ORIGINS: [&str; 3] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];

pub struct TunnelService {
    pub child: Arc<Mutex<Option<Child>>>,
    pub axum_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

#[derive(Clone)]
struct AxumState {
    proxy_settings: Arc<ProxySettingsService>,
}

impl TunnelService {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            axum_handle: Arc::new(Mutex::new(None)),
        }
    }

    #[allow(clippy::unused_self)]
    pub fn get_tailscale_ip(&self) -> Option<String> {
        get_tailscale_ip()
    }

    /// Binds 127.0.0.1, or 0.0.0.0 with the proxy peer allowlist when remote access is enabled
    /// (Tailscale / LAN mobile devices). Applies on next serve start.
    pub async fn start_axum_server(
        &self,
        proxy_settings: Arc<ProxySettingsService>,
    ) -> Result<(), std::io::Error> {
        let mut axum_guard = self.axum_handle.lock().await;
        if axum_guard.is_some() {
            return Ok(()); // already running
        }

        let allow_remote_access = proxy_settings.get().allow_remote_access;
        let state = AxumState { proxy_settings };
        let cors = CorsLayer::new()
            .allow_origin(APP_ORIGINS.map(HeaderValue::from_static))
            .allow_methods([Method::GET]);
        let app = Router::new()
            .route("/api/ping", get(ping_handler))
            .route("/connect", get(connect_handler))
            .route("/setup", get(setup_handler))
            .layer(cors)
            .layer(middleware::from_fn_with_state(state.clone(), peer_guard))
            .with_state(state);

        let addr = SocketAddr::new(listen_ip(allow_remote_access), SETUP_SERVER_PORT);
        let listener = tokio::net::TcpListener::bind(addr).await?;
        tracing::info!("[serve] setup server on {}", listener.local_addr()?);

        let handle = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await;
        });

        *axum_guard = Some(handle);
        Ok(())
    }

    pub async fn start_tunnel(&self) -> Result<String, String> {
        let mut child_guard = self.child.lock().await;
        if child_guard.is_some() {
            return Err("Tunnel already running".to_string());
        }

        // Resolve cloudflared binary: check PATH first, then probe common install locations
        let binary_path = find_cloudflared_binary();

        // Spawn cloudflared
        let mut command = tokio::process::Command::new(&binary_path);
        let origin = format!("http://127.0.0.1:{SETUP_SERVER_PORT}");
        command.args(["tunnel", "--url", origin.as_str()]);
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        // For Windows, run silently without popping up console windows
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "cloudflared binary not found. Searched PATH and common install locations (tried: \"{binary_path}\"). Please install cloudflared first."
                )
            } else {
                format!("Failed to spawn cloudflared: {e}")
            }
        })?;

        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let mut url = None;
        let timeout_duration = std::time::Duration::from_secs(15);
        let timeout_fut = tokio::time::sleep(timeout_duration);
        tokio::pin!(timeout_fut);

        loop {
            tokio::select! {
                line_res = stdout_reader.next_line() => {
                    if let Ok(Some(line)) = line_res {
                        if let Some(parsed) = parse_cloudflare_url(&line) {
                            url = Some(parsed);
                            break;
                        }
                    } else {
                        break;
                    }
                }
                line_res = stderr_reader.next_line() => {
                    if let Ok(Some(line)) = line_res {
                        if let Some(parsed) = parse_cloudflare_url(&line) {
                            url = Some(parsed);
                            break;
                        }
                    } else {
                        break;
                    }
                }
                () = &mut timeout_fut => {
                    break;
                }
            }
        }

        if let Some(u) = url {
            *child_guard = Some(child);
            Ok(u)
        } else {
            let _ = child.kill().await;
            Err(
                "Failed to parse trycloudflare URL from cloudflared logs within 15 seconds."
                    .to_string(),
            )
        }
    }

    pub async fn stop_tunnel(&self) -> Result<(), String> {
        let mut child_guard = self.child.lock().await;
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill().await;
        }
        Ok(())
    }
}

/// Locate the `cloudflared` binary by searching PATH and common installation directories.
/// On Windows, GUI apps (like Tauri) often don't inherit the same PATH as terminal sessions,
/// so we probe well-known install locations (winget packages, Program Files, scoop, chocolatey, etc.).
fn find_cloudflared_binary() -> String {
    #[cfg(windows)]
    {
        use std::path::{Path, PathBuf};

        // 1. Check if it's directly available via PATH (works if the user's PATH is inherited)
        if which_exists("cloudflared.exe") {
            return "cloudflared".to_string();
        }

        // 2. Probe common Windows installation locations
        let mut candidates: Vec<PathBuf> = Vec::new();

        // winget packages directory (the most common case for this bug)
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let winget_packages = Path::new(&local_app_data).join("Microsoft\\WinGet\\Packages");
            if winget_packages.exists() {
                // Search for cloudflared.exe inside any matching package folder
                if let Ok(entries) = std::fs::read_dir(&winget_packages) {
                    for entry in entries.flatten() {
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy().to_lowercase();
                        if name_str.contains("cloudflare.cloudflared") {
                            let exe_path = entry.path().join("cloudflared.exe");
                            candidates.push(exe_path);
                        }
                    }
                }
            }

            // LOCALAPPDATA\cloudflared
            candidates.push(Path::new(&local_app_data).join("cloudflared\\cloudflared.exe"));

            // LOCALAPPDATA\Programs\cloudflared
            candidates
                .push(Path::new(&local_app_data).join("Programs\\cloudflared\\cloudflared.exe"));
        }

        // Program Files
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(Path::new(&pf).join("cloudflared\\cloudflared.exe"));
            candidates.push(Path::new(&pf).join("Cloudflare\\Cloudflare Tunnel\\cloudflared.exe"));
        }

        // Program Files (x86)
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(Path::new(&pf86).join("cloudflared\\cloudflared.exe"));
        }

        // Scoop
        if let Ok(home) = std::env::var("USERPROFILE") {
            candidates.push(Path::new(&home).join("scoop\\shims\\cloudflared.exe"));
            candidates
                .push(Path::new(&home).join("scoop\\apps\\cloudflared\\current\\cloudflared.exe"));
            // .cloudflared directory
            candidates.push(Path::new(&home).join(".cloudflared\\cloudflared.exe"));
        }

        // Chocolatey
        if let Ok(choco) = std::env::var("ChocolateyInstall") {
            candidates.push(Path::new(&choco).join("bin\\cloudflared.exe"));
        } else {
            candidates.push(PathBuf::from(
                "C:\\ProgramData\\chocolatey\\bin\\cloudflared.exe",
            ));
        }

        for candidate in &candidates {
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }

    // Fallback: rely on PATH (works on macOS/Linux, or if PATH is properly configured)
    "cloudflared".to_string()
}

/// Quick check: can we find the executable via PATH? (Windows-specific helper)
#[cfg(windows)]
fn which_exists(name: &str) -> bool {
    std::process::Command::new("where.exe")
        .arg(name)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn get_tailscale_ip() -> Option<String> {
    if let Ok(interfaces) = get_if_addrs::get_if_addrs() {
        for interface in interfaces {
            if !interface.is_loopback() {
                if let get_if_addrs::IfAddr::V4(v4_addr) = interface.addr {
                    let ip = v4_addr.ip.to_string();
                    if ip.starts_with("100.") {
                        return Some(ip);
                    }
                }
            }
        }
    }
    None
}

fn parse_cloudflare_url(line: &str) -> Option<String> {
    if let Some(start_idx) = line.find("https://") {
        let sub = &line[start_idx..];
        if let Some(end_idx) = sub.find(".trycloudflare.com") {
            return Some(sub[..end_idx + ".trycloudflare.com".len()].to_string());
        }
    }
    None
}

async fn ping_handler() -> impl IntoResponse {
    axum::Json(serde_json::json!({
        "app": "horizon_gateway_proxy",
        "status": "ok"
    }))
}

/// Same allowlist as the proxy listener (loopback always; LAN / Tailscale only when enabled).
async fn peer_guard(
    State(state): State<AxumState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    if is_peer_allowed(peer.ip(), state.proxy_settings.get().allow_remote_access) {
        next.run(req).await
    } else {
        StatusCode::FORBIDDEN.into_response()
    }
}

async fn connect_handler(State(state): State<AxumState>) -> impl IntoResponse {
    let tailscale_ip = get_tailscale_ip().unwrap_or_else(|| "127.0.0.1".to_string());

    let proxy_port = state.proxy_settings.get().proxy_port;

    let html = include_str!("../../resources/landing.html")
        .replace("{{TAILSCALE_IP}}", &tailscale_ip)
        .replace("{{PROXY_PORT}}", &proxy_port.to_string())
        .replace("{{AXUM_PORT}}", &SETUP_SERVER_PORT.to_string());

    Html(html)
}

/// Setup guide page: served over HTTP on the Tailscale IP (100.x.x.x:13030/setup).
/// If the mobile device can load this page, it proves VPN connectivity.
async fn setup_handler(State(state): State<AxumState>) -> impl IntoResponse {
    let tailscale_ip = get_tailscale_ip().unwrap_or_else(|| "127.0.0.1".to_string());

    let proxy_port = state.proxy_settings.get().proxy_port;

    let html = include_str!("../../resources/setup_guide.html")
        .replace("{{TAILSCALE_IP}}", &tailscale_ip)
        .replace("{{PROXY_PORT}}", &proxy_port.to_string());

    Html(html)
}
