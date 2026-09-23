//! Headless Horizon Gateway backend: proxy, mock, storage, and the CLI library
//! used by `hgc`. GUI talks to this process over the `hg-core` protocol.

pub use hg_core::model;
pub mod chat;
pub mod cli;
pub mod command;
pub mod logging;
pub mod runtime;
pub mod serve;
pub mod service;
pub mod session_handoff;
pub mod storage;

pub fn install_rustls_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}
