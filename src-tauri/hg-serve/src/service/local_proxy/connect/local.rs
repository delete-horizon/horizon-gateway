use hyper::server::conn::http1::Builder as Http1Builder;
use hyper_util::rt::TokioIo;
use hyper_util::service::TowerToHyperService;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio_rustls::TlsAcceptor;

use super::super::access::ClientPeer;
use super::super::io::PrependIo;
use super::super::server::proxy_app_for_peer;
use super::super::state::ProxyState;
use super::super::tls::DynamicCertResolver;

/// TLS-terminate CONNECT and forward HTTP to local backend.
/// Sends `original_host` (e.g. dev.modetour.local) so backend that expects that Host returns 200.
pub(crate) async fn handle_connect_tunnel_local(
    mut client: TcpStream,
    target_host: String,
    target_port: u16,
    original_host: String,
    state: Arc<ProxyState>,
    header_buf: Vec<u8>,
    peer: ClientPeer,
) {
    let response = b"HTTP/1.1 200 Connection Established\r\n\r\n";
    if client.write_all(response).await.is_err() {
        return;
    }
    let body_start = header_buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map_or(header_buf.len(), |i| i + 4);
    let prepend = if body_start < header_buf.len() {
        header_buf[body_start..].to_vec()
    } else {
        vec![]
    };
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(DynamicCertResolver {
            cache: Arc::clone(&state.cert_cache),
        }));
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let tls_stream = match acceptor.accept(PrependIo::new(prepend, client)).await {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("{e:?}");
            if msg.contains("CertificateUnknown") || msg.contains("AlertReceived") {
                crate::proxy_log!("TLS failed: client rejected our certificate (use -k with curl, or install CA from setup page)");
            } else {
                crate::proxy_log!("TLS accept failed: {}", msg);
            }
            return;
        }
    };
    crate::proxy_log!(
        "CONNECT local: TLS done, forwarding to {}:{} (Host: {})",
        target_host,
        target_port,
        original_host
    );
    let io = TokioIo::new(tls_stream);
    let app = proxy_app_for_peer(Arc::clone(&state), "https", peer);
    let svc = TowerToHyperService::new(app);
    let _ = Http1Builder::new()
        .serve_connection(io, svc)
        .with_upgrades()
        .await
        .ok();
}
