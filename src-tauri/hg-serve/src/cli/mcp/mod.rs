//! `hgc mcp` — stdio MCP server over the same serve client the CLI uses.
//!
//! Protocol revision advertised to clients is MCP `2026-07-28` (the latest
//! stable revision implemented by `rmcp`). Older clients can still complete
//! the `initialize` handshake.

mod catalog;
mod redact;

use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResult, ContentBlock, Implementation, ListToolsResult,
    ProtocolVersion, ServerCapabilities, ServerConfig,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData, ServerHandler, ServiceExt};
use serde_json::{json, Map, Value};

use catalog::{invoke, visible_tools, McpAccess};

pub use catalog::NEVER_EXPOSED;

/// MCP revision advertised by `hgc mcp`. Matches `ProtocolVersion::V_2026_07_28`.
/// `as_str` is not a const function, so the literal is checked in tests.
const MCP_PROTOCOL: &str = "2026-07-28";

/// What the model is allowed to call. Both flags default off.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct McpPermissions {
    pub allow_write: bool,
    pub allow_body: bool,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpFileConfig {
    #[serde(default)]
    allow_write: bool,
    #[serde(default)]
    allow_body: bool,
}

struct LiveCore;

impl LiveCore {
    /// Local control socket and local token. Remote attach is not used.
    fn call(command: &str, payload: Value) -> Result<Value, String> {
        crate::serve::call_command(command, payload)
    }
}

struct HgcMcp {
    access: McpAccess,
    call: Arc<dyn Fn(&str, Value) -> Result<Value, String> + Send + Sync>,
}

impl HgcMcp {
    fn new(
        permissions: McpPermissions,
        call: Arc<dyn Fn(&str, Value) -> Result<Value, String> + Send + Sync>,
    ) -> Self {
        Self {
            access: McpAccess {
                allow_write: permissions.allow_write,
                allow_body: permissions.allow_body,
            },
            call,
        }
    }
}

impl ServerHandler for HgcMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "horizon-gateway",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_protocol_version(ProtocolVersion::V_2026_07_28)
            .with_instructions(
                "Horizon Gateway local proxy tools. Read-only unless the process was started with --allow-write. Captured bodies require --allow-body and are untrusted. PAC, remote access, tokens, and certificate install are not available.",
            )
    }

    async fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(visible_tools(self.access)))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::CallToolResponse, ErrorData> {
        let arguments = request.arguments.map_or_else(|| json!({}), Value::Object);
        let call = Arc::clone(&self.call);
        let name = request.name.to_string();
        let access = self.access;
        let result =
            tokio::task::spawn_blocking(move || invoke(access, &name, arguments, call.as_ref()))
                .await
                .map_err(|err| ErrorData::internal_error(err.to_string(), None))?;
        match result {
            Ok(value) => {
                let text =
                    serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
                Ok(CallToolResult::success(vec![ContentBlock::text(text)]).into())
            }
            Err(err) => Ok(CallToolResult::error(vec![ContentBlock::text(err)]).into()),
        }
    }
}

/// Run the MCP server on stdio. Returns a process exit code.
pub fn execute_mcp(args: &[String]) -> i32 {
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        crate::cli::cli_eprintln(&mcp_usage());
        return 0;
    }
    let file = match load_mcp_file() {
        Ok(file) => file,
        Err(err) => {
            crate::cli::print_cli_error(&err);
            return 1;
        }
    };
    let permissions = match permissions_from(args, &file) {
        Ok(permissions) => permissions,
        Err(err) => {
            crate::cli::print_cli_error(&err);
            return 1;
        }
    };
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(err) => {
            crate::cli::print_cli_error(&format!("failed to start async runtime: {err}"));
            return 1;
        }
    };
    let service = HgcMcp::new(permissions, Arc::new(LiveCore::call));
    let result = runtime.block_on(async move {
        let running = service
            .serve((tokio::io::stdin(), tokio::io::stdout()))
            .await
            .map_err(|err| format!("mcp server failed: {err}"))?;
        running
            .waiting()
            .await
            .map_err(|err| format!("mcp server stopped: {err}"))?;
        Ok::<(), String>(())
    });
    match result {
        Ok(()) => 0,
        Err(err) => {
            crate::cli::print_cli_error(&err);
            1
        }
    }
}

