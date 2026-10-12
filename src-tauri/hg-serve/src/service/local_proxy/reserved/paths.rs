use axum::http::{
    header::{self, HeaderValue, CONTENT_TYPE},
    StatusCode,
};
use axum::response::{Html, IntoResponse, Response};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::super::state::ProxyState;
use super::super::tls::serve_cert_pem;

include!(concat!(env!("OUT_DIR"), "/inspector_js_embed.rs"));

const INSPECTOR_JS_FALLBACK: &str =
    "console.warn('[horizon-gateway] inspector.js not built; run pnpm build:injection');";

/// Reserved path prefix: proxy serves setup page and assets (no forward to local route).
pub(crate) const HORIZON_GATEWAY_PATH_PREFIX: &str = "/.horizon-gateway/";

/// Inspector/setup requests that must never appear in domain API logs.
pub(crate) fn is_horizon_gateway_internal(path: &str, url: &str) -> bool {
    contains_horizon_gateway_prefix(path) || contains_horizon_gateway_prefix(url)
}

/// Canonical `/.horizon-gateway/...` path, ignoring query strings and a missing leading slash.
pub(crate) fn normalize_horizon_gateway_path(path: &str, uri: &str) -> String {
    let raw = first_horizon_gateway_slice(uri)
        .or_else(|| first_horizon_gateway_slice(path))
        .unwrap_or(path);
    let without_query = raw.split('?').next().unwrap_or(raw);
    if without_query.starts_with(HORIZON_GATEWAY_PATH_PREFIX) {
        without_query.to_string()
    } else if let Some(rest) = without_query.strip_prefix(".horizon-gateway/") {
        format!("{HORIZON_GATEWAY_PATH_PREFIX}{rest}")
    } else {
        without_query.to_string()
    }
}

fn contains_horizon_gateway_prefix(value: &str) -> bool {
    value.contains(HORIZON_GATEWAY_PATH_PREFIX) || value.contains(".horizon-gateway/")
}

fn first_horizon_gateway_slice(value: &str) -> Option<&str> {
    if let Some(idx) = value.find(HORIZON_GATEWAY_PATH_PREFIX) {
        return Some(&value[idx..]);
    }
    value.find(".horizon-gateway/").map(|idx| &value[idx..])
}

/// PAC (Proxy Auto-Config). Returns DIRECT for loopback, tailscale, and bypass hosts; PROXY for all other traffic.
pub(crate) fn build_pac_js(proxy_host: &str, forward_port: u16, bypass_hosts: &[String]) -> String {
    let mut bypass_js_array = String::new();
    for host in bypass_hosts {
        let clean = host.trim().to_lowercase();
        if clean.is_empty() {
            continue;
        }
        if !bypass_js_array.is_empty() {
            bypass_js_array.push_str(", ");
        }
        bypass_js_array.push('"');
        bypass_js_array.push_str(&clean.replace('\\', "\\\\").replace('"', "\\\""));
        bypass_js_array.push('"');
    }

    format!(
        "function FindProxyForURL(url, host) {{\n\
           if (isPlainHostName(host) ||\n\
               host === 'localhost' ||\n\
               host === '127.0.0.1' ||\n\
               host === '::1' ||\n\
               host.indexOf('tailscale') !== -1 ||\n\
               host.indexOf('.ts.net') !== -1) {{\n\
               return 'DIRECT';\n\
           }}\n\
           var bypass = [{bypass_js_array}];\n\
           var lHost = host.toLowerCase();\n\
           for (var i = 0; i < bypass.length; i++) {{\n\
               var b = bypass[i];\n\
               if (lHost === b || (lHost.length > b.length && lHost.lastIndexOf('.' + b) === lHost.length - b.length - 1) || (b.indexOf('.') === -1 && lHost.indexOf(b) !== -1)) {{\n\
                   return 'DIRECT';\n\
               }}\n\
           }}\n\
           return \"PROXY {proxy_host}:{forward_port}; DIRECT\";\n\
        }}"
    )
}

