#![allow(unsafe_code)]

use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

pub use hg_core::model;

mod comm_overlay;
mod logging;
pub mod serve;

mod command {
    pub mod window_commands;
    pub mod windows_update;
}

use comm_overlay::{
    broadcast_comm_bubble, clear_comm_overlay, install_comm_avatar_parts, play_comm_action,
    set_comm_overlay_tool, show_comm_bubble, sync_comm_residents, take_overlay_resident_click,
    take_overlay_resident_context,
};
use command::window_commands::{
    app_shell_role, capture_app_screenshot, clear_incoming_cards, dismiss_incoming_card,
    ensure_serve_running, fit_resident_composer, list_incoming_cards,
    note_companion_open_from_args, open_annotation_dialog, open_external_url, open_hub_app,
    open_inspector_window, open_resident_action_menu, open_resident_composer, open_window,
    open_workspace_app, prepare_for_update, prepare_incoming_cards, push_incoming_card, quit_app,
    set_pending_companion_open, set_shell_role, take_companion_open, trigger_os_snip,
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
        open_window,
        open_workspace_app,
        open_hub_app,
        app_shell_role,
        take_companion_open,
        open_external_url,
        open_inspector_window,
        open_annotation_dialog,
        quit_app,
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
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            tracing::info!("Single Instance triggered with args: {:?}", argv);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            for arg in argv {
                if let Some(path) = arg.strip_prefix("hg-open:") {
                    set_pending_companion_open(path.to_string());
                    let _ = app.emit("companion-navigate", path.to_string());
                }
                if arg.starts_with("horizon-gateway://") {
                    let _ = app.emit("deep-link-received", arg);
                }
            }
        }))
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
            } if label == "main" && !is_workspace => {
                api.prevent_close();
                let _ = app_handle.emit("main-window-close-requested", ());
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
