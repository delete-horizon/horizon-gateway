use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Current serve IPC protocol version.
pub const PROTOCOL_VERSION: u32 = 1;

fn default_protocol_version() -> u32 {
    PROTOCOL_VERSION
}

/// Deprecated fixed addresses — discovery via [`ServeEndpoints`] is preferred.
pub const SERVE_TCP_ADDR: &str = "127.0.0.1:17345";
/// Deprecated fixed event address — discovery via [`ServeEndpoints`] is preferred.
pub const SERVE_EVENT_ADDR: &str = "127.0.0.1:17346";
/// Port of [`SERVE_TCP_ADDR`].
pub const SERVE_TCP_PORT: u16 = 17345;
/// Port of [`SERVE_EVENT_ADDR`].
pub const SERVE_EVENT_PORT: u16 = 17346;

/// Must match `tauri.conf.json` identifier. Serve, CLI and GUI share this data dir.
pub const APP_IDENTIFIER: &str = "com.lurain.horizon-gateway";
/// Per-session IPC token written by serve into the app data dir (owner-only on unix).
pub const SERVE_TOKEN_FILE: &str = "serve.token";

/// `<platform data dir>/<APP_IDENTIFIER>/serve.token`, given the platform data dir.
pub fn serve_token_path(platform_data_dir: &std::path::Path) -> std::path::PathBuf {
    platform_data_dir
        .join(APP_IDENTIFIER)
        .join(SERVE_TOKEN_FILE)
}

/// Constant-time token comparison. Empty tokens never match.
pub fn serve_token_matches(expected: &str, provided: Option<&str>) -> bool {
    let Some(provided) = provided else {
        return false;
    };
    let (a, b) = (expected.as_bytes(), provided.as_bytes());
    if a.is_empty() || a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Shared command contract: client `call_cmd` and server typed dispatch use the same types.
pub trait ServeCommand {
    const NAME: &'static str;
    type Payload: Serialize + DeserializeOwned;
    type Response: Serialize + DeserializeOwned;
}

/// Published by serve after binding ephemeral ports; GUI/CLI discover from this file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServeEndpoints {
    #[serde(default = "default_protocol_version")]
    pub protocol_version: u32,
    pub pid: u32,
    /// e.g. `127.0.0.1:54321`
    pub command_addr: String,
    pub event_addr: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeRequest<P = Value> {
    pub id: String,
    #[serde(default = "default_protocol_version")]
    pub protocol_version: u32,
    pub command: String,
    #[serde(default)]
    pub payload: P,
    /// Session token from [`SERVE_TOKEN_FILE`]. Serve rejects requests without it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// First NDJSON line a client sends on the event stream before it receives events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServeEventHello {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeResponse<T = Value> {
    pub id: String,
    #[serde(default = "default_protocol_version")]
    pub protocol_version: u32,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServeErrorResponse {
    pub ok: bool,
    pub error: String,
}

/// NDJSON line on the serve event stream (mirrors Tauri `emit(event, payload)`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServeEvent<T = Value> {
    pub event: String,
    pub payload: T,
}

impl ServeErrorResponse {
    pub fn new(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: error.into(),
        }
    }
}

impl<P: Default> ServeRequest<P> {
    pub fn new(command: impl Into<String>, payload: P) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            protocol_version: PROTOCOL_VERSION,
            command: command.into(),
            payload,
            token: None,
        }
    }
}

impl<P> ServeRequest<P> {
    #[must_use]
    pub fn with_token(mut self, token: Option<String>) -> Self {
        self.token = token;
        self
    }

    pub fn unsupported_version_error(&self) -> Option<String> {
        if self.protocol_version == PROTOCOL_VERSION {
            None
        } else {
            Some(format!(
                "unsupported serve protocol version {} (expected {PROTOCOL_VERSION})",
                self.protocol_version
            ))
        }
    }
}

