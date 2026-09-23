//! macOS presenter: MVP degrades to log + no-op window if AppKit bridging is heavy.
//! Contract matches Windows (click-through / no activate) — full NSPanel blit can follow.
use crate::comm_overlay::engine::ActionKind;
use crate::comm_overlay::presence::CommResidentInput;

pub fn play(kind: ActionKind, seed: Option<u64>, count: u32, from_label: Option<String>) {
    tracing::info!(
        "comm overlay play on macOS (stub present): {:?} seed={:?} count={count} from={from_label:?}",
        kind,
        seed
    );
}

pub fn set_tool(tool: &str) {
    tracing::info!("comm overlay tool on macOS (stub): {tool}");
}

pub fn clear() {
    tracing::info!("comm overlay clear on macOS (stub)");
}

pub fn sync_residents(items: Vec<CommResidentInput>) {
    tracing::info!(
        count = items.len(),
        "comm overlay sync residents on macOS (stub)"
    );
}

pub fn show_bubble(profile_id: &str, text: &str, ttl_ms: u64) {
    tracing::info!(
        profile_id,
        text,
        ttl_ms,
        "comm overlay bubble on macOS (stub)"
    );
}
