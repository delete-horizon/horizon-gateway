//! macOS presenter: MVP degrades to log + no-op window if AppKit bridging is heavy.
//! Contract matches Windows (click-through / no activate) — full NSPanel blit can follow.
use crate::comm_overlay::engine::ActionKind;

pub fn play(kind: ActionKind, seed: Option<u64>) {
    tracing::info!("comm overlay play on macOS (stub present): {:?} seed={:?}", kind, seed);
    // TODO: NSPanel + ignoresMouseEvents + CGImage from tiny-skia buffer
}

pub fn clear() {
    tracing::info!("comm overlay clear on macOS (stub)");
}
