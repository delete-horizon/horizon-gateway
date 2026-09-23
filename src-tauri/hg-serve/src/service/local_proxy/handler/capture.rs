use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use std::time::Duration;
use time::OffsetDateTime;

use crate::model::api_log::ApiLogEntry;

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

const MAX_BODY_CAPTURE_BYTES: usize = 2 * 1024 * 1024; // 2 MB
const MAX_REQUEST_BODY_READ_BYTES: usize = 50 * 1024 * 1024; // 50 MB safety cap

pub(crate) fn is_text_or_json_content_type(ct: &str) -> bool {
    let mime = ct.split(';').next().unwrap_or("").trim().to_lowercase();
    if mime.is_empty() {
        return false;
    }
    if mime == "application/json" || mime.ends_with("+json") {
        return true;
    }
    if mime.starts_with("text/") {
        return true;
    }
    matches!(
        mime.as_str(),
        "application/javascript"
            | "application/x-javascript"
            | "application/x-www-form-urlencoded"
            | "application/xml"
            | "application/graphql"
            | "application/soap+xml"
    ) || mime.ends_with("+xml")
}

pub(crate) fn is_likely_text_or_json(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let inspect_len = bytes.len().min(512);
    let sample = &bytes[..inspect_len];

    // Check for null bytes (common in binary files)
    if sample.contains(&0) {
        return false;
    }

    // Try decoding sample as UTF-8
    if std::str::from_utf8(sample).is_err() {
        return false;
    }

    // Check if trimmed starts with json/text indicators
    let trimmed = sample
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .map(|i| sample[i]);
    matches!(
        trimmed,
        Some(b'{' | b'[' | b'<' | b'"' | b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9')
    )
}

pub(crate) fn extract_log_body(
    bytes: &[u8],
    content_type: Option<&str>,
    body_enabled: bool,
) -> Option<String> {
    if !body_enabled || bytes.is_empty() {
        return None;
    }

    let ct = content_type.unwrap_or("").trim();
    let is_text = if !ct.is_empty() {
        is_text_or_json_content_type(ct)
    } else {
        is_likely_text_or_json(bytes)
    };

    if !is_text {
        let display_ct = if ct.is_empty() { "binary/unknown" } else { ct };
        return Some(format!(
            "[Binary data: {} ({} bytes)]",
            display_ct,
            bytes.len()
        ));
    }

    if bytes.len() <= MAX_BODY_CAPTURE_BYTES {
        String::from_utf8(bytes.to_vec())
            .ok()
            .or_else(|| Some(String::from_utf8_lossy(bytes).into_owned()))
    } else {
        let prefix = &bytes[..MAX_BODY_CAPTURE_BYTES];
        let mut truncated = String::from_utf8_lossy(prefix).into_owned();
        truncated.push_str(&format!(
            "\n\n[... TRUNCATED: {} bytes total, capped at 2MB ...]",
            bytes.len()
        ));
        Some(truncated)
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn handle_with_logging(
    state: &Arc<ProxyState>,
    req: Request,
    target_uri_str: &str,
    path: &str,
    host_h: &str,
    scheme: &str,
    local_origin: Option<&(String, u16, String)>,
    body_enabled: bool,
) -> Response {
    let (parts, body) = req.into_parts();
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

    let req_content_type = parts
        .headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());
    let req_body_str = extract_log_body(&req_bytes, req_content_type, body_enabled);

    let method = parts.method.clone();
    let url_str = target_uri_str.to_string();

    let mut req_builder = if local_origin.is_some() {
        state.reqwest_client.request(method.clone(), &url_str)
    } else {
        state
            .reqwest_client_direct
            .request(method.clone(), &url_str)
    };

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

    let has_body = !matches!(
        parts.method,
        axum::http::Method::GET
            | axum::http::Method::HEAD
            | axum::http::Method::OPTIONS
            | axum::http::Method::TRACE
    );

    if has_body {
        req_builder = req_builder.body(req_bytes.to_vec());
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

    let start_time = OffsetDateTime::now_utc();
    let response = match req_builder.send().await {
        Ok(res) => res,
        Err(e) => {
            crate::proxy_log!("   reqwest error: {}", e);
            return build_proxy_error_response(host_h, &e.to_string());
        }
    };

    let status = response.status();
    let mut res_headers = response.headers().clone();
    let res_bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Failed to read response body: {e}"),
            )
                .into_response();
        }
    };

    let content_type = res_headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let res_body_str = extract_log_body(&res_bytes, Some(&content_type), body_enabled);

    res_headers.remove(header::X_FRAME_OPTIONS);
    res_headers.remove(header::CONTENT_SECURITY_POLICY);
    res_headers.remove("content-security-policy-report-only");
    res_headers.remove("x-content-security-policy");
    res_headers.remove(header::ETAG);
    res_headers.remove(header::LAST_MODIFIED);
    res_headers.remove("alt-svc");

    if local_origin.is_some() {
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
    }

    let mut final_res_bytes = res_bytes.to_vec();
    if should_inject_for_host(state, host_h) && is_html_response(&content_type, &final_res_bytes) {
        apply_html_injection_cache_headers(&mut res_headers);
        final_res_bytes = inject_inspector_script(final_res_bytes);
    }

    let entry = ApiLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: start_time
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        method: method.to_string(),
        url: target_uri_str.to_string(),
        host: host_h.to_string(),
        path: path.to_string(),
        status_code: Some(status.as_u16()),
        request_headers: Some(
            parts
                .headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect(),
        ),
        request_body: req_body_str,
        response_headers: Some(
            res_headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect(),
        ),
        response_body: res_body_str,
        has_bodies: body_enabled,
        is_mocked: false,
    };
    if !is_horizon_gateway_internal(path, target_uri_str) {
        state.api_log_service.save_log(&entry);
        let _ = state.emit("api-log-captured", entry);
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
    builder
        .body(Body::from(final_res_bytes))
        .unwrap_or_else(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build response: {e}"),
            )
                .into_response()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_text_or_json_content_type() {
        assert!(is_text_or_json_content_type("application/json"));
        assert!(is_text_or_json_content_type(
            "application/json; charset=utf-8"
        ));
        assert!(is_text_or_json_content_type("application/problem+json"));
        assert!(is_text_or_json_content_type("text/html"));
        assert!(is_text_or_json_content_type(
            "text/plain; charset=iso-8859-1"
        ));
        assert!(is_text_or_json_content_type("application/xml"));
        assert!(is_text_or_json_content_type(
            "application/x-www-form-urlencoded"
        ));

        assert!(!is_text_or_json_content_type("image/png"));
        assert!(!is_text_or_json_content_type("video/mp4"));
        assert!(!is_text_or_json_content_type("application/octet-stream"));
        assert!(!is_text_or_json_content_type("application/pdf"));
    }

    #[test]
    fn test_extract_log_body_binary_and_truncation() {
        // Binary content
        let bin_bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x00, 0x01];
        let res = extract_log_body(&bin_bytes, Some("image/png"), true);
        assert_eq!(res, Some("[Binary data: image/png (6 bytes)]".to_string()));

        // Text content
        let text_bytes = b"{\"hello\":\"world\"}".to_vec();
        let res = extract_log_body(&text_bytes, Some("application/json"), true);
        assert_eq!(res, Some("{\"hello\":\"world\"}".to_string()));

        // Truncated text content (> 2MB)
        let large_bytes = vec![b'A'; MAX_BODY_CAPTURE_BYTES + 100];
        let res = extract_log_body(&large_bytes, Some("text/plain"), true).unwrap();
        assert!(res.contains("[... TRUNCATED:"));
    }
}
