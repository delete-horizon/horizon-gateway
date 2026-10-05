use serde::{Deserialize, Serialize};

fn default_proxy_port() -> u16 {
    8888
}

fn default_true() -> bool {
    true
}

fn default_connect_timeout_secs() -> u64 {
    15
}

fn default_upstream_timeout_secs() -> u64 {
    30
}

/// Built-in TLS bypass seed (SSO / captive-portal / messengers). Copied into `tls_bypass_hosts` once.
pub fn default_tls_bypass_hosts() -> Vec<String> {
    vec![
        "connectivitycheck".to_string(),
        "captiveportal".to_string(),
        "captive.apple.com".to_string(),
        "clients3.google.com".to_string(),
        "detectportal.firefox.com".to_string(),
        "msftconnecttest.com".to_string(),
        "msftncsi.com".to_string(),
        // Microsoft / Teams / Office / Skype / Azure SSO & Messengers
        "teams.microsoft.com".to_string(),
        "teams.live.com".to_string(),
        "teams.cdn.office.net".to_string(),
        "skype.com".to_string(),
        "skypeassets.com".to_string(),
        "login.microsoftonline.com".to_string(),
        "login.live.com".to_string(),
        "aadcdn.msauth.net".to_string(),
        "msauth.net".to_string(),
        "msauthimages.net".to_string(),
        "auth.dev.azure.com".to_string(),
        "identity.azure.com".to_string(),
        "office.com".to_string(),
        "office365.com".to_string(),
        "sharepoint.com".to_string(),
        "azureedge.net".to_string(),
        // Common Auth / Identity / Collaboration
        "accounts.google.com".to_string(),
        "appleid.apple.com".to_string(),
        "auth0.com".to_string(),
        "okta.com".to_string(),
        "keycloak".to_string(),
        "slack.com".to_string(),
        "slack-msgs.com".to_string(),
        "zoom.us".to_string(),
        "discord.gg".to_string(),
        "discord.com".to_string(),
    ]
}

fn default_log_retention_days() -> u32 {
    14
}

