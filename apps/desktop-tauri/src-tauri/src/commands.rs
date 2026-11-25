use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl};
use tauri_plugin_dialog::DialogExt;

use crate::{expiry, AppState, ProviderWebview};

#[derive(Serialize)]
pub struct AppStatus {
    pub signature_verified: bool,
    pub providers: usize,
    pub rules: usize,
    pub mpv_available: bool,
    pub mpv_error: Option<String>,
    pub blocked_requests: u64,
    pub config_dir: String,
}

#[tauri::command]
pub fn app_status(state: State<'_, Arc<AppState>>) -> AppStatus {
    AppStatus {
        signature_verified: state.config.signature_verified,
        providers: state.config.provider_count(),
        rules: state.blocker.rule_count(),
        mpv_available: state.player.available(),
        mpv_error: state.player.error(),
        blocked_requests: crate::adblock::hook::blocked_count(),
        config_dir: state.config.config_dir.display().to_string(),
    }
}

#[derive(serde::Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

// ── Provider webview ──────────────────────────────────────────────

/// `Window::add_child` deadlocks on Windows when it runs on the main thread,
/// which is where sync commands run (tauri::window::Window::add_child — "Known
/// issues"). This must stay `async` so it is polled off the main thread.
#[tauri::command]
pub async fn provider_open(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    url: String,
    rect: Rect,
) -> Result<(), String> {
    let parsed: crate::Url = url
        .parse()
        .map_err(|_| format!("invalid provider URL: {url}"))?;
    let window = app
        .get_window("main")
        .ok_or("main window is not available")?;

    let current = state
        .provider
        .lock()
        .map_err(|_| "provider lock poisoned")?
        .as_ref()
        .map(|provider| (provider.webview.clone(), provider.url.clone()));

    // The page re-requests the same URL when its player remounts (opening the
    // server picker does this); recreating the webview would blank it out.
    if let Some((webview, current_url)) = current {
        if current_url == url {
            crate::player::log("provider already open, reusing it");
            let pending = state.provider_bounds.lock().ok().and_then(|bounds| *bounds);
            if let Some(bounds) = pending {
                if let Err(err) = apply_bounds(&webview, bounds) {
                    crate::player::log(&format!("provider bounds failed: {err}"));
                }
            }
            crate::bridge::emit(&app, "provider://state", serde_json::json!({ "loaded": true }));
            return Ok(());
        }
    }

    // The lock must not be held while the webview is created: WebView2 pumps the
    // main thread's message queue there, which dispatches the page's synchronous
    // provider_set_bounds, and that command takes this same lock.
    let existing = state
        .provider
        .lock()
        .map_err(|_| "provider lock poisoned")?
        .take();
    if let Some(existing) = existing {
        let _ = existing.webview.close();
    }

    crate::player::log(&format!(
        "command provider_open {} at {},{}",
        shorten(&url),
        rect.x,
        rect.y
    ));

    let script = crate::adblock::inpage::bundle(&state.blocker, &url);
    let blank: crate::Url = "about:blank".parse().expect("about:blank is a valid URL");
    let page_load_app = app.clone();
    let builder = tauri::webview::WebviewBuilder::new("provider", WebviewUrl::External(blank))
        .initialization_script(&script)
        .on_page_load(move |_webview, payload| {
            // The initial about:blank would otherwise report "loaded" before the
            // provider has been navigated to.
            if payload.url().scheme() == "about" {
                return;
            }
            let (state, label) = match payload.event() {
                PageLoadEvent::Started => (serde_json::json!({ "loading": true }), "started"),
                PageLoadEvent::Finished => (serde_json::json!({ "loaded": true }), "finished"),
            };
            crate::player::log(&format!("provider page load {label} {}", payload.url()));
            crate::bridge::emit(&page_load_app, "provider://state", state);
        });

    let created = crate::diag::span("provider webview", || {
        window.add_child(
            builder,
            LogicalPosition::new(rect.x, rect.y),
            LogicalSize::new(rect.width.max(1.0), rect.height.max(1.0)),
        )
    });
    let webview = match created {
        Ok(webview) => webview,
        Err(err) => {
            let message = format!("could not create the provider webview: {err}");
            crate::player::log(&message);
            crate::bridge::emit(&app, "provider://state", serde_json::json!({ "error": message }));
            return Err(message);
        }
    };

    let previous = state
        .provider
        .lock()
        .map_err(|_| "provider lock poisoned")?
        .replace(ProviderWebview {
            webview: webview.clone(),
            url: url.clone(),
        });
    if let Some(previous) = previous {
        let _ = previous.webview.close();
    }

    // The page measures its placeholder and pushes bounds before it asks for the
    // webview, so those bounds are applied once the webview exists.
    let pending_bounds = state.provider_bounds.lock().ok().and_then(|bounds| *bounds);
    if let Some(bounds) = pending_bounds {
        if let Err(err) = apply_bounds(&webview, bounds) {
            crate::player::log(&format!("provider bounds failed: {err}"));
        }
    }

    if let Err(err) = crate::adblock::hook::attach(&webview, state.blocker.clone(), url.clone()) {
        eprintln!("[adblock] network filtering unavailable: {err}");
    }

    crate::bridge::emit(&app, "provider://state", serde_json::json!({ "loading": true }));
    crate::player::log(&format!("provider webview created, navigating to {}", shorten(&url)));
    if let Err(err) = webview.navigate(parsed) {
        let _ = webview.close();
        let message = format!("could not load the provider: {err}");
        crate::player::log(&message);
        crate::bridge::emit(&app, "provider://state", serde_json::json!({ "error": message }));
        return Err(message);
    }

    Ok(())
}

