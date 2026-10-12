//! OS PAC settings. The desktop shell owns this; `horizon-gateway-serve` does not.
//!
//! Linux (and any other non-Windows, non-macOS target) returns success without
//! changing the OS. A container must not treat that `Ok` as "the system proxy is on".
//! Headless serve never calls these functions, so PAC stays untouched until a shell
//! is up and has seen a running proxy.

#[cfg(target_os = "macos")]
use std::process::Command;

use serde_json::Value;

/// `http://127.0.0.1:{port}/.horizon-gateway/proxy.pac`
pub fn pac_url_for_port(port: u16) -> String {
    format!("http://127.0.0.1:{port}/.horizon-gateway/proxy.pac")
}

/// What the shell should do to the OS PAC setting for a proxy status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemPacIntent {
    /// Proxy listener is up. Point the OS at this PAC URL.
    Set(String),
    /// Proxy listener stopped. Remove the PAC URL.
    Clear,
    /// Do not touch the OS. Used when the shell attaches before the listener is up,
    /// and when a payload has no usable port.
    Leave,
}

/// `clear_when_stopped` is true for a live `proxy-status-changed` event.
/// The initial sync passes false so a shell that attaches early does not wipe
/// an existing PAC before `auto_start_proxy` has opened the listener.
pub fn system_pac_intent(running: bool, port: u16, clear_when_stopped: bool) -> SystemPacIntent {
    if running && port > 0 {
        SystemPacIntent::Set(pac_url_for_port(port))
    } else if clear_when_stopped && !running {
        SystemPacIntent::Clear
    } else {
        SystemPacIntent::Leave
    }
}

/// Accept either a `proxy-status-changed` payload or a `get_proxy_status` `ApiResponse`.
pub fn intent_from_status_json(value: &Value, clear_when_stopped: bool) -> SystemPacIntent {
    let status = value
        .get("data")
        .filter(|inner| inner.is_object())
        .unwrap_or(value);
    let Some(running) = status.get("running").and_then(Value::as_bool) else {
        return SystemPacIntent::Leave;
    };
    let port = status
        .get("port")
        .and_then(Value::as_u64)
        .and_then(|port| u16::try_from(port).ok())
        .unwrap_or(0);
    system_pac_intent(running, port, clear_when_stopped)
}

pub fn apply_system_pac_intent(intent: &SystemPacIntent) {
    match intent {
        SystemPacIntent::Set(url) => match SystemProxyService::set_pac_url(url) {
            Ok(()) => tracing::info!("{}", pac_set_log(url)),
            Err(err) => tracing::warn!("[gui] set system PAC: {err}"),
        },
        SystemPacIntent::Clear => match SystemProxyService::clear_pac_url() {
            Ok(()) => tracing::info!("{}", pac_clear_log()),
            Err(err) => tracing::warn!("[gui] clear system PAC: {err}"),
        },
        SystemPacIntent::Leave => {}
    }
}

fn pac_set_log(url: &str) -> String {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        format!("[gui] system PAC set to {url}")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        format!("[gui] system PAC left unchanged on this OS (request {url})")
    }
}

fn pac_clear_log() -> &'static str {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        "[gui] system PAC cleared"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        "[gui] system PAC clear is a no-op on this OS"
    }
}

pub(crate) fn apply_proxy_status_payload(payload: &Value, clear_when_stopped: bool) {
    apply_system_pac_intent(&intent_from_status_json(payload, clear_when_stopped));
}

/// If the listener is already up, set PAC. A stopped proxy does not clear PAC here:
/// the stop event (or shell shutdown) does that. This covers the race where serve
/// emitted `proxy-status-changed` before the shell subscribed.
pub(crate) fn sync_pac_if_proxy_running() {
    match super::client::call_command("get_proxy_status", Value::Object(serde_json::Map::new())) {
        Ok(value) => apply_proxy_status_payload(&value, false),
        Err(err) => tracing::debug!("[gui] proxy status for PAC sync: {err}"),
    }
}

pub struct SystemProxyService;