pub(crate) async fn serve_horizon_gateway_reserved_path(
    state: Arc<ProxyState>,
    path: &str,
    host_h: &str,
) -> Response {
    if path == "/.horizon-gateway/proxy.pac" || path.starts_with("/.horizon-gateway/proxy.pac") {
        let Some(port) = state.forward_proxy_port else {
            return (StatusCode::NOT_FOUND, "Forward proxy port not configured").into_response();
        };

        let parsed_host = host_h.split(':').next().unwrap_or("");
        let hosts = crate::service::tunnel_service::collect_remote_hosts();
        let proxy_host = crate::service::tunnel_service::proxy_advertise_host(
            parsed_host,
            state.proxy_settings.get().allow_remote_access,
            &hosts,
        );

        let settings = state.proxy_settings.get();
        let pac = build_pac_js(&proxy_host, port, &settings.tls_bypass_hosts);
        return (
            StatusCode::OK,
            [
                (
                    CONTENT_TYPE,
                    HeaderValue::from_static("application/x-ns-proxy-autoconfig"),
                ),
                (
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("no-cache, no-store, must-revalidate"),
                ),
                (header::PRAGMA, HeaderValue::from_static("no-cache")),
                (header::EXPIRES, HeaderValue::from_static("0")),
            ],
            pac,
        )
            .into_response();
    }
    if path == "/.horizon-gateway/setup" || path.starts_with("/.horizon-gateway/setup") {
        let proxy_port_msg = state
            .forward_proxy_port
            .map(|p| format!(" (Forward proxy: 127.0.0.1:{p})"))
            .unwrap_or_default();
        let port = state.forward_proxy_port.unwrap_or(0);
        let html = include_str!("../../../../resources/setup.html")
            .replace("%PROXY_PORT_MSG%", &proxy_port_msg)
            .replace("%PROXY_PORT%", &port.to_string());
        return Html(html).into_response();
    }
    if path == "/.horizon-gateway/root.crt" {
        let ca_pem = state.ca_service.ca_cert_pem();
        return (
            StatusCode::OK,
            [
                (
                    CONTENT_TYPE,
                    HeaderValue::from_static("application/x-x509-ca-cert"),
                ),
                (
                    header::CONTENT_DISPOSITION,
                    HeaderValue::from_static(
                        "attachment; filename=\"horizon-gateway-root-ca.crt\"",
                    ),
                ),
            ],
            ca_pem,
        )
            .into_response();
    }
    if path.starts_with("/.horizon-gateway/cert/") {
        let host = path.trim_start_matches("/.horizon-gateway/cert/").trim();
        if host.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                "Missing host in path: /.horizon-gateway/cert/<host>",
            )
                .into_response();
        }
        return serve_cert_pem(Arc::clone(&state), host).into_response();
    }
    if path == "/.horizon-gateway/ca.crt" || path.starts_with("/.horizon-gateway/ca.crt") {
        let pem = state.ca_service.ca_cert_pem();
        return (
            StatusCode::OK,
            [
                (
                    CONTENT_TYPE,
                    HeaderValue::from_static("application/x-x509-ca-cert"),
                ),
                (
                    axum::http::header::CONTENT_DISPOSITION,
                    HeaderValue::from_static("attachment; filename=\"horizon-gateway-ca.crt\""),
                ),
            ],
            pem,
        )
            .into_response();
    }
    if path == "/.horizon-gateway/inspector.js" {
        let js = load_inspector_js(state.app_handle.as_ref());

        return (
            StatusCode::OK,
            [
                (
                    CONTENT_TYPE,
                    HeaderValue::from_static("application/javascript"),
                ),
                (
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("no-store, no-cache, must-revalidate, max-age=0"),
                ),
                (header::PRAGMA, HeaderValue::from_static("no-cache")),
                (header::EXPIRES, HeaderValue::from_static("0")),
            ],
            js,
        )
            .into_response();
    }
    if path == "/.horizon-gateway/logo.svg" {
        let svg = include_str!("../../../../../../app-icon.svg");
        return (
            StatusCode::OK,
            [(CONTENT_TYPE, HeaderValue::from_static("image/svg+xml"))],
            svg,
        )
            .into_response();
    }
    if path == "/.horizon-gateway/api/annotation" {
        // We'll handle POST request in a separate part or here by checking method
        // But serve_horizon_gateway_reserved_path is called with the whole request context in proxy_handler_inner
        return (StatusCode::METHOD_NOT_ALLOWED, "Use POST for this endpoint").into_response();
    }
    (StatusCode::NOT_FOUND, "Not found").into_response()
}

fn load_inspector_js(app: Option<&()>) -> String {
    for candidate in inspector_js_candidates(app) {
        if let Ok(content) = std::fs::read_to_string(&candidate) {
            if !content.trim().is_empty() {
                return content;
            }
        }
    }

    if let Some(embedded) = EMBEDDED_INSPECTOR_JS {
        if !embedded.trim().is_empty() {
            return embedded.to_string();
        }
    }

    crate::proxy_log!(
        "⚠️ [Horizon Gateway] inspector.js not found on disk or embedded; serving stub. Tried: {:?}",
        inspector_js_candidates(app)
    );
    INSPECTOR_JS_FALLBACK.to_string()
}

fn inspector_js_candidates(_app: Option<&()>) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join("dist").join("inspector.js"));
        paths.push(
            cwd.join("src-tauri")
                .join("hg-serve")
                .join("resources")
                .join("inspector.js"),
        );
        paths.push(
            cwd.join("src-tauri")
                .join("hg-gui")
                .join("resources")
                .join("inspector.js"),
        );
        push_inspector_variants(&mut paths, &cwd);
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            push_inspector_variants(&mut paths, exe_dir);
            let mut cur = exe_dir.to_path_buf();
            for _ in 0..8 {
                push_inspector_variants(&mut paths, &cur);
                paths.push(cur.join("dist").join("inspector.js"));
                paths.push(
                    cur.join("src-tauri")
                        .join("hg-serve")
                        .join("resources")
                        .join("inspector.js"),
                );
                paths.push(
                    cur.join("src-tauri")
                        .join("hg-gui")
                        .join("resources")
                        .join("inspector.js"),
                );
                if !cur.pop() {
                    break;
                }
            }
        }
    }

    if let Ok(dir) = crate::runtime::paths::resolve_app_data_dir() {
        push_inspector_variants(&mut paths, &dir);
    }

    // Compile-time src-tauri path — reliable for local `tauri dev` regardless of process CWD.
    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("inspector.js"),
    );

    paths
}

fn push_inspector_variants(paths: &mut Vec<PathBuf>, base: &Path) {
    paths.push(base.join("inspector.js"));
    paths.push(base.join("resources").join("inspector.js"));
    paths.push(base.join("dist").join("inspector.js"));
}
