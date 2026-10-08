"""Generate cli/dispatch_headless.rs with robust brace-aware arm parsing."""

from __future__ import annotations

import re
from pathlib import Path

TYPE_TO_CTX = {
    "ApiLoggingSettingsService": "api_logging_service",
    "ApiLogService": "api_log_service",
    "DomainService": "domain_service",
    "DomainGroupLinkService": "link_service",
    "DomainMonitorService": "monitor_service",
    "Arc<LocalRouteService>": "local_route_service",
    "std::sync::Arc<LocalRouteService>": "local_route_service",
    "ProxySettingsService": "proxy_settings_service",
    "Arc<MockingService>": "mocking_service",
    "std::sync::Arc<MockingService>": "mocking_service",
    "std::sync::Arc<crate::service::mocking_service::MockingService>": "mocking_service",
    "InspectorService": "inspector_service",
    "crate::service::inspector_service::InspectorService": "inspector_service",
    "Arc<CaService>": "ca_service",
    "std::sync::Arc<CaService>": "ca_service",
    "DomainGroupService": "group_service",
    "Arc<TunnelService>": "tunnel_service",
    "Arc<UsbService>": "usb_service",
    "Arc<PipelineLibraryService>": "pipeline_library_service",
    "Arc<JsonSchemaRegistryService>": "json_schema_registry_service",
    "Arc<CryptoPresetService>": "crypto_preset_service",
}

GUI_ONLY = {
    "open_window",
    "open_inspector_window",
    "open_annotation_dialog",
}


def extract_arms(src: str) -> list[tuple[str, str]]:
    start = src.find("match cmd_name {")
    if start < 0:
        raise ValueError("match cmd_name not found")
    i = src.find("{", start) + 1
    arms: list[tuple[str, str]] = []
    while i < len(src):
        while i < len(src) and (src[i].isspace() or src[i] == ","):
            i += 1
        if i >= len(src):
            break
        if src.startswith("//", i):
            nl = src.find("\n", i)
            i = nl + 1 if nl >= 0 else len(src)
            continue
        if src.startswith("_ =>", i):
            break
        m = re.match(r'"([^"]+)"\s*=>\s*\{', src[i:])
        if not m:
            break
        name = m.group(1)
        body_start = i + m.end() - 1
        depth = 0
        j = body_start
        while j < len(src):
            if src[j] == "{":
                depth += 1
            elif src[j] == "}":
                depth -= 1
                if depth == 0:
                    arms.append((name, src[body_start + 1 : j].strip()))
                    i = j + 1
                    break
            j += 1
        else:
            break
    return arms


def transform_arm(arm: str) -> str:
    arm = arm.replace("tauri::async_runtime::block_on", "runtime.block_on")
    arm = re.sub(r"app_handle\.clone\(\)", "None", arm)

    bindings: dict[str, str] = {}
    for m in re.finditer(
        r"let (\w+) = app_handle\.state::<([^>]+(?:<[^>]+>)?)>\(\);",
        arm,
    ):
        var, ty = m.group(1), m.group(2).strip()
        bindings[var] = f"&ctx.{TYPE_TO_CTX[ty]}"

    arm = re.sub(
        r"\s*let \w+ = app_handle\.state::<[^>]+(?:<[^>]+>)?>\(\);\n",
        "",
        arm,
    )
    arm = re.sub(r"command::([a-z_]+)::([a-z_0-9]+)\(", r"command::\1::\2_svc(", arm)
    for var, ctx_ref in bindings.items():
        arm = re.sub(rf"\b{var}\b", ctx_ref, arm)

    arm = arm.replace(
        "get_api_schema_content_svc(parsed, None)?",
        "get_api_schema_content_svc(parsed, &schemas_dir)?",
    )
    arm = arm.replace(
        "download_api_schema_svc(parsed, None)",
        "download_api_schema_svc(parsed, &schemas_dir)",
    )
    return arm


def main() -> None:
    src = Path("src/cli/mod.rs").read_text(encoding="utf-8")
    fn_start = src.find("fn dispatch_command(")
    if fn_start < 0:
        raise SystemExit("dispatch_command not found")
    arms = extract_arms(src[fn_start:])
    lines = []
    for name, body in arms:
        if name in GUI_ONLY:
            lines.append(
                f'        "{name}" => Err("gui_only: `{name}` requires the Watchtower GUI.".to_string()),'
            )
            continue
        body = transform_arm(body)
        lines.append(f'        "{name}" => {{\n            {body}\n        }}')

    out = f"""use crate::command;
use crate::runtime::{{AppContext, CliRuntime}};
use serde_json::Value;
use std::path::PathBuf;

pub fn dispatch_headless(
    cmd_name: &str,
    payload: Value,
    ctx: &AppContext,
    runtime: &CliRuntime,
) -> Result<Value, String> {{
    let schemas_dir: PathBuf = ctx.app_data_dir.join("schemas");
    match cmd_name {{
{chr(10).join(lines)}
        _ => Err(format!("Unknown command: {{cmd_name}}. Run `watchtower cli list`.")),
    }}
}}
"""
    Path("src/cli/dispatch_headless.rs").write_text(out, encoding="utf-8")
    print(f"wrote dispatch_headless.rs ({len(arms)} arms)")


if __name__ == "__main__":
    main()
