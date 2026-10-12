use crate::model::api_response::ApiResponse;
use crate::model::settings_export::{SettingsExport, HG_APP_NAME, SETTINGS_EXPORT_VERSION};
use crate::service::ca_service::CaService;
use crate::service::domain_group_link_service::DomainGroupLinkService;
use crate::service::domain_group_service::DomainGroupService;
use crate::service::domain_hostname::domain_url_to_hostname;
use crate::service::domain_monitor_service::DomainMonitorService;
use crate::service::domain_service::DomainService;
use crate::service::local_route_service::LocalRouteService;
use crate::service::mocking_service::MockingService;
use crate::service::proxy_settings_service::ProxySettingsService;

pub const SAVE_ROOT_CA_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "save_root_ca",
    description: "Root CA 인증서 PEM을 반환합니다. 파일 경로와 OS trust는 클라이언트가 처리합니다.",
    payload_example: "{}",
    category: "settings",
    gui_only: false,
};

pub async fn save_root_ca_svc(
    _app: Option<()>,
    ca_service: &std::sync::Arc<CaService>,
) -> Result<ApiResponse<String>, String> {
    let pem = ca_service.ca_cert_pem();
    Ok(ApiResponse {
        message: "CA certificate exported".into(),
        success: true,
        data: pem,
    })
}

pub const EXPORT_ALL_SETTINGS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "export_all_settings",
    description: "도메인, 그룹, 라우팅, mock/시나리오 등 앱 설정을 .hg.json으로 내보냅니다.",
    payload_example: "{}",
    category: "settings",
    gui_only: false,
};

pub fn export_all_settings_svc(
    domain_service: &DomainService,
    group_service: &DomainGroupService,
    link_service: &DomainGroupLinkService,
    route_service: &std::sync::Arc<LocalRouteService>,
    proxy_settings_service: &ProxySettingsService,
    monitor_service: &DomainMonitorService,
    mocking_service: &MockingService,
) -> Result<ApiResponse<SettingsExport>, String> {
    let exported_at = chrono::Utc::now().to_rfc3339();
    let payload = SettingsExport {
        schema_version: SETTINGS_EXPORT_VERSION,
        version: SETTINGS_EXPORT_VERSION,
        app: HG_APP_NAME.to_string(),
        exported_at,
        domains: domain_service.get_all(),
        groups: group_service.get_all(),
        domain_group_links: link_service.get_all_links(),
        local_routes: route_service.get_all(),
        proxy_settings: proxy_settings_service.get(),
        domain_monitor: monitor_service.get_domain_monitor_for_export(domain_service),
        scenarios: mocking_service.get_scenarios(),
        mock_rules: mocking_service.get_mock_rules(),
    };
    Ok(ApiResponse {
        message: "Export ready".to_string(),
        success: true,
        data: payload,
    })
}

pub const IMPORT_ALL_SETTINGS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "import_all_settings",
    description: "JSON/.hg.json 설정 파일을 일괄 임포트합니다. mode=replace|merge.",
    payload_example: r#"{"version": 3, "schemaVersion": 3, "app": "horizon-gateway", "exportedAt": "2026-07-09T00:00:00Z", "domains": [], "groups": [], "domainGroupLinks": [], "localRoutes": [], "proxySettings": {"dnsServer": null, "proxyPort": 8888, "reverseHttpPort": null, "reverseHttpsPort": null, "localRoutingEnabled": true}, "domainMonitor": [], "scenarios": [], "mockRules": []}"#,
    category: "settings",
    gui_only: false,
};

pub fn import_all_settings_svc(
    payload: SettingsExport,
    mode: Option<String>,
    domain_service: &DomainService,
    group_service: &DomainGroupService,
    link_service: &DomainGroupLinkService,
    route_service: &std::sync::Arc<LocalRouteService>,
    proxy_settings_service: &ProxySettingsService,
    monitor_service: &DomainMonitorService,
    mocking_service: &MockingService,
) -> Result<ApiResponse<bool>, String> {
    if payload.app != HG_APP_NAME && !payload.app.is_empty() {
        return Err(format!(
            "Unsupported app '{}' (expected {})",
            payload.app, HG_APP_NAME
        ));
    }
    let effective_version = payload.version.max(payload.schema_version);
    if effective_version > SETTINGS_EXPORT_VERSION {
        return Err(format!(
            "Unsupported export version {} (max {})",
            effective_version, SETTINGS_EXPORT_VERSION
        ));
    }

    let merge = mode
        .as_deref()
        .map(|m| m.eq_ignore_ascii_case("merge"))
        .unwrap_or(false);

    if merge {
        // Domains: merge by hostname (keep existing ids when host matches)
        let mut domains = domain_service.get_all();
        for incoming in payload.domains {
            let incoming_host = domain_url_to_hostname(&incoming.url);
            if incoming_host.is_empty()
                || !domains
                    .iter()
                    .any(|d| domain_url_to_hostname(&d.url) == incoming_host)
            {
                domains.push(incoming);
            }
        }
        domain_service.import_from_json(domains);
        let domains = domain_service.get_all();
        monitor_service.sync_with_domains(&domains);
        monitor_service.import_domain_monitor(&payload.domain_monitor, domain_service);

        let mut groups = group_service.get_all();
        for incoming in payload.groups {
            if !groups
                .iter()
                .any(|g| g.id == incoming.id || g.name == incoming.name)
            {
                groups.push(incoming);
            }
        }
        group_service.replace_all(groups);

        let mut links = link_service.get_all_links();
        for incoming in payload.domain_group_links {
            if !links
                .iter()
                .any(|l| l.domain_id == incoming.domain_id && l.group_id == incoming.group_id)
            {
                links.push(incoming);
            }
        }
        link_service.replace_all(links);

        let mut routes = route_service.get_all();
        for incoming in payload.local_routes {
            if !routes.iter().any(|r| r.id == incoming.id) {
                routes.push(incoming);
            }
        }
        route_service.replace_all(routes, &domains);

        // Proxy settings: keep local unless merge explicitly wants remote — apply remote in merge
        proxy_settings_service.replace_all(payload.proxy_settings);
        mocking_service.merge_scenarios_and_rules(payload.scenarios, payload.mock_rules);
    } else {
        domain_service.import_from_json(payload.domains);
        let domains = domain_service.get_all();
        monitor_service.sync_with_domains(&domains);
        monitor_service.import_domain_monitor(&payload.domain_monitor, domain_service);
        group_service.replace_all(payload.groups);
        link_service.replace_all(payload.domain_group_links);
        route_service.replace_all(payload.local_routes, &domains);
        proxy_settings_service.replace_all(payload.proxy_settings);
        mocking_service.replace_all_scenarios_and_rules(payload.scenarios, payload.mock_rules);
    }

    Ok(ApiResponse {
        message: if merge {
            "Merge import completed".to_string()
        } else {
            "Import completed".to_string()
        },
        success: true,
        data: true,
    })
}
