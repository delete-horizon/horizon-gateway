use crate::model::inspector::{
    Annotation, AnnotationLocator, InspectorSettings, LocatorValidation,
};
use crate::storage::versioned::{load_versioned, save_versioned};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

fn annotation_updates_tx() -> &'static tokio::sync::broadcast::Sender<()> {
    static TX: OnceLock<tokio::sync::broadcast::Sender<()>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, _) = tokio::sync::broadcast::channel(64);
        tx
    })
}

fn notify_annotation_updates() {
    let _ = annotation_updates_tx().send(());
}

#[derive(Clone)]
pub struct InspectorService {
    pub annotations: Arc<Mutex<Vec<Annotation>>>,
    pub storage_path: PathBuf,
    pub injection_domains: Arc<Mutex<Vec<String>>>,
    pub domains_storage_path: PathBuf,
    pub settings: Arc<Mutex<InspectorSettings>>,
    pub settings_storage_path: PathBuf,
    /// Last known mtime of annotations file (CLI/other-process writes sync).
    last_seen_mtime: Arc<Mutex<Option<SystemTime>>>,
}

impl InspectorService {
    pub fn new(
        storage_path: PathBuf,
        domains_storage_path: PathBuf,
        settings_storage_path: PathBuf,
    ) -> Self {
        let mut initial_annotations: Vec<Annotation> = load_versioned(&storage_path);
        let mut migrated = false;
        for ann in &mut initial_annotations {
            if ann.locators.is_empty() {
                ann.migrate_locators();
                if !ann.locators.is_empty() {
                    migrated = true;
                }
            }
        }
        let mtime = Self::read_mtime(&storage_path);
        let svc = Self {
            annotations: Arc::new(Mutex::new(initial_annotations)),
            storage_path,
            injection_domains: Arc::new(Mutex::new(load_versioned(&domains_storage_path))),
            domains_storage_path,
            settings: Arc::new(Mutex::new(load_versioned(&settings_storage_path))),
            settings_storage_path,
            last_seen_mtime: Arc::new(Mutex::new(mtime)),
        };
        if migrated {
            let list = svc.annotations.lock().unwrap().clone();
            svc.persist(&list);
        }
        svc
    }

    fn read_mtime(path: &PathBuf) -> Option<SystemTime> {
        fs::metadata(path).and_then(|m| m.modified()).ok()
    }

    fn touch_seen_mtime(&self) {
        *self.last_seen_mtime.lock().unwrap() = Self::read_mtime(&self.storage_path);
    }

    /// Reload annotations from disk when another process (e.g. headless CLI) wrote the file.
    /// Returns true if in-memory state was replaced.
    pub fn reload_if_stale(&self) -> bool {
        let mtime = Self::read_mtime(&self.storage_path);
        let mut last = self.last_seen_mtime.lock().unwrap();
        if mtime == *last {
            return false;
        }
        let mut list: Vec<Annotation> = load_versioned(&self.storage_path);
        for ann in &mut list {
            if ann.locators.is_empty() {
                ann.migrate_locators();
            }
        }
        *self.annotations.lock().unwrap() = list;
        *last = mtime;
        notify_annotation_updates();
        true
    }

    /// Injected pages subscribe so badges update without polling.
    pub fn subscribe_updates() -> tokio::sync::broadcast::Receiver<()> {
        annotation_updates_tx().subscribe()
    }

    /// Pathname from a full URL (query/hash stripped). Used when CLI passes `url` only.
    pub fn extract_path_from_url(url: &str) -> Option<String> {
        let s = url.trim();
        if s.is_empty() {
            return None;
        }
        let after_scheme = if let Some(idx) = s.find("://") {
            &s[idx + 3..]
        } else {
            s
        };
        let path_start = after_scheme.find('/')?;
        let path = &after_scheme[path_start..];
        let path = path.split('?').next().unwrap_or(path);
        let path = path.split('#').next().unwrap_or(path);
        if path.is_empty() {
            Some("/".to_string())
        } else {
            Some(path.to_string())
        }
    }

    fn persist(&self, list: &Vec<Annotation>) {
        save_versioned(&self.storage_path, list);
        self.touch_seen_mtime();
        notify_annotation_updates();
        crate::serve::publish_event("annotations-updated", ());
    }

    fn persist_domains(&self, list: &Vec<String>) {
        save_versioned(&self.domains_storage_path, list);
    }

