pub mod ffi;
pub mod surface;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use self::ffi::{Mpv, MpvApi, MpvEvent, PlayerSnapshot, PropValue};
use self::surface::VideoSurface;

const OBSERVED_PROPERTIES: [(&str, i32); 7] = [
    ("time-pos", ffi::FORMAT_DOUBLE),
    ("duration", ffi::FORMAT_DOUBLE),
    ("pause", ffi::FORMAT_FLAG),
    ("volume", ffi::FORMAT_DOUBLE),
    ("mute", ffi::FORMAT_FLAG),
    ("speed", ffi::FORMAT_DOUBLE),
    ("paused-for-cache", ffi::FORMAT_FLAG),
];

const EVENT_POLL_SECONDS: f64 = 0.5;
const OSC_SCRIPT: &str = "filmsnaps-osc.lua";
pub(crate) const OSC_CLIENT: &str = "filmsnaps_osc";

static REGISTERED_FONTS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

pub struct Track {
    pub id: i64,
    pub kind: String,
    pub lang: Option<String>,
    pub title: Option<String>,
    pub codec: Option<String>,
}

/// One play request: the file, the headers its requests need, and where to
/// start inside it, if not at the beginning.
#[derive(Clone)]
struct LoadRequest {
    url: String,
    headers: String,
    start: Option<f64>,
}

struct Runtime {
    /// Shared so callers can clone the handle and drop the runtime lock before
    /// making a blocking libmpv call.
    mpv: Option<Arc<Mpv>>,
    surface: Option<VideoSurface>,
    snapshot: PlayerSnapshot,
    starting: bool,
    /// Bumped by every start and every shutdown. An initialise thread that
    /// finishes after a shutdown must throw its player away instead of
    /// installing a second mpv nobody tracks (two surfaces, one of them
    /// invisible, is how playback "sometimes does not open").
    generation: u64,
    /// Bounds the UI pushed before the surface existed.
    pending_bounds: Option<(i32, i32, i32, i32)>,
    /// Visibility the UI pushed before the surface existed; applied on first
    /// frames so the page never flashes a black surface over its own chrome.
    pending_visible: Option<bool>,
    /// `play` that arrived before libmpv finished initialising.
    pending_load: Option<LoadRequest>,
    /// When `loadfile` was issued, to time the first frame.
    load_started: Option<Instant>,
    /// URL and headers currently handed to mpv. Cleared when the file ends, so
    /// a repeated play of the file that is already open is a no-op instead of
    /// a reload that drops the decoder, the position and the on-video controls.
    loaded: Option<LoadRequest>,
}

struct InputTarget {
    api: Arc<MpvApi>,
    handle: ffi::MpvHandle,
    /// The start that installed this target. A start that is thrown away
    /// after a shutdown must not clear a newer instance's target.
    generation: u64,
}

// The handle is only used by the window procedure, which runs on the UI thread
// under this mutex; mpv's command API is thread-safe for that call.
unsafe impl Send for InputTarget {}

static INPUT_TARGET: Mutex<Option<InputTarget>> = Mutex::new(None);

// ── OSC watchdog ───────────────────────────────────────────────────
// A live OSC script always accepts `script-message-to filmsnaps_osc …`.
// mpv error -12 (MPV_ERROR_COMMAND in the libmpv-2 enum) means the target
// client is gone — the Lua script terminated. After enough consecutive
// rejections, re-load the script so a crashed control bar recovers within
// milliseconds instead of staying gone for the whole session.
static OSC_REJECTS: AtomicU32 = AtomicU32::new(0);
static OSC_SCRIPT_PATH: Mutex<Option<String>> = Mutex::new(None);
const OSC_REVIVE_THRESHOLD: u32 = 25;

/// Called by the surface when an OSC message was accepted; resets the streak.
pub(crate) fn note_osc_alive() {
    OSC_REJECTS.store(0, Ordering::Relaxed);
}

/// Called by the surface when an OSC message was rejected. Returns true once
/// per streak when the script should be re-loaded.
pub(crate) fn note_osc_rejected() -> bool {
    let n = OSC_REJECTS.fetch_add(1, Ordering::Relaxed) + 1;
    n >= OSC_REVIVE_THRESHOLD
}

