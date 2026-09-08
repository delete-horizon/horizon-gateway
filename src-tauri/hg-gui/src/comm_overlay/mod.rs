pub mod engine;
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

#[cfg(not(any(target_os = "windows", target_os = "macos", all(unix, not(target_os = "macos")))))]
mod present_impl {
    use super::engine::ActionKind;
    pub fn play(_kind: ActionKind, _seed: Option<u64>, _count: u32, _from_label: Option<String>) {}
    pub fn set_tool(_tool: &str) {}
    pub fn clear() {}
}

use engine::{ActionKind, OverlayTool};

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
