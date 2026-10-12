use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::sync::Arc;

use hg_core::{ServeRequest, ServeResponse, SERVE_TCP_PORT};

use crate::cli;
use crate::runtime::{bootstrap_app_context, AppContext, CliRuntime};

/// Blocking entry for the `horizon-gateway-serve` binary.
pub fn run_serve() -> i32 {
    crate::install_rustls_provider();
    super::logging::init_serve_logging();

    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            tracing::error!("failed to start async runtime: {e}");
            return 1;
        }
    };

    match serve_loop(rt) {
        Ok(()) => 0,
        Err(e) => {
            tracing::error!("serve exited with error: {e}");
            1
        }
    }
}

/// Env var that selects headless process mode. Desktop sidecar spawn does not set this.
/// The process shape is the same either way: this binary never starts a tray.
/// The flag only keeps the log line the headless CI smoke looks for.
const HG_SERVE_HEADLESS_ENV: &str = "HG_SERVE_HEADLESS";

fn headless_flag_set(env_value: Option<&str>) -> bool {
    env_value == Some("1")
}

fn serve_loop(rt: tokio::runtime::Runtime) -> Result<(), String> {
    let rt = Arc::new(rt);
    let ctx = Arc::new(bootstrap_app_context()?);

    ctx.inspector_service
        .sync_registered_domains(&ctx.domain_service.get_all());
    crate::service::transparent_proxy_service::TransparentProxyService::ensure_runtime_sidecars();

    let route_svc = Arc::clone(&ctx.local_route_service);
    let proxy_settings_service = Arc::clone(&ctx.proxy_settings_service);
    let proxy_settings_snapshot = proxy_settings_service.get();
    let api_logging_map = ctx.api_logging_service.settings_map_arc();
    let api_log_service = Arc::new(ctx.api_log_service.clone());
    let ca_service = Arc::clone(&ctx.ca_service);
    let mocking_service = Arc::clone(&ctx.mocking_service);
    let inspector_service = ctx.inspector_service.clone();
    let domain_service = Arc::new(ctx.domain_service.clone());

    let token: Arc<str> = super::auth::generate_token().into();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let remote_cfg = super::remote::RemoteAttachConfig::from_process(&args, &ctx.app_data_dir)?;
    let remote = super::remote::RemoteAttach::bootstrap(&ctx.app_data_dir, &remote_cfg, &token)?;
    super::remote::install_global(Arc::clone(&remote));

    let event_bus = super::events::ServeEventBus::new();
    super::events::ServeEventBus::init_global(Arc::clone(&event_bus));

    let listener = bind_serve_socket(SERVE_TCP_PORT, remote.listen_ip())?;
    let command_addr = listener
        .local_addr()
        .map_err(|err| format!("serve socket has no local address: {err}"))?;
    let event_addr =
        super::events::start_event_listener(event_bus, Arc::clone(&token), Arc::clone(&remote))?;
    remote.note_ports(command_addr.port(), event_addr.port());

    // Publish only after both sockets are ours, so a second instance never replaces the token.
    // Local clients keep the loopback address. Remote bind details are omitted unless enabled.
    super::endpoints::publish(super::endpoints::PublishedBind {
        command: command_addr,
        event: event_addr,
        remote_fingerprint: remote.fingerprint().map(ToOwned::to_owned),
    })?;
    super::auth::publish_token(&token)?;
    if remote.enabled() {
        if let Some(warning) = super::remote::all_interfaces_warning(command_addr.ip()) {
            tracing::warn!("{warning}");
        }
        tracing::info!(
            "[serve] listening on {command_addr} (events {event_addr}); remote attach tls fingerprint {} scope {} bind {}",
            remote.fingerprint().unwrap_or(""),
            remote.scope_name(),
            command_addr.ip(),
        );
    } else {
        tracing::info!("[serve] listening on {command_addr} (events {event_addr})");
    }

    rt.spawn(async move {
        if let Err(e) = crate::command::local_route_commands::auto_start_proxy(
            None,
            route_svc,
            &proxy_settings_snapshot,
            api_logging_map,
            api_log_service,
            ca_service,
            mocking_service,
            inspector_service,
            domain_service,
            proxy_settings_service,
        )
        .await
        {
            tracing::warn!("[serve] auto-start proxy failed: {e}");
        }
    });

    // Background domain monitor task
    {
        let ctx_clone = Arc::clone(&ctx);
        rt.spawn(async move {
            loop {
                let _ = ctx_clone
                    .monitor_service
                    .check_domains(
                        &ctx_clone.domain_service,
                        &ctx_clone.group_service,
                        &ctx_clone.link_service,
                        &ctx_clone.proxy_settings_service,
                    )
                    .await;
                tracing::info!("[serve] background domain status check completed");
                tokio::time::sleep(std::time::Duration::from_secs(120)).await;
            }
        });
    }

    // Annotation watcher task
    {
        let ctx_clone = Arc::clone(&ctx);
        rt.spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                if ctx_clone.inspector_service.reload_if_stale() {
                    tracing::info!("[serve] annotations file changed on disk; reloaded");
                    super::events::publish_event("annotations-updated", ());
                }
            }
        });
    }

    // Tunnel Axum server task
    {
        let ctx_clone = Arc::clone(&ctx);
        rt.spawn(async move {
            let proxy_settings = Arc::clone(&ctx_clone.proxy_settings_service);
            if let Err(e) = ctx_clone
                .tunnel_service
                .start_axum_server(proxy_settings)
                .await
            {
                tracing::error!("[serve] Axum server failed: {e}");
            }
        });
    }

    // The desktop shell owns the tray, including the macOS main-thread constraint.
    // This process only accepts IPC, on every OS. `HG_SERVE_HEADLESS=1` does not
    // change that shape; it keeps the log line the CI smoke asserts.
    if headless_flag_set(std::env::var(HG_SERVE_HEADLESS_ENV).ok().as_deref()) {
        tracing::info!(
            "[serve] headless: tray and GUI spawn skipped; IPC accept loop holds the process"
        );
    } else {
        tracing::info!("[serve] desktop shell owns the tray; IPC accept loop holds the process");
    }
    accept_loop(listener, ctx, rt, token, remote);
    Ok(())
}

