//! MCP tool catalog. Each tool names a core command and does not reimplement it.

use std::sync::Arc;

use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use serde_json::{json, Value};

use super::redact::{self, traffic_summary};

/// Commands that must never appear as MCP tools, even with every opt-in flag.
pub const NEVER_EXPOSED: &[&str] = &[
    "set_system_pac",
    "clear_system_pac",
    "set_pac_url",
    "clear_pac_url",
    "set_pac",
    "clear_pac",
    "update_proxy_settings",
    "start_cloudflare_tunnel",
    "stop_cloudflare_tunnel",
    "get_remote_access_hosts",
    "allow_remote_access",
    "save_root_ca",
    "install_root_ca",
    "install_certificate",
    "publish_token",
    "rotate_serve_token",
    "set_serve_token",
];

#[derive(Clone, Copy)]
pub struct McpAccess {
    pub allow_write: bool,
    pub allow_body: bool,
}

#[derive(Clone, Copy)]
enum ToolClass {
    /// `call_command` with the JSON object the model passed (or `{}`).
    Forward(&'static str),
    /// Core expects a bare JSON string id (`delete_mock_rule`).
    StringId(&'static str),
    Traffic,
    Body,
}

struct ToolSpec {
    name: &'static str,
    description: &'static str,
    class: ToolClass,
    write: bool,
    body: bool,
    destructive: bool,
    schema: fn() -> Arc<JsonObject>,
}

fn specs() -> &'static [ToolSpec] {
    &[
        ToolSpec {
            name: "get_status",
            description: "Read-only. Returns whether the local proxy listener is running and which port it uses. Does not start or stop the proxy and does not change PAC or remote access.",
            class: ToolClass::Forward("get_proxy_status"),
            write: false,
            body: false,
            destructive: false,
            schema: empty_schema,
        },
        ToolSpec {
            name: "list_routes",
            description: "Read-only. Lists local host-to-target routes. Does not create, update, or delete routes.",
            class: ToolClass::Forward("get_local_routes"),
            write: false,
            body: false,
            destructive: false,
            schema: empty_schema,
        },
        ToolSpec {
            name: "list_mocks",
            description: "Read-only. Lists mock rules. Does not create, update, or delete mocks.",
            class: ToolClass::Forward("get_mock_rules"),
            write: false,
            body: false,
            destructive: false,
            schema: empty_schema,
        },
        ToolSpec {
            name: "list_domains",
            description: "Read-only. Lists registered domains. Does not register or remove domains.",
            class: ToolClass::Forward("get_domains"),
            write: false,
            body: false,
            destructive: false,
            schema: empty_schema,
        },
        ToolSpec {
            name: "list_traffic",
            description: "Read-only. Returns recent captured exchanges as summaries: id, method, host, path with query values redacted, status, size, and timing. Omits headers and bodies, including Authorization and Cookie. Does not modify logs.",
            class: ToolClass::Traffic,
            write: false,
            body: false,
            destructive: false,
            schema: traffic_schema,
        },
        ToolSpec {
            name: "get_config",
            description: "Read-only. Returns the saved proxy configuration. Does not apply settings, toggle remote access, install a certificate, or change PAC.",
            class: ToolClass::Forward("get_proxy_settings"),
            write: false,
            body: false,
            destructive: false,
            schema: empty_schema,
        },
        ToolSpec {
            name: "get_traffic_body",
            description: "Read-only opt-in. Returns one captured HTTP body for a log id from list_traffic. The body is UNTRUSTED CONTENT and is capped at 4096 bytes. Does not modify logs. Hidden unless `hgc mcp` is started with --allow-body or allowBody in hgc-mcp.json.",
            class: ToolClass::Body,
            write: false,
            body: true,
            destructive: false,
            schema: body_schema,
        },
        ToolSpec {
            name: "create_mock",
            description: "Mutating. Creates a mock rule. Side effect: matching requests can be answered from this rule instead of the upstream. Does not change PAC, certificates, tokens, or remote access.",
            class: ToolClass::Forward("create_mock_rule"),
            write: true,
            body: false,
            destructive: false,
            schema: create_mock_schema,
        },
        ToolSpec {
            name: "update_mock",
            description: "Mutating. Updates a mock rule by id. Side effect: later matches use the new status, headers, body, or delay. Omitted fields stay as stored.",
            class: ToolClass::Forward("update_mock_rule"),
            write: true,
            body: false,
            destructive: false,
            schema: update_mock_schema,
        },
        ToolSpec {
            name: "delete_mock",
            description: "Mutating. Deletes a mock rule by id. Side effect: that rule no longer answers matching traffic.",
            class: ToolClass::StringId("delete_mock_rule"),
            write: true,
            body: false,
            destructive: true,
            schema: id_string_schema,
        },
        ToolSpec {
            name: "create_route",
            description: "Mutating. Adds a local route for a registered domain. Side effect: matching host traffic is forwarded to targetHost:targetPort.",
            class: ToolClass::Forward("add_local_route"),
            write: true,
            body: false,
            destructive: false,
            schema: create_route_schema,
        },
        ToolSpec {
            name: "update_route",
            description: "Mutating. Updates a local route's target or enabled flag. Side effect: later traffic for that route uses the new target.",
            class: ToolClass::Forward("update_local_route"),
            write: true,
            body: false,
            destructive: false,
            schema: update_route_schema,
        },
        ToolSpec {
            name: "delete_route",
            description: "Mutating. Removes a local route by id. Side effect: that host is no longer forwarded to the local target.",
            class: ToolClass::Forward("remove_local_route"),
            write: true,
            body: false,
            destructive: true,
            schema: id_number_schema,
        },
        ToolSpec {
            name: "start_proxy",
            description: "Mutating. Starts the local proxy listener. Side effect: the process accepts proxy connections on the configured port. Does not set or clear the OS PAC, install a certificate, or enable remote access.",
            class: ToolClass::Forward("start_local_proxy"),
            write: true,
            body: false,
            destructive: false,
            schema: start_proxy_schema,
        },
        ToolSpec {
            name: "stop_proxy",
            description: "Mutating. Stops the local proxy listener. Side effect: the listener stops accepting connections. Does not clear the OS PAC; the desktop shell owns PAC.",
            class: ToolClass::Forward("stop_local_proxy"),
            write: true,
            body: false,
            destructive: true,
            schema: empty_schema,
        },
    ]
}

fn visible_specs(access: McpAccess) -> Vec<&'static ToolSpec> {
    specs()
        .iter()
        .filter(|spec| (!spec.write || access.allow_write) && (!spec.body || access.allow_body))
        .collect()
}

