use crate::model::proxy_settings::{default_tls_bypass_hosts, ProxySettings};
use crate::storage::versioned::{load_versioned, save_versioned};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct ProxySettingsService {
    settings: Mutex<ProxySettings>,
    storage_path: PathBuf,
}

impl ProxySettingsService {
    pub fn new(storage_path: PathBuf) -> Self {
        let settings = load_versioned(&storage_path);
        Self {
            settings: Mutex::new(settings),
            storage_path,
        }
    }

    fn save(&self, s: &ProxySettings) {
        save_versioned(&self.storage_path, s);
    }

    pub fn get(&self) -> ProxySettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_dns_server(&self, dns_server: Option<String>) -> ProxySettings {
        let mut s = self.settings.lock().unwrap();
        s.dns_server = dns_server.map(|s| s.trim().to_string()).and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        });
        let out = s.clone();
        self.save(&out);
        out
    }

    /// Set the port the proxy will listen on (1–65535). Takes effect on next proxy start.
    pub fn set_proxy_port(&self, port: u16) -> ProxySettings {
        let port = port.clamp(1, 65535);
        let mut s = self.settings.lock().unwrap();
        s.proxy_port = port;
        let out = s.clone();
        self.save(&out);
        out
    }

    /// Set reverse proxy ports. None = disabled. Takes effect on next proxy start.
    pub fn set_reverse_ports(
        &self,
        reverse_http_port: Option<u16>,
        reverse_https_port: Option<u16>,
    ) -> ProxySettings {
        let mut s = self.settings.lock().unwrap();
        s.reverse_http_port = reverse_http_port.filter(|&p| p > 0);
        s.reverse_https_port = reverse_https_port.filter(|&p| p > 0);
        let out = s.clone();
        self.save(&out);
        out
    }

    /// If the legacy master switch was off, flip it (so it is not applied again) and return true.
    pub fn consume_legacy_local_routing_disabled(&self) -> bool {
        let mut s = self.settings.lock().unwrap();
        if s.local_routing_enabled {
            return false;
        }
        s.local_routing_enabled = true;
        let out = s.clone();
        self.save(&out);
        true
    }

    pub fn seed_tls_defaults_if_needed(&self, decrypt_hosts: Vec<String>) {
        let mut s = self.settings.lock().unwrap();
        let mut changed = false;
        if !s.tls_bypass_seeded {
            s.tls_bypass_hosts = default_tls_bypass_hosts();
            s.tls_bypass_seeded = true;
            changed = true;
        } else {
            // Ensure core messenger/SSO domains are present in existing bypass lists
            for default_host in default_tls_bypass_hosts() {
                let default_clean = default_host.trim().to_lowercase();
                if !s
                    .tls_bypass_hosts
                    .iter()
                    .any(|h| h.trim().to_lowercase() == default_clean)
                {
                    s.tls_bypass_hosts.push(default_host);
                    changed = true;
                }
            }
        }
        if !s.https_decrypt_seeded {
            let mut hosts: Vec<String> = Vec::new();
            for host in decrypt_hosts {
                let host = host.trim().to_lowercase();
                if host.is_empty() {
                    continue;
                }
                if !hosts.iter().any(|h| h == &host) {
                    hosts.push(host);
                }
            }
            s.https_decrypt_hosts = hosts;
            s.https_decrypt_seeded = true;
            changed = true;
        }
        if changed {
            let out = s.clone();
            self.save(&out);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn patch(
        &self,
        cors_rewrite_enabled: Option<bool>,
        tls_bypass_hosts: Option<Vec<String>>,
        https_decrypt_hosts: Option<Vec<String>>,
        connect_timeout_secs: Option<u64>,
        upstream_timeout_secs: Option<u64>,
        log_retention_days: Option<u32>,
        allow_remote_access: Option<bool>,
    ) -> ProxySettings {
        let mut s = self.settings.lock().unwrap();
        if let Some(v) = cors_rewrite_enabled {
            s.cors_rewrite_enabled = v;
        }
        if let Some(v) = tls_bypass_hosts {
            s.tls_bypass_hosts = normalize_host_list(v);
            s.tls_bypass_seeded = true;
        }
        if let Some(v) = https_decrypt_hosts {
            s.https_decrypt_hosts = normalize_host_list(v);
            s.https_decrypt_seeded = true;
        }
        if let Some(v) = connect_timeout_secs {
            s.connect_timeout_secs = v.clamp(1, 300);
        }
        if let Some(v) = upstream_timeout_secs {
            s.upstream_timeout_secs = v.clamp(1, 600);
        }
        if let Some(v) = log_retention_days {
            s.log_retention_days = v;
        }
        if let Some(v) = allow_remote_access {
            s.allow_remote_access = v;
        }
        let out = s.clone();
        self.save(&out);
        out
    }

    pub fn set_https_decrypt_host(&self, host: &str, enabled: bool) -> ProxySettings {
        self.set_https_decrypt_hosts(&[host.to_string()], enabled)
    }

    pub fn set_https_decrypt_hosts(&self, hosts: &[String], enabled: bool) -> ProxySettings {
        let mut s = self.settings.lock().unwrap();
        s.https_decrypt_seeded = true;
        let host_set: std::collections::HashSet<String> = hosts
            .iter()
            .map(|h| h.trim().to_lowercase())
            .filter(|h| !h.is_empty())
            .collect();
        if enabled {
            for host in host_set {
                if !s.https_decrypt_hosts.iter().any(|h| h == &host) {
                    s.https_decrypt_hosts.push(host);
                }
            }
        } else {
            s.https_decrypt_hosts.retain(|h| !host_set.contains(h));
        }
        let out = s.clone();
        self.save(&out);
        out
    }

    /// Replace all settings (for import). Network exposure stays as configured on this machine.
    pub fn replace_all(&self, settings: ProxySettings) -> ProxySettings {
        let mut s = self.settings.lock().unwrap();
        let allow_remote_access = s.allow_remote_access;
        *s = settings;
        s.allow_remote_access = allow_remote_access;
        self.save(&s);
        s.clone()
    }
}

fn normalize_host_list(hosts: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for host in hosts {
        let host = host.trim().to_lowercase();
        if host.is_empty() {
            continue;
        }
        if !out.iter().any(|h| h == &host) {
            out.push(host);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_settings_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy_settings.json");
        (dir, path)
    }

    #[test]
    fn test_new_creates_default_when_no_file() {
        let (_dir, path) = temp_settings_path();
        let svc = ProxySettingsService::new(path);
        let s = svc.get();
        assert!(s.cors_rewrite_enabled);
        assert_eq!(s.proxy_port, 8888);
    }

    #[test]
    fn test_consume_legacy_local_routing_disabled() {
        let (_dir, path) = temp_settings_path();
        let old_json = r#"{"schema_version":2,"data":{"dns_server":null,"proxy_port":8888,"local_routing_enabled":false}}"#;
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(old_json.as_bytes()).unwrap();
        drop(f);

        let svc = ProxySettingsService::new(path.clone());
        assert!(!svc.get().local_routing_enabled);
        assert!(svc.consume_legacy_local_routing_disabled());
        assert!(!svc.consume_legacy_local_routing_disabled());

        let svc2 = ProxySettingsService::new(path);
        assert!(svc2.get().local_routing_enabled);
        assert!(!svc2.consume_legacy_local_routing_disabled());
    }

    #[test]
    fn test_seed_tls_defaults_once() {
        let (_dir, path) = temp_settings_path();
        let svc = ProxySettingsService::new(path.clone());
        svc.seed_tls_defaults_if_needed(vec![
            "api.example.com".to_string(),
            "API.example.com".to_string(),
        ]);
        let s = svc.get();
        assert!(s.tls_bypass_seeded);
        assert!(s.https_decrypt_seeded);
        assert!(s.tls_bypass_hosts.iter().any(|h| h == "okta.com"));
        assert_eq!(s.https_decrypt_hosts, vec!["api.example.com"]);

        svc.seed_tls_defaults_if_needed(vec!["other.com".to_string()]);
        let s2 = svc.get();
        assert_eq!(s2.https_decrypt_hosts, vec!["api.example.com"]);
    }

    #[test]
    fn test_set_https_decrypt_host() {
        let (_dir, path) = temp_settings_path();
        let svc = ProxySettingsService::new(path);
        svc.set_https_decrypt_host("App.Example.com", true);
        assert_eq!(svc.get().https_decrypt_hosts, vec!["app.example.com"]);
        svc.set_https_decrypt_host("app.example.com", false);
        assert!(svc.get().https_decrypt_hosts.is_empty());
    }

    #[test]
    fn test_remote_access_patch_and_import_keeps_local_choice() {
        let (_dir, path) = temp_settings_path();
        let svc = ProxySettingsService::new(path.clone());
        assert!(!svc.get().allow_remote_access);
        svc.patch(None, None, None, None, None, None, Some(true));
        assert!(ProxySettingsService::new(path).get().allow_remote_access);

        let imported = ProxySettings::default();
        assert!(svc.replace_all(imported).allow_remote_access);
        svc.patch(None, None, None, None, None, None, Some(false));
        let imported = ProxySettings {
            allow_remote_access: true,
            ..ProxySettings::default()
        };
        assert!(!svc.replace_all(imported).allow_remote_access);
    }

    #[test]
    fn test_backward_compat_old_settings_file() {
        let (_dir, path) = temp_settings_path();
        let old_json = r#"{"schema_version":1,"data":{"dns_server":null,"proxy_port":9999}}"#;
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(old_json.as_bytes()).unwrap();
        drop(f);

        let svc = ProxySettingsService::new(path);
        let s = svc.get();
        assert_eq!(s.proxy_port, 9999);
        assert!(s.cors_rewrite_enabled);
    }
}
