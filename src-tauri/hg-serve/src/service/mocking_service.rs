use crate::model::mock_rule::{clamp_mock_delay_ms, MockRule};
use crate::model::mocking_settings::MockingSettings;
use crate::model::scenario::Scenario;
use crate::storage::versioned::{load_versioned, save_versioned};
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

pub struct MockingService {
    pub scenarios: Mutex<Vec<Scenario>>,
    pub mock_rules: Mutex<Vec<MockRule>>,
    pub settings: Mutex<MockingSettings>,
    scenarios_path: PathBuf,
    mock_rules_path: PathBuf,
    settings_path: PathBuf,
}

impl MockingService {
    pub const DEFAULT_SCENARIO_NAME: &'static str = "Default";

    pub fn new(scenarios_path: PathBuf, mock_rules_path: PathBuf, settings_path: PathBuf) -> Self {
        let initial_scenarios = load_versioned(&scenarios_path);
        let initial_mock_rules = load_versioned(&mock_rules_path);
        let initial_settings = load_versioned(&settings_path);

        let service = Self {
            scenarios: Mutex::new(initial_scenarios),
            mock_rules: Mutex::new(initial_mock_rules),
            settings: Mutex::new(initial_settings),
            scenarios_path,
            mock_rules_path,
            settings_path,
        };
        // Ensure a hidden default scenario exists so rules can be created without UI.
        let _ = service.ensure_default_scenario();
        service
    }

    /// Returns an existing Default scenario, or the first scenario, or creates Default.
    pub fn ensure_default_scenario(&self) -> Scenario {
        {
            let list = self.scenarios.lock().unwrap();
            if let Some(existing) = list
                .iter()
                .find(|s| s.name == Self::DEFAULT_SCENARIO_NAME)
                .cloned()
            {
                return existing;
            }
            if let Some(first) = list.first().cloned() {
                return first;
            }
        }
        self.create_scenario(Self::DEFAULT_SCENARIO_NAME.to_string(), None)
    }

    fn save_scenarios(&self, list: &[Scenario]) {
        save_versioned(&self.scenarios_path, list);
    }

    fn save_mock_rules(&self, list: &[MockRule]) {
        save_versioned(&self.mock_rules_path, list);
    }

    fn save_settings(&self, settings: &MockingSettings) {
        save_versioned(&self.settings_path, settings);
    }

    pub fn get_settings(&self) -> MockingSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_enabled(&self, enabled: bool) -> MockingSettings {
        let mut s = self.settings.lock().unwrap();
        s.enabled = enabled;
        let out = s.clone();
        self.save_settings(&out);
        out
    }

    /// One-shot migration: turn every rule off when the legacy master switch was off.
    pub fn disable_all_rules(&self) {
        let mut list = self.mock_rules.lock().unwrap();
        let mut changed = false;
        for rule in list.iter_mut() {
            if rule.enabled {
                rule.enabled = false;
                changed = true;
            }
        }
        if changed {
            self.save_mock_rules(&list);
        }
    }

    pub fn get_scenarios(&self) -> Vec<Scenario> {
        self.scenarios.lock().unwrap().clone()
    }

    pub fn set_scenario_enabled(&self, id: String, enabled: bool) -> Vec<Scenario> {
        let mut list = self.scenarios.lock().unwrap();
        for s in list.iter_mut() {
            if s.id == id {
                s.enabled = enabled;
            } else if enabled {
                // Exclusive enable: if we are enabling one, disable others
                s.enabled = false;
            }
        }
        let out = list.clone();
        self.save_scenarios(&out);
        out
    }

    pub fn create_scenario(&self, name: String, description: Option<String>) -> Scenario {
        let mut list = self.scenarios.lock().unwrap();
        let scenario = Scenario {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            enabled: false,
        };
        list.push(scenario.clone());
        self.save_scenarios(&list);
        scenario
    }

