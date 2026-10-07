use super::super::host::{host_key_for_logging_map, route_domain_to_host};

#[test]
fn host_key_strips_port() {
    assert_eq!(host_key_for_logging_map("Example.COM:443"), "example.com");
}

#[test]
fn route_domain_to_host_from_url() {
    assert_eq!(
        route_domain_to_host("https://dev.example.local/path"),
        "dev.example.local"
    );
}
