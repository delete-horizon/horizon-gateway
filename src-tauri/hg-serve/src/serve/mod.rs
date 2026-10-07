//! Headless backend process: owns app services and accepts GUI/CLI IPC.

pub mod auth;
pub mod client;
pub mod endpoints;
pub mod events;
pub mod logging;
pub mod server;
mod tray;

pub use client::call_command;
pub use events::{emit_to_gui, publish_event};
pub use server::run_serve;
