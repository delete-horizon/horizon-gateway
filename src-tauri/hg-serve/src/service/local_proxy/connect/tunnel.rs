use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

use super::super::access::{is_control_port, is_loopback_host, ClientPeer};
use super::super::routing::{host_in_list, resolve_connect_target};
use super::super::state::ProxyState;
use super::decrypt::handle_connect_tunnel_decrypted;
use super::local::handle_connect_tunnel_local;
use super::passthrough::handle_connect_passthrough;

/// Reply 403 and close. Used when a non-local client asks for a local-only target.
pub(super) async fn refuse_connect(mut client: TcpStream) {
    let _ = client
        .write_all(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
        .await;
}

pub(crate) async fn handle_connect_tunnel(
    client: TcpStream,
    host: String,
    port: u16,
    state: Arc<ProxyState>,
    header_buf: Vec<u8>,
    peer: ClientPeer,
) {
    crate::proxy_log!("CONNECT {}:{}", host, port);

    let remote_client = !peer.is_loopback();
    if remote_client && (is_loopback_host(&host) || is_control_port(port)) {
        crate::proxy_log!("-> CONNECT refused: local-only target for {}", peer.0);
        refuse_connect(client).await;
        return;
    }

    let settings = state.proxy_settings.get();
    if host_in_list(&host, &settings.tls_bypass_hosts) {
        crate::proxy_log!("-> CONNECT TLS bypass for {}", host);
        handle_connect_passthrough(
            client,
            &host,
            port,
            state.resolver.as_ref(),
            header_buf,
            &state,
            peer,
        )
        .await;
        return;
    }

    if host_in_list(&host, &settings.https_decrypt_hosts) {
        crate::proxy_log!("-> CONNECT decryption enabled for {}", host);
        handle_connect_tunnel_decrypted(client, host, state, peer).await;
        return;
    }

    let routes = state.route_service.get_enabled();
    if let Some((target_host, target_port)) = resolve_connect_target(&host, &routes) {
        if remote_client && is_control_port(target_port) {
            refuse_connect(client).await;
            return;
        }
        crate::proxy_log!("-> CONNECT local route -> {}:{}", target_host, target_port);
        handle_connect_tunnel_local(
            client,
            target_host,
            target_port,
            host,
            state,
            header_buf,
            peer,
        )
        .await;
        return;
    }

    crate::proxy_log!("-> CONNECT pass-through (upstream)");
    handle_connect_passthrough(
        client,
        &host,
        port,
        state.resolver.as_ref(),
        header_buf,
        &state,
        peer,
    )
    .await;
}
