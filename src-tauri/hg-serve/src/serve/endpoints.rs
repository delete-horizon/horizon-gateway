//! Published control sockets for this boot.
//!
//! Serve writes `serve.endpoints.json` after both listeners bind. Local clients
//! read it and fall back to the fixed loopback addresses when the file is absent,
//! so an older serve and a newer client can still meet on `127.0.0.1:17345`.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Mutex;

use hg_core::{ServeEndpoints, SERVE_ENDPOINTS_FILE, SERVE_EVENT_ADDR, SERVE_TCP_ADDR};

use crate::runtime::paths::resolve_app_data_dir;
use crate::runtime::private_file::write_private_file;

static PUBLISHED: Mutex<Option<ServeEndpoints>> = Mutex::new(None);

fn endpoints_path() -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir()?.join(SERVE_ENDPOINTS_FILE))
}

fn lock() -> std::sync::MutexGuard<'static, Option<ServeEndpoints>> {
    PUBLISHED.lock().unwrap_or_else(|err| err.into_inner())
}

/// Record the sockets this process actually bound and write them for clients.
pub fn publish(command: SocketAddr, event: SocketAddr) -> Result<(), String> {
    let endpoints = ServeEndpoints {
        protocol_version: hg_core::PROTOCOL_VERSION,
        pid: std::process::id(),
        command_addr: command.to_string(),
        event_addr: event.to_string(),
        proxy_addr: None,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    write(&endpoints)?;
    *lock() = Some(endpoints);
    Ok(())
}

/// Remember the proxy listen address and refresh the published file.
pub fn set_proxy_addr(addr: SocketAddr) {
    let mut guard = lock();
    let Some(endpoints) = guard.as_mut() else {
        return;
    };
    endpoints.proxy_addr = Some(addr.to_string());
    endpoints.updated_at = chrono::Utc::now().to_rfc3339();
    if let Err(err) = write(endpoints) {
        tracing::warn!("[serve] failed to record proxy address: {err}");
    }
}

/// Drop the proxy address when the listener stops.
pub fn clear_proxy_addr() {
    let mut guard = lock();
    let Some(endpoints) = guard.as_mut() else {
        return;
    };
    endpoints.proxy_addr = None;
    endpoints.updated_at = chrono::Utc::now().to_rfc3339();
    if let Err(err) = write(endpoints) {
        tracing::warn!("[serve] failed to clear proxy address: {err}");
    }
}

pub fn command_addr() -> String {
    read()
        .map(|endpoints| endpoints.command_addr)
        .unwrap_or_else(|| SERVE_TCP_ADDR.to_string())
}

pub fn event_addr() -> String {
    read()
        .map(|endpoints| endpoints.event_addr)
        .unwrap_or_else(|| SERVE_EVENT_ADDR.to_string())
}

/// Ports this process bound, used to keep the proxy off the control plane.
pub fn recorded_control_ports() -> Vec<u16> {
    lock()
        .as_ref()
        .map(|endpoints| {
            [
                endpoints.command_addr.as_str(),
                endpoints.event_addr.as_str(),
            ]
            .into_iter()
            .filter_map(port_of)
            .collect()
        })
        .unwrap_or_default()
}

fn read() -> Option<ServeEndpoints> {
    if let Some(endpoints) = lock().clone() {
        return Some(endpoints);
    }
    let path = endpoints_path().ok()?;
    ServeEndpoints::load(&path)
}

fn write(endpoints: &ServeEndpoints) -> Result<(), String> {
    let path = endpoints_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| format!("create {}: {err}", dir.display()))?;
    }
    let json = serde_json::to_vec(endpoints).map_err(|err| format!("encode endpoints: {err}"))?;
    write_private_file(&path, &json)
}

fn port_of(addr: &str) -> Option<u16> {
    addr.parse::<SocketAddr>().ok().map(|socket| socket.port())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_falls_back_to_fixed_addrs() {
        let command = command_addr();
        let event = event_addr();
        assert!(
            command == SERVE_TCP_ADDR || command.parse::<SocketAddr>().is_ok(),
            "{command}"
        );
        assert!(
            event == SERVE_EVENT_ADDR || event.parse::<SocketAddr>().is_ok(),
            "{event}"
        );
    }
}
