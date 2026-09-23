pub mod dispatch_headless;
pub mod init;
pub mod query;

use crate::runtime::CommandEnv;
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct CliCommandInfo {
    pub name: &'static str,
    pub description: &'static str,
    pub payload_example: &'static str,
    pub category: &'static str,
    pub gui_only: bool,
}

pub const CLI_COMMANDS: &[CliCommandInfo] = &[
    // --- API Logging Settings ---
    crate::command::api_log_commands::GET_DOMAIN_API_LOGGING_LINKS_CLI_INFO,
    crate::command::api_log_commands::SET_DOMAIN_API_LOGGING_CLI_INFO,
    crate::command::api_log_commands::REMOVE_DOMAIN_API_LOGGING_CLI_INFO,
    // --- API Schema ---
    crate::command::api_log_commands::DOWNLOAD_API_SCHEMA_CLI_INFO,
    crate::command::api_log_commands::GET_API_SCHEMA_CONTENT_CLI_INFO,
    crate::command::api_log_commands::SEND_API_REQUEST_CLI_INFO,
    // --- API Logs ---
    crate::command::api_log_commands::LIST_API_LOG_DATES_CLI_INFO,
    crate::command::api_log_commands::GET_API_LOGS_CLI_INFO,
    crate::command::api_log_commands::GET_API_LOG_DETAIL_CLI_INFO,
    crate::command::api_log_commands::SEARCH_API_LOGS_CLI_INFO,
    crate::command::api_log_commands::CLEAR_API_LOGS_CLI_INFO,
    // --- Domains ---
    crate::command::domain_commands::GET_DOMAINS_CLI_INFO,
    crate::command::domain_commands::GET_DOMAIN_BY_ID_CLI_INFO,
    crate::command::domain_commands::REGIST_DOMAINS_CLI_INFO,
    crate::command::domain_commands::UPDATE_DOMAIN_BY_ID_CLI_INFO,
    crate::command::domain_commands::REMOVE_DOMAINS_CLI_INFO,
    crate::command::domain_commands::IMPORT_DOMAINS_CLI_INFO,
    crate::command::domain_commands::CLEAR_ALL_DOMAINS_CLI_INFO,
    // --- Domain Groups ---
    crate::command::domain_group_commands::GET_GROUPS_CLI_INFO,
    crate::command::domain_group_commands::CREATE_GROUP_CLI_INFO,
    crate::command::domain_group_commands::UPDATE_GROUP_CLI_INFO,
    crate::command::domain_group_commands::DELETE_GROUP_CLI_INFO,
    crate::command::domain_group_commands::GET_DOMAIN_GROUP_LINKS_CLI_INFO,
    crate::command::domain_group_commands::SET_DOMAIN_GROUPS_CLI_INFO,
    crate::command::domain_group_commands::SET_GROUP_DOMAINS_CLI_INFO,
    crate::command::domain_group_commands::GET_DOMAINS_BY_GROUP_CLI_INFO,
    crate::command::domain_group_commands::GET_GROUPS_FOR_DOMAIN_CLI_INFO,
    // --- Domain Monitor ---
    crate::command::domain_monitor_command::GET_LATEST_STATUS_CLI_INFO,
    crate::command::domain_monitor_command::CHECK_DOMAIN_STATUS_CLI_INFO,
    crate::command::domain_monitor_command::GET_DOMAIN_MONITOR_LIST_CLI_INFO,
    crate::command::domain_monitor_command::SET_DOMAIN_MONITOR_CHECK_ENABLED_CLI_INFO,
    crate::command::domain_monitor_command::GET_DOMAIN_STATUS_LOGS_CLI_INFO,
    // --- Local Routing ---
    crate::command::local_route_commands::GET_LOCAL_ROUTES_CLI_INFO,
    crate::command::local_route_commands::ADD_LOCAL_ROUTE_CLI_INFO,
    crate::command::local_route_commands::UPDATE_LOCAL_ROUTE_CLI_INFO,
    crate::command::local_route_commands::REMOVE_LOCAL_ROUTE_CLI_INFO,
    crate::command::local_route_commands::SET_LOCAL_ROUTE_ENABLED_CLI_INFO,
    // --- Proxy ---
    crate::command::local_route_commands::GET_PROXY_STATUS_CLI_INFO,
    crate::command::local_route_commands::GET_PROXY_AUTO_START_ERROR_CLI_INFO,
    crate::command::local_route_commands::GET_PROXY_SETTINGS_CLI_INFO,
    crate::command::local_route_commands::SET_PROXY_DNS_SERVER_CLI_INFO,
    crate::command::local_route_commands::SET_PROXY_PORT_CLI_INFO,
    crate::command::local_route_commands::SET_PROXY_REVERSE_PORTS_CLI_INFO,
    crate::command::local_route_commands::GET_PROXY_SETUP_URL_CLI_INFO,
    crate::command::local_route_commands::START_LOCAL_PROXY_CLI_INFO,
    crate::command::local_route_commands::STOP_LOCAL_PROXY_CLI_INFO,
    crate::command::local_route_commands::UPDATE_PROXY_SETTINGS_CLI_INFO,
    crate::command::local_route_commands::SET_HTTPS_DECRYPT_HOST_CLI_INFO,
    crate::command::transparent_proxy_commands::START_TRANSPARENT_PROXY_CLI_INFO,
    crate::command::transparent_proxy_commands::STOP_TRANSPARENT_PROXY_CLI_INFO,
    crate::command::transparent_proxy_commands::GET_TRANSPARENT_PROXY_STATUS_CLI_INFO,
    // --- Mocking ---
    crate::command::mocking_commands::GET_MOCKING_STATUS_CLI_INFO,
    crate::command::mocking_commands::GET_SCENARIOS_CLI_INFO,
    crate::command::mocking_commands::CREATE_SCENARIO_CLI_INFO,
    crate::command::mocking_commands::UPDATE_SCENARIO_CLI_INFO,
    crate::command::mocking_commands::SET_SCENARIO_ENABLED_CLI_INFO,
    crate::command::mocking_commands::DELETE_SCENARIO_CLI_INFO,
    crate::command::mocking_commands::GET_MOCK_RULES_CLI_INFO,
    crate::command::mocking_commands::GET_MOCK_RULES_BY_SCENARIO_CLI_INFO,
    crate::command::mocking_commands::CREATE_MOCK_RULE_CLI_INFO,
    crate::command::mocking_commands::UPDATE_MOCK_RULE_CLI_INFO,
    crate::command::mocking_commands::DELETE_MOCK_RULE_CLI_INFO,
    crate::command::mocking_commands::CREATE_MOCK_RULE_FROM_LOG_CLI_INFO,
    // --- Cryptography & Encoding ---
    crate::command::crypto_commands::PROCESS_CRYPTO_CLI_INFO,
    crate::command::crypto_commands::VALIDATE_JSON_SCHEMA_CLI_INFO,
    // --- Inspector ---
    crate::command::inspector_commands::GET_ANNOTATIONS_CLI_INFO,
    crate::command::inspector_commands::GET_ANNOTATION_CLI_INFO,
    crate::command::inspector_commands::ADD_ANNOTATION_CLI_INFO,
    crate::command::inspector_commands::UPDATE_ANNOTATION_CLI_INFO,
    crate::command::inspector_commands::DELETE_ANNOTATION_CLI_INFO,
    crate::command::inspector_commands::IMPORT_ANNOTATIONS_CLI_INFO,
    crate::command::inspector_commands::GET_INJECTION_DOMAINS_CLI_INFO,
    crate::command::inspector_commands::SET_INJECTION_DOMAINS_CLI_INFO,
    crate::command::inspector_commands::ADD_INJECTION_DOMAIN_CLI_INFO,
    crate::command::inspector_commands::REMOVE_INJECTION_DOMAIN_CLI_INFO,
    // --- Pipeline ---
    crate::command::pipeline_commands::EXECUTE_PIPELINE_CLI_INFO,
    crate::command::pipeline_commands::EXECUTE_PIPELINE_API_NODE_CLI_INFO,
    // --- Sandbox Library ---
    crate::command::pipeline_library_commands::GET_SAVED_PIPELINES_CLI_INFO,
    crate::command::pipeline_library_commands::GET_SAVED_PIPELINE_CLI_INFO,
    crate::command::pipeline_library_commands::CREATE_SAVED_PIPELINE_CLI_INFO,
    crate::command::pipeline_library_commands::UPDATE_SAVED_PIPELINE_CLI_INFO,
    crate::command::pipeline_library_commands::DELETE_SAVED_PIPELINE_CLI_INFO,
    crate::command::pipeline_library_commands::IMPORT_SAVED_PIPELINES_CLI_INFO,
    crate::command::json_schema_registry_commands::GET_JSON_SCHEMAS_CLI_INFO,
    crate::command::json_schema_registry_commands::GET_JSON_SCHEMA_CLI_INFO,
    crate::command::json_schema_registry_commands::CREATE_JSON_SCHEMA_CLI_INFO,
    crate::command::json_schema_registry_commands::UPDATE_JSON_SCHEMA_CLI_INFO,
    crate::command::json_schema_registry_commands::DELETE_JSON_SCHEMA_CLI_INFO,
    crate::command::json_schema_registry_commands::IMPORT_JSON_SCHEMAS_CLI_INFO,
    crate::command::crypto_preset_commands::GET_CRYPTO_PRESETS_CLI_INFO,
    crate::command::crypto_preset_commands::GET_CRYPTO_PRESET_CLI_INFO,
    crate::command::crypto_preset_commands::CREATE_CRYPTO_PRESET_CLI_INFO,
    crate::command::crypto_preset_commands::UPDATE_CRYPTO_PRESET_CLI_INFO,
    crate::command::crypto_preset_commands::DELETE_CRYPTO_PRESET_CLI_INFO,
    crate::command::crypto_preset_commands::IMPORT_CRYPTO_PRESETS_CLI_INFO,
    // --- Settings ---
    crate::command::settings_commands::EXPORT_ALL_SETTINGS_CLI_INFO,
    crate::command::settings_commands::IMPORT_ALL_SETTINGS_CLI_INFO,
    crate::command::settings_commands::SAVE_ROOT_CA_CLI_INFO,
    // --- Tunnel ---
    crate::command::tunnel_commands::GET_TAILSCALE_IP_CLI_INFO,
    crate::command::tunnel_commands::START_CLOUDFLARE_TUNNEL_CLI_INFO,
    crate::command::tunnel_commands::STOP_CLOUDFLARE_TUNNEL_CLI_INFO,
    // --- USB ---
    crate::command::usb_commands::CHECK_ADB_STATUS_CLI_INFO,
    crate::command::usb_commands::START_USB_REVERSE_CLI_INFO,
    crate::command::usb_commands::STOP_USB_REVERSE_CLI_INFO,
    // --- Window ---
    crate::command::avatar_commands::GET_COMM_AVATAR_CATALOG_CLI_INFO,
    crate::command::avatar_commands::RELOAD_COMM_AVATAR_CATALOG_CLI_INFO,
    crate::command::avatar_commands::COMPOSE_COMM_AVATAR_CLI_INFO,
    crate::command::avatar_commands::WRITE_COMM_AVATAR_PART_CLI_INFO,
    crate::command::avatar_commands::PUSH_COMM_AVATAR_DRAFT_CLI_INFO,
    crate::command::window_commands::OPEN_WINDOW_CLI_INFO,
    crate::command::window_commands::OPEN_INSPECTOR_WINDOW_CLI_INFO,
    crate::command::window_commands::OPEN_ANNOTATION_DIALOG_CLI_INFO,
];

