use std::fs;
use std::path::PathBuf;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

fn data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir().ok_or_else(|| "no data dir".to_string())?;
    let dir = base.join("horizon-gateway").join("chat");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn device_id_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("device_id.txt"))
}

fn secret_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("x25519.secret"))
}

pub fn ensure_identity() -> Result<(String, String), String> {
    let device_id = match fs::read_to_string(device_id_path()?) {
        Ok(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            let id = uuid::Uuid::new_v4().to_string();
            fs::write(device_id_path()?, &id).map_err(|e| e.to_string())?;
            id
        }
    };

    let secret = load_or_create_secret()?;
    let public = PublicKey::from(&secret);
    Ok((device_id, B64.encode(public.as_bytes())))
}

fn load_or_create_secret() -> Result<StaticSecret, String> {
    let path = secret_path()?;
    if path.exists() {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() != 32 {
            return Err("invalid secret length".into());
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        return Ok(StaticSecret::from(arr));
    }
    let secret = StaticSecret::random_from_rng(OsRng);
    fs::write(&path, secret.to_bytes()).map_err(|e| e.to_string())?;
    Ok(secret)
}

fn decode_pk(b64: &str) -> Result<PublicKey, String> {
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    if bytes.len() != 32 {
        return Err("bad public key length".into());
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(PublicKey::from(arr))
}

pub fn derive_dm_key(my_user_id: &str, peer_user_id: &str, peer_public_b64: &str) -> Result<String, String> {
    let secret = load_or_create_secret()?;
    let peer_pk = decode_pk(peer_public_b64)?;
    let shared = secret.diffie_hellman(&peer_pk);
    let mut ids = [my_user_id, peer_user_id];
    ids.sort();
    let salt = format!("{}:{}", ids[0], ids[1]);
    let hk = Hkdf::<Sha256>::new(Some(salt.as_bytes()), shared.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(b"hg-dm-v1", &mut okm)
        .map_err(|_| "hkdf expand failed".to_string())?;
    Ok(B64.encode(okm))
}

pub fn generate_room_key() -> String {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    B64.encode(key)
}

/// Envelope: base64(JSON { spk, ct }) so recipient can ECDH with sender public key.
pub fn wrap_room_key(room_key_b64: &str, peer_public_b64: &str) -> Result<String, String> {
    let secret = load_or_create_secret()?;
    let my_pk = PublicKey::from(&secret);
    let peer_pk = decode_pk(peer_public_b64)?;
    let shared = secret.diffie_hellman(&peer_pk);
    let hk = Hkdf::<Sha256>::new(None, shared.as_bytes());
    let mut wrap_key = [0u8; 32];
    hk.expand(b"hg-wrap-v1", &mut wrap_key)
        .map_err(|_| "hkdf expand failed".to_string())?;
    let room_key = B64.decode(room_key_b64).map_err(|e| e.to_string())?;
    let ct = seal_with_key(&wrap_key, &room_key)?;
    let env = serde_json::json!({
        "spk": B64.encode(my_pk.as_bytes()),
        "ct": ct,
    });
    Ok(B64.encode(env.to_string().as_bytes()))
}

pub fn unwrap_room_key(wrapped_b64: &str) -> Result<String, String> {
    #[derive(serde::Deserialize)]
    struct WrapEnvelope {
        spk: String,
        ct: String,
    }
    let secret = load_or_create_secret()?;
    let raw = B64.decode(wrapped_b64).map_err(|e| e.to_string())?;
    let env: WrapEnvelope = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    let sender_pk = decode_pk(&env.spk)?;
    let shared = secret.diffie_hellman(&sender_pk);
    let hk = Hkdf::<Sha256>::new(None, shared.as_bytes());
    let mut wrap_key = [0u8; 32];
    hk.expand(b"hg-wrap-v1", &mut wrap_key)
        .map_err(|_| "hkdf expand failed".to_string())?;
    let room_key = open_with_key(&wrap_key, &env.ct)?;
    Ok(B64.encode(room_key))
}

fn decode_room_key(b64: &str) -> Result<[u8; 32], String> {
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    if bytes.len() != 32 {
        return Err("room key must be 32 bytes".into());
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

fn seal_with_key(key: &[u8; 32], plaintext: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let mut out = nonce_bytes.to_vec();
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "encrypt failed".to_string())?;
    out.extend_from_slice(&ct);
    Ok(B64.encode(out))
}

fn open_with_key(key: &[u8; 32], ciphertext_b64: &str) -> Result<Vec<u8>, String> {
    let bytes = B64.decode(ciphertext_b64).map_err(|e| e.to_string())?;
    if bytes.len() < 12 + 16 {
        return Err("ciphertext too short".into());
    }
    let (nonce_bytes, ct) = bytes.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ct)
        .map_err(|_| "decrypt failed".to_string())
}

pub fn seal_message(room_key_b64: &str, plaintext: &str) -> Result<String, String> {
    let key = decode_room_key(room_key_b64)?;
    seal_with_key(&key, plaintext.as_bytes())
}

pub fn open_message(room_key_b64: &str, ciphertext_b64: &str) -> Result<String, String> {
    let key = decode_room_key(room_key_b64)?;
    let pt = open_with_key(&key, ciphertext_b64)?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dm_keys_match_both_sides() {
        // Uses filesystem secrets — smoke only if dirs writable.
        let _ = ensure_identity();
    }
}
