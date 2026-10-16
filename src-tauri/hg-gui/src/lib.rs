#![allow(unsafe_code)]

use tauri::Emitter;
use tauri_plugin_deep_link::DeepLinkExt;

pub use hg_core::model;

mod app_log;
mod comm_overlay;
mod logging;
pub mod serve;

mod command {
    pub mod system_proxy_commands;
    pub mod window_commands;
    pub mod windows_update;
}

use app_log::log_client_failure;
use comm_overlay::{
    broadcast_comm_bubble, clear_comm_overlay, install_comm_avatar_parts, play_comm_action,
    set_comm_overlay_tool, show_comm_bubble, sync_comm_residents, take_overlay_resident_click,
    take_overlay_resident_context,
};
use command::system_proxy_commands::{clear_system_pac, set_system_pac};
use command::window_commands::{
    app_shell_role, capture_app_screenshot, clear_incoming_cards, dismiss_incoming_card,
    ensure_serve_running, fit_resident_composer, list_incoming_cards,
    note_companion_open_from_args, on_main_window_close, open_annotation_dialog, open_external_url,
    open_hub_app, open_inspector_window, open_resident_action_menu, open_resident_composer,
    open_window, open_workspace_app, prepare_for_update, prepare_incoming_cards,
    push_incoming_card, quit_app, reveal_main_window, set_pending_companion_open, set_shell_role,
    take_companion_open, trigger_os_snip,
};
use command::windows_update::install_windows_update;

pub fn get_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        clear_incoming_cards,
        dismiss_incoming_card,
        fit_resident_composer,
        list_incoming_cards,
        prepare_incoming_cards,
        open_resident_action_menu,
        open_resident_composer,
        push_incoming_card,
        log_client_failure,
        open_window,
        open_workspace_app,
        open_hub_app,
        app_shell_role,
        take_companion_open,
        open_external_url,
        open_inspector_window,
        open_annotation_dialog,
        quit_app,
        set_system_pac,
        clear_system_pac,
        prepare_for_update,
        ensure_serve_running,
        install_windows_update,
        capture_app_screenshot,
        trigger_os_snip,
        play_comm_action,
        set_comm_overlay_tool,
        clear_comm_overlay,
        sync_comm_residents,
        broadcast_comm_bubble,
        show_comm_bubble,
        take_overlay_resident_click,
        take_overlay_resident_context,
        install_comm_avatar_parts,
    ])
}

