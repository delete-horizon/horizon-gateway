use std::io::{BufRead, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;

use hg_core::{serve_token_matches, ServeRequest, ServeResponse, SERVE_TCP_ADDR};

use crate::cli;
use crate::runtime::{bootstrap_app_context, AppContext, CliRuntime};

/// Blocking entry for the `horizon-gateway-serve` binary.
pub fn run_serve() -> i32 {
    crate::install_rustls_provider();
    super::logging::init_serve_logging();

    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            tracing::error!("failed to start async runtime: {e}");
            return 1;
        }
    };

    match serve_loop(rt) {
        Ok(()) => 0,
        Err(e) => {
            tracing::error!("serve exited with error: {e}");
            1
        }
    }
}

/// Env var that selects headless process mode. Desktop sidecar spawn does not set this.
const HG_SERVE_HEADLESS_ENV: &str = "HG_SERVE_HEADLESS";

/// Desktop `serve_loop` calls `tray::start()` (GUI spawn lives only there).
/// `HG_SERVE_HEADLESS=1` is the only value that skips that branch.
fn tray_branch_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("1")
}

fn serve_loop(rt: tokio::runtime::Runtime) -> Result<(), String> {
    let rt = Arc::new(rt);
    let ctx = Arc::new(bootstrap_app_context()?);

    ctx.inspector_service
        .sync_registered_domains(&ctx.domain_service.get_all());
    crate::service::transparent_proxy_service::TransparentProxyService::ensure_runtime_sidecars();

    let route_svc = Arc::clone(&ctx.local_route_service);
    let proxy_settings_service = Arc::clone(&ctx.proxy_settings_service);
    let proxy_settings_snapshot = proxy_settings_service.get();
    let api_logging_map = ctx.api_logging_service.settings_map_arc();
    let api_log_service = Arc::new(ctx.api_log_service.clone());
    let ca_service = Arc::clone(&ctx.ca_service);
    let mocking_service = Arc::clone(&ctx.mocking_service);
    let inspector_service = ctx.inspector_service.clone();
    let domain_service = Arc::new(ctx.domain_service.clone());

    let token: Arc<str> = super::auth::generate_token().into();

    let event_bus = super::events::ServeEventBus::new();
    super::events::ServeEventBus::init_global(Arc::clone(&event_bus));
    super::events::start_event_listener(event_bus, Arc::clone(&token))?;

    let listener = TcpListener::bind(SERVE_TCP_ADDR)
        .map_err(|e| format!("failed to bind serve socket {SERVE_TCP_ADDR}: {e}"))?;

    // Publish only after both sockets are ours, so a second instance never replaces the token.
    super::auth::publish_token(&token)?;
    tracing::info!("[serve] listening on {SERVE_TCP_ADDR}");

    rt.spawn(async move {
        if let Err(e) = crate::command::local_route_commands::auto_start_proxy(
            None,
            route_svc,
            &proxy_settings_snapshot,
            api_logging_map,
            api_log_service,
            ca_service,
            mocking_service,
            inspector_service,
            domain_service,
            proxy_settings_service,
        )
        .await
        {
            tracing::warn!("[serve] auto-start proxy failed: {e}");
        }
    });

    // Background domain monitor task
    {
        let ctx_clone = Arc::clone(&ctx);
        rt.spawn(async move {
            loop {
                let _ = ctx_clone
                    .monitor_service
                    .check_domains(
                        &ctx_clone.domain_service,
                        &ctx_clone.group_service,
                        &ctx_clone.link_service,
                        &ctx_clone.proxy_settings_service,
                    )
                    .await;
                tracing::info!("[serve] background domain status check completed");
                tokio::time::sleep(std::time::Duration::from_secs(120)).await;
            }
        });
    }

    // Annotation watcher task
    {
        let ctx_clone = Arc::clone(&ctx);
        rt.spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                if ctx_clone.inspector_service.reload_if_stale() {
                    tracing::info!("[serve] annotations file changed on disk; reloaded");
                    super::events::publish_event("annotations-updated", ());
                }
            }
        });
    }

    // Tunnel Axum server task
    {
        let ctx_clone = Arc::clone(&ctx);
        rt.spawn(async move {
            let proxy_settings = Arc::clone(&ctx_clone.proxy_settings_service);
            if let Err(e) = ctx_clone
                .tunnel_service
                .start_axum_server(proxy_settings)
                .await
            {
                tracing::error!("[serve] Axum server failed: {e}");
            }
        });
    }

    // `HG_SERVE_HEADLESS=1` (CI / containers): skip `tray::start()`. GUI spawn
    // (`find_gui_exe` / `open_gui`) runs only from the tray. `accept_loop` stays
    // on this thread on every OS so the process remains alive without a display.
    // Unset or any other value keeps the desktop blocks below unchanged.
    if !tray_branch_enabled(std::env::var(HG_SERVE_HEADLESS_ENV).ok().as_deref()) {
        tracing::info!(
            "[serve] headless: tray and GUI spawn skipped; IPC accept loop holds the process"
        );
        accept_loop(listener, ctx, rt, token);
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        let ctx_ipc = Arc::clone(&ctx);
        let rt_ipc = Arc::clone(&rt);
        std::thread::Builder::new()
            .name("serve-ipc".into())
            .spawn(move || accept_loop(listener, ctx_ipc, rt_ipc, token))
            .map_err(|e| format!("failed to start serve IPC thread: {e}"))?;
        // macOS requires the tray event loop on the main thread.
        super::tray::start();
        return Ok(());
    }

    #[cfg(windows)]
    {
        super::tray::start();
        accept_loop(listener, ctx, rt, token);
        return Ok(());
    }
}

