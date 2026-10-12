use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use time::OffsetDateTime;

use super::super::routing::host_key_for_logging_map;
use super::super::state::ProxyState;
use crate::model::api_log::ApiLogEntry;
use crate::model::mock_rule::{clamp_mock_delay_ms, MockRule};
use crate::model::scenario::Scenario;
use crate::service::mocking_service::MockingService;

fn matches_wildcard(pattern: &str, text: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() || pattern == "*" || pattern == "/*" {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        text.starts_with(prefix)
    } else if let Some(suffix) = pattern.strip_prefix('*') {
        text.ends_with(suffix)
    } else {
        pattern == text || text.starts_with(pattern)
    }
}

fn matches_url_pattern(pattern: &str, path: &str, uri: &Uri) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() || pattern == "*" || pattern == "/*" {
        return true;
    }

    let full_path = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or(path);

    let pattern_path = if let Some(idx) = pattern.find("://") {
        let after_scheme = &pattern[idx + 3..];
        if let Some(slash_idx) = after_scheme.find('/') {
            &after_scheme[slash_idx..]
        } else {
            "/"
        }
    } else {
        pattern
    };

    if pattern_path == "*" || pattern_path == "/*" {
        return true;
    }

    matches_wildcard(pattern_path, path)
        || matches_wildcard(pattern_path, full_path)
        || path == pattern_path
        || full_path == pattern_path
        || path.starts_with(pattern_path)
        || full_path.starts_with(pattern_path)
}

fn matches_host(rule_host: Option<&str>, target_host: &str) -> bool {
    let Some(r_host) = rule_host else {
        return true;
    };
    let r_host = r_host.trim();
    if r_host.is_empty() || r_host == "*" {
        return true;
    }
    let norm_rule_host = host_key_for_logging_map(r_host);
    let norm_target_host = host_key_for_logging_map(target_host);

    norm_rule_host.is_empty()
        || norm_rule_host == norm_target_host
        || norm_target_host.ends_with(&format!(".{norm_rule_host}"))
}

fn rule_matches_request(rule: &MockRule, method: &str, uri: &Uri, path: &str, host: &str) -> bool {
    rule.enabled
        && rule.method.eq_ignore_ascii_case(method)
        && matches_host(rule.host.as_deref(), host)
        && matches_url_pattern(&rule.url_pattern, path, uri)
}

/// Choose the mock for this request.
///
/// Rules whose `scenario_id` is empty, or whose scenario is the built-in
/// `Default` scenario, are not tied to a scenario. They stay eligible while
/// the rule itself is enabled, including when `Default` is disabled.
/// A rule tied to any other scenario matches only while that scenario is
/// enabled. If both kinds match, the active-scenario rule wins. Within one
/// kind, the earliest stored rule wins.
pub(crate) fn select_mock_rule<'a>(
    rules: &'a [MockRule],
    scenarios: &'a [Scenario],
    method: &str,
    uri: &Uri,
    path: &str,
    host: &str,
) -> Option<&'a MockRule> {
    let untied_ids: HashSet<&str> = scenarios
        .iter()
        .filter(|scenario| scenario.name == MockingService::DEFAULT_SCENARIO_NAME)
        .map(|scenario| scenario.id.as_str())
        .collect();
    let active_ids: HashSet<&str> = scenarios
        .iter()
        .filter(|scenario| {
            scenario.enabled && scenario.name != MockingService::DEFAULT_SCENARIO_NAME
        })
        .map(|scenario| scenario.id.as_str())
        .collect();

    let mut untied_match = None;
    let mut active_match = None;
    for rule in rules {
        if !rule_matches_request(rule, method, uri, path, host) {
            continue;
        }
        let scenario_id = rule.scenario_id.as_str();
        if scenario_id.is_empty() || untied_ids.contains(scenario_id) {
            if untied_match.is_none() {
                untied_match = Some(rule);
            }
            continue;
        }
        if active_ids.contains(scenario_id) && active_match.is_none() {
            active_match = Some(rule);
        }
    }
    active_match.or(untied_match)
}

/// Wait the configured delay on the async runtime. `0` returns immediately.
/// Values above [`crate::model::mock_rule::MAX_MOCK_DELAY_MS`] sleep only that long.
pub(crate) async fn wait_for_mock_delay(delay_ms: u64) {
    let wait_ms = clamp_mock_delay_ms(delay_ms);
    if wait_ms == 0 {
        return;
    }
    tokio::time::sleep(Duration::from_millis(wait_ms)).await;
}

