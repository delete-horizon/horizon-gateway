//! Opt-in remote attach for the control socket.
//!
//! Off by default: the control and event sockets bind loopback and accept the
//! local `serve.token` in plaintext, same as before.
//!
//! When enabled (`--remote-attach`, `HG_SERVE_REMOTE_ATTACH=1`, or
//! `remote-attach.json`), non-loopback peers must complete TLS before any
//! token or command is read. The remote token is a different file from the
//! local token. The certificate is self-signed; clients pin its SHA-256
//! fingerprint with `--tls-fingerprint`. Bind to a Tailscale or LAN address
//! with `--remote-bind`, `HG_SERVE_REMOTE_BIND`, or the config `bind` field.
//! An unset address falls back to `0.0.0.0` and logs a warning.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

use base64::Engine;
use hg_core::serve_token_matches;
use rand::RngCore;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, ServerConfig, SignatureScheme};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::runtime::private_file::{restrict_permissions, write_private_file};

pub const ENV_REMOTE_ATTACH: &str = "HG_SERVE_REMOTE_ATTACH";
pub const ENV_REMOTE_SCOPE: &str = "HG_SERVE_REMOTE_SCOPE";
pub const ENV_REMOTE_BIND: &str = "HG_SERVE_REMOTE_BIND";
pub const ENV_ATTACH: &str = "HG_SERVE_ATTACH";
pub const ENV_REMOTE_TOKEN: &str = "HG_SERVE_REMOTE_TOKEN";
pub const ENV_TLS_FINGERPRINT: &str = "HG_SERVE_TLS_FINGERPRINT";

pub const REMOTE_TOKEN_FILE: &str = "serve.remote.token";
pub const REMOTE_CONFIG_FILE: &str = "remote-attach.json";
pub const REMOTE_CERT_FILE: &str = "remote-attach.crt";
pub const REMOTE_KEY_FILE: &str = "remote-attach.key";
pub const REMOTE_PINS_FILE: &str = "remote-attach-pins.json";

pub const TLS_REQUIRED: &str = "remote attach requires TLS";
pub const UNAUTHORIZED: &str = "unauthorized: missing or invalid serve token";
pub const LOCKED: &str = "unauthorized: remote authentication temporarily locked";
pub const FORBIDDEN: &str = "forbidden: remote token scope does not allow this command";

const MAX_FAILURES: u32 = 5;
const FAILURE_WINDOW: Duration = Duration::from_secs(60);
const LOCKOUT: Duration = Duration::from_secs(5 * 60);
const LOCKOUT_MAP_CAP: usize = 4096;

static GLOBAL: OnceLock<Arc<RemoteAttach>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ingress {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteScope {
    Edit,
    Admin,
}

impl RemoteScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::Edit => "edit",
            Self::Admin => "admin",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthFailure {
    Rejected,
    Locked,
}

pub struct AttachSources<'a> {
    pub cli_enabled: bool,
    pub cli_scope: Option<&'a str>,
    pub cli_bind: Option<&'a str>,
    pub env_attach: Option<&'a str>,
    pub env_scope: Option<&'a str>,
    pub env_bind: Option<&'a str>,
    pub file_enabled: bool,
    pub file_scope: Option<&'a str>,
    pub file_bind: Option<&'a str>,
}

