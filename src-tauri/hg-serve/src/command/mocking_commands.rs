use crate::model::api_response::ApiResponse;
use crate::model::mock_rule::MockRule;
use crate::model::mocking_settings::MockingSettings;
use crate::model::scenario::Scenario;
use crate::service::api_log_service::ApiLogService;
use crate::service::mocking_service::MockingService;
use std::collections::HashMap;

pub const MOCKING_STATUS_CHANGED: &str = "mocking-status-changed";

pub const GET_MOCKING_STATUS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_mocking_status",
    description: "모킹 활성화 상태 및 설정을 조회합니다.",
    payload_example: "{}",
    category: "mocking",
    gui_only: false,
};

pub fn get_mocking_status_svc(
    service: &std::sync::Arc<MockingService>,
) -> Result<ApiResponse<MockingSettings>, String> {
    Ok(ApiResponse {
        message: "OK".to_string(),
        success: true,
        data: service.get_settings(),
    })
}

pub const GET_SCENARIOS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_scenarios",
    description: "모킹 시나리오 목록을 조회합니다.",
    payload_example: "{}",
    category: "mocking",
    gui_only: false,
};

pub fn get_scenarios_svc(
    service: &std::sync::Arc<MockingService>,
) -> Result<ApiResponse<Vec<Scenario>>, String> {
    Ok(ApiResponse {
        message: "OK".to_string(),
        success: true,
        data: service.get_scenarios(),
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateScenarioPayload {
    pub name: String,
    pub description: Option<String>,
}

pub const CREATE_SCENARIO_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "create_scenario",
    description: "새로운 모킹 시나리오를 생성합니다.",
    payload_example: r#"{"name": "Scenario Name", "description": "Description"}"#,
    category: "mocking",
    gui_only: false,
};

pub fn create_scenario_svc(
    payload: CreateScenarioPayload,
    service: &std::sync::Arc<MockingService>,
) -> Result<ApiResponse<Scenario>, String> {
    let scenario = service.create_scenario(payload.name, payload.description);
    Ok(ApiResponse {
        message: "시나리오가 생성되었습니다.".to_string(),
        success: true,
        data: scenario,
    })
}

pub const UPDATE_SCENARIO_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "update_scenario",
    description: "모킹 시나리오를 수정합니다.",
    payload_example: r#"{"id": "scenario-uuid", "name": "New Name", "description": null, "enabled": null}"#,
    category: "mocking",
    gui_only: false,
};

pub fn update_scenario_svc(
    id: String,
    name: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
    service: &std::sync::Arc<MockingService>,
) -> Result<Scenario, String> {
    service
        .update_scenario(id, name, description, enabled)
        .ok_or_else(|| "Scenario not found".to_string())
}

pub const SET_SCENARIO_ENABLED_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "set_scenario_enabled",
    description: "모킹 시나리오의 활성화 여부를 설정합니다.",
    payload_example: r#"{"id": "scenario-uuid", "enabled": true}"#,
    category: "mocking",
    gui_only: false,
};

pub fn set_scenario_enabled_svc(
    id: String,
    enabled: bool,
    service: &std::sync::Arc<MockingService>,
) -> Result<Vec<Scenario>, String> {
    Ok(service.set_scenario_enabled(id, enabled))
}

pub const DELETE_SCENARIO_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "delete_scenario",
    description: "모킹 시나리오를 삭제합니다.",
    payload_example: r#""scenario-uuid""#,
    category: "mocking",
    gui_only: false,
};

pub fn delete_scenario_svc(
    id: String,
    service: &std::sync::Arc<MockingService>,
) -> Result<bool, String> {
    Ok(service.delete_scenario(id))
}

pub const GET_MOCK_RULES_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_mock_rules",
    description: "모킹 룰 목록을 조회합니다.",
    payload_example: "{}",
    category: "mocking",
    gui_only: false,
};