impl ServeResponse<Value> {
    pub fn success(id: String, data: Value) -> Self {
        Self {
            id,
            protocol_version: PROTOCOL_VERSION,
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn failure(id: String, error: impl Into<String>) -> Self {
        Self {
            id,
            protocol_version: PROTOCOL_VERSION,
            ok: false,
            data: None,
            error: Some(error.into()),
        }
    }
}

impl<T: Serialize> ServeResponse<T> {
    pub fn success_typed(id: String, data: T) -> Result<ServeResponse<Value>, String> {
        let value = serde_json::to_value(data).map_err(|e| e.to_string())?;
        Ok(ServeResponse::success(id, value))
    }
}

impl ServeResponse<Value> {
    pub fn try_into_typed<T: DeserializeOwned>(self) -> Result<T, String> {
        if !self.ok {
            return Err(self
                .error
                .unwrap_or_else(|| "serve command failed".to_string()));
        }
        let data = self
            .data
            .ok_or_else(|| "serve returned empty data".to_string())?;
        serde_json::from_value(data).map_err(|e| format!("serve response type mismatch: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
    struct SamplePayload {
        n: u32,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    struct SampleResponse {
        ok: bool,
    }

    struct SampleCmd;
    impl ServeCommand for SampleCmd {
        const NAME: &'static str = "sample_cmd";
        type Payload = SamplePayload;
        type Response = SampleResponse;
    }

    #[test]
    fn request_response_roundtrip_generic() {
        let req = ServeRequest::<SamplePayload>::new(SampleCmd::NAME, SamplePayload { n: 7 });
        let json = serde_json::to_string(&req).unwrap();
        let erased: ServeRequest<Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(erased.command, SampleCmd::NAME);
        assert_eq!(erased.protocol_version, PROTOCOL_VERSION);
        let payload: SamplePayload = serde_json::from_value(erased.payload).unwrap();
        assert_eq!(payload.n, 7);

        let res =
            ServeResponse::success_typed(erased.id.clone(), SampleResponse { ok: true }).unwrap();
        let out: SampleResponse = res.try_into_typed().unwrap();
        assert!(out.ok);
    }

    #[test]
    fn protocol_version_defaults_on_legacy_json() {
        let legacy = r#"{"id":"1","command":"ping","payload":null}"#;
        let req: ServeRequest<Value> = serde_json::from_str(legacy).unwrap();
        assert_eq!(req.protocol_version, PROTOCOL_VERSION);
    }

    #[test]
    fn endpoints_roundtrip() {
        let ep = ServeEndpoints {
            protocol_version: PROTOCOL_VERSION,
            pid: 42,
            command_addr: "127.0.0.1:12345".into(),
            event_addr: "127.0.0.1:12346".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&ep).unwrap();
        let back: ServeEndpoints = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ep);
    }

    #[test]
    fn token_is_optional_on_the_wire() {
        let req = ServeRequest::new("ping", Value::Null);
        assert!(!serde_json::to_string(&req).unwrap().contains("token"));
        let req = req.with_token(Some("abc".into()));
        let back: ServeRequest<Value> =
            serde_json::from_str(&serde_json::to_string(&req).unwrap()).unwrap();
        assert_eq!(back.token.as_deref(), Some("abc"));
    }

    #[test]
    fn token_match_rules() {
        assert!(serve_token_matches("abc", Some("abc")));
        assert!(!serve_token_matches("abc", Some("abd")));
        assert!(!serve_token_matches("abc", Some("ab")));
        assert!(!serve_token_matches("abc", None));
        assert!(!serve_token_matches("", Some("")));
    }

    #[test]
    fn fixed_ports_match_addrs() {
        assert!(SERVE_TCP_ADDR.ends_with(&format!(":{SERVE_TCP_PORT}")));
        assert!(SERVE_EVENT_ADDR.ends_with(&format!(":{SERVE_EVENT_PORT}")));
        let p = serve_token_path(std::path::Path::new("base"));
        assert!(p.ends_with(format!("{APP_IDENTIFIER}/{SERVE_TOKEN_FILE}")));
    }

    #[test]
    fn unsupported_version_detected() {
        let mut req = ServeRequest::new("ping", Value::Null);
        req.protocol_version = 999;
        assert!(req.unsupported_version_error().is_some());
    }
}