impl Default for AttachSources<'static> {
    fn default() -> Self {
        Self {
            cli_enabled: false,
            cli_scope: None,
            cli_bind: None,
            env_attach: None,
            env_scope: None,
            env_bind: None,
            file_enabled: false,
            file_scope: None,
            file_bind: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAttachConfig {
    pub enabled: bool,
    pub scope: RemoteScope,
    /// Set address, or `None` to fall back to all IPv4 interfaces.
    pub bind: Option<IpAddr>,
}

impl RemoteAttachConfig {
    pub fn resolve(sources: &AttachSources<'_>) -> Result<Self, String> {
        let enabled =
            sources.cli_enabled || env_flag_on(sources.env_attach) || sources.file_enabled;
        let scope = if let Some(raw) = sources.cli_scope {
            parse_scope(raw)?
        } else if let Some(raw) = sources.env_scope.filter(|value| !value.trim().is_empty()) {
            parse_scope(raw)?
        } else if let Some(raw) = sources.file_scope.filter(|value| !value.trim().is_empty()) {
            parse_scope(raw)?
        } else {
            RemoteScope::Edit
        };
        let bind = match first_nonempty([sources.cli_bind, sources.env_bind, sources.file_bind]) {
            Some(raw) => Some(parse_bind(raw)?),
            None => None,
        };
        Ok(Self {
            enabled,
            scope,
            bind,
        })
    }

    pub fn from_process(args: &[String], data_dir: &Path) -> Result<Self, String> {
        let file = read_file_config(data_dir)?;
        let env_attach = std::env::var(ENV_REMOTE_ATTACH).ok();
        let env_scope = std::env::var(ENV_REMOTE_SCOPE).ok();
        let env_bind = std::env::var(ENV_REMOTE_BIND).ok();
        let cli_scope = cli_scope_arg(args);
        let cli_bind = cli_bind_arg(args)?;
        Self::resolve(&AttachSources {
            cli_enabled: args.iter().any(|arg| arg == "--remote-attach"),
            cli_scope: cli_scope.as_deref(),
            cli_bind: cli_bind.as_deref(),
            env_attach: env_attach.as_deref(),
            env_scope: env_scope.as_deref(),
            env_bind: env_bind.as_deref(),
            file_enabled: file.as_ref().is_some_and(|parsed| parsed.enabled),
            file_scope: file.as_ref().and_then(|parsed| parsed.scope.as_deref()),
            file_bind: file.as_ref().and_then(|parsed| parsed.bind.as_deref()),
        })
    }

    /// Address passed to the remote listener. Unset means `0.0.0.0`.
    pub fn listen_ip(&self) -> IpAddr {
        self.bind.unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
    }
}

#[derive(Clone, Copy)]
pub struct LockoutPolicy {
    pub max_failures: u32,
    pub window: Duration,
    pub lockout: Duration,
}

impl LockoutPolicy {
    fn production() -> Self {
        Self {
            max_failures: MAX_FAILURES,
            window: FAILURE_WINDOW,
            lockout: LOCKOUT,
        }
    }
}

#[derive(Default)]
struct FailState {
    times: Vec<Instant>,
    locked_until: Option<Instant>,
}

struct Lockout {
    policy: LockoutPolicy,
    by_ip: Mutex<HashMap<IpAddr, FailState>>,
}

impl Lockout {
    fn new(policy: LockoutPolicy) -> Self {
        Self {
            policy,
            by_ip: Mutex::new(HashMap::new()),
        }
    }

    fn is_locked(&self, ip: IpAddr) -> bool {
        let map = self.by_ip.lock().unwrap_or_else(|err| err.into_inner());
        map.get(&ip)
            .and_then(|state| state.locked_until)
            .is_some_and(|until| Instant::now() < until)
    }

    /// Record a wrong token. Returns whether this IP is now locked.
    fn record_failure(&self, ip: IpAddr) -> bool {
        let mut map = self.by_ip.lock().unwrap_or_else(|err| err.into_inner());
        if map.len() >= LOCKOUT_MAP_CAP {
            let now = Instant::now();
            map.retain(|_, state| {
                state.locked_until.is_some_and(|until| until > now) || !state.times.is_empty()
            });
        }
        let state = map.entry(ip).or_default();
        let now = Instant::now();
        state
            .times
            .retain(|seen| now.saturating_duration_since(*seen) < self.policy.window);
        state.times.push(now);
        if state.times.len() as u32 >= self.policy.max_failures {
            state.locked_until = Some(now + self.policy.lockout);
            true
        } else {
            false
        }
    }

    fn clear(&self, ip: IpAddr) {
        let mut map = self.by_ip.lock().unwrap_or_else(|err| err.into_inner());
        map.remove(&ip);
    }
}

struct Secret {
    token: String,
    generation: u64,
}

struct LiveSession {
    id: u64,
    killer: TcpStream,
}

struct TlsMaterial {
    config: Arc<ServerConfig>,
    fingerprint: String,
}

pub struct RemoteAttach {
    enabled: bool,
    scope: RemoteScope,
    bind: IpAddr,
    data_dir: PathBuf,
    local_token: String,
    secret: RwLock<Secret>,
    tls: Option<TlsMaterial>,
    lockout: Lockout,
    live: Mutex<Vec<LiveSession>>,
    next_live: AtomicU64,
    command_port: Mutex<Option<u16>>,
    event_port: Mutex<Option<u16>>,
}

impl RemoteAttach {
    pub fn disabled() -> Arc<Self> {
        Arc::new(Self {
            enabled: false,
            scope: RemoteScope::Edit,
            bind: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            data_dir: PathBuf::new(),
            local_token: String::new(),
            secret: RwLock::new(Secret {
                token: String::new(),
                generation: 0,
            }),
            tls: None,
            lockout: Lockout::new(LockoutPolicy::production()),
            live: Mutex::new(Vec::new()),
            next_live: AtomicU64::new(1),
            command_port: Mutex::new(None),
            event_port: Mutex::new(None),
        })
    }

    pub fn bootstrap(
        data_dir: &Path,
        config: &RemoteAttachConfig,
        local_token: &str,
    ) -> Result<Arc<Self>, String> {
        if !config.enabled {
            return Ok(Self::disabled());
        }
        std::fs::create_dir_all(data_dir)
            .map_err(|err| format!("create {}: {err}", data_dir.display()))?;
        let token = load_or_create_remote_token(data_dir, local_token)?;
        let tls = load_or_create_identity(data_dir)?;
        Ok(Arc::new(Self {
            enabled: true,
            scope: config.scope,
            bind: config.listen_ip(),
            data_dir: data_dir.to_path_buf(),
            local_token: local_token.to_string(),
            secret: RwLock::new(Secret {
                token,
                generation: 1,
            }),
            tls: Some(tls),
            lockout: Lockout::new(LockoutPolicy::production()),
            live: Mutex::new(Vec::new()),
            next_live: AtomicU64::new(1),
            command_port: Mutex::new(None),
            event_port: Mutex::new(None),
        }))
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        data_dir: &Path,
        local_token: &str,
        scope: RemoteScope,
        policy: LockoutPolicy,
    ) -> Result<Arc<Self>, String> {
        let mut state = Arc::try_unwrap(Self::bootstrap(
            data_dir,
            &RemoteAttachConfig {
                enabled: true,
                scope,
                bind: None,
            },
            local_token,
        )?)
        .map_err(|_| "remote attach state was shared unexpectedly".to_string())?;
        state.lockout = Lockout::new(policy);
        Ok(Arc::new(state))
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// Remote listen address when attach is on. `None` keeps the socket on loopback.
    pub fn listen_ip(&self) -> Option<IpAddr> {
        self.enabled.then_some(self.bind)
    }

    pub fn scope(&self) -> RemoteScope {
        self.scope
    }

    pub fn scope_name(&self) -> &'static str {
        self.scope.as_str()
    }

    pub fn fingerprint(&self) -> Option<&str> {
        self.tls.as_ref().map(|tls| tls.fingerprint.as_str())
    }

    pub fn note_ports(&self, command: u16, event: u16) {
        *self
            .command_port
            .lock()
            .unwrap_or_else(|err| err.into_inner()) = Some(command);
        *self
            .event_port
            .lock()
            .unwrap_or_else(|err| err.into_inner()) = Some(event);
    }

    pub fn token_matches(&self, provided: Option<&str>) -> Option<u64> {
        let Some(provided) = provided else {
            return None;
        };
        let guard = self.secret.read().unwrap_or_else(|err| err.into_inner());
        if constant_time_token_eq(&guard.token, provided) {
            Some(guard.generation)
        } else {
            None
        }
    }

    pub fn generation(&self) -> u64 {
        self.secret
            .read()
            .unwrap_or_else(|err| err.into_inner())
            .generation
    }

    pub fn current_token(&self) -> String {
        self.secret
            .read()
            .unwrap_or_else(|err| err.into_inner())
            .token
            .clone()
    }

    /// Check the per-IP lock before reading a command. A locked IP is rejected
    /// even when the presented token is correct.
    pub fn begin_auth(&self, ip: IpAddr) -> Result<(), AuthFailure> {
        if self.lockout.is_locked(ip) {
            Err(AuthFailure::Locked)
        } else {
            Ok(())
        }
    }

    pub fn finish_auth(&self, ip: IpAddr, provided: Option<&str>) -> Result<u64, AuthFailure> {
        if self.lockout.is_locked(ip) {
            return Err(AuthFailure::Locked);
        }
        if let Some(generation) = self.token_matches(provided) {
            if self.generation() == generation {
                self.lockout.clear(ip);
                return Ok(generation);
            }
        }
        if self.lockout.record_failure(ip) || self.lockout.is_locked(ip) {
            Err(AuthFailure::Locked)
        } else {
            Err(AuthFailure::Rejected)
        }
    }

    pub fn register_live(&self, killer: TcpStream) -> u64 {
        let id = self.next_live.fetch_add(1, Ordering::Relaxed);
        self.live
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .push(LiveSession { id, killer });
        id
    }

    pub fn unregister_live(&self, id: u64) {
        self.live
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .retain(|live| live.id != id);
    }

    pub fn reissue(&self) -> Result<(), String> {
        if !self.enabled {
            return Err("remote attach is disabled".to_string());
        }
        let previous = self.current_token();
        let token = generate_distinct(&[self.local_token.as_str(), previous.as_str()])?;
        let path = self.data_dir.join(REMOTE_TOKEN_FILE);
        write_private_file(&path, token.as_bytes())?;
        {
            let mut guard = self.secret.write().unwrap_or_else(|err| err.into_inner());
            guard.token = token;
            guard.generation = guard.generation.wrapping_add(1);
        }
        self.kill_live_sessions();
        Ok(())
    }

    fn kill_live_sessions(&self) {
        let mut live = self.live.lock().unwrap_or_else(|err| err.into_inner());
        for session in live.drain(..) {
            let _ = session.killer.shutdown(Shutdown::Both);
        }
    }

    pub fn accept_tls(
        &self,
        stream: TcpStream,
    ) -> Result<rustls::StreamOwned<rustls::ServerConnection, TcpStream>, String> {
        let tls = self.tls.as_ref().ok_or(TLS_REQUIRED)?;
        let conn =
            rustls::ServerConnection::new(Arc::clone(&tls.config)).map_err(|_| TLS_REQUIRED)?;
        Ok(rustls::StreamOwned::new(conn, stream))
    }

    pub fn status(&self) -> Value {
        if !self.enabled {
            return json!({ "enabled": false });
        }
        json!({
            "enabled": true,
            "scope": self.scope.as_str(),
            "tls": "required",
            "fingerprint": self.fingerprint(),
            "bind": self.bind.to_string(),
            "commandPort": *self.command_port.lock().unwrap_or_else(|err| err.into_inner()),
            "eventPort": *self.event_port.lock().unwrap_or_else(|err| err.into_inner()),
        })
    }

    pub fn redact(&self, message: &str) -> String {
        let remote = self.current_token();
        redact_text(message, &[remote.as_str(), self.local_token.as_str()])
    }
}

pub fn install_global(state: Arc<RemoteAttach>) {
    let _ = GLOBAL.set(state);
}

pub fn status_json() -> Value {
    GLOBAL
        .get()
        .map(|state| state.status())
        .unwrap_or_else(|| json!({ "enabled": false }))
}

pub fn reissue_global() -> Result<(), String> {
    let state = GLOBAL.get().ok_or_else(|| {
        "remote attach state is not available; start horizon-gateway-serve".to_string()
    })?;
    state.reissue()
}

pub const GET_REMOTE_ATTACH_STATUS_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "get_remote_attach_status",
        description: "원격 attach 사용 여부, 권한 범위, TLS 인증서 지문을 반환합니다. 토큰은 포함하지 않습니다.",
        payload_example: "{}",
        category: "serve",
        gui_only: false,
    };

pub const REISSUE_REMOTE_TOKEN_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "reissue_remote_token",
    description: "원격 attach 토큰을 재발급합니다. 이전 토큰은 열린 원격 세션을 포함해 즉시 무효가 됩니다. 새 토큰은 데이터 디렉터리에만 기록되며 응답과 로그에 나오지 않습니다.",
    payload_example: "{}",
    category: "serve",
    gui_only: false,
};

