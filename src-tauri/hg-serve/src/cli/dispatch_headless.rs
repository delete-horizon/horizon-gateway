use crate::command;
use crate::runtime::{AppContext, CliRuntime};
use serde_json::Value;
use std::path::PathBuf;

pub fn dispatch_headless(
    cmd_name: &str,
    payload: Value,
    ctx: &AppContext,
    runtime: &CliRuntime,
) -> Result<Value, String> {
    let schemas_dir: PathBuf = ctx.app_data_dir.join("schemas");
    match cmd_name {
        "get_domain_api_logging_links" => {
            let result = command::api_log_commands::get_domain_api_logging_links_svc(
                &ctx.api_logging_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_domain_api_logging" => {
            let parsed: command::api_log_commands::SetDomainApiLoggingPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::api_log_commands::set_domain_api_logging_svc(
                parsed,
                &ctx.api_logging_service,
                &ctx.domain_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "remove_domain_api_logging" => {
            let parsed: command::api_log_commands::RemoveDomainApiLoggingPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::api_log_commands::remove_domain_api_logging_svc(
                parsed,
                &ctx.api_logging_service,
                &ctx.domain_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_api_schema_content" => {
            let parsed: command::api_log_commands::GetApiSchemaPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::api_log_commands::get_api_schema_content_svc(parsed, &schemas_dir)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "list_api_log_dates" => {
            let result = command::api_log_commands::list_api_log_dates_svc(&ctx.api_log_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_api_logs" => {
            let parsed_payload: command::api_log_commands::GetApiLogsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::api_log_commands::get_api_logs_svc(parsed_payload, &ctx.api_log_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_api_log_detail" => {
            let parsed_payload: command::api_log_commands::GetApiLogDetailPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::api_log_commands::get_api_log_detail_svc(
                parsed_payload,
                &ctx.api_log_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "search_api_logs" => {
            let parsed_payload: command::api_log_commands::SearchApiLogsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::api_log_commands::search_api_logs_svc(
                parsed_payload,
                None,
                &ctx.api_log_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "clear_api_logs" => {
            let parsed_payload: command::api_log_commands::ClearApiLogsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::api_log_commands::clear_api_logs_svc(
                parsed_payload,
                &ctx.api_log_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_domains" => {
            let result = command::domain_commands::get_domains_svc(&ctx.domain_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_domain_by_id" => {
            let parsed: command::domain_commands::GetDomainByIdPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::domain_commands::get_domain_by_id_svc(parsed, &ctx.domain_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "regist_domains" => {
            let parsed_payload: command::domain_commands::RegistDomainsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::domain_commands::regist_domains_svc(
                parsed_payload,
                &ctx.domain_service,
                &ctx.link_service,
                &ctx.monitor_service,
                &ctx.inspector_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_domain_by_id" => {
            let parsed: command::domain_commands::UpdateDomainByIdPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::domain_commands::update_domain_by_id_svc(
                parsed,
                &ctx.domain_service,
                &ctx.local_route_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "remove_domains" => {
            let parsed_payload: command::domain_commands::RemoveDomainsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::domain_commands::remove_domains_svc(
                parsed_payload,
                &ctx.domain_service,
                &ctx.link_service,
                &ctx.monitor_service,
                &ctx.api_logging_service,
                &ctx.local_route_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "import_domains" => {
            let parsed: command::domain_commands::ImportDomainsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::domain_commands::import_domains_svc(
                parsed,
                &ctx.domain_service,
                &ctx.monitor_service,
                &ctx.local_route_service,
                &ctx.inspector_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "clear_all_domains" => {
            let result = command::domain_commands::clear_all_domains_svc(
                &ctx.domain_service,
                &ctx.monitor_service,
                &ctx.local_route_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_groups" => {
            let result = runtime.block_on(command::domain_group_commands::get_groups_svc(
                &ctx.group_service,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "create_group" => {
            let parsed: command::domain_group_commands::CreateGroupPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = runtime.block_on(command::domain_group_commands::create_group_svc(
                parsed,
                &ctx.group_service,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_group" => {
            let parsed: command::domain_group_commands::UpdateGroupPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = runtime.block_on(command::domain_group_commands::update_group_svc(
                parsed,
                &ctx.group_service,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "delete_group" => {
            let parsed: command::domain_group_commands::DeleteGroupPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = runtime.block_on(command::domain_group_commands::delete_group_svc(
                parsed,
                &ctx.group_service,
                &ctx.link_service,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_domain_group_links" => {
            let result =
                command::domain_group_commands::get_domain_group_links_svc(&ctx.link_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_domain_groups" => {
            let parsed: command::domain_group_commands::SetDomainGroupsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::domain_group_commands::set_domain_groups_svc(parsed, &ctx.link_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_group_domains" => {
            let parsed: command::domain_group_commands::SetGroupDomainsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::domain_group_commands::set_group_domains_svc(parsed, &ctx.link_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_domains_by_group" => {
            let parsed: command::domain_group_commands::GetDomainsByGroupPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::domain_group_commands::get_domains_by_group_svc(
                parsed,
                &ctx.domain_service,
                &ctx.link_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_groups_for_domain" => {
            let parsed: command::domain_group_commands::GetGroupsForDomainPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::domain_group_commands::get_groups_for_domain_svc(
                parsed,
                &ctx.group_service,
                &ctx.link_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_latest_status" => {
            let result =
                command::domain_monitor_command::get_latest_status_svc(&ctx.monitor_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_domain_monitor_list" => {
            let result = command::domain_monitor_command::get_domain_monitor_list_svc(
                &ctx.domain_service,
                &ctx.monitor_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_domain_monitor_check_enabled" => {
            let parsed: command::domain_monitor_command::SetDomainMonitorCheckEnabledPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::domain_monitor_command::set_domain_monitor_check_enabled_svc(
                parsed,
                &ctx.monitor_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_domain_status_logs" => {
            let parsed: command::domain_monitor_command::GetDomainStatusLogsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::domain_monitor_command::get_domain_status_logs_svc(
                parsed,
                &ctx.monitor_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_local_routes" => {
            let result =
                command::local_route_commands::get_local_routes_svc(&ctx.local_route_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "add_local_route" => {
            let parsed_payload: command::local_route_commands::AddLocalRoutePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::local_route_commands::add_local_route_svc(
                parsed_payload,
                &ctx.local_route_service,
                &ctx.domain_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_local_route" => {
            let parsed: command::local_route_commands::UpdateLocalRoutePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::local_route_commands::update_local_route_svc(
                parsed,
                &ctx.local_route_service,
                &ctx.domain_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "remove_local_route" => {
            let parsed_payload: command::local_route_commands::RemoveLocalRoutePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::local_route_commands::remove_local_route_svc(
                parsed_payload,
                &ctx.local_route_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_local_route_enabled" => {
            let parsed_payload: command::local_route_commands::SetLocalRouteEnabledPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::local_route_commands::set_local_route_enabled_svc(
                parsed_payload,
                &ctx.local_route_service,
                &ctx.domain_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_proxy_status" => {
            let result = runtime
                .block_on(async { command::local_route_commands::get_proxy_status_svc().await })?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_proxy_auto_start_error" => {
            let result = command::local_route_commands::get_proxy_auto_start_error_svc()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_proxy_settings" => {
            let result =
                command::local_route_commands::get_proxy_settings_svc(&ctx.proxy_settings_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_proxy_dns_server" => {
            let parsed: command::local_route_commands::SetProxyDnsServerPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::local_route_commands::set_proxy_dns_server_svc(
                parsed,
                &ctx.proxy_settings_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_proxy_port" => {
            let parsed: command::local_route_commands::SetProxyPortPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::local_route_commands::set_proxy_port_svc(
                parsed,
                &ctx.proxy_settings_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_proxy_reverse_ports" => {
            let parsed: command::local_route_commands::SetProxyReversePortsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::local_route_commands::set_proxy_reverse_ports_svc(
                parsed,
                &ctx.proxy_settings_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_proxy_setup_url" => {
            let result = command::local_route_commands::get_proxy_setup_url_svc()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "stop_local_proxy" => {
            let result = command::local_route_commands::stop_local_proxy_svc(None)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_proxy_settings" => {
            let parsed: command::local_route_commands::UpdateProxySettingsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let retention_opt = parsed.log_retention_days;
            let result = command::local_route_commands::update_proxy_settings_svc(
                parsed,
                &ctx.proxy_settings_service,
            )?;
            if let Some(days) = retention_opt {
                let _ = ctx.api_log_service.purge_logs_older_than(days);
            }
            crate::serve::events::publish_event("proxy-settings-changed", result.data.clone());
            crate::serve::events::publish_event(
                "hub-data-changed",
                serde_json::json!({ "reason": "settings" }),
            );
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_https_decrypt_host" => {
            let parsed: command::local_route_commands::SetHttpsDecryptHostPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::local_route_commands::set_https_decrypt_host_svc(
                parsed,
                &ctx.proxy_settings_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "start_transparent_proxy" => {
            let parsed: Option<command::transparent_proxy_commands::StartTransparentProxyPayload> =
                serde_json::from_value(payload).ok();
            let result = command::transparent_proxy_commands::start_transparent_proxy_svc(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "stop_transparent_proxy" => {
            let result = command::transparent_proxy_commands::stop_transparent_proxy_svc()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_transparent_proxy_status" => {
            let result = command::transparent_proxy_commands::get_transparent_proxy_status_svc()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "apply_transparent_proxy_apps" => {
            let parsed: command::transparent_proxy_commands::ApplyTransparentProxyAppsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::transparent_proxy_commands::apply_transparent_proxy_apps_svc(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "scan_os_apps" => {
            let result = command::transparent_proxy_commands::scan_os_apps_svc()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "list_transparent_proxy_presets" => {
            let result = command::transparent_proxy_commands::list_transparent_proxy_presets_svc()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_mocking_status" => {
            let result = command::mocking_commands::get_mocking_status_svc(&ctx.mocking_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_scenarios" => {
            let result = command::mocking_commands::get_scenarios_svc(&ctx.mocking_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "create_scenario" => {
            let parsed_payload: command::mocking_commands::CreateScenarioPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::mocking_commands::create_scenario_svc(
                parsed_payload,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_scenario" => {
            #[derive(serde::Deserialize)]
            struct UpdateScenarioArgs {
                id: String,
                name: Option<String>,
                description: Option<String>,
                enabled: Option<bool>,
            }
            let parsed: UpdateScenarioArgs = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::mocking_commands::update_scenario_svc(
                parsed.id,
                parsed.name,
                parsed.description,
                parsed.enabled,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_scenario_enabled" => {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct SetScenarioEnabledArgs {
                id: String,
                enabled: bool,
            }
            let parsed: SetScenarioEnabledArgs = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::mocking_commands::set_scenario_enabled_svc(
                parsed.id,
                parsed.enabled,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "delete_scenario" => {
            let id: String = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: (ID 문자열 필요) {}", e))?;
            let result = command::mocking_commands::delete_scenario_svc(id, &ctx.mocking_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_mock_rules" => {
            let result = command::mocking_commands::get_mock_rules_svc(&ctx.mocking_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_mock_rules_by_scenario" => {
            let parsed: command::mocking_commands::GetMockRulesByScenarioPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::mocking_commands::get_mock_rules_by_scenario_svc(
                parsed,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "create_mock_rule" => {
            let parsed_payload: command::mocking_commands::CreateMockRulePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::mocking_commands::create_mock_rule_svc(
                parsed_payload,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_mock_rule" => {
            let parsed_payload: command::mocking_commands::UpdateMockRulePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::mocking_commands::update_mock_rule_svc(
                parsed_payload,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "delete_mock_rule" => {
            let id: String = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: (ID/UUID 필요) {}", e))?;
            let result = command::mocking_commands::delete_mock_rule_svc(id, &ctx.mocking_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "process_crypto" => {
            let parsed_payload: command::crypto_commands::ProcessCryptoPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::crypto_commands::process_crypto_svc(parsed_payload)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "validate_json_schema" => {
            let parsed_payload: command::crypto_commands::ValidateSchemaPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::crypto_commands::validate_json_schema_svc(parsed_payload)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_annotations" => {
            let result = command::inspector_commands::get_annotations_svc(&ctx.inspector_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_annotation" => {
            let parsed: command::inspector_commands::GetAnnotationPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::inspector_commands::get_annotation_svc(&ctx.inspector_service, parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "add_annotation" => {
            let parsed: crate::model::inspector::Annotation = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::inspector_commands::add_annotation_svc(&ctx.inspector_service, parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_annotation" => {
            let parsed: command::inspector_commands::UpdateAnnotationPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::inspector_commands::update_annotation_svc(&ctx.inspector_service, parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "delete_annotation" => {
            let parsed: command::inspector_commands::DeleteAnnotationPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                command::inspector_commands::delete_annotation_svc(&ctx.inspector_service, parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "import_annotations" => {
            let parsed: command::inspector_commands::ImportAnnotationsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::inspector_commands::import_annotations_svc(
                &ctx.inspector_service,
                parsed,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_injection_domains" => {
            let result =
                command::inspector_commands::get_injection_domains_svc(&ctx.inspector_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "set_injection_domains" => {
            let parsed: command::inspector_commands::SetInjectionDomainsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::inspector_commands::set_injection_domains_svc(
                &ctx.inspector_service,
                parsed,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "add_injection_domain" => {
            let parsed: command::inspector_commands::SingleDomainPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::inspector_commands::add_injection_domain_svc(
                &ctx.inspector_service,
                parsed,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "remove_injection_domain" => {
            let parsed: command::inspector_commands::SingleDomainPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::inspector_commands::remove_injection_domain_svc(
                &ctx.inspector_service,
                parsed,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "export_all_settings" => {
            let result = command::settings_commands::export_all_settings_svc(
                &ctx.domain_service,
                &ctx.group_service,
                &ctx.link_service,
                &ctx.local_route_service,
                &ctx.proxy_settings_service,
                &ctx.monitor_service,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "import_all_settings" => {
            // Tauri forwards { payload: <SettingsExport>, mode: <string|null> }.
            // When the outer object contains both keys we must unwrap them.
            let (settings_value, mode_opt) = if let Some(obj) = payload.as_object() {
                if obj.contains_key("payload") {
                    let inner = obj
                        .get("payload")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let mode = obj.get("mode").and_then(|v| v.as_str()).map(str::to_string);
                    (inner, mode)
                } else {
                    (payload, None)
                }
            } else {
                (payload, None)
            };
            let parsed: crate::model::settings_export::SettingsExport =
                serde_json::from_value(settings_value)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::settings_commands::import_all_settings_svc(
                parsed,
                mode_opt,
                &ctx.domain_service,
                &ctx.group_service,
                &ctx.link_service,
                &ctx.local_route_service,
                &ctx.proxy_settings_service,
                &ctx.monitor_service,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "save_root_ca" => {
            Err("gui_only: `save_root_ca` requires the Horizon Gateway GUI.".to_string())
        }
        "download_api_schema" => {
            let parsed: command::api_log_commands::DownloadApiSchemaPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = runtime.block_on(command::api_log_commands::download_api_schema_svc(
                parsed,
                &schemas_dir,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "send_api_request" => {
            let parsed: command::api_log_commands::SendApiRequestPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                runtime.block_on(command::api_log_commands::send_api_request_svc(parsed))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "check_domain_status" => {
            let result =
                runtime.block_on(command::domain_monitor_command::check_domain_status_svc(
                    &ctx.domain_service,
                    &ctx.group_service,
                    &ctx.link_service,
                    &ctx.monitor_service,
                    &ctx.proxy_settings_service,
                ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "start_local_proxy" => {
            let parsed: Option<command::local_route_commands::StartLocalProxyPayload> = if payload
                .is_null()
                || (payload.is_object() && payload.as_object().unwrap().is_empty())
            {
                None
            } else {
                Some(
                    serde_json::from_value(payload)
                        .map_err(|e| format!("인자 역직렬화 실패: {}", e))?,
                )
            };
            let result = runtime.block_on(command::local_route_commands::start_local_proxy_svc(
                None,
                parsed,
                &ctx.local_route_service,
                &ctx.proxy_settings_service,
                &ctx.api_logging_service,
                &ctx.api_log_service,
                &ctx.ca_service,
                &ctx.mocking_service,
                &ctx.inspector_service,
                &ctx.domain_service,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "create_mock_rule_from_log" => {
            let parsed: command::mocking_commands::CreateMockFromLogPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::mocking_commands::create_mock_rule_from_log_svc(
                parsed,
                &ctx.api_log_service,
                &ctx.mocking_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_tailscale_ip" => {
            let result = command::tunnel_commands::get_tailscale_ip_svc(&ctx.tunnel_service)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "start_cloudflare_tunnel" => {
            let result = runtime.block_on(
                command::tunnel_commands::start_cloudflare_tunnel_svc(&ctx.tunnel_service),
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "stop_cloudflare_tunnel" => {
            let result = runtime.block_on(command::tunnel_commands::stop_cloudflare_tunnel_svc(
                &ctx.tunnel_service,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "check_adb_status" => {
            let result = runtime.block_on(command::usb_commands::check_adb_status_svc(
                &ctx.usb_service,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "start_usb_reverse" => {
            #[derive(serde::Deserialize)]
            struct PortPayload {
                port: u16,
            }
            let parsed: PortPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = runtime.block_on(command::usb_commands::start_usb_reverse_svc(
                &ctx.usb_service,
                parsed.port,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "stop_usb_reverse" => {
            #[derive(serde::Deserialize)]
            struct PortPayload {
                port: u16,
            }
            let parsed: PortPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = runtime.block_on(command::usb_commands::stop_usb_reverse_svc(
                &ctx.usb_service,
                parsed.port,
            ))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "open_window" => {
            Err("gui_only: `open_window` requires the Horizon Gateway GUI.".to_string())
        }
        "open_inspector_window" => {
            Err("gui_only: `open_inspector_window` requires the Horizon Gateway GUI.".to_string())
        }
        "open_annotation_dialog" => {
            Err("gui_only: `open_annotation_dialog` requires the Horizon Gateway GUI.".to_string())
        }
        "execute_pipeline" => {
            let parsed: crate::service::pipeline_runner::PipelineFlow =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result =
                runtime.block_on(command::pipeline_commands::execute_pipeline_svc(parsed))?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "execute_pipeline_api_node" => {
            let config_json: String = if payload.is_string() {
                payload.as_str().unwrap().to_string()
            } else {
                serde_json::to_string(&payload).unwrap()
            };
            let result = runtime.block_on(
                command::pipeline_commands::execute_pipeline_api_node_svc(config_json),
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_saved_pipelines" => {
            let result = command::pipeline_library_commands::get_saved_pipelines_svc(
                &ctx.pipeline_library_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_saved_pipeline" => {
            let parsed: command::pipeline_library_commands::GetSavedPipelinePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::pipeline_library_commands::get_saved_pipeline_svc(
                parsed,
                &ctx.pipeline_library_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "create_saved_pipeline" => {
            let parsed: command::pipeline_library_commands::CreateSavedPipelinePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::pipeline_library_commands::create_saved_pipeline_svc(
                parsed,
                &ctx.pipeline_library_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_saved_pipeline" => {
            let parsed: command::pipeline_library_commands::UpdateSavedPipelinePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::pipeline_library_commands::update_saved_pipeline_svc(
                parsed,
                &ctx.pipeline_library_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "delete_saved_pipeline" => {
            let parsed: command::pipeline_library_commands::DeleteSavedPipelinePayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::pipeline_library_commands::delete_saved_pipeline_svc(
                parsed,
                &ctx.pipeline_library_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "import_saved_pipelines" => {
            let parsed: command::pipeline_library_commands::ImportSavedPipelinesPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::pipeline_library_commands::import_saved_pipelines_svc(
                parsed,
                &ctx.pipeline_library_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_json_schemas" => {
            let result = command::json_schema_registry_commands::get_json_schemas_svc(
                &ctx.json_schema_registry_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_json_schema" => {
            let parsed: command::json_schema_registry_commands::GetJsonSchemaPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::json_schema_registry_commands::get_json_schema_svc(
                parsed,
                &ctx.json_schema_registry_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "create_json_schema" => {
            let parsed: command::json_schema_registry_commands::CreateJsonSchemaPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::json_schema_registry_commands::create_json_schema_svc(
                parsed,
                &ctx.json_schema_registry_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_json_schema" => {
            let parsed: command::json_schema_registry_commands::UpdateJsonSchemaPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::json_schema_registry_commands::update_json_schema_svc(
                parsed,
                &ctx.json_schema_registry_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "delete_json_schema" => {
            let parsed: command::json_schema_registry_commands::DeleteJsonSchemaPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::json_schema_registry_commands::delete_json_schema_svc(
                parsed,
                &ctx.json_schema_registry_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "import_json_schemas" => {
            let parsed: command::json_schema_registry_commands::ImportJsonSchemasPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::json_schema_registry_commands::import_json_schemas_svc(
                parsed,
                &ctx.json_schema_registry_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_crypto_presets" => {
            let result = command::crypto_preset_commands::get_crypto_presets_svc(
                &ctx.crypto_preset_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_crypto_preset" => {
            let parsed: command::crypto_preset_commands::GetCryptoPresetPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::crypto_preset_commands::get_crypto_preset_svc(
                parsed,
                &ctx.crypto_preset_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "create_crypto_preset" => {
            let parsed: command::crypto_preset_commands::CreateCryptoPresetPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::crypto_preset_commands::create_crypto_preset_svc(
                parsed,
                &ctx.crypto_preset_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "update_crypto_preset" => {
            let parsed: command::crypto_preset_commands::UpdateCryptoPresetPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::crypto_preset_commands::update_crypto_preset_svc(
                parsed,
                &ctx.crypto_preset_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "delete_crypto_preset" => {
            let parsed: command::crypto_preset_commands::DeleteCryptoPresetPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::crypto_preset_commands::delete_crypto_preset_svc(
                parsed,
                &ctx.crypto_preset_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "import_crypto_presets" => {
            let parsed: command::crypto_preset_commands::ImportCryptoPresetsPayload =
                serde_json::from_value(payload)
                    .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::crypto_preset_commands::import_crypto_presets_svc(
                parsed,
                &ctx.crypto_preset_service,
            )?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "chat_ensure_identity" => {
            let result = crate::chat::chat_ensure_identity()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "chat_derive_dm_key" => {
            let parsed: crate::chat::DeriveDmKeyPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = crate::chat::chat_derive_dm_key(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "chat_generate_room_key" => {
            Ok(serde_json::to_value(crate::chat::chat_generate_room_key()).unwrap())
        }
        "chat_wrap_room_key" => {
            let parsed: crate::chat::WrapRoomKeyPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = crate::chat::chat_wrap_room_key(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "chat_unwrap_room_key" => {
            let parsed: crate::chat::UnwrapRoomKeyPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = crate::chat::chat_unwrap_room_key(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "chat_seal" => {
            let parsed: crate::chat::SealPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = crate::chat::chat_seal(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "chat_open" => {
            let parsed: crate::chat::OpenPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = crate::chat::chat_open(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "chat_start_listener" => {
            let result = crate::chat::chat_start_listener()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "chat_stop_listener" => {
            crate::chat::chat_stop_listener();
            Ok(Value::Null)
        }
        "chat_send_frame" => {
            let parsed: crate::chat::SendFramePayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = crate::chat::chat_send_frame(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "session_handoff_put" => {
            let parsed: crate::session_handoff::PutPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            crate::session_handoff::put(parsed)?;
            Ok(serde_json::json!({ "ready": true }))
        }
        "get_comm_avatar_catalog" | "reload_comm_avatar_catalog" => {
            let result = command::avatar_commands::get_comm_avatar_catalog()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "compose_comm_avatar" => {
            let parsed: command::avatar_commands::ComposePayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::avatar_commands::compose_comm_avatar(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "write_comm_avatar_part" => {
            let parsed: command::avatar_commands::PartPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            let result = command::avatar_commands::write_comm_avatar_part(parsed)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "push_comm_avatar_draft" => {
            let parsed: command::avatar_commands::PartPayload = serde_json::from_value(payload)
                .map_err(|e| format!("인자 역직렬화 실패: {}", e))?;
            command::avatar_commands::push_comm_avatar_draft(parsed)?;
            Ok(serde_json::json!({ "ok": true }))
        }
        "session_handoff_take" => match crate::session_handoff::take()? {
            Some(tokens) => Ok(serde_json::to_value(tokens).unwrap()),
            None => Ok(Value::Null),
        },
        _ => Err(format!("Unknown command: {cmd_name}. Run `hgc list`.")),
    }
}
