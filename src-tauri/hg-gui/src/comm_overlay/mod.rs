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
    pub fn play(_kind: ActionKind, _seed: Option<u64>) {}
    pub fn clear() {}
}

use engine::ActionKind;

#[tauri::command]
#[specta::specta]
pub fn play_comm_action(kind: String, seed: Option<i64>) -> Result<(), String> {
    let k = ActionKind::parse(&kind);
    let seed = seed.map(|s| s as u64);
    present_impl::play(k, seed);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn clear_comm_overlay() -> Result<(), String> {
    present_impl::clear();
    Ok(())
}