pub(crate) fn logged_request_headers(req: &Request) -> HashMap<String, String> {
    req.headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect()
}

pub(crate) async fn try_mock_response(
    state: &Arc<ProxyState>,
    request_headers: HashMap<String, String>,
    method: &str,
    uri: &Uri,
    path: &str,
    host_h: &str,
) -> Option<Response> {
    let rules = state.mocking_service.get_mock_rules();
    let scenarios = state.mocking_service.get_scenarios();
    let rule = select_mock_rule(&rules, &scenarios, method, uri, path, host_h)?.clone();
    wait_for_mock_delay(rule.delay_ms).await;

    crate::proxy_log!("-> mocked response for {} {}", method, uri);
    let mut builder = Response::builder().status(rule.response_status);
    let mut has_content_type = false;
    if let Some(headers) = builder.headers_mut() {
        for (k, v) in &rule.response_headers {
            let k_lower = k.trim().to_lowercase();
            if k_lower == "content-length"
                || k_lower == "content-encoding"
                || k_lower == "transfer-encoding"
                || k_lower == "connection"
                || k_lower == "keep-alive"
                || k_lower == "content-range"
                || k_lower == "accept-ranges"
            {
                continue;
            }
            if k_lower == "content-type" {
                has_content_type = true;
            }
            if let Ok(header_name) = header::HeaderName::from_bytes(k.as_bytes()) {
                let header_value = if let Ok(hv) = header::HeaderValue::from_str(v) {
                    hv
                } else {
                    let enc = urlencoding::encode(v);
                    header::HeaderValue::from_str(&enc)
                        .unwrap_or_else(|_| HeaderValue::from_static(""))
                };
                headers.insert(header_name, header_value);
            }
        }
        if !has_content_type {
            let body_str = rule.response_body.as_deref().unwrap_or("").trim();
            let default_ct = if body_str.starts_with('{') || body_str.starts_with('[') {
                "application/json; charset=utf-8"
            } else {
                "text/plain; charset=utf-8"
            };
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(default_ct));
        }
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
        headers.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static("x-mocked-by, x-mock-rule-id, x-mock-rule-name"),
        );
        headers.insert(
            header::HeaderName::from_static("x-mocked-by"),
            HeaderValue::from_static("horizon-gateway"),
        );
        if let Ok(hv) = HeaderValue::from_str(&rule.id) {
            headers.insert(header::HeaderName::from_static("x-mock-rule-id"), hv);
        }
        let rule_name_hv = if let Ok(hv) = HeaderValue::from_str(&rule.name) {
            hv
        } else {
            let enc = urlencoding::encode(&rule.name);
            HeaderValue::from_str(&enc).unwrap_or_else(|_| HeaderValue::from_static(""))
        };
        headers.insert(
            header::HeaderName::from_static("x-mock-rule-name"),
            rule_name_hv,
        );
    }
    let body = rule.response_body.unwrap_or_default();

    let mut logged_headers = rule.response_headers.clone();
    logged_headers.insert("X-Mocked-By".to_string(), "horizon-gateway".to_string());
    logged_headers.insert("x-mocked-by".to_string(), "horizon-gateway".to_string());
    logged_headers.insert("X-Mock-Rule-Id".to_string(), rule.id.clone());
    logged_headers.insert("x-mock-rule-id".to_string(), rule.id.clone());
    logged_headers.insert("X-Mock-Rule-Name".to_string(), rule.name.clone());
    logged_headers.insert("x-mock-rule-name".to_string(), rule.name.clone());
    if !logged_headers
        .keys()
        .any(|k| k.eq_ignore_ascii_case("content-type"))
    {
        let body_str = body.trim();
        let default_ct = if body_str.starts_with('{') || body_str.starts_with('[') {
            "application/json; charset=utf-8"
        } else {
            "text/plain; charset=utf-8"
        };
        logged_headers.insert("Content-Type".to_string(), default_ct.to_string());
    }

    let start_time = OffsetDateTime::now_utc();
    let entry = ApiLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: start_time
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        method: method.to_string(),
        url: uri.to_string(),
        host: host_h.to_string(),
        path: path.to_string(),
        status_code: Some(rule.response_status),
        request_headers: Some(request_headers),
        request_body: None,
        response_headers: Some(logged_headers),
        response_body: Some(body.clone()),
        has_bodies: true,
        is_mocked: true,
    };
    state.api_log_service.save_log(&entry);
    let _ = state.emit("api-log-captured", entry);

    Some(builder.body(Body::from(body)).unwrap_or_else(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to build mock response: {e}"),
        )
            .into_response()
    }))
}
