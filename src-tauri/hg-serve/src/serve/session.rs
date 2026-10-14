//! One control-socket connection.
//!
//! Loopback peers stay on plaintext and the local token. Non-loopback peers
//! complete TLS before a command line is parsed, then present the remote token.

use std::io::{BufRead, Write};
use std::net::{IpAddr, TcpStream};

use hg_core::{ServeRequest, ServeResponse};

use super::remote::{
    authorize, command_allowed, read_one_line, AuthFailure, Ingress, RemoteAttach, FORBIDDEN,
    LOCKED, TLS_REQUIRED, UNAUTHORIZED,
};

pub(crate) fn run_command_session<D>(
    stream: TcpStream,
    peer: IpAddr,
    ingress: Ingress,
    local_token: &str,
    remote: &RemoteAttach,
    dispatch: D,
) -> Result<(), String>
where
    D: FnMut(&ServeRequest) -> ServeResponse,
{
    let mut dispatch = dispatch;
    if ingress == Ingress::Remote {
        let killer = stream.try_clone().map_err(|err| err.to_string())?;
        let mut tls = remote.accept_tls(stream)?;
        let mut live_id = None;
        let mut authed_generation = None;
        let result = remote_loop(
            &mut tls,
            killer,
            peer,
            local_token,
            remote,
            &mut live_id,
            &mut authed_generation,
            &mut dispatch,
        );
        if let Some(id) = live_id {
            remote.unregister_live(id);
        }
        return result.map_err(|err| remote.redact(&err));
    }

    let mut reader = std::io::BufReader::new(stream.try_clone().map_err(|err| err.to_string())?);
    let mut writer = stream;
    let mut line = String::new();
    loop {
        line.clear();
        let read = reader.read_line(&mut line).map_err(|err| err.to_string())?;
        if read == 0 {
            return Ok(());
        }
        if line.len() > 1_048_576 {
            return Err("request too large".to_string());
        }
        match handle_text(
            &line,
            &mut writer,
            Ingress::Local,
            peer,
            local_token,
            remote,
            &mut None,
            &mut dispatch,
        ) {
            Step::Continue => {}
            Step::Fail(err) => return Err(remote.redact(&err)),
        }
    }
}

fn remote_loop<D>(
    tls: &mut rustls::StreamOwned<rustls::ServerConnection, TcpStream>,
    killer: TcpStream,
    peer: IpAddr,
    local_token: &str,
    remote: &RemoteAttach,
    live_id: &mut Option<u64>,
    authed_generation: &mut Option<u64>,
    dispatch: &mut D,
) -> Result<(), String>
where
    D: FnMut(&ServeRequest) -> ServeResponse,
{
    let mut registered = false;
    loop {
        if let Some(generation) = *authed_generation {
            if remote.generation() != generation {
                return Err("remote token was reissued".to_string());
            }
        }
        let mut buf = Vec::new();
        if read_one_line(tls, &mut buf).is_err() {
            if authed_generation.is_none() {
                return Err(TLS_REQUIRED.to_string());
            }
            return Ok(());
        }
        if buf.is_empty() {
            return Ok(());
        }
        let text = String::from_utf8(buf).map_err(|_| "invalid serve request".to_string())?;
        match handle_text(
            &text,
            tls,
            Ingress::Remote,
            peer,
            local_token,
            remote,
            authed_generation,
            dispatch,
        ) {
            Step::Continue => {
                if !registered && authed_generation.is_some() {
                    if let Ok(clone) = killer.try_clone() {
                        *live_id = Some(remote.register_live(clone));
                        registered = true;
                    }
                }
            }
            Step::Fail(err) => return Err(err),
        }
    }
}

enum Step {
    Continue,
    Fail(String),
}

