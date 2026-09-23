use crate::model::api_response::ApiResponse;
use crate::model::local_route::LocalRoute;
use crate::model::proxy_settings::ProxySettings;
use crate::service::api_log_service::ApiLogService;
use crate::service::api_logging_settings_service::ApiLoggingSettingsService;
use crate::service::ca_service::CaService;
use crate::service::domain_service::DomainService;
use crate::service::local_proxy;
use crate::service::local_route_service::LocalRouteService;
use crate::service::proxy_settings_service::ProxySettingsService;
use crate::service::system_proxy_service::SystemProxyService;
use std::fmt::Write;
use std::io;
use std::sync::atomic::{AtomicU16, Ordering};

fn emit_proxy_status(_app: Option<&()>, payload: &ProxyStatusPayload) {
    crate::serve::events::publish_event(PROXY_STATUS_CHANGED, payload);
}

/// Build a `ProxyStatusPayload` from the current global state. Public for use in setup hook.
pub fn get_proxy_status_payload() -> ProxyStatusPayload {
    current_proxy_status()
}

/// Helper: build a `ProxyStatusPayload` from the current global state.
fn current_proxy_status() -> ProxyStatusPayload {
    let port = PROXY_PORT.load(Ordering::Relaxed);
    let rh = PROXY_REVERSE_HTTP.load(Ordering::Relaxed);
    let rht = PROXY_REVERSE_HTTPS.load(Ordering::Relaxed);

    if port != 0 {
        return ProxyStatusPayload {
            running: true,
            port,
            reverse_http_port: if rh != 0 { Some(rh) } else { None },
            reverse_https_port: if rht != 0 { Some(rht) } else { None },
        };
    }

    if let Some(active) =
        crate::service::proxy_runtime_state::ProxyRuntimeStateService::load_active_state()
    {
        return ProxyStatusPayload {
            running: true,
            port: active.port,
            reverse_http_port: active.reverse_http_port,
            reverse_https_port: active.reverse_https_port,
        };
    }

    ProxyStatusPayload {
        running: false,
        port: 0,
        reverse_http_port: None,
        reverse_https_port: None,
    }
}

fn is_addr_in_use(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::AddrInUse || matches!(e.raw_os_error(), Some(10048 | 98 | 48))
}

/// Turns a bind/listen error into a user-friendly message (e.g. port already in use).
fn map_bind_error(port: u16, e: io::Error) -> String {
    if is_addr_in_use(&e) {
        return format!(
            "Port {port} is already in use. A leftover horizon-gateway-serve process may still be holding it. Stop that process or choose a different port in settings."
        );
    }
    format!("Failed to bind port {port}: {e}")
}

fn already_running_ok(app: Option<()>) -> ApiResponse<ProxyStatusPayload> {
    let payload = current_proxy_status();
    emit_proxy_status(app.as_ref(), &payload);
    ApiResponse {
        message: "Proxy already running".to_string(),
        success: true,
        data: payload,
    }
}

fn this_process_has_proxy_listener() -> bool {
    if PROXY_PORT.load(Ordering::Relaxed) != 0 {
        return true;
    }
    PROXY_HANDLES.lock().map(|g| !g.is_empty()).unwrap_or(false)
}

/// Auto-start may own the listener while `PROXY_PORT` is not stored yet.
async fn in_process_proxy_became_ready() -> bool {
    for _ in 0..20 {
        if this_process_has_proxy_listener() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    this_process_has_proxy_listener()
}

/// Abort all proxy tasks so bound ports are released. Call when start fails partway.
fn abort_proxy_handles(handles: &mut Vec<tokio::task::JoinHandle<()>>) {
    for h in handles.drain(..) {
        h.abort();
    }
}

pub const GET_LOCAL_ROUTES_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_local_routes",
    description: "로컬 라우팅(리다이렉트) 규칙 목록을 조회합니다.",
    payload_example: "{}",
    category: "routing",
    gui_only: false,
};

