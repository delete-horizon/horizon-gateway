use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Longest delay the proxy waits before sending a mocked response.
/// Larger configured values are clamped to this bound.
pub const MAX_MOCK_DELAY_MS: u64 = 30_000;

/// Clamp a configured mock delay to `0..=MAX_MOCK_DELAY_MS`.
#[must_use]
pub fn clamp_mock_delay_ms(delay_ms: u64) -> u64 {
    delay_ms.min(MAX_MOCK_DELAY_MS)
}

#[derive(Serialize, Deserialize, Clone, Debug, specta::Type)]
pub struct MockRule {
    pub id: String,
    pub name: String,
    pub scenario_id: String,
    pub host: Option<String>, // domain to match
    pub method: String,
    pub url_pattern: String,
    pub response_status: u16,
    pub response_headers: HashMap<String, String>,
    pub response_body: Option<String>,
    pub enabled: bool,
    /// Artificial latency in milliseconds. Missing values on older files load as `0`.
    #[serde(default)]
    pub delay_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_delay_defaults_to_zero() {
        let json = r#"{
            "id":"1",
            "name":"n",
            "scenario_id":"s",
            "host":null,
            "method":"GET",
            "url_pattern":"/",
            "response_status":200,
            "response_headers":{},
            "response_body":null,
            "enabled":true
        }"#;
        let rule: MockRule = serde_json::from_str(json).expect("rule json");
        assert_eq!(rule.delay_ms, 0);
    }

    #[test]
    fn clamp_limits_delay_to_the_upper_bound() {
        assert_eq!(clamp_mock_delay_ms(0), 0);
        assert_eq!(clamp_mock_delay_ms(1), 1);
        assert_eq!(clamp_mock_delay_ms(MAX_MOCK_DELAY_MS), MAX_MOCK_DELAY_MS);
        assert_eq!(
            clamp_mock_delay_ms(MAX_MOCK_DELAY_MS + 1),
            MAX_MOCK_DELAY_MS
        );
        assert_eq!(clamp_mock_delay_ms(u64::MAX), MAX_MOCK_DELAY_MS);
    }
}