fn get_arg_val(args: &[String], flag: &str) -> Option<String> {
    let pos = args.iter().position(|x| x == flag)?;
    if pos + 1 < args.len() {
        Some(args[pos + 1].clone())
    } else {
        None
    }
}

pub enum CliExecutionMode<'a> {
    StandaloneMeta,
    Headless { env: CommandEnv<'a> },
    Gui { app_handle: () },
}

pub fn print_cli_error(msg: &str) {
    print_error(msg);
}

const META_COMMANDS: &[&str] = &["init", "list", "help", "run"];

/// Strip an optional `cli` prefix and treat a bare command name as `run`.
///
/// `hgc init` / `hgc get_proxy_status '{}'` / `hgc cli run …` all work.
pub fn normalize_args(args: &[String]) -> Vec<String> {
    let mut args = args.to_vec();
    if args.first().is_some_and(|a| a == "cli") {
        args.remove(0);
    }
    if args.is_empty() {
        return args;
    }
    let first = args[0].as_str();
    if matches!(first, "-h" | "--help" | "/?") {
        return vec!["--help".to_string()];
    }
    if !META_COMMANDS.contains(&first) && !first.starts_with('-') {
        args.insert(0, "run".to_string());
    }
    args
}

fn print_usage() {
    let output = serde_json::json!({
        "success": true,
        "data": {
            "usage": "hgc init | list | help <command> | [run] <command> [payload]",
            "examples": [
                "hgc init",
                "hgc list",
                "hgc help get_proxy_status",
                "hgc get_proxy_status '{}'",
                "hgc get_domains '{}' --query data.[].url"
            ]
        }
    });
    cli_println(&serde_json::to_string_pretty(&output).unwrap());
}

