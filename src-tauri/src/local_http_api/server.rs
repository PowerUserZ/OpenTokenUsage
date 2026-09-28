use super::cache::{cache_state, enabled_snapshots_ordered};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

const BIND_ADDR: &str = "127.0.0.1:6736";
const MAX_CONCURRENT_CONNECTIONS: usize = 16;
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(5);

struct ConnectionLimiter {
    active: Arc<AtomicUsize>,
    max: usize,
}

struct ConnectionPermit {
    active: Arc<AtomicUsize>,
}

impl ConnectionLimiter {
    fn new(max: usize) -> Self {
        Self {
            active: Arc::new(AtomicUsize::new(0)),
            max,
        }
    }

    fn acquire(&self) -> Option<ConnectionPermit> {
        loop {
            let active = self.active.load(Ordering::Acquire);
            if active >= self.max {
                return None;
            }
            if self
                .active
                .compare_exchange(active, active + 1, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                return Some(ConnectionPermit {
                    active: Arc::clone(&self.active),
                });
            }
        }
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.active.load(Ordering::Acquire)
    }
}

impl Drop for ConnectionPermit {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::AcqRel);
    }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

pub fn start_server() {
    std::thread::spawn(|| {
        let listener = match TcpListener::bind(BIND_ADDR) {
            Ok(l) => {
                log::info!("local HTTP API listening on {}", BIND_ADDR);
                l
            }
            Err(e) => {
                log::warn!(
                    "failed to bind local HTTP API on {}: {} — feature disabled for this session",
                    BIND_ADDR,
                    e
                );
                return;
            }
        };

        let limiter = ConnectionLimiter::new(MAX_CONCURRENT_CONNECTIONS);
        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => {
                    let Some(permit) = limiter.acquire() else {
                        log::warn!(
                            "local HTTP API connection limit reached (max={})",
                            MAX_CONCURRENT_CONNECTIONS
                        );
                        let _ = stream.set_write_timeout(Some(CONNECTION_TIMEOUT));
                        let _ = stream.write_all(response_service_unavailable().as_bytes());
                        let _ = stream.flush();
                        continue;
                    };
                    std::thread::spawn(move || handle_connection(stream, permit));
                }
                Err(e) => log::debug!("local HTTP API accept error: {}", e),
            }
        }
    });
}

fn handle_connection(mut stream: TcpStream, _permit: ConnectionPermit) {
    let _ = stream.set_read_timeout(Some(CONNECTION_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CONNECTION_TIMEOUT));

    // Read request (up to 4 KB is plenty for a request line + headers)
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buf[..n]);

    let response = handle_request(&request);
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn handle_request(request: &str) -> String {
    // Parse request line: "METHOD /path HTTP/1.x\r\n..."
    let mut lines = request.lines();
    let first_line = lines.next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("");

    let mut host = None;
    let mut origin = None;
    for line in lines.take_while(|l| !l.is_empty()) {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim();
            if name.eq_ignore_ascii_case("host") {
                host.get_or_insert(value.trim());
            } else if name.eq_ignore_ascii_case("origin") {
                origin.get_or_insert(value.trim());
            }
        }
    }

    // Block browsers: a DNS-rebound page sends its own Host, a cross-site page sends its Origin.
    let host_ok = host.is_some_and(is_loopback_host);
    let origin_ok = origin.is_none_or(|o| o.strip_prefix("http://").is_some_and(is_loopback_host));
    if !host_ok || !origin_ok {
        return response_forbidden();
    }

    // Strip query string and trailing slash (but keep root "/v1/usage" intact)
    let path = raw_path.split('?').next().unwrap_or(raw_path);
    let path = if path.len() > 1 {
        path.trim_end_matches('/')
    } else {
        path
    };

    route(method, path)
}

