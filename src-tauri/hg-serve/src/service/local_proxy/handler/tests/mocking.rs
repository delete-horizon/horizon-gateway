use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::{body::Body, extract::Request, http::Uri, response::Response};

use super::super::api::json_delay_ms;
use super::super::mocking::{
    logged_request_headers, select_mock_rule, try_mock_response, wait_for_mock_delay,
};
use crate::command::mocking_commands::{
    create_mock_rule_svc, create_scenario_svc, set_scenario_enabled_svc, update_mock_rule_svc,
    CreateMockRulePayload, CreateScenarioPayload, UpdateMockRulePayload,
};
use crate::model::mock_rule::{MockRule, MAX_MOCK_DELAY_MS};
use crate::model::scenario::Scenario;
use crate::service::api_log_service::ApiLogService;
use crate::service::ca_service::CaService;
use crate::service::domain_service::DomainService;
use crate::service::inspector_service::InspectorService;
use crate::service::local_proxy::ProxyState;
use crate::service::local_route_service::LocalRouteService;
use crate::service::mocking_service::MockingService;
use crate::service::proxy_settings_service::ProxySettingsService;

fn rule(id: &str, scenario_id: &str, url: &str, enabled: bool, delay_ms: u64) -> MockRule {
    MockRule {
        id: id.to_string(),
        name: id.to_string(),
        scenario_id: scenario_id.to_string(),
        host: None,
        method: "GET".to_string(),
        url_pattern: url.to_string(),
        response_status: 200,
        response_headers: HashMap::new(),
        response_body: Some(id.to_string()),
        enabled,
        delay_ms,
    }
}

fn scenario(id: &str, name: &str, enabled: bool) -> Scenario {
    Scenario {
        id: id.to_string(),
        name: name.to_string(),
        description: None,
        enabled,
    }
}

#[test]
fn injection_editor_delay_field_is_read_from_the_save_payload() {
    assert_eq!(json_delay_ms(&serde_json::json!({})), None);
    assert_eq!(json_delay_ms(&serde_json::json!({"delay_ms": null})), None);
    assert_eq!(
        json_delay_ms(&serde_json::json!({"delay_ms": 250})),
        Some(250)
    );
    assert_eq!(json_delay_ms(&serde_json::json!({"delay_ms": -8})), Some(0));
}

fn items_uri() -> Uri {
    Uri::from_static("http://example.test/api/items")
}

#[test]
fn untied_rules_match_while_the_default_scenario_is_disabled() {
    let scenarios = vec![scenario("default", "Default", false)];
    let rules = vec![rule("global", "default", "/api/items", true, 0)];
    let uri = items_uri();
    let matched = select_mock_rule(
        &rules,
        &scenarios,
        "GET",
        &uri,
        "/api/items",
        "example.test",
    );
    assert_eq!(matched.map(|rule| rule.id.as_str()), Some("global"));
}

#[test]
fn empty_scenario_id_is_untied() {
    let rules = vec![rule("loose", "", "/api/items", true, 0)];
    let uri = items_uri();
    let matched = select_mock_rule(&rules, &[], "GET", &uri, "/api/items", "example.test");
    assert_eq!(matched.map(|rule| rule.id.as_str()), Some("loose"));
}

#[test]
fn inactive_scenario_rules_do_not_match() {
    let scenarios = vec![
        scenario("default", "Default", false),
        scenario("checkout", "Checkout", false),
    ];
    let rules = vec![rule("scoped", "checkout", "/api/items", true, 0)];
    let uri = items_uri();
    assert!(select_mock_rule(
        &rules,
        &scenarios,
        "GET",
        &uri,
        "/api/items",
        "example.test"
    )
    .is_none());
}

