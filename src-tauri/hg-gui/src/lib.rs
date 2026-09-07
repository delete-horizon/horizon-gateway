#![allow(unsafe_code)]

use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

pub use hg_core::model;

mod logging;
pub mod serve;
mod chat;
mod comm_overlay;

mod command {
    pub mod window_commands;
}

use chat::{
    chat_derive_dm_key, chat_ensure_identity, chat_generate_room_key, chat_open, chat_seal,
    chat_send_frame, chat_start_listener, chat_stop_listener, chat_unwrap_room_key,
    chat_wrap_room_key,
};
use command::window_commands::{
    capture_app_screenshot, open_annotation_dialog, open_external_url, open_inspector_window,
    open_window, prepare_for_update, quit_app, trigger_os_snip,
};
use comm_overlay::{clear_comm_overlay, play_comm_action};

pub fn get_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        open_window,
        open_external_url,
        open_inspector_window,
        open_annotation_dialog,
        quit_app,
        prepare_for_update,
        capture_app_screenshot,
        trigger_os_snip,
        chat_ensure_identity,
        chat_derive_dm_key,
        chat_generate_room_key,
        chat_wrap_room_key,
        chat_unwrap_room_key,
        chat_seal,
        chat_open,
        chat_start_listener,
        chat_stop_listener,
        chat_send_frame,
        play_comm_action,
        clear_comm_overlay,
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
pub fn run() {
    load_dotenv_manually();

    let specta_builder = get_specta_builder();

    // Required by rustls 0.23: set process-wide crypto provider before any TLS.
    let () = rustls::crypto::ring::default_provider()
        .install_default()
        .expect("rustls default crypto provider");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            tracing::info!("Single Instance triggered with args: {:?}", argv);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            for arg in argv {
                if arg.starts_with("horizon-gateway://") {
                    let _ = app.emit("deep-link-received", arg);
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
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

            // Ensure hg-serve backend process is running
            match crate::serve::ensure_running() {
                Ok(()) => {
                    let _ = app.emit("serve-ready", ());
                }
                Err(e) => {
                    tracing::warn!("[gui] serve backend unavailable on startup: {e}");
                }
            }

            // Deep Link Listener
            let handle = app.handle().clone();
            #[cfg(target_os = "windows")]
            let _ = handle.deep_link().register("horizon-gateway");

            let handle_clone = handle.clone();
            let _ = handle.deep_link().on_open_url(move |event| {
                if let Some(url) = event.urls().first() {
                    let _ = handle_clone.emit("deep-link-received", url.as_str());
                }
            });

            if !is_cli_mode {
                crate::serve::start_event_forwarder(app.handle().clone());
            }

            crate::chat::peer::set_app_handle(app.handle().clone());

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(serve::wrap_invoke_handler(specta_builder.invoke_handler()))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
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
