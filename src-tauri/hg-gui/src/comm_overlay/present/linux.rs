//! Linux present degrade stub.
use crate::comm_overlay::engine::ActionKind;

pub fn play(kind: ActionKind, seed: Option<u64>, count: u32, from_label: Option<String>) {
    tracing::info!(
        "comm overlay play on Linux (degrade): {:?} seed={:?} count={count} from={from_label:?}",
        kind,
        seed
    );
}

pub fn set_tool(tool: &str) {
    tracing::info!("comm overlay tool on Linux (degrade): {tool}");
}

pub fn clear() {
    tracing::info!("comm overlay clear on Linux (degrade)");
}
