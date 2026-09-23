use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use hyper_util::rt::TokioIo;
use std::sync::Arc;

use super::super::state::ProxyState;

const HOP_BY_HOP_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "proxy-connection",
    "accept-encoding",
];

pub(crate) fn is_websocket_upgrade(req: &Request) -> bool {
    req.headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|s| s.to_lowercase() == "websocket")
}

/// Handles a WebSocket upgrade request. Call only when `is_websocket_upgrade` is true.
pub(crate) async fn handle_websocket_upgrade(
    state: &Arc<ProxyState>,
    req: Request,
    local_origin: Option<&(String, u16, String)>,
    target_uri: &Uri,
    target_uri_str: &str,
    host_h: &str,
    uri: &Uri,
) -> Response {
    crate::proxy_log!("-> upgrade request (WebSocket) for {}", uri);

    if let Some((ref target_host, target_port, _)) = local_origin {
        return handle_local_websocket_upgrade(req, target_host, *target_port, target_uri, host_h)
            .await;
    }

    handle_passthrough_websocket_upgrade(state, req, target_uri_str).await
}

async fn handle_local_websocket_upgrade(
    req: Request,
    target_host: &str,
    target_port: u16,
    target_uri: &Uri,
    host_h: &str,
) -> Response {
    let target_host_header = format!("{target_host}:{target_port}");
    crate::proxy_log!(
        "-> WS routing (Raw Hyper): Target Host: {}, Original Host: {}",
        target_host_header,
        host_h
    );

    let target_host_clean = if target_host.eq_ignore_ascii_case("localhost") {
        "127.0.0.1"
    } else {
        target_host
    };

    let stream =
        match tokio::net::TcpStream::connect(format!("{target_host_clean}:{target_port}")).await {
            Ok(s) => s,
            Err(e) => {
                crate::proxy_log!(
                    "❌ [WS] Failed to connect to upstream {}:{}: {}",
                    target_host,
                    target_port,
                    e
                );
                return (
                    StatusCode::BAD_GATEWAY,
                    format!("Proxy WS connect error: {e}"),
                )
                    .into_response();
            }
        };

    let io = TokioIo::new(stream);
    let (mut sender, conn) = match hyper::client::conn::http1::handshake(io).await {
        Ok(c) => c,
        Err(e) => {
            crate::proxy_log!("❌ [WS] Upstream handshake error: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                format!("Proxy WS handshake error: {e}"),
            )
                .into_response();
        }
    };

    tokio::spawn(async move {
        if let Err(err) = conn.with_upgrades().await {
            crate::proxy_log!("ℹ️ [WS] Upstream connection task error: {:?}", err);
        }
    });

    let mut upstream_req = Request::new(Body::empty());
    *upstream_req.method_mut() = req.method().clone();
    if let Some(pq) = target_uri.path_and_query() {
        if let Ok(uri) = pq.as_str().parse::<Uri>() {
            *upstream_req.uri_mut() = uri;
        }
    } else {
        *upstream_req.uri_mut() = target_uri.clone();
    }
    *upstream_req.version_mut() = hyper::Version::HTTP_11;

    let headers = upstream_req.headers_mut();
    for (name, value) in req.headers() {
        let name_str = name.as_str().to_lowercase();
        if name_str != "host" && !HOP_BY_HOP_HEADERS.contains(&name_str.as_str()) {
            headers.insert(name.clone(), value.clone());
        }
    }

    if let Ok(hv) = HeaderValue::from_str(&target_host_header) {
        headers.insert(header::HOST, hv);
    }
    headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
    headers.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));

    let target_origin = format!("http://{target_host}:{target_port}");
    if let Ok(hv) = HeaderValue::from_str(&target_origin) {
        headers.insert(header::ORIGIN, hv);
    }

    match sender.send_request(upstream_req).await {
        Ok(res) if res.status() == StatusCode::SWITCHING_PROTOCOLS => {
            crate::proxy_log!(
                "✅ [WS] Upstream handshake success (101). Headers: {:?}",
                res.headers()
            );

            let mut res_builder = Response::builder().status(StatusCode::SWITCHING_PROTOCOLS);
            if let Some(h) = res_builder.headers_mut() {
                for (k, v) in res.headers() {
                    let k_str = k.as_str().to_lowercase();
                    if !HOP_BY_HOP_HEADERS.contains(&k_str.as_str()) {
                        h.insert(k, v.clone());
                    }
                }
                h.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
                h.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
            }

            let (parts, _) = req.into_parts();
            let upgraded_client =
                hyper::upgrade::on(axum::http::Request::from_parts(parts, Body::empty()));

            tokio::spawn(async move {
                crate::proxy_log!("🚀 [WS] Starting bidirectional copy...");
                let mut upstream_io = match hyper::upgrade::on(res).await {
                    Ok(upgraded) => TokioIo::new(upgraded),
                    Err(e) => {
                        crate::proxy_log!("❌ [WS] Upstream upgrade failed (after 101): {e}");
                        return;
                    }
                };

                let mut client_io = match upgraded_client.await {
                    Ok(upgraded) => TokioIo::new(upgraded),
                    Err(e) => {
                        crate::proxy_log!("❌ [WS] Client upgrade failed (after 101): {e}");
                        return;
                    }
                };

                match tokio::io::copy_bidirectional(&mut client_io, &mut upstream_io).await {
                    Ok(_) => crate::proxy_log!("✅ [WS] Tunnel closed normally."),
                    Err(e) => crate::proxy_log!("ℹ️ [WS] Tunnel closed: {e}"),
                }
            });

            res_builder
                .body(Body::empty())
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Ok(res) => {
            crate::proxy_log!(
                "❌ [WS] Upstream refused upgrade. Status: {}, Headers: {:?}",
                res.status(),
                res.headers()
            );
            let status = res.status();
            let mut res_builder = Response::builder().status(status);
            if let Some(h) = res_builder.headers_mut() {
                for (k, v) in res.headers() {
                    h.insert(k, v.clone());
                }
            }
            let body_bytes = axum::body::to_bytes(Body::new(res.into_body()), usize::MAX)
                .await
                .unwrap_or_default();
            res_builder
                .body(Body::from(body_bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            crate::proxy_log!("❌ [WS] Upstream connection error: {e}");
            (StatusCode::BAD_GATEWAY, format!("Proxy WS error: {e}")).into_response()
        }
    }
}

async fn handle_passthrough_websocket_upgrade(
    state: &Arc<ProxyState>,
    req: Request,
    target_uri_str: &str,
) -> Response {
    let mut req_builder = state
        .reqwest_client_direct
        .request(req.method().clone(), target_uri_str);
    req_builder = req_builder.version(reqwest::Version::HTTP_11);

    for (name, value) in req.headers() {
        let name_str = name.as_str().to_lowercase();
        if name_str != "host" && !HOP_BY_HOP_HEADERS.contains(&name_str.as_str()) {
            req_builder = req_builder.header(name, value);
        }
    }
    req_builder = req_builder.header(header::UPGRADE, "websocket");
    req_builder = req_builder.header(header::CONNECTION, "upgrade");

    crate::proxy_log!(
        "-> WS handshake request headers (Pass-through): {:?}",
        req.headers()
    );

    match req_builder.send().await {
        Ok(res) if res.status() == StatusCode::SWITCHING_PROTOCOLS => {
            crate::proxy_log!(
                "✅ [WS] Upstream handshake success (101). Headers: {:?}",
                res.headers()
            );

            let mut res_builder = Response::builder().status(StatusCode::SWITCHING_PROTOCOLS);
            if let Some(h) = res_builder.headers_mut() {
                for (k, v) in res.headers() {
                    let k_str = k.as_str().to_lowercase();
                    if !HOP_BY_HOP_HEADERS.contains(&k_str.as_str()) {
                        h.insert(k, v.clone());
                    }
                }
                h.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
                h.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
            }

            let (parts, _) = req.into_parts();
            let upgraded_client =
                hyper::upgrade::on(axum::http::Request::from_parts(parts, Body::empty()));

            tokio::spawn(async move {
                crate::proxy_log!("🚀 [WS] Starting bidirectional copy...");
                let mut upstream_io = match res.upgrade().await {
                    Ok(upgraded) => upgraded,
                    Err(e) => {
                        crate::proxy_log!("❌ [WS] Upstream upgrade failed (after 101): {e}");
                        return;
                    }
                };

                let mut client_io = match upgraded_client.await {
                    Ok(upgraded) => TokioIo::new(upgraded),
                    Err(e) => {
                        crate::proxy_log!("❌ [WS] Client upgrade failed (after 101): {e}");
                        return;
                    }
                };

                match tokio::io::copy_bidirectional(&mut client_io, &mut upstream_io).await {
                    Ok(_) => crate::proxy_log!("✅ [WS] Tunnel closed normally."),
                    Err(e) => crate::proxy_log!("ℹ️ [WS] Tunnel closed: {e}"),
                }
            });

            res_builder
                .body(Body::empty())
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Ok(res) => {
            crate::proxy_log!(
                "❌ [WS] Upstream refused upgrade. Status: {}, Headers: {:?}",
                res.status(),
                res.headers()
            );
            let status = res.status();
            let mut res_builder = Response::builder().status(status);
            if let Some(h) = res_builder.headers_mut() {
                for (k, v) in res.headers() {
                    h.insert(k, v.clone());
                }
            }
            let body_bytes = res.bytes().await.unwrap_or_default();
            res_builder
                .body(Body::from(body_bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            crate::proxy_log!("❌ [WS] Upstream connection error: {e}");
            (StatusCode::BAD_GATEWAY, format!("Proxy WS error: {e}")).into_response()
        }
    }
}
