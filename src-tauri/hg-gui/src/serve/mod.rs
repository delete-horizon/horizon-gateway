//! Bridge to hg-serve headless backend process.

mod client;
mod ensure;
mod events_client;
mod forward;
mod router;
mod spawn;
mod tray;

pub use client::{call_command, invoke_args_to_payload, ping};
pub use ensure::{ensure_running, is_backend_active, leftover_is_gone, mark_inactive};
pub use events_client::{exit_on_serve_stop, set_exit_on_serve_stop, start_event_forwarder};
pub use forward::{is_gui_only, should_forward};
pub use router::wrap_invoke_handler;
pub use spawn::{
    hgc_exe_path, hub_exe_path, serve_exe_path, spawn_gui_companion, workspace_exe_path,
};
pub use tray::kill_serve_process;
