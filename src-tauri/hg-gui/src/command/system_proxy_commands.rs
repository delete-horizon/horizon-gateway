//! GUI commands for OS PAC settings. The shell applies them; serve does not.

use crate::serve::SystemProxyService;

#[tauri::command]
#[specta::specta]
pub fn set_system_pac(url: String) -> Result<(), String> {
    SystemProxyService::set_pac_url(&url)
}

#[tauri::command]
#[specta::specta]
pub fn clear_system_pac() -> Result<(), String> {
    SystemProxyService::clear_pac_url()
}