#[test]
fn active_scenario_rule_beats_an_earlier_untied_rule() {
    let scenarios = vec![
        scenario("default", "Default", false),
        scenario("checkout", "Checkout", true),
    ];
    let rules = vec![
        rule("global", "default", "/api/items", true, 0),
        rule("scoped", "checkout", "/api/items", true, 40),
    ];
    let uri = items_uri();
    let matched = select_mock_rule(
        &rules,
        &scenarios,
        "GET",
        &uri,
        "/api/items",
        "example.test",
    );
    assert_eq!(matched.map(|rule| rule.id.as_str()), Some("scoped"));
}

#[test]
fn untied_rule_still_matches_when_the_active_scenario_misses() {
    let scenarios = vec![
        scenario("default", "Default", false),
        scenario("checkout", "Checkout", true),
    ];
    let rules = vec![
        rule("global", "default", "/api/fallback", true, 0),
        rule("scoped", "checkout", "/api/items", true, 0),
    ];
    let uri = Uri::from_static("http://example.test/api/fallback");
    let matched = select_mock_rule(
        &rules,
        &scenarios,
        "GET",
        &uri,
        "/api/fallback",
        "example.test",
    );
    assert_eq!(matched.map(|rule| rule.id.as_str()), Some("global"));
}

#[test]
fn disabled_active_scenario_rule_falls_through_to_untied() {
    let scenarios = vec![
        scenario("default", "Default", false),
        scenario("checkout", "Checkout", true),
    ];
    let rules = vec![
        rule("global", "default", "/api/items", true, 0),
        rule("scoped", "checkout", "/api/items", false, 0),
    ];
    let uri = items_uri();
    let matched = select_mock_rule(
        &rules,
        &scenarios,
        "GET",
        &uri,
        "/api/items",
        "example.test",
    );
    assert_eq!(matched.map(|rule| rule.id.as_str()), Some("global"));
}

#[test]
fn first_stored_active_rule_wins_within_the_scenario() {
    let scenarios = vec![scenario("checkout", "Checkout", true)];
    let rules = vec![
        rule("first", "checkout", "/api/items", true, 0),
        rule("second", "checkout", "/api/items", true, 0),
    ];
    let uri = items_uri();
    let matched = select_mock_rule(
        &rules,
        &scenarios,
        "GET",
        &uri,
        "/api/items",
        "example.test",
    );
    assert_eq!(matched.map(|rule| rule.id.as_str()), Some("first"));
}