#[tauri::command]
pub fn provider_set_bounds(state: State<'_, Arc<AppState>>, rect: Rect) -> Result<(), String> {
    let bounds = (
        rect.x,
        rect.y,
        rect.width.max(1.0),
        rect.height.max(1.0),
    );
    if let Ok(mut pending) = state.provider_bounds.lock() {
        *pending = Some(bounds);
    }
    let slot = state.provider.lock().map_err(|_| "provider lock poisoned")?;
    let Some(provider) = slot.as_ref() else {
        crate::player::log(&format!(
            "provider bounds {},{} {}x{} queued (no webview yet)",
            bounds.0, bounds.1, bounds.2, bounds.3
        ));
        return Ok(());
    };
    apply_bounds(&provider.webview, bounds)
}

fn apply_bounds(webview: &tauri::Webview, bounds: (f64, f64, f64, f64)) -> Result<(), String> {
    let (x, y, width, height) = bounds;
    crate::player::log(&format!("provider bounds -> {x},{y} {width}x{height}"));
    webview
        .set_position(LogicalPosition::new(x, y))
        .and_then(|_| webview.set_size(LogicalSize::new(width, height)))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn provider_set_visible(state: State<'_, Arc<AppState>>, visible: bool) -> Result<(), String> {
    let slot = state.provider.lock().map_err(|_| "provider lock poisoned")?;
    if let Some(provider) = slot.as_ref() {
        let result = if visible {
            provider.webview.show()
        } else {
            provider.webview.hide()
        };
        result.map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn provider_reload(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let slot = state.provider.lock().map_err(|_| "provider lock poisoned")?;
    if let Some(provider) = slot.as_ref() {
        provider.webview.reload().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn provider_close(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut slot = state.provider.lock().map_err(|_| "provider lock poisoned")?;
    if let Some(provider) = slot.take() {
        provider.webview.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

// ── mpv player ────────────────────────────────────────────────────

/// Initialises mpv before the first play. The DLL load and the D3D11 bring-up
/// together cost ~1.8 s, which is exactly the wait between pressing play and
/// the first frame.
pub fn prewarm_player(app: AppHandle) {
    let Some(player) = app
        .try_state::<Arc<AppState>>()
        .map(|state| Arc::clone(&state.player))
    else {
        return;
    };
    std::thread::spawn(move || {
        let Some(window) = app.get_window("main") else {
            return;
        };
        let Ok(hwnd) = parent_hwnd(&window) else {
            return;
        };
        crate::diag::mark!("player", "prewarm start");
        match player.start(&app, hwnd) {
            Ok(()) => crate::diag::mark!("player", "prewarm done"),
            Err(err) => {
                crate::player::log(&format!("player prewarm failed: {err}"));
            }
        }
    });
}

#[tauri::command]
pub fn player_start(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    crate::player::log("command player_start");
    let window = app
        .get_window("main")
        .ok_or("main window is not available")?;
    let hwnd = parent_hwnd(&window)?;
    match state.player.start(&app, hwnd) {
        Ok(()) => Ok(serde_json::json!({ "ready": true })),
        Err(err) => {
            crate::player::log(&format!("player_start failed: {err}"));
            Ok(serde_json::json!({ "ready": false, "error": err }))
        }
    }
}

#[tauri::command]
pub fn player_stop(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.player.shutdown();
    Ok(())
}

#[tauri::command]
pub fn player_open(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    url: String,
    headers: Option<Vec<(String, String)>>,
    start: Option<f64>,
) -> Result<(), String> {
    crate::player::log(&format!("command player_open {}", shorten(&url)));
    if expiry::is_expired(&url, expiry::now_ms()) {
        crate::player::log("refusing an expired link; the UI should fetch fresh ones");
        return Err("This source expired — fetching fresh links".to_string());
    }
    let window = app
        .get_window("main")
        .ok_or("main window is not available")?;
    // Anything that is not a real position means "from the beginning"; mpv
    // rejects such a value as a per-file option.
    let start = start.filter(|seconds| seconds.is_finite() && *seconds > 0.0);
    state.player.start(&app, parent_hwnd(&window)?)?;
    state.player.load(&url, headers.as_deref(), start)
}

#[tauri::command]
pub fn player_bounds(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    rect: Rect,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or("main window is not available")?;
    let scale = window.scale_factor().unwrap_or(1.0);
    state.player.set_bounds(
        (rect.x * scale).round() as i32,
        (rect.y * scale).round() as i32,
        (rect.width * scale).round() as i32,
        (rect.height * scale).round() as i32,
    );
    Ok(())
}

#[tauri::command]
pub fn player_visible(state: State<'_, Arc<AppState>>, visible: bool) {
    crate::player::log(&format!("command player_visible {visible}"));
    state.player.set_visible(visible);
}

#[tauri::command]
pub fn player_control(
    state: State<'_, Arc<AppState>>,
    action: String,
    value: Option<f64>,
) -> Result<(), String> {
    crate::player::log(&format!("command player_control {action} {value:?}"));
    let number = || value.ok_or_else(|| format!("action '{action}' needs a value"));
    match action.as_str() {
        "play" => state.player.command(&["set", "pause", "no"]),
        "pause" => state.player.command(&["set", "pause", "yes"]),
        "toggle" => state.player.command(&["cycle", "pause"]),
        "seek" => state
            .player
            .command(&["seek", &number()?.to_string(), "absolute", "exact"]),
        "volume" => state.player.set_property("volume", &number()?.to_string()),
        "speed" => state.player.set_property("speed", &number()?.to_string()),
        "mute" => state.player.set_property("mute", "yes"),
        "unmute" => state.player.set_property("mute", "no"),
        "stop" => state.player.command(&["stop"]),
        other => Err(format!("unknown player action: {other}")),
    }
}

#[tauri::command]
pub fn player_set_property(
    state: State<'_, Arc<AppState>>,
    name: String,
    value: String,
) -> Result<(), String> {
    state.player.set_property(&name, &normalise_flag(&name, value))
}

/// mpv's string property API only accepts `yes`/`no` for flags, while the page
/// sends JS booleans as `"true"`/`"false"`.
fn normalise_flag(name: &str, value: String) -> String {
    if !matches!(name, "mute" | "pause") {
        return value;
    }
    match value.as_str() {
        "true" => "yes".to_string(),
        "false" => "no".to_string(),
        _ => value,
    }
}

#[tauri::command]
pub fn player_state(state: State<'_, Arc<AppState>>) -> Value {
    state.player.state_json()
}

#[tauri::command]
pub fn player_osc_source(state: State<'_, Arc<AppState>>, label: String) {
    state.player.script_message(&[
        "script-message-to",
        crate::player::OSC_CLIENT,
        "fs-state",
        "source",
        &label,
    ]);
}

#[tauri::command]
pub fn player_osc_status(
    state: State<'_, Arc<AppState>>,
    status: String,
    detail: Option<String>,
) {
    if !matches!(
        status.as_str(),
        "buffering" | "switching" | "playing" | "idle" | "error"
    ) {
        return;
    }
    let mut args = vec![
        "script-message-to",
        crate::player::OSC_CLIENT,
        "fs-status",
        &status,
    ];
    if let Some(detail) = detail.as_deref().filter(|value| !value.is_empty()) {
        args.push(detail);
    }
    state.player.script_message(&args);
}

#[tauri::command]
pub fn player_osc_panel(state: State<'_, Arc<AppState>>, open: bool) {
    crate::player::log(&format!("command player_osc_panel open={open}"));
    state.player.script_message(&[
        "script-message-to",
        crate::player::OSC_CLIENT,
        "fs-panel",
        if open { "open" } else { "closed" },
    ]);
}

fn shorten(url: &str) -> String {
    if url.len() <= 120 {
        url.to_string()
    } else {
        format!("{}…", &url[..120])
    }
}

// ── API proxy ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub content_type: Option<String>,
    /// Base64 of the response body; the page decodes it into a Response.
    pub body: String,
}

/// One pooled client for every API call. Building a client per request meant a
/// new TCP handshake and TLS negotiation to the Worker every time, and the home
/// page fires four requests at once on startup.
fn api_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("FilmSnaps/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(stringify)?;
    Ok(CLIENT.get_or_init(|| client))
}

/// The deployed Worker reflects only browser origins it knows, so a request
/// from the Tauri origin is rejected by CORS. Fetching server-side removes
/// CORS from the picture without touching the deployed Worker.
#[tauri::command]
pub async fn api_fetch(
    url: String,
    method: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
) -> Result<ApiResponse, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("refusing to proxy {url}"));
    }
    let started = std::time::Instant::now();
    let client = api_client()?;

    let verb = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("invalid method: {method}"))?;
    let verb_label = verb.as_str().to_string();
    let mut request = client.request(verb, &url);
    for (name, value) in headers {
        let lower = name.to_lowercase();
        // Origin/Referer would make the server apply its CORS allowlist again.
        if matches!(lower.as_str(), "origin" | "referer" | "host" | "content-length") {
            continue;
        }
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(stringify)?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let mut bytes = response.bytes().await.map_err(stringify)?.to_vec();

    crate::diag::mark!(
        "api",
        "{verb_label} {} -> {status} in {} ms ({} bytes)",
        shorten(&url),
        started.elapsed().as_millis(),
        bytes.len()
    );
    eprintln!("[api] {status} {url}");

    if url.contains("/api/player/direct") {
        if let Ok(text) = std::str::from_utf8(&bytes) {
            if let Some((filtered, dropped)) =
                expiry::filter_expired_links(text, expiry::now_ms())
            {
                if dropped > 0 {
                    eprintln!("[api] dropped {dropped} expired link(s)");
                    bytes = filtered.into_bytes();
                }
            }
        }
    }

    use base64::Engine as _;
    Ok(ApiResponse {
        status,
        content_type,
        body: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

// ── window + app plumbing ─────────────────────────────────────────

#[tauri::command]
pub fn window_control(
    window: tauri::WebviewWindow,
    action: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Value, String> {
    let ok = || Ok(serde_json::json!({ "success": true }));
    match action.as_str() {
        "minimize" => window.minimize().map_err(stringify)?,
        // WebView2 ignores `-webkit-app-region`, so the title bar asks for a
        // drag instead of relying on CSS.
        "start_dragging" => window.start_dragging().map_err(stringify)?,
        "maximize" => {
            let maximized = window.is_maximized().map_err(stringify)?;
            if maximized {
                window.unmaximize().map_err(stringify)?;
            } else {
                window.maximize().map_err(stringify)?;
            }
            let now = window.is_maximized().unwrap_or(false);
            notify_maximized(&window, now);
            return Ok(serde_json::json!({ "maximized": now }));
        }
        "is_maximized" => return Ok(serde_json::json!(window.is_maximized().unwrap_or(false))),
        "close" => window.close().map_err(stringify)?,
        "fullscreen_on" => {
            window.set_fullscreen(true).map_err(stringify)?;
            notify_fullscreen(&window, true);
        }
        "fullscreen_off" => {
            window.set_fullscreen(false).map_err(stringify)?;
            notify_fullscreen(&window, false);
        }
        "fullscreen_toggle" => {
            let current = window.is_fullscreen().unwrap_or(false);
            window.set_fullscreen(!current).map_err(stringify)?;
            notify_fullscreen(&window, !current);
        }
        other => return Err(format!("unknown window action: {other}")),
    }
    let _ = &state;
    ok()
}

/// Fullscreen lives on the OS window, so the page cannot observe it through
/// `document.fullscreenElement`. Push the new state on both channels the UI
/// already listens to: `host-fullscreen` for the control bar and
/// `isFullscreen` for the player context.
pub(crate) fn notify_fullscreen(window: &tauri::WebviewWindow, value: bool) {
    let app = window.app_handle();
    if let Some(state) = app.try_state::<Arc<AppState>>() {
        state.player.script_message(&[
            "script-message-to",
            crate::player::OSC_CLIENT,
            "fs-state",
            "fullscreen",
            if value { "yes" } else { "no" },
        ]);
    }
    crate::bridge::emit(
        app,
        "mpv://event",
        serde_json::json!({ "type": "host-fullscreen", "value": value }),
    );
    crate::bridge::emit(
        app,
        "provider://state",
        serde_json::json!({ "isFullscreen": value }),
    );
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs can be opened externally".to_string());
    }
    open_url(&url)
}

#[tauri::command]
pub fn legal_state(app: AppHandle) -> bool {
    legal_marker(&app).map(|path| path.exists()).unwrap_or(false)
}

#[tauri::command]
pub fn legal_accept(app: AppHandle) -> Result<(), String> {
    let path = legal_marker(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(stringify)?;
    }
    std::fs::write(&path, "accepted").map_err(stringify)
}

#[tauri::command]
pub fn clear_cache(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main webview is not available")?;
    window
        .eval("window.location.reload()")
        .map_err(stringify)?;
    Ok(())
}

// ── Downloads ─────────────────────────────────────────────────────

#[tauri::command]
pub fn download_start(
    state: State<'_, Arc<AppState>>,
    meta: crate::downloads::Meta,
) -> Result<(), String> {
    state.downloads.start(meta)
}

#[tauri::command]
pub fn download_pause(state: State<'_, Arc<AppState>>, id: String) {
    state.downloads.pause(&id);
}

#[tauri::command]
pub fn download_resume(state: State<'_, Arc<AppState>>, id: String) {
    state.downloads.resume(&id);
}

#[tauri::command]
pub fn download_cancel(state: State<'_, Arc<AppState>>, id: String) {
    state.downloads.cancel(&id);
}

#[tauri::command]
pub fn download_get_all(state: State<'_, Arc<AppState>>) -> Vec<crate::downloads::Task> {
    state.downloads.tasks()
}

#[tauri::command]
pub fn download_open(state: State<'_, Arc<AppState>>, id: String) {
    state.downloads.reveal(&id);
}

#[tauri::command]
pub fn download_clear(state: State<'_, Arc<AppState>>, id: String, delete_file: Option<bool>) {
    state.downloads.clear(&id, delete_file.unwrap_or(false));
}

#[tauri::command]
pub fn download_speed_limit(state: State<'_, Arc<AppState>>, level: String) {
    state.downloads.set_speed_limit(&level);
}

#[tauri::command]
pub fn download_folder(state: State<'_, Arc<AppState>>) -> String {
    state.downloads.save_dir()
}

#[tauri::command]
pub fn download_set_folder(state: State<'_, Arc<AppState>>, dir: String) -> Result<(), String> {
    state.downloads.set_save_dir(&dir)
}

#[tauri::command]
pub async fn download_pick_folder(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(stringify)?;
    let dir = path.display().to_string();
    state.downloads.set_save_dir(&dir)?;
    Ok(Some(dir))
}

// ── Updates ───────────────────────────────────────────────────────

use tauri_plugin_updater::{Update, UpdaterExt};

fn update_status(app: &AppHandle, status: Value) {
    crate::bridge::emit(app, "update:status", status);
}

/// Full check plus background download. `quiet` is set by the start-up check:
/// it hides the parts nobody asked for ("checking", "not available" and
/// errors), so a feed that is not published yet stays silent.
pub(crate) fn spawn_update_check(app: AppHandle, quiet: bool) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run_update_check(&app, quiet).await {
            eprintln!("[updater] check failed: {err}");
            if !quiet {
                update_status(&app, serde_json::json!({ "type": "error", "message": err }));
            }
        }
    });
}

async fn run_update_check(app: &AppHandle, quiet: bool) -> Result<(), String> {
    if !quiet {
        update_status(app, serde_json::json!({ "type": "checking" }));
    }
    let updater = app.updater().map_err(stringify)?;
    let update = updater.check().await.map_err(|err| err.to_string())?;
    let Some(update) = update else {
        if !quiet {
            update_status(app, serde_json::json!({ "type": "not-available" }));
        }
        return Ok(());
    };
    update_status(
        app,
        serde_json::json!({
            "type": "available",
            "version": update.version,
            "releaseNotes": update.body.clone().unwrap_or_default(),
        }),
    );
    let download_app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = download_update(&download_app, update).await {
            eprintln!("[updater] download failed: {err}");
            if !quiet {
                update_status(
                    &download_app,
                    serde_json::json!({ "type": "error", "message": err }),
                );
            }
        }
    });
    Ok(())
}

async fn download_update(app: &AppHandle, update: Update) -> Result<(), String> {
    let version = update.version.clone();
    let status_app = app.clone();
    let mut transferred: u64 = 0;
    let mut total: u64 = 0;
    let mut window = std::time::Instant::now();
    let mut window_bytes: u64 = 0;
    let bytes = update
        .download(
            move |chunk, length| {
                transferred += chunk as u64;
                window_bytes += chunk as u64;
                if let Some(length) = length {
                    total = length;
                }
                if window.elapsed() < std::time::Duration::from_millis(500) {
                    return;
                }
                let per_second = (window_bytes as f64 / window.elapsed().as_secs_f64()) as u64;
                window = std::time::Instant::now();
                window_bytes = 0;
                let percent = if total > 0 {
                    ((transferred as f64 / total as f64) * 100.0).round().min(100.0) as u64
                } else {
                    0
                };
                update_status(
                    &status_app,
                    serde_json::json!({
                        "type": "downloading",
                        "percent": percent,
                        "bytesPerSecond": per_second,
                        "total": total,
                        "transferred": transferred,
                    }),
                );
            },
            || {},
        )
        .await
        .map_err(|err| err.to_string())?;
    let state = app.state::<Arc<AppState>>();
    *state
        .pending_update
        .lock()
        .map_err(|_| "the update state is locked".to_string())? = Some((update, bytes));
    update_status(app, serde_json::json!({ "type": "downloaded", "version": version }));
    Ok(())
}

#[tauri::command]
pub fn update_check(app: AppHandle) {
    spawn_update_check(app, false);
}

/// Installs the update downloaded by `update_check` and relaunches. Only the
/// user's own click reaches this: installing closes the app, so it must never
/// happen while someone is watching something.
#[tauri::command]
pub fn update_install(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let pending = state
        .pending_update
        .lock()
        .map_err(|_| "the update state is locked".to_string())?;
    let Some((update, bytes)) = pending.as_ref() else {
        return Err("no update has been downloaded yet".to_string());
    };
    // Windows: launches the installer and exits this process; the installer
    // then starts the new version again.
    update
        .install(bytes)
        .map_err(|err| format!("the update could not be installed: {err}"))?;
    app.restart()
}

// ── Media sources ─────────────────────────────────────────────────

const FALIX_API_BASE: &str = "https://download-falixm.koyeb.app";

#[tauri::command]
pub async fn falix_detail(id: String) -> Result<Value, String> {
    if id.is_empty() || !id.chars().all(|character| character.is_ascii_digit()) {
        return Err("Invalid falix id".to_string());
    }
    let trimmed = id.trim_start_matches('0');
    let trimmed = if trimmed.is_empty() { "0" } else { trimmed };
    let url = format!("{FALIX_API_BASE}/api/id/{trimmed}");
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(stringify)?;
        let response = client
            .get(&url)
            .send()
            .map_err(|err| format!("Falix request failed: {err}"))?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err("Falix not found (404)".to_string());
        }
        if !status.is_success() {
            return Err(format!("Falix API error: {status}"));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        if !content_type.contains("json") {
            return Err("Falix API returned non-JSON (host down?)".to_string());
        }
        let body = response.text().map_err(stringify)?;
        serde_json::from_str::<Value>(&body)
            .map_err(|err| format!("Falix API returned unreadable JSON: {err}"))
    })
    .await
    .map_err(stringify)?
}