    pub fn get_settings(&self) -> InspectorSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_enabled(&self, enabled: bool) {
        let mut s = self.settings.lock().unwrap();
        s.enabled = enabled;
        save_versioned(&self.settings_storage_path, &*s);
    }

    pub fn get_all(&self) -> Vec<Annotation> {
        let _ = self.reload_if_stale();
        let mut list = self.annotations.lock().unwrap().clone();
        let mut changed = false;
        for ann in &mut list {
            if ann.locators.is_empty() {
                ann.migrate_locators();
                changed = true;
            }
        }
        if changed {
            *self.annotations.lock().unwrap() = list.clone();
            self.persist(&list);
        }
        list
    }

    fn normalize_annotation(&self, ann: &mut Annotation) {
        if ann.id.trim().is_empty() {
            ann.id = format!("g-{}", &uuid::Uuid::new_v4().to_string()[..8]);
        }
        if ann.timestamp == 0 {
            ann.timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
        }
        if ann.domain.trim().is_empty() && !ann.url.trim().is_empty() {
            ann.domain = Self::extract_host_key(&ann.url);
        }
        if ann
            .host_pattern
            .as_ref()
            .map(|p| p.trim().is_empty())
            .unwrap_or(true)
            && !ann.domain.trim().is_empty()
        {
            ann.host_pattern = Some(format!("*.{}", ann.domain));
        }
        if ann
            .path_pattern
            .as_ref()
            .map(|p| p.trim().is_empty())
            .unwrap_or(true)
        {
            if let Some(path) = Self::extract_path_from_url(&ann.url) {
                ann.path_pattern = Some(path);
            }
        }
        ann.migrate_locators();
        ann.sync_selector_from_locators();
    }

    pub fn get_by_id(&self, id: &str) -> Option<Annotation> {
        let _ = self.reload_if_stale();
        self.annotations
            .lock()
            .unwrap()
            .iter()
            .find(|a| a.id == id)
            .cloned()
    }

    pub fn add_annotation(&self, mut annotation: Annotation) {
        let _ = self.reload_if_stale();
        self.normalize_annotation(&mut annotation);
        let mut list = self.annotations.lock().unwrap();
        list.retain(|a| a.id != annotation.id);
        list.push(annotation);
        self.persist(&list);
    }

    pub fn import_annotations(&self, annotations: Vec<Annotation>) {
        let _ = self.reload_if_stale();
        let mut list = self.annotations.lock().unwrap();
        for mut ann in annotations {
            self.normalize_annotation(&mut ann);
            list.retain(|a| a.id != ann.id);
            list.push(ann);
        }
        self.persist(&list);
    }

    pub fn update_annotation(
        &self,
        id: String,
        role: Option<String>,
        description: Option<String>,
        domain: Option<String>,
        url: Option<String>,
        host_pattern: Option<String>,
        path_pattern: Option<String>,
        locators: Option<Vec<AnnotationLocator>>,
        last_validation: Option<LocatorValidation>,
        clear_validation: bool,
    ) {
        let _ = self.reload_if_stale();
        let mut list = self.annotations.lock().unwrap();
        if let Some(ann) = list.iter_mut().find(|a| a.id == id) {
            if let Some(r) = role {
                ann.role = r;
            }
            if let Some(d) = description {
                ann.description = d;
            }
            if let Some(d) = domain {
                ann.domain = d;
            }
            if let Some(ref u) = url {
                ann.url = u.clone();
            }
            // Omit = leave unchanged; Some("") = clear; Some(value) = set.
            if let Some(hp) = host_pattern {
                ann.host_pattern = if hp.trim().is_empty() { None } else { Some(hp) };
            }
            match (&url, path_pattern) {
                (_, Some(pp)) => {
                    ann.path_pattern = if pp.trim().is_empty() { None } else { Some(pp) };
                }
                (Some(u), None) => {
                    if let Some(derived) = Self::extract_path_from_url(u) {
                        ann.path_pattern = Some(derived);
                    }
                }
                (None, None) => {}
            }
            if let Some(locs) = locators {
                ann.locators = locs;
                ann.sync_selector_from_locators();
            } else if ann.locators.is_empty() {
                ann.migrate_locators();
            }
            if clear_validation {
                ann.last_validation = None;
            } else if let Some(v) = last_validation {
                ann.last_validation = Some(v);
            }
        } else {
            return;
        }
        self.persist(&list);
    }

