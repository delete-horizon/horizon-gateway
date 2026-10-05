use std::net::IpAddr;

use super::super::policy::{
    is_control_port, is_local_ip, is_loopback_host, is_peer_allowed, listen_ip, ClientPeer,
};

fn ip(s: &str) -> IpAddr {
    s.parse().unwrap()
}

#[test]
fn binds_loopback_unless_remote_access_is_on() {
    assert_eq!(listen_ip(false), ip("127.0.0.1"));
    assert_eq!(listen_ip(true), ip("0.0.0.0"));
}

#[test]
fn loopback_peers_are_always_allowed() {
    for p in ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"] {
        assert!(is_peer_allowed(ip(p), false), "{p}");
        assert!(is_peer_allowed(ip(p), true), "{p}");
        assert!(ClientPeer(ip(p)).is_loopback(), "{p}");
    }
}

#[test]
fn private_and_tailscale_peers_need_remote_access() {
    for p in [
        "10.1.2.3",
        "172.30.0.2",
        "192.168.0.7",
        "100.64.0.1",
        "100.127.255.254",
        "169.254.1.1",
        "fd7a:115c:a1e0::1",
        "fe80::1",
        "::ffff:192.168.1.2",
    ] {
        assert!(!is_peer_allowed(ip(p), false), "{p}");
        assert!(is_peer_allowed(ip(p), true), "{p}");
        assert!(!ClientPeer(ip(p)).is_loopback(), "{p}");
    }
}

#[test]
fn public_peers_are_never_allowed() {
    for p in ["8.8.8.8", "100.128.0.1", "172.32.0.1", "2001:4860::8888"] {
        assert!(!is_peer_allowed(ip(p), true), "{p}");
    }
}

#[test]
fn loopback_hosts_are_detected() {
    for h in [
        "localhost",
        "LOCALHOST:3000",
        "api.localhost",
        "localhost.",
        "127.0.0.1",
        "127.0.0.1:17345",
        "127.1.2.3",
        "127.1",
        "2130706433",
        "0.0.0.0:8888",
        "[::1]",
        "[::1]:17345",
        "::1",
        "[::ffff:127.0.0.1]:80",
        "[::]",
    ] {
        assert!(is_loopback_host(h), "{h}");
    }
    for h in [
        "example.com",
        "example.com:443",
        "192.168.0.10:3000",
        "dev.modetour.local",
        "[2001:db8::1]:443",
        "",
    ] {
        assert!(!is_loopback_host(h), "{h}");
    }
}

#[test]
fn local_ips_and_control_ports() {
    assert!(is_local_ip(ip("127.0.0.1")));
    assert!(is_local_ip(ip("0.0.0.0")));
    assert!(is_local_ip(ip("::ffff:127.0.0.1")));
    assert!(!is_local_ip(ip("192.168.0.1")));
    assert!(is_control_port(17345));
    assert!(is_control_port(17346));
    assert!(!is_control_port(8888));
}