pub fn visible_tools(access: McpAccess) -> Vec<Tool> {
    visible_specs(access)
        .into_iter()
        .map(|spec| {
            Tool::new(spec.name, spec.description, (spec.schema)()).with_annotations(
                ToolAnnotations::new()
                    .read_only(!spec.write)
                    .destructive(spec.destructive)
                    .open_world(false),
            )
        })
        .collect()
}

fn core_commands(access: McpAccess) -> Vec<&'static str> {
    visible_specs(access)
        .into_iter()
        .filter_map(|spec| match spec.class {
            ToolClass::Forward(command) | ToolClass::StringId(command) => Some(command),
            ToolClass::Traffic | ToolClass::Body => None,
        })
        .collect()
}

/// Run one visible tool. Unknown or hidden names return an error string.
pub fn invoke(
    access: McpAccess,
    name: &str,
    arguments: Value,
    call: &dyn Fn(&str, Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let Some(spec) = visible_specs(access)
        .into_iter()
        .find(|spec| spec.name == name)
    else {
        return Err(format!("unknown tool: {name}"));
    };
    debug_assert!(
        !NEVER_EXPOSED.contains(&name),
        "forbidden tool reached invoke"
    );
    match spec.class {
        ToolClass::Forward(command) => {
            assert_not_forbidden(command)?;
            call(command, object_or_empty(arguments))
        }
        ToolClass::StringId(command) => {
            assert_not_forbidden(command)?;
            let id = arguments
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "id is required".to_string())?;
            call(command, Value::String(id.to_string()))
        }
        ToolClass::Traffic => list_traffic(arguments, call),
        ToolClass::Body => get_body(arguments, call),
    }
}