pub fn ingress_for(peer: IpAddr, remote_enabled: bool) -> Ingress {
    if remote_enabled && !is_loopback_ip(peer) {
        Ingress::Remote
    } else {
        Ingress::Local
    }
}

fn is_loopback_ip(peer: IpAddr) -> bool {
    match peer {
        IpAddr::V4(ip) => ip.is_loopback(),
        IpAddr::V6(ip) => {
            ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
    }
}

pub fn authorize(
    ingress: Ingress,
    local_token: &str,
    remote: &RemoteAttach,
    peer: IpAddr,
    provided: Option<&str>,
) -> Result<Option<u64>, AuthFailure> {
    match ingress {
        Ingress::Local => {
            if serve_token_matches(local_token, provided) {
                Ok(None)
            } else {
                Err(AuthFailure::Rejected)
            }
        }
        Ingress::Remote => {
            remote.begin_auth(peer)?;
            Ok(Some(remote.finish_auth(peer, provided)?))
        }
    }
}

/// Default remote scope is read-only plus mock and route edits.
/// Privileged host and token commands need `admin` or `full`.
pub fn command_allowed(scope: RemoteScope, command: &str, payload: &Value) -> bool {
    if scope == RemoteScope::Admin {
        return true;
    }
    if is_privileged(command, payload) {
        return false;
    }
    if READ_PREFIXES
        .iter()
        .any(|prefix| command.starts_with(prefix))
    {
        return true;
    }
    EDIT_COMMANDS.binary_search(&command).is_ok()
}

const READ_PREFIXES: &[&str] = &["check_", "get_", "list_", "search_"];

/// Sorted for `binary_search`.
const EDIT_COMMANDS: &[&str] = &[
    "add_local_route",
    "create_mock_rule",
    "create_mock_rule_from_log",
    "create_scenario",
    "delete_mock_rule",
    "delete_scenario",
    "download_api_schema",
    "ping",
    "remove_local_route",
    "set_local_route_enabled",
    "set_scenario_enabled",
    "update_local_route",
    "update_mock_rule",
    "update_scenario",
];

fn is_privileged(command: &str, payload: &Value) -> bool {
    const NAMES: &[&str] = &[
        "clear_system_pac",
        "reissue_remote_token",
        "set_system_pac",
        "shutdown_serve",
        "start_local_proxy",
        "start_transparent_proxy",
        "stop_local_proxy",
        "stop_transparent_proxy",
        "update_proxy_settings",
    ];
    if NAMES.binary_search(&command).is_ok() {
        return true;
    }
    if command == "update_proxy_settings" {
        return payload.get("allowRemoteAccess").is_some()
            || payload.get("allow_remote_access").is_some();
    }
    false
}

pub fn redact_text(message: &str, secrets: &[&str]) -> String {
    let mut out = message.to_string();
    for secret in secrets {
        if secret.len() < 8 {
            continue;
        }
        if out.contains(secret) {
            out = out.replace(secret, "[redacted]");
        }
    }
    out
}

fn constant_time_token_eq(expected: &str, provided: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let left = Sha256::digest(expected.as_bytes());
    let right = Sha256::digest(provided.as_bytes());
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn env_flag_on(value: Option<&str>) -> bool {
    matches!(
        value.map(|raw| raw.trim().to_ascii_lowercase()).as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

fn parse_scope(raw: &str) -> Result<RemoteScope, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "edit" => Ok(RemoteScope::Edit),
        "admin" | "full" => Ok(RemoteScope::Admin),
        other => Err(format!(
            "unknown remote attach scope '{other}' (expected edit, admin, or full)"
        )),
    }
}

fn cli_scope_arg(args: &[String]) -> Option<String> {
    let index = args.iter().position(|arg| arg == "--remote-scope")?;
    args.get(index + 1)
        .filter(|value| !value.starts_with("--"))
        .cloned()
}

fn cli_bind_arg(args: &[String]) -> Result<Option<String>, String> {
    for (index, arg) in args.iter().enumerate() {
        if let Some(value) = arg.strip_prefix("--remote-bind=") {
            if value.trim().is_empty() {
                return Err("--remote-bind requires an IP address".to_string());
            }
            return Ok(Some(value.to_string()));
        }
        if arg == "--remote-bind" {
            let Some(value) = args.get(index + 1).filter(|value| !value.starts_with("--")) else {
                return Err("--remote-bind requires an IP address".to_string());
            };
            return Ok(Some(value.clone()));
        }
    }
    Ok(None)
}

fn first_nonempty<'a>(values: [Option<&'a str>; 3]) -> Option<&'a str> {
    values
        .into_iter()
        .flatten()
        .find(|value| !value.trim().is_empty())
}

