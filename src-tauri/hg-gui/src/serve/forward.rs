/// GUI-only commands: intercepted by the Tauri specta handler, NOT forwarded to serve.
/// All other commands are always forwarded to hg-serve via TCP IPC.
const GUI_ONLY_COMMANDS: &[&str] = &[
    "open_window",
    "open_inspector_window",
    "open_annotation_dialog",
    "open_external_url",
    "quit_app",
    "prepare_for_update",
    "ensure_serve_running",
    "install_windows_update",
    "capture_app_screenshot",
    "trigger_os_snip",
    "chat_ensure_identity",
    "chat_derive_dm_key",
    "chat_generate_room_key",
    "chat_wrap_room_key",
    "chat_unwrap_room_key",
    "chat_seal",
    "chat_open",
    "chat_start_listener",
    "chat_stop_listener",
    "chat_send_frame",
    "play_comm_action",
    "set_comm_overlay_tool",
    "clear_comm_overlay",
    "plugin:updater|check",
    "plugin:updater|download_and_install",
];

/// Returns true if this command must run in-process (needs Tauri `AppHandle` / `WebView`).
pub fn is_gui_only(command: &str) -> bool {
    GUI_ONLY_COMMANDS.contains(&command)
}

/// Returns true if this command should be forwarded to hg-serve.
pub fn should_forward(command: &str) -> bool {
    !is_gui_only(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quit_app_stays_in_gui() {
        assert!(is_gui_only("quit_app"));
        assert!(!should_forward("quit_app"));
    }

    #[test]
    fn prepare_for_update_stays_in_gui() {
        assert!(is_gui_only("prepare_for_update"));
        assert!(!should_forward("prepare_for_update"));
    }

    #[test]
    fn ensure_serve_running_stays_in_gui() {
        assert!(is_gui_only("ensure_serve_running"));
        assert!(!should_forward("ensure_serve_running"));
    }
}
