#![allow(clippy::module_inception)]

mod server;

pub(crate) use server::proxy_app_for_peer;
pub use server::{run_proxy, run_reverse_proxy_http, run_reverse_proxy_https};

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