#[derive(Serialize, Deserialize, Clone, Debug, specta::Type)]
#[allow(clippy::struct_excessive_bools)]
pub struct ProxySettings {
    /// Optional DNS server for pass-through resolution (e.g. "8.8.8.8" or "1.1.1.1:53").
    /// When set, hosts not matching any local route are resolved via this server before forwarding.
    pub dns_server: Option<String>,
    /// Port the local reverse proxy listens on (e.g. 8888). User-configurable to avoid conflicts.
    #[serde(default = "default_proxy_port")]
    pub proxy_port: u16,
    /// Optional reverse HTTP port (e.g. 8080). When set, proxy listens here for direct HTTP.
    #[serde(default)]
    pub reverse_http_port: Option<u16>,
    /// Optional reverse HTTPS port (e.g. 8443). When set, proxy does TLS and forwards by Host.
    #[serde(default)]
    pub reverse_https_port: Option<u16>,
    /// Rewrite CORS on proxied responses (including unregistered hosts).
    #[serde(default = "default_true")]
    pub cors_rewrite_enabled: bool,
    /// Hosts that always tunnel (no decrypt). Seeded from SSO/captive defaults once.
    #[serde(default)]
    pub tls_bypass_hosts: Vec<String>,
    /// Hosts that terminate TLS (MITM). Independent of logging/injection.
    #[serde(default)]
    pub https_decrypt_hosts: Vec<String>,
    #[serde(default = "default_connect_timeout_secs")]
    pub connect_timeout_secs: u64,
    #[serde(default = "default_upstream_timeout_secs")]
    pub upstream_timeout_secs: u64,
    /// Days to retain captured API logs on disk (e.g. 7, 14, 30, 90). 0 means keep forever.
    #[serde(default = "default_log_retention_days")]
    pub log_retention_days: u32,
    /// Let other devices (LAN / Tailscale / mobile) reach the proxy and the setup page.
    /// Off (default): listen on 127.0.0.1 only. On: listen on 0.0.0.0 but accept only loopback,
    /// private (10/8, 172.16/12, 192.168/16), CGNAT/Tailscale (100.64/10), link-local and IPv6 ULA peers.
    /// Applies on next proxy start / app restart. Never imported from a settings file.
    #[serde(default)]
    pub allow_remote_access: bool,
    /// Legacy master switch. Read for one-shot migration, never written back.
    #[serde(default = "default_true", skip_serializing)]
    #[specta(skip)]
    pub local_routing_enabled: bool,
    #[serde(default)]
    #[specta(skip)]
    pub tls_bypass_seeded: bool,
    #[serde(default)]
    #[specta(skip)]
    pub https_decrypt_seeded: bool,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            dns_server: None,
            proxy_port: default_proxy_port(),
            reverse_http_port: None,
            reverse_https_port: None,
            cors_rewrite_enabled: true,
            tls_bypass_hosts: Vec::new(),
            https_decrypt_hosts: Vec::new(),
            connect_timeout_secs: default_connect_timeout_secs(),
            upstream_timeout_secs: default_upstream_timeout_secs(),
            log_retention_days: default_log_retention_days(),
            allow_remote_access: false,
            local_routing_enabled: true,
            tls_bypass_seeded: false,
            https_decrypt_seeded: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backward_compat_missing_new_fields() {
        let old_json = r#"{
            "dns_server": null,
            "proxy_port": 9999,
            "reverse_http_port": 8080,
            "reverse_https_port": null
        }"#;
        let settings: ProxySettings = serde_json::from_str(old_json).unwrap();
        assert_eq!(settings.proxy_port, 9999);
        assert_eq!(settings.reverse_http_port, Some(8080));
        assert!(settings.cors_rewrite_enabled);
        assert!(settings.local_routing_enabled);
        assert!(!settings.https_decrypt_seeded);
        assert!(!settings.allow_remote_access);
    }

    #[test]
    fn test_legacy_local_routing_disabled_deserializes() {
        let json = r#"{
            "dns_server": "8.8.8.8",
            "proxy_port": 8888,
            "local_routing_enabled": false
        }"#;
        let settings: ProxySettings = serde_json::from_str(json).unwrap();
        assert!(!settings.local_routing_enabled);
        assert_eq!(settings.dns_server, Some("8.8.8.8".to_string()));
    }

    #[test]
    fn test_roundtrip_drops_local_routing_enabled() {
        let settings = ProxySettings {
            dns_server: None,
            proxy_port: 8888,
            reverse_http_port: None,
            reverse_https_port: None,
            cors_rewrite_enabled: false,
            tls_bypass_hosts: vec!["okta.com".to_string()],
            https_decrypt_hosts: vec!["api.example.com".to_string()],
            connect_timeout_secs: 10,
            upstream_timeout_secs: 20,
            log_retention_days: 14,
            allow_remote_access: true,
            local_routing_enabled: false,
            tls_bypass_seeded: true,
            https_decrypt_seeded: true,
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert!(!json.contains("local_routing_enabled"));
        let deserialized: ProxySettings = serde_json::from_str(&json).unwrap();
        assert!(
            deserialized.local_routing_enabled,
            "dropped field defaults to true"
        );
        assert!(!deserialized.cors_rewrite_enabled);
        assert_eq!(deserialized.https_decrypt_hosts, vec!["api.example.com"]);
        assert!(deserialized.allow_remote_access);
    }

    #[test]
    fn test_default_settings() {
        let settings = ProxySettings::default();
        assert_eq!(settings.proxy_port, 8888);
        assert!(settings.cors_rewrite_enabled);
        assert_eq!(settings.connect_timeout_secs, 15);
        assert_eq!(settings.upstream_timeout_secs, 30);
        assert!(!settings.allow_remote_access, "remote access is opt-in");
    }
}