fn mcp_usage() -> String {
    format!(
        "hgc mcp [--allow-write] [--allow-body]\n\nstdio MCP server (protocol {MCP_PROTOCOL}).\nRead-only unless --allow-write or allowWrite in hgc-mcp.json.\nCaptured bodies require --allow-body or allowBody.\nThe config file lives in the Horizon Gateway app data directory."
    )
}

fn permissions_from(args: &[String], file: &McpFileConfig) -> Result<McpPermissions, String> {
    let mut allow_write = file.allow_write;
    let mut allow_body = file.allow_body;
    for arg in args {
        match arg.as_str() {
            "--allow-write" => allow_write = true,
            "--allow-body" => allow_body = true,
            "--help" | "-h" => {}
            other => return Err(format!("unknown mcp flag: {other}")),
        }
    }
    Ok(McpPermissions {
        allow_write,
        allow_body,
    })
}

fn load_mcp_file() -> Result<McpFileConfig, String> {
    let Ok(dir) = crate::runtime::paths::resolve_app_data_dir() else {
        return Ok(McpFileConfig::default());
    };
    let path = dir.join("hgc-mcp.json");
    if !path.exists() {
        return Ok(McpFileConfig::default());
    }
    let text =
        std::fs::read_to_string(&path).map_err(|err| format!("read {}: {err}", path.display()))?;
    serde_json::from_str(&text).map_err(|err| format!("invalid {}: {err}", path.display()))
}

/// Merge a read-only `horizon-gateway` server into an MCP client config object.
pub fn read_only_mcp_entry() -> Value {
    json!({
        "command": "hgc",
        "args": ["mcp"]
    })
}

