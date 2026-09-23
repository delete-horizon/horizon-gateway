//! Team chat P2P transport + crypto. Lives in serve so Hub and companion GUIs share one listener.

pub mod crypto;
pub mod peer;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatIdentity {
    pub device_id: String,
    pub public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeriveDmKeyPayload {
    pub my_user_id: String,
    pub peer_user_id: String,
    pub peer_public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrapRoomKeyPayload {
    pub room_key: String,
    pub peer_public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnwrapRoomKeyPayload {
    pub wrapped: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealPayload {
    pub room_key: String,
    pub plaintext: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPayload {
    pub room_key: String,
    pub ciphertext: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendFramePayload {
    pub lan_hosts: Vec<String>,
    pub lan_port: u16,
    pub tunnel_url: Option<String>,
    pub frame_json: String,
}

pub fn chat_ensure_identity() -> Result<ChatIdentity, String> {
    let (device_id, public_key) = crypto::ensure_identity()?;
    Ok(ChatIdentity {
        device_id,
        public_key,
    })
}

pub fn chat_derive_dm_key(payload: DeriveDmKeyPayload) -> Result<String, String> {
    crypto::derive_dm_key(
        &payload.my_user_id,
        &payload.peer_user_id,
        &payload.peer_public_key,
    )
}

pub fn chat_generate_room_key() -> String {
    crypto::generate_room_key()
}

pub fn chat_wrap_room_key(payload: WrapRoomKeyPayload) -> Result<String, String> {
    crypto::wrap_room_key(&payload.room_key, &payload.peer_public_key)
}

pub fn chat_unwrap_room_key(payload: UnwrapRoomKeyPayload) -> Result<String, String> {
    crypto::unwrap_room_key(&payload.wrapped)
}

pub fn chat_seal(payload: SealPayload) -> Result<String, String> {
    crypto::seal_message(&payload.room_key, &payload.plaintext)
}

pub fn chat_open(payload: OpenPayload) -> Result<String, String> {
    crypto::open_message(&payload.room_key, &payload.ciphertext)
}

pub fn chat_start_listener() -> Result<peer::ListenInfo, String> {
    peer::start_listener()
}

pub fn chat_stop_listener() {
    peer::stop_listener();
}

pub fn chat_send_frame(payload: SendFramePayload) -> Result<peer::SendResult, String> {
    peer::send_frame(
        &payload.lan_hosts,
        payload.lan_port,
        payload.tunnel_url.as_deref(),
        &payload.frame_json,
    )
}