fn handle_text<W: Write>(
    line: &str,
    writer: &mut W,
    ingress: Ingress,
    peer: IpAddr,
    local_token: &str,
    remote: &RemoteAttach,
    authed_generation: &mut Option<u64>,
    dispatch: &mut impl FnMut(&ServeRequest) -> ServeResponse,
) -> Step {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Step::Continue;
    }
    let request: ServeRequest = match serde_json::from_str(trimmed) {
        Ok(request) => request,
        Err(_) => {
            return write_failure(writer, String::new(), "invalid serve request JSON");
        }
    };

    if let Some(err) = request.unsupported_version_error() {
        let err = remote.redact(&err);
        let _ = write_response(
            writer,
            &ServeResponse::failure(request.id.clone(), err.clone()),
        );
        tracing::warn!(
            "[serve] rejected command `{}`: {err}",
            redact_command(&request.command, local_token, remote)
        );
        return Step::Fail(format!(
            "rejected command `{}`: {err}",
            redact_command(&request.command, local_token, remote)
        ));
    }

    if let Some(generation) = *authed_generation {
        if ingress == Ingress::Remote && remote.generation() != generation {
            let _ = write_response(
                writer,
                &ServeResponse::failure(request.id.clone(), UNAUTHORIZED),
            );
            return Step::Fail("remote token was reissued".to_string());
        }
    }

    let auth = authorize(ingress, local_token, remote, peer, request.token.as_deref());
    let generation = match auth {
        Ok(generation) => generation,
        Err(failure) => {
            let message = match failure {
                AuthFailure::Locked => LOCKED,
                AuthFailure::Rejected => UNAUTHORIZED,
            };
            tracing::warn!(
                "[serve] rejected command `{}`: {message}",
                redact_command(&request.command, local_token, remote)
            );
            let _ = write_response(writer, &ServeResponse::failure(request.id.clone(), message));
            return Step::Fail(format!(
                "rejected command `{}`: {message}",
                redact_command(&request.command, local_token, remote)
            ));
        }
    };

    if ingress == Ingress::Remote
        && !command_allowed(remote.scope(), &request.command, &request.payload)
    {
        tracing::warn!(
            "[serve] rejected command `{}`: {FORBIDDEN}",
            redact_command(&request.command, local_token, remote)
        );
        let _ = write_response(
            writer,
            &ServeResponse::failure(request.id.clone(), FORBIDDEN),
        );
        return Step::Continue;
    }

    if ingress == Ingress::Remote {
        if let Some(generation) = generation {
            if remote.generation() != generation {
                let _ = write_response(
                    writer,
                    &ServeResponse::failure(request.id.clone(), UNAUTHORIZED),
                );
                return Step::Fail("remote token was reissued".to_string());
            }
            *authed_generation = Some(generation);
        }
    }

    let mut response = dispatch(&request);
    if let Some(err) = response.error.as_mut() {
        *err = remote.redact(err);
    }
    if write_response(writer, &response).is_err() {
        return Step::Fail("write failed".to_string());
    }
    Step::Continue
}

fn redact_command(command: &str, local_token: &str, remote: &RemoteAttach) -> String {
    remote.redact(&super::remote::redact_text(command, &[local_token]))
}

fn write_failure<W: Write>(writer: &mut W, id: String, message: &str) -> Step {
    if write_response(writer, &ServeResponse::failure(id, message)).is_err() {
        return Step::Fail("write failed".to_string());
    }
    Step::Fail(message.to_string())
}