/// `127.0.0.1`, `localhost` or `[::1]`, optionally with this server's port.
fn is_loopback_host(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    let port_suffix = &BIND_ADDR[BIND_ADDR.rfind(':').unwrap_or(BIND_ADDR.len())..];
    let host = value.strip_suffix(port_suffix).unwrap_or(&value);
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

fn route(method: &str, path: &str) -> String {
    // Match routes
    if path == "/v1/usage" {
        return match method {
            "GET" => handle_get_usage_collection(),
            _ => response_method_not_allowed(),
        };
    }

    if let Some(provider_id) = path.strip_prefix("/v1/usage/") {
        if !provider_id.is_empty() && !provider_id.contains('/') {
            return match method {
                "GET" => handle_get_usage_single(provider_id),
                _ => response_method_not_allowed(),
            };
        }
    }

    response_not_found("not_found")
}

fn handle_get_usage_collection() -> String {
    let snapshots = {
        let state = cache_state().lock().expect("cache state poisoned");
        enabled_snapshots_ordered(&state)
    };
    let body = serde_json::to_string(&snapshots).unwrap_or_else(|_| "[]".to_string());
    response_json(200, "OK", &body)
}

fn handle_get_usage_single(provider_id: &str) -> String {
    let state = cache_state().lock().expect("cache state poisoned");

    // Check if provider is known at all
    let is_known = state.known_plugin_ids.iter().any(|id| id == provider_id);
    if !is_known {
        return response_not_found("provider_not_found");
    }

    match state.snapshots.get(provider_id) {
        Some(snapshot) => {
            let body = serde_json::to_string(snapshot).unwrap_or_else(|_| "{}".to_string());
            response_json(200, "OK", &body)
        }
        None => response_no_content(),
    }
}

// ---------------------------------------------------------------------------
// HTTP response builders
// ---------------------------------------------------------------------------

// No CORS headers on purpose: browsers must not read usage data (see docs/local-http-api.md).
fn response_json(status: u16, reason: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {} {}\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
        status,
        reason,
        body.len(),
        body,
    )
}

fn response_no_content() -> String {
    "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n".to_string()
}

