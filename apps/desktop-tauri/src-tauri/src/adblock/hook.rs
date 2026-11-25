//! Network layer: cancels blocked requests inside WebView2 before they leave
//! the process, and counts them for the status screen.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use super::AdBlocker;

static BLOCKED_REQUESTS: AtomicU64 = AtomicU64::new(0);

pub fn blocked_count() -> u64 {
    BLOCKED_REQUESTS.load(Ordering::Relaxed)
}

#[cfg(windows)]
pub fn attach(
    webview: &tauri::Webview,
    blocker: Arc<AdBlocker>,
    page_url: String,
) -> Result<(), String> {
    let page_url = Arc::new(page_url);

    webview
        .with_webview(move |platform| {
            if let Err(err) = install(platform, blocker, page_url) {
                eprintln!("[adblock] could not install the request filter: {err}");
            }
        })
        .map_err(|err| err.to_string())
}

#[cfg(windows)]
fn install(
    platform: tauri::webview::PlatformWebview,
    blocker: Arc<AdBlocker>,
    page_url: Arc<String>,
) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2WebResourceRequestedEventArgs, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
    };
    use webview2_com::WebResourceRequestedEventHandler;
    use windows::core::{w, PWSTR};
    use windows::Win32::System::Com::IStream;

    let controller = platform.controller();
    let core = unsafe { controller.CoreWebView2()? };
    let environment = platform.environment();

    unsafe {
        core.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
    }

    let handler = WebResourceRequestedEventHandler::create(Box::new(
        move |_sender, args: Option<ICoreWebView2WebResourceRequestedEventArgs>| {
            let Some(args) = args else { return Ok(()) };
            let request = unsafe { args.Request()? };
            let mut uri = PWSTR::null();
            let url = match unsafe { request.Uri(&mut uri) } {
                Ok(()) => unsafe { uri.to_string() }.unwrap_or_default(),
                Err(_) => String::new(),
            };
            if url.is_empty() {
                return Ok(());
            }

            let resource_type = resource_type_name(&args);
            if !blocker.check(&url, &page_url, resource_type, "GET").blocked {
                return Ok(());
            }

            BLOCKED_REQUESTS.fetch_add(1, Ordering::Relaxed);
            let response = unsafe {
                environment.CreateWebResourceResponse(
                    None::<&IStream>,
                    403,
                    w!("Blocked"),
                    w!(""),
                )?
            };
            unsafe { args.SetResponse(&response)? };
            Ok(())
        },
    ));

    let mut token = 0i64;
    unsafe { core.add_WebResourceRequested(&handler, &mut token)? };
    Ok(())
}

#[cfg(windows)]
fn resource_type_name(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceRequestedEventArgs,
) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;

    let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT(0);
    if unsafe { args.ResourceContext(&mut context) }.is_err() {
        return "other";
    }
    if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT {
        "document"
    } else if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT {
        "script"
    } else if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE {
        "image"
    } else if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA {
        "media"
    } else if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET {
        "stylesheet"
    } else if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT {
        "font"
    } else if context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST {
        "xmlhttprequest"
    } else {
        "other"
    }
}

#[cfg(not(windows))]
pub fn attach(
    _webview: &tauri::Webview,
    _blocker: Arc<AdBlocker>,
    _page_url: String,
) -> Result<(), String> {
    Err("network-level ad blocking is implemented for Windows only".to_string())
}