/// Re-issues `load-script` for the OSC. Uses the input target's handle, which
/// exists for exactly as long as mpv runs — same access pattern the window
/// procedure already uses for pointer forwarding.
pub(crate) fn revive_osc() {
    OSC_REJECTS.store(0, Ordering::Relaxed);
    let path = OSC_SCRIPT_PATH.lock().ok().and_then(|slot| slot.clone());
    let Some(path) = path else {
        return;
    };
    log(&format!("OSC stopped answering; re-loading {path}"));
    if let Err(err) = forward_input(&["load-script", &path]) {
        log(&format!("OSC revive failed: {err}"));
    }
}

/// Called from the surface window procedure. Dropped silently when no player is
/// running, because the surface outlives a stopped player.
pub(crate) fn forward_input(args: &[&str]) -> Result<(), String> {
    // The handle is copied out so the command runs without the registry lock;
    // this is called from the video surface's window procedure, which is the
    // UI thread.
    let target = {
        let Ok(slot) = INPUT_TARGET.lock() else {
            return Ok(());
        };
        slot.as_ref().map(|target| (Arc::clone(&target.api), target.handle))
    };
    let Some((api, handle)) = target else {
        return Ok(());
    };
    ffi::send_input(&api, handle, args).map_err(|err| err.to_string())
}

fn set_input_target(generation: u64, api: Arc<MpvApi>, handle: ffi::MpvHandle) {
    if let Ok(mut slot) = INPUT_TARGET.lock() {
        *slot = Some(InputTarget {
            api,
            handle,
            generation,
        });
    }
}

/// `None` clears unconditionally (shutdown); `Some(generation)` only clears the
/// target that generation installed, so a late discarded start cannot take the
/// pointer input away from the player that replaced it.
fn clear_input_target(generation: Option<u64>) {
    if let Ok(mut slot) = INPUT_TARGET.lock() {
        let owned = slot
            .as_ref()
            .is_none_or(|target| generation.is_none_or(|g| target.generation == g));
        if owned {
            *slot = None;
        }
    }
}

pub struct Player {
    /// Filled by a loader thread; `start` waits for it if the first play wins
    /// the race.
    api: Arc<OnceLock<Result<Arc<MpvApi>, String>>>,
    runtime: Arc<Mutex<Runtime>>,
    /// Directories the mpv runtime was searched in; the OSC script ships beside it.
    search_dirs: Vec<std::path::PathBuf>,
}

impl Player {
    pub fn new(search_dirs: Vec<std::path::PathBuf>) -> Self {
        let api: Arc<OnceLock<Result<Arc<MpvApi>, String>>> = Arc::new(OnceLock::new());
        // Mapping the 118 MB DLL resolves every import and takes over a second
        // on a cold disk. Doing it here would hold up the first paint.
        let loader = Arc::clone(&api);
        let dirs = search_dirs.clone();
        thread::spawn(move || {
            let _ = loader.set(load_api(&dirs));
        });
        Self {
            api,
            search_dirs: search_dirs.clone(),
            runtime: Arc::new(Mutex::new(Runtime {
                mpv: None,
                surface: None,
                snapshot: PlayerSnapshot::default(),
                starting: false,
                generation: 0,
                pending_bounds: None,
                pending_visible: None,
                loaded: None,
                pending_load: None,
                load_started: None,
            })),
        }
    }

    /// Unknown until the loader finishes, so a still-loading runtime counts as
    /// available; `start` reports a real failure to the page.
    pub fn available(&self) -> bool {
        self.api.get().map_or(true, |result| result.is_ok())
    }

    pub fn error(&self) -> Option<String> {
        self.api.get().and_then(|result| result.as_ref().err().cloned())
    }

    pub fn snapshot(&self) -> PlayerSnapshot {
        lock_runtime(&self.runtime, "snapshot")
            .map(|runtime| runtime.snapshot)
            .unwrap_or_default()
    }

    /// Clones the mpv handle and releases the runtime lock. Every libmpv call
    /// can block for a long time (it talks to the playloop and the scripts), so
    /// none of them may run while the lock the UI thread needs is held.
    fn handle(&self, what: &'static str) -> Result<Arc<Mpv>, String> {
        let runtime = lock_runtime(&self.runtime, what)?;
        runtime
            .mpv
            .clone()
            .ok_or_else(|| "player is not started".to_string())
    }

