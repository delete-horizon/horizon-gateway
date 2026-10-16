//! Local failure log for checkout and the Team window.
//!
//! One JSON object per line in `{app data dir}/app.log`. Values are reason
//! codes, an HTTP status, and a workspace id. Emails, tokens, signatures, and
//! checkout URLs are stripped before anything is written.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

const MAX_BYTES: u64 = 512 * 1024;
const FILE_NAME: &str = "app.log";

static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailureEvent {
    pub function: String,
    pub reason: String,
    pub status: Option<u16>,
    pub workspace_id: Option<String>,
}

impl FailureEvent {
    pub fn sanitize(
        function: &str,
        reason: &str,
        status: Option<u16>,
        workspace_id: Option<&str>,
    ) -> Self {
        Self {
            function: reason_code(function),
            reason: reason_code(reason),
            status: status.filter(|code| (100..600).contains(code)),
            workspace_id: workspace_id.and_then(workspace_uuid),
        }
    }
}

/// Append one failure line. Unknown directories are skipped.
pub fn record_failure(
    function: &str,
    reason: &str,
    status: Option<u16>,
    workspace_id: Option<&str>,
) {
    let Some(dir) = app_data_dir() else {
        return;
    };
    let event = FailureEvent::sanitize(function, reason, status, workspace_id);
    tracing::warn!("[gui] {} {}", event.function, event.reason);
    if let Err(err) = append_failure(&dir, &event, MAX_BYTES) {
        tracing::warn!("[gui] app log write failed: {err}");
    }
}

#[tauri::command]
#[specta::specta]
pub fn log_client_failure(
    function: String,
    reason: String,
    status: Option<u16>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    record_failure(&function, &reason, status, workspace_id.as_deref());
    Ok(())
}

pub fn app_data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("HG_DATA_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    dirs::data_dir().map(|dir| dir.join(hg_core::APP_IDENTIFIER))
}

pub fn append_failure(dir: &Path, event: &FailureEvent, max_bytes: u64) -> std::io::Result<()> {
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    fs::create_dir_all(dir)?;
    let path = dir.join(FILE_NAME);
    rotate_if_needed(&path, max_bytes)?;
    let line = redact_secrets(&serde_json::to_string(&LogLine::from(event)).unwrap_or_default());
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")?;
    Ok(())
}

/// Replace secrets with `[redacted]`. Workspace ids (UUIDs) are left in place.
pub fn redact_secrets(input: &str) -> String {
    let mut value = redact_checkout_urls(input);
    value = redact_prefixed(&value, &["bearer ", "Bearer ", "BEARER "], is_token_byte);
    value = redact_jwts(&value);
    value = redact_prefixed(
        &value,
        &["sk_live_", "sk_test_", "rk_live_", "whsec_"],
        is_key_byte,
    );
    value = redact_workspace_sig(&value);
    redact_emails(&value)
}

fn rotate_if_needed(path: &Path, max_bytes: u64) -> std::io::Result<()> {
    let len = fs::metadata(path).map_or(0, |meta| meta.len());
    if len < max_bytes {
        return Ok(());
    }
    let backup = path.with_extension("log.1");
    let _ = fs::remove_file(&backup);
    fs::rename(path, backup)?;
    Ok(())
}

#[derive(Serialize)]
struct LogLine<'a> {
    ts: String,
    function: &'a str,
    reason: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace_id: Option<&'a str>,
}

impl<'a> From<&'a FailureEvent> for LogLine<'a> {
    fn from(event: &'a FailureEvent) -> Self {
        Self {
            ts: chrono::Utc::now().to_rfc3339(),
            function: &event.function,
            reason: &event.reason,
            status: event.status,
            workspace_id: event.workspace_id.as_deref(),
        }
    }
}

fn reason_code(value: &str) -> String {
    let bytes = value.as_bytes();
    let ok = (1..=40).contains(&bytes.len())
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_' || *byte == b'-'
        });
    if ok {
        value.to_string()
    } else {
        "invalid".to_string()
    }
}

fn workspace_uuid(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return None;
    }
    let groups = [8, 4, 4, 4, 12];
    let mut index = 0;
    for (group, size) in groups.into_iter().enumerate() {
        if group > 0 {
            if bytes.get(index) != Some(&b'-') {
                return None;
            }
            index += 1;
        }
        for _ in 0..size {
            if !bytes.get(index).is_some_and(u8::is_ascii_hexdigit) {
                return None;
            }
            index += 1;
        }
    }
    Some(value.to_ascii_lowercase())
}

fn redact_checkout_urls(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while !rest.is_empty() {
        let http = rest.find("http://");
        let https = rest.find("https://");
        let start = match (http, https) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        let Some(start) = start else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let end = rest
            .find(|ch: char| ch.is_whitespace() || ch == '"' || ch == '\'')
            .unwrap_or(rest.len());
        let url = &rest[..end];
        if url.contains("lemonsqueezy")
            || url.contains("workspace_sig")
            || url.contains("/checkout")
        {
            out.push_str("[redacted]");
        } else {
            out.push_str(url);
        }
        rest = &rest[end..];
    }
    out
}

fn redact_prefixed(input: &str, prefixes: &[&str], is_value: fn(u8) -> bool) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while !rest.is_empty() {
        let found = prefixes
            .iter()
            .filter_map(|prefix| rest.find(prefix).map(|index| (index, *prefix)))
            .min_by_key(|(index, _)| *index);
        let Some((index, prefix)) = found else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..index]);
        let after = &rest[index + prefix.len()..];
        let value_len = after.bytes().take_while(|byte| is_value(*byte)).count();
        if value_len > 0 {
            out.push_str("[redacted]");
            rest = &after[value_len..];
        } else {
            out.push_str(prefix);
            rest = after;
        }
    }
    out
}