pub fn get_local_routes_svc(
    route_service: &std::sync::Arc<LocalRouteService>,
) -> Result<ApiResponse<Vec<LocalRoute>>, String> {
    let list = route_service.get_all();
    Ok(ApiResponse {
        message: format!("{} routes", list.len()),
        success: true,
        data: list,
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AddLocalRoutePayload {
    pub domain_id: u32,
    pub target_host: String,
    pub target_port: u16,
}

pub const ADD_LOCAL_ROUTE_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "add_local_route",
    description: "새로운 로컬 라우팅 규칙을 추가합니다.",
    payload_example: r#"{"domainId": 1, "targetHost": "localhost", "targetPort": 3000}"#,
    category: "routing",
    gui_only: false,
};

pub fn add_local_route_svc(
    payload: AddLocalRoutePayload,
    route_service: &std::sync::Arc<LocalRouteService>,
    domain_service: &DomainService,
) -> Result<ApiResponse<LocalRoute>, String> {
    let domains = domain_service.get_all();
    match route_service.add(
        payload.domain_id,
        &domains,
        payload.target_host,
        payload.target_port,
    ) {
        Ok(route) => Ok(ApiResponse {
            message: "Route added".to_string(),
            success: true,
            data: route,
        }),
        Err(message) => Ok(ApiResponse {
            message,
            success: false,
            data: LocalRoute {
                id: 0,
                domain_id: payload.domain_id,
                domain: String::new(),
                target_host: String::new(),
                target_port: 0,
                enabled: false,
            },
        }),
    }
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLocalRoutePayload {
    #[serde(default)]
    pub id: Option<u32>,
    #[serde(default)]
    pub ids: Option<Vec<u32>>,
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
    pub enabled: Option<bool>,
}

pub const UPDATE_LOCAL_ROUTE_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "update_local_route",
    description: "로컬 라우팅 규칙을 수정합니다.",
    payload_example: r#"{"id": 1, "targetHost": "localhost", "targetPort": 3000}"#,
    category: "routing",
    gui_only: false,
};

pub fn update_local_route_svc(
    payload: UpdateLocalRoutePayload,
    route_service: &std::sync::Arc<LocalRouteService>,
    domain_service: &DomainService,
) -> Result<ApiResponse<Option<LocalRoute>>, String> {
    let domains = domain_service.get_all();
    let ids: Vec<u32> = if let Some(ids) = payload.ids {
        ids
    } else if let Some(id) = payload.id {
        vec![id]
    } else {
        Vec::new()
    };
    let updated = route_service.update_bulk(
        &ids,
        &domains,
        payload.target_host,
        payload.target_port,
        payload.enabled,
    )?;
    Ok(ApiResponse {
        message: if !updated.is_empty() {
            "Route(s) updated"
        } else {
            "Route(s) not found"
        }
        .to_string(),
        success: !updated.is_empty(),
        data: updated.into_iter().next(),
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoveLocalRoutePayload {
    pub id: u32,
}

pub const REMOVE_LOCAL_ROUTE_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "remove_local_route",
    description: "로컬 라우팅 규칙을 삭제합니다.",
    payload_example: r#"{"id": 1}"#,
    category: "routing",
    gui_only: false,
};

pub fn remove_local_route_svc(
    payload: RemoveLocalRoutePayload,
    route_service: &std::sync::Arc<LocalRouteService>,
) -> Result<ApiResponse<Option<LocalRoute>>, String> {
    let route = route_service.remove(payload.id);
    Ok(ApiResponse {
        message: if route.is_some() {
            "Route removed"
        } else {
            "Route not found"
        }
        .to_string(),
        success: true,
        data: route,
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetLocalRouteEnabledPayload {
    pub id: u32,
    pub enabled: bool,
}

pub const SET_LOCAL_ROUTE_ENABLED_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "set_local_route_enabled",
        description: "로컬 라우팅 규칙 활성화 여부를 설정합니다.",
        payload_example: r#"{"id": 1, "enabled": true}"#,
        category: "routing",
        gui_only: false,
    };

pub fn set_local_route_enabled_svc(
    payload: SetLocalRouteEnabledPayload,
    route_service: &std::sync::Arc<LocalRouteService>,
    domain_service: &DomainService,
) -> Result<ApiResponse<Option<LocalRoute>>, String> {
    let domains = domain_service.get_all();
    let route = route_service.set_enabled(payload.id, payload.enabled, &domains)?;
    Ok(ApiResponse {
        message: if route.is_some() {
            "Route updated"
        } else {
            "Route not found"
        }
        .to_string(),
        success: route.is_some(),
        data: route,
    })
}

/// Last auto-start error (persisted until proxy starts successfully or cleared).
static PROXY_AUTO_START_ERR: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Store auto-start error for FE to query.
pub fn set_auto_start_error(err: Option<String>) {
    if let Ok(mut guard) = PROXY_AUTO_START_ERR.lock() {
        *guard = err;
    }
}

/// Current proxy port when running; 0 when stopped.
static PROXY_PORT: AtomicU16 = AtomicU16::new(0);

/// Get currently running proxy port (0 if stopped).
pub fn get_proxy_port() -> u16 {
    PROXY_PORT.load(Ordering::Relaxed)
}

/// Reverse HTTP port when running; 0 when not used.
static PROXY_REVERSE_HTTP: AtomicU16 = AtomicU16::new(0);
/// Reverse HTTPS port when running; 0 when not used.
static PROXY_REVERSE_HTTPS: AtomicU16 = AtomicU16::new(0);
static PROXY_HANDLES: std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>> =
    std::sync::Mutex::new(Vec::new());

pub const GET_PROXY_AUTO_START_ERROR_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "get_proxy_auto_start_error",
        description: "프록시 자동 시작 실패 에러 메시지를 조회합니다. 정상이면 null을 반환합니다.",
        payload_example: "{}",
        category: "proxy",
        gui_only: false,
    };

/// Returns the auto-start error if proxy failed to start on launch, or null if OK.

pub fn get_proxy_auto_start_error_svc() -> Result<ApiResponse<Option<String>>, String> {
    let err = PROXY_AUTO_START_ERR
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    Ok(ApiResponse {
        message: if err.is_some() {
            "Auto-start failed"
        } else {
            "OK"
        }
        .to_string(),
        success: true,
        data: err,
    })
}

pub const GET_PROXY_STATUS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_proxy_status",
    description: "프록시 서버의 현재 상태를 조회합니다.",
    payload_example: "{}",
    category: "proxy",
    gui_only: false,
};

pub async fn get_proxy_status_svc() -> Result<ApiResponse<ProxyStatusPayload>, String> {
    let status = current_proxy_status();
    Ok(ApiResponse {
        message: if status.running {
            "Proxy running"
        } else {
            "Proxy stopped"
        }
        .to_string(),
        success: true,
        data: status,
    })
}

#[derive(serde::Serialize, specta::Type)]
pub struct ProxyStatusPayload {
    pub running: bool,
    pub port: u16,
    /// Reverse HTTP listener port (no system proxy; use hosts + this port).
    pub reverse_http_port: Option<u16>,
    /// Reverse HTTPS listener port (TLS by Host).
    pub reverse_https_port: Option<u16>,
}

pub const PROXY_STATUS_CHANGED: &str = "proxy-status-changed";
pub const PROXY_AUTO_START_ERROR: &str = "proxy-auto-start-error";

pub const GET_PROXY_SETTINGS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_proxy_settings",
    description: "프록시 서버 설정(포트, DNS, 리버스 포트 등)을 조회합니다.",
    payload_example: "{}",
    category: "proxy",
    gui_only: false,
};

pub fn get_proxy_settings_svc(
    proxy_settings_service: &ProxySettingsService,
) -> Result<ApiResponse<ProxySettings>, String> {
    let settings = proxy_settings_service.get();
    Ok(ApiResponse {
        message: "OK".to_string(),
        success: true,
        data: settings,
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetProxyDnsServerPayload {
    pub dns_server: Option<String>,
}

pub const SET_PROXY_DNS_SERVER_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "set_proxy_dns_server",
    description: "프록시가 사용할 사용자 지정 DNS 서버를 설정합니다.",
    payload_example: r#"{"dnsServer": "8.8.8.8"}"#,
    category: "proxy",
    gui_only: false,
};

pub fn set_proxy_dns_server_svc(
    payload: SetProxyDnsServerPayload,
    proxy_settings_service: &ProxySettingsService,
) -> Result<ApiResponse<ProxySettings>, String> {
    let settings = proxy_settings_service.set_dns_server(payload.dns_server);
    Ok(ApiResponse {
        message: "DNS server updated".to_string(),
        success: true,
        data: settings,
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetProxyPortPayload {
    pub port: u16,
}

pub const SET_PROXY_PORT_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "set_proxy_port",
    description: "프록시 서버가 사용할 포트를 설정합니다.",
    payload_example: r#"{"port": 8080}"#,
    category: "proxy",
    gui_only: false,
};

pub fn set_proxy_port_svc(
    payload: SetProxyPortPayload,
    proxy_settings_service: &ProxySettingsService,
) -> Result<ApiResponse<ProxySettings>, String> {
    let settings = proxy_settings_service.set_proxy_port(payload.port);
    Ok(ApiResponse {
        message: format!("Proxy port set to {}", settings.proxy_port),
        success: true,
        data: settings,
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StartLocalProxyPayload {
    pub port: Option<u16>,
}

pub const START_LOCAL_PROXY_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "start_local_proxy",
    description: "로컬 프록시 서버를 시작합니다.",
    payload_example: r#"{"port": null}"#,
    category: "proxy",
    gui_only: false,
};

pub async fn start_local_proxy_svc(
    app: Option<()>,
    payload: Option<StartLocalProxyPayload>,
    route_service: &std::sync::Arc<LocalRouteService>,
    proxy_settings_service: &std::sync::Arc<ProxySettingsService>,
    api_logging_service: &ApiLoggingSettingsService,
    api_log_service: &ApiLogService,
    ca_service: &std::sync::Arc<CaService>,
    mocking_service: &std::sync::Arc<crate::service::mocking_service::MockingService>,
    inspector_service: &crate::service::inspector_service::InspectorService,
    domain_service: &crate::service::domain_service::DomainService,
) -> Result<ApiResponse<ProxyStatusPayload>, String> {
    let port = payload
        .and_then(|p| p.port)
        .unwrap_or_else(|| proxy_settings_service.get().proxy_port);
    if this_process_has_proxy_listener() {
        return Ok(already_running_ok(app));
    }
    let settings = proxy_settings_service.get();
    let dns_server = settings.dns_server;
    let reverse_http = settings.reverse_http_port.filter(|&p| p > 0);
    let reverse_https = settings.reverse_https_port.filter(|&p| p > 0);

    // Ports must be distinct (each socket address can only be used once).
    let mut used = std::collections::HashSet::from([port]);
    if let Some(rh) = reverse_http {
        if !used.insert(rh) {
            return Err(format!(
                "Reverse HTTP port {rh} is already used by the main proxy port. Use different ports."
            ));
        }
    }
    if let Some(rht) = reverse_https {
        if !used.insert(rht) {
            return Err(format!(
                "Reverse HTTPS port {rht} is already in use (same as proxy or reverse HTTP). Use a different port."
            ));
        }
    }

    let mut handles = Vec::new();
    let api_logging_map = api_logging_service.settings_map_arc();
    let api_log_service_arc = std::sync::Arc::new((*api_log_service).clone());
    let ca_service_arc = (*ca_service).clone();
    let mocking_service_arc = (*mocking_service).clone();
    let inspector_service_arc = (*inspector_service).clone();
    let domain_service_arc = std::sync::Arc::new((*domain_service).clone());

    match local_proxy::run_proxy(
        app.clone(),
        port,
        std::sync::Arc::clone(&*route_service),
        dns_server.clone(),
        api_logging_map.clone(),
        api_log_service_arc.clone(),
        ca_service_arc.clone(),
        mocking_service_arc.clone(),
        std::sync::Arc::new(inspector_service_arc.clone()),
        domain_service_arc.clone(),
        std::sync::Arc::clone(proxy_settings_service),
    )
    .await
    {
        Ok(h0) => handles.push(h0),
        Err(e) if is_addr_in_use(&e) => {
            if in_process_proxy_became_ready().await {
                return Ok(already_running_ok(app));
            }
            return Err(map_bind_error(port, e));
        }
        Err(e) => return Err(map_bind_error(port, e)),
    }

    if let Some(rh) = reverse_http {
        match local_proxy::run_reverse_proxy_http(
            app.clone(),
            rh,
            std::sync::Arc::clone(&*route_service),
            dns_server.clone(),
            Some(port),
            api_logging_map.clone(),
            api_log_service_arc.clone(),
            ca_service_arc.clone(),
            mocking_service_arc.clone(),
            std::sync::Arc::new(inspector_service_arc.clone()),
            domain_service_arc.clone(),
            std::sync::Arc::clone(proxy_settings_service),
        )
        .await
        {
            Ok(h) => {
                handles.push(h);
                PROXY_REVERSE_HTTP.store(rh, Ordering::Relaxed);
            }
            Err(e) => {
                abort_proxy_handles(&mut handles);
                return Err(map_bind_error(rh, e));
            }
        }
    }
    if let Some(rht) = reverse_https {
        match local_proxy::run_reverse_proxy_https(
            app.clone(),
            rht,
            std::sync::Arc::clone(&*route_service),
            dns_server,
            Some(port),
            api_logging_map,
            api_log_service_arc.clone(),
            ca_service_arc,
            mocking_service_arc.clone(),
            std::sync::Arc::new(inspector_service_arc.clone()),
            domain_service_arc.clone(),
            std::sync::Arc::clone(proxy_settings_service),
        )
        .await
        {
            Ok(h) => {
                handles.push(h);
                PROXY_REVERSE_HTTPS.store(rht, Ordering::Relaxed);
            }
            Err(e) => {
                abort_proxy_handles(&mut handles);
                return Err(map_bind_error(rht, e));
            }
        }
    }

    PROXY_PORT.store(port, Ordering::Relaxed);
    crate::service::proxy_runtime_state::ProxyRuntimeStateService::save_state(
        port,
        reverse_http,
        reverse_https,
    );
    set_auto_start_error(None); // clear any previous error
    let mut guard = PROXY_HANDLES.lock().map_err(|e| e.to_string())?;
    *guard = handles;

    // Set system PAC URL
    let pac_url = format!("http://127.0.0.1:{port}/.horizon-gateway/proxy.pac");
    if let Err(e) = SystemProxyService::set_pac_url(&pac_url) {
        eprintln!("Failed to set system proxy: {e}");
    }

    let payload = ProxyStatusPayload {
        running: true,
        port,
        reverse_http_port: reverse_http,
        reverse_https_port: reverse_https,
    };
    let _ = emit_proxy_status(app.as_ref(), &payload);
    let mut msg = format!("Proxy started on 127.0.0.1:{port}");
    if let Some(p) = reverse_http {
        let _ = write!(&mut msg, ", reverse HTTP :{p}");
    }
    if let Some(p) = reverse_https {
        let _ = write!(&mut msg, ", reverse HTTPS :{p}");
    }
    Ok(ApiResponse {
        message: msg,
        success: true,
        data: payload,
    })
}

pub const GET_PROXY_SETUP_URL_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_proxy_setup_url",
    description: "프록시가 실행 중일 때 셋업 페이지 URL을 반환합니다.",
    payload_example: "{}",
    category: "proxy",
    gui_only: false,
};

/// Returns the setup page URL when proxy is running and a reverse port is configured.
/// Frontend can open this URL in the browser (e.g. via opener plugin).

pub fn get_proxy_setup_url_svc() -> Result<ApiResponse<String>, String> {
    let port = PROXY_PORT.load(Ordering::Relaxed);
    if port == 0 {
        return Err("Proxy is not running".to_string());
    }
    let rh = PROXY_REVERSE_HTTP.load(Ordering::Relaxed);
    let rht = PROXY_REVERSE_HTTPS.load(Ordering::Relaxed);
    let url = if rh != 0 {
        format!("http://127.0.0.1:{rh}/.horizon-gateway/setup")
    } else if rht != 0 {
        format!("https://127.0.0.1:{rht}/.horizon-gateway/setup")
    } else {
        return Err(
            "No reverse port configured. Set reverse HTTP or HTTPS port and start the proxy."
                .to_string(),
        );
    };
    Ok(ApiResponse {
        message: "OK".to_string(),
        success: true,
        data: url,
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetProxyReversePortsPayload {
    pub reverse_http_port: Option<u16>,
    pub reverse_https_port: Option<u16>,
}

pub const SET_PROXY_REVERSE_PORTS_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "set_proxy_reverse_ports",
        description: "리버스 HTTP/HTTPS 포트를 설정합니다. 다음 프록시 시작시에 적용됩니다.",
        payload_example: r#"{"reverseHttpPort": 8081, "reverseHttpsPort": 8443}"#,
        category: "proxy",
        gui_only: false,
    };

pub fn set_proxy_reverse_ports_svc(
    payload: SetProxyReversePortsPayload,
    proxy_settings_service: &ProxySettingsService,
) -> Result<ApiResponse<ProxySettings>, String> {
    let settings = proxy_settings_service
        .set_reverse_ports(payload.reverse_http_port, payload.reverse_https_port);
    Ok(ApiResponse {
        message: "Reverse ports updated (apply on next proxy start)".to_string(),
        success: true,
        data: settings,
    })
}

pub const STOP_LOCAL_PROXY_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "stop_local_proxy",
    description: "실행 중인 로컬 프록시 서버를 중지합니다.",
    payload_example: "{}",
    category: "proxy",
    gui_only: false,
};

pub fn stop_local_proxy_svc(app: Option<()>) -> Result<ApiResponse<ProxyStatusPayload>, String> {
    let mut guard = PROXY_HANDLES.lock().map_err(|e| e.to_string())?;
    for h in guard.drain(..) {
        h.abort();
    }

    // Clear system PAC URL
    let _ = SystemProxyService::clear_pac_url();
    crate::service::proxy_runtime_state::ProxyRuntimeStateService::clear_state();

    let _ = PROXY_PORT.swap(0, Ordering::Relaxed);
    let _ = PROXY_REVERSE_HTTP.swap(0, Ordering::Relaxed);
    let _ = PROXY_REVERSE_HTTPS.swap(0, Ordering::Relaxed);
    let payload = ProxyStatusPayload {
        running: false,
        port: 0,
        reverse_http_port: None,
        reverse_https_port: None,
    };
    emit_proxy_status(app.as_ref(), &payload);
    Ok(ApiResponse {
        message: "Proxy stopped".to_string(),
        success: true,
        data: payload,
    })
}

// ── Engine options (CORS, TLS bypass, timeouts) ──────────────

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProxySettingsPayload {
    pub cors_rewrite_enabled: Option<bool>,
    pub tls_bypass_hosts: Option<Vec<String>>,
    pub https_decrypt_hosts: Option<Vec<String>>,
    pub connect_timeout_secs: Option<u64>,
    pub upstream_timeout_secs: Option<u64>,
    pub log_retention_days: Option<u32>,
}

pub const UPDATE_PROXY_SETTINGS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "update_proxy_settings",
    description:
        "프록시 엔진 옵션(CORS, TLS 우회, 타임아웃, 로그 보관 기간)을 부분 업데이트합니다.",
    payload_example: r#"{"corsRewriteEnabled": true, "logRetentionDays": 14}"#,
    category: "proxy",
    gui_only: false,
};

pub fn update_proxy_settings_svc(
    payload: UpdateProxySettingsPayload,
    proxy_settings_service: &ProxySettingsService,
) -> Result<ApiResponse<ProxySettings>, String> {
    let settings = proxy_settings_service.patch(
        payload.cors_rewrite_enabled,
        payload.tls_bypass_hosts,
        payload.https_decrypt_hosts,
        payload.connect_timeout_secs,
        payload.upstream_timeout_secs,
        payload.log_retention_days,
    );
    Ok(ApiResponse {
        message: "Proxy settings updated".to_string(),
        success: true,
        data: settings,
    })
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SetHttpsDecryptHostPayload {
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub hosts: Option<Vec<String>>,
    pub enabled: bool,
}

pub const SET_HTTPS_DECRYPT_HOST_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "set_https_decrypt_host",
        description: "호스트 HTTPS 복호화 여부를 설정합니다 (단일 host 또는 hosts 배열).",
        payload_example: r#"{"host": "api.example.com", "enabled": true}"#,
        category: "proxy",
        gui_only: false,
    };

pub fn set_https_decrypt_host_svc(
    payload: SetHttpsDecryptHostPayload,
    proxy_settings_service: &ProxySettingsService,
) -> Result<ApiResponse<ProxySettings>, String> {
    let hosts: Vec<String> = if let Some(hosts) = payload.hosts {
        hosts
    } else if let Some(host) = payload.host {
        vec![host]
    } else {
        Vec::new()
    };
    let settings = proxy_settings_service.set_https_decrypt_hosts(&hosts, payload.enabled);
    Ok(ApiResponse {
        message: format!(
            "HTTPS decrypt {} for {} host(s)",
            if payload.enabled {
                "enabled"
            } else {
                "disabled"
            },
            hosts.len()
        ),
        success: true,
        data: settings,
    })
}

// ── Auto-start (called from setup hook) ────────────────────────────────

/// Start the proxy using persisted settings. Designed to be called once from the Tauri setup hook.
#[allow(clippy::too_many_arguments)]
pub async fn auto_start_proxy(
    app_handle: Option<()>,
    route_service: std::sync::Arc<LocalRouteService>,
    settings: &ProxySettings,
    api_logging_map: std::sync::Arc<
        std::sync::RwLock<std::collections::HashMap<String, (bool, bool)>>,
    >,
    api_log_service: std::sync::Arc<ApiLogService>,
    ca_service: std::sync::Arc<CaService>,
    mocking_service: std::sync::Arc<crate::service::mocking_service::MockingService>,
    inspector_service: crate::service::inspector_service::InspectorService,
    domain_service: std::sync::Arc<crate::service::domain_service::DomainService>,
    proxy_settings_service: std::sync::Arc<ProxySettingsService>,
) -> Result<(), String> {
    if this_process_has_proxy_listener() {
        return Ok(()); // already running
    }

    let port = settings.proxy_port;
    let dns_server = settings.dns_server.clone();
    let reverse_http = settings.reverse_http_port.filter(|&p| p > 0);
    let reverse_https = settings.reverse_https_port.filter(|&p| p > 0);

    let mut used = std::collections::HashSet::from([port]);
    if let Some(rh) = reverse_http {
        if !used.insert(rh) {
            return Err(format!(
                "Reverse HTTP port {rh} conflicts with main proxy port"
            ));
        }
    }
    if let Some(rht) = reverse_https {
        if !used.insert(rht) {
            return Err(format!("Reverse HTTPS port {rht} conflicts"));
        }
    }

    let mut handles = Vec::new();
    match local_proxy::run_proxy(
        app_handle.clone(),
        port,
        std::sync::Arc::clone(&route_service),
        dns_server.clone(),
        api_logging_map.clone(),
        api_log_service.clone(),
        ca_service.clone(),
        mocking_service.clone(),
        std::sync::Arc::new(inspector_service.clone()),
        domain_service.clone(),
        std::sync::Arc::clone(&proxy_settings_service),
    )
    .await
    {
        Ok(h) => handles.push(h),
        Err(e) => return Err(format!("Failed to bind proxy port {port}: {e}")),
    }

    if let Some(rh) = reverse_http {
        match local_proxy::run_reverse_proxy_http(
            app_handle.clone(),
            rh,
            std::sync::Arc::clone(&route_service),
            dns_server.clone(),
            Some(port),
            api_logging_map.clone(),
            api_log_service.clone(),
            ca_service.clone(),
            mocking_service.clone(),
            std::sync::Arc::new(inspector_service.clone()),
            domain_service.clone(),
            std::sync::Arc::clone(&proxy_settings_service),
        )
        .await
        {
            Ok(h) => {
                handles.push(h);
                PROXY_REVERSE_HTTP.store(rh, Ordering::Relaxed);
            }
            Err(e) => {
                abort_proxy_handles(&mut handles);
                return Err(format!("Failed to bind reverse HTTP port {rh}: {e}"));
            }
        }
    }
    if let Some(rht) = reverse_https {
        match local_proxy::run_reverse_proxy_https(
            app_handle.clone(),
            rht,
            std::sync::Arc::clone(&route_service),
            dns_server,
            Some(port),
            api_logging_map,
            api_log_service.clone(),
            ca_service,
            mocking_service.clone(),
            std::sync::Arc::new(inspector_service.clone()),
            domain_service,
            std::sync::Arc::clone(&proxy_settings_service),
        )
        .await
        {
            Ok(h) => {
                handles.push(h);
                PROXY_REVERSE_HTTPS.store(rht, Ordering::Relaxed);
            }
            Err(e) => {
                abort_proxy_handles(&mut handles);
                return Err(format!("Failed to bind reverse HTTPS port {rht}: {e}"));
            }
        }
    }

    PROXY_PORT.store(port, Ordering::Relaxed);
    crate::service::proxy_runtime_state::ProxyRuntimeStateService::save_state(
        port,
        reverse_http,
        reverse_https,
    );
    let mut guard = PROXY_HANDLES.lock().map_err(|e| e.to_string())?;
    *guard = handles;

    // Set system PAC URL
    let pac_url = format!("http://127.0.0.1:{port}/.horizon-gateway/proxy.pac");
    if let Err(e) = SystemProxyService::set_pac_url(&pac_url) {
        tracing::warn!("[auto-start] Failed to set system proxy: {e}");
    }

    emit_proxy_status(app_handle.as_ref(), &current_proxy_status());

    let mut msg = format!("[auto-start] Proxy on 127.0.0.1:{port}");
    if let Some(p) = reverse_http {
        let _ = write!(&mut msg, ", reverse HTTP :{p}");
    }
    if let Some(p) = reverse_https {
        let _ = write!(&mut msg, ", reverse HTTPS :{p}");
    }
    eprintln!("{msg}");
    Ok(())
}

#[cfg(test)]
mod bind_error_tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    #[test]
    fn addr_in_use_kind_is_detected() {
        let e = Error::from(ErrorKind::AddrInUse);
        assert!(is_addr_in_use(&e));
        let msg = map_bind_error(8888, e);
        assert!(msg.contains("8888"));
        assert!(msg.contains("horizon-gateway-serve"));
    }

    #[test]
    fn windows_wsaeaddrinuse_is_detected() {
        let e = Error::from_raw_os_error(10048);
        assert!(is_addr_in_use(&e));
    }

    #[test]
    fn other_bind_errors_keep_generic_copy() {
        let e = Error::from(ErrorKind::PermissionDenied);
        let msg = map_bind_error(8888, e);
        assert!(msg.contains("Failed to bind port 8888"));
        assert!(!msg.contains("already in use"));
    }
}