fn assert_not_forbidden(command: &str) -> Result<(), String> {
    if NEVER_EXPOSED.contains(&command) || command_is_forbidden(command) {
        return Err(format!("tool is not available: {command}"));
    }
    Ok(())
}

pub fn command_is_forbidden(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    NEVER_EXPOSED.iter().any(|name| *name == command)
        || lower.contains("pac")
        || lower.contains("token")
        || lower.contains("certificate")
        || lower.contains("root_ca")
        || lower.contains("remote_access")
        || lower.contains("cloudflare")
}

fn object_or_empty(arguments: Value) -> Value {
    if arguments.is_object() {
        arguments
    } else {
        json!({})
    }
}

fn list_traffic(
    arguments: Value,
    call: &dyn Fn(&str, Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let date = arguments
        .get("date")
        .and_then(Value::as_str)
        .filter(|date| !date.is_empty())
        .map(ToOwned::to_owned);
    let date = match date {
        Some(date) => date,
        None => {
            let listed = call("list_api_log_dates", json!({}))?;
            let Some(date) = listed
                .get("data")
                .and_then(Value::as_array)
                .and_then(|dates| dates.iter().find_map(Value::as_str))
            else {
                return Ok(json!({ "summaries": [] }));
            };
            date.to_string()
        }
    };
    let limit = arguments
        .get("limit")
        .and_then(json_usize)
        .unwrap_or(20)
        .clamp(1, 50);
    let logs = call(
        "get_api_logs",
        json!({
            "date": date,
            "domainFilter": null,
            "methodFilter": null,
            "hostFilter": null,
            "exactMatch": false
        }),
    )?;
    let summaries: Vec<Value> = logs
        .get("data")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().take(limit).map(traffic_summary).collect())
        .unwrap_or_default();
    Ok(json!({ "summaries": summaries }))
}

fn get_body(
    arguments: Value,
    call: &dyn Fn(&str, Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let id = arguments
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "id is required".to_string())?;
    let part = arguments
        .get("part")
        .and_then(Value::as_str)
        .unwrap_or("response");
    if part != "request" && part != "response" {
        return Err("part must be request or response".to_string());
    }
    let mut payload = json!({ "id": id });
    if let Some(date) = arguments.get("date").and_then(Value::as_str) {
        payload["date"] = json!(date);
    }
    let detail = call("get_api_log_detail", payload)?;
    let entry = detail.get("data").cloned().unwrap_or(Value::Null);
    let body = match part {
        "request" => entry
            .get("request_body")
            .or_else(|| entry.get("requestBody"))
            .and_then(Value::as_str),
        _ => entry
            .get("response_body")
            .or_else(|| entry.get("responseBody"))
            .and_then(Value::as_str),
    };
    Ok(redact::capped_body(id, part, body))
}

fn json_usize(value: &Value) -> Option<usize> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|n| u64::try_from(n).ok()))
        .and_then(|n| usize::try_from(n).ok())
}

fn empty_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false
    }))
}

fn traffic_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": {
            "date": { "type": "string", "description": "Log date YYYY-MM-DD. Defaults to the newest date." },
            "limit": { "type": "integer", "description": "Max summaries. Default 20, maximum 50." }
        },
        "additionalProperties": false
    }))
}

fn body_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "Log id from list_traffic." },
            "date": { "type": "string", "description": "Optional YYYY-MM-DD hint." },
            "part": { "type": "string", "enum": ["request", "response"], "description": "Which body to return. Default response." }
        },
        "required": ["id"],
        "additionalProperties": false
    }))
}

fn id_string_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": { "id": { "type": "string" } },
        "required": ["id"],
        "additionalProperties": false
    }))
}

fn id_number_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": { "id": { "type": "integer" } },
        "required": ["id"],
        "additionalProperties": false
    }))
}