fn write_response<W: Write>(writer: &mut W, response: &ServeResponse) -> Result<(), String> {
    let mut out = serde_json::to_vec(response).map_err(|_| "encode response".to_string())?;
    out.push(b'\n');
    writer
        .write_all(&out)
        .map_err(|_| "write failed".to_string())?;
    writer.flush().map_err(|_| "flush failed".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Read, Write};
    use std::net::{Ipv4Addr, SocketAddr, TcpListener};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use hg_core::PROTOCOL_VERSION;
    use serde_json::{json, Value};
    use tracing_subscriber::prelude::*;

    use crate::serve::remote::{
        call_remote, LockoutPolicy, RemoteAttach, RemoteEndpoint, RemoteScope, FORBIDDEN, LOCKED,
        TLS_REQUIRED, UNAUTHORIZED,
    };

    struct Capture {
        lines: Arc<Mutex<Vec<String>>>,
    }

    impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Capture {
        fn on_event(
            &self,
            event: &tracing::Event<'_>,
            _ctx: tracing_subscriber::layer::Context<'_, S>,
        ) {
            let mut visitor = LineVisitor(String::new());
            event.record(&mut visitor);
            self.lines
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .push(format!("{} {}", event.metadata().target(), visitor.0));
        }
    }

    struct LineVisitor(String);

    impl tracing::field::Visit for LineVisitor {
        fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
            self.0.push_str(&format!("{}={:?} ", field.name(), value));
        }
    }

    fn policy_quick() -> LockoutPolicy {
        LockoutPolicy {
            max_failures: 3,
            window: Duration::from_secs(60),
            lockout: Duration::from_secs(120),
        }
    }

    fn harness(
        scope: RemoteScope,
    ) -> (
        tempfile::TempDir,
        Arc<RemoteAttach>,
        String,
        Arc<AtomicUsize>,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let local = "local-only-sample-value".to_string();
        let remote = RemoteAttach::for_test(dir.path(), &local, scope, policy_quick()).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        (dir, remote, local, calls)
    }

    fn serve_once(
        remote: Arc<RemoteAttach>,
        local: String,
        peer: IpAddr,
        ingress: Ingress,
        calls: Arc<AtomicUsize>,
    ) -> SocketAddr {
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            let calls = Arc::clone(&calls);
            let _ = run_command_session(socket, peer, ingress, &local, &remote, move |request| {
                calls.fetch_add(1, Ordering::SeqCst);
                ServeResponse::success(request.id.clone(), json!({"command": request.command}))
            });
        });
        addr
    }

    fn endpoint(
        addr: SocketAddr,
        remote: &RemoteAttach,
        token: &str,
        pins: &std::path::Path,
        fingerprint: Option<String>,
    ) -> RemoteEndpoint {
        RemoteEndpoint {
            addr,
            pin_key: addr.to_string(),
            token: token.to_string(),
            fingerprint: fingerprint.or_else(|| remote.fingerprint().map(str::to_string)),
            pins_path: pins.to_path_buf(),
        }
    }

    fn endpoint_unpinned(addr: SocketAddr, token: &str, pins: &std::path::Path) -> RemoteEndpoint {
        RemoteEndpoint {
            addr,
            pin_key: "core.example:443".to_string(),
            token: token.to_string(),
            fingerprint: None,
            pins_path: pins.to_path_buf(),
        }
    }

    fn remote_peer() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, 10))
    }

    #[test]
    fn plaintext_remote_is_rejected_before_dispatch_and_token_is_not_logged() {
        let (_dir, remote, local, calls) = harness(RemoteScope::Edit);
        let token = remote.current_token();
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).unwrap();
        let addr = listener.local_addr().unwrap();
        let payload = json!({
            "id": "1",
            "protocolVersion": PROTOCOL_VERSION,
            "command": "ping",
            "payload": {},
            "token": token,
        });
        let body = format!("{payload}\n");
        let token_for_client = token.clone();
        let client = std::thread::spawn(move || {
            let mut socket = TcpStream::connect(addr).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            socket.write_all(body.as_bytes()).unwrap();
            let mut buf = vec![0u8; 1024];
            let n = socket.read(&mut buf).unwrap_or(0);
            String::from_utf8_lossy(&buf[..n]).to_string()
        });
        let (socket, _) = listener.accept().unwrap();
        let lines = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::registry().with(Capture {
            lines: Arc::clone(&lines),
        });
        let err = tracing::subscriber::with_default(subscriber, || {
            run_command_session(
                socket,
                remote_peer(),
                Ingress::Remote,
                &local,
                &remote,
                |_| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    ServeResponse::success("x".into(), Value::Null)
                },
            )
            .unwrap_err()
        });
        let response = client.join().unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(err.contains(TLS_REQUIRED), "{err}");
        assert!(!err.contains(&token_for_client), "{err}");
        assert!(!response.contains(&token_for_client), "{response}");
        let logs = lines.lock().unwrap().join("\n");
        assert!(!logs.contains(&token_for_client), "{logs}");
        assert!(!logs.contains(&local), "{logs}");
    }

    #[test]
    fn wrong_missing_and_local_tokens_are_rejected_before_dispatch() {
        let (_dir, remote, local, _) = harness(RemoteScope::Edit);
        let remote_token = remote.current_token();
        let pins = _dir.path().join("pins.json");
        let fingerprint = remote.fingerprint().map(str::to_string);

        for presented in ["", "wrong-sample-value", local.as_str()] {
            let calls = Arc::new(AtomicUsize::new(0));
            let addr = serve_once(
                Arc::clone(&remote),
                local.clone(),
                remote_peer(),
                Ingress::Remote,
                Arc::clone(&calls),
            );
            let err = call_remote(
                &endpoint(
                    addr,
                    &remote,
                    presented,
                    pins.as_path(),
                    fingerprint.clone(),
                ),
                "get_proxy_status",
                Value::Null,
            )
            .unwrap_err();
            assert!(err.contains(UNAUTHORIZED) || err.contains(LOCKED), "{err}");
            assert!(!err.contains(&remote_token), "{err}");
            if presented.len() >= 8 {
                assert!(!err.contains(presented), "{presented} leaked in {err}");
            }
            assert_eq!(calls.load(Ordering::SeqCst), 0, "{presented}");
        }
    }

    #[test]
    fn right_remote_token_runs_and_wrong_version_does_not() {
        let (_dir, remote, local, calls) = harness(RemoteScope::Edit);
        let token = remote.current_token();
        let pins = _dir.path().join("pins.json");
        let fingerprint = remote.fingerprint().map(str::to_string);
        let addr = serve_once(
            Arc::clone(&remote),
            local.clone(),
            remote_peer(),
            Ingress::Remote,
            Arc::clone(&calls),
        );
        let ok = call_remote(
            &endpoint(addr, &remote, &token, pins.as_path(), fingerprint.clone()),
            "get_proxy_status",
            Value::Null,
        )
        .unwrap();
        assert_eq!(ok["command"], "get_proxy_status");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!ok.to_string().contains(&token));

        let calls = Arc::new(AtomicUsize::new(0));
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).unwrap();
        let addr = listener.local_addr().unwrap();
        let remote2 = Arc::clone(&remote);
        let local2 = local.clone();
        let calls2 = Arc::clone(&calls);
        std::thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            let _ = run_command_session(
                socket,
                remote_peer(),
                Ingress::Remote,
                &local2,
                &remote2,
                move |request| {
                    calls2.fetch_add(1, Ordering::SeqCst);
                    ServeResponse::success(request.id.clone(), Value::Null)
                },
            );
        });
        let mut request =
            hg_core::ServeRequest::new("ping", Value::Null).with_token(Some(token.clone()));
        request.protocol_version = Some(PROTOCOL_VERSION + 9);
        let err = send_raw(addr, &remote, &token, &pins, &request).unwrap_err();
        assert!(err.contains("unsupported serve protocol version"), "{err}");
        assert!(err.contains("same release"), "{err}");
        assert!(!err.contains(&token), "{err}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn local_session_accepts_match_and_rejects_mismatch_and_missing_version() {
        let (_dir, remote, local, _) = harness(RemoteScope::Edit);

        let calls = Arc::new(AtomicUsize::new(0));
        let addr = serve_once(
            Arc::clone(&remote),
            local.clone(),
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            Ingress::Local,
            Arc::clone(&calls),
        );
        let matched =
            hg_core::ServeRequest::new("ping", Value::Null).with_token(Some(local.clone()));
        let body = exchange_local(addr, &serde_json::to_string(&matched).unwrap());
        assert!(body.contains("\"ok\":true"), "{body}");
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let calls = Arc::new(AtomicUsize::new(0));
        let addr = serve_once(
            Arc::clone(&remote),
            local.clone(),
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            Ingress::Local,
            Arc::clone(&calls),
        );
        let mut mismatched = matched.clone();
        mismatched.protocol_version = Some(PROTOCOL_VERSION + 4);
        let body = exchange_local(addr, &serde_json::to_string(&mismatched).unwrap());
        assert!(
            body.contains("unsupported serve protocol version"),
            "{body}"
        );
        assert!(body.contains("same release"), "{body}");
        assert!(!body.contains(&local), "{body}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let calls = Arc::new(AtomicUsize::new(0));
        let addr = serve_once(
            Arc::clone(&remote),
            local.clone(),
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            Ingress::Local,
            Arc::clone(&calls),
        );
        let missing = json!({
            "id": "missing",
            "command": "ping",
            "payload": null,
            "token": local,
        });
        let body = exchange_local(addr, &serde_json::to_string(&missing).unwrap());
        assert!(body.contains("missing serve protocol version"), "{body}");
        assert!(body.contains("same release"), "{body}");
        assert!(!body.contains(&local), "{body}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn edit_scope_blocks_privileged_commands_and_admin_allows_them() {
        let (_dir, remote, local, _calls) = harness(RemoteScope::Edit);
        let token = remote.current_token();
        let pins = _dir.path().join("pins.json");
        let fingerprint = remote.fingerprint().map(str::to_string);
        for command in [
            "start_local_proxy",
            "stop_local_proxy",
            "set_system_pac",
            "clear_system_pac",
            "reissue_remote_token",
            "shutdown_serve",
        ] {
            let calls = Arc::new(AtomicUsize::new(0));
            let addr = serve_once(
                Arc::clone(&remote),
                local.clone(),
                remote_peer(),
                Ingress::Remote,
                Arc::clone(&calls),
            );
            let err = call_remote(
                &endpoint(addr, &remote, &token, pins.as_path(), fingerprint.clone()),
                command,
                json!({"allowRemoteAccess": true}),
            )
            .unwrap_err();
            assert!(err.contains(FORBIDDEN), "{command}: {err}");
            assert!(!err.contains(&token), "{err}");
            assert_eq!(calls.load(Ordering::SeqCst), 0, "{command}");
        }

        let calls = Arc::new(AtomicUsize::new(0));
        let addr = serve_once(
            Arc::clone(&remote),
            local.clone(),
            remote_peer(),
            Ingress::Remote,
            Arc::clone(&calls),
        );
        let err = call_remote(
            &endpoint(addr, &remote, &token, pins.as_path(), fingerprint.clone()),
            "update_proxy_settings",
            json!({"allowRemoteAccess": true}),
        )
        .unwrap_err();
        assert!(err.contains(FORBIDDEN), "{err}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let (_dir, admin, local, calls) = harness(RemoteScope::Admin);
        let token = admin.current_token();
        let pins = _dir.path().join("pins.json");
        let fingerprint = admin.fingerprint().map(str::to_string);
        let addr = serve_once(
            Arc::clone(&admin),
            local,
            remote_peer(),
            Ingress::Remote,
            Arc::clone(&calls),
        );
        let ok = call_remote(
            &endpoint(addr, &admin, &token, pins.as_path(), fingerprint),
            "start_local_proxy",
            Value::Null,
        )
        .unwrap();
        assert_eq!(ok["command"], "start_local_proxy");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn repeated_wrong_tokens_lock_that_ip_only() {
        let (_dir, remote, local, _) = harness(RemoteScope::Edit);
        let good = remote.current_token();
        let pins = _dir.path().join("pins.json");
        let fingerprint = remote.fingerprint().map(str::to_string);
        let attacker = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 20));
        let other = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 21));
        for _ in 0..3 {
            let calls = Arc::new(AtomicUsize::new(0));
            let addr = serve_once(
                Arc::clone(&remote),
                local.clone(),
                attacker,
                Ingress::Remote,
                calls,
            );
            let err = call_remote(
                &endpoint(
                    addr,
                    &remote,
                    "wrong-sample-value",
                    pins.as_path(),
                    fingerprint.clone(),
                ),
                "ping",
                Value::Null,
            )
            .unwrap_err();
            assert!(!err.contains("wrong-sample-value"), "{err}");
        }
        let calls = Arc::new(AtomicUsize::new(0));
        let addr = serve_once(
            Arc::clone(&remote),
            local.clone(),
            attacker,
            Ingress::Remote,
            Arc::clone(&calls),
        );
        let locked = call_remote(
            &endpoint(addr, &remote, &good, pins.as_path(), fingerprint.clone()),
            "ping",
            Value::Null,
        )
        .unwrap_err();
        assert!(locked.contains(LOCKED), "{locked}");
        assert!(!locked.contains(&good), "{locked}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let calls = Arc::new(AtomicUsize::new(0));
        let addr = serve_once(
            Arc::clone(&remote),
            local,
            other,
            Ingress::Remote,
            Arc::clone(&calls),
        );
        let ok = call_remote(
            &endpoint(addr, &remote, &good, pins.as_path(), fingerprint),
            "ping",
            Value::Null,
        )
        .unwrap();
        assert_eq!(ok["command"], "ping");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn reissue_drops_live_sessions_and_invalidates_the_old_token() {
        let (_dir, remote, local, _) = harness(RemoteScope::Admin);
        let old = remote.current_token();
        let pins = _dir.path().join("pins.json");
        let fingerprint = remote.fingerprint().map(str::to_string);
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).unwrap();
        let addr = listener.local_addr().unwrap();
        let remote_bg = Arc::clone(&remote);
        let local_bg = local.clone();
        std::thread::spawn(move || {
            for socket in listener.incoming() {
                let socket = match socket {
                    Ok(socket) => socket,
                    Err(_) => continue,
                };
                let remote_bg = Arc::clone(&remote_bg);
                let local_bg = local_bg.clone();
                std::thread::spawn(move || {
                    let _ = run_command_session(
                        socket,
                        remote_peer(),
                        Ingress::Remote,
                        &local_bg,
                        &remote_bg,
                        |request| ServeResponse::success(request.id.clone(), json!({"ok": true})),
                    );
                });
            }
        });

        let mut first = connect_client(addr, &remote, &old, &pins, fingerprint.clone());
        write_request(&mut first, "ping", &old);
        let first_body = read_response(&mut first);
        assert!(first_body.contains("\"ok\":true"), "{first_body}");

        remote.reissue().unwrap();
        let status = remote.status().to_string();
        assert!(!status.contains(&old));
        assert!(!status.contains(&remote.current_token()));
        let new_token = remote.current_token();
        assert_ne!(old, new_token);

        first
            .inner
            .sock
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut buf = [0u8; 32];
        let ended = first.read(&mut buf);
        assert!(
            ended.as_ref().ok().copied().unwrap_or(0) == 0,
            "live session stayed open after reissue: {ended:?}"
        );

        let stale = call_remote(
            &endpoint(addr, &remote, &old, pins.as_path(), fingerprint.clone()),
            "ping",
            Value::Null,
        )
        .unwrap_err();
        assert!(stale.contains(UNAUTHORIZED), "{stale}");
        assert!(!stale.contains(&old), "{stale}");
        assert!(!stale.contains(&new_token), "{stale}");

        let fresh = call_remote(
            &endpoint(addr, &remote, &new_token, pins.as_path(), fingerprint),
            "ping",
            Value::Null,
        )
        .unwrap();
        assert_eq!(fresh["ok"], true);
        assert!(!fresh.to_string().contains(&new_token));
    }

    #[test]
    fn client_does_not_send_the_token_before_tls() {
        let sample = "sample-value-for-plaintext-check";
        let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).unwrap();
        let addr = listener.local_addr().unwrap();
        let reader = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut buf = vec![0u8; 8192];
            let n = socket.read(&mut buf).unwrap_or(0);
            buf.truncate(n);
            buf
        });
        let endpoint = RemoteEndpoint {
            addr,
            pin_key: addr.to_string(),
            token: sample.to_string(),
            fingerprint: Some("ab".repeat(32)),
            pins_path: std::env::temp_dir().join("hg-remote-pins-unused.json"),
        };
        let _ = call_remote(&endpoint, "ping", Value::Null);
        let bytes = reader.join().unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(bytes[0], 0x16, "first byte was not a TLS handshake");
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(&sample), "{text}");
    }

    #[test]
    fn fingerprint_pin_and_tofu_reject_a_different_certificate() {
        let (_dir, remote, local, calls) = harness(RemoteScope::Edit);
        let token = remote.current_token();
        let pins = _dir.path().join("pins.json");
        let addr = serve_once(
            Arc::clone(&remote),
            local.clone(),
            remote_peer(),
            Ingress::Remote,
            Arc::clone(&calls),
        );
        let wrong = "ab".repeat(32);
        let err = call_remote(
            &endpoint(addr, &remote, &token, pins.as_path(), Some(wrong)),
            "ping",
            Value::Null,
        )
        .unwrap_err();
        assert!(err.contains("fingerprint"), "{err}");
        assert!(!err.contains(&token), "{err}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let calls = Arc::new(AtomicUsize::new(0));
        let addr = serve_once(
            Arc::clone(&remote),
            local.clone(),
            remote_peer(),
            Ingress::Remote,
            Arc::clone(&calls),
        );
        let tofu_pins = _dir.path().join("tofu.json");
        let pinned = endpoint_unpinned(addr, &token, tofu_pins.as_path());
        let ok = call_remote(&pinned, "ping", Value::Null).unwrap();
        assert_eq!(ok["command"], "ping");
        let stored = std::fs::read_to_string(&tofu_pins).unwrap();
        assert!(stored.contains(remote.fingerprint().unwrap()));
        assert!(!stored.contains(&token));

        let (_other_dir, other, other_local, _) = harness(RemoteScope::Edit);
        let calls = Arc::new(AtomicUsize::new(0));
        let addr = serve_once(
            Arc::clone(&other),
            other_local,
            remote_peer(),
            Ingress::Remote,
            calls,
        );
        let mut pinned = endpoint_unpinned(addr, &other.current_token(), tofu_pins.as_path());
        pinned.token = other.current_token();
        let err = call_remote(&pinned, "ping", Value::Null).unwrap_err();
        assert!(err.contains("fingerprint"), "{err}");
    }

    #[test]
    fn status_and_errors_do_not_contain_tokens() {
        let (dir, remote, local, _) = harness(RemoteScope::Edit);
        remote.note_ports(17345, 17346);
        let remote_token = remote.current_token();
        let status = remote.status().to_string();
        assert!(status.contains("\"enabled\":true"));
        assert!(status.contains(remote.fingerprint().unwrap()));
        assert!(!status.contains(&remote_token));
        assert!(!status.contains(&local));
        let file =
            std::fs::read_to_string(dir.path().join(crate::serve::remote::REMOTE_TOKEN_FILE))
                .unwrap();
        assert_eq!(file.trim(), remote_token);
        assert!(!status.contains(file.trim()));
    }

    fn exchange_local(addr: SocketAddr, json_line: &str) -> String {
        let mut socket = TcpStream::connect(addr).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut line = json_line.to_string();
        line.push('\n');
        socket.write_all(line.as_bytes()).unwrap();
        socket.flush().unwrap();
        let mut reader = std::io::BufReader::new(socket);
        let mut buf = String::new();
        reader.read_line(&mut buf).unwrap();
        buf
    }

    fn send_raw(
        addr: SocketAddr,
        remote: &RemoteAttach,
        token: &str,
        pins: &std::path::Path,
        request: &ServeRequest,
    ) -> Result<String, String> {
        let endpoint = endpoint(
            addr,
            remote,
            token,
            pins,
            remote.fingerprint().map(str::to_string),
        );
        let mut tls = crate::serve::remote::connect_tls(&endpoint)?;
        let mut line = serde_json::to_string(request).unwrap();
        line.push('\n');
        tls.write_all(line.as_bytes())
            .map_err(|err| err.to_string())?;
        tls.flush().map_err(|err| err.to_string())?;
        let mut buf = Vec::new();
        read_one_line(&mut tls, &mut buf).map_err(|err| err.to_string())?;
        let text = String::from_utf8(buf).map_err(|err| err.to_string())?;
        if text.contains("\"ok\":false") {
            Err(text)
        } else {
            Ok(text)
        }
    }

    struct ClientTls {
        inner: rustls::StreamOwned<rustls::ClientConnection, TcpStream>,
    }

    impl std::io::Read for ClientTls {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.inner.read(buf)
        }
    }

    fn connect_client(
        addr: SocketAddr,
        remote: &RemoteAttach,
        token: &str,
        pins: &std::path::Path,
        fingerprint: Option<String>,
    ) -> ClientTls {
        let endpoint = endpoint(addr, remote, token, pins, fingerprint);
        ClientTls {
            inner: crate::serve::remote::connect_tls(&endpoint).unwrap(),
        }
    }

    fn write_request(client: &mut ClientTls, command: &str, token: &str) {
        let request =
            hg_core::ServeRequest::new(command, Value::Null).with_token(Some(token.to_string()));
        let mut line = serde_json::to_string(&request).unwrap();
        line.push('\n');
        client.inner.write_all(line.as_bytes()).unwrap();
        client.inner.flush().unwrap();
    }

    fn read_response(client: &mut ClientTls) -> String {
        let mut buf = Vec::new();
        read_one_line(&mut client.inner, &mut buf).unwrap();
        String::from_utf8(buf).unwrap()
    }
}
