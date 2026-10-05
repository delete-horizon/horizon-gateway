use axum::{
    extract::{Request, State},
    http::{StatusCode, Uri},
    response::{IntoResponse, Response},
};
use std::sync::Arc;

use super::super::access::{is_control_port, is_local_ip, is_loopback_host, ClientPeer};
use super::super::reserved::is_horizon_gateway_internal;
use super::super::routing::{
    get_logging_config_for_host, host_key_for_logging_map, resolve_target,
};
use super::super::state::ProxyState;
use super::api::try_handle_api;
use super::capture::handle_with_logging;
use super::forward::handle_pass_through;
use super::mocking::try_mock_response;
use super::websocket::{handle_websocket_upgrade, is_websocket_upgrade};

/// Literal check on the requested authority (absolute-form URI, else Host header).
fn requests_local_only_target(uri: &Uri, host_header: Option<&str>) -> bool {
    let authority = uri
        .authority()
        .map(axum::http::uri::Authority::as_str)
        .or(host_header)
        .unwrap_or("");
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    let port = authority
        .rsplit_once(':')
        .filter(|(h, _)| !h.contains(':') || h.ends_with(']'))
        .and_then(|(_, p)| p.parse::<u16>().ok());
    is_loopback_host(authority) || port.is_some_and(is_control_port)
}

/// Pass-through target whose name resolves to this machine's loopback (or a serve IPC port).
async fn resolves_to_local_only_target(target: &Uri) -> bool {
    let Some(host) = target.host() else {
        return false;
    };
    let port = target
        .port_u16()
        .unwrap_or(if target.scheme_str() == Some("https") {
            443
        } else {
            80
        });
    if is_control_port(port) {
        return true;
    }
    let host = host.trim_start_matches('[').trim_end_matches(']');
    tokio::net::lookup_host((host, port))
        .await
        .is_ok_and(|mut addrs| addrs.any(|a| is_local_ip(a.ip())))
}

fn forbidden() -> Response {
    (StatusCode::FORBIDDEN, "Forbidden").into_response()
}

pub(crate) async fn proxy_handler_inner(
    State(state): State<Arc<ProxyState>>,
    axum::Extension(scheme): axum::Extension<&'static str>,
    axum::Extension(peer): axum::Extension<ClientPeer>,
    req: Request,
) -> Response {
    let method = req.method().to_string();
    let uri = req.uri().clone();
    let path = uri.path();

    let mut req = match try_handle_api(&state, req, path, &uri).await {
        Ok(response) => return response,
        Err(r) => r,
    };

    let host_h = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .map(std::string::ToString::to_string)
        .unwrap_or_default();
    crate::proxy_log!("request {} {} Host: {}", method, uri, host_h);

    let remote_client = !peer.is_loopback();
    if remote_client && requests_local_only_target(&uri, Some(host_h.as_str())) {
        crate::proxy_log!("-> refused: local-only target for {}", peer.0);
        return forbidden();
    }

    if let Some(response) = try_mock_response(&state, &req, &method, &uri, path, &host_h) {
        return response;
    }

    let host_header = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .map(std::string::ToString::to_string);
    let routes = state.route_service.get_enabled();
    let (target_uri_str, _pass_through_host, _target_host_value, local_origin) =
        resolve_target(&uri, host_header.as_deref(), &routes, scheme);

    if let Some((ref target_host, target_port, ref path_query)) = local_origin {
        crate::proxy_log!(
            "-> local route -> {}:{} path: {}",
            target_host,
            target_port,
            path_query
        );
    }
    let Ok(target_uri) = Uri::try_from(target_uri_str.as_str()) else {
        return (StatusCode::BAD_REQUEST, "Invalid target URI").into_response();
    };

    if remote_client {
        // Registered local routes stay usable from other devices; the serve IPC ports never are.
        let refused = match &local_origin {
            Some((_, target_port, _)) => is_control_port(*target_port),
            None => resolves_to_local_only_target(&target_uri).await,
        };
        if refused {
            crate::proxy_log!("-> refused: local-only target for {}", peer.0);
            return forbidden();
        }
    }

    *req.uri_mut() = target_uri.clone();

    let host_key = host_key_for_logging_map(&host_h);
    let logging_config = state
        .api_logging_map
        .read()
        .ok()
        .and_then(|map| get_logging_config_for_host(&map, &host_key));

    let (logging_enabled, body_enabled) = logging_config.unwrap_or((false, false));
    let logging_enabled = logging_enabled && !is_horizon_gateway_internal(path, &target_uri_str);

    if is_websocket_upgrade(&req) {
        return handle_websocket_upgrade(
            &state,
            req,
            local_origin.as_ref(),
            &target_uri,
            &target_uri_str,
            &host_h,
            &uri,
        )
        .await;
    }

    if logging_enabled {
        handle_with_logging(
            &state,
            req,
            &target_uri_str,
            path,
            &host_h,
            scheme,
            local_origin.as_ref(),
            body_enabled,
        )
        .await
    } else {
        handle_pass_through(
            &state,
            req,
            &target_uri_str,
            path,
            &host_h,
            scheme,
            local_origin.as_ref(),
        )
        .await
    }
}
