//! Hub system tray.
//!
//! macOS requires tray UI on the process main thread. Tauri runs `setup` on that
//! thread, and `install_system_tray` is called only from there. The serve process
//! does not start a tray event loop on any OS.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// The workspace companion attaches to Hub's serve and must not add a second icon.
pub fn shell_owns_system_tray(is_workspace: bool) -> bool {
    !is_workspace
}

pub fn install_system_tray(app: &AppHandle) -> Result<(), String> {
    let open_i = MenuItem::with_id(app, "open", "Open Horizon Gateway", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?;
    let menu =
        Menu::with_items(app, &[&open_i, &separator, &quit_i]).map_err(|err| err.to_string())?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../../icons/32x32.png"))
        .map_err(|err| format!("tray icon: {err}"))?;

    TrayIconBuilder::with_id("horizon-gateway")
        .menu(&menu)
        .tooltip("Horizon Gateway")
        .icon(icon)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => quit_from_tray(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|err| err.to_string())?;

    tracing::info!("[gui] tray icon ready");
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}

fn quit_from_tray(app: &AppHandle) {
    super::tray::kill_serve_process();
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::shell_owns_system_tray;

    #[test]
    fn only_the_hub_shell_owns_the_tray() {
        assert!(shell_owns_system_tray(false));
        assert!(!shell_owns_system_tray(true));
    }
}