pub fn execute_cli_entry(args: &[String]) -> i32 {
    let args = normalize_args(args);
    if args.is_empty() {
        print_error(
            "명령어가 지정되지 않았습니다. (예: hgc init, hgc list, hgc get_proxy_status '{}')",
        );
        return 1;
    }
    if args[0] == "--help" {
        print_usage();
        return 0;
    }

    if args[0] == "run" {
        if crate::serve::client::is_port_open(std::time::Duration::from_millis(50)) {
            return execute_run_via_serve(&args);
        }
        let ctx = match crate::runtime::bootstrap_app_context() {
            Ok(c) => c,
            Err(e) => {
                print_error(&e);
                return 1;
            }
        };
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(e) => {
                print_error(&format!("failed to start async runtime: {e}"));
                return 1;
            }
        };
        let runtime = crate::runtime::CliRuntime::Tokio(&rt);
        let env = crate::runtime::CommandEnv {
            ctx: Some(&ctx),
            runtime,
        };
        return execute_cli(&args, CliExecutionMode::Headless { env });
    }

    execute_cli(&args, CliExecutionMode::StandaloneMeta)
}

/// Returns process exit code for `run` (0 success, 1 error). Other subcommands always return 0.
#[allow(unsafe_code)]
pub fn execute_cli(args: &[String], mode: CliExecutionMode<'_>) -> i32 {
    #[cfg(windows)]
    unsafe {
        extern "system" {
            fn SetConsoleCP(wCodePageID: u32) -> i32;
            fn SetConsoleOutputCP(wCodePageID: u32) -> i32;
        }
        SetConsoleCP(65001);
        SetConsoleOutputCP(65001);
    }

    if args.is_empty() {
        print_error(
            "명령어가 지정되지 않았습니다. (예: hgc init, hgc list, hgc get_proxy_status '{}')",
        );
        return 1;
    }

    let command = &args[0];
    if command != "init" && init::is_any_skill_outdated() {
        cli_eprintln("[horizon-gateway] Notice: Installed agent skill is outdated. Run `hgc init` to update.");
    }

    match command.as_str() {
        "init" => {
            init::execute_init(&args[1..]);
            0
        }
        "list" => {
            let output = serde_json::json!({
                "success": true,
                "data": CLI_COMMANDS
            });
            cli_println(&serde_json::to_string_pretty(&output).unwrap());
            0
        }
        "help" => {
            if args.len() < 2 {
                print_error("help 명령어 뒤에 조회할 명령어 이름을 입력해주세요. (예: hgc help get_api_logs)");
                return 1;
            }
            let cmd_name = &args[1];
            if let Some(info) = CLI_COMMANDS.iter().find(|c| c.name == cmd_name) {
                let output = serde_json::json!({
                    "success": true,
                    "data": info
                });
                cli_println(&serde_json::to_string_pretty(&output).unwrap());
                0
            } else {
                print_error(&format!("존재하지 않는 명령어입니다: {}", cmd_name));
                1
            }
        }
        "run" => {
            if args.len() < 2 {
                print_error("실행할 명령어 이름을 입력해주세요. (예: hgc get_api_logs '{}')");
                return 1;
            }
            let cmd_name = &args[1];
            let raw_payload = resolve_payload_arg(args).unwrap_or_else(|| "{}".to_string());
            let query = get_arg_val(args, "--query");

            let payload: Value = match serde_json::from_str(&raw_payload) {
                Ok(v) => v,
                Err(e) => {
                    print_error(&format!(
                        "요청 페이로드가 올바른 JSON 형식이 아닙니다: {}",
                        e
                    ));
                    return 1;
                }
            };

            let dispatch_result = match mode {
                CliExecutionMode::Headless { env } => {
                    let ctx = match env.require_ctx() {
                        Ok(c) => c,
                        Err(e) => {
                            print_error(&e);
                            return 1;
                        }
                    };
                    dispatch_headless::dispatch_headless(cmd_name, payload, ctx, &env.runtime)
                }
                CliExecutionMode::Gui { app_handle: _ } => {
                    Err("gui_only mode disabled in headless serve".into())
                }
                CliExecutionMode::StandaloneMeta => {
                    print_error(
                        "run requires a running context. Use `hgc <command>` from the shell.",
                    );
                    return 1;
                }
            };

            match dispatch_result {
                Ok(response) => {
                    let final_response = if let Some(ref q) = query {
                        query::apply_query(&response, q)
                    } else {
                        response
                    };
                    cli_println(&serde_json::to_string_pretty(&final_response).unwrap());
                    0
                }
                Err(e) => {
                    print_error(&e);
                    1
                }
            }
        }
        _ => {
            print_error(&format!(
                "알 수 없는 명령어입니다: {}. (예: hgc init, hgc list, hgc get_proxy_status '{{}}')",
                command
            ));
            1
        }
    }
}