fn accept_loop(
    listener: TcpListener,
    ctx: Arc<AppContext>,
    rt: Arc<tokio::runtime::Runtime>,
    token: Arc<str>,
) {
    for stream in listener.incoming() {
        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("[serve] accept failed: {e}");
                continue;
            }
        };
        let ctx = Arc::clone(&ctx);
        let rt = Arc::clone(&rt);
        let token = Arc::clone(&token);
        std::thread::spawn(move || {
            if let Err(e) = handle_client(stream, &ctx, rt.as_ref(), &token) {
                tracing::warn!("[serve] client session error: {e}");
            }
        });
    }
}

fn handle_client(
    stream: TcpStream,
    ctx: &Arc<AppContext>,
    rt: &tokio::runtime::Runtime,
    token: &str,
) -> Result<(), String> {
    let mut reader = std::io::BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut writer = stream;

    let mut line = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("read failed: {e}"))?;
        if n == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let request: ServeRequest = serde_json::from_str(trimmed)
            .map_err(|e| format!("invalid serve request JSON: {e}"))?;

        let authorized = serve_token_matches(token, request.token.as_deref());
        let response = if authorized {
            dispatch_serve_request(&request, ctx, rt)
        } else {
            ServeResponse::failure(request.id.clone(), UNAUTHORIZED)
        };
        let mut out =
            serde_json::to_string(&response).map_err(|e| format!("encode response: {e}"))?;
        out.push('\n');
        writer
            .write_all(out.as_bytes())
            .map_err(|e| format!("write failed: {e}"))?;
        writer.flush().map_err(|e| format!("flush failed: {e}"))?;
        if !authorized {
            return Err(format!(
                "rejected command `{}`: {UNAUTHORIZED}",
                request.command
            ));
        }
    }

    Ok(())
}

const UNAUTHORIZED: &str = "unauthorized: missing or invalid serve token";

fn dispatch_serve_request(
    request: &ServeRequest,
    ctx: &AppContext,
    rt: &tokio::runtime::Runtime,
) -> ServeResponse {
    if request.command == "ping" {
        return ServeResponse::success(
            request.id.clone(),
            serde_json::json!({
                "mode": "serve",
                "ok": true,
                "version": env!("CARGO_PKG_VERSION"),
            }),
        );
    }

    if request.command == "shutdown_serve" {
        // Reply first so the GUI can observe success, then exit this elevated process.
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            super::tray::quit_serve();
        });
        return ServeResponse::success(
            request.id.clone(),
            serde_json::json!({ "ok": true, "stopping": true }),
        );
    }

    let runtime = CliRuntime::Tokio(rt);
    match cli::dispatch_headless::dispatch_headless(
        &request.command,
        request.payload.clone(),
        ctx,
        &runtime,
    ) {
        Ok(data) => ServeResponse::success(request.id.clone(), data),
        Err(err) => ServeResponse::failure(request.id.clone(), err),
    }
}

#[cfg(test)]
mod tests {
    use super::{tray_branch_enabled, HG_SERVE_HEADLESS_ENV};

    #[test]
    fn headless_flag_skips_tray_branch() {
        assert_eq!(HG_SERVE_HEADLESS_ENV, "HG_SERVE_HEADLESS");
        assert!(
            tray_branch_enabled(None),
            "unset keeps the desktop tray path"
        );
        assert!(tray_branch_enabled(Some("")));
        assert!(tray_branch_enabled(Some("0")));
        assert!(tray_branch_enabled(Some("true")));
        assert!(
            !tray_branch_enabled(Some("1")),
            "HG_SERVE_HEADLESS=1 skips tray::start and the GUI spawn inside it"
        );
    }
}
