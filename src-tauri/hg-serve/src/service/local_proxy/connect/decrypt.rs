use hyper::server::conn::http1::Builder as Http1Builder;
use hyper_util::rt::TokioIo;
use hyper_util::service::TowerToHyperService;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio_rustls::TlsAcceptor;

use super::super::access::ClientPeer;
use super::super::server::proxy_app_for_peer;
use super::super::state::ProxyState;
use super::super::tls::DynamicCertResolver;

/// API 로깅: CONNECT 대상을 TLS 종료한 뒤 `proxy_app으로` HTTP 전달 (로깅·포워드 가능).
pub(crate) async fn handle_connect_tunnel_decrypted(
    mut client: TcpStream,
    _host: String,
    state: Arc<ProxyState>,
    peer: ClientPeer,
) {
    let response = b"HTTP/1.1 200 Connection Established\r\n\r\n";
    if client.write_all(response).await.is_err() {
        return;
    }
    if client.flush().await.is_err() {
        return;
    }
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(DynamicCertResolver {
            cache: Arc::clone(&state.cert_cache),
        }));
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let tls_stream = match acceptor.accept(client).await {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("{e:?}");
            if !msg.contains("UnexpectedEof") {
                crate::proxy_log!("TLS accept (api-logging) failed: {}", msg);
            }
            return;
        }
    };
    let io = TokioIo::new(tls_stream);
    let app = proxy_app_for_peer(Arc::clone(&state), "https", peer);
    let svc = TowerToHyperService::new(app);
    let _ = Http1Builder::new()
        .serve_connection(io, svc)
        .with_upgrades()
        .await
        .ok();
}