    pub fn delete_annotation(&self, id: String) {
        let _ = self.reload_if_stale();
        let mut list = self.annotations.lock().unwrap();
        list.retain(|a| a.id != id);
        self.persist(&list);
    }

    pub fn get_injection_domains(&self) -> Vec<String> {
        self.injection_domains.lock().unwrap().clone()
    }

    pub fn set_injection_domains(&self, domains: Vec<String>) {
        let mut list = self.injection_domains.lock().unwrap();
        *list = domains;
        self.persist_domains(&list);
    }

    pub fn add_injection_domain(&self, domain: &str) -> Vec<String> {
        let mut list = self.injection_domains.lock().unwrap();
        let host_key = Self::extract_host_key(domain);
        let key = if host_key.is_empty() {
            domain.trim().to_lowercase()
        } else {
            host_key
        };
        if !key.is_empty() && !list.iter().any(|d| d.to_lowercase() == key) {
            list.push(key);
            self.persist_domains(&list);
        }
        list.clone()
    }

    pub fn remove_injection_domain(&self, domain: &str) -> Vec<String> {
        let mut list = self.injection_domains.lock().unwrap();
        let host_key = Self::extract_host_key(domain);
        let key = if host_key.is_empty() {
            domain.trim().to_lowercase()
        } else {
            host_key
        };
        let before_len = list.len();
        list.retain(|d| d.to_lowercase() != key);
        if list.len() != before_len {
            self.persist_domains(&list);
        }
        list.clone()
    }

    pub fn extract_host_key(url: &str) -> String {
        let s = url.trim();
        let without_scheme = if let Some(idx) = s.find("://") {
            &s[idx + 3..]
        } else {
            s
        };
        let host_part = without_scheme.split('/').next().unwrap_or(without_scheme);
        host_part
            .split(':')
            .next()
            .unwrap_or(host_part)
            .to_lowercase()
    }

    pub fn sync_registered_domains(&self, registered_domains: &[crate::model::domain::Domain]) {
        let mut list = self.injection_domains.lock().unwrap();
        let mut changed = false;
        for d in registered_domains {
            let host_key = Self::extract_host_key(&d.url);
            if !host_key.is_empty()
                && !list
                    .iter()
                    .any(|existing| existing.to_lowercase() == host_key)
            {
                list.push(host_key);
                changed = true;
            }
        }
        if changed {
            self.persist_domains(&list);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_path_from_url_strips_query_and_hash() {
        assert_eq!(
            InspectorService::extract_path_from_url("https://example.dev/checkout?x=1#top"),
            Some("/checkout".to_string())
        );
        assert_eq!(
            InspectorService::extract_path_from_url("https://example.dev/products/123"),
            Some("/products/123".to_string())
        );
        assert_eq!(
            InspectorService::extract_path_from_url("https://example.dev"),
            None
        );
        assert_eq!(
            InspectorService::extract_path_from_url("https://example.dev/"),
            Some("/".to_string())
        );
    }

    #[tokio::test]
    async fn annotation_update_broadcast_reaches_subscriber() {
        let mut rx = InspectorService::subscribe_updates();
        notify_annotation_updates();
        tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
            .await
            .expect("timed out waiting for annotation update")
            .expect("broadcast closed");
    }

    #[test]
    fn update_unknown_id_does_not_clobber_unreadable_store() {
        let dir = std::env::temp_dir().join(format!("hg-insp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let ann_path = dir.join("inspector_annotations.json");
        let valid = serde_json::json!({
            "schema_version": 2,
            "data": [{
                "id": "g-keep",
                "role": "Keep",
                "hostPattern": "*.example.*"
            }]
        });
        std::fs::write(&ann_path, serde_json::to_string(&valid).unwrap()).unwrap();
        let svc = InspectorService::new(ann_path.clone(), dir.join("d.json"), dir.join("s.json"));
        assert_eq!(svc.get_all().len(), 1);

        std::thread::sleep(std::time::Duration::from_millis(250));
        std::fs::write(&ann_path, "{not-json").unwrap();

        svc.update_annotation(
            "g-keep".into(),
            Some("x".into()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false,
        );

        let raw = std::fs::read_to_string(&ann_path).unwrap();
        assert!(
            raw.contains("{not-json"),
            "must not persist an empty list over an unreadable annotations file: {raw}"
        );
    }
}
