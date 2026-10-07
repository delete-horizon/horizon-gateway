use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRuntimeState {
    pub port: u16,
    pub reverse_http_port: Option<u16>,
    pub reverse_https_port: Option<u16>,
    pub pid: u32,
    pub updated_at: String,
}

pub struct ProxyRuntimeStateService;

impl ProxyRuntimeStateService {
    fn state_file_path() -> Option<PathBuf> {
        // `HG_DATA_DIR` isolates the whole smoke run. The default path stays
        // `<platform data dir>/horizon-gateway/proxy_runtime.json`.
        if crate::runtime::paths::app_data_dir_overridden() {
            return crate::runtime::paths::resolve_app_data_dir()
                .ok()
                .map(|dir| dir.join("proxy_runtime.json"));
        }
        dirs::data_dir().map(|dir| dir.join("horizon-gateway").join("proxy_runtime.json"))
    }

    pub fn save_state(port: u16, reverse_http_port: Option<u16>, reverse_https_port: Option<u16>) {
        let Some(path) = Self::state_file_path() else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let state = ProxyRuntimeState {
            port,
            reverse_http_port,
            reverse_https_port,
            pid: std::process::id(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };

        if let Ok(json) = serde_json::to_string_pretty(&state) {
            let _ = fs::write(path, json);
        }
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        crate::serve::endpoints::set_proxy_addr(addr);
    }

    pub fn clear_state() {
        if let Some(path) = Self::state_file_path() {
            let _ = fs::remove_file(path);
        }
        crate::serve::endpoints::clear_proxy_addr();
    }

    pub fn load_active_state() -> Option<ProxyRuntimeState> {
        let path = Self::state_file_path()?;
        if !path.is_file() {
            return None;
        }

        let content = fs::read_to_string(path).ok()?;
        let state: ProxyRuntimeState = serde_json::from_str(&content).ok()?;
        let addr = SocketAddr::from(([127, 0, 0, 1], state.port));
        let listening = TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok();
        validate_loaded_state(state, std::process::id(), listening)
    }
}

/// Active only when this process owns the saved pid and the proxy port still accepts connections.
pub(crate) fn validate_loaded_state(
    state: ProxyRuntimeState,
    current_pid: u32,
    port_listening: bool,
) -> Option<ProxyRuntimeState> {
    if state.pid == current_pid && port_listening {
        Some(state)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(pid: u32) -> ProxyRuntimeState {
        ProxyRuntimeState {
            port: 8888,
            reverse_http_port: None,
            reverse_https_port: None,
            pid,
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn active_when_this_process_still_listens() {
        let state = sample(42);
        assert_eq!(
            validate_loaded_state(state.clone(), 42, true).unwrap().port,
            8888
        );
    }

    #[test]
    fn ignores_other_process_even_if_port_is_open() {
        assert!(validate_loaded_state(sample(1), 2, true).is_none());
    }

    #[test]
    fn ignores_stale_pid_when_port_is_closed() {
        assert!(validate_loaded_state(sample(42), 42, false).is_none());
    }
}
