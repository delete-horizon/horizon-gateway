use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LocatorStrategy {
    Testid,
    Role,
    Text,
    Css,
    Label,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationLocator {
    pub strategy: LocatorStrategy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LocatorValidationStatus {
    Ok,
    Weak,
    Broken,
    Ambiguous,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocatorValidation {
    pub status: LocatorValidationStatus,
    pub checked_at: f64,
    pub primary_matches: u32,
    #[serde(default)]
    pub fallback_matches: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_by: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggest_promote_to: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct Annotation {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub selector: String,
    #[serde(default)]
    pub content: String,
    #[serde(default, rename = "tagName")]
    pub tag_name: String,
    #[serde(default)]
    pub thumbnail: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    #[specta(type = f64)]
    pub timestamp: u64,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub url: String,
    #[serde(default, rename = "hostPattern")]
    pub host_pattern: Option<String>,
    #[serde(default, rename = "pathPattern")]
    pub path_pattern: Option<String>,
    /// Priority-ordered locators. Index 0 is primary.
    #[serde(default, rename = "locators")]
    pub locators: Vec<AnnotationLocator>,
    #[serde(
        default,
        rename = "lastValidation",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_validation: Option<LocatorValidation>,
}

impl Annotation {
    /// Ensure legacy annotations (selector-only) get a css locator (+ optional text fallback).
    pub fn migrate_locators(&mut self) {
        if !self.locators.is_empty() {
            return;
        }
        let mut locators = Vec::new();
        if !self.selector.trim().is_empty() {
            locators.push(AnnotationLocator {
                strategy: LocatorStrategy::Css,
                value: Some(self.selector.clone()),
                role: None,
                name: None,
            });
        }
        let text = self.content.trim();
        if !text.is_empty() {
            let sliced: String = text.chars().take(80).collect();
            locators.push(AnnotationLocator {
                strategy: LocatorStrategy::Text,
                value: Some(sliced),
                role: None,
                name: None,
            });
        }
        self.locators = locators;
    }

    pub fn sync_selector_from_locators(&mut self) {
        if let Some(css) = self
            .locators
            .iter()
            .find(|l| l.strategy == LocatorStrategy::Css)
        {
            if let Some(v) = &css.value {
                self.selector = v.clone();
            }
        } else if let Some(first) = self.locators.first() {
            match first.strategy {
                LocatorStrategy::Testid => {
                    if let Some(v) = &first.value {
                        self.selector = format!("[data-testid=\"{v}\"]");
                    }
                }
                LocatorStrategy::Css => {
                    if let Some(v) = &first.value {
                        self.selector = v.clone();
                    }
                }
                _ => {}
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type, Default)]
pub struct InspectorSettings {
    pub enabled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_guide_with_host_pattern_and_css_locator() {
        let json = r##"{
            "id": "g-1",
            "role": "GA Event 정책",
            "hostPattern": "*.example.*",
            "domain": "www.example.dev",
            "locators": [{"strategy": "css", "value": "#x"}]
        }"##;
        let ann: Annotation = serde_json::from_str(json).unwrap();
        assert_eq!(ann.role, "GA Event 정책");
        assert_eq!(ann.host_pattern.as_deref(), Some("*.example.*"));
        assert_eq!(ann.locators.len(), 1);
        assert_eq!(ann.locators[0].strategy, LocatorStrategy::Css);
    }
}
