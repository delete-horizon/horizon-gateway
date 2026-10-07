use std::collections::HashMap;

pub(crate) fn host_key_for_logging_map(host: &str) -> String {
    let host = host.trim();
    if host.starts_with('[') {
        if let Some(end) = host.rfind(']') {
            return host[0..=end].to_lowercase();
        }
    }
    host.split(':').next().unwrap_or(host).to_lowercase()
}

/// 로깅 설정 조회. 정확 일치 후 서브도메인 `매칭(host.ends_with`("." + key)); 여러 매칭 시 가장 긴 키 사용.
pub(crate) fn get_logging_config_for_host(
    map: &std::sync::RwLockReadGuard<'_, HashMap<String, (bool, bool)>>,
    host_key: &str,
) -> Option<(bool, bool)> {
    if let Some(cfg) = map.get(host_key) {
        return Some(*cfg);
    }
    let mut best: Option<(String, (bool, bool))> = None;
    for (key, cfg) in map.iter() {
        if key.is_empty() {
            continue;
        }
        if (*host_key == *key || host_key.ends_with(&format!(".{key}")))
            && best.as_ref().map_or(0, |(k, _)| k.len()) < key.len()
        {
            best = Some((key.clone(), *cfg));
        }
    }
    best.map(|(_, cfg)| cfg)
}

/// Extract hostname from route domain: "<https://dev.example.local>/" -> "dev.example.local", "dev.example.local" -> "dev.example.local".
pub fn route_domain_to_host(domain: &str) -> &str {
    let domain = domain.trim();
    if let Some(after) = domain
        .strip_prefix("https://")
        .or_else(|| domain.strip_prefix("http://"))
    {
        let host_part = after.split('/').next().unwrap_or(after).trim();
        let host_only = host_part.split(':').next().unwrap_or(host_part).trim();
        return if host_only.is_empty() {
            domain
        } else {
            host_only
        };
    }
    let host_only = domain.split(':').next().unwrap_or(domain).trim();
    if host_only.is_empty() {
        domain
    } else {
        host_only
    }
}

/// True if route domain is scheme-specific (e.g. "https://..."). Used to prefer scheme-specific routes.
pub(crate) fn route_domain_scheme(domain: &str) -> Option<&'static str> {
    let d = domain.trim();
    if d.starts_with("https://") {
        return Some("https");
    }
    if d.starts_with("http://") {
        return Some("http");
    }
    None
}

fn host_matches_pattern(host: &str, pattern: &str) -> bool {
    let host = host_key_for_logging_map(host);
    let pattern = host_key_for_logging_map(pattern);
    if pattern.is_empty() {
        return false;
    }
    host == pattern || host.ends_with(&format!(".{pattern}")) || host.contains(&pattern)
}

pub(crate) fn host_in_list(host: &str, list: &[String]) -> bool {
    list.iter()
        .any(|pattern| host_matches_pattern(host, pattern))
}