    pub fn update_scenario(
        &self,
        id: String,
        name: Option<String>,
        description: Option<String>,
        enabled: Option<bool>,
    ) -> Option<Scenario> {
        let mut list = self.scenarios.lock().unwrap();
        let mut updated = None;
        let mut should_exclusive_disable = false;

        if let Some(true) = enabled {
            should_exclusive_disable = true;
        }

        for s in list.iter_mut() {
            if s.id == id {
                if let Some(n) = name.clone() {
                    s.name = n;
                }
                if description.is_some() {
                    s.description.clone_from(&description);
                }
                if let Some(e) = enabled {
                    s.enabled = e;
                }
                updated = Some(s.clone());
            } else if should_exclusive_disable {
                s.enabled = false;
            }
        }
        if updated.is_some() {
            self.save_scenarios(&list);
        }
        updated
    }

    pub fn delete_scenario(&self, id: String) -> bool {
        let mut scenarios = self.scenarios.lock().unwrap();
        let mut rules = self.mock_rules.lock().unwrap();

        let initial_len = scenarios.len();
        scenarios.retain(|s| s.id != id);

        if scenarios.len() == initial_len {
            false
        } else {
            self.save_scenarios(&scenarios);
            // Delete associated mock rules (cascade)
            let rules_initial_len = rules.len();
            rules.retain(|r| r.scenario_id != id);
            if rules.len() != rules_initial_len {
                self.save_mock_rules(&rules);
            }
            true
        }
    }

    // --- Mock Rules ---

    pub fn get_mock_rules(&self) -> Vec<MockRule> {
        self.mock_rules.lock().unwrap().clone()
    }

    /// Full replace used by settings import (replace mode).
    pub fn replace_all_scenarios_and_rules(
        &self,
        scenarios: Vec<Scenario>,
        mock_rules: Vec<MockRule>,
    ) {
        {
            let mut list = self.scenarios.lock().unwrap();
            *list = scenarios;
            self.save_scenarios(&list);
        }
        {
            let mut list = self.mock_rules.lock().unwrap();
            *list = mock_rules;
            self.save_mock_rules(&list);
        }
    }

    /// Merge by id: keep existing, add missing from import.
    pub fn merge_scenarios_and_rules(&self, scenarios: Vec<Scenario>, mock_rules: Vec<MockRule>) {
        {
            let mut list = self.scenarios.lock().unwrap();
            for incoming in scenarios {
                if let Some(existing) = list.iter_mut().find(|s| s.id == incoming.id) {
                    *existing = incoming;
                } else {
                    list.push(incoming);
                }
            }
            self.save_scenarios(&list);
        }
        {
            let mut list = self.mock_rules.lock().unwrap();
            for incoming in mock_rules {
                if let Some(existing) = list.iter_mut().find(|r| r.id == incoming.id) {
                    *existing = incoming;
                } else {
                    list.push(incoming);
                }
            }
            self.save_mock_rules(&list);
        }
    }