/// Downloads an online subtitle and hands it to mpv. mpv sniffs the format, so
/// the extension only has to be something it will read.
#[tauri::command]
pub async fn player_sub_add(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    url: String,
    title: Option<String>,
) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) subtitle links are supported".to_string());
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(stringify)?
        .join("subtitles");
    std::fs::create_dir_all(&dir).map_err(stringify)?;
    let extension = subtitle_extension(&url);
    let path = dir.join(format!("subtitle-{}.{}", stamp(), extension));
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent(concat!(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FilmSnaps/",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .map_err(stringify)?;
        let response = client
            .get(&url)
            .send()
            .map_err(|err| format!("subtitle download failed: {err}"))?;
        if !response.status().is_success() {
            return Err(format!("subtitle server returned {}", response.status()));
        }
        let bytes = response.bytes().map_err(stringify)?;
        if bytes.is_empty() {
            return Err("the subtitle file is empty".to_string());
        }
        std::fs::write(&target, &bytes)
            .map_err(|err| format!("cannot save the subtitle: {err}"))
    })
    .await
    .map_err(stringify)??;

    let path = path.display().to_string();
    let mut command = vec!["sub-add", path.as_str(), "select"];
    if let Some(title) = title.as_deref().filter(|title| !title.trim().is_empty()) {
        command.push(title);
    }
    state.player.command(&command)
}