pub(crate) fn resolve_payload_arg(args: &[String]) -> Option<String> {
    if let Some(file_flag) = get_arg_val(args, "--payload") {
        return read_payload_source(&file_flag);
    }
    let positional = args.get(2)?;
    if positional == "--query" {
        return None;
    }
    if positional.starts_with("--") {
        return None;
    }
    read_payload_source(positional)
}

/// Run a single CLI command through the serve IPC backend.
pub fn execute_run_via_serve(args: &[String]) -> i32 {
    let cmd_name = match args.get(1) {
        Some(name) => name.as_str(),
        None => {
            print_error("실행할 명령어 이름을 입력해주세요. (예: hgc get_api_logs '{}')");
            return 1;
        }
    };
    let raw_payload = resolve_payload_arg(args).unwrap_or_else(|| "{}".to_string());
    let query = get_arg_val(args, "--query");

    let payload: Value = match serde_json::from_str(&raw_payload) {
        Ok(v) => v,
        Err(e) => {
            print_error(&format!(
                "요청 페이로드가 올바른 JSON 형식이 아닙니다: {}",
                e
            ));
            return 1;
        }
    };

    let response = match crate::serve::call_command(cmd_name, payload) {
        Ok(v) => v,
        Err(e) => {
            print_error(&e);
            return 1;
        }
    };
    let final_response = if let Some(ref q) = query {
        query::apply_query(&response, q)
    } else {
        response
    };
    cli_println(&serde_json::to_string_pretty(&final_response).unwrap());
    0
}

