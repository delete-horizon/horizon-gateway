use std::io::{BufRead, Write};
use std::net::TcpStream;
use std::time::Duration;

use hg_core::{ServeRequest, ServeResponse, SERVE_TCP_ADDR};
use serde_json::Value;

/// Session token published by serve (`<data dir>/com.lurain.horizon-gateway/serve.token`).
/// Read per call: serve writes a new one each time it starts.
pub fn serve_token() -> Option<String> {
    let path = hg_core::serve_token_path(&dirs::data_dir()?);
    let token = std::fs::read_to_string(path).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_string())
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// Ping the serve backend (cheap health check).
pub fn ping() -> Result<(), String> {
    ping_info().map(|_| ())
}

/// Ping and return the serve JSON payload (`mode`, `ok`, `version`).
pub fn ping_info() -> Result<Value, String> {
    call_command("ping", Value::Null).map_err(|e| format!("serve ping failed: {e}"))
}

/// True when the running serve binary reports the same crate version as this GUI.
pub fn serve_matches_gui_version() -> bool {
    ping_info()
        .ok()
        .and_then(|v| v.get("version")?.as_str().map(str::to_string))
        .is_some_and(|version| version == env!("CARGO_PKG_VERSION"))
}

/// Dispatch a backend command through the serve IPC channel.
pub fn call_command(command: &str, payload: Value) -> Result<Value, String> {
    let request = ServeRequest::new(command, payload).with_token(serve_token());

    let response = send_request(&request)?;
    if response.ok {
        response
            .data
            .ok_or_else(|| "serve returned empty data".to_string())
    } else {
        Err(response
            .error
            .unwrap_or_else(|| "serve command failed".to_string()))
    }
}

fn send_request(request: &ServeRequest) -> Result<ServeResponse, String> {
    let addr: std::net::SocketAddr = SERVE_TCP_ADDR
        .parse()
        .map_err(|e| format!("invalid serve address {SERVE_TCP_ADDR}: {e}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("failed to connect to serve at {SERVE_TCP_ADDR}: {e}"))?;
    stream
        .set_read_timeout(Some(IO_TIMEOUT))
        .map_err(|e| format!("set_read_timeout: {e}"))?;
    stream
        .set_write_timeout(Some(IO_TIMEOUT))
        .map_err(|e| format!("set_write_timeout: {e}"))?;

    let mut payload =
        serde_json::to_string(request).map_err(|e| format!("encode serve request: {e}"))?;
    payload.push('\n');
    stream
        .write_all(payload.as_bytes())
        .map_err(|e| format!("serve write failed: {e}"))?;
    stream
        .flush()
        .map_err(|e| format!("serve flush failed: {e}"))?;

    let mut reader = std::io::BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("serve read failed: {e}"))?;
    if line.trim().is_empty() {
        return Err("serve closed connection without response".to_string());
    }

    serde_json::from_str(line.trim()).map_err(|e| format!("invalid serve response JSON: {e}"))
}

/// Normalize Tauri invoke args into the CLI-style payload object.
pub fn invoke_args_to_payload(args: Value) -> Value {
    if let Some(obj) = args.as_object() {
        if obj.len() == 1 && obj.contains_key("payload") {
            return obj.get("payload").cloned().unwrap_or(args);
        }
    }
    args
}