fn parse_bind(raw: &str) -> Result<IpAddr, String> {
    let trimmed = raw.trim();
    trimmed.parse::<IpAddr>().map_err(|_| {
        format!(
            "invalid remote bind address '{trimmed}' (expected an IP, such as a Tailscale or LAN address)"
        )
    })
}

/// Warning logged when remote attach listens on every interface.
pub fn all_interfaces_warning(ip: IpAddr) -> Option<String> {
    if !ip.is_unspecified() {
        return None;
    }
    Some(format!(
        "[serve] remote attach is bound to all interfaces ({ip}). Set --remote-bind, {ENV_REMOTE_BIND}, or remote-attach.json bind to a Tailscale or LAN address, and pin --tls-fingerprint."
    ))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileConfig {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    bind: Option<String>,
}

fn read_file_config(data_dir: &Path) -> Result<Option<FileConfig>, String> {
    let path = data_dir.join(REMOTE_CONFIG_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let text =
        std::fs::read_to_string(&path).map_err(|err| format!("read {}: {err}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|err| format!("invalid {}: {err}", path.display()))
}

pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn generate_distinct(avoid: &[&str]) -> Result<String, String> {
    for _ in 0..8 {
        let token = generate_token();
        if !avoid.iter().any(|existing| *existing == token) {
            return Ok(token);
        }
    }
    Err("failed to generate a distinct remote token".to_string())
}

fn load_or_create_remote_token(dir: &Path, local_token: &str) -> Result<String, String> {
    let path = dir.join(REMOTE_TOKEN_FILE);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim().to_string();
        if existing.len() >= 32 && existing != local_token {
            restrict_permissions(&path)?;
            return Ok(existing);
        }
    }
    let token = generate_distinct(&[local_token])?;
    write_private_file(&path, token.as_bytes())?;
    Ok(token)
}

struct FingerprintVerifier {
    expected: Option<String>,
    seen: Mutex<Option<String>>,
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl FingerprintVerifier {
    fn new(expected: Option<String>) -> Self {
        Self {
            expected,
            seen: Mutex::new(None),
            provider: Arc::new(rustls::crypto::ring::default_provider()),
        }
    }

    fn seen(&self) -> Option<String> {
        self.seen
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clone()
    }
}

impl std::fmt::Debug for FingerprintVerifier {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FingerprintVerifier")
            .finish_non_exhaustive()
    }
}

impl ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let fingerprint = cert_fingerprint(end_entity.as_ref());
        if let Some(expected) = &self.expected {
            if !fingerprint_matches(expected, &fingerprint) {
                return Err(rustls::Error::General(
                    "tls certificate fingerprint mismatch".into(),
                ));
            }
        }
        *self.seen.lock().unwrap_or_else(|err| err.into_inner()) = Some(fingerprint);
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub fn cert_fingerprint(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}

pub fn normalize_fingerprint(raw: &str) -> String {
    let stripped = raw
        .trim()
        .trim_start_matches("sha256:")
        .trim_start_matches("SHA256:");
    stripped
        .chars()
        .filter(|ch| *ch != ':' && !ch.is_whitespace())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn fingerprint_matches(expected: &str, actual: &str) -> bool {
    let expected = normalize_fingerprint(expected);
    let actual = normalize_fingerprint(actual);
    if expected.is_empty() || expected.len() != actual.len() {
        return false;
    }
    constant_time_token_eq(&expected, &actual)
}

fn ensure_rustls() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn load_or_create_identity(dir: &Path) -> Result<TlsMaterial, String> {
    let cert_path = dir.join(REMOTE_CERT_FILE);
    let key_path = dir.join(REMOTE_KEY_FILE);
    if cert_path.is_file() && key_path.is_file() {
        let cert_pem = std::fs::read_to_string(&cert_path)
            .map_err(|err| format!("read {}: {err}", cert_path.display()))?;
        let key_pem = std::fs::read_to_string(&key_path)
            .map_err(|err| format!("read {}: {err}", key_path.display()))?;
        restrict_permissions(&key_path)?;
        if let Ok(material) = identity_from_pem(&cert_pem, &key_pem) {
            return Ok(material);
        }
    }
    let (cert_pem, key_pem, material) = generate_identity()?;
    write_private_file(&cert_path, cert_pem.as_bytes())?;
    write_private_file(&key_path, key_pem.as_bytes())?;
    Ok(material)
}

fn generate_identity() -> Result<(String, String, TlsMaterial), String> {
    ensure_rustls();
    let key_pair = rcgen::KeyPair::generate().map_err(|err| format!("remote tls key: {err}"))?;
    let mut params = rcgen::CertificateParams::new(vec!["horizon-gateway".to_string()])
        .map_err(|err| format!("remote tls name: {err}"))?;
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "Horizon Gateway Remote Attach");
    params.is_ca = rcgen::IsCa::ExplicitNoCa;
    params
        .key_usages
        .push(rcgen::KeyUsagePurpose::DigitalSignature);
    params
        .extended_key_usages
        .push(rcgen::ExtendedKeyUsagePurpose::ServerAuth);
    let cert = params
        .self_signed(&key_pair)
        .map_err(|err| format!("remote tls cert: {err}"))?;
    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();
    let material = identity_from_pem(&cert_pem, &key_pem)?;
    Ok((cert_pem, key_pem, material))
}

fn identity_from_pem(cert_pem: &str, key_pem: &str) -> Result<TlsMaterial, String> {
    ensure_rustls();
    let cert_der = pem_body(cert_pem, "CERTIFICATE")?;
    let key_der = pem_body(key_pem, "PRIVATE KEY")?;
    let fingerprint = cert_fingerprint(&cert_der);
    let cert = CertificateDer::from(cert_der);
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_der));
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .map_err(|_| "remote tls identity rejected".to_string())?;
    Ok(TlsMaterial {
        config: Arc::new(config),
        fingerprint,
    })
}

fn pem_body(pem: &str, label: &str) -> Result<Vec<u8>, String> {
    let begin = format!("-----BEGIN {label}-----");
    let end = format!("-----END {label}-----");
    let start = pem
        .find(&begin)
        .ok_or_else(|| format!("missing PEM header for {label}"))?
        + begin.len();
    let stop = pem[start..]
        .find(&end)
        .ok_or_else(|| format!("missing PEM footer for {label}"))?
        + start;
    let b64: String = pem[start..stop]
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect();
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| format!("invalid PEM body for {label}"))
}

