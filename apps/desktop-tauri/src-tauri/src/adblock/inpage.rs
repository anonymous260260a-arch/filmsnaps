//! In-page layer, injected at document-start into the provider webview.
//! Covers what network filtering alone misses: pop-unders, ad frames created
//! after load, and players that rebuild their ad elements on seek.

use super::cosmetic::{css_text, js_string, js_string_array};
use super::AdBlocker;

const AD_FRAME_SELECTORS: &[&str] = &["iframe[src*='ad']", "iframe[id*='ad']"];

pub fn bundle(blocker: &AdBlocker, page_url: &str) -> String {
    let cosmetic = blocker.cosmetic_for(page_url);
    let css = css_text(&cosmetic.style);

    format!(
        r#"(function(){{
if(window.__filmsnapsBlocked){{return;}}window.__filmsnapsBlocked=1;
var css={css};
function paint(){{
  if(!css){{return;}}
  var style=document.getElementById('__filmsnaps_cosmetic');
  if(!style){{
    style=document.createElement('style');
    style.id='__filmsnaps_cosmetic';
    (document.head||document.documentElement).appendChild(style);
  }}
  style.textContent=css;
}}
paint();
document.addEventListener('DOMContentLoaded',paint);
try{{{scriptlets}}}catch(e){{}}
try{{
  window.open=function(){{return null;}};
}}catch(e){{}}
var sels={selectors};
function sweep(){{
  for(var i=0;i<sels.length;i++){{
    var nodes=document.querySelectorAll(sels[i]);
    for(var j=0;j<nodes.length;j++){{nodes[j].style.display='none';}}
  }}
}}
sweep();
try{{new MutationObserver(sweep).observe(document.documentElement,{{childList:true,subtree:true}});}}catch(e){{}}
}})();"#,
        css = js_string(&css),
        scriptlets = cosmetic.script,
        selectors = js_string_array(AD_FRAME_SELECTORS),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blocker() -> AdBlocker {
        AdBlocker::from_rules_text("||ads.example^\n##.ad-banner\n")
    }

    #[test]
    fn bundle_embeds_cosmetic_css() {
        let script = bundle(&blocker(), "https://provider.example/watch");
        assert!(script.contains(".ad-banner"), "{script}");
    }

    #[test]
    fn bundle_neutralises_window_open() {
        assert!(bundle(&blocker(), "https://provider.example/w").contains("window.open="));
    }
}