#[tokio::test(start_paused = true)]
async fn zero_delay_does_not_wait() {
    let started = tokio::time::Instant::now();
    wait_for_mock_delay(0).await;
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn configured_delay_waits_on_the_async_clock() {
    let started = tokio::time::Instant::now();
    wait_for_mock_delay(80).await;
    assert_eq!(started.elapsed(), Duration::from_millis(80));
}

#[tokio::test(start_paused = true)]
async fn delay_above_the_cap_waits_only_the_cap() {
    let started = tokio::time::Instant::now();
    wait_for_mock_delay(u64::MAX).await;
    assert_eq!(started.elapsed(), Duration::from_millis(MAX_MOCK_DELAY_MS));
}

fn create_payload(
    name: &str,
    scenario_id: Option<String>,
    url: &str,
    body: &str,
    delay_ms: u64,
) -> CreateMockRulePayload {
    CreateMockRulePayload {
        name: name.to_string(),
        scenario_id,
        host: None,
        method: "GET".to_string(),
        url_pattern: url.to_string(),
        response_status: 200,
        response_headers: HashMap::new(),
        response_body: Some(body.to_string()),
        enabled: true,
        delay_ms,
    }
}

fn proxy_state(dir: &std::path::Path, mocking: Arc<MockingService>) -> Arc<ProxyState> {
    crate::install_rustls_provider();
    Arc::new(ProxyState::new(
        None,
        Arc::new(LocalRouteService::new(dir.join("routes.json"))),
        None,
        None,
        Arc::new(RwLock::new(HashMap::new())),
        Arc::new(ApiLogService::new(dir.to_path_buf())),
        Arc::new(CaService::new(dir).expect("ca")),
        mocking,
        Arc::new(InspectorService::new(
            dir.join("annotations.json"),
            dir.join("injection.json"),
            dir.join("inspector.json"),
        )),
        Arc::new(DomainService::new(dir.join("domains.json"))),
        Arc::new(ProxySettingsService::new(dir.join("proxy.json"))),
    ))
}

async fn mock_body(state: &Arc<ProxyState>, path: &str) -> Option<String> {
    let uri: Uri = format!("http://example.test{path}").parse().expect("uri");
    let req = Request::builder()
        .uri(uri.clone())
        .body(Body::empty())
        .expect("request");
    let response = try_mock_response(
        state,
        logged_request_headers(&req),
        "GET",
        &uri,
        path,
        "example.test",
    )
    .await?;
    Some(read_body(response).await)
}

async fn read_body(response: Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    String::from_utf8(bytes.to_vec()).expect("utf8")
}

#[tokio::test(start_paused = true)]
async fn cli_rules_drive_proxy_delay_and_scenario_precedence() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = Arc::new(MockingService::new(
        dir.path().join("scenarios.json"),
        dir.path().join("rules.json"),
        dir.path().join("settings.json"),
    ));
    create_mock_rule_svc(
        create_payload("global", None, "/api/items", "global", 0),
        &service,
    )
    .expect("global rule");
    create_mock_rule_svc(
        create_payload("fallback", None, "/api/fallback", "fallback", 0),
        &service,
    )
    .expect("fallback rule");
    let scenario = create_scenario_svc(
        CreateScenarioPayload {
            name: "Checkout".to_string(),
            description: None,
        },
        &service,
    )
    .expect("scenario");
    create_mock_rule_svc(
        create_payload(
            "scoped",
            Some(scenario.data.id.clone()),
            "/api/items",
            "scoped",
            25,
        ),
        &service,
    )
    .expect("scoped rule");
    create_mock_rule_svc(
        create_payload(
            "only",
            Some(scenario.data.id.clone()),
            "/api/only",
            "only",
            0,
        ),
        &service,
    )
    .expect("scenario-only rule");

    let state = proxy_state(dir.path(), Arc::clone(&service));

    let started = tokio::time::Instant::now();
    assert_eq!(
        mock_body(&state, "/api/items").await.as_deref(),
        Some("global")
    );
    assert_eq!(started.elapsed(), Duration::ZERO);
    assert!(mock_body(&state, "/api/only").await.is_none());

    set_scenario_enabled_svc(scenario.data.id.clone(), true, &service).expect("enable");

    let started = tokio::time::Instant::now();
    assert_eq!(
        mock_body(&state, "/api/items").await.as_deref(),
        Some("scoped")
    );
    assert_eq!(started.elapsed(), Duration::from_millis(25));

    let started = tokio::time::Instant::now();
    assert_eq!(
        mock_body(&state, "/api/fallback").await.as_deref(),
        Some("fallback")
    );
    assert_eq!(started.elapsed(), Duration::ZERO);
    assert_eq!(
        mock_body(&state, "/api/only").await.as_deref(),
        Some("only")
    );

    let scoped_id = service
        .get_mock_rules()
        .into_iter()
        .find(|rule| rule.name == "scoped")
        .expect("scoped")
        .id;
    let updated = update_mock_rule_svc(
        UpdateMockRulePayload {
            id: scoped_id,
            name: None,
            host: None,
            method: None,
            url_pattern: None,
            response_status: None,
            response_headers: None,
            response_body: None,
            enabled: None,
            delay_ms: Some(u64::MAX),
        },
        &service,
    )
    .expect("update delay");
    assert_eq!(updated.data.delay_ms, MAX_MOCK_DELAY_MS);

    let started = tokio::time::Instant::now();
    assert_eq!(
        mock_body(&state, "/api/items").await.as_deref(),
        Some("scoped")
    );
    assert_eq!(started.elapsed(), Duration::from_millis(MAX_MOCK_DELAY_MS));
}