pub fn get_mock_rules_svc(
    service: &std::sync::Arc<MockingService>,
) -> Result<ApiResponse<Vec<MockRule>>, String> {
    Ok(ApiResponse {
        message: "OK".to_string(),
        success: true,
        data: service.get_mock_rules(),
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GetMockRulesByScenarioPayload {
    pub scenario_id: String,
}

pub const GET_MOCK_RULES_BY_SCENARIO_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "get_mock_rules_by_scenario",
        description: "특정 시나리오에 속한 모킹 룰 목록을 조회합니다.",
        payload_example: r#"{"scenarioId": "scenario-uuid"}"#,
        category: "mocking",
        gui_only: false,
    };

pub fn get_mock_rules_by_scenario_svc(
    payload: GetMockRulesByScenarioPayload,
    service: &std::sync::Arc<MockingService>,
) -> Result<ApiResponse<Vec<MockRule>>, String> {
    Ok(ApiResponse {
        message: "OK".to_string(),
        success: true,
        data: service.get_mock_rules_by_scenario(&payload.scenario_id),
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateMockRulePayload {
    pub name: String,
    /// Optional; when omitted, rules attach to the internal Default scenario.
    pub scenario_id: Option<String>,
    pub host: Option<String>,
    pub method: String,
    pub url_pattern: String,
    pub response_status: u16,
    pub response_headers: HashMap<String, String>,
    pub response_body: Option<String>,
    pub enabled: bool,
    /// Milliseconds to wait before the mocked response. Omitted values mean `0`.
    #[serde(default)]
    pub delay_ms: u64,
}

pub const CREATE_MOCK_RULE_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "create_mock_rule",
    description: "새로운 모킹 룰을 생성합니다.",
    payload_example: r#"{"name": "test rule", "scenarioId": null, "host": null, "method": "GET", "urlPattern": "/api/*", "responseStatus": 200, "responseHeaders": {}, "responseBody": "{}", "enabled": true, "delayMs": 0}"#,
    category: "mocking",
    gui_only: false,
};

pub fn create_mock_rule_svc(
    payload: CreateMockRulePayload,
    service: &std::sync::Arc<MockingService>,
) -> Result<ApiResponse<MockRule>, String> {
    let rule = service.create_mock_rule(
        payload.name,
        payload.scenario_id,
        payload.host,
        payload.method,
        payload.url_pattern,
        payload.response_status,
        payload.response_headers,
        payload.response_body,
        payload.enabled,
        payload.delay_ms,
    );
    Ok(ApiResponse {
        message: "모킹 규칙이 생성되었습니다.".to_string(),
        success: true,
        data: rule,
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMockRulePayload {
    pub id: String,
    pub name: Option<String>,
    pub host: Option<String>,
    pub method: Option<String>,
    pub url_pattern: Option<String>,
    pub response_status: Option<u16>,
    pub response_headers: Option<HashMap<String, String>>,
    pub response_body: Option<String>,
    pub enabled: Option<bool>,
    /// When omitted, the stored delay is left unchanged.
    #[serde(default)]
    pub delay_ms: Option<u64>,
}

pub const UPDATE_MOCK_RULE_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "update_mock_rule",
    description: "모킹 룰을 수정합니다.",
    payload_example: r#"{"id": "rule-uuid", "name": null, "host": null, "method": null, "urlPattern": null, "responseStatus": null, "responseHeaders": null, "responseBody": null, "enabled": null, "delayMs": null}"#,
    category: "mocking",
    gui_only: false,
};

pub fn update_mock_rule_svc(
    payload: UpdateMockRulePayload,
    service: &std::sync::Arc<MockingService>,
) -> Result<ApiResponse<MockRule>, String> {
    let rule = service
        .update_mock_rule(
            payload.id,
            payload.name,
            payload.host,
            payload.method,
            payload.url_pattern,
            payload.response_status,
            payload.response_headers,
            payload.response_body,
            payload.enabled,
            payload.delay_ms,
        )
        .ok_or_else(|| "MockRule not found".to_string())?;

    Ok(ApiResponse {
        message: "모킹 규칙이 수정되었습니다.".to_string(),
        success: true,
        data: rule,
    })
}

pub const DELETE_MOCK_RULE_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "delete_mock_rule",
    description: "모킹 룰을 삭제합니다.",
    payload_example: r#""rule-uuid""#,
    category: "mocking",
    gui_only: false,
};

pub fn delete_mock_rule_svc(
    id: String,
    service: &std::sync::Arc<MockingService>,
) -> Result<bool, String> {
    Ok(service.delete_mock_rule(id))
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateMockFromLogPayload {
    pub log_id: String,
    /// Optional; when omitted, rules attach to the internal Default scenario.
    pub scenario_id: Option<String>,
    pub name: String,
    pub log_date: String,
}

pub const CREATE_MOCK_RULE_FROM_LOG_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "create_mock_rule_from_log",
        description: "API 로그 항목을 기반으로 모킹 룰을 생성합니다.",
        payload_example: r#"{"logId": "log-uuid", "scenarioId": null, "name": "Mock from log", "logDate": "2026-07-09"}"#,
        category: "mocking",
        gui_only: false,
    };

pub fn create_mock_rule_from_log_svc(
    payload: CreateMockFromLogPayload,
    log_service: &ApiLogService,
    mock_service: &std::sync::Arc<MockingService>,
) -> Result<ApiResponse<MockRule>, String> {
    let log = log_service
        .get_log_by_id(&payload.log_id, Some(&payload.log_date))
        .ok_or_else(|| {
            "오늘 발생한 로그 중 해당 ID를 찾을 수 없습니다. (로그 날짜 불일치 가능성)".to_string()
        })?;

    let method = log.method.clone();
    let host = Some(log.host.clone());
    let url_pattern = log.path.clone();
    let response_status = log.status_code.unwrap_or(200);
    let mut response_headers = log.response_headers.unwrap_or_default();
    response_headers.retain(|k, _| {
        let k_lower = k.trim().to_lowercase();
        k_lower != "content-encoding"
            && k_lower != "content-length"
            && k_lower != "transfer-encoding"
            && k_lower != "connection"
            && k_lower != "keep-alive"
            && k_lower != "content-range"
            && k_lower != "accept-ranges"
    });
    let response_body = log.response_body.clone();

    let rule = mock_service.create_mock_rule(
        payload.name,
        payload.scenario_id,
        host,
        method,
        url_pattern,
        response_status,
        response_headers,
        response_body,
        true,
        0,
    );

    Ok(ApiResponse {
        message: "스냅샷으로부터 모킹 규칙이 생성되었습니다.".to_string(),
        success: true,
        data: rule,
    })
}

#[cfg(test)]
mod tests {
    use super::{CreateMockRulePayload, UpdateMockRulePayload};

    #[test]
    fn existing_cli_payloads_omit_delay() {
        let created: CreateMockRulePayload = serde_json::from_str(
            r#"{"name":"hg-smoke","scenarioId":null,"host":null,"method":"GET","urlPattern":"/hg-smoke","responseStatus":200,"responseHeaders":{},"responseBody":"ok","enabled":true}"#,
        )
        .expect("create payload");
        assert_eq!(created.delay_ms, 0);

        let updated: UpdateMockRulePayload = serde_json::from_str(
            r#"{"id":"rule-uuid","name":null,"host":null,"method":null,"urlPattern":null,"responseStatus":null,"responseHeaders":null,"responseBody":null,"enabled":null}"#,
        )
        .expect("update payload");
        assert!(updated.delay_ms.is_none());

        let with_delay: CreateMockRulePayload = serde_json::from_str(
            r#"{"name":"slow","scenarioId":null,"host":null,"method":"GET","urlPattern":"/slow","responseStatus":200,"responseHeaders":{},"responseBody":null,"enabled":true,"delayMs":120}"#,
        )
        .expect("delay payload");
        assert_eq!(with_delay.delay_ms, 120);
    }
}