fn response_forbidden() -> String {
    response_json(403, "Forbidden", r#"{"error":"forbidden"}"#)
}

fn response_not_found(error_code: &str) -> String {
    let body = format!(r#"{{"error":"{}"}}"#, error_code);
    response_json(404, "Not Found", &body)
}

fn response_method_not_allowed() -> String {
    let body = r#"{"error":"method_not_allowed"}"#;
    response_json(405, "Method Not Allowed", body)
}

fn response_service_unavailable() -> String {
    let body = r#"{"error":"server_busy"}"#;
    response_json(503, "Service Unavailable", body)
}

#[cfg(test)]
mod tests {
    use super::super::cache::{cache_state, CachedPluginSnapshot};
    use super::*;
    use serial_test::serial;

    fn make_snapshot(id: &str, name: &str) -> CachedPluginSnapshot {
        CachedPluginSnapshot {
            provider_id: id.to_string(),
            display_name: name.to_string(),
            plan: Some("Pro".to_string()),
            lines: vec![],
            fetched_at: "2026-03-26T08:15:30Z".to_string(),
        }
    }

    #[test]
    fn route_get_usage_returns_200() {
        let resp = route("GET", "/v1/usage");
        assert!(resp.starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn route_unknown_path_returns_404() {
        let resp = route("GET", "/v2/something");
        assert!(resp.starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn route_post_returns_405() {
        let resp = route("POST", "/v1/usage");
        assert!(resp.starts_with("HTTP/1.1 405"));
    }

    fn request(headers: &str) -> String {
        handle_request(&format!("GET /v1/usage HTTP/1.1\r\n{headers}\r\n"))
    }

    #[test]
    fn loopback_host_is_allowed_without_cors_headers() {
        for host in [
            "127.0.0.1:6736",
            "localhost:6736",
            "[::1]:6736",
            "LOCALHOST:6736",
            "127.0.0.1",
        ] {
            let resp = request(&format!("Host: {host}\r\n"));
            assert!(resp.starts_with("HTTP/1.1 200"), "host {host}: {resp}");
            assert!(!resp.contains("Access-Control-Allow"), "{resp}");
        }
    }

    #[test]
    fn foreign_or_missing_host_is_forbidden() {
        for headers in [
            "Host: evil.com:6736\r\n",
            "Host: evil.com\r\n",
            "Host: 127.0.0.1:80\r\n",
            "Host: 127.0.0.1.evil.com:6736\r\n",
            "",
        ] {
            let resp = request(headers);
            assert!(resp.starts_with("HTTP/1.1 403"), "{headers}: {resp}");
            assert!(resp.contains(r#"{"error":"forbidden"}"#));
        }
    }

    #[test]
    fn foreign_origin_is_forbidden() {
        for origin in ["https://evil.com", "http://evil.com:6736", "null"] {
            let resp = request(&format!("Host: 127.0.0.1:6736\r\nOrigin: {origin}\r\n"));
            assert!(resp.starts_with("HTTP/1.1 403"), "{origin}: {resp}");
        }
    }

    #[test]
    fn loopback_origin_is_allowed() {
        let resp = request("host: localhost:6736\r\norigin: http://localhost:6736\r\n");
        assert!(resp.starts_with("HTTP/1.1 200"), "{resp}");
    }

    #[test]
    fn options_preflight_is_not_granted() {
        let resp = handle_request("OPTIONS /v1/usage HTTP/1.1\r\nHost: 127.0.0.1:6736\r\n\r\n");
        assert!(resp.starts_with("HTTP/1.1 405"), "{resp}");
        assert!(!resp.contains("Access-Control-Allow"));
    }

    #[test]
    #[serial]
    fn route_unknown_provider_returns_404() {
        {
            let mut state = cache_state().lock().unwrap();
            state.known_plugin_ids = vec!["claude".to_string()];
            state.snapshots.clear();
        }

        let resp = route("GET", "/v1/usage/nonexistent");
        assert!(resp.starts_with("HTTP/1.1 404"));
        assert!(resp.contains("provider_not_found"));
    }

    #[test]
    #[serial]
    fn route_known_uncached_provider_returns_204() {
        {
            let mut state = cache_state().lock().unwrap();
            state.known_plugin_ids = vec!["claude".to_string()];
            state.snapshots.clear();
        }

        let resp = route("GET", "/v1/usage/claude");
        assert!(resp.starts_with("HTTP/1.1 204"));
    }

    #[test]
    #[serial]
    fn route_known_cached_provider_returns_200() {
        {
            let mut state = cache_state().lock().unwrap();
            state.known_plugin_ids = vec!["claude".to_string()];
            state
                .snapshots
                .insert("claude".to_string(), make_snapshot("claude", "Claude"));
        }

        let resp = route("GET", "/v1/usage/claude");
        assert!(resp.starts_with("HTTP/1.1 200"));
        assert!(resp.contains("fetchedAt"));
    }

    #[test]
    fn response_json_has_no_cors_headers() {
        let resp = response_json(200, "OK", "[]");
        assert!(!resp.contains("Access-Control-Allow"));
        assert!(resp.contains("Content-Type: application/json; charset=utf-8"));
    }

    #[test]
    fn connection_limiter_rejects_above_capacity_and_releases_on_drop() {
        let limiter = ConnectionLimiter::new(2);
        let first = limiter.acquire().expect("first permit");
        let second = limiter.acquire().expect("second permit");

        assert!(limiter.acquire().is_none());
        assert_eq!(limiter.active_count(), 2);

        drop(first);

        let third = limiter.acquire().expect("permit after release");
        assert_eq!(limiter.active_count(), 2);

        drop(second);
        drop(third);
        assert_eq!(limiter.active_count(), 0);
    }

    #[test]
    fn response_service_unavailable_returns_503_json() {
        let resp = response_service_unavailable();

        assert!(resp.starts_with("HTTP/1.1 503"));
        assert!(resp.contains(r#""error":"server_busy""#));
    }
}
