use axum::{
    extract::{ConnectInfo, Request, State},
    http::{HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
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

    #[allow(clippy::unused_self)]
    pub fn remote_hosts(&self) -> RemoteHostSet {
        collect_remote_hosts()
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

/// Addresses a phone can use. Tailscale is optional; RFC1918 LAN addresses are separate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteHostSet {
    pub tailscale_ip: Option<String>,
    pub lan_ips: Vec<String>,
}

pub fn is_lan_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}

pub fn is_tailscale_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 100 && (64..=127).contains(&b)
}

pub fn collect_remote_hosts() -> RemoteHostSet {
    let mut lan_ips = Vec::new();
    let mut tailscale_ip = None;
    if let Ok(interfaces) = get_if_addrs::get_if_addrs() {
        for interface in interfaces {
            if interface.is_loopback() {
                continue;
            }
            let get_if_addrs::IfAddr::V4(v4) = interface.addr else {
                continue;
            };
            if is_tailscale_ipv4(v4.ip) {
                if tailscale_ip.is_none() {
                    tailscale_ip = Some(v4.ip.to_string());
                }
            } else if is_lan_ipv4(v4.ip) {
                let text = v4.ip.to_string();
                if !lan_ips.contains(&text) {
                    lan_ips.push(text);
                }
            }
        }
    }
    RemoteHostSet {
        tailscale_ip,
        lan_ips,
    }
}

pub fn get_tailscale_ip() -> Option<String> {
    collect_remote_hosts().tailscale_ip
}

fn host_without_port(host: &str) -> &str {
    let host = host.trim();
    if let Some(rest) = host.strip_prefix('[') {
        return rest.split(']').next().unwrap_or(rest);
    }
    match host.rsplit_once(':') {
        Some((name, port)) if !name.contains(':') && port.chars().all(|c| c.is_ascii_digit()) => {
            name
        }
        _ => host,
    }
}

fn usable_request_host(host: &str) -> bool {
    if host.is_empty()
        || host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "::1"
        || host == "0.0.0.0"
        || host.ends_with(".trycloudflare.com")
    {
        return false;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => is_lan_ipv4(v4) || is_tailscale_ipv4(v4),
        Ok(IpAddr::V6(v6)) => {
            let seg = v6.segments()[0];
            (seg & 0xfe00) == 0xfc00 || (seg & 0xffc0) == 0xfe80
        }
        Err(_) => true,
    }
}

/// Host written into the mobile setup page.
/// Remote access off (the default) always yields loopback, even if LAN or Tailscale addresses exist.
pub fn resolve_setup_host(
    host_header: Option<&str>,
    allow_remote: bool,
    hosts: &RemoteHostSet,
) -> String {
    if !allow_remote {
        return "127.0.0.1".to_string();
    }
    if let Some(raw) = host_header {
        let bare = host_without_port(raw);
        if usable_request_host(bare) {
            return bare.to_string();
        }
    }
    if let Some(ip) = &hosts.tailscale_ip {
        return ip.clone();
    }
    hosts
        .lan_ips
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

pub fn access_kind(host: &str, hosts: &RemoteHostSet) -> &'static str {
    if host == "127.0.0.1" || host.eq_ignore_ascii_case("localhost") {
        return "local";
    }
    if hosts.tailscale_ip.as_deref() == Some(host) {
        return "tailscale";
    }
    if hosts.lan_ips.iter().any(|ip| ip == host) {
        return "lan";
    }
    if host.parse::<Ipv4Addr>().is_ok_and(is_tailscale_ipv4) {
        return "tailscale";
    }
    if host.parse::<Ipv4Addr>().is_ok_and(is_lan_ipv4) {
        return "lan";
    }
    "remote"
}

/// Proxy host advertised in PAC. Loopback, or any request while remote access is off, stays on this computer.
pub fn proxy_advertise_host(
    request_host: &str,
    allow_remote: bool,
    hosts: &RemoteHostSet,
) -> String {
    let host = request_host.trim();
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "[::1]"
        || host == "::1";
    if loopback || !allow_remote {
        return "127.0.0.1".to_string();
    }
    if host.ends_with(".trycloudflare.com") || host == "0.0.0.0" || host.is_empty() {
        return resolve_setup_host(None, true, hosts);
    }
    host.to_string()
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

fn render_mobile_page(template: &str, host_header: Option<&str>, state: &AxumState) -> String {
    let settings = state.proxy_settings.get();
    let hosts = collect_remote_hosts();
    let reach = resolve_setup_host(host_header, settings.allow_remote_access, &hosts);
    let kind = access_kind(&reach, &hosts);
    template
        .replace("{{TAILSCALE_IP}}", &reach)
        .replace("{{REACH_HOST}}", &reach)
        .replace("{{ACCESS_KIND}}", kind)
        .replace(
            "{{REMOTE_ON}}",
            if settings.allow_remote_access {
                "1"
            } else {
                "0"
            },
        )
        .replace("{{PROXY_PORT}}", &settings.proxy_port.to_string())
        .replace("{{AXUM_PORT}}", &SETUP_SERVER_PORT.to_string())
}

async fn connect_handler(
    State(state): State<AxumState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok());
    Html(render_mobile_page(
        include_str!("../../resources/landing.html"),
        host,
        &state,
    ))
}

/// Setup guide. Reachable on the LAN or over Tailscale when remote access is enabled.
async fn setup_handler(
    State(state): State<AxumState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok());
    Html(render_mobile_page(
        include_str!("../../resources/setup_guide.html"),
        host,
        &state,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosts() -> RemoteHostSet {
        RemoteHostSet {
            tailscale_ip: Some("100.64.0.2".to_string()),
            lan_ips: vec!["192.168.1.20".to_string()],
        }
    }

    #[test]
    fn remote_access_off_stays_on_loopback() {
        let set = hosts();
        assert_eq!(
            resolve_setup_host(Some("192.168.1.20:13030"), false, &set),
            "127.0.0.1"
        );
        assert_eq!(
            proxy_advertise_host("192.168.1.20", false, &set),
            "127.0.0.1"
        );
        assert_eq!(proxy_advertise_host("100.64.0.2", false, &set), "127.0.0.1");
    }

    #[test]
    fn lan_host_is_kept_when_remote_access_is_on() {
        let set = hosts();
        assert_eq!(
            resolve_setup_host(Some("192.168.1.20:13030"), true, &set),
            "192.168.1.20"
        );
        assert_eq!(access_kind("192.168.1.20", &set), "lan");
        assert_eq!(
            proxy_advertise_host("192.168.1.20", true, &set),
            "192.168.1.20"
        );
    }

    #[test]
    fn tailscale_is_optional_fallback() {
        let set = hosts();
        assert_eq!(
            resolve_setup_host(Some("abc.trycloudflare.com"), true, &set),
            "100.64.0.2"
        );
        let lan_only = RemoteHostSet {
            tailscale_ip: None,
            lan_ips: vec!["10.0.0.8".to_string()],
        };
        assert_eq!(resolve_setup_host(None, true, &lan_only), "10.0.0.8");
        assert_eq!(proxy_advertise_host("", true, &lan_only), "10.0.0.8");
        assert!(is_lan_ipv4("10.1.2.3".parse().unwrap()));
        assert!(!is_lan_ipv4("100.64.0.1".parse().unwrap()));
        assert!(is_tailscale_ipv4("100.127.0.1".parse().unwrap()));
    }
}
