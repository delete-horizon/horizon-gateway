//! One-shot Supabase session slot so a companion GUI can adopt Hub's login.
//! Tokens stay in memory for a short TTL. The `session-handoff` event is a signal only.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::serve::events::publish_event;

pub const SESSION_HANDOFF_EVENT: &str = "session-handoff";
const DEFAULT_TTL: Duration = Duration::from_secs(30);
const MAX_TOKEN_LEN: usize = 16 * 1024;

struct Slot {
    access_token: String,
    refresh_token: String,
    expires_at: Instant,
}

static SLOT: Mutex<Option<Slot>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutPayload {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffTokens {
    pub access_token: String,
    pub refresh_token: String,
}

fn validate(access_token: &str, refresh_token: &str) -> Result<(), String> {
    if access_token.is_empty() || refresh_token.is_empty() {
        return Err("access_token and refresh_token are required".into());
    }
    if access_token.len() > MAX_TOKEN_LEN || refresh_token.len() > MAX_TOKEN_LEN {
        return Err("token too long".into());
    }
    Ok(())
}

pub fn put(payload: PutPayload) -> Result<(), String> {
    put_with_ttl(payload, DEFAULT_TTL)
}

fn put_with_ttl(payload: PutPayload, ttl: Duration) -> Result<(), String> {
    validate(&payload.access_token, &payload.refresh_token)?;
    let mut slot = SLOT.lock().map_err(|_| "session handoff lock poisoned".to_string())?;
    *slot = Some(Slot {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at: Instant::now() + ttl,
    });
    drop(slot);
    publish_event(SESSION_HANDOFF_EVENT, serde_json::json!({ "ready": true }));
    Ok(())
}

/// Returns the tokens once, then clears the slot. Expired or empty → `None`.
pub fn take() -> Result<Option<HandoffTokens>, String> {
    let mut slot = SLOT.lock().map_err(|_| "session handoff lock poisoned".to_string())?;
    let Some(held) = slot.take() else {
        return Ok(None);
    };
    if held.expires_at <= Instant::now() {
        return Ok(None);
    }
    Ok(Some(HandoffTokens {
        access_token: held.access_token,
        refresh_token: held.refresh_token,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as TestMutex;

    static TEST_LOCK: TestMutex<()> = TestMutex::new(());

    fn clear() {
        *SLOT.lock().unwrap() = None;
    }

    fn isolated(f: impl FnOnce()) {
        let _guard = TEST_LOCK.lock().unwrap();
        clear();
        f();
        clear();
    }

    #[test]
    fn take_empty_is_none() {
        isolated(|| {
            assert!(take().unwrap().is_none());
        });
    }

    #[test]
    fn put_then_take_is_one_shot() {
        isolated(|| {
            put(PutPayload {
                access_token: "access".into(),
                refresh_token: "refresh".into(),
            })
            .unwrap();
            let first = take().unwrap().expect("token");
            assert_eq!(first.access_token, "access");
            assert_eq!(first.refresh_token, "refresh");
            assert!(take().unwrap().is_none());
        });
    }

    #[test]
    fn expired_slot_is_dropped() {
        isolated(|| {
            put_with_ttl(
                PutPayload {
                    access_token: "a".into(),
                    refresh_token: "r".into(),
                },
                Duration::from_millis(1),
            )
            .unwrap();
            std::thread::sleep(Duration::from_millis(20));
            assert!(take().unwrap().is_none());
        });
    }

    #[test]
    fn rejects_empty_tokens() {
        isolated(|| {
            let err = put(PutPayload {
                access_token: "".into(),
                refresh_token: "r".into(),
            });
            assert!(err.is_err());
        });
    }
}