fn load_dotenv_manually() {
    if let Ok(mut exe_path) = std::env::current_exe() {
        for _ in 0..6 {
            if exe_path.pop() {
                let dotenv_path = exe_path.join(".env");
                if dotenv_path.exists() {
                    if let Ok(content) = std::fs::read_to_string(&dotenv_path) {
                        for line in content.lines() {
                            let trimmed = line.trim();
                            if trimmed.is_empty() || trimmed.starts_with('#') {
                                continue;
                            }
                            if let Some((key, val)) = trimmed.split_once('=') {
                                let key = key.trim();
                                let val = val.trim().trim_matches('"').trim_matches('\'');
                                std::env::set_var(key, val);
                            }
                        }
                    }
                    break;
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(feature = "workspace-shell"))]
pub fn run() {
    run_inner(false, tauri::generate_context!());
}

/// Companion Comm shell. Attaches to Hub's serve and opens `/comm`.
///
/// Not compiled into the Hub release build. Hub's `tauri build` injects `TAURI_CONFIG`
/// with frontend paths relative to `tauri.conf.json`, which would make this context
/// look for `dist` in the wrong directory.
#[cfg(feature = "workspace-shell")]
pub fn run_workspace() {
    std::env::set_var("HG_SERVE_ATTACH_ONLY", "1");
    std::env::set_var("HG_GUI_ROLE", "workspace");
    run_inner(true, tauri::generate_context!("workspace/tauri.conf.json"));
}

fn run_inner(is_workspace: bool, context: tauri::Context<tauri::Wry>) {
    set_shell_role(if is_workspace { "workspace" } else { "hub" });
    note_companion_open_from_args();
    load_dotenv_manually();

    let specta_builder = get_specta_builder();

    // Required by rustls 0.23: set process-wide crypto provider before any TLS.
    let () = rustls::crypto::ring::default_provider()
        .install_default()
        .expect("rustls default crypto provider");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            move |app, argv, _cwd| {
                // argv can carry a deep link. Do not write it to the log.
                tracing::info!("[gui] single instance launch");
                reveal_main_window(app, is_workspace);
                for arg in argv {
                    if let Some(path) = arg.strip_prefix("hg-open:") {
                        set_pending_companion_open(path.to_string());
                        let _ = app.emit("companion-navigate", path.to_string());
                    }
                    if arg.starts_with("horizon-gateway://") {
                        let _ = app.emit("deep-link-received", arg);
                    }
                }
            },
        ))
        .plugin(tauri_plugin_deep_link::init())
        .setup(move |app| {
            use tracing_subscriber::{
                filter::LevelFilter, layer::SubscriberExt, util::SubscriberInitExt, Layer,
            };

            let is_cli_mode = std::env::args().nth(1).as_deref() == Some("cli");
            let log_level = if is_cli_mode {
                LevelFilter::ERROR
            } else {
                LevelFilter::TRACE
            };

            let tauri_layer = crate::logging::TauriEmitterLayer {
                app_handle: app.handle().clone(),
            };

            let _ = tracing_subscriber::registry()
                .with(tracing_subscriber::fmt::layer().with_filter(log_level))
                .with(tauri_layer.with_filter(log_level))
                .try_init();

            tracing::info!(
                "[gui] role={} identifier={}",
                if is_workspace { "workspace" } else { "hub" },
                app.config().identifier
            );

            match crate::serve::ensure_running() {
                Ok(()) => {
                    let _ = app.emit("serve-ready", ());
                }
                Err(e) => {
                    tracing::warn!("[gui] serve backend unavailable on startup: {e}");
                }
            }

            let handle = app.handle().clone();
            if !is_workspace {
                #[cfg(target_os = "windows")]
                let _ = handle.deep_link().register("horizon-gateway");
            }

            let handle_clone = handle.clone();
            let _ = handle.deep_link().on_open_url(move |event| {
                if let Some(url) = event.urls().first() {
                    let _ = handle_clone.emit("deep-link-received", url.as_str());
                }
            });

            if !is_cli_mode {
                crate::serve::start_event_forwarder(app.handle().clone());
            }

            // macOS: the tray must be created on this process's main thread.
            // Tauri runs `setup` there. Workspace does not install a second icon.
            // Serve never starts a tray, so this is the only place that constraint lives.
            if crate::serve::shell_owns_system_tray(is_workspace) {
                if let Err(err) = crate::serve::install_system_tray(app.handle()) {
                    tracing::warn!("[gui] system tray: {err}");
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init());

    let builder = if is_workspace {
        builder
    } else {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    };

    builder
        .invoke_handler(serve::wrap_invoke_handler(specta_builder.invoke_handler()))
        .build(context)
        .expect("error while building tauri application")
        .run(move |app_handle, event| match event {
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                // Team (workspace) must hide `main` instead of destroying it.
                // This process stays the single instance, and a later launch only
                // shows the window that still owns the `main` label.
                api.prevent_close();
                on_main_window_close(app_handle, is_workspace);
            }
            _ => {}
        });
}

pub fn execute_cli(args: &[String]) -> i32 {
    match crate::serve::hgc_exe_path() {
        Ok(exe) => {
            let status = std::process::Command::new(exe).args(args).status();
            status.map(|s| s.code().unwrap_or(1)).unwrap_or(1)
        }
        Err(e) => {
            eprintln!("Error: {e}");
            1
        }
    }
}
