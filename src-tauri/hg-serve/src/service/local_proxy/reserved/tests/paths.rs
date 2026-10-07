use super::super::paths::{
    build_pac_js, is_horizon_gateway_internal, normalize_horizon_gateway_path,
};

#[test]
fn build_pac_js_contains_proxy() {
    let bypass = vec!["teams.microsoft.com".to_string(), "okta.com".to_string()];
    let pac = build_pac_js("127.0.0.1", 8080, &bypass);
    assert!(pac.contains("127.0.0.1"));
    assert!(pac.contains("8080"));
    assert!(pac.contains("teams.microsoft.com"));
    assert!(pac.contains("okta.com"));
}

#[test]
fn reserved_annotation_polls_are_internal() {
    assert!(is_horizon_gateway_internal(
        "/.horizon-gateway/api/annotations",
        "https://www.example.dev/.horizon-gateway/api/annotations",
    ));
    assert!(is_horizon_gateway_internal(
        "/.horizon-gateway/api/annotations/stream",
        "https://auth.example.dev/.horizon-gateway/api/annotations/stream",
    ));
    assert!(is_horizon_gateway_internal(
        ".horizon-gateway/api/annotations",
        "https://www.example.dev/.horizon-gateway/api/annotations",
    ));
}

#[test]
fn origin_apis_are_not_internal() {
    assert!(!is_horizon_gateway_internal(
        "/User/Me",
        "https://b2c-api.example.dev/User/Me",
    ));
    assert!(!is_horizon_gateway_internal(
        "/api/annotations",
        "https://www.example.dev/api/annotations"
    ));
}

#[test]
fn normalize_strips_query_and_missing_slash() {
    assert_eq!(
        normalize_horizon_gateway_path(
            ".horizon-gateway/api/annotations",
            "https://www.example.dev/.horizon-gateway/api/annotations?x=1",
        ),
        "/.horizon-gateway/api/annotations"
    );
    assert_eq!(
        normalize_horizon_gateway_path("/.horizon-gateway/api/annotations/stream", ""),
        "/.horizon-gateway/api/annotations/stream"
    );
}
