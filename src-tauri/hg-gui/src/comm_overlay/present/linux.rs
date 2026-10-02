//! Linux present degrade stub.
use crate::comm_overlay::engine::ActionKind;
use crate::comm_overlay::presence::CommResidentInput;

pub fn play(
    kind: ActionKind,
    seed: Option<u64>,
    count: u32,
    from_label: Option<String>,
    _anchor: Option<String>,
    _attacker: Option<String>,
) {
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

pub fn sync_residents(items: Vec<CommResidentInput>) {
    tracing::info!(
        count = items.len(),
        "comm overlay sync residents on Linux (degrade)"
    );
}

pub fn show_bubble(profile_id: &str, text: &str, ttl_ms: u64) {
    tracing::info!(
        profile_id,
        text,
        ttl_ms,
        "comm overlay bubble on Linux (degrade)"
    );
}
