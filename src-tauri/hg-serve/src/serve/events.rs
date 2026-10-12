use std::io::{BufRead, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use hg_core::{ServeEvent, ServeEventHello, SERVE_EVENT_PORT};
use serde::Serialize;
use serde_json::Value;

use super::remote::{
    authorize, ingress_for, read_one_line, Ingress, RemoteAttach, TLS_REQUIRED, UNAUTHORIZED,
};

static GLOBAL_BUS: OnceLock<Arc<ServeEventBus>> = OnceLock::new();

enum Subscriber {
    Plain(TcpStream),
    Tls(Box<Mutex<rustls::StreamOwned<rustls::ServerConnection, TcpStream>>>),
}

pub struct ServeEventBus {
    subscribers: Mutex<Vec<Subscriber>>,
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
        self.push(Subscriber::Plain(stream));
    }

    fn add_tls(&self, stream: rustls::StreamOwned<rustls::ServerConnection, TcpStream>) {
        self.push(Subscriber::Tls(Box::new(Mutex::new(stream))));
    }

    fn push(&self, subscriber: Subscriber) {
        let mut subs = self.subscribers.lock().unwrap_or_else(|e| e.into_inner());
        subs.push(subscriber);
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
        subs.retain_mut(|subscriber| write_subscriber(subscriber, bytes));
    }
}

fn write_subscriber(subscriber: &mut Subscriber, bytes: &[u8]) -> bool {
    match subscriber {
        Subscriber::Plain(stream) => stream.write_all(bytes).is_ok() && stream.flush().is_ok(),
        Subscriber::Tls(stream) => {
            let mut stream = stream.lock().unwrap_or_else(|err| err.into_inner());
            stream.write_all(bytes).is_ok() && stream.flush().is_ok()
        }
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
/// Loopback uses the local token. Non-loopback uses TLS and the remote token.
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
    let ok = hello_authorized(
        &line,
        Ingress::Local,
        Ipv4Addr::LOCALHOST.into(),
        token,
        &RemoteAttach::disabled(),
    );
    ok && stream.set_read_timeout(None).is_ok()
}

fn hello_authorized(
    line: &str,
    ingress: Ingress,
    peer: IpAddr,
    local_token: &str,
    remote: &RemoteAttach,
) -> bool {
    let Ok(hello) = serde_json::from_str::<ServeEventHello>(line.trim()) else {
        if ingress == Ingress::Remote {
            let _ = remote.finish_auth(peer, None);
        }
        return false;
    };
    authorize(
        ingress,
        local_token,
        remote,
        peer,
        Some(hello.token.as_str()),
    )
    .is_ok()
}

pub fn start_event_listener(
    bus: Arc<ServeEventBus>,
    token: Arc<str>,
    remote: Arc<RemoteAttach>,
) -> Result<SocketAddr, String> {
    let listener = super::server::bind_serve_socket(SERVE_EVENT_PORT, remote.listen_ip())?;
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
                    let remote = Arc::clone(&remote);
                    std::thread::spawn(move || {
                        accept_event_subscriber(stream, &bus, token.as_ref(), remote.as_ref());
                    });
                }
                Err(e) => tracing::warn!("[serve] event accept error: {e}"),
            }
        }
    });

    Ok(addr)
}

fn accept_event_subscriber(
    stream: TcpStream,
    bus: &ServeEventBus,
    local_token: &str,
    remote: &RemoteAttach,
) {
    let peer = stream.peer_addr().ok();
    let ip = peer
        .map(|addr| addr.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    let ingress = match peer {
        Some(addr) => ingress_for(addr.ip(), remote.enabled()),
        None if remote.enabled() => Ingress::Remote,
        None => Ingress::Local,
    };
    if ingress == Ingress::Remote {
        let Ok(killer) = stream.try_clone() else {
            return;
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut tls = match remote.accept_tls(stream) {
            Ok(tls) => tls,
            Err(err) => {
                tracing::warn!("[serve] event subscriber rejected: {}", remote.redact(&err));
                return;
            }
        };
        let mut buf = Vec::new();
        if read_one_line(&mut tls, &mut buf).is_err() {
            tracing::warn!("[serve] event subscriber rejected: {TLS_REQUIRED}");
            return;
        }
        let text = String::from_utf8(buf).unwrap_or_default();
        if !hello_authorized(&text, Ingress::Remote, ip, local_token, remote) {
            tracing::warn!("[serve] event subscriber rejected: {UNAUTHORIZED}");
            return;
        }
        let _ = tls.sock.set_read_timeout(None);
        remote.register_live(killer);
        tracing::debug!("[serve] remote event subscriber connected");
        bus.add_tls(tls);
        return;
    }
    if read_hello(&stream, local_token) {
        tracing::debug!("[serve] event subscriber connected");
        bus.add_subscriber(stream);
    } else {
        tracing::warn!("[serve] event subscriber rejected: {UNAUTHORIZED}");
    }
}