impl SystemProxyService {
    /// Sets the system's PAC (Proxy Auto-Config) URL.
    pub fn set_pac_url(url: &str) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
            use winreg::RegKey;

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let path = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
            let key = hkcu
                .open_subkey_with_flags(path, KEY_SET_VALUE)
                .map_err(|e| format!("Failed to open registry key: {e}"))?;

            key.set_value("AutoConfigURL", &url)
                .map_err(|e| format!("Failed to set AutoConfigURL: {e}"))?;

            if let Err(e) = key.set_value("ProxyEnable", &0u32) {
                tracing::warn!("[gui] failed to disable ProxyEnable: {e}");
            }
            let _ = key.delete_value("ProxyServer");
            let _ = key.delete_value("ProxyOverride");

            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("networksetup")
                .args(["-setautoproxyurl", "Wi-Fi", url])
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                let _ = Command::new("networksetup")
                    .args(["-setautoproxyurl", "Ethernet", url])
                    .output();
            }
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = url;
            Ok(())
        }
    }

    /// Clears the system's PAC URL setting.
    pub fn clear_pac_url() -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
            use winreg::RegKey;

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let path = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
            let key = hkcu
                .open_subkey_with_flags(path, KEY_SET_VALUE)
                .map_err(|e| format!("Failed to open registry key: {e}"))?;

            let _ = key.delete_value("AutoConfigURL");

            if let Err(e) = key.set_value("ProxyEnable", &0u32) {
                tracing::warn!("[gui] failed to disable ProxyEnable on clear: {e}");
            }

            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("networksetup")
                .args(["-setautoproxyoff", "Wi-Fi"])
                .output()
                .map_err(|e| e.to_string())?;

            let _ = Command::new("networksetup")
                .args(["-setautoproxyoff", "Ethernet"])
                .output();

            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        intent_from_status_json, pac_url_for_port, system_pac_intent, SystemPacIntent,
        SystemProxyService,
    };
    use serde_json::json;

    #[test]
    fn running_listener_selects_the_pac_url() {
        assert_eq!(
            pac_url_for_port(8888),
            "http://127.0.0.1:8888/.horizon-gateway/proxy.pac"
        );
        assert_eq!(
            system_pac_intent(true, 8888, true),
            SystemPacIntent::Set(pac_url_for_port(8888))
        );
        assert_eq!(
            system_pac_intent(true, 8888, false),
            SystemPacIntent::Set(pac_url_for_port(8888))
        );
    }

    #[test]
    fn stopped_event_clears_pac_but_early_sync_does_not() {
        assert_eq!(system_pac_intent(false, 0, true), SystemPacIntent::Clear);
        assert_eq!(system_pac_intent(false, 0, false), SystemPacIntent::Leave);
        assert_eq!(system_pac_intent(true, 0, true), SystemPacIntent::Leave);
    }

    #[test]
    fn status_json_accepts_the_event_and_the_command_envelope() {
        let event = json!({"running": true, "port": 8888, "reverse_http_port": null});
        assert_eq!(
            intent_from_status_json(&event, true),
            SystemPacIntent::Set(pac_url_for_port(8888))
        );

        let envelope = json!({
            "message": "Proxy stopped",
            "success": true,
            "data": {"running": false, "port": 0}
        });
        assert_eq!(
            intent_from_status_json(&envelope, true),
            SystemPacIntent::Clear
        );
        assert_eq!(
            intent_from_status_json(&envelope, false),
            SystemPacIntent::Leave
        );
        assert_eq!(
            intent_from_status_json(&json!({"running": true}), true),
            SystemPacIntent::Leave
        );
        assert_eq!(
            intent_from_status_json(&json!({}), true),
            SystemPacIntent::Leave
        );
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    #[test]
    fn non_desktop_os_proxy_calls_succeed_without_changing_the_os() {
        assert!(
            SystemProxyService::set_pac_url("http://127.0.0.1:9/.horizon-gateway/proxy.pac")
                .is_ok()
        );
        assert!(SystemProxyService::clear_pac_url().is_ok());
    }
}
