//! Linux present degrade stub.
use crate::comm_overlay::engine::ActionKind;

pub fn play(kind: ActionKind, seed: Option<u64>) {
    tracing::info!("comm overlay play on Linux (degrade): {:?} seed={:?}", kind, seed);
}

pub fn clear() {
    tracing::info!("comm overlay clear on Linux (degrade)");
}