#[tauri::command]
pub fn open_devtools(app: AppHandle) {
    #[cfg(debug_assertions)]
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
    #[cfg(not(debug_assertions))]
    let _ = app;
}

fn subtitle_extension(url: &str) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
    if path.ends_with(".ass") {
        "ass"
    } else if path.ends_with(".vtt") {
        "vtt"
    } else {
        "srt"
    }
}

fn stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or(0)
}

fn legal_marker(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| err.to_string())?;
    Ok(dir.join("legal-accepted"))
}

fn notify_maximized(window: &tauri::WebviewWindow, maximized: bool) {
    let _ = window.eval(&format!(
        "window.__filmsnapsNotifyMaximized && window.__filmsnapsNotifyMaximized({maximized});"
    ));
}

fn stringify(err: impl std::fmt::Display) -> String {
    err.to_string()
}

#[cfg(windows)]
fn open_url(url: &str) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let operation = HSTRING::from("open");
    let target = HSTRING::from(url);
    let result = unsafe {
        ShellExecuteW(
            None,
            &operation,
            &target,
            windows::core::PCWSTR::null(),
            windows::core::PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        return Err(format!("could not open {url} in the default browser"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn open_url(_url: &str) -> Result<(), String> {
    Err("opening external URLs is implemented for Windows only".to_string())
}

#[cfg(windows)]
fn parent_hwnd(window: &tauri::Window) -> Result<isize, String> {
    let hwnd = window.hwnd().map_err(|err| err.to_string())?;
    Ok(hwnd.0 as isize)
}

#[cfg(not(windows))]
fn parent_hwnd(_window: &tauri::Window) -> Result<isize, String> {
    Err("the native video surface is implemented for Windows only".to_string())
}
