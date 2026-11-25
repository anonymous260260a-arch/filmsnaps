//! Expiry checks for presigned media URLs.
//!
//! R2/S3 links carry `X-Amz-Date` and `X-Amz-Expires` in the query string, so
//! a dead link is detectable locally — no HEAD request, no 403 round trip.

const DATE_PARAM: &str = "X-Amz-Date=";
const EXPIRES_PARAM: &str = "X-Amz-Expires=";
const DATE_LEN: usize = 16;

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Milliseconds since the epoch at which `url` stops working, or `None` when
/// the URL carries no signature (unsigned hosts stay usable).
pub fn expires_at_ms(url: &str) -> Option<i64> {
    let signed = signed_at_ms(url)?;
    let lifetime: i64 = param(url, EXPIRES_PARAM)?.parse().ok()?;
    Some(signed + lifetime * 1000)
}

pub fn is_expired(url: &str, now: i64) -> bool {
    matches!(expires_at_ms(url), Some(expires) if expires <= now)
}

/// Drops expired entries from a `/api/player/direct` payload.
///
/// Returns the rewritten JSON and how many links went away, or `None` when the
/// body is not a link payload. Dropped entries are renumbered so the UI's
/// index-based selection still addresses the surviving links.
pub fn filter_expired_links(body: &str, now: i64) -> Option<(String, usize)> {
    let mut document: serde_json::Value = serde_json::from_str(body).ok()?;
    let links = document.get_mut("links")?.as_array_mut()?;
    let before = links.len();

    links.retain(|link| {
        let url = link.get("url").and_then(|url| url.as_str()).unwrap_or("");
        !is_expired(url, now)
    });

    for (index, link) in links.iter_mut().enumerate() {
        if let Some(object) = link.as_object_mut() {
            object.insert("id".into(), serde_json::Value::String(index.to_string()));
        }
    }

    let dropped = before - links.len();
    if dropped == 0 && before == links.len() {
        return Some((body.to_string(), 0));
    }
    Some((serde_json::to_string(&document).ok()?, dropped))
}

fn signed_at_ms(url: &str) -> Option<i64> {
    let stamp = param(url, DATE_PARAM)?;
    if stamp.len() != DATE_LEN {
        return None;
    }
    let number = |range: std::ops::Range<usize>| stamp.get(range)?.parse::<i64>().ok();
    let year = number(0..4)?;
    let month = number(4..6)?;
    let day = number(6..8)?;
    let hour = number(9..11)?;
    let minute = number(11..13)?;
    let second = number(13..15)?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(((days * 24 + hour) * 60 * 60 + minute * 60 + second) * 1000)
}

fn param<'a>(url: &'a str, key: &str) -> Option<&'a str> {
    let start = url.find(key)? + key.len();
    let rest = &url[start..];
    let end = rest.find('&').unwrap_or(rest.len());
    Some(&rest[..end])
}

/// Howard Hinnant's civil-from-days inverse; avoids a date dependency.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_prime = (month + 9) % 12;
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era =
        year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIGNED_AT_0816: &str = "https://bucket.r2.cloudflarestorage.com/hub/abc?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261121T081621Z&X-Amz-Expires=18000&X-Amz-SignedHeaders=host";

    #[test]
    fn reads_expiry_from_the_signature() {
        let expires = expires_at_ms(SIGNED_AT_0816).expect("signed url");
        // 2026-11-21T08:16:21Z + 5h = 2026-11-21T13:16:21Z
        assert_eq!(expires, 1_795_266_981_000);
    }

    #[test]
    fn unsigned_urls_never_expire() {
        assert_eq!(expires_at_ms("https://pixeldrain.dev/api/file/abc?download="), None);
        assert!(!is_expired("https://pixeldrain.dev/api/file/abc?download=", i64::MAX));
    }

    #[test]
    fn detects_expired_and_live_links() {
        let expires = expires_at_ms(SIGNED_AT_0816).expect("signed url");
        assert!(is_expired(SIGNED_AT_0816, expires + 1));
        assert!(!is_expired(SIGNED_AT_0816, expires - 1));
    }

    #[test]
    fn ignores_malformed_dates() {
        let url = "https://bucket.r2.cloudflarestorage.com/hub/abc?X-Amz-Date=notadate&X-Amz-Expires=600";
        assert_eq!(expires_at_ms(url), None);
        assert!(!is_expired(url, i64::MAX));
    }

    #[test]
    fn drops_expired_links_and_renumbers() {
        let expires = expires_at_ms(SIGNED_AT_0816).expect("signed url");
        let live = SIGNED_AT_0816;
        let body = format!(
            r#"{{"links":[{{"id":"0","url":"{SIGNED_AT_0816}"}},{{"id":"1","url":"https://pixeldrain.dev/api/file/x?download="}},{{"id":"2","url":"{live}"}}]}}"#
        );
        let (filtered, dropped) =
            filter_expired_links(&body, expires + 1).expect("payload");
        assert_eq!(dropped, 2);
        let parsed: serde_json::Value = serde_json::from_str(&filtered).expect("json");
        let links = parsed["links"].as_array().expect("links");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0]["id"], "0");
        assert_eq!(links[0]["url"], "https://pixeldrain.dev/api/file/x?download=");
    }

    #[test]
    fn keeps_everything_when_all_links_are_live() {
        let expires = expires_at_ms(SIGNED_AT_0816).expect("signed url");
        let body = format!(r#"{{"links":[{{"id":"0","url":"{SIGNED_AT_0816}"}}]}}"#);
        let (filtered, dropped) =
            filter_expired_links(&body, expires - 1).expect("payload");
        assert_eq!(dropped, 0);
        assert_eq!(filtered, body);
    }

    #[test]
    fn ignores_bodies_that_are_not_link_payloads() {
        assert!(filter_expired_links(r#"{"error":"nope"}"#, 0).is_none());
        assert!(filter_expired_links("not json", 0).is_none());
    }
}
