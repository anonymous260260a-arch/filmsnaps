/// Cosmetic filtering primitives: one CSS block plus the engine's scriptlets.
/// CSS applies to nodes added later, so newly injected ads are covered without
/// a MutationObserver round-trip.
pub struct CosmeticInjection {
    pub style: String,
    pub script: String,
}

/// Cosmetic selectors from `##rule` lines that apply to `page_url`.
///
/// adblock-rust only returns host-scoped cosmetics and class-keyed generic
/// selectors from `url_cosmetic_resources`; the project's list is written as
/// generic attribute selectors, which become plain CSS here.
pub fn selectors_for(rules: &str, page_url: &str) -> Vec<String> {
    let page_host = page_host(page_url);
    rules
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.starts_with('!') || line.is_empty() {
                return None;
            }
            let (domains, selector) = line.split_once("##")?;
            let selector = selector.trim();
            if selector.is_empty() || selector.starts_with("+js(") {
                return None;
            }
            if domains.is_empty() || applies_to(domains, page_host.as_deref()) {
                Some(selector.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn page_host(page_url: &str) -> Option<String> {
    let rest = page_url.split("://").nth(1)?;
    let host = rest.split(['/', '?', '#']).next()?;
    Some(host.split('@').next_back()?.split(':').next()?.to_lowercase())
}

fn applies_to(domains: &str, page_host: Option<&str>) -> bool {
    let Some(page_host) = page_host else {
        return false;
    };
    domains.split(',').any(|entry| {
        let entry = entry.trim().to_lowercase();
        let (negated, domain) = match entry.strip_prefix('~') {
            Some(rest) => (true, rest),
            None => (false, entry.as_str()),
        };
        let matches = page_host == domain || page_host.ends_with(&format!(".{domain}"));
        matches != negated
    })
}

pub fn render_injection(selectors: Vec<String>, injected_script: &str) -> CosmeticInjection {
    let style = if selectors.is_empty() {
        String::new()
    } else {
        let rules: String = selectors
            .iter()
            .map(|sel| format!("{sel}{{display:none!important}}"))
            .collect();
        format!("<style>{rules}</style>")
    };
    CosmeticInjection {
        style,
        script: injected_script.to_string(),
    }
}

pub(crate) fn css_text(style_block: &str) -> String {
    match (style_block.find('>'), style_block.rfind("</style>")) {
        (Some(start), Some(end)) if end > start => style_block[start + 1..end].to_string(),
        _ => String::new(),
    }
}

pub(crate) fn js_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

pub(crate) fn js_string_array(values: &[&str]) -> String {
    let items: Vec<String> = values.iter().map(|v| js_string(v)).collect();
    format!("[{}]", items.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_rules_become_selectors() {
        let rules = "! comment\n##.ad-banner\n##div[class*=\"ad-container\"]\n";
        let selectors = selectors_for(rules, "https://provider.example/watch");
        assert_eq!(selectors.len(), 2);
        assert!(selectors.contains(&".ad-banner".to_string()));
    }

    #[test]
    fn host_scoped_rules_only_match_their_host() {
        let rules = "other.example##.only-there\n";
        assert!(selectors_for(rules, "https://provider.example/w").is_empty());
        assert_eq!(
            selectors_for(rules, "https://cdn.other.example/w").len(),
            1
        );
    }

    #[test]
    fn scriptlets_are_not_treated_as_selectors() {
        assert!(selectors_for("##+js(no-fetch)", "https://a.example").is_empty());
    }

    #[test]
    fn hides_selectors() {
        let injection = render_injection(vec![".ad-banner".into()], "");
        assert!(injection.style.contains(".ad-banner{display:none!important}"));
    }

    #[test]
    fn empty_selectors_produce_no_style_block() {
        assert!(render_injection(vec![], "").style.is_empty());
    }

    #[test]
    fn css_extraction_strips_style_tags() {
        assert_eq!(css_text("<style>.a{}</style>"), ".a{}");
        assert_eq!(css_text(""), "");
    }

    #[test]
    fn js_strings_escape_quotes_and_newlines() {
        assert_eq!(js_string(r#"a"b"#), r#""a\"b""#);
        assert_eq!(js_string("a\nb"), r#""a\nb""#);
    }
}
