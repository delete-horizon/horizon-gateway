/// GUI-only commands: intercepted by the Tauri specta handler, NOT forwarded to serve.
/// All other commands are always forwarded to hg-serve via TCP IPC.
const GUI_ONLY_COMMANDS: &[&str] = &[
    "open_window",
    "open_workspace_app",
    "open_hub_app",
    "app_shell_role",
    "take_companion_open",
    "open_inspector_window",
    "open_annotation_dialog",
    "open_external_url",
    "quit_app",
    "prepare_for_update",
    "ensure_serve_running",
    "install_windows_update",
    "capture_app_screenshot",
    "trigger_os_snip",
    // chat_* → hg-serve (shared P2P listener + crypto)
    "play_comm_action",
    "set_comm_overlay_tool",
    "clear_comm_overlay",
    "sync_comm_residents",
    "broadcast_comm_bubble",
    "show_comm_bubble",
    "take_overlay_resident_click",
    "open_resident_composer",
    "fit_resident_composer",
    "push_incoming_card",
    "list_incoming_cards",
    "dismiss_incoming_card",
    "clear_incoming_cards",
    "prepare_incoming_cards",
    "install_comm_avatar_parts",
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

    #[test]
    fn avatar_catalog_goes_to_serve() {
        assert!(!is_gui_only("get_comm_avatar_catalog"));
        assert!(!is_gui_only("reload_comm_avatar_catalog"));
        assert!(!is_gui_only("compose_comm_avatar"));
        assert!(!is_gui_only("write_comm_avatar_part"));
        assert!(!is_gui_only("push_comm_avatar_draft"));
        assert!(should_forward("reload_comm_avatar_catalog"));
        assert!(should_forward("push_comm_avatar_draft"));
    }

    #[test]
    fn chat_commands_forward_to_serve() {
        for cmd in [
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
        ] {
            assert!(!is_gui_only(cmd), "{cmd} must forward");
            assert!(should_forward(cmd), "{cmd} must forward");
        }
        assert!(should_forward("session_handoff_put"));
        assert!(should_forward("session_handoff_take"));
    }

    #[test]
    fn incoming_cards_stay_in_gui() {
        for cmd in [
            "push_incoming_card",
            "list_incoming_cards",
            "dismiss_incoming_card",
            "clear_incoming_cards",
            "prepare_incoming_cards",
        ] {
            assert!(is_gui_only(cmd), "{cmd} must stay in the GUI");
            assert!(!should_forward(cmd), "{cmd} must not forward");
        }
    }
}