    /// Creates the video surface on the UI thread (its HWND is owned by the
    /// thread that pumps messages) and initialises libmpv off that thread, so
    /// the window stays interactive while the DLL and GPU come up.
    pub fn start(&self, app: &AppHandle, parent_hwnd: isize) -> Result<(), String> {
        if let Some(Err(err)) = self.api.get() {
            return Err(err.clone());
        }

        let generation = {
            let mut runtime = self.runtime.lock().map_err(|_| "player lock poisoned")?;
            if runtime.mpv.is_some() {
                log("start ignored: already running");
                return Ok(());
            }
            if runtime.starting {
                log("start ignored: already starting");
                return Ok(());
            }
            runtime.starting = true;
            runtime.generation += 1;
            runtime.generation
        };

        log(&format!("creating video surface on parent HWND {parent_hwnd:#x}"));
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let result = VideoSurface::create(parent_hwnd).map_err(|err| err.to_string());
            if let Ok(surface) = &result {
                log(&format!("surface created, hwnd={:#x}", surface.hwnd_value()));
            }
            let _ = tx.send(result);
        })
        .map_err(|err| {
            reset_starting(&self.runtime);
            format!("could not reach the UI thread: {err}")
        })?;

        let surface = crate::diag::span("video surface", || {
            rx.recv()
                .map_err(|_| "UI thread dropped the surface result".to_string())
                .and_then(|result| result)
        })
        .map_err(|err| {
            reset_starting(&self.runtime);
            log(&format!("surface creation failed: {err}"));
            err
        })?;

        let script = find_osc_script(&self.search_dirs);
        let runtime = Arc::clone(&self.runtime);
        let app_handle = app.clone();
        let api_slot = Arc::clone(&self.api);
        let dirs = self.search_dirs.clone();
        thread::spawn(move || {
            let api = match api_slot.get_or_init(|| load_api(&dirs)) {
                Ok(api) => Arc::clone(api),
                Err(err) => {
                    log(&format!("player_start failed: {err}"));
                    reset_starting(&runtime);
                    return;
                }
            };
            let started = Instant::now();
            match initialise(&api, &surface, script.as_deref(), generation) {
                Ok(mpv) => {
                    log(&format!(
                        "mpv initialised in {} ms",
                        started.elapsed().as_millis()
                    ));
                    let (url, bounds, visible) = {
                        let mut guard = match runtime.lock() {
                            Ok(guard) => guard,
                            Err(_) => return,
                        };
                        if guard.generation != generation {
                            // Shut down while this player was initialising; a
                            // newer start owns the runtime now.
                            log("player stopped while starting; discarding the new instance");
                            drop(guard);
                            clear_input_target(Some(generation));
                            let handle = app_handle.clone();
                            let _ = handle.run_on_main_thread(move || drop(surface));
                            return;
                        }
                        guard.mpv = Some(Arc::new(mpv));
                        guard.surface = Some(surface);
                        guard.starting = false;
                        (guard.pending_load.take(), guard.pending_bounds, guard.pending_visible.take())
                    };
                    if let Some((x, y, width, height)) = bounds {
                        log(&format!("applying queued bounds {x},{y} {width}x{height}"));
                        apply_bounds(&runtime, x, y, width, height);
                    }
                    if let Some(visible) = visible {
                        log(&format!("applying queued visibility {visible}"));
                        let hwnd = runtime
                            .lock()
                            .ok()
                            .and_then(|guard| guard.surface.as_ref().map(VideoSurface::hwnd_value));
                        if let Some(hwnd) = hwnd {
                            surface::set_visible(hwnd, visible);
                        }
                    }
                    crate::bridge::emit(&app_handle,  "mpv://ready", json!({ "ready": true }));
                    if let Some(request) = url {
                        log("loading queued URL");
                        if let Err(err) = load(&runtime, &request) {
                            log(&format!("queued load failed: {err}"));
                            crate::bridge::emit(&app_handle,  "mpv://error", json!({ "message": err }));
                        }
                    }
                    spawn_event_pump(runtime, app_handle);
                }
                Err(err) => {
                    log(&format!("mpv initialisation failed: {err}"));
                    let mut guard = match runtime.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    if guard.generation != generation {
                        drop(guard);
                        clear_input_target(Some(generation));
                        let handle = app_handle.clone();
                        let _ = handle.run_on_main_thread(move || drop(surface));
                        return;
                    }
                    guard.starting = false;
                    guard.surface = Some(surface);
                    drop(guard);
                    crate::bridge::emit(&app_handle,  "mpv://error", json!({ "message": err }));
                }
            }
        });

        Ok(())
    }

    pub fn load(
        &self,
        url: &str,
        headers: Option<&[(String, String)]>,
        start: Option<f64>,
    ) -> Result<(), String> {
        load(
            &self.runtime,
            &LoadRequest {
                url: url.to_string(),
                headers: header_fields(headers),
                start,
            },
        )
    }

    pub fn command(&self, args: &[&str]) -> Result<(), String> {
        let mpv = self.handle("command")?;
        mpv.command(args).map_err(|err| {
            let message = err.to_string();
            log(&format!("command {args:?} failed: {message}"));
            message
        })
    }

    /// Best-effort state push to the OSC. Silently dropped before the script
    /// loads; the UI re-sends state when a file becomes active.
    pub fn script_message(&self, args: &[&str]) {
        let Ok(mpv) = self.handle("script-message") else {
            return;
        };
        let _ = mpv.command(args);
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let mpv = self.handle("set-property")?;
        mpv.set_property(name, value).map_err(|err| {
            let message = err.to_string();
            log(&format!("set {name}={value} failed: {message}"));
            message
        })
    }

    pub fn set_bounds(&self, x: i32, y: i32, width: i32, height: i32) {
        apply_bounds(&self.runtime, x, y, width, height);
    }

    pub fn set_visible(&self, visible: bool) {
        let hwnd = match self.runtime.lock() {
            Ok(mut runtime) => match runtime.surface.as_ref() {
                Some(surface) => Some(surface.hwnd_value()),
                None => {
                    log(&format!("visibility {visible} before surface existed"));
                    runtime.pending_visible = Some(visible);
                    None
                }
            },
            Err(_) => None,
        };
        if let Some(hwnd) = hwnd {
            surface::set_visible(hwnd, visible);
        }
    }

    /// Tracks are read through the property API so a single missing or
    /// malformed field cannot drop the whole list.
    pub fn tracks(&self) -> Vec<Track> {
        let Ok(mpv) = self.handle("tracks") else {
            return Vec::new();
        };
        let count: i64 = mpv
            .property("track-list/count")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        (0..count)
            .filter_map(|index| {
                let read = |field: &str| mpv.property(&format!("track-list/{index}/{field}"));
                Some(Track {
                    id: read("id")?.parse().ok()?,
                    kind: read("type")?,
                    lang: read("lang").filter(|v| !v.is_empty()),
                    title: read("title").filter(|v| !v.is_empty()),
                    codec: read("codec").filter(|v| !v.is_empty()),
                })
            })
            .collect()
    }

    pub fn state_json(&self) -> Value {
        let snapshot = self.snapshot();
        let (mpv, loaded_url) = self
            .runtime
            .lock()
            .map(|runtime| {
                (
                    runtime.mpv.clone(),
                    runtime.loaded.as_ref().map(|request| request.url.clone()),
                )
            })
            .unwrap_or((None, None));
        let current = |name: &str| -> Option<i64> {
            mpv.as_ref()?.property(name).and_then(|v| v.parse().ok())
        };
        json!({
            "url": loaded_url,
            "paused": snapshot.paused,
            "position": snapshot.position,
            "duration": snapshot.duration,
            "volume": snapshot.volume,
            "muted": snapshot.muted,
            "speed": snapshot.speed,
            "aid": current("aid").unwrap_or(0),
            "sid": current("sid").unwrap_or(0),
            "trackList": self.tracks().into_iter().map(|track| json!({
                "id": track.id,
                "type": track.kind,
                "lang": track.lang,
                "title": track.title,
                "codec": track.codec,
            })).collect::<Vec<_>>(),
        })
    }

    pub fn shutdown(&self) {
        clear_input_target(None);
        note_osc_alive();
        if let Ok(mut slot) = OSC_SCRIPT_PATH.lock() {
            *slot = None;
        }
        if let Ok(mut runtime) = self.runtime.lock() {
            log("shutting the player down");
            runtime.mpv = None;
            runtime.surface = None;
            runtime.starting = false;
            // This player instance is gone, so the next start has nothing
            // loaded: keeping the record would make the following play of the
            // same file a no-op against a brand-new, empty mpv.
            runtime.generation += 1;
            runtime.loaded = None;
            runtime.pending_load = None;
            runtime.load_started = None;
            runtime.pending_bounds = None;
            runtime.pending_visible = None;
        }
    }
}

