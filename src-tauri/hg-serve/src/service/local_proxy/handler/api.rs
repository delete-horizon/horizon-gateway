use axum::{
    extract::Request,
    http::{header, HeaderValue, StatusCode, Uri},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use futures::stream::{self, StreamExt};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use crate::model::inspector::Annotation;
use crate::service::inspector_service::InspectorService;

use super::super::reserved::{
    is_horizon_gateway_internal, normalize_horizon_gateway_path,
    serve_horizon_gateway_reserved_path,
};
use super::super::state::ProxyState;

/// `delay_ms` from the injection mock editor. `None` when the field is absent.
pub(crate) fn json_delay_ms(payload: &serde_json::Value) -> Option<u64> {
    let value = payload.get("delay_ms")?;
    value.as_u64().or_else(|| match value.as_i64() {
        Some(n) if n <= 0 => Some(0),
        Some(n) => u64::try_from(n).ok(),
        None => None,
    })
}

/// Handled API / reserved-path requests. `Err(req)` means the caller should continue the pipeline.
pub(crate) async fn try_handle_api(
    state: &Arc<ProxyState>,
    req: Request,
    path: &str,
    uri: &Uri,
) -> Result<Response, Request> {
    if path == "/api/ping" {
        let json = serde_json::json!({
            "app": "horizon_gateway_proxy",
            "status": "ok"
        });
        return Ok((
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            json.to_string(),
        )
            .into_response());
    }

    let uri_str = uri.to_string();
    if !is_horizon_gateway_internal(path, &uri_str) {
        return Err(req);
    }

    let clean_path = normalize_horizon_gateway_path(path, &uri_str);

    let host_h = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .map(std::string::ToString::to_string)
        .unwrap_or_default();

    crate::proxy_log!(
        "-> horizon-gateway reserved: {} (Original: {})",
        clean_path,
        path
    );

    if clean_path == "/.horizon-gateway/api/annotations/stream"
        && req.method() == hyper::Method::GET
    {
        return Ok(annotations_stream_response(state));
    }

    if clean_path == "/.horizon-gateway/api/focus" {
        if let Some(_main) = state.webview_window("main") {
            // main window focus skipped in headless serve
        }
        return Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"))],
            "Focused",
        )
            .into_response());
    }

    if clean_path == "/.horizon-gateway/api/status" {
        let mock_rules = state.mocking_service.get_mock_rules();
        let active_mock_count = mock_rules.iter().filter(|r| r.enabled).count();
        let mocking_enabled = active_mock_count > 0;

        let active_routes = state.route_service.get_enabled();
        let proxy_active = !active_routes.is_empty();
        let logging_enabled = state
            .api_logging_map
            .read()
            .ok()
            .is_some_and(|map| map.values().any(|(logging, _)| *logging));
        let inspector_enabled = !state.inspector_service.get_injection_domains().is_empty();

        let json = serde_json::json!({
            "proxy": proxy_active,
            "proxyCount": active_routes.len(),
            "mocking": mocking_enabled,
            "mockCount": active_mock_count,
            "logging": logging_enabled,
            "inspector": inspector_enabled
        });
        return Ok((
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            json.to_string(),
        )
            .into_response());
    }

    if clean_path == "/.horizon-gateway/api/annotations" && req.method() == hyper::Method::GET {
        let list = state.inspector_service.get_all();
        let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string());
        return Ok((
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            json,
        )
            .into_response());
    }

    if clean_path == "/.horizon-gateway/api/annotation" {
        if req.method() == hyper::Method::DELETE {
            if let Ok(body) = axum::body::to_bytes(req.into_body(), usize::MAX).await {
                if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) {
                    if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
                        state.inspector_service.delete_annotation(id.to_string());
                        let _ = state.emit("annotations-updated", ());
                        return Ok((StatusCode::OK, "Annotation deleted").into_response());
                    }
                }
            }
            return Ok((StatusCode::BAD_REQUEST, "Invalid delete payload").into_response());
        }

        if req.method() == hyper::Method::POST {
            let host_h = req
                .headers()
                .get(hyper::header::HOST)
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string();

            let full_url = if req.uri().scheme().is_some() {
                req.uri().to_string()
            } else {
                format!("https://{}{}", host_h, req.uri())
            };

            let Ok(body) = axum::body::to_bytes(req.into_body(), usize::MAX).await else {
                return Ok((StatusCode::BAD_REQUEST, "Failed to read body").into_response());
            };

            if let Ok(mut annotation_val) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(obj) = annotation_val.as_object_mut() {
                    if !obj.contains_key("domain") {
                        obj.insert("domain".to_string(), serde_json::Value::String(host_h));
                    }
                    if !obj.contains_key("url") {
                        obj.insert("url".to_string(), serde_json::Value::String(full_url));
                    }
                }

                match serde_json::from_value::<Annotation>(annotation_val.clone()) {
                    Ok(ann) => {
                        state.inspector_service.add_annotation(ann);
                        let count = state.inspector_service.get_all().len();
                        crate::proxy_log!(
                            "✅ [Horizon Gateway] Annotation saved to file. Total count: {}",
                            count
                        );
                        let _ = state.emit("annotations-updated", ());
                    }
                    Err(e) => {
                        crate::proxy_log!(
                            "❌ [Horizon Gateway] Failed to parse annotation JSON: {}",
                            e
                        );
                    }
                }

                let _ = state.emit("annotation-dialog-requested", annotation_val);
                return Ok((StatusCode::OK, "Annotation saved").into_response());
            }
            return Ok((StatusCode::BAD_REQUEST, "Invalid JSON").into_response());
        }
    }

    if clean_path == "/.horizon-gateway/api/mock-rules" && req.method() == hyper::Method::GET {
        let rules = state.mocking_service.get_mock_rules();
        let json = serde_json::to_string(&rules).unwrap_or_else(|_| "[]".to_string());
        return Ok((
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            json,
        )
            .into_response());
    }

    if clean_path == "/.horizon-gateway/api/theme" {
        static THEME_CACHE: std::sync::OnceLock<std::sync::RwLock<Option<serde_json::Value>>> =
            std::sync::OnceLock::new();
        let cache = THEME_CACHE.get_or_init(|| {
            let loaded = crate::runtime::paths::resolve_app_data_dir()
                .ok()
                .and_then(|dir| std::fs::read_to_string(dir.join("theme.json")).ok())
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
            std::sync::RwLock::new(loaded)
        });

        if req.method() == hyper::Method::GET {
            let mut val = cache.read().unwrap().clone();
            if val.is_none() {
                if let Ok(dir) = crate::runtime::paths::resolve_app_data_dir() {
                    if let Ok(s) = std::fs::read_to_string(dir.join("theme.json")) {
                        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&s) {
                            *cache.write().unwrap() = Some(json_val.clone());
                            val = Some(json_val);
                        }
                    }
                }
            }
            let json = val
                .map(|v| v.to_string())
                .unwrap_or_else(|| "null".to_string());
            return Ok((
                StatusCode::OK,
                [(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                )],
                json,
            )
                .into_response());
        }

        if req.method() == hyper::Method::POST {
            if let Ok(body) = axum::body::to_bytes(req.into_body(), usize::MAX).await {
                if let Ok(theme_val) = serde_json::from_slice::<serde_json::Value>(&body) {
                    *cache.write().unwrap() = Some(theme_val.clone());
                    if let Ok(dir) = crate::runtime::paths::resolve_app_data_dir() {
                        let _ = std::fs::create_dir_all(&dir);
                        let _ = std::fs::write(dir.join("theme.json"), theme_val.to_string());
                    }
                    return Ok((StatusCode::OK, "Theme updated").into_response());
                }
            }
            return Ok((StatusCode::BAD_REQUEST, "Invalid theme JSON").into_response());
        }
    }

    if clean_path == "/.horizon-gateway/api/mock-rule/toggle" && req.method() == hyper::Method::POST
    {
        if let Ok(body) = axum::body::to_bytes(req.into_body(), usize::MAX).await {
            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) {
                let enabled = payload
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if payload
                    .get("all")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    let rules = state.mocking_service.get_mock_rules();
                    for r in rules {
                        state.mocking_service.update_mock_rule(
                            r.id,
                            None,
                            None,
                            None,
                            None,
                            None,
                            None,
                            None,
                            Some(enabled),
                            None,
                        );
                    }
                } else if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
                    state.mocking_service.update_mock_rule(
                        id.to_string(),
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some(enabled),
                        None,
                    );
                }
                let _ = state.emit("mock-rules-updated", ());
                return Ok((StatusCode::OK, "Toggled").into_response());
            }
        }
        return Ok((StatusCode::BAD_REQUEST, "Invalid request").into_response());
    }

    if clean_path == "/.horizon-gateway/api/mock-rule/save" && req.method() == hyper::Method::POST {
        if let Ok(body) = axum::body::to_bytes(req.into_body(), usize::MAX).await {
            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) {
                let id = payload
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                let name = payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Custom Rule")
                    .to_string();
                let host = payload
                    .get("host")
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                let method = payload
                    .get("method")
                    .and_then(|v| v.as_str())
                    .unwrap_or("GET")
                    .to_string();
                let url_pattern = payload
                    .get("url_pattern")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let response_status = payload
                    .get("response_status")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(200) as u16;
                let response_body = payload
                    .get("response_body")
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                let enabled = payload
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let response_headers = payload
                    .get("response_headers")
                    .and_then(|v| {
                        serde_json::from_value::<std::collections::HashMap<String, String>>(
                            v.clone(),
                        )
                        .ok()
                    })
                    .unwrap_or_default();
                let delay_ms = json_delay_ms(&payload);

                if let Some(rule_id) = id {
                    state.mocking_service.update_mock_rule(
                        rule_id,
                        Some(name),
                        host,
                        Some(method),
                        Some(url_pattern),
                        Some(response_status),
                        Some(response_headers),
                        response_body,
                        Some(enabled),
                        delay_ms,
                    );
                } else {
                    state.mocking_service.create_mock_rule(
                        name,
                        None,
                        host,
                        method,
                        url_pattern,
                        response_status,
                        response_headers,
                        response_body,
                        enabled,
                        delay_ms.unwrap_or(0),
                    );
                }
                let _ = state.emit("mock-rules-updated", ());
                return Ok((StatusCode::OK, "Saved").into_response());
            }
        }
        return Ok((StatusCode::BAD_REQUEST, "Invalid JSON").into_response());
    }

    if clean_path == "/.horizon-gateway/api/mock-rule/delete" && req.method() == hyper::Method::POST
    {
        if let Ok(body) = axum::body::to_bytes(req.into_body(), usize::MAX).await {
            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
                    state.mocking_service.delete_mock_rule(id.to_string());
                    let _ = state.emit("mock-rules-updated", ());
                    return Ok((StatusCode::OK, "Deleted").into_response());
                }
            }
        }
        return Ok((StatusCode::BAD_REQUEST, "Invalid request").into_response());
    }

    if clean_path == "/.horizon-gateway/api/proxy-routes" && req.method() == hyper::Method::GET {
        let routes = state.route_service.get_all();
        let json = serde_json::to_string(&routes).unwrap_or_else(|_| "[]".to_string());
        return Ok((
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            json,
        )
            .into_response());
    }

    if clean_path == "/.horizon-gateway/api/proxy-route/toggle"
        && req.method() == hyper::Method::POST
    {
        if let Ok(body) = axum::body::to_bytes(req.into_body(), usize::MAX).await {
            if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(id) = payload.get("id").and_then(|v| v.as_u64()) {
                    let enabled = payload
                        .get("enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    state.route_service.toggle_enabled(id as u32, enabled);
                    let _ = state.emit("local-routes-updated", ());
                    return Ok((StatusCode::OK, "Toggled").into_response());
                }
            }
        }
        return Ok((StatusCode::BAD_REQUEST, "Invalid request").into_response());
    }

    if clean_path == "/.horizon-gateway/api/logging-domains" && req.method() == hyper::Method::GET {
        let map_guard = state.api_logging_map.read().ok();
        let domains: Vec<String> = if let Some(map) = map_guard {
            map.iter()
                .filter(|(_, (logging_enabled, _))| *logging_enabled)
                .map(|(host, _)| host.clone())
                .collect()
        } else {
            Vec::new()
        };
        let json = serde_json::to_string(&domains).unwrap_or_else(|_| "[]".to_string());
        return Ok((
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            json,
        )
            .into_response());
    }

    Ok(serve_horizon_gateway_reserved_path(state.clone(), &clean_path, &host_h).await)
}

fn annotations_json(inspector: &InspectorService) -> String {
    serde_json::to_string(&inspector.get_all()).unwrap_or_else(|_| "[]".to_string())
}

fn annotations_stream_response(state: &Arc<ProxyState>) -> Response {
    let inspector = Arc::clone(&state.inspector_service);
    let initial = annotations_json(&inspector);
    let rx = InspectorService::subscribe_updates();

    let first = stream::once(async move { Ok::<_, Infallible>(Event::default().data(initial)) });
    let rest = stream::unfold((rx, inspector), |(mut rx, inspector)| async move {
        match rx.recv().await {
            Ok(()) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                let json = annotations_json(&inspector);
                Some((
                    Ok::<_, Infallible>(Event::default().data(json)),
                    (rx, inspector),
                ))
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => None,
        }
    });

    let mut res = Sse::new(first.chain(rest))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("ping"),
        )
        .into_response();
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    res
}