fn read_payload_source(source: &str) -> Option<String> {
    if source == "-" {
        use std::io::Read;
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf).ok()?;
        return Some(buf);
    }
    if let Some(path) = source.strip_prefix('@') {
        return std::fs::read_to_string(path).ok();
    }
    Some(source.to_string())
}
pub fn cli_println(text: &str) {
    #[cfg(windows)]
    {
        print_to_handle(text, -11); // STD_OUTPUT_HANDLE
    }
    #[cfg(not(windows))]
    {
        println!("{}", text);
    }
}

pub fn cli_eprintln(text: &str) {
    #[cfg(windows)]
    {
        print_to_handle(text, -12); // STD_ERROR_HANDLE
    }
    #[cfg(not(windows))]
    {
        eprintln!("{}", text);
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn print_to_handle(text: &str, n_std_handle: i32) {
    use std::io::Write;
    use std::os::windows::io::FromRawHandle;

    extern "system" {
        fn GetStdHandle(n_std_handle: i32) -> *mut std::ffi::c_void;
        fn GetFileType(h_file: *mut std::ffi::c_void) -> u32;
        fn SetConsoleOutputCP(wCodePageID: u32) -> i32;
    }

    unsafe {
        SetConsoleOutputCP(65001);

        let handle = GetStdHandle(n_std_handle);
        if !handle.is_null() && handle as isize != -1 {
            let file_type = GetFileType(handle);
            // FILE_TYPE_DISK (1) or FILE_TYPE_PIPE (3) means stdio is redirected to file/pipe.
            if file_type == 1 || file_type == 3 {
                let mut file = std::mem::ManuallyDrop::new(std::fs::File::from_raw_handle(handle));
                let mut text_with_newline = text.to_string();
                text_with_newline.push_str("\r\n");
                let _ = file.write_all(text_with_newline.as_bytes());
                let _ = file.flush();
                return;
            }
        }

        // Otherwise, if we are attached to a console, print to CONOUT$ / CONERR$
        let con_path = if n_std_handle == -11 {
            "CONOUT$"
        } else {
            "CONERR$"
        };
        if let Ok(mut file) = std::fs::OpenOptions::new().write(true).open(con_path) {
            let mut text_with_newline = text.to_string();
            text_with_newline.push_str("\r\n");
            let _ = file.write_all(text_with_newline.as_bytes());
            let _ = file.flush();
        } else {
            // Fallback: If opening CONOUT$/CONERR$ fails (e.g., in non-interactive agent environments),
            // write directly to the standard handle.
            if !handle.is_null() && handle as isize != -1 {
                let mut file = std::mem::ManuallyDrop::new(std::fs::File::from_raw_handle(handle));
                let mut text_with_newline = text.to_string();
                text_with_newline.push_str("\r\n");
                let _ = file.write_all(text_with_newline.as_bytes());
                let _ = file.flush();
            }
        }
    }
}

fn print_error(msg: &str) {
    let output = serde_json::json!({
        "success": false,
        "error": msg
    });
    cli_eprintln(&serde_json::to_string_pretty(&output).unwrap());
}

/// Names handled by [`dispatch_command`]. Keep in sync when adding CLI commands:
/// `CLI_INFO` → `CLI_COMMANDS` → match arm → this list.
#[cfg(test)]
const DISPATCHED_COMMAND_NAMES: &[&str] = &[
    "get_domain_api_logging_links",
    "set_domain_api_logging",
    "remove_domain_api_logging",
    "get_api_schema_content",
    "list_api_log_dates",
    "get_api_logs",
    "get_api_log_detail",
    "search_api_logs",
    "clear_api_logs",
    "get_domains",
    "get_domain_by_id",
    "regist_domains",
    "update_domain_by_id",
    "remove_domains",
    "import_domains",
    "clear_all_domains",
    "get_groups",
    "create_group",
    "update_group",
    "delete_group",
    "get_domain_group_links",
    "set_domain_groups",
    "set_group_domains",
    "get_domains_by_group",
    "get_groups_for_domain",
    "get_latest_status",
    "get_domain_monitor_list",
    "set_domain_monitor_check_enabled",
    "get_domain_status_logs",
    "get_local_routes",
    "add_local_route",
    "update_local_route",
    "remove_local_route",
    "set_local_route_enabled",
    "get_proxy_status",
    "get_proxy_auto_start_error",
    "get_proxy_settings",
    "set_proxy_dns_server",
    "set_proxy_port",
    "set_proxy_reverse_ports",
    "get_proxy_setup_url",
    "stop_local_proxy",
    "update_proxy_settings",
    "set_https_decrypt_host",
    "start_transparent_proxy",
    "stop_transparent_proxy",
    "get_transparent_proxy_status",
    "get_mocking_status",
    "get_scenarios",
    "create_scenario",
    "update_scenario",
    "set_scenario_enabled",
    "delete_scenario",
    "get_mock_rules",
    "get_mock_rules_by_scenario",
    "create_mock_rule",
    "update_mock_rule",
    "delete_mock_rule",
    "process_crypto",
    "validate_json_schema",
    "get_annotations",
    "get_annotation",
    "add_annotation",
    "update_annotation",
    "delete_annotation",
    "import_annotations",
    "get_injection_domains",
    "set_injection_domains",
    "add_injection_domain",
    "remove_injection_domain",
    "export_all_settings",
    "import_all_settings",
    "save_root_ca",
    "download_api_schema",
    "send_api_request",
    "check_domain_status",
    "start_local_proxy",
    "create_mock_rule_from_log",
    "get_tailscale_ip",
    "start_cloudflare_tunnel",
    "stop_cloudflare_tunnel",
    "check_adb_status",
    "start_usb_reverse",
    "stop_usb_reverse",
    "open_window",
    "open_inspector_window",
    "open_annotation_dialog",
    "execute_pipeline",
    "execute_pipeline_api_node",
    "get_saved_pipelines",
    "get_saved_pipeline",
    "create_saved_pipeline",
    "update_saved_pipeline",
    "delete_saved_pipeline",
    "import_saved_pipelines",
    "get_json_schemas",
    "get_json_schema",
    "create_json_schema",
    "update_json_schema",
    "delete_json_schema",
    "import_json_schemas",
    "get_crypto_presets",
    "get_crypto_preset",
    "create_crypto_preset",
    "update_crypto_preset",
    "delete_crypto_preset",
    "import_crypto_presets",
    "get_comm_avatar_catalog",
    "reload_comm_avatar_catalog",
    "compose_comm_avatar",
    "write_comm_avatar_part",
    "push_comm_avatar_draft",
];

#[cfg(test)]
mod parity_tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn cli_list_matches_dispatch() {
        let listed: HashSet<&str> = CLI_COMMANDS.iter().map(|c| c.name).collect();
        let dispatched: HashSet<&str> = DISPATCHED_COMMAND_NAMES.iter().copied().collect();
        let mut diff: Vec<&&str> = listed.symmetric_difference(&dispatched).collect();
        diff.sort();
        assert!(
            diff.is_empty(),
            "CLI_COMMANDS and DISPATCHED_COMMAND_NAMES must stay in sync. Diff: {diff:?}"
        );
    }

    /// Keep in sync with `collect_commands!` in lib.rs — every registered Tauri
    /// command name must appear in CLI_COMMANDS (agent visibility).
    const SPECTA_COMMAND_NAMES: &[&str] = &[
        "regist_domains",
        "get_domains",
        "remove_domains",
        "get_domain_by_id",
        "update_domain_by_id",
        "import_domains",
        "clear_all_domains",
        "get_latest_status",
        "check_domain_status",
        "get_domain_status_logs",
        "get_domain_group_links",
        "set_domain_groups",
        "set_group_domains",
        "get_domains_by_group",
        "get_groups_for_domain",
        "create_group",
        "get_groups",
        "delete_group",
        "update_group",
        "get_local_routes",
        "add_local_route",
        "update_local_route",
        "remove_local_route",
        "set_local_route_enabled",
        "get_proxy_status",
        "start_local_proxy",
        "stop_local_proxy",
        "start_transparent_proxy",
        "stop_transparent_proxy",
        "get_transparent_proxy_status",
        "get_proxy_settings",
        "set_proxy_dns_server",
        "set_proxy_port",
        "set_proxy_reverse_ports",
        "get_proxy_setup_url",
        "export_all_settings",
        "import_all_settings",
        "save_root_ca",
        "get_domain_monitor_list",
        "set_domain_monitor_check_enabled",
        "get_domain_api_logging_links",
        "set_domain_api_logging",
        "remove_domain_api_logging",
        "download_api_schema",
        "get_api_schema_content",
        "send_api_request",
        "update_proxy_settings",
        "set_https_decrypt_host",
        "get_proxy_auto_start_error",
        "list_api_log_dates",
        "get_api_logs",
        "get_api_log_detail",
        "search_api_logs",
        "clear_api_logs",
        "open_window",
        "open_inspector_window",
        "open_annotation_dialog",
        "get_annotations",
        "get_annotation",
        "add_annotation",
        "update_annotation",
        "delete_annotation",
        "import_annotations",
        "get_injection_domains",
        "set_injection_domains",
        "add_injection_domain",
        "remove_injection_domain",
        "get_scenarios",
        "create_scenario",
        "update_scenario",
        "delete_scenario",
        "get_mock_rules",
        "get_mock_rules_by_scenario",
        "create_mock_rule",
        "update_mock_rule",
        "delete_mock_rule",
        "create_mock_rule_from_log",
        "get_mocking_status",
        "set_scenario_enabled",
        "get_tailscale_ip",
        "start_cloudflare_tunnel",
        "stop_cloudflare_tunnel",
        "check_adb_status",
        "start_usb_reverse",
        "stop_usb_reverse",
        "process_crypto",
        "validate_json_schema",
        "execute_pipeline",
        "execute_pipeline_api_node",
        "get_saved_pipelines",
        "get_saved_pipeline",
        "create_saved_pipeline",
        "update_saved_pipeline",
        "delete_saved_pipeline",
        "import_saved_pipelines",
        "get_json_schemas",
        "get_json_schema",
        "create_json_schema",
        "update_json_schema",
        "delete_json_schema",
        "import_json_schemas",
        "get_crypto_presets",
        "get_crypto_preset",
        "create_crypto_preset",
        "update_crypto_preset",
        "delete_crypto_preset",
        "import_crypto_presets",
        "get_comm_avatar_catalog",
        "reload_comm_avatar_catalog",
        "compose_comm_avatar",
        "write_comm_avatar_part",
        "push_comm_avatar_draft",
    ];

    #[test]
    fn cli_list_matches_specta_commands() {
        let listed: HashSet<&str> = CLI_COMMANDS.iter().map(|c| c.name).collect();
        let specta: HashSet<&str> = SPECTA_COMMAND_NAMES.iter().copied().collect();
        let mut diff: Vec<&&str> = listed.symmetric_difference(&specta).collect();
        diff.sort();
        assert!(
            diff.is_empty(),
            "CLI_COMMANDS and collect_commands! must stay in sync. Diff: {diff:?}"
        );
    }

    fn s(args: &[&str]) -> Vec<String> {
        args.iter().map(|a| (*a).to_string()).collect()
    }

    #[test]
    fn normalize_strips_cli_prefix() {
        assert_eq!(normalize_args(&s(&["cli", "init"])), s(&["init"]));
        assert_eq!(
            normalize_args(&s(&["cli", "run", "get_domains", "{}"])),
            s(&["run", "get_domains", "{}"])
        );
    }

    #[test]
    fn normalize_implies_run() {
        assert_eq!(
            normalize_args(&s(&["get_proxy_status", "{}"])),
            s(&["run", "get_proxy_status", "{}"])
        );
    }

    #[test]
    fn normalize_keeps_meta_commands() {
        assert_eq!(normalize_args(&s(&["list"])), s(&["list"]));
        assert_eq!(
            normalize_args(&s(&["help", "get_api_logs"])),
            s(&["help", "get_api_logs"])
        );
        assert_eq!(
            normalize_args(&s(&["run", "get_domains", "{}"])),
            s(&["run", "get_domains", "{}"])
        );
    }

    #[test]
    fn normalize_help_flags() {
        assert_eq!(normalize_args(&s(&["-h"])), s(&["--help"]));
        assert_eq!(normalize_args(&s(&["--help"])), s(&["--help"]));
    }

    #[test]
    fn cli_info_has_category_and_gui_flag() {
        for info in CLI_COMMANDS {
            assert!(!info.category.is_empty(), "{} missing category", info.name);
            if info.gui_only {
                assert!(
                    info.description.contains("[GUI]"),
                    "{} is gui_only but description lacks [GUI]",
                    info.name
                );
            }
        }
    }
}
