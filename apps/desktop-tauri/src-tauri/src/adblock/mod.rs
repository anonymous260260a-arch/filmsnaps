pub mod cosmetic;
pub mod hook;
pub mod inpage;

use std::cell::RefCell;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use adblock::request::Request;
use adblock::Engine;

use crate::adblock::cosmetic::{render_injection, CosmeticInjection};

thread_local! {
    /// adblock-rust's Engine holds `Rc`/`RefCell` internals, so it is neither
    /// `Send` nor `Sync`. Each thread that filters builds its own engine once.
    static ENGINE_CACHE: RefCell<Option<(u64, Engine)>> = const { RefCell::new(None) };
}

pub struct AdBlocker {
    rules: String,
    rules_hash: u64,
    rule_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decision {
    pub blocked: bool,
}

impl AdBlocker {
    pub fn from_rules_text(rules: &str) -> Self {
        let rule_count = rules
            .lines()
            .filter(|line| {
                let line = line.trim();
                !line.is_empty() && !line.starts_with('!') && !line.starts_with('[')
            })
            .count();
        Self {
            rules: rules.to_string(),
            rules_hash: hash(rules),
            rule_count,
        }
    }

    pub fn rule_count(&self) -> usize {
        self.rule_count
    }

    /// `resource_type` follows the adblock-rust vocabulary: "document",
    /// "sub_frame", "script", "image", "xmlhttprequest", "media", "font", …
    pub fn check(&self, url: &str, source_url: &str, resource_type: &str, method: &str) -> Decision {
        self.with_engine(|engine| {
            let Ok(request) = Request::new(url, source_url, resource_type, method) else {
                // Unparseable URLs (data:, blob:) are never ad requests.
                return Decision { blocked: false };
            };
            Decision {
                blocked: engine.check_network_request(&request).should_block(),
            }
        })
    }

    pub fn cosmetic_for(&self, page_url: &str) -> CosmeticInjection {
        let mut selectors = cosmetic::selectors_for(&self.rules, page_url);
        let scriptlets = self.with_engine(|engine| {
            let resources = engine.url_cosmetic_resources(page_url);
            selectors.extend(resources.hide_selectors.iter().cloned());
            resources.injected_script
        });
        selectors.sort();
        selectors.dedup();
        render_injection(selectors, &scriptlets)
    }

    fn with_engine<R>(&self, f: impl FnOnce(&Engine) -> R) -> R {
        ENGINE_CACHE.with(|cache| {
            let mut slot = cache.borrow_mut();
            let stale = match slot.as_ref() {
                Some((hash, _)) => *hash != self.rules_hash,
                None => true,
            };
            if stale {
                *slot = Some((
                    self.rules_hash,
                    Engine::new_with_list_text(self.rules.clone()),
                ));
            }
            let engine = &slot.as_ref().expect("engine was just built").1;
            f(engine)
        })
    }
}

fn hash(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULES: &str = r#"
! test list
||doubleclick.net^
||adserver.example^$script
@@||cdn.cloudfront.net^
##.ad-banner
"#;

    fn engine() -> AdBlocker {
        AdBlocker::from_rules_text(RULES)
    }

    #[test]
    fn blocks_an_ad_host() {
        let decision = engine().check(
            "https://ads.doubleclick.net/pixel.gif",
            "https://provider.example/watch",
            "image",
            "GET",
        );
        assert!(decision.blocked);
    }

    #[test]
    fn allows_an_excepted_cdn() {
        let decision = engine().check(
            "https://d1.cloudfront.net/stream.m3u8",
            "https://provider.example/watch",
            "media",
            "GET",
        );
        assert!(!decision.blocked, "@@ exceptions must survive");
    }

    #[test]
    fn allows_unrelated_requests() {
        let decision = engine().check(
            "https://provider.example/api/play",
            "https://provider.example/watch",
            "xmlhttprequest",
            "GET",
        );
        assert!(!decision.blocked);
    }

    #[test]
    fn counts_rules_ignoring_comments() {
        assert_eq!(engine().rule_count(), 4);
    }

    #[test]
    fn cosmetic_rules_reach_the_page() {
        let injection = engine().cosmetic_for("https://provider.example/watch");
        assert!(injection.style.contains(".ad-banner"));
    }

    #[test]
    fn blocker_is_send_and_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<AdBlocker>();
    }
}
