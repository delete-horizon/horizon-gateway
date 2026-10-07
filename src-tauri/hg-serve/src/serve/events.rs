use std::io::{BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use hg_core::{serve_token_matches, ServeEvent, ServeEventHello, SERVE_EVENT_PORT};
use serde::Serialize;
use serde_json::Value;

static GLOBAL_BUS: OnceLock<Arc<ServeEventBus>> = OnceLock::new();

pub struct ServeEventBus {
    subscribers: Mutex<Vec<TcpStream>>,
}

impl ServeEventBus {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            subscribers: Mutex::new(Vec::new()),
        })
    }

    pub fn init_global(bus: Arc<Self>) {
        let _ = GLOBAL_BUS.set(Arc::clone(&bus));
    }

    pub fn add_subscriber(&self, stream: TcpStream) {
        let mut subs = self.subscribers.lock().unwrap_or_else(|e| e.into_inner());
        subs.push(stream);
    }

    pub fn publish(&self, event: &str, payload: Value) {
        let msg = match serde_json::to_string(&ServeEvent {
            event: event.to_string(),
            payload,
        }) {
            Ok(s) => format!("{s}\n"),
            Err(_) => return,
        };
        let bytes = msg.as_bytes();
        let mut subs = self.subscribers.lock().unwrap_or_else(|e| e.into_inner());
        subs.retain_mut(|s| s.write_all(bytes).is_ok() && s.flush().is_ok());
    }
}

pub fn publish_event<S: Serialize>(event: &str, payload: S) {
    let Some(bus) = GLOBAL_BUS.get() else {
        return;
    };
    let payload = serde_json::to_value(payload).unwrap_or(Value::Null);
    bus.publish(event, payload);
}

/// Emit to GUI webview: serve event bus.
pub fn emit_to_gui<S: Serialize + Clone>(_app: Option<&()>, event: &str, payload: S) {
    publish_event(event, payload);
}

/// Subscribers must send a [`ServeEventHello`] line with the session token first.
fn read_hello(stream: &TcpStream, token: &str) -> bool {
    if stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .is_err()
    {
        return false;
    }
    let Ok(read_half) = stream.try_clone() else {
        return false;
    };
    let mut line = String::new();
    let mut reader = std::io::BufReader::new(read_half.take(4096));
    if reader.read_line(&mut line).is_err() {
        return false;
    }
    let ok = serde_json::from_str::<ServeEventHello>(line.trim())
        .is_ok_and(|hello| serve_token_matches(token, Some(hello.token.as_str())));
    ok && stream.set_read_timeout(None).is_ok()
}

pub fn start_event_listener(
    bus: Arc<ServeEventBus>,
    token: Arc<str>,
) -> Result<SocketAddr, String> {
    let listener = super::server::bind_loopback(SERVE_EVENT_PORT)?;
    let addr = listener
        .local_addr()
        .map_err(|err| format!("event socket has no local address: {err}"))?;
    tracing::info!("[serve] event stream on {addr}");

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let bus = Arc::clone(&bus);
                    let token = Arc::clone(&token);
                    std::thread::spawn(move || {
                        if read_hello(&stream, &token) {
                            tracing::debug!("[serve] event subscriber connected");
                            bus.add_subscriber(stream);
                        } else {
                            tracing::warn!(
                                "[serve] event subscriber rejected: missing or invalid token"
                            );
                        }
                    });
                }
                Err(e) => tracing::warn!("[serve] event accept error: {e}"),
            }
        }
    });

    Ok(addr)
}
