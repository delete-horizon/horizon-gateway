pub mod avatar;
pub mod engine;
pub mod presence;
pub mod raster;

#[cfg(target_os = "windows")]
#[path = "present/windows.rs"]
mod present_impl;

#[cfg(target_os = "macos")]
#[path = "present/macos.rs"]
mod present_impl;

#[cfg(all(unix, not(target_os = "macos")))]
#[path = "present/linux.rs"]
mod present_impl;

#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    all(unix, not(target_os = "macos"))
)))]
mod present_impl {
    use super::engine::ActionKind;
    use super::presence::CommResidentInput;
    pub fn play(_kind: ActionKind, _seed: Option<u64>, _count: u32, _from_label: Option<String>) {}
    pub fn set_tool(_tool: &str) {}
    pub fn clear() {}
    pub fn sync_residents(_items: Vec<CommResidentInput>) {}
    pub fn show_bubble(_profile_id: &str, _text: &str, _ttl_ms: u64) {}
}

use avatar::AvatarStudioPart;
use engine::{ActionKind, OverlayTool};
use presence::CommResidentInput;

#[tauri::command]
#[specta::specta]
pub fn install_comm_avatar_parts(parts: Vec<AvatarStudioPart>) -> Result<(), String> {
    avatar::install_runtime_parts(parts)
}

#[tauri::command]
#[specta::specta]
pub fn play_comm_action(
    kind: String,
    seed: Option<i64>,
    count: Option<u32>,
    from_label: Option<String>,
) -> Result<(), String> {
    let k = ActionKind::parse(&kind);
    let seed = seed.map(|s| s as u64);
    let count = count.unwrap_or(1).max(1);
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        present_impl::play(k, seed, count, from_label);
    })) {
        Ok(()) => Ok(()),
        Err(_) => Err("comm overlay panicked".into()),
    }
}

#[tauri::command]
#[specta::specta]
pub fn set_comm_overlay_tool(tool: String) -> Result<(), String> {
    let _ = OverlayTool::parse(&tool);
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        present_impl::set_tool(&tool);
    })) {
        Ok(()) => Ok(()),
        Err(_) => Err("comm overlay tool panicked".into()),
    }
}

#[tauri::command]
#[specta::specta]
pub fn clear_comm_overlay() -> Result<(), String> {
    present_impl::clear();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn sync_comm_residents(residents: Vec<CommResidentInput>) -> Result<(), String> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        present_impl::sync_residents(residents);
    })) {
        Ok(()) => Ok(()),
        Err(_) => Err("comm overlay residents panicked".into()),
    }
}

#[tauri::command]
#[specta::specta]
pub fn take_overlay_resident_click() -> Option<presence::OverlayResidentClick> {
    presence::take_resident_click()
}

#[tauri::command]
#[specta::specta]
pub fn show_comm_bubble(
    profile_id: String,
    text: String,
    ttl_ms: Option<u32>,
) -> Result<(), String> {
    let ttl_ms = ttl_ms
        .map(u64::from)
        .unwrap_or(presence::BUBBLE_TTL_MS)
        .clamp(400, 15_000);
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        present_impl::show_bubble(&profile_id, &text, ttl_ms);
    })) {
        Ok(()) => Ok(()),
        Err(_) => Err("comm overlay bubble panicked".into()),
    }
}