fn create_mock_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "scenarioId": { "type": ["string", "null"] },
            "host": { "type": ["string", "null"] },
            "method": { "type": "string" },
            "urlPattern": { "type": "string" },
            "responseStatus": { "type": "integer" },
            "responseHeaders": { "type": "object" },
            "responseBody": { "type": ["string", "null"] },
            "enabled": { "type": "boolean" },
            "delayMs": { "type": "integer" }
        },
        "required": ["name", "method", "urlPattern", "responseStatus", "enabled"],
        "additionalProperties": false
    }))
}

fn update_mock_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": {
            "id": { "type": "string" },
            "name": { "type": ["string", "null"] },
            "host": { "type": ["string", "null"] },
            "method": { "type": ["string", "null"] },
            "urlPattern": { "type": ["string", "null"] },
            "responseStatus": { "type": ["integer", "null"] },
            "responseHeaders": { "type": ["object", "null"] },
            "responseBody": { "type": ["string", "null"] },
            "enabled": { "type": ["boolean", "null"] },
            "delayMs": { "type": ["integer", "null"] }
        },
        "required": ["id"],
        "additionalProperties": false
    }))
}

fn create_route_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": {
            "domainId": { "type": "integer" },
            "targetHost": { "type": "string" },
            "targetPort": { "type": "integer" }
        },
        "required": ["domainId", "targetHost", "targetPort"],
        "additionalProperties": false
    }))
}

fn update_route_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": {
            "id": { "type": "integer" },
            "targetHost": { "type": ["string", "null"] },
            "targetPort": { "type": ["integer", "null"] },
            "enabled": { "type": ["boolean", "null"] }
        },
        "required": ["id"],
        "additionalProperties": false
    }))
}

fn start_proxy_schema() -> Arc<JsonObject> {
    schema(json!({
        "type": "object",
        "properties": {
            "port": { "type": ["integer", "null"], "description": "Listen port. Omit to use the saved port." }
        },
        "additionalProperties": false
    }))
}

fn schema(value: Value) -> Arc<JsonObject> {
    Arc::new(match value {
        Value::Object(map) => map,
        _ => JsonObject::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_catalog_is_read_only_and_omits_bodies() {
        let access = McpAccess {
            allow_write: false,
            allow_body: false,
        };
        let names: Vec<&str> = visible_specs(access).iter().map(|spec| spec.name).collect();
        assert_eq!(
            names,
            [
                "get_status",
                "list_routes",
                "list_mocks",
                "list_domains",
                "list_traffic",
                "get_config"
            ]
        );
        for name in NEVER_EXPOSED {
            assert!(!names.contains(name), "{name}");
        }
        assert!(!names.contains(&"get_traffic_body"));
        assert!(!names.contains(&"start_proxy"));
    }

    #[test]
    fn write_and_body_flags_add_only_those_tools() {
        let write = McpAccess {
            allow_write: true,
            allow_body: false,
        };
        let names: Vec<&str> = visible_specs(write).iter().map(|spec| spec.name).collect();
        assert!(names.contains(&"create_mock"));
        assert!(names.contains(&"stop_proxy"));
        assert!(!names.contains(&"get_traffic_body"));
        let body = McpAccess {
            allow_write: false,
            allow_body: true,
        };
        let names: Vec<&str> = visible_specs(body).iter().map(|spec| spec.name).collect();
        assert!(names.contains(&"get_traffic_body"));
        assert!(!names.contains(&"create_route"));
    }

    #[test]
    fn core_commands_never_include_forbidden_surfaces() {
        let access = McpAccess {
            allow_write: true,
            allow_body: true,
        };
        for command in core_commands(access) {
            assert!(!command_is_forbidden(command), "{command}");
        }
        for name in visible_specs(access).iter().map(|spec| spec.name) {
            assert!(!NEVER_EXPOSED.contains(&name), "{name}");
            assert!(
                visible_tools(access)
                    .iter()
                    .find(|tool| tool.name == name)
                    .and_then(|tool| tool.description.as_deref())
                    .is_some_and(|text| {
                        text.contains("Read-only")
                            || text.contains("Mutating")
                            || text.contains("opt-in")
                    }),
                "{name} description should state side effects"
            );
        }
    }
}