pub struct RemoteEndpoint {
    pub addr: SocketAddr,
    pub pin_key: String,
    pub token: String,
    pub fingerprint: Option<String>,
    pub pins_path: PathBuf,
}

pub fn call_remote(
    endpoint: &RemoteEndpoint,
    command: &str,
    payload: Value,
) -> Result<Value, String> {
    let request =
        hg_core::ServeRequest::new(command, payload).with_token(Some(endpoint.token.clone()));
    let mut tls = connect_tls(endpoint)?;
    let mut line =
        serde_json::to_string(&request).map_err(|_| "encode serve request".to_string())?;
    line.push('\n');
    tls.write_all(line.as_bytes())
        .map_err(|_| "remote attach write failed".to_string())?;
    tls.flush()
        .map_err(|_| "remote attach write failed".to_string())?;
    let mut buf = Vec::new();
    read_one_line(&mut tls, &mut buf).map_err(|_| "remote attach read failed".to_string())?;
    if buf.is_empty() {
        return Err("remote attach closed the connection".to_string());
    }
    let text = String::from_utf8(buf).map_err(|_| "invalid serve response".to_string())?;
    let response: hg_core::ServeResponse =
        serde_json::from_str(text.trim()).map_err(|_| "invalid serve response".to_string())?;
    if response.ok {
        response
            .data
            .ok_or_else(|| "serve returned empty data".to_string())
    } else {
        let err = response
            .error
            .unwrap_or_else(|| "serve command failed".to_string());
        Err(redact_text(&err, &[endpoint.token.as_str()]))
    }
}

pub(crate) fn connect_tls(
    endpoint: &RemoteEndpoint,
) -> Result<rustls::StreamOwned<rustls::ClientConnection, TcpStream>, String> {
    ensure_rustls();
    let explicit = endpoint
        .fingerprint
        .clone()
        .map(|value| normalize_fingerprint(&value))
        .filter(|value| !value.is_empty());
    let stored = if explicit.is_some() {
        None
    } else {
        load_pin(&endpoint.pins_path, &endpoint.pin_key)
    };
    let expected = explicit.clone().or(stored.clone());
    let verifier = Arc::new(FingerprintVerifier::new(expected.clone()));
    let config = ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::clone(&verifier) as Arc<dyn ServerCertVerifier>)
        .with_no_client_auth();
    let name = server_name(&endpoint.pin_key, endpoint.addr);
    let connection = rustls::ClientConnection::new(Arc::new(config), name)
        .map_err(|_| "remote attach TLS setup failed".to_string())?;
    let stream = TcpStream::connect_timeout(&endpoint.addr, Duration::from_secs(5))
        .map_err(|_| format!("failed to connect to {}", endpoint.pin_key))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|err| format!("set_read_timeout: {err}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|err| format!("set_write_timeout: {err}"))?;
    let mut tls = rustls::StreamOwned::new(connection, stream);
    // Finish the handshake before the caller writes the token.
    tls.flush()
        .map_err(|_| tls_handshake_error(expected.as_deref(), verifier.seen().as_deref()))?;
    let seen = verifier.seen().ok_or(TLS_REQUIRED)?;
    if expected.is_none() {
        save_pin(&endpoint.pins_path, &endpoint.pin_key, &seen)?;
    }
    Ok(tls)
}

fn tls_handshake_error(expected: Option<&str>, seen: Option<&str>) -> String {
    match (expected, seen) {
        (Some(expected), Some(seen)) if !fingerprint_matches(expected, seen) => {
            format!("tls certificate fingerprint mismatch (expected {expected}, got {seen})")
        }
        _ => "tls certificate fingerprint mismatch or handshake failed".to_string(),
    }
}

