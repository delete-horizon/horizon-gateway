use std::io::{BufRead, Write};
use std::net::TcpStream;
use std::time::Duration;

use hg_core::{ServeRequest, ServeResponse, SERVE_TCP_ADDR};
use serde_json::Value;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// Fast TCP probe — no IPC round-trip.
pub fn is_port_open(timeout: Duration) -> bool {
    let addr: std::net::SocketAddr = match SERVE_TCP_ADDR.parse() {
        Ok(addr) => addr,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

/// Dispatch a backend command through the serve IPC channel.
pub fn call_command(command: &str, payload: Value) -> Result<Value, String> {
    let request = ServeRequest::new(command, payload).with_token(super::auth::read_token());

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
