use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use futures::TryStreamExt;
use std::sync::Arc;
use std::time::Duration;

use super::super::reserved::is_horizon_gateway_internal;
use super::super::state::ProxyState;
use super::inject::{
    apply_html_injection_cache_headers, build_proxy_error_response, inject_inspector_script,
    is_html_response, should_inject_for_host,
};

const HOP_BY_HOP_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "proxy-connection",
    "accept-encoding",
];

const SKIP_RESPONSE_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "proxy-connection",
    "content-length",
    "content-encoding",
];

const MAX_REQUEST_BODY_READ_BYTES: usize = 50 * 1024 * 1024; // 50 MB safety cap

pub(crate) async fn handle_pass_through(
    state: &Arc<ProxyState>,
    req: Request,
    target_uri_str: &str,
    path: &str,
    host_h: &str,
    scheme: &str,
    local_origin: Option<&(String, u16, String)>,
) -> Response {
    let method = req.method().clone();
    let url_str = target_uri_str.to_string();

    let mut req_builder = if local_origin.is_some() {
        state.reqwest_client.request(method.clone(), &url_str)
    } else {
        state
            .reqwest_client_direct
            .request(method.clone(), &url_str)
    };

    // For local routes (Next.js, dev servers), allow generous timeout (10 mins) so heavy data fetching,
    // SSR suspense, or long compiling does not time out prematurely.
    let timeout_duration = if local_origin.is_some() {
        Duration::from_secs(600)
    } else {
        Duration::from_secs(
            state
                .proxy_settings
                .get()
                .upstream_timeout_secs
                .clamp(1, 600),
        )
    };
    req_builder = req_builder.timeout(timeout_duration);

    let (parts, body) = req.into_parts();

    let has_body = !matches!(
        parts.method,
        axum::http::Method::GET
            | axum::http::Method::HEAD
            | axum::http::Method::OPTIONS
            | axum::http::Method::TRACE
    );

    if has_body {
        let req_bytes = match axum::body::to_bytes(body, MAX_REQUEST_BODY_READ_BYTES).await {
            Ok(b) => b,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    format!("Failed to read request body: {e}"),
                )
                    .into_response();
            }
        };
        req_builder = req_builder.body(req_bytes);
    }

    for (name, value) in &parts.headers {
        let name_str = name.as_str().to_lowercase();
        if name_str != "host"
            && name_str != "content-length"
            && !HOP_BY_HOP_HEADERS.contains(&name_str.as_str())
        {
            req_builder = req_builder.header(name, value);
        }
    }
    if local_origin.is_some() {
        req_builder = req_builder.header("host", host_h);
        req_builder = req_builder.header("x-forwarded-proto", scheme);
        req_builder = req_builder.header("x-forwarded-host", host_h);
        req_builder = req_builder.header("x-forwarded-for", "127.0.0.1");
        req_builder = req_builder.header("x-real-ip", "127.0.0.1");
    }

    match req_builder.send().await {
        Ok(res) => {
            let status = res.status();
            let mut res_headers = res.headers().clone();

            res_headers.remove(header::X_FRAME_OPTIONS);
            res_headers.remove(header::CONTENT_SECURITY_POLICY);
            res_headers.remove("content-security-policy-report-only");
            res_headers.remove("x-content-security-policy");

            if local_origin.is_some() {
                // Rewrite Location header for redirects if pointing to local target
                if let Some((target_host, target_port, _)) = local_origin {
                    if let Some(loc_val) = res_headers.get(header::LOCATION) {
                        if let Ok(loc_str) = loc_val.to_str() {
                            let local_prefix1 = format!("http://{}:{}/", target_host, target_port);
                            let local_prefix2 = format!("http://{}:{}", target_host, target_port);
                            let local_prefix3 = format!("http://localhost:{}/", target_port);
                            let local_prefix4 = format!("http://localhost:{}", target_port);
                            let local_prefix5 = format!("http://127.0.0.1:{}/", target_port);
                            let local_prefix6 = format!("http://127.0.0.1:{}", target_port);
                            let public_prefix1 = format!("{}://{}/", scheme, host_h);
                            let public_prefix2 = format!("{}://{}", scheme, host_h);

                            let new_loc = if loc_str.starts_with(&local_prefix1) {
                                Some(loc_str.replacen(&local_prefix1, &public_prefix1, 1))
                            } else if loc_str == local_prefix2 {
                                Some(public_prefix2.clone())
                            } else if loc_str.starts_with(&local_prefix3) {
                                Some(loc_str.replacen(&local_prefix3, &public_prefix1, 1))
                            } else if loc_str == local_prefix4 {
                                Some(public_prefix2.clone())
                            } else if loc_str.starts_with(&local_prefix5) {
                                Some(loc_str.replacen(&local_prefix5, &public_prefix1, 1))
                            } else if loc_str == local_prefix6 {
                                Some(public_prefix2)
                            } else {
                                None
                            };

                            if let Some(new_loc_str) = new_loc {
                                if let Ok(hv) = HeaderValue::from_str(&new_loc_str) {
                                    res_headers.insert(header::LOCATION, hv);
                                }
                            }
                        }
                    }
                }

                let mut cookie_updates = Vec::new();
                for (name, value) in &res_headers {
                    if name == header::SET_COOKIE {
                        if let Ok(cookie_str) = value.to_str() {
                            let parts: Vec<&str> = cookie_str.split(';').map(str::trim).collect();
                            let mut new_parts: Vec<String> = Vec::new();
                            let mut has_samesite = false;
                            let mut has_secure = false;

                            for part in parts {
                                let part_lower = part.to_lowercase();
                                if part_lower.starts_with("samesite=") {
                                    new_parts.push("SameSite=None".to_string());
                                    has_samesite = true;
                                } else if part_lower == "secure" {
                                    new_parts.push("Secure".to_string());
                                    has_secure = true;
                                } else if !part.is_empty() {
                                    new_parts.push((*part).to_string());
                                }
                            }

                            if !has_samesite {
                                new_parts.push("SameSite=None".to_string());
                            }
                            if !has_secure {
                                new_parts.push("Secure".to_string());
                            }

                            cookie_updates.push(new_parts.join("; "));
                        }
                    }
                }
                if !cookie_updates.is_empty() {
                    res_headers.remove(header::SET_COOKIE);
                    for cookie in cookie_updates {
                        if let Ok(hv) = HeaderValue::from_str(&cookie) {
                            res_headers.append(header::SET_COOKIE, hv);
                        }
                    }
                }
            }

            let entry = crate::model::api_log::ApiLogEntry {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                method: method.to_string(),
                url: url_str.clone(),
                host: host_h.to_string(),
                path: path.to_string(),
                status_code: Some(status.as_u16()),
                request_headers: None,
                request_body: None,
                response_headers: None,
                response_body: None,
                has_bodies: false,
                is_mocked: false,
            };
            // Live UI still sees pass-through traffic, except inspector internals.
            if !is_horizon_gateway_internal(path, &url_str) {
                let _ = state.emit("api-log-captured", entry);
            }

            let content_type = res_headers
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_lowercase();

            res_headers.remove(header::ETAG);
            res_headers.remove(header::LAST_MODIFIED);
            res_headers.remove("alt-svc");

            let maybe_html = content_type.contains("text/html")
                || content_type.contains("application/xhtml+xml")
                || content_type.is_empty()
                || content_type.contains("octet-stream")
                || content_type.starts_with("text/plain");

            if maybe_html && should_inject_for_host(state, host_h) {
                let full_body = match res.bytes().await {
                    Ok(b) => b,
                    Err(e) => {
                        crate::proxy_log!("❌ [Horizon Gateway] Failed to read HTML body: {}", e);
                        return (StatusCode::BAD_GATEWAY, format!("Proxy error: {e}"))
                            .into_response();
                    }
                };

                let final_res_bytes = if is_html_response(&content_type, &full_body) {
                    apply_html_injection_cache_headers(&mut res_headers);
                    inject_inspector_script(full_body.to_vec())
                } else {
                    full_body.to_vec()
                };

                let mut builder = Response::builder().status(status);
                if let Some(headers) = builder.headers_mut() {
                    for (k, v) in &res_headers {
                        let k_str = k.as_str().to_lowercase();
                        if !SKIP_RESPONSE_HEADERS.contains(&k_str.as_str()) {
                            headers.insert(k, v.clone());
                        }
                    }
                }
                return builder
                    .body(Body::from(final_res_bytes))
                    .unwrap_or_else(|e| {
                        (StatusCode::BAD_GATEWAY, format!("Proxy error: {e}")).into_response()
                    });
            }

            let mut builder = Response::builder().status(status);
            if let Some(headers) = builder.headers_mut() {
                for (k, v) in &res_headers {
                    let k_str = k.as_str().to_lowercase();
                    if !SKIP_RESPONSE_HEADERS.contains(&k_str.as_str()) {
                        headers.insert(k, v.clone());
                    }
                }
            }
            let stream = res.bytes_stream();
            let body = Body::from_stream(stream.map_err(std::io::Error::other));
            builder.body(body).unwrap_or_else(|e| {
                (StatusCode::BAD_GATEWAY, format!("Proxy error: {e}")).into_response()
            })
        }
        Err(e) => build_proxy_error_response(host_h, &e.to_string()),
    }
}
