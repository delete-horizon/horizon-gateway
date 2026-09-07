pub mod crypto;
pub mod peer;

use serde::Serialize;
use specta::Type;

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatIdentity {
    pub device_id: String,
    pub public_key: String,
}

#[tauri::command]
#[specta::specta]
pub fn chat_ensure_identity() -> Result<ChatIdentity, String> {
    let (device_id, public_key) = crypto::ensure_identity()?;
    Ok(ChatIdentity {
        device_id,
        public_key,
    })
}

#[tauri::command]
#[specta::specta]
pub fn chat_derive_dm_key(
    my_user_id: String,
    peer_user_id: String,
    peer_public_key: String,
) -> Result<String, String> {
    crypto::derive_dm_key(&my_user_id, &peer_user_id, &peer_public_key)
}

#[tauri::command]
#[specta::specta]
pub fn chat_generate_room_key() -> Result<String, String> {
    Ok(crypto::generate_room_key())
}

#[tauri::command]
#[specta::specta]
pub fn chat_wrap_room_key(room_key: String, peer_public_key: String) -> Result<String, String> {
    crypto::wrap_room_key(&room_key, &peer_public_key)
}

#[tauri::command]
#[specta::specta]
pub fn chat_unwrap_room_key(wrapped: String) -> Result<String, String> {
    crypto::unwrap_room_key(&wrapped)
}

#[tauri::command]
#[specta::specta]
pub fn chat_seal(room_key: String, plaintext: String) -> Result<String, String> {
    crypto::seal_message(&room_key, &plaintext)
}

#[tauri::command]
#[specta::specta]
pub fn chat_open(room_key: String, ciphertext: String) -> Result<String, String> {
    crypto::open_message(&room_key, &ciphertext)
}

#[tauri::command]
#[specta::specta]
pub fn chat_start_listener() -> Result<peer::ListenInfo, String> {
    peer::start_listener()
}

#[tauri::command]
#[specta::specta]
pub fn chat_stop_listener() -> Result<(), String> {
    peer::stop_listener();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn chat_send_frame(
    lan_hosts: Vec<String>,
    lan_port: u16,
    tunnel_url: Option<String>,
    frame_json: String,
) -> Result<peer::SendResult, String> {
    peer::send_frame(
        &lan_hosts,
        lan_port,
        tunnel_url.as_deref(),
        &frame_json,
    )
}