fn accept_loop(
    listener: TcpListener,
    ctx: Arc<AppContext>,
    rt: Arc<tokio::runtime::Runtime>,
    token: Arc<str>,
    remote: Arc<super::remote::RemoteAttach>,
) {
    for stream in listener.incoming() {
        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("[serve] accept failed: {e}");
                continue;
            }
        };
        let peer = stream.peer_addr().ok();
        let ip = peer
            .map(|addr| addr.ip())
            .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        let ingress = match peer {
            Some(addr) => super::remote::ingress_for(addr.ip(), remote.enabled()),
            None if remote.enabled() => super::remote::Ingress::Remote,
            None => super::remote::Ingress::Local,
        };
        let ctx = Arc::clone(&ctx);
        let rt = Arc::clone(&rt);
        let token = Arc::clone(&token);
        let remote = Arc::clone(&remote);
        std::thread::spawn(move || {
            if let Err(err) = super::session::run_command_session(
                stream,
                ip,
                ingress,
                token.as_ref(),
                remote.as_ref(),
                |request| dispatch_serve_request(request, ctx.as_ref(), rt.as_ref()),
            ) {
                tracing::warn!("[serve] client session error: {}", remote.redact(&err));
            }
        });
    }
}

/// Loopback when remote attach is off. Otherwise bind `remote`, which is
/// `0.0.0.0` only when no address was configured.
pub(crate) fn bind_serve_socket(
    preferred: u16,
    remote: Option<IpAddr>,
) -> Result<TcpListener, String> {
    match remote {
        Some(ip) => super::remote::bind_remote(ip, preferred),
        None => bind_loopback(preferred),
    }
}

/// Bind `127.0.0.1:preferred`. If that port is taken, bind an ephemeral loopback port.
pub(crate) fn bind_loopback(preferred: u16) -> Result<TcpListener, String> {
    let preferred_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, preferred));
    match TcpListener::bind(preferred_addr) {
        Ok(listener) => Ok(listener),
        Err(err) => {
            tracing::warn!(
                "[serve] {preferred_addr} unavailable ({err}); binding an ephemeral loopback port"
            );
            let fallback = SocketAddr::from((Ipv4Addr::LOCALHOST, 0));
            TcpListener::bind(fallback)
                .map_err(|bind_err| format!("failed to bind serve socket {fallback}: {bind_err}"))
        }
    }
}

fn shutdown_serve_process() {
    let _ = crate::command::local_route_commands::stop_local_proxy_svc(None);
    let _ = crate::command::transparent_proxy_commands::stop_transparent_proxy_svc();
    super::events::publish_event("serve-stopping", ());
    std::thread::sleep(std::time::Duration::from_millis(250));
    std::process::exit(0);
}

fn dispatch_serve_request(
    request: &ServeRequest,
    ctx: &AppContext,
    rt: &tokio::runtime::Runtime,
) -> ServeResponse {
    if request.command == "ping" {
        return ServeResponse::success(
            request.id.clone(),
            serde_json::json!({
                "mode": "serve",
                "ok": true,
                "version": env!("CARGO_PKG_VERSION"),
                "commandAddr": super::endpoints::command_addr(),
                "eventAddr": super::endpoints::event_addr(),
            }),
        );
    }

    if request.command == "shutdown_serve" {
        // Reply first so the GUI can observe success, then exit this process.
        // OS PAC is cleared by the shell before it asks serve to stop.
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            shutdown_serve_process();
        });
        return ServeResponse::success(
            request.id.clone(),
            serde_json::json!({ "ok": true, "stopping": true }),
        );
    }

    let runtime = CliRuntime::Tokio(rt);
    match cli::dispatch_headless::dispatch_headless(
        &request.command,
        request.payload.clone(),
        ctx,
        &runtime,
    ) {
        Ok(data) => ServeResponse::success(request.id.clone(), data),
        Err(err) => ServeResponse::failure(request.id.clone(), err),
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, SocketAddr, TcpListener};

    use super::{bind_loopback, headless_flag_set, HG_SERVE_HEADLESS_ENV};

    #[test]
    fn default_path_matches_headless_without_a_tray() {
        assert_eq!(HG_SERVE_HEADLESS_ENV, "HG_SERVE_HEADLESS");
        assert!(!headless_flag_set(None));
        assert!(!headless_flag_set(Some("")));
        assert!(!headless_flag_set(Some("0")));
        assert!(!headless_flag_set(Some("true")));
        assert!(headless_flag_set(Some("1")));

        let src = include_str!("server.rs");
        let tray_start = ["tray", "::start"].concat();
        assert!(
            !src.contains(&tray_start),
            "serve must not start a tray; the desktop shell owns it"
        );
    }

    #[test]
    fn occupied_preferred_port_binds_another_loopback_port() {
        let held = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).expect("hold");
        let preferred = held.local_addr().expect("held addr").port();
        let bound = bind_loopback(preferred).expect("fallback");
        let actual = bound.local_addr().expect("bound addr");
        assert!(actual.ip().is_loopback());
        assert_ne!(actual.port(), preferred);
        assert_ne!(preferred, 0);
    }
}
