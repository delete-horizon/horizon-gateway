fn clear_system_pac() {
    if let Err(err) = super::system_proxy::SystemProxyService::clear_pac_url() {
        tracing::warn!("[gui] clear system PAC: {err}");
    }
}

pub fn kill_serve_process() {
    // Prefer IPC shutdown so a non-elevated GUI can stop an elevated serve.
    // Older leftovers that do not know `shutdown_serve` still get `stop_local_proxy`.
    if super::client::call_command("shutdown_serve", serde_json::Value::Null).is_err() {
        let _ = super::client::call_command("stop_local_proxy", serde_json::Value::Null);
    }
    clear_system_pac();

    #[cfg(windows)]
    {
        use std::process::Command;
        let _ = Command::new("taskkill")
            .args(["/IM", "horizon-gateway-serve.exe", "/F", "/T"])
            .output();
        kill_serve_listener_pids(&[8888, 17345]);
    }
    #[cfg(not(windows))]
    {
        use std::process::Command;
        let _ = Command::new("pkill")
            .args(["-f", "horizon-gateway-serve"])
            .output();
    }
}

/// Kill leftover serve by the PID that still owns 8888/17345 after `/IM` taskkill.
/// Skips PIDs whose image name is not `horizon-gateway-serve` (do not kill browsers).
#[cfg(windows)]
fn kill_serve_listener_pids(ports: &[u16]) {
    use std::collections::HashSet;
    use std::process::Command;

    let output = Command::new("netstat").args(["-ano"]).output();
    let Ok(output) = output else {
        return;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut pids = HashSet::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.contains("LISTENING") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        // TCP  0.0.0.0:8888  0.0.0.0:0  LISTENING  1234
        if parts.len() < 5 || !parts[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        let Some(port) = parse_local_port(parts[1]) else {
            continue;
        };
        if !ports.contains(&port) {
            continue;
        }
        if let Ok(pid) = parts[parts.len() - 1].parse::<u32>() {
            if pid != 0 {
                pids.insert(pid);
            }
        }
    }

    for pid in pids {
        if !pid_is_horizon_gateway_serve(pid) {
            tracing::warn!(
                "[gui] port leftover pid={pid} is not horizon-gateway-serve; leaving it alone"
            );
            continue;
        }
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string(), "/T"])
            .output();
    }
}

#[cfg(windows)]
fn parse_local_port(local_addr: &str) -> Option<u16> {
    let (_, port) = local_addr.rsplit_once(':')?;
    port.parse().ok()
}

#[cfg(windows)]
fn pid_is_horizon_gateway_serve(pid: u32) -> bool {
    use std::process::Command;

    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output();
    let Ok(output) = output else {
        return false;
    };
    let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    text.contains("horizon-gateway-serve")
}

#[cfg(all(test, windows))]
mod tests {
    use super::parse_local_port;

    #[test]
    fn parse_local_port_from_netstat_addr() {
        assert_eq!(parse_local_port("0.0.0.0:8888"), Some(8888));
        assert_eq!(parse_local_port("127.0.0.1:17345"), Some(17345));
        assert_eq!(parse_local_port("[::1]:8888"), Some(8888));
        assert_eq!(parse_local_port("bad"), None);
    }
}
