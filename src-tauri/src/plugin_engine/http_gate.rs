//! Shared HTTP 429 gate. Every probe runs in a fresh JS runtime, so plugins cannot remember a
//! rate limit between probes; the host does it for them, keyed by (plugin id, URL without query).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_WAIT: Duration = Duration::from_secs(5 * 60);
const MAX_WAIT: Duration = Duration::from_secs(60 * 60);
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type GateMap = HashMap<(String, String), Instant>;

fn gates() -> &'static Mutex<GateMap> {
    static GATES: OnceLock<Mutex<GateMap>> = OnceLock::new();
    GATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn gate_key(plugin_id: &str, url: &str) -> (String, String) {
    let base = url.split(['?', '#']).next().unwrap_or(url);
    (plugin_id.to_string(), base.to_string())
}

/// Time left on the gate for this request, or `None` when it may hit the network.
pub(crate) fn remaining(plugin_id: &str, url: &str, now: Instant) -> Option<Duration> {
    let key = gate_key(plugin_id, url);
    let mut gates = gates().lock().unwrap_or_else(|e| e.into_inner());
    let until = *gates.get(&key)?;
    if until > now {
        return Some(until - now);
    }
    gates.remove(&key);
    None
}

/// Close the gate after an HTTP 429. Returns how long it stays closed.
pub(crate) fn record_429(
    plugin_id: &str,
    url: &str,
    retry_after: Option<&str>,
    now: Instant,
) -> Duration {
    let wait = retry_after
        .and_then(|value| parse_retry_after(value, SystemTime::now()))
        .unwrap_or(DEFAULT_WAIT)
        .min(MAX_WAIT);
    let mut gates = gates().lock().unwrap_or_else(|e| e.into_inner());
    gates.insert(gate_key(plugin_id, url), now + wait);
    wait
}

/// Retry-After is delay-seconds or an IMF-fixdate HTTP-date (RFC 9110 §10.2.3).
fn parse_retry_after(value: &str, now: SystemTime) -> Option<Duration> {
    let value = value.trim();
    if let Ok(secs) = value.parse::<u64>() {
        return Some(Duration::from_secs(secs));
    }
    let at = parse_http_date(value)?;
    Some(at.duration_since(now).unwrap_or(Duration::ZERO))
}

/// "Sun, 06 Nov 1994 08:49:37 GMT" only; obsolete RFC 850 / asctime forms fall back to the default.
fn parse_http_date(value: &str) -> Option<SystemTime> {
    let parts: Vec<&str> = value.split_whitespace().collect();
    let [_, day, month, year, clock, "GMT"] = parts.as_slice() else {
        return None;
    };
    let month = MONTHS.iter().position(|m| m == month)? as u8 + 1;
    let hms: Vec<u8> = clock
        .split(':')
        .map(|part| part.parse().ok())
        .collect::<Option<_>>()?;
    let [hour, minute, second] = hms.as_slice() else {
        return None;
    };
    let date = time::Date::from_calendar_date(
        year.parse().ok()?,
        time::Month::try_from(month).ok()?,
        day.parse().ok()?,
    )
    .ok()?;
    let clock = time::Time::from_hms(*hour, *minute, *second).ok()?;
    let secs = time::PrimitiveDateTime::new(date, clock)
        .assume_utc()
        .unix_timestamp();
    Some(UNIX_EPOCH + Duration::from_secs(u64::try_from(secs).ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gates_after_429_until_expiry_ignoring_query() {
        let now = Instant::now();
        let url = "https://api.example.com/usage?x=1";
        assert_eq!(remaining("gate-test", url, now), None);

        let wait = record_429("gate-test", url, Some("120"), now);
        assert_eq!(wait, Duration::from_secs(120));

        let later = now + Duration::from_secs(20);
        assert_eq!(
            remaining("gate-test", "https://api.example.com/usage?x=2", later),
            Some(Duration::from_secs(100))
        );
        assert_eq!(remaining("other-plugin", url, later), None);
        assert_eq!(
            remaining("gate-test", "https://api.example.com/other", later),
            None
        );

        assert_eq!(remaining("gate-test", url, now + wait), None);
    }

    #[test]
    fn missing_or_bad_retry_after_uses_default_and_huge_is_capped() {
        let now = Instant::now();
        assert_eq!(record_429("gate-default", "u1", None, now), DEFAULT_WAIT);
        assert_eq!(
            record_429("gate-default", "u2", Some("soon"), now),
            DEFAULT_WAIT
        );
        assert_eq!(
            record_429("gate-default", "u3", Some("999999"), now),
            MAX_WAIT
        );
    }

    #[test]
    fn parses_retry_after_seconds_and_http_date() {
        let now = UNIX_EPOCH + Duration::from_secs(1_776_160_800); // 2026-04-14T10:00:00Z
        assert_eq!(
            parse_retry_after(" 90 ", now),
            Some(Duration::from_secs(90))
        );
        assert_eq!(
            parse_retry_after("Tue, 14 Apr 2026 10:15:00 GMT", now),
            Some(Duration::from_secs(15 * 60))
        );
        assert_eq!(
            parse_retry_after("Tue, 14 Apr 2026 09:00:00 GMT", now),
            Some(Duration::ZERO)
        );
        assert_eq!(
            parse_retry_after("Tuesday, 14-Apr-26 10:15:00 GMT", now),
            None
        );
        assert_eq!(parse_retry_after("-5", now), None);
    }
}
