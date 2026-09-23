use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::service::api_log_service::ApiLogService;
use crate::service::api_logging_settings_service::ApiLoggingSettingsService;
use crate::service::ca_service::CaService;
use crate::service::crypto_preset_service::CryptoPresetService;
use crate::service::domain_group_link_service::DomainGroupLinkService;
use crate::service::domain_group_service::DomainGroupService;
use crate::service::domain_monitor_service::DomainMonitorService;
use crate::service::domain_service::DomainService;
use crate::service::inspector_service::InspectorService;
use crate::service::json_schema_registry_service::JsonSchemaRegistryService;
use crate::service::local_route_service::LocalRouteService;
use crate::service::mocking_service::MockingService;
use crate::service::pipeline_library_service::PipelineLibraryService;
use crate::service::proxy_settings_service::ProxySettingsService;
use crate::service::tunnel_service::TunnelService;
use crate::service::usb_service::UsbService;

use super::paths::resolve_app_data_dir;

pub struct AppContext {
    pub app_data_dir: PathBuf,
    pub ca_service: Arc<CaService>,
    pub domain_service: DomainService,
    pub group_service: DomainGroupService,
    pub link_service: DomainGroupLinkService,
    pub monitor_service: DomainMonitorService,
    pub local_route_service: Arc<LocalRouteService>,
    pub proxy_settings_service: Arc<ProxySettingsService>,
    pub api_logging_service: ApiLoggingSettingsService,
    pub api_log_service: ApiLogService,
    pub mocking_service: Arc<MockingService>,
    pub inspector_service: InspectorService,
    pub tunnel_service: Arc<TunnelService>,
    pub usb_service: Arc<UsbService>,
    pub pipeline_library_service: Arc<PipelineLibraryService>,
    pub json_schema_registry_service: Arc<JsonSchemaRegistryService>,
    pub crypto_preset_service: Arc<CryptoPresetService>,
}

pub fn bootstrap_app_context() -> Result<AppContext, String> {
    let app_data_dir = resolve_app_data_dir()?;

    // One-time migration from the legacy Watchtower app (com.lurain.watchtower).
    //
    // Always runs while the old directory exists (identified by the presence of its domains.json).
    // Merges old domains into the new location by hostname: old entries whose hostname does not
    // already exist in the new store are appended.  Other data files (groups, routes, mock rules,
    // proxy settings, etc.) are copied only when the corresponding file is absent in the new dir.
    // After a successful merge the old directory is renamed to *.migrated so this block never
    // runs again and the legacy data no longer shadows anything.
    if let Some(old_dir) = dirs::data_dir().map(|base| base.join("com.lurain.watchtower")) {
        let old_domains_path = old_dir.join("domains.json");
        if old_domains_path.exists() {
            if !app_data_dir.exists() {
                let _ = fs::create_dir_all(&app_data_dir);
            }

            // Merge domains by hostname — append old entries not present in the new store.
            let merged =
                merge_domains_from_legacy(&old_domains_path, &app_data_dir.join("domains.json"));
            if let Some(merged_domains) = merged {
                if let Ok(content) = serde_json::to_string_pretty(&serde_json::json!({
                    "schema_version": 2,
                    "data": merged_domains
                })) {
                    let _ = fs::write(app_data_dir.join("domains.json"), content);
                }
            }

            // Copy any other data files that do not yet exist in the new dir.
            let files_to_copy = [
                "groups.json",
                "domain_group_links.json",
                "domain_local_routes.json",
                "domain_monitor_links.json",
                "proxy_settings.json",
                "domain_api_logging_links.json",
                "mocking_settings.json",
                "scenarios.json",
                "mock_rules.json",
                "pipelines.json",
                "crypto_presets.json",
                "json_schemas.json",
                "inspector_annotations.json",
                "injection_domains.json",
                "inspector_settings.json",
            ];
            for file in &files_to_copy {
                let src = old_dir.join(file);
                let dst = app_data_dir.join(file);
                if src.exists() && !dst.exists() {
                    let _ = fs::copy(&src, &dst);
                }
            }

            // Rename old dir so this migration never runs again.
            let migrated_dir = old_dir.with_file_name("com.lurain.watchtower.migrated");
            if let Err(e) = fs::rename(&old_dir, &migrated_dir) {
                eprintln!("Warning: could not rename legacy app data dir after migration: {e}");
            } else {
                println!(
                    "Migrated app data from com.lurain.watchtower to com.lurain.horizon-gateway."
                );
            }
        }
    }

    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("failed to create app data dir: {e}"))?;
    }

    crate::storage::migration::run_all(&app_data_dir);

    let storage_path = app_data_dir.join("domains.json");
    let groups_storage_path = app_data_dir.join("groups.json");
    let links_storage_path = app_data_dir.join("domain_group_links.json");
    let logs_dir = app_data_dir.join("logs");
    let monitor_links_path = app_data_dir.join("domain_monitor_links.json");
    let local_routes_path = app_data_dir.join("domain_local_routes.json");
    let proxy_settings_path = app_data_dir.join("proxy_settings.json");
    let api_logging_path = app_data_dir.join("domain_api_logging_links.json");
    let scenarios_path = app_data_dir.join("scenarios.json");
    let mock_rules_path = app_data_dir.join("mock_rules.json");
    let mocking_settings_path = app_data_dir.join("mocking_settings.json");
    let inspector_path = app_data_dir.join("inspector_annotations.json");
    let injection_domains_path = app_data_dir.join("injection_domains.json");
    let inspector_settings_path = app_data_dir.join("inspector_settings.json");
    let pipelines_path = app_data_dir.join("pipelines.json");
    let json_schemas_path = app_data_dir.join("json_schemas.json");
    let crypto_presets_path = app_data_dir.join("crypto_presets.json");

    let ca_service = Arc::new(
        CaService::new(&app_data_dir).map_err(|e| format!("failed to init ca service: {e}"))?,
    );
    let domain_service = DomainService::new(storage_path);
    let group_service = DomainGroupService::new(groups_storage_path);
    let link_service = DomainGroupLinkService::new(links_storage_path);
    let monitor_service = DomainMonitorService::new(logs_dir, monitor_links_path);
    let local_route_service = Arc::new(LocalRouteService::new(local_routes_path));
    let proxy_settings_service = Arc::new(ProxySettingsService::new(proxy_settings_path));
    let api_logging_service = ApiLoggingSettingsService::new(api_logging_path);
    let api_log_service = ApiLogService::new(app_data_dir.clone());
    let mocking_service = Arc::new(MockingService::new(
        scenarios_path.clone(),
        mock_rules_path.clone(),
        mocking_settings_path.clone(),
    ));
    let inspector_service = InspectorService::new(
        inspector_path,
        injection_domains_path,
        inspector_settings_path,
    );
    let tunnel_service = Arc::new(TunnelService::new());
    let usb_service = Arc::new(UsbService::new());
    let pipeline_library_service = Arc::new(PipelineLibraryService::new(pipelines_path));
    let json_schema_registry_service = Arc::new(JsonSchemaRegistryService::new(json_schemas_path));
    let crypto_preset_service = Arc::new(CryptoPresetService::new(crypto_presets_path));

    monitor_service.sync_with_domains(&domain_service.get_all());
    api_logging_service.refresh_map(&domain_service.get_all());
    local_route_service.sync_with_domains(&domain_service.get_all());
    let retention_days = proxy_settings_service.get().log_retention_days;
    let _ = api_log_service.purge_logs_older_than(retention_days);
    migrate_removed_global_toggles(
        &proxy_settings_service,
        &local_route_service,
        &mocking_service,
        &inspector_service,
        &api_logging_service,
        &domain_service,
    );

    Ok(AppContext {
        app_data_dir,
        ca_service,
        domain_service,
        group_service,
        link_service,
        monitor_service,
        local_route_service,
        proxy_settings_service,
        api_logging_service,
        api_log_service,
        mocking_service,
        inspector_service,
        tunnel_service,
        usb_service,
        pipeline_library_service,
        json_schema_registry_service,
        crypto_preset_service,
    })
}