    pub fn get_mock_rules_by_scenario(&self, scenario_id: &str) -> Vec<MockRule> {
        self.mock_rules
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.scenario_id == scenario_id)
            .cloned()
            .collect()
    }

    fn sanitize_headers(
        mut headers: std::collections::HashMap<String, String>,
    ) -> std::collections::HashMap<String, String> {
        headers.retain(|k, _| {
            let k_lower = k.trim().to_lowercase();
            k_lower != "content-encoding"
                && k_lower != "content-length"
                && k_lower != "transfer-encoding"
                && k_lower != "connection"
                && k_lower != "keep-alive"
                && k_lower != "content-range"
                && k_lower != "accept-ranges"
        });
        headers
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_mock_rule(
        &self,
        name: String,
        scenario_id: Option<String>,
        host: Option<String>,
        method: String,
        url_pattern: String,
        response_status: u16,
        response_headers: std::collections::HashMap<String, String>,
        response_body: Option<String>,
        enabled: bool,
        delay_ms: u64,
    ) -> MockRule {
        let resolved_scenario_id = scenario_id
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| self.ensure_default_scenario().id);
        let mut list = self.mock_rules.lock().unwrap();
        let rule = MockRule {
            id: Uuid::new_v4().to_string(),
            name,
            scenario_id: resolved_scenario_id,
            host,
            method: method.to_uppercase(),
            url_pattern,
            response_status,
            response_headers: Self::sanitize_headers(response_headers),
            response_body,
            enabled,
            delay_ms: clamp_mock_delay_ms(delay_ms),
        };
        list.push(rule.clone());
        self.save_mock_rules(&list);
        rule
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_mock_rule(
        &self,
        id: String,
        name: Option<String>,
        host: Option<String>,
        method: Option<String>,
        url_pattern: Option<String>,
        response_status: Option<u16>,
        response_headers: Option<std::collections::HashMap<String, String>>,
        response_body: Option<String>,
        enabled: Option<bool>,
        delay_ms: Option<u64>,
    ) -> Option<MockRule> {
        let mut list = self.mock_rules.lock().unwrap();
        let mut updated = None;
        for r in list.iter_mut() {
            if r.id == id {
                if let Some(n) = name.clone() {
                    r.name = n;
                }
                if let Some(h) = host.clone() {
                    r.host = Some(h);
                }
                if let Some(m) = method.clone() {
                    r.method = m.to_uppercase();
                }
                if let Some(url) = url_pattern.clone() {
                    r.url_pattern = url;
                }
                if let Some(status) = response_status {
                    r.response_status = status;
                }
                if let Some(headers) = response_headers.clone() {
                    r.response_headers = Self::sanitize_headers(headers);
                }
                if response_body.is_some() {
                    r.response_body.clone_from(&response_body);
                }
                if let Some(e) = enabled {
                    r.enabled = e;
                }
                if let Some(delay) = delay_ms {
                    r.delay_ms = clamp_mock_delay_ms(delay);
                }
                updated = Some(r.clone());
                break;
            }
        }
        if updated.is_some() {
            self.save_mock_rules(&list);
        }
        updated
    }

    pub fn delete_mock_rule(&self, id: String) -> bool {
        let mut list = self.mock_rules.lock().unwrap();
        let initial_len = list.len();
        list.retain(|r| r.id != id);
        if list.len() == initial_len {
            false
        } else {
            self.save_mock_rules(&list);
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::tempdir;

    #[test]
    fn test_mocking_service_scenarios() {
        let dir = tempdir().unwrap();
        let scenarios_path = dir.path().join("scenarios.json");
        let rules_path = dir.path().join("rules.json");
        let settings_path = dir.path().join("settings.json");

        let service = MockingService::new(scenarios_path, rules_path, settings_path);

        // Default scenario is ensured on init
        let initial = service.get_scenarios();
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].name, MockingService::DEFAULT_SCENARIO_NAME);

        // Create
        let s1 = service.create_scenario("Test Scenario 1".to_string(), Some("Desc 1".to_string()));
        assert_eq!(s1.name, "Test Scenario 1");

        let scenarios = service.get_scenarios();
        assert_eq!(scenarios.len(), 2);
        assert!(scenarios.iter().any(|s| s.id == s1.id));

        // Update
        let updated = service
            .update_scenario(
                s1.id.clone(),
                Some("Updated Scenario".to_string()),
                None,
                None,
            )
            .unwrap();
        assert_eq!(updated.name, "Updated Scenario");
        assert_eq!(updated.description.as_deref(), Some("Desc 1")); // Unchanged

        // Delete
        let deleted = service.delete_scenario(s1.id.clone());
        assert!(deleted);
        assert_eq!(service.get_scenarios().len(), 1);
        assert_eq!(
            service.get_scenarios()[0].name,
            MockingService::DEFAULT_SCENARIO_NAME
        );
    }

    #[test]
    fn test_mocking_service_rules_and_cascade() {
        let dir = tempdir().unwrap();
        let scenarios_path = dir.path().join("scenarios.json");
        let rules_path = dir.path().join("rules.json");
        let settings_path = dir.path().join("settings.json");

        let service = MockingService::new(scenarios_path, rules_path, settings_path);

        let scenario = service.create_scenario("Scenario 1".to_string(), None);

        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());

        let rule = service.create_mock_rule(
            "Test Rule".to_string(),
            Some(scenario.id.clone()),
            None,
            "GET".to_string(),
            "/api/test".to_string(),
            200,
            headers,
            Some(r#"{"ok":true}"#.to_string()),
            true,
            15,
        );

        assert_eq!(rule.scenario_id, scenario.id);
        assert_eq!(rule.method, "GET");

        let rules = service.get_mock_rules_by_scenario(&scenario.id);
        assert_eq!(rules.len(), 1);

        // Update
        let updated = service
            .update_mock_rule(
                rule.id.clone(),
                None,
                None,
                None,
                Some("/api/test2".to_string()),
                Some(201),
                None,
                None,
                Some(false),
                None,
            )
            .unwrap();

        assert_eq!(updated.url_pattern, "/api/test2");
        assert_eq!(updated.response_status, 201);
        assert!(!updated.enabled);
        assert_eq!(updated.delay_ms, 15);

        // Cascade delete: Deleting scenario should delete its rules
        service.delete_scenario(scenario.id.clone());
        let rules_after = service.get_mock_rules();
        assert!(rules_after.is_empty());
    }

    #[test]
    fn test_ensure_default_scenario_and_create_without_id() {
        let dir = tempdir().unwrap();
        let scenarios_path = dir.path().join("scenarios.json");
        let rules_path = dir.path().join("rules.json");
        let settings_path = dir.path().join("settings.json");

        let service = MockingService::new(scenarios_path, rules_path, settings_path);
        let default = service.ensure_default_scenario();
        assert_eq!(default.name, MockingService::DEFAULT_SCENARIO_NAME);

        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());

        let rule = service.create_mock_rule(
            "Auto Scenario Rule".to_string(),
            None,
            None,
            "GET".to_string(),
            "/auto".to_string(),
            200,
            headers,
            None,
            true,
            0,
        );
        assert_eq!(rule.scenario_id, default.id);
    }

    #[test]
    fn test_mocking_service_settings() {
        let dir = tempdir().unwrap();
        let scenarios_path = dir.path().join("scenarios.json");
        let rules_path = dir.path().join("rules.json");
        let settings_path = dir.path().join("settings.json");

        let service = MockingService::new(scenarios_path, rules_path, settings_path);

        // Default is true
        assert!(service.get_settings().enabled);

        // Update
        let settings = service.set_enabled(false);
        assert!(!settings.enabled);
        assert!(!service.get_settings().enabled);
    }

    #[test]
    fn delay_is_clamped_when_stored_and_survives_reload() {
        let dir = tempdir().unwrap();
        let scenarios_path = dir.path().join("scenarios.json");
        let rules_path = dir.path().join("rules.json");
        let settings_path = dir.path().join("settings.json");

        let service = MockingService::new(
            scenarios_path.clone(),
            rules_path.clone(),
            settings_path.clone(),
        );
        let rule = service.create_mock_rule(
            "Slow".to_string(),
            None,
            None,
            "GET".to_string(),
            "/slow".to_string(),
            200,
            HashMap::new(),
            None,
            true,
            u64::MAX,
        );
        assert_eq!(rule.delay_ms, crate::model::mock_rule::MAX_MOCK_DELAY_MS);

        let lowered = service
            .update_mock_rule(
                rule.id.clone(),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(40),
            )
            .unwrap();
        assert_eq!(lowered.delay_ms, 40);

        let unchanged = service
            .update_mock_rule(
                rule.id.clone(),
                Some("Slow renamed".to_string()),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
        assert_eq!(unchanged.delay_ms, 40);

        let reloaded = MockingService::new(scenarios_path, rules_path, settings_path);
        let stored = reloaded
            .get_mock_rules()
            .into_iter()
            .find(|r| r.id == rule.id)
            .unwrap();
        assert_eq!(stored.delay_ms, 40);
        assert_eq!(stored.name, "Slow renamed");
    }

    #[test]
    fn legacy_rule_file_without_delay_loads_as_zero() {
        let dir = tempdir().unwrap();
        let rules_path = dir.path().join("rules.json");
        let legacy = r#"{
            "schema_version": 2,
            "data": [{
                "id": "legacy",
                "name": "Legacy",
                "scenario_id": "s-legacy",
                "host": null,
                "method": "GET",
                "url_pattern": "/legacy",
                "response_status": 200,
                "response_headers": {},
                "response_body": null,
                "enabled": true
            }]
        }"#;
        std::fs::write(&rules_path, legacy).unwrap();

        let service = MockingService::new(
            dir.path().join("scenarios.json"),
            rules_path,
            dir.path().join("settings.json"),
        );
        let rules = service.get_mock_rules();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].delay_ms, 0);
    }
}