fn redact_jwts(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(index) = rest.find("eyJ") {
        out.push_str(&rest[..index]);
        let tail = &rest[index..];
        if let Some(len) = jwt_len(tail) {
            out.push_str("[redacted]");
            rest = &tail[len..];
        } else {
            out.push_str("eyJ");
            rest = &tail[3..];
        }
    }
    out.push_str(rest);
    out
}

fn jwt_len(value: &str) -> Option<usize> {
    let mut offset = 0;
    for segment in 0..3 {
        if segment > 0 {
            if value.as_bytes().get(offset) != Some(&b'.') {
                return None;
            }
            offset += 1;
        }
        let part = value
            .get(offset..)?
            .bytes()
            .take_while(|byte| is_token_byte(*byte) && *byte != b'.')
            .count();
        if part == 0 {
            return None;
        }
        offset += part;
    }
    Some(offset)
}

fn redact_workspace_sig(input: &str) -> String {
    const KEY: &str = "workspace_sig";
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(index) = rest.find(KEY) {
        out.push_str(&rest[..index]);
        out.push_str(KEY);
        rest = &rest[index + KEY.len()..];
        let sep = rest
            .chars()
            .take_while(|ch| matches!(ch, '=' | ':' | '"' | '\'' | ' ' | '[' | ']'))
            .map(char::len_utf8)
            .sum::<usize>();
        let after = &rest[sep..];
        let value_len = after
            .bytes()
            .take_while(|byte| is_token_byte(*byte))
            .count();
        if value_len >= 8 {
            out.push_str(&rest[..sep]);
            out.push_str("[redacted]");
            rest = &after[value_len..];
        }
    }
    out.push_str(rest);
    out
}

fn redact_emails(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if let Some(len) = email_len(&input[index..]) {
            out.push_str("[redacted]");
            index += len;
            continue;
        }
        let ch = input[index..].chars().next().unwrap_or('\u{FFFD}');
        out.push(ch);
        index += ch.len_utf8();
    }
    out
}

fn email_len(value: &str) -> Option<usize> {
    let at = value.find('@')?;
    if at == 0 || at > 64 {
        return None;
    }
    let local = value.as_bytes().get(..at)?;
    if !local.iter().all(|byte| is_email_local(*byte)) {
        return None;
    }
    let domain = value.get(at + 1..)?;
    let domain_len = domain
        .bytes()
        .take_while(|byte| is_email_domain(*byte))
        .count();
    let host = domain.get(..domain_len)?;
    let dot = host.rfind('.')?;
    if dot == 0 || dot + 2 >= host.len() {
        return None;
    }
    Some(at + 1 + domain_len)
}

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
}

fn is_key_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}

fn is_email_local(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'%' | b'+' | b'-')
}

fn is_email_domain(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')
}

#[cfg(test)]
mod tests {
    use super::{append_failure, redact_secrets, FailureEvent};

    #[test]
    fn redact_strips_secrets_and_keeps_workspace_id() {
        let workspace_id = "142b1dfb-cae3-4c56-b5c7-54a3b4036b37";
        let raw = format!(
            "user@example.com Bearer aaa.bbb {workspace_id} https://store.lemonsqueezy.com/checkout/buy/v?checkout[custom][workspace_sig]=abcdef0123456789 sk_live_secretvalue eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"
        );
        let cleaned = redact_secrets(&raw);
        assert!(cleaned.contains(workspace_id), "{cleaned}");
        assert!(!cleaned.contains("user@example.com"), "{cleaned}");
        assert!(!cleaned.contains("aaa.bbb"), "{cleaned}");
        assert!(!cleaned.contains("lemonsqueezy"), "{cleaned}");
        assert!(!cleaned.contains("abcdef0123456789"), "{cleaned}");
        assert!(!cleaned.contains("sk_live_"), "{cleaned}");
        assert!(!cleaned.contains("eyJhbGci"), "{cleaned}");
    }

    #[test]
    fn append_writes_reason_status_and_workspace_and_drops_secrets() {
        let dir = std::env::temp_dir().join(format!("hg-app-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let event = FailureEvent::sanitize(
            "create-checkout",
            "user@example.com",
            Some(401),
            Some("142b1dfb-cae3-4c56-b5c7-54a3b4036b37"),
        );
        append_failure(&dir, &event, 64).unwrap();
        let body = std::fs::read_to_string(dir.join("app.log")).unwrap();
        assert!(body.contains("\"function\":\"create-checkout\""), "{body}");
        assert!(body.contains("\"reason\":\"invalid\""), "{body}");
        assert!(body.contains("\"status\":401"), "{body}");
        assert!(
            body.contains("142b1dfb-cae3-4c56-b5c7-54a3b4036b37"),
            "{body}"
        );
        assert!(!body.contains("user@example.com"), "{body}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_rotates_when_the_file_is_full() {
        let dir = std::env::temp_dir().join(format!("hg-app-log-rot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let event = FailureEvent::sanitize("open-workspace", "spawn_failed", None, None);
        append_failure(&dir, &event, 80).unwrap();
        append_failure(&dir, &event, 80).unwrap();
        assert!(dir.join("app.log").is_file());
        assert!(dir.join("app.log.1").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
