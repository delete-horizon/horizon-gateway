use super::super::resolver::{resolve_connect_target, resolve_target};
use crate::model::local_route::LocalRoute;
use axum::http::Uri;

#[test]
fn test_resolve_target_empty_routes_passthrough() {
    let uri: Uri = "http://example.com/path?q=1".parse().unwrap();
    let (target_uri, _pass_host, _target_host_value, local_origin) =
        resolve_target(&uri, Some("example.com"), &[], "http");

    assert!(
        local_origin.is_none(),
        "empty routes should yield no local_origin"
    );
    assert!(
        target_uri.contains("example.com"),
        "pass-through target should contain original host, got: {target_uri}"
    );
}

#[test]
fn test_resolve_target_with_matching_route() {
    let route = LocalRoute {
        id: 1,
        domain_id: 1,
        domain: "api.example.com".to_string(),
        target_host: "127.0.0.1".to_string(),
        target_port: 3000,
        enabled: true,
    };
    let uri: Uri = "http://api.example.com/foo".parse().unwrap();
    let (_target_uri, _pass_host, _target_host_value, local_origin) =
        resolve_target(&uri, Some("api.example.com"), &[route], "http");

    assert!(
        local_origin.is_some(),
        "matching route should yield local_origin"
    );
    let (host, port, path) = local_origin.unwrap();
    assert_eq!(host, "127.0.0.1");
    assert_eq!(port, 3000);
    assert_eq!(path, "/foo");
}

#[test]
fn test_resolve_target_disabled_route_no_match() {
    let route = LocalRoute {
        id: 1,
        domain_id: 1,
        domain: "api.example.com".to_string(),
        target_host: "127.0.0.1".to_string(),
        target_port: 3000,
        enabled: false,
    };
    let uri: Uri = "http://api.example.com/foo".parse().unwrap();
    let (_target_uri, _pass_host, _target_host_value, local_origin) =
        resolve_target(&uri, Some("api.example.com"), &[route], "http");

    assert!(local_origin.is_none(), "disabled route should not match");
}

#[test]
fn test_resolve_connect_target_empty_routes() {
    let result = resolve_connect_target("api.example.com", &[]);
    assert!(
        result.is_none(),
        "empty routes should return None for CONNECT"
    );
}

#[test]
fn test_resolve_connect_target_matching_route() {
    let route = LocalRoute {
        id: 1,
        domain_id: 1,
        domain: "api.example.com".to_string(),
        target_host: "127.0.0.1".to_string(),
        target_port: 3000,
        enabled: true,
    };
    let result = resolve_connect_target("api.example.com", &[route]);
    assert!(result.is_some());
    let (host, port) = result.unwrap();
    assert_eq!(host, "127.0.0.1");
    assert_eq!(port, 3000);
}

#[test]
fn test_resolve_target_localhost_normalized() {
    let route = LocalRoute {
        id: 1,
        domain_id: 1,
        domain: "www.example.dev".to_string(),
        target_host: "localhost".to_string(),
        target_port: 3000,
        enabled: true,
    };
    let uri: Uri = "http://www.example.dev/test".parse().unwrap();
    let (target_uri, _pass_host, _target_host_value, local_origin) =
        resolve_target(&uri, Some("www.example.dev"), &[route], "http");

    assert!(local_origin.is_some());
    let (host, port, path) = local_origin.unwrap();
    assert_eq!(host, "127.0.0.1", "localhost must normalize to 127.0.0.1");
    assert_eq!(port, 3000);
    assert_eq!(path, "/test");
    assert_eq!(target_uri, "http://127.0.0.1:3000/test");
}

#[test]
fn test_resolve_target_explicit_localhost_port_preserved() {
    let route = LocalRoute {
        id: 1,
        domain_id: 1,
        domain: "other.dev".to_string(),
        target_host: "127.0.0.1".to_string(),
        target_port: 8080,
        enabled: true,
    };
    let uri: Uri = "http://localhost:3000/api/check".parse().unwrap();
    let (target_uri, _pass_host, _target_host_value, local_origin) =
        resolve_target(&uri, Some("localhost:3000"), &[route], "http");

    assert!(local_origin.is_some());
    let (host, port, path) = local_origin.unwrap();
    assert_eq!(host, "127.0.0.1");
    assert_eq!(
        port, 3000,
        "Must preserve explicit port 3000 instead of hijacking to 8080"
    );
    assert_eq!(path, "/api/check");
    assert_eq!(target_uri, "http://127.0.0.1:3000/api/check");
}

#[test]
fn test_resolve_connect_target_localhost_normalized() {
    let route = LocalRoute {
        id: 1,
        domain_id: 1,
        domain: "www.example.dev".to_string(),
        target_host: "localhost".to_string(),
        target_port: 3000,
        enabled: true,
    };
    let result = resolve_connect_target("www.example.dev", &[route]);
    assert!(result.is_some());
    let (host, port) = result.unwrap();
    assert_eq!(
        host, "127.0.0.1",
        "localhost must normalize to 127.0.0.1 for connect"
    );
    assert_eq!(port, 3000);
}