fn load_api(search_dirs: &[PathBuf]) -> Result<Arc<MpvApi>, String> {
    let started = Instant::now();
    match MpvApi::load(search_dirs) {
        Ok(api) => {
            log(&format!(
                "libmpv loaded in {} ms",
                started.elapsed().as_millis()
            ));
            Ok(api)
        }
        Err(err) => {
            log(&format!("libmpv unavailable: {err}"));
            Err(err.to_string())
        }
    }
}

fn find_osc_script(search_dirs: &[PathBuf]) -> Option<PathBuf> {
    search_dirs
        .iter()
        .map(|dir| dir.join("scripts").join(OSC_SCRIPT))
        .find(|path| path.is_file())
}

fn system_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\")
        .map_or_else(|| path.to_path_buf(), PathBuf::from)
}

fn register_private_fonts(fonts: &Path) {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        use windows::core::PCWSTR;
        use windows::Win32::Graphics::Gdi::{AddFontResourceExW, FR_PRIVATE};

        let Ok(entries) = std::fs::read_dir(fonts) else {
            return;
        };
        let mut registered = REGISTERED_FONTS
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        for entry in entries.flatten() {
            let path = system_path(&entry.path());
            let is_font = path
                .extension()
                .and_then(OsStr::to_str)
                .is_some_and(|ext| ext.eq_ignore_ascii_case("ttf") || ext.eq_ignore_ascii_case("otf"));
            if !is_font || registered.contains(&path) {
                continue;
            }
            let wide: Vec<u16> = path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let added = unsafe { AddFontResourceExW(PCWSTR(wide.as_ptr()), FR_PRIVATE, None) };
            if added == 0 {
                log(&format!("private font registration failed: {}", path.display()));
            } else {
                registered.push(path);
            }
        }
    }
}

