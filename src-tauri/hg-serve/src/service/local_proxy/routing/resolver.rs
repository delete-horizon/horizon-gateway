use crate::model::local_route::LocalRoute;
use axum::http::Uri;

use super::host::{route_domain_scheme, route_domain_to_host};

/// (`target_uri_string`, `pass_through_host`, `target_host_header`, `local_origin`).
/// When local route matches, `local_origin` = `Some((target_host`, `target_port`, `path_and_query`))
/// so we can connect directly and send request in origin-form (GET /path HTTP/1.1).
/// Route domain can be hostname (dev.modetour.local) or URL (<https://dev.modetour.local>/); we match by host.
pub(crate) fn resolve_target(
    uri: &Uri,
    host_from_header: Option<&str>,
    routes: &[crate::model::local_route::LocalRoute],
    connection_scheme: &str,
) -> (
    String,
    Option<String>,
    Option<String>,
    Option<(String, u16, String)>,
) {
    let host = uri
        .authority()
        .map(axum::http::uri::Authority::host)
        .or(host_from_header)
        .unwrap_or("");
    let host_no_port = host.split(':').next().unwrap_or(host).trim();

    let path_query = uri
        .path_and_query()
        .map_or("/", axum::http::uri::PathAndQuery::as_str);
    let request_scheme = uri.scheme_str().unwrap_or(connection_scheme);

    // Collect matching routes (by normalized host); prefer scheme-specific (https for https request, etc.)
    let mut best: Option<&LocalRoute> = None;
    for r in routes {
        if !r.enabled {
            continue;
        }
        let route_host = route_domain_to_host(r.domain.as_str());
        if !route_host.eq_ignore_ascii_case(host_no_port) {
            continue;
        }
        let route_scheme = route_domain_scheme(r.domain.as_str());
        match (best, route_scheme) {
            (None, _) => best = Some(r),
            (Some(_prev), None) => { /* keep prev (more specific) */ }
            (Some(prev), Some(rs)) => {
                let prev_scheme = route_domain_scheme(prev.domain.as_str());
                if prev_scheme.is_none() && rs == request_scheme {
                    best = Some(r); // prefer scheme-specific match
                } else if prev_scheme == Some(request_scheme) && rs != request_scheme {
                    /* keep prev */
                } else if rs == request_scheme {
                    best = Some(r);
                }
            }
        }
    }
    if let Some(r) = best {
        let path = path_query.to_string();
        let target_host_clean = if r.target_host.eq_ignore_ascii_case("localhost") {
            "127.0.0.1"
        } else {
            r.target_host.as_str()
        };
        return (
            format!(
                "http://{}:{}{}",
                target_host_clean, r.target_port, path_query
            ),
            None,
            Some(r.target_host.clone()),
            Some((target_host_clean.to_string(), r.target_port, path)),
        );
    }

    // When Host is 127.0.0.1 or localhost:
    // If an explicit port was requested (e.g. localhost:3000), pass through directly to 127.0.0.1:port
    // instead of hijacking to an unrelated route.
    let host_no_port = host.split(':').next().unwrap_or(host).trim();
    let port_explicit = uri.authority().and_then(|a| a.port_u16()).or_else(|| {
        host_from_header
            .and_then(|h| h.split(':').nth(1))
            .and_then(|p| p.parse::<u16>().ok())
    });
    if (host_no_port.eq_ignore_ascii_case("127.0.0.1")
        || host_no_port.eq_ignore_ascii_case("localhost"))
        && !host_no_port.is_empty()
    {
        if let Some(port) = port_explicit {
            let path = path_query.to_string();
            return (
                format!("http://127.0.0.1:{}{}", port, path_query),
                None,
                Some("127.0.0.1".to_string()),
                Some(("127.0.0.1".to_string(), port, path)),
            );
        }
        if let Some(r) = routes.iter().find(|r| r.enabled) {
            let path = path_query.to_string();
            let target_host_clean = if r.target_host.eq_ignore_ascii_case("localhost") {
                "127.0.0.1"
            } else {
                r.target_host.as_str()
            };
            return (
                format!(
                    "http://{}:{}{}",
                    target_host_clean, r.target_port, path_query
                ),
                None,
                Some(r.target_host.clone()),
                Some((target_host_clean.to_string(), r.target_port, path)),
            );
        }
    }

    // Pass-through
    let target = if uri.scheme().is_some() && uri.authority().is_some() {
        uri.to_string()
    } else if let Some(h) = host_from_header {
        let scheme = uri.scheme_str().unwrap_or(connection_scheme);
        let host_part = h.trim_end_matches('/');
        let path_part = if path_query.starts_with('/') {
            path_query
        } else {
            &format!("/{path_query}")
        };
        format!("{scheme}://{host_part}{path_part}")
    } else {
        let host_part = host.trim_end_matches('/');
        let path_part = if path_query.starts_with('/') {
            path_query
        } else {
            &format!("/{path_query}")
        };
        format!("{connection_scheme}://{host_part}{path_part}")
    };
    (target, Some(host.to_string()), None, None)
}

/// For CONNECT host:port, if host matches a local route return `Some((target_host`, `target_port`)).
/// CONNECT is always HTTPS; prefer route whose domain is "https://..." when multiple match.
pub(crate) fn resolve_connect_target(host: &str, routes: &[LocalRoute]) -> Option<(String, u16)> {
    let host_no_port = host.split(':').next().unwrap_or(host).trim();
    let mut best: Option<&LocalRoute> = None;
    for r in routes {
        if !r.enabled {
            continue;
        }
        let route_host = route_domain_to_host(r.domain.as_str());
        if !route_host.eq_ignore_ascii_case(host_no_port) {
            continue;
        }
        let route_scheme = route_domain_scheme(r.domain.as_str());
        match (best, route_scheme) {
            (None, _) => best = Some(r),
            (Some(_prev), None) => { /* keep prev */ }
            (Some(prev), Some(rs)) => {
                let prev_scheme = route_domain_scheme(prev.domain.as_str());
                if rs == "https" && prev_scheme != Some("https") {
                    best = Some(r); // prefer https-specific for CONNECT
                } else if prev_scheme == Some("https") && rs != "https" {
                    /* keep prev */
                } else {
                    best = Some(r);
                }
            }
        }
    }
    best.map(|r| {
        let target_host_clean = if r.target_host.eq_ignore_ascii_case("localhost") {
            "127.0.0.1".to_string()
        } else {
            r.target_host.clone()
        };
        (target_host_clean, r.target_port)
    })
}