fn server_name(pin_key: &str, addr: SocketAddr) -> ServerName<'static> {
    let host = pin_key
        .rsplit_once(':')
        .map(|(host, _)| host.trim_matches(|ch| ch == '[' || ch == ']'))
        .unwrap_or(pin_key);
    if let Ok(ip) = host.parse::<IpAddr>() {
        return ServerName::IpAddress(ip.into());
    }
    ServerName::try_from(host.to_string())
        .unwrap_or_else(|_| ServerName::IpAddress(addr.ip().into()))
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct PinFile {
    pins: HashMap<String, String>,
}

fn load_pin(path: &Path, key: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let file: PinFile = serde_json::from_str(&text).ok()?;
    file.pins.get(key).map(|value| normalize_fingerprint(value))
}

fn save_pin(path: &Path, key: &str, fingerprint: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| format!("create {}: {err}", dir.display()))?;
    }
    let mut file = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<PinFile>(&text).ok())
        .unwrap_or_default();
    file.pins
        .insert(key.to_string(), normalize_fingerprint(fingerprint));
    let json = serde_json::to_vec(&file).map_err(|_| "encode fingerprint pin".to_string())?;
    write_private_file(path, &json)
}

pub fn read_one_line(reader: &mut impl Read, buf: &mut Vec<u8>) -> Result<(), std::io::Error> {
    buf.clear();
    let mut byte = [0u8; 1];
    loop {
        if reader.read(&mut byte)? == 0 {
            return Ok(());
        }
        buf.push(byte[0]);
        if byte[0] == b'\n' {
            return Ok(());
        }
        if buf.len() > 1_048_576 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request too large",
            ));
        }
    }
}

#[derive(Default)]
pub struct ClientAttachOpts {
    pub attach: Option<String>,
    pub token: Option<String>,
    pub token_file: Option<String>,
    pub fingerprint: Option<String>,
}

pub fn extract_client_flags(args: &[String]) -> Result<(Vec<String>, ClientAttachOpts), String> {
    let mut rest = Vec::new();
    let mut opts = ClientAttachOpts::default();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if let Some((flag, slot)) = attach_flag(arg) {
            let value = args
                .get(index + 1)
                .filter(|value| !value.starts_with("--"))
                .cloned()
                .ok_or_else(|| format!("{flag} requires a value"))?;
            *slot(&mut opts) = Some(value);
            index += 2;
            continue;
        }
        if let Some(value) = arg.strip_prefix("--attach=") {
            opts.attach = Some(value.to_string());
            index += 1;
            continue;
        }
        rest.push(arg.clone());
        index += 1;
    }
    Ok((rest, opts))
}

fn attach_flag(
    arg: &str,
) -> Option<(
    &'static str,
    fn(&mut ClientAttachOpts) -> &mut Option<String>,
)> {
    match arg {
        "--attach" => Some(("--attach", |opts| &mut opts.attach)),
        "--remote-token" => Some(("--remote-token", |opts| &mut opts.token)),
        "--remote-token-file" => Some(("--remote-token-file", |opts| &mut opts.token_file)),
        "--tls-fingerprint" => Some(("--tls-fingerprint", |opts| &mut opts.fingerprint)),
        _ => None,
    }
}

pub fn resolve_client_token(opts: &ClientAttachOpts) -> Result<String, String> {
    if let Some(token) = opts
        .token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        return Ok(token.to_string());
    }
    if let Some(path) = &opts.token_file {
        let token = std::fs::read_to_string(path)
            .map_err(|_| "failed to read remote token file".to_string())?;
        let token = token.trim();
        if token.is_empty() {
            return Err("remote token file is empty".to_string());
        }
        return Ok(token.to_string());
    }
    if let Ok(token) = std::env::var(ENV_REMOTE_TOKEN) {
        let token = token.trim();
        if !token.is_empty() {
            return Ok(token.to_string());
        }
    }
    Err("remote attach requires a token (--remote-token, --remote-token-file, or HG_SERVE_REMOTE_TOKEN)".to_string())
}

pub fn client_endpoint(
    opts: &ClientAttachOpts,
    pins_path: PathBuf,
) -> Result<RemoteEndpoint, String> {
    let raw = opts
        .attach
        .clone()
        .or_else(|| std::env::var(ENV_ATTACH).ok())
        .ok_or_else(|| "missing attach address".to_string())?;
    let addr = parse_attach_addr(&raw)?;
    Ok(RemoteEndpoint {
        addr,
        pin_key: raw,
        token: resolve_client_token(opts)?,
        fingerprint: opts
            .fingerprint
            .clone()
            .or_else(|| std::env::var(ENV_TLS_FINGERPRINT).ok()),
        pins_path,
    })
}