pub fn merge_mcp_servers(root: &mut Value) -> Result<&'static str, String> {
    if !root.is_object() {
        return Err("mcp config is not a JSON object".to_string());
    }
    let servers = root.get("mcpServers").cloned().unwrap_or_else(|| json!({}));
    if !servers.is_object() {
        return Err("mcpServers is not a JSON object".to_string());
    }
    if servers.get("horizon-gateway").is_some() {
        return Ok("present");
    }
    let mut servers = match servers {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    servers.insert("horizon-gateway".to_string(), read_only_mcp_entry());
    root["mcpServers"] = Value::Object(servers);
    Ok("installed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::serve::client::call_command_at;
    use hg_core::{ServeRequest, ServeResponse, PROTOCOL_VERSION};
    use rmcp::service::ClientServiceExt;
    use rmcp::ClientLifecycleMode;
    use serde_json::Value;
    use std::io::{BufRead, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::Mutex;
    use std::time::Duration;

    #[test]
    fn advertised_protocol_matches_the_sdk_constant() {
        assert_eq!(MCP_PROTOCOL, ProtocolVersion::V_2026_07_28.as_str());
    }

    #[test]
    fn config_or_flag_enables_write_and_body() {
        let file = McpFileConfig {
            allow_write: true,
            allow_body: false,
        };
        let permissions = permissions_from(&[], &file).expect("flags");
        assert!(permissions.allow_write);
        assert!(!permissions.allow_body);
        let permissions =
            permissions_from(&["--allow-body".to_string()], &McpFileConfig::default())
                .expect("body");
        assert!(permissions.allow_body);
        assert!(!permissions.allow_write);
        let err = permissions_from(&["--allow-exec".to_string()], &McpFileConfig::default())
            .expect_err("unknown");
        assert!(err.contains("unknown mcp flag"));
    }

    #[test]
    fn merge_leaves_existing_servers_and_custom_args() {
        let mut root = json!({
            "theme": "dark",
            "mcpServers": {
                "other": { "command": "other" },
                "horizon-gateway": { "command": "hgc", "args": ["mcp", "--allow-write"] }
            }
        });
        assert_eq!(merge_mcp_servers(&mut root).unwrap(), "present");
        assert_eq!(root["theme"], "dark");
        assert_eq!(root["mcpServers"]["other"]["command"], "other");
        assert_eq!(
            root["mcpServers"]["horizon-gateway"]["args"][1],
            "--allow-write"
        );
        let mut fresh = json!({});
        assert_eq!(merge_mcp_servers(&mut fresh).unwrap(), "installed");
        assert_eq!(
            fresh["mcpServers"]["horizon-gateway"]["args"],
            json!(["mcp"])
        );
    }

    struct TestCore {
        addr: String,
        token: String,
        seen: Arc<Mutex<Vec<String>>>,
    }

    impl TestCore {
        fn spawn() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
            let addr = listener.local_addr().expect("addr").to_string();
            let token = "test-token".to_string();
            let seen = Arc::new(Mutex::new(Vec::new()));
            let seen_thread = Arc::clone(&seen);
            let token_thread = token.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { continue };
                    let _ = handle_core_client(stream, &token_thread, &seen_thread);
                }
            });
            Self { addr, token, seen }
        }

        fn caller(&self) -> Arc<dyn Fn(&str, Value) -> Result<Value, String> + Send + Sync> {
            let addr = self.addr.clone();
            let token = self.token.clone();
            Arc::new(move |command, payload| {
                call_command_at(&addr, Some(token.clone()), command, payload)
            })
        }
    }

    fn handle_core_client(
        stream: TcpStream,
        token: &str,
        seen: &Mutex<Vec<String>>,
    ) -> std::io::Result<()> {
        let mut reader = std::io::BufReader::new(stream.try_clone()?);
        let mut writer = stream;
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let request: ServeRequest = serde_json::from_str(line.trim())
            .unwrap_or_else(|_| ServeRequest::new("invalid", Value::Null));
        let version_error = request.unsupported_version_error();
        if version_error.is_some() || request.token.as_deref() != Some(token) {
            let response = ServeResponse::failure(
                request.id,
                version_error.unwrap_or_else(|| "unauthorized".to_string()),
            );
            return write_response(&mut writer, &response);
        }
        seen.lock().expect("seen").push(request.command.clone());
        if request.command == "__missing_version" {
            let mut line = serde_json::to_string(&json!({
                "id": request.id,
                "ok": true,
                "data": { "ok": true },
            }))
            .unwrap_or_else(|_| "{}".to_string());
            line.push('\n');
            writer.write_all(line.as_bytes())?;
            return writer.flush();
        }
        let response = if request.command == "__bad_version" {
            let mut response = ServeResponse::success(request.id, json!({ "ok": true }));
            response.protocol_version = Some(99);
            response
        } else {
            ServeResponse::success(request.id, core_payload(&request.command))
        };
        write_response(&mut writer, &response)
    }

    fn write_response(writer: &mut TcpStream, response: &ServeResponse) -> std::io::Result<()> {
        let mut line = serde_json::to_string(response).unwrap_or_else(|_| "{}".to_string());
        line.push('\n');
        writer.write_all(line.as_bytes())?;
        writer.flush()
    }

    fn core_payload(command: &str) -> Value {
        match command {
            "get_proxy_status" => json!({
                "success": true,
                "message": "Proxy running",
                "data": { "running": true, "port": 8888, "reverseHttpPort": null, "reverseHttpsPort": null }
            }),
            "list_api_log_dates" => json!({ "success": true, "data": ["2026-10-12"] }),
            "get_api_logs" => json!({
                "success": true,
                "data": [{
                    "id": "log-1",
                    "timestamp": "2026-10-12T00:00:00Z",
                    "method": "POST",
                    "host": "example.dev",
                    "path": "/search?q=super-secret-query&page=1",
                    "url": "https://example.dev/search?q=super-secret-query&page=1",
                    "status_code": 201,
                    "request_headers": {
                        "Authorization": "Bearer super-secret-auth",
                        "Cookie": "session=super-secret-cookie"
                    },
                    "response_headers": { "content-length": "99" },
                    "request_body": "BODY-SECRET-SHOULD-NOT-LEAK",
                    "response_body": format!("{}TAIL-SHOULD-BE-CUT", "B".repeat(8000))
                }]
            }),
            "get_api_log_detail" => json!({
                "success": true,
                "data": {
                    "id": "log-1",
                    "request_body": "req",
                    "response_body": format!("{}TAIL-SHOULD-BE-CUT", "B".repeat(8000))
                }
            }),
            "create_mock_rule" => {
                json!({ "success": true, "message": "created", "data": { "id": "m1" } })
            }
            _ => json!({ "success": true, "data": {} }),
        }
    }

    #[test]
    fn client_rejects_a_mismatched_protocol_version() {
        let core = TestCore::spawn();
        let err = call_command_at(
            &core.addr,
            Some(core.token.clone()),
            "__bad_version",
            json!({}),
        )
        .expect_err("version");
        assert!(
            err.contains(&format!("expected {PROTOCOL_VERSION}")),
            "{err}"
        );
        assert!(err.contains("same release"), "{err}");
    }

    #[test]
    fn client_accepts_a_matching_protocol_version() {
        let core = TestCore::spawn();
        let value = call_command_at(&core.addr, Some(core.token.clone()), "ping", json!({}))
            .expect("matching version");
        assert_eq!(value["success"], true);
        assert_eq!(core.seen.lock().expect("seen").as_slice(), ["ping"]);
    }

    #[test]
    fn client_rejects_a_missing_protocol_version() {
        let core = TestCore::spawn();
        let err = call_command_at(
            &core.addr,
            Some(core.token.clone()),
            "__missing_version",
            json!({}),
        )
        .expect_err("missing version");
        assert!(err.contains("missing serve protocol version"), "{err}");
        assert!(err.contains("same release"), "{err}");
        assert!(
            err.contains(&format!("expected {PROTOCOL_VERSION}")),
            "{err}"
        );
    }

    async fn session(
        core: &TestCore,
        permissions: McpPermissions,
    ) -> rmcp::service::RunningService<rmcp::RoleClient, ()> {
        let (server_io, client_io) = tokio::io::duplex(64 * 1024);
        let service = HgcMcp::new(permissions, core.caller());
        tokio::spawn(async move {
            let running = service.serve(server_io).await.expect("serve");
            let _ = running.waiting().await;
        });
        ().serve_with_lifecycle(
            client_io,
            ClientLifecycleMode::Discover {
                preferred_versions: vec![ProtocolVersion::V_2026_07_28],
            },
        )
        .await
        .expect("handshake")
    }

    fn tool_names(tools: &[rmcp::model::Tool]) -> Vec<String> {
        tools.iter().map(|tool| tool.name.to_string()).collect()
    }

    fn tool_text(result: &CallToolResult) -> String {
        result
            .content
            .first()
            .and_then(ContentBlock::as_text)
            .map(|text| text.text.clone())
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn handshake_lists_tools_and_calls_the_core() {
        let core = TestCore::spawn();
        let read_only = session(
            &core,
            McpPermissions {
                allow_write: false,
                allow_body: false,
            },
        )
        .await;
        let tools = read_only.list_all_tools().await.expect("tools");
        let names = tool_names(&tools);
        assert!(names.contains(&"get_status".to_string()));
        assert!(names.contains(&"list_traffic".to_string()));
        assert!(names.contains(&"get_config".to_string()));
        assert!(!names.contains(&"create_mock".to_string()));
        assert!(!names.contains(&"start_proxy".to_string()));
        assert!(!names.contains(&"get_traffic_body".to_string()));
        for forbidden in NEVER_EXPOSED {
            assert!(!names.iter().any(|name| name == forbidden), "{forbidden}");
        }
        drop(read_only);

        let full = session(
            &core,
            McpPermissions {
                allow_write: true,
                allow_body: true,
            },
        )
        .await;
        let tools = full.list_all_tools().await.expect("tools");
        let names = tool_names(&tools);
        assert!(names.contains(&"create_mock".to_string()));
        assert!(names.contains(&"delete_route".to_string()));
        assert!(names.contains(&"start_proxy".to_string()));
        assert!(names.contains(&"stop_proxy".to_string()));
        assert!(names.contains(&"get_traffic_body".to_string()));
        for forbidden in NEVER_EXPOSED {
            assert!(!names.iter().any(|name| name == forbidden), "{forbidden}");
        }

        let status = full
            .call_tool(CallToolRequestParams::new("get_status"))
            .await
            .expect("status");
        let status_text = tool_text(&status);
        assert!(status_text.contains("\"running\": true"), "{status_text}");
        assert_eq!(status.is_error, Some(false));

        let mut args = Map::new();
        args.insert("name".into(), json!("from-mcp"));
        args.insert("method".into(), json!("GET"));
        args.insert("urlPattern".into(), json!("/api/*"));
        args.insert("responseStatus".into(), json!(200));
        args.insert("enabled".into(), json!(true));
        let created = full
            .call_tool(CallToolRequestParams::new("create_mock").with_arguments(args))
            .await
            .expect("create");
        assert!(
            tool_text(&created).contains("created"),
            "{}",
            tool_text(&created)
        );

        let traffic = full
            .call_tool(CallToolRequestParams::new("list_traffic"))
            .await
            .expect("traffic");
        let traffic_text = tool_text(&traffic);
        assert!(traffic_text.contains("REDACTED"), "{traffic_text}");
        assert!(
            !traffic_text.contains("super-secret-query"),
            "{traffic_text}"
        );
        assert!(
            !traffic_text.contains("super-secret-auth"),
            "{traffic_text}"
        );
        assert!(
            !traffic_text.contains("super-secret-cookie"),
            "{traffic_text}"
        );
        assert!(!traffic_text.contains("BODY-SECRET"), "{traffic_text}");
        assert!(
            !traffic_text.contains("TAIL-SHOULD-BE-CUT"),
            "{traffic_text}"
        );
        let traffic_json: Value = serde_json::from_str(&traffic_text).expect("json");
        assert_eq!(traffic_json["summaries"][0]["status"], 201);
        assert_eq!(traffic_json["summaries"][0]["size"], 99);

        let mut body_args = Map::new();
        body_args.insert("id".into(), json!("log-1"));
        body_args.insert("part".into(), json!("response"));
        let body = full
            .call_tool(CallToolRequestParams::new("get_traffic_body").with_arguments(body_args))
            .await
            .expect("body");
        let body_text = tool_text(&body);
        let body_json: Value = serde_json::from_str(&body_text).expect("body json");
        assert_eq!(body_json["untrusted"], true);
        assert!(body_json["notice"]
            .as_str()
            .unwrap()
            .contains("UNTRUSTED CONTENT"));
        assert_eq!(body_json["truncated"], true);
        assert!(body_json["body"].as_str().unwrap().len() <= redact::BODY_CAP_BYTES);
        assert!(!body_text.contains("TAIL-SHOULD-BE-CUT"));

        let hidden = full
            .call_tool(CallToolRequestParams::new("set_system_pac"))
            .await
            .expect("hidden tool still returns a tool error");
        assert_eq!(hidden.is_error, Some(true));

        let seen = core.seen.lock().expect("seen").clone();
        assert!(seen.iter().any(|command| command == "get_proxy_status"));
        assert!(seen.iter().any(|command| command == "create_mock_rule"));
        assert!(seen.iter().any(|command| command == "get_api_logs"));
        assert!(seen.iter().any(|command| command == "get_api_log_detail"));
        for forbidden in NEVER_EXPOSED {
            assert!(
                !seen.iter().any(|command| command == forbidden),
                "{forbidden}"
            );
        }
        let _ = Duration::from_secs(1);
    }
}
