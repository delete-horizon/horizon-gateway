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
    // Isolate present panics so a bad overlay frame cannot abort the whole app.
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        present_impl::play(k, seed);
    })) {
        Ok(()) => Ok(()),
        Err(_) => Err("comm overlay panicked".into()),
    }
}

#[tauri::command]
#[specta::specta]
pub fn clear_comm_overlay() -> Result<(), String> {
    present_impl::clear();
    Ok(())
}
