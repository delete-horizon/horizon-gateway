use axum::{routing::any, Router};
use hyper::server::conn::http1::Builder as Http1Builder;
use hyper_util::rt::TokioIo;
use hyper_util::service::TowerToHyperService;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use tokio::task::JoinHandle;
use tokio_rustls::TlsAcceptor;

use crate::service::api_log_service::ApiLogService;
use crate::service::ca_service::CaService;
use crate::service::local_route_service::LocalRouteService;
use crate::service::proxy_settings_service::ProxySettingsService;

use super::super::access::{is_peer_allowed, listen_ip, ClientPeer};
use super::super::connect::handle_connect_tunnel;
use super::super::handler::proxy_handler;
use super::super::io::{parse_connect_target, read_request_headers, PrependIo};
use super::super::state::ProxyState;
use super::super::tls::DynamicCertResolver;

/// Build shared app (Router + state) for `proxy_handler`.
pub(crate) fn proxy_app(state: Arc<ProxyState>, scheme: &'static str) -> Router {
    Router::new()
        .route("/", any(proxy_handler))
        .route("/*path", any(proxy_handler))
        .with_state(state)
        .layer(axum::Extension(scheme))
}

/// Router for one client connection: proxied requests carry the client address.
pub(crate) fn proxy_app_for_peer(
    state: Arc<ProxyState>,
    scheme: &'static str,
    peer: ClientPeer,
) -> Router {
    proxy_app(state, scheme).layer(axum::Extension(peer))
}

/// Bind and run the proxy. Returns the `JoinHandle` (so the caller can abort it) and the bound address.
/// Binds 127.0.0.1 unless remote access is enabled in proxy settings (then 0.0.0.0 with a peer allowlist).
/// Handles CONNECT (HTTPS tunnel) and regular HTTP; when `dns_server` is set, pass-through hosts are resolved via it.
#[allow(clippy::too_many_arguments)]
pub async fn run_proxy(
    app_handle: Option<()>,
    port: u16,
    route_service: Arc<LocalRouteService>,
    dns_server: Option<String>,
    api_logging_map: Arc<RwLock<HashMap<String, (bool, bool)>>>,
    api_log_service: Arc<ApiLogService>,
    ca_service: Arc<CaService>,
    mocking_service: Arc<crate::service::mocking_service::MockingService>,
    inspector_service: Arc<crate::service::inspector_service::InspectorService>,
    domain_service: Arc<crate::service::domain_service::DomainService>,
    proxy_settings: Arc<ProxySettingsService>,
) -> std::io::Result<(JoinHandle<()>, SocketAddr)> {
    // Remote access (Tailscale / LAN mobile devices) is opt-in; see `access` for the peer allowlist.
    let addr = SocketAddr::new(listen_ip(proxy_settings.get().allow_remote_access), port);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;
    let state = Arc::new(ProxyState::new(
        app_handle,
        route_service,
        dns_server,
        Some(port),
        api_logging_map,
        api_log_service,
        ca_service,
        mocking_service,
        inspector_service,
        domain_service,
        proxy_settings,
    ));
    let app = proxy_app(Arc::clone(&state), "http");
    let handle = tokio::spawn(async move {
        loop {
            let Ok((stream, peer_addr)) = listener.accept().await else {
                continue;
            };
            // Read live so turning remote access off applies before the next restart.
            if !is_peer_allowed(
                peer_addr.ip(),
                state.proxy_settings.get().allow_remote_access,
            ) {
                crate::proxy_log!("refused client {}", peer_addr.ip());
                continue;
            }
            let peer = ClientPeer(peer_addr.ip());
            let state = Arc::clone(&state);
            let app = app.clone().layer(axum::Extension(peer));
            tokio::spawn(async move {
                let mut stream = stream;
                let Ok(buf) = read_request_headers(&mut stream).await else {
                    return;
                };
                let first_line = buf
                    .splitn(2, |&c| c == b'\n')
                    .next()
                    .and_then(|line| std::str::from_utf8(line).ok())
                    .unwrap_or("")
                    .trim_end_matches('\r')
                    .trim();
                if let Some((host, port)) = parse_connect_target(first_line) {
                    handle_connect_tunnel(stream, host, port, state, buf, peer).await;
                } else {
                    let io = TokioIo::new(PrependIo::new(buf, stream));
                    let svc = TowerToHyperService::new(app);
                    let _ = Http1Builder::new()
                        .serve_connection(io, svc)
                        .with_upgrades()
                        .await
                        .ok();
                }
            });
        }
    });

    Ok((handle, bound))
}

