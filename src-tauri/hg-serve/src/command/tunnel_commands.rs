use crate::model::api_response::ApiResponse;
use crate::service::tunnel_service::TunnelService;
use std::sync::Arc;

pub const GET_TAILSCALE_IP_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_tailscale_ip",
    description: "Tailscale VPN을 통해 할당된 로컬 IP를 조회합니다.",
    payload_example: "{}",
    category: "mobile",
    gui_only: false,
};

pub fn get_tailscale_ip_svc(
    tunnel_service: &Arc<TunnelService>,
) -> Result<ApiResponse<Option<String>>, String> {
    let ip = tunnel_service.get_tailscale_ip();
    Ok(ApiResponse {
        message: "OK".to_string(),
        success: true,
        data: ip,
    })
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct RemoteAccessHosts {
    pub tailscale_ip: Option<String>,
    pub lan_ips: Vec<String>,
    pub allow_remote_access: bool,
    pub setup_port: u16,
}

pub const GET_REMOTE_ACCESS_HOSTS_CLI_INFO: crate::cli::CliCommandInfo = crate::cli::CliCommandInfo {
    name: "get_remote_access_hosts",
    description: "LAN 주소와 선택적 Tailscale 주소를 조회합니다. 다른 기기 접속은 기본으로 꺼져 있습니다.",
    payload_example: "{}",
    category: "mobile",
    gui_only: false,
};

pub fn get_remote_access_hosts_svc(
    tunnel_service: &Arc<TunnelService>,
    proxy_settings: &Arc<crate::service::proxy_settings_service::ProxySettingsService>,
) -> Result<ApiResponse<RemoteAccessHosts>, String> {
    let hosts = tunnel_service.remote_hosts();
    let settings = proxy_settings.get();
    Ok(ApiResponse {
        message: "OK".to_string(),
        success: true,
        data: RemoteAccessHosts {
            tailscale_ip: hosts.tailscale_ip,
            lan_ips: hosts.lan_ips,
            allow_remote_access: settings.allow_remote_access,
            setup_port: crate::service::tunnel_service::SETUP_SERVER_PORT,
        },
    })
}

pub const START_CLOUDFLARE_TUNNEL_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "start_cloudflare_tunnel",
        description: "Cloudflare 터널을 시작하고 표준 툰널 URL을 반환합니다.",
        payload_example: "{}",
        category: "mobile",
        gui_only: false,
    };

pub async fn start_cloudflare_tunnel_svc(
    tunnel_service: &Arc<TunnelService>,
) -> Result<ApiResponse<String>, String> {
    match tunnel_service.start_tunnel().await {
        Ok(url) => Ok(ApiResponse {
            message: "Tunnel started successfully".to_string(),
            success: true,
            data: url,
        }),
        Err(e) => Err(e),
    }
}

pub const STOP_CLOUDFLARE_TUNNEL_CLI_INFO: crate::cli::CliCommandInfo =
    crate::cli::CliCommandInfo {
        name: "stop_cloudflare_tunnel",
        description: "실행 중인 Cloudflare 터널을 중지합니다.",
        payload_example: "{}",
        category: "mobile",
        gui_only: false,
    };

pub async fn stop_cloudflare_tunnel_svc(
    tunnel_service: &Arc<TunnelService>,
) -> Result<ApiResponse<()>, String> {
    match tunnel_service.stop_tunnel().await {
        Ok(()) => Ok(ApiResponse {
            message: "Tunnel stopped successfully".to_string(),
            success: true,
            data: (),
        }),
        Err(e) => Err(e),
    }
}