fn initialise(
    api: &Arc<MpvApi>,
    surface: &VideoSurface,
    script: Option<&Path>,
    generation: u64,
) -> Result<Mpv, String> {
    let mpv = Mpv::new(Arc::clone(api)).map_err(|err| err.to_string())?;

    let options = vec![
        ("config", "no"),
        // Dev builds print mpv's own log (HTTP status, demuxer errors) to stderr.
        ("terminal", if cfg!(debug_assertions) { "yes" } else { "no" }),
        ("msg-level", "all=info,http=debug"),
        (
            "script-opts",
            "filmsnaps_osc-input=mirror,filmsnaps_osc-autohide_ms=2000,filmsnaps_osc-font_ui=Geist,filmsnaps_osc-font_mono=Geist Mono,filmsnaps_osc-delay_row=yes,filmsnaps_osc-hover_preview=yes",
        ),
        // Without this mpv has no pointer state for the embedded window.
        ("input-vo-keyboard", "yes"),
        // The OSC owns input; mpv's default mouse bindings would fight it.
        (
            "input-default-bindings",
            if script.is_some() { "no" } else { "yes" },
        ),
        ("vo", "gpu"),
        ("gpu-context", "d3d11"),
        ("hwdec", "auto-safe"),
        ("keep-open", "yes"),
        ("osc", "no"),
        ("idle", "yes"),
    ];
    for (name, value) in options {
        if let Err(err) = mpv.set_option(name, value) {
            log(&format!("option {name}={value} rejected: {err}"));
        }
    }

    if let Some(path) = script {
        if let Some(fonts) = path
            .parent()
            .and_then(|scripts| scripts.parent())
            .map(|mpv_dir| mpv_dir.join("fonts"))
            .filter(|dir| dir.is_dir())
        {
            let fonts = system_path(&fonts);
            register_private_fonts(&fonts);
            let dir = fonts.to_string_lossy();
            if let Err(err) = mpv.set_option("sub-fonts-dir", &dir) {
                log(&format!("sub-fonts-dir rejected: {err}"));
            }
            // The OSC is rendered by the OSD libass instance, which reads
            // --osd-fonts-dir, NOT --sub-fonts-dir.
            if let Err(err) = mpv.set_option("osd-fonts-dir", &dir) {
                log(&format!("osd-fonts-dir rejected: {err}"));
            }
        }
    } else {
        log("no OSC script found — falling back to mpv's built-in controls");
        if let Err(err) = mpv.set_option("osc", "yes") {
            log(&format!("osc option rejected: {err}"));
        }
    }

    let wid = surface.hwnd_value();
    if let Err(err) = mpv.set_option("wid", &wid.to_string()) {
        log(&format!("wid {wid:#x} rejected: {err}"));
    } else {
        log(&format!("mpv wid set to {wid:#x}"));
    }

    mpv.initialize().map_err(|err| err.to_string())?;
    set_input_target(generation, Arc::clone(api), mpv.handle());
    log("forwarding pointer input to mpv for the OSC");

    // `script` is not a settable option in libmpv; scripts are loaded with the
    // command after initialisation.
    if let Some(path) = script {
        let path = path.to_string_lossy().into_owned();
        if let Ok(mut slot) = OSC_SCRIPT_PATH.lock() {
            *slot = Some(path.clone());
        }
        match mpv.command(&["load-script", &path]) {
            Ok(()) => log(&format!("loaded the OSC script from {path}")),
            Err(err) => log(&format!("could not load the OSC script: {err}")),
        }
    }

    for (name, format) in OBSERVED_PROPERTIES {
        if let Err(err) = mpv.observe(name_hash(name), name, format) {
            log(&format!("observe {name} failed: {err}"));
        }
    }
    Ok(mpv)
}

