//! Who may use the proxy listeners, and which targets a non-local client may reach.
//!
//! - Remote access off (default): listeners bind 127.0.0.1; only loopback peers are served.
//! - Remote access on: listeners bind 0.0.0.0; loopback, private (RFC 1918), CGNAT / Tailscale
//!   (100.64.0.0/10), link-local and IPv6 ULA peers are served. Public addresses are dropped.
//! - Non-loopback peers never reach this machine's loopback (`127.0.0.0/8`, `::1`, `localhost`,
//!   `0.0.0.0`) by literal host, and never reach the serve IPC ports. Registered local routes still work.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use hg_core::{SERVE_EVENT_PORT, SERVE_TCP_PORT};

/// Address of the client connected to a proxy listener. Added to every proxied request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ClientPeer(pub IpAddr);

impl ClientPeer {
    pub(crate) fn is_loopback(self) -> bool {
        canonical(self.0).is_loopback()
    }
}

/// Bind address for listeners that may be shared with other devices.
pub(crate) fn listen_ip(allow_remote_access: bool) -> IpAddr {
    if allow_remote_access {
        IpAddr::V4(Ipv4Addr::UNSPECIFIED)
    } else {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    }
}

/// Peer allowlist applied on accept.
pub(crate) fn is_peer_allowed(peer: IpAddr, allow_remote_access: bool) -> bool {
    let peer = canonical(peer);
    if peer.is_loopback() {
        return true;
    }
    allow_remote_access && is_private_peer(peer)
}

/// Literal loopback / unspecified host (`localhost`, `*.localhost`, `127.x`, `[::1]`, `0.0.0.0`).
/// `host` may carry a port.
pub(crate) fn is_loopback_host(host: &str) -> bool {
    let host = strip_port(host.trim())
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(ip) => is_local_ip(ip),
        // Legacy numeric forms like `127.1` or `2130706433` resolve to loopback on most stacks.
        Err(_) => !host.is_empty() && host.chars().all(|c| c.is_ascii_digit() || c == '.'),
    }
}

/// Loopback or unspecified address (IPv4-mapped forms included).
pub(crate) fn is_local_ip(ip: IpAddr) -> bool {
    let ip = canonical(ip);
    ip.is_loopback() || ip.is_unspecified()
}

/// Serve IPC ports. Never reachable through the proxy for non-loopback peers.
pub(crate) fn is_control_port(port: u16) -> bool {
    port == SERVE_TCP_PORT || port == SERVE_EVENT_PORT
}

fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
        IpAddr::V4(_) => ip,
    }
}

fn is_private_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            v4.is_private() || v4.is_link_local() || (a == 100 && (64..=127).contains(&b))
        }
        IpAddr::V6(v6) => is_ula(v6) || is_v6_link_local(v6),
    }
}

fn is_ula(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xfe00) == 0xfc00
}

fn is_v6_link_local(ip: Ipv6Addr) -> bool {
    (ip.segments()[0] & 0xffc0) == 0xfe80
}

fn strip_port(host: &str) -> &str {
    if let Some(rest) = host.strip_prefix('[') {
        return rest.split(']').next().unwrap_or(rest);
    }
    match host.rsplit_once(':') {
        // A single colon means host:port; more than one is a bare IPv6 address.
        Some((h, port)) if !h.contains(':') && port.chars().all(|c| c.is_ascii_digit()) => h,
        _ => host,
    }
}
