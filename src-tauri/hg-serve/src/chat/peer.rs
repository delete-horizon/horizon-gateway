use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;

use crate::serve::events::publish_event;

static LISTEN_PORT: AtomicU16 = AtomicU16::new(0);
static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP: OnceLock<Arc<AtomicBool>> = OnceLock::new();

/// Event name re-emitted to webviews via `events_client` (keep FE listen string stable).
pub const CHAT_FRAME_EVENT: &str = "chat-frame-received";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenInfo {
    pub port: u16,
    pub lan_hosts: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub state: String,
    pub via: String,
}

fn lan_hosts() -> Vec<String> {
    let mut hosts = Vec::new();
    if let Ok(ifaces) = get_if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let std::net::IpAddr::V4(v4) = iface.ip() {
                let s = v4.to_string();
                if !hosts.contains(&s) {
                    hosts.push(s);
                }
            }
        }
    }
    if hosts.is_empty() {
        hosts.push("127.0.0.1".into());
    }
    hosts
}

fn read_frame(stream: &mut TcpStream) -> Result<String, String> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).map_err(|e| e.to_string())?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len == 0 || len > 1_000_000 {
        return Err("invalid frame length".into());
    }
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

fn write_frame(stream: &mut TcpStream, payload: &str) -> Result<(), String> {
    let bytes = payload.as_bytes();
    let len = (bytes.len() as u32).to_be_bytes();
    stream.write_all(&len).map_err(|e| e.to_string())?;
    stream.write_all(bytes).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())
}

pub fn start_listener() -> Result<ListenInfo, String> {
    if RUNNING.load(Ordering::SeqCst) {
        let port = LISTEN_PORT.load(Ordering::SeqCst);
        return Ok(ListenInfo {
            port,
            lan_hosts: lan_hosts(),
        });
    }

    let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    LISTEN_PORT.store(port, Ordering::SeqCst);

    let stop = STOP.get_or_init(|| Arc::new(AtomicBool::new(false))).clone();
    stop.store(false, Ordering::SeqCst);
    RUNNING.store(true, Ordering::SeqCst);

    let stop_flag = stop.clone();
    thread::spawn(move || {
        let _ = listener.set_nonblocking(true);
        while !stop_flag.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    match read_frame(&mut stream) {
                        Ok(frame) => {
                            // Fan-out to all GUI event subscribers (Hub + companion).
                            publish_event(CHAT_FRAME_EVENT, frame);
                        }
                        Err(e) => tracing::debug!("chat frame read error: {e}"),
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(e) => {
                    tracing::debug!("chat accept error: {e}");
                    thread::sleep(Duration::from_millis(100));
                }
            }
        }
        RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(ListenInfo {
        port,
        lan_hosts: lan_hosts(),
    })
}

pub fn stop_listener() {
    if let Some(stop) = STOP.get() {
        stop.store(true, Ordering::SeqCst);
    }
}

fn try_connect_host(host: &str, port: u16) -> Result<TcpStream, String> {
    use std::net::ToSocketAddrs;
    let addr = format!("{host}:{port}");
    let sock = addr
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or_else(|| format!("no address for {addr}"))?;
    TcpStream::connect_timeout(&sock, Duration::from_millis(800)).map_err(|e| e.to_string())
}

/// LAN first, then tunnel URL (host:port or http URL host).
pub fn send_frame(
    lan_hosts: &[String],
    lan_port: u16,
    tunnel_url: Option<&str>,
    frame_json: &str,
) -> Result<SendResult, String> {
    for host in lan_hosts {
        if host.is_empty() || lan_port == 0 {
            continue;
        }
        if let Ok(mut stream) = try_connect_host(host, lan_port) {
            let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
            if write_frame(&mut stream, frame_json).is_ok() {
                return Ok(SendResult {
                    state: "online".into(),
                    via: "lan".into(),
                });
            }
        }
    }

    if let Some(url) = tunnel_url.filter(|u| !u.is_empty()) {
        if let Some((host, port)) = parse_tunnel_endpoint(url) {
            if let Ok(mut stream) = try_connect_host(&host, port) {
                let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
                if write_frame(&mut stream, frame_json).is_ok() {
                    return Ok(SendResult {
                        state: "online".into(),
                        via: "tunnel".into(),
                    });
                }
            }
        }
    }

    Ok(SendResult {
        state: "offline".into(),
        via: "none".into(),
    })
}

fn parse_tunnel_endpoint(url: &str) -> Option<(String, u16)> {
    if let Some((h, p)) = url.split_once(':') {
        if !h.contains('/') && p.parse::<u16>().is_ok() {
            return Some((h.to_string(), p.parse().ok()?));
        }
    }
    let trimmed = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = trimmed.split('/').next()?.split(':').next()?.to_string();
    if host.is_empty() {
        return None;
    }
    // Cloudflare quick tunnels are HTTPS — TCP chat won't work through them without a side channel.
    let port = if url.contains("https://") { 443 } else { 80 };
    Some((host, port))
}