/// mpv takes headers as one comma-separated list, e.g.
/// `Referer: https://justanime.to,Origin: https://justanime.to`.
fn header_fields(headers: Option<&[(String, String)]>) -> String {
    headers
        .map(|list| {
            list.iter()
                .map(|(name, value)| format!("{name}: {value}"))
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default()
}

/// Repeating the file that is already open must not restart playback: the
/// decoder, the position and the on-video controls only survive if mpv is left
/// alone. A different offset does not reload either — the file is already
/// playing where the user chose. Different headers mean a different request
/// and do reload.
fn is_repeat_load(loaded: Option<&LoadRequest>, request: &LoadRequest) -> bool {
    loaded.is_some_and(|loaded| loaded.url == request.url && loaded.headers == request.headers)
}

/// mpv reads per-file options from `loadfile`'s fourth argument; the third is
/// the playlist index and must be -1 when the fourth is used. Opening at the
/// offset beats seeking after the load, which reopens the stream before the
/// first frame can be shown.
fn loadfile_args(request: &LoadRequest) -> Vec<String> {
    let mut args = vec![
        "loadfile".to_string(),
        request.url.clone(),
        "replace".to_string(),
    ];
    if let Some(start) = request.start {
        args.push("-1".to_string());
        args.push(format!("start={start:.3}"));
    }
    args
}

fn load(runtime: &Arc<Mutex<Runtime>>, request: &LoadRequest) -> Result<(), String> {
    let mut guard = lock_runtime(runtime, "load")?;
    if is_repeat_load(guard.loaded.as_ref(), request)
        || (guard.mpv.is_none() && is_repeat_load(guard.pending_load.as_ref(), request))
    {
        // Every UI path that re-renders the player (window restore, link
        // re-ranking, a strict-mode remount) asks for the same file again.
        // Re-issuing loadfile there restarts demuxing and leaves the video
        // black until the first frame arrives, so an open file is left alone.
        log("already loaded; ignoring repeat play");
        return Ok(());
    }
    let Some(mpv) = guard.mpv.clone() else {
        log("load queued until mpv finishes initialising");
        guard.pending_load = Some(request.clone());
        return Ok(());
    };
    log(&format!("loading {}", shorten(&request.url)));
    // mpv reuses this for every request it makes for the file, so segments and
    // sidecar subtitles inherit the referer a gated CDN requires. Empty clears
    // it for the next provider.
    if let Err(err) = mpv.set_property("http-header-fields", &request.headers) {
        log(&format!("http-header-fields rejected: {err}"));
    }
    guard.load_started = Some(Instant::now());
    // Recorded only once mpv accepted the file: a rejected load must stay
    // retryable, and the UI retries the same URL with backoff.
    let args = loadfile_args(request);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match mpv.command(&args) {
        Ok(()) => {
            guard.loaded = Some(request.clone());
            Ok(())
        }
        Err(err) => {
            let message = err.to_string();
            log(&format!("loadfile failed: {message}"));
            Err(message)
        }
    }
}

fn apply_bounds(runtime: &Arc<Mutex<Runtime>>, x: i32, y: i32, width: i32, height: i32) {
    let hwnd = {
        let Ok(mut guard) = lock_runtime(runtime, "bounds") else {
            return;
        };
        let Some(surface) = guard.surface.as_ref() else {
            guard.pending_bounds = Some((x, y, width, height));
            log(&format!("bounds {x},{y} {width}x{height} queued (no surface yet)"));
            return;
        };
        surface.hwnd_value()
    };
    log(&format!("bounds -> {x},{y} {width}x{height}"));
    surface::set_bounds(hwnd, x, y, width, height);
}

fn reset_starting(runtime: &Arc<Mutex<Runtime>>) {
    if let Ok(mut guard) = runtime.lock() {
        guard.starting = false;
    }
}

fn spawn_event_pump(runtime: Arc<Mutex<Runtime>>, app: AppHandle) {
    thread::spawn(move || loop {
        let mpv = match runtime.lock() {
            Ok(guard) => guard.mpv.clone(),
            Err(_) => break,
        };
        let Some(mpv) = mpv else {
            break;
        };
        // Waiting for events never holds the runtime lock: the UI thread takes
        // that same lock for every player command.
        let event = mpv.wait_event(EVENT_POLL_SECONDS);

        match event {
            MpvEvent::ClientMessage(args) => handle_client_message(&app, &runtime, &args),
            event => {
                if let Some(payload) = apply_event(&runtime, event) {
                    crate::bridge::emit(&app, "mpv://event", payload);
                }
            }
        }

        if let Ok(runtime) = runtime.lock() {
            if runtime.mpv.is_none() {
                break;
            }
        }
    });
}

fn handle_client_message(app: &AppHandle, runtime: &Arc<Mutex<Runtime>>, args: &[String]) {
    let Some((kind, rest)) = args.split_first() else {
        return;
    };
    match (kind.as_str(), rest.first().map(String::as_str)) {
        ("fs-req", Some("source-picker")) => {
            crate::bridge::emit(app, "mpv://event", json!({ "type": "osc-request", "request": "source-picker" }));
        }
        ("fs-req", Some("sub-search")) => {
            crate::bridge::emit(app, "mpv://event", json!({ "type": "osc-request", "request": "sub-search" }));
        }
        ("fs-req", Some("sub-file")) => {
            let picked = app
                .dialog()
                .file()
                .add_filter("Subtitles", &["srt", "ass", "ssa", "vtt", "sub", "idx"])
                .blocking_pick_file();
            let Some(picked) = picked else { return };
            let Ok(path) = picked.into_path() else { return };
            let path = path.to_string_lossy().into_owned();
            let mpv = runtime.lock().ok().and_then(|guard| guard.mpv.clone());
            if let Some(mpv) = mpv {
                if let Err(err) = mpv.command(&["sub-add", &path, "select"]) {
                    log(&format!("sub-add {path} failed: {err}"));
                }
            }
        }
        ("fs-req", Some("fullscreen")) => {
            let Some(window) = app.get_webview_window("main") else { return };
            let current = window.is_fullscreen().unwrap_or(false);
            if window.set_fullscreen(!current).is_ok() {
                crate::commands::notify_fullscreen(&window, !current);
            }
        }
        ("fs-visibility", Some(state)) => surface::set_osc_visible(state == "visible"),
        _ => {}
    }
}

fn apply_event(runtime: &Arc<Mutex<Runtime>>, event: MpvEvent) -> Option<Value> {
    let mut guard = runtime.lock().ok()?;
    guard.mpv.as_ref()?;

    match event {
        MpvEvent::Property { name, value } => {
            let value = value?;
            if name == "time-pos" {
                if let (Some(started), PropValue::Double(position)) =
                    (guard.load_started, &value)
                {
                    if *position > 0.0 {
                        guard.load_started = None;
                        log(&format!(
                            "first frame after {} ms",
                            started.elapsed().as_millis()
                        ));
                    }
                }
            }
            let snapshot = &mut guard.snapshot;
            match (name.as_str(), &value) {
                ("time-pos", PropValue::Double(v)) => snapshot.position = *v,
                ("time-pos", PropValue::Int(v)) => snapshot.position = *v as f64,
                ("duration", PropValue::Double(v)) => snapshot.duration = *v,
                ("duration", PropValue::Int(v)) => snapshot.duration = *v as f64,
                ("pause", PropValue::Flag(v)) => snapshot.paused = *v,
                ("volume", PropValue::Double(v)) => snapshot.volume = *v,
                ("mute", PropValue::Flag(v)) => snapshot.muted = *v,
                ("speed", PropValue::Double(v)) => snapshot.speed = *v,
                _ => {}
            }
            if name == "paused-for-cache" {
                if let PropValue::Flag(stalled) = &value {
                    crate::diag::mark!("player", "buffering: {stalled}");
                }
            }
            let data = match value {
                PropValue::Double(v) => json!(v),
                PropValue::Int(v) => json!(v),
                PropValue::Flag(v) => json!(v),
            };
            Some(json!({ "event": "property-change", "name": name, "data": data }))
        }
        MpvEvent::FileLoaded => {
            guard.snapshot.paused = false;
            log("mpv: file loaded");
            drop(guard);
            Some(json!({ "event": "file-loaded" }))
        }
        MpvEvent::PlaybackRestart => {
            log("mpv: playback restart");
            Some(json!({ "event": "playback-restart" }))
        }
        MpvEvent::EndFile { reason, error } => {
            guard.snapshot.paused = true;
            // The file is gone, so the next play of this URL must really load
            // it again (a retry after a dead stream depends on that).
            guard.loaded = None;
            let name = end_file_name(reason);
            log(&format!(
                "mpv: end of file (reason {name}, code {reason}, error {error}) — {}",
                end_file_reason(reason)
            ));
            // The UI compares `reason` against mpv's names ("error" triggers
            // the automatic source failover), so it must not be a number.
            Some(json!({ "event": "end-file", "reason": name, "reason_code": reason, "error": error }))
        }
        MpvEvent::Shutdown => {
            guard.loaded = None;
            log("mpv: shutdown");
            None
        }
        MpvEvent::None | MpvEvent::ClientMessage(_) | MpvEvent::Other => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{is_repeat_load, loadfile_args, LoadRequest};

    fn request(url: &str, headers: &str) -> LoadRequest {
        LoadRequest {
            url: url.to_string(),
            headers: headers.to_string(),
            start: None,
        }
    }

    #[test]
    fn the_same_file_with_the_same_headers_is_not_loaded_twice() {
        let current = request("https://example.test/a.mkv", "");
        assert!(is_repeat_load(Some(&current), &current));
    }

    #[test]
    fn a_repeat_play_with_a_resume_offset_keeps_the_open_file() {
        let current = request("https://example.test/a.mkv", "");
        let resume = LoadRequest {
            start: Some(42.0),
            ..request("https://example.test/a.mkv", "")
        };
        assert!(is_repeat_load(Some(&current), &resume));
    }

    #[test]
    fn a_resume_offset_opens_the_file_at_that_position() {
        let resume = LoadRequest {
            start: Some(14.0),
            ..request("https://example.test/a.mkv", "")
        };
        assert_eq!(
            loadfile_args(&resume),
            [
                "loadfile",
                "https://example.test/a.mkv",
                "replace",
                "-1",
                "start=14.000"
            ]
        );
    }

    #[test]
    fn a_play_without_an_offset_passes_no_per_file_options() {
        let play = request("https://example.test/a.mkv", "");
        assert_eq!(
            loadfile_args(&play),
            ["loadfile", "https://example.test/a.mkv", "replace"]
        );
    }

    #[test]
    fn different_headers_reload_the_file() {
        let current = request("https://example.test/a.mkv", "");
        let next = request("https://example.test/a.mkv", "referer: https://example.test");
        assert!(!is_repeat_load(Some(&current), &next));
    }

    #[test]
    fn a_finished_file_loads_again() {
        let next = request("https://example.test/a.mkv", "");
        assert!(!is_repeat_load(None, &next));
    }
}

fn end_file_name(reason: i32) -> &'static str {
    match reason {
        0 => "eof",
        1 => "stop",
        2 => "quit",
        3 => "error",
        4 => "redirect",
        _ => "unknown",
    }
}

fn end_file_reason(reason: i32) -> &'static str {
    match reason {
        0 => "played to the end",
        1 => "stopped by the app",
        2 => "mpv asked to quit",
        3 => "error — see the mpv log lines above",
        4 => "redirect",
        _ => "unknown reason",
    }
}

fn name_hash(name: &str) -> u64 {
    name.bytes()
        .fold(1u64, |acc, byte| acc.wrapping_mul(31).wrapping_add(byte as u64))
}

fn shorten(url: &str) -> String {
    if url.len() <= 120 {
        url.to_string()
    } else {
        format!("{}…", &url[..120])
    }
}

/// Waits for the player lock and records how long the caller was blocked.
/// Called from the UI thread by every player command, so a long wait here is
/// a frozen window.
/// A wait this long on the UI thread is a window that stopped repainting.
const SLOW_LOCK_MS: u128 = 25;

fn lock_runtime<'a>(
    runtime: &'a Mutex<Runtime>,
    what: &'static str,
) -> Result<std::sync::MutexGuard<'a, Runtime>, String> {
    let started = Instant::now();
    let guard = runtime
        .lock()
        .map_err(|_| format!("player lock poisoned ({what})"))?;
    let waited = started.elapsed().as_millis();
    if waited >= SLOW_LOCK_MS {
        crate::diag::mark!("player", "lock {what} waited {waited} ms");
    }
    Ok(guard)
}

pub(crate) fn log(message: &str) {
    // Release builds have no console: this is the only place a playback
    // timeline survives to be inspected after an install.
    crate::diag::mark!("player", "{message}");
}