/// Reverse HTTP listener: no system proxy. Client connects directly (e.g. hosts 127.0.0.1 dev.example.local, then http://dev.example.local:port).
/// Requests are origin-form (GET /path); routing by Host header.
/// `forward_proxy_port`: port of the main (forward) proxy, for PAC generation.
#[allow(clippy::too_many_arguments)]
pub async fn run_reverse_proxy_http(
    app_handle: Option<()>,
    port: u16,
    route_service: Arc<LocalRouteService>,
    dns_server: Option<String>,
    forward_proxy_port: Option<u16>,
    api_logging_map: Arc<RwLock<HashMap<String, (bool, bool)>>>,
    api_log_service: Arc<ApiLogService>,
    ca_service: Arc<CaService>,
    mocking_service: Arc<crate::service::mocking_service::MockingService>,
    inspector_service: Arc<crate::service::inspector_service::InspectorService>,
    domain_service: Arc<crate::service::domain_service::DomainService>,
    proxy_settings: Arc<ProxySettingsService>,
) -> std::io::Result<JoinHandle<()>> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let state = Arc::new(ProxyState::new(
        app_handle,
        route_service,
        dns_server,
        forward_proxy_port,
        api_logging_map,
        api_log_service,
        ca_service,
        mocking_service,
        inspector_service,
        domain_service,
        proxy_settings,
    ));
    let app = proxy_app(Arc::clone(&state), "http");
    let handle = tokio::spawn(async move {
        loop {
            let Ok((stream, peer_addr)) = listener.accept().await else {
                continue;
            };
            let app = app
                .clone()
                .layer(axum::Extension(ClientPeer(peer_addr.ip())));
            tokio::spawn(async move {
                let io = TokioIo::new(stream);
                let svc = TowerToHyperService::new(app);
                let _ = Http1Builder::new()
                    .serve_connection(io, svc)
                    .with_upgrades()
                    .await
                    .ok();
            });
        }
    });

    Ok(handle)
}

/// Reverse HTTPS listener: TLS termination by Host (SNI), then forward by Host. Use https://dev.example.local:port with hosts.
/// `forward_proxy_port`: port of the main (forward) proxy, for PAC generation.
#[allow(clippy::too_many_arguments)]
pub async fn run_reverse_proxy_https(
    app_handle: Option<()>,
    port: u16,
    route_service: Arc<LocalRouteService>,
    dns_server: Option<String>,
    forward_proxy_port: Option<u16>,
    api_logging_map: Arc<RwLock<HashMap<String, (bool, bool)>>>,
    api_log_service: Arc<ApiLogService>,
    ca_service: Arc<CaService>,
    mocking_service: Arc<crate::service::mocking_service::MockingService>,
    inspector_service: Arc<crate::service::inspector_service::InspectorService>,
    domain_service: Arc<crate::service::domain_service::DomainService>,
    proxy_settings: Arc<ProxySettingsService>,
) -> std::io::Result<JoinHandle<()>> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let state = Arc::new(ProxyState::new(
        app_handle,
        route_service,
        dns_server,
        forward_proxy_port,
        api_logging_map,
        api_log_service,
        ca_service,
        mocking_service,
        inspector_service,
        domain_service,
        proxy_settings,
    ));
    let app = proxy_app(Arc::clone(&state), "https");
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(DynamicCertResolver {
            cache: Arc::clone(&state.cert_cache),
        }));
    let acceptor = TlsAcceptor::from(Arc::new(config));

    let handle = tokio::spawn(async move {
        loop {
            let Ok((stream, peer_addr)) = listener.accept().await else {
                continue;
            };
            let acceptor = acceptor.clone();
            let app = app
                .clone()
                .layer(axum::Extension(ClientPeer(peer_addr.ip())));
            tokio::spawn(async move {
                let Ok(tls_stream) = acceptor.accept(stream).await else {
                    return;
                };
                let io = TokioIo::new(tls_stream);
                let svc = TowerToHyperService::new(app);
                let _ = Http1Builder::new()
                    .serve_connection(io, svc)
                    .with_upgrades()
                    .await
                    .ok();
            });
        }
    });

    Ok(handle)
}