fn migrate_removed_global_toggles(
    proxy_settings: &ProxySettingsService,
    routes: &LocalRouteService,
    mocking: &MockingService,
    inspector: &InspectorService,
    api_logging: &ApiLoggingSettingsService,
    domains: &DomainService,
) {
    if proxy_settings.consume_legacy_local_routing_disabled() {
        routes.disable_all();
    }
    if !mocking.get_settings().enabled {
        mocking.disable_all_rules();
        mocking.set_enabled(true);
    }

    let mut decrypt_hosts = inspector.get_injection_domains();
    let domain_list = domains.get_all();
    for link in api_logging.get_links() {
        if link.logging_enabled {
            if let Some(domain) = domain_list.iter().find(|d| d.id == link.domain_id) {
                decrypt_hosts.push(crate::service::domain_hostname::domain_url_to_hostname(
                    &domain.url,
                ));
            }
        }
    }
    proxy_settings.seed_tls_defaults_if_needed(decrypt_hosts);
}

fn merge_domains_from_legacy(old_path: &Path, new_path: &Path) -> Option<Vec<serde_json::Value>> {
    let load = |path: &Path| -> Option<Vec<serde_json::Value>> {
        let content = fs::read_to_string(path).ok()?;
        let value: serde_json::Value = serde_json::from_str(&content).ok()?;
        match value {
            serde_json::Value::Array(items) => Some(items),
            serde_json::Value::Object(ref map) => {
                map.get("data").and_then(|v| v.as_array()).cloned()
            }
            _ => None,
        }
    };

    let old_domains = load(old_path).unwrap_or_default();
    if old_domains.is_empty() {
        return None;
    }

    let new_domains = if new_path.exists() {
        load(new_path).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Build hostname set from the new store to avoid duplicates.
    let new_hostnames: std::collections::HashSet<String> = new_domains
        .iter()
        .filter_map(|d| d.get("url").and_then(|v| v.as_str()))
        .map(|url| crate::service::domain_hostname::domain_url_to_hostname(url))
        .filter(|h| !h.is_empty())
        .collect();

    // Next id above the current max in the new store to avoid id collisions.
    let max_id = new_domains
        .iter()
        .filter_map(|d| d.get("id").and_then(|v| v.as_u64()))
        .max()
        .unwrap_or(0);
    let mut next_id = max_id + 1;

    let mut merged = new_domains;
    for mut old in old_domains {
        let host = old
            .get("url")
            .and_then(|v| v.as_str())
            .map(crate::service::domain_hostname::domain_url_to_hostname)
            .unwrap_or_default();
        if host.is_empty() || new_hostnames.contains(&host) {
            continue;
        }
        if let Some(obj) = old.as_object_mut() {
            obj.insert("id".to_string(), serde_json::json!(next_id));
        }
        next_id += 1;
        merged.push(old);
    }

    Some(merged)
}

#[cfg(test)]
mod tests {

    #[test]
    fn bootstrap_app_context_smoke() {
        let temp = tempfile::tempdir().expect("tempdir");
        // Override via direct construction is not exposed; smoke-test default path resolves.
        let dir = super::super::paths::resolve_app_data_dir().expect("resolve");
        assert!(dir.ends_with("com.lurain.horizon-gateway"));
        let _ = temp;
    }
}
