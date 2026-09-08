//! macOS presenter: MVP degrades to log + no-op window if AppKit bridging is heavy.
//! Contract matches Windows (click-through / no activate) — full NSPanel blit can follow.
use crate::comm_overlay::engine::ActionKind;

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
