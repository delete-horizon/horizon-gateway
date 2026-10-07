//! Shared types for GUI ↔ serve IPC (CLI uses the same wire format).

pub mod model;
pub mod protocol;

pub use model::*;
pub use protocol::{
    serve_token_matches, serve_token_path, ServeCommand, ServeEndpoints, ServeErrorResponse,
    ServeEvent, ServeEventHello, ServeRequest, ServeResponse, APP_IDENTIFIER, PROTOCOL_VERSION,
    SERVE_ENDPOINTS_FILE, SERVE_EVENT_ADDR, SERVE_EVENT_PORT, SERVE_TCP_ADDR, SERVE_TCP_PORT,
    SERVE_TOKEN_FILE,
};