pub fn parse_attach_addr(raw: &str) -> Result<SocketAddr, String> {
    if let Ok(addr) = raw.parse::<SocketAddr>() {
        return Ok(addr);
    }
    let (host, port) = raw
        .rsplit_once(':')
        .ok_or_else(|| format!("invalid attach address {raw} (expected host:port)"))?;
    let port: u16 = port
        .parse()
        .map_err(|_| format!("invalid attach port in {raw}"))?;
    let host = host.trim_matches(|ch| ch == '[' || ch == ']');
    use std::net::ToSocketAddrs;
    (host, port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .ok_or_else(|| format!("failed to resolve {raw}"))
}

pub(crate) fn bind_remote(ip: IpAddr, preferred: u16) -> Result<TcpListener, String> {
    let preferred_addr = SocketAddr::new(ip, preferred);
    match TcpListener::bind(preferred_addr) {
        Ok(listener) => Ok(listener),
        Err(err) => {
            tracing::warn!(
                "[serve] {preferred_addr} unavailable ({err}); binding an ephemeral port on {ip}"
            );
            let fallback = SocketAddr::new(ip, 0);
            TcpListener::bind(fallback).map_err(|bind_err| {
                format!("failed to bind remote serve socket {fallback}: {bind_err}")
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn sources(enabled: bool) -> AttachSources<'static> {
        AttachSources {
            cli_enabled: enabled,
            ..AttachSources::default()
        }
    }

    #[test]
    fn remote_attach_is_off_unless_requested() {
        let config = RemoteAttachConfig::resolve(&AttachSources::default()).unwrap();
        assert!(!config.enabled);
        assert_eq!(config.scope, RemoteScope::Edit);
        assert!(config.bind.is_none());
        assert!(!env_flag_on(Some("0")));
        assert!(!env_flag_on(Some("false")));
        assert!(env_flag_on(Some("1")));
        assert!(env_flag_on(Some("true")));
    }

    #[test]
    fn config_env_and_cli_enable_without_touching_proxy_remote_access() {
        let cli = RemoteAttachConfig::resolve(&sources(true)).unwrap();
        assert!(cli.enabled);
        assert_eq!(cli.scope, RemoteScope::Edit);

        let mut env_sources = AttachSources::default();
        env_sources.env_attach = Some("1");
        env_sources.env_scope = Some("full");
        let env = RemoteAttachConfig::resolve(&env_sources).unwrap();
        assert!(env.enabled);
        assert_eq!(env.scope, RemoteScope::Admin);

        let mut file_sources = AttachSources::default();
        file_sources.file_enabled = true;
        file_sources.file_scope = Some("edit");
        let file = RemoteAttachConfig::resolve(&file_sources).unwrap();
        assert!(file.enabled);
        assert_eq!(file.scope, RemoteScope::Edit);

        let mut unknown = AttachSources::default();
        unknown.cli_scope = Some("owner");
        assert!(RemoteAttachConfig::resolve(&unknown).is_err());

        let settings = hg_core::model::proxy_settings::ProxySettings::default();
        assert!(!settings.allow_remote_access);
        assert!(cli.enabled);
    }

    #[test]
    fn cli_scope_outranks_env_and_file() {
        let mut sources = AttachSources::default();
        sources.cli_enabled = true;
        sources.cli_scope = Some("edit");
        sources.env_scope = Some("admin");
        sources.file_scope = Some("full");
        let config = RemoteAttachConfig::resolve(&sources).unwrap();
        assert_eq!(config.scope, RemoteScope::Edit);
    }

    #[test]
    fn bind_address_prefers_cli_then_env_then_file() {
        let mut sources = AttachSources::default();
        sources.file_bind = Some("192.168.1.20");
        sources.env_bind = Some("100.64.0.8");
        sources.cli_bind = Some("100.64.0.2");
        let cli = RemoteAttachConfig::resolve(&sources).unwrap();
        assert_eq!(cli.listen_ip(), IpAddr::V4(Ipv4Addr::new(100, 64, 0, 2)));

        sources.cli_bind = None;
        let env = RemoteAttachConfig::resolve(&sources).unwrap();
        assert_eq!(env.listen_ip(), IpAddr::V4(Ipv4Addr::new(100, 64, 0, 8)));

        sources.env_bind = Some("  ");
        let file = RemoteAttachConfig::resolve(&sources).unwrap();
        assert_eq!(file.listen_ip(), IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20)));

        sources.file_bind = Some("0.0.0.0");
        let explicit_all = RemoteAttachConfig::resolve(&sources).unwrap();
        assert!(explicit_all.listen_ip().is_unspecified());

        sources.file_bind = Some("not-an-ip");
        assert!(RemoteAttachConfig::resolve(&sources).is_err());

        let args = vec!["--remote-bind".to_string(), "10.1.2.3".to_string()];
        assert_eq!(cli_bind_arg(&args).unwrap().as_deref(), Some("10.1.2.3"));
        assert_eq!(
            cli_bind_arg(&["--remote-bind=100.64.0.5".to_string()])
                .unwrap()
                .as_deref(),
            Some("100.64.0.5")
        );
        assert!(cli_bind_arg(&["--remote-bind".to_string()]).is_err());

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(REMOTE_CONFIG_FILE),
            r#"{"enabled":true,"bind":"192.168.8.8"}"#,
        )
        .unwrap();
        let parsed = read_file_config(dir.path()).unwrap().unwrap();
        assert_eq!(parsed.bind.as_deref(), Some("192.168.8.8"));
        assert!(parsed.enabled);
    }

    #[test]
    fn all_interfaces_bind_warns_and_specific_bind_does_not() {
        let warning = all_interfaces_warning(IpAddr::V4(Ipv4Addr::UNSPECIFIED)).unwrap();
        assert!(warning.contains("all interfaces"));
        assert!(warning.contains("--remote-bind"));
        assert!(warning.contains(ENV_REMOTE_BIND));
        assert!(warning.contains("--tls-fingerprint"));
        assert!(warning.contains("Tailscale"));
        assert!(all_interfaces_warning("::".parse().unwrap()).is_some());
        assert!(all_interfaces_warning(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 2))).is_none());
    }

    #[test]
    fn edit_scope_is_read_and_mock_route_only() {
        let allow =
            |command: &str, payload: Value| command_allowed(RemoteScope::Edit, command, &payload);
        assert!(allow("get_proxy_status", Value::Null));
        assert!(allow("list_api_log_dates", Value::Null));
        assert!(allow("search_api_logs", Value::Null));
        assert!(allow("check_domain_status", Value::Null));
        assert!(allow("ping", Value::Null));
        assert!(allow("create_mock_rule", Value::Null));
        assert!(allow("update_scenario", Value::Null));
        assert!(allow("delete_mock_rule", Value::Null));
        assert!(allow("add_local_route", Value::Null));
        assert!(allow("update_local_route", Value::Null));
        assert!(allow("remove_local_route", Value::Null));
        assert!(allow("set_local_route_enabled", Value::Null));

        assert!(!allow("start_local_proxy", Value::Null));
        assert!(!allow("stop_local_proxy", Value::Null));
        assert!(!allow(
            "set_system_pac",
            json!({"url": "http://127.0.0.1/proxy.pac"})
        ));
        assert!(!allow("clear_system_pac", Value::Null));
        assert!(!allow(
            "update_proxy_settings",
            json!({"allowRemoteAccess": true})
        ));
        assert!(!allow(
            "update_proxy_settings",
            json!({"logRetentionDays": 3})
        ));
        assert!(!allow("reissue_remote_token", Value::Null));
        assert!(!allow("shutdown_serve", Value::Null));
        assert!(!allow("regist_domains", json!({"domains": []})));
        assert!(!allow("start_transparent_proxy", Value::Null));

        assert!(command_allowed(
            RemoteScope::Admin,
            "start_local_proxy",
            &Value::Null
        ));
        assert!(command_allowed(
            RemoteScope::Admin,
            "reissue_remote_token",
            &Value::Null
        ));
        assert!(command_allowed(
            RemoteScope::Admin,
            "update_proxy_settings",
            &json!({"allowRemoteAccess": true})
        ));
        assert!(command_allowed(
            RemoteScope::Admin,
            "clear_system_pac",
            &Value::Null
        ));
    }

    #[test]
    fn command_lists_are_sorted_for_binary_search() {
        let mut edit = EDIT_COMMANDS.to_vec();
        edit.sort_unstable();
        assert_eq!(edit, EDIT_COMMANDS);
        let names = [
            "clear_system_pac",
            "reissue_remote_token",
            "set_system_pac",
            "shutdown_serve",
            "start_local_proxy",
            "start_transparent_proxy",
            "stop_local_proxy",
            "stop_transparent_proxy",
            "update_proxy_settings",
        ];
        let mut sorted = names;
        sorted.sort_unstable();
        assert_eq!(sorted, names);
    }

    #[test]
    fn disabled_bind_is_loopback_and_enabled_bind_is_unspecified() {
        let local = super::super::server::bind_serve_socket(0, None).unwrap();
        assert!(local.local_addr().unwrap().ip().is_loopback());

        let remote =
            super::super::server::bind_serve_socket(0, Some(IpAddr::V4(Ipv4Addr::UNSPECIFIED)))
                .unwrap();
        assert!(remote.local_addr().unwrap().ip().is_unspecified());

        let tailscale =
            super::super::server::bind_serve_socket(0, Some(IpAddr::V4(Ipv4Addr::LOCALHOST)))
                .unwrap();
        let bound = tailscale.local_addr().unwrap();
        assert_eq!(bound.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_ne!(bound.port(), 0);
    }

    #[test]
    fn disabled_listener_is_not_reachable_off_loopback() {
        let listener = super::super::server::bind_serve_socket(0, None).unwrap();
        let port = listener.local_addr().unwrap().port();
        let Some(ip) = non_loopback_ipv4() else {
            return;
        };
        let addr = SocketAddr::new(IpAddr::V4(ip), port);
        let connected = TcpStream::connect_timeout(&addr, Duration::from_millis(300));
        assert!(
            connected.is_err(),
            "loopback control socket accepted {addr}"
        );
    }

    #[test]
    fn ingress_follows_peer_only_when_remote_is_enabled() {
        let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
        let lan = IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3));
        assert_eq!(ingress_for(loopback, false), Ingress::Local);
        assert_eq!(ingress_for(lan, false), Ingress::Local);
        assert_eq!(ingress_for(loopback, true), Ingress::Local);
        assert_eq!(ingress_for(lan, true), Ingress::Remote);
        assert_eq!(
            ingress_for("::ffff:127.0.0.1".parse().unwrap(), true),
            Ingress::Local
        );
    }

    #[cfg(unix)]
    #[test]
    fn remote_token_is_distinct_owner_only_and_stable() {
        let dir = tempfile::tempdir().unwrap();
        let local = generate_token();
        let first = load_or_create_remote_token(dir.path(), &local).unwrap();
        let second = load_or_create_remote_token(dir.path(), &local).unwrap();
        assert_eq!(first, second);
        assert_ne!(first, local);
        assert_eq!(first.len(), 64);
        let path = dir.path().join(REMOTE_TOKEN_FILE);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let again = generate_token();
        assert_ne!(first, again);
    }

    #[test]
    fn token_compare_rejects_mismatch_empty_and_local_token() {
        assert!(constant_time_token_eq(
            "abcdef0123456789",
            "abcdef0123456789"
        ));
        assert!(!constant_time_token_eq(
            "abcdef0123456789",
            "abcdef0123456780"
        ));
        assert!(!constant_time_token_eq("", ""));
        assert!(!constant_time_token_eq("abcdef0123456789", ""));
        assert!(!constant_time_token_eq("short", "other-token-value"));
    }

    #[test]
    fn lockout_is_per_source_ip() {
        let lockout = Lockout::new(LockoutPolicy {
            max_failures: 3,
            window: Duration::from_secs(60),
            lockout: Duration::from_secs(60),
        });
        let attacker = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 8));
        let other = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 9));
        assert!(!lockout.record_failure(attacker));
        assert!(!lockout.record_failure(attacker));
        assert!(lockout.record_failure(attacker));
        assert!(lockout.is_locked(attacker));
        assert!(!lockout.is_locked(other));
        assert!(!lockout.record_failure(other));
        lockout.clear(attacker);
        assert!(!lockout.is_locked(attacker));
    }

    #[test]
    fn redact_removes_tokens_from_text() {
        let fixture = "redact-me-0123456789abcdef";
        let message = format!("rejected value {fixture} in error {fixture}");
        let cleaned = redact_text(&message, &[fixture]);
        assert!(!cleaned.contains(&fixture));
        assert!(cleaned.contains("[redacted]"));
        assert_eq!(redact_text("plain", &["tiny"]), "plain");
    }

    #[test]
    fn extract_attach_flags_and_resolve_token_from_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token");
        std::fs::write(&path, "remote-token-value-0123456789\n").unwrap();
        let args = vec![
            "get_proxy_status".to_string(),
            "{}".to_string(),
            "--attach".to_string(),
            "127.0.0.1:17345".to_string(),
            "--remote-token-file".to_string(),
            path.display().to_string(),
            "--tls-fingerprint".to_string(),
            "AA:BB".to_string(),
        ];
        let (rest, opts) = extract_client_flags(&args).unwrap();
        assert_eq!(rest, vec!["get_proxy_status".to_string(), "{}".to_string()]);
        assert_eq!(opts.attach.as_deref(), Some("127.0.0.1:17345"));
        assert_eq!(normalize_fingerprint("sha256:AA:BB"), "aabb");
        let endpoint = client_endpoint(&opts, dir.path().join("pins.json")).unwrap();
        assert_eq!(endpoint.token, "remote-token-value-0123456789");
        assert_eq!(endpoint.fingerprint.as_deref(), Some("AA:BB"));
    }

    fn non_loopback_ipv4() -> Option<Ipv4Addr> {
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect("8.8.8.8:80").ok()?;
        match socket.local_addr().ok()?.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
            _ => None,
        }
    }
}
