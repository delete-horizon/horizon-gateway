use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;

use super::super::access::ClientPeer;
use super::super::state::ProxyState;
use super::pipeline::proxy_handler_inner;

pub(crate) async fn proxy_handler(
    state: State<Arc<ProxyState>>,
    ext: axum::Extension<&'static str>,
    peer: axum::Extension<ClientPeer>,
    req: Request,
) -> Response {
    if !state.proxy_settings.get().cors_rewrite_enabled {
        return proxy_handler_inner(state, ext, peer, req).await;
    }

    let req_headers = req.headers().clone();
    let origin = req_headers
        .get(header::ORIGIN)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("*"));

    // 1. Handle Preflight OPTIONS
    if req.method() == hyper::Method::OPTIONS {
        let mut res_headers = HeaderMap::new();
        res_headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
        res_headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS, PATCH"),
        );

        // Echo back requested headers to be permissive
        if let Some(req_hdrs) = req_headers.get(header::ACCESS_CONTROL_REQUEST_HEADERS) {
            res_headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, req_hdrs.clone());
        } else {
            res_headers.insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static("*"),
            );
        }

        // Broad compatibility for credentials (only if origin is not *)
        if origin != "*" {
            res_headers.insert(
                header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
                HeaderValue::from_static("true"),
            );
        }

        return (StatusCode::OK, res_headers, Body::empty()).into_response();
    }

    // 2. Handle actual request
    let mut response = proxy_handler_inner(state, ext, peer, req).await;

    // 3. Skip CORS for WebSocket Upgrades (101 Switching Protocols)
    // Adding CORS headers to 101 responses can cause browser to fail the handshake.
    if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        return response;
    }

    // 4. Inject CORS headers into the response
    let res_headers = response.headers_mut();
    res_headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.clone());
    res_headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS, PATCH"),
    );

    if let Some(req_hdrs) = req_headers.get(header::ACCESS_CONTROL_REQUEST_HEADERS) {
        res_headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, req_hdrs.clone());
    } else {
        res_headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("*"),
        );
    }

    if origin != "*" {
        res_headers.insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            HeaderValue::from_static("true"),
        );
    }

    // Expose headers so extensions/scripts can read them
    res_headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("*"),
    );

    // Add Vary: Origin to avoid caching issues with CORS
    res_headers.append(header::VARY, HeaderValue::from_static("Origin"));

    response
}
