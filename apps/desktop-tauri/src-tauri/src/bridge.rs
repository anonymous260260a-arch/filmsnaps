//! JavaScript bridge that gives the existing web UI the `window.electronAPI`
//! contract it already codes against, backed by Tauri commands.
//!
//! Injected as an initialization script into the main webview only. The IPC
//! handle is the internal one (`__TAURI_INTERNALS__`) rather than the global
//! API, so no Tauri surface is added to the page's `window` beyond this shim,
//! and the provider webview (external origin) has no capability at all.

use serde_json::Value;
use tauri::Manager;

/// Pushes a payload to a `window.__filmsnapsEmit(channel, payload)` listener.
/// This is the single place every event channel (player, downloads, provider)
/// leaves Rust for the page.
pub(crate) fn emit(app: &tauri::AppHandle, channel: &str, payload: Value) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let script = format!(
        "window.__filmsnapsEmit && window.__filmsnapsEmit({}, {});",
        serde_json::to_string(channel).unwrap_or_else(|_| "\"\"".into()),
        payload
    );
    let _ = window.eval(&script);
}

/// The page reports its version without an IPC round-trip, so the value is
/// baked in from the crate version at build time.
pub fn bridge_script() -> String {
    let script = BRIDGE_SCRIPT
        .replace("\"__APP_VERSION__\"", &format!("\"{}\"", env!("CARGO_PKG_VERSION")))
        .replace("__PERF__", if cfg!(feature = "perf") { "true" } else { "false" });
    if cfg!(feature = "perf") {
        script.replace("__DIAG_HANDLE__", DIAG_HANDLE)
    } else {
        script.replace("__DIAG_HANDLE__", "")
    }
}

/// Injected only with the `perf` feature, so a shipping build has no handle for
/// the page to measure through.
const DIAG_HANDLE: &str =
    "    // Timing marks from the page, merged into the same log file as the shell's.\n    diag: (event, data) => { if (report) { report(event, data); } },";

pub const BRIDGE_SCRIPT: &str = r#"
(function () {
  // Desktop couch-distance scaling changes the ROOT font-size, which
  // invalidates every rem length in the document. Applied here it is part of
  // the first style calculation; applied after mount it restyles ~1000 nodes
  // inside one task (measured at 668 ms).
  if (document.documentElement) {
    document.documentElement.classList.add("fs-desktop");
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      document.documentElement.classList.add("fs-desktop");
    });
  }
  if (window.electronAPI) { return; }
  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") {
    console.error("[bridge] Tauri IPC unavailable");
    return;
  }
  // Perf instrumentation exists only in a `--features perf` build; without it
  // this is a plain pass-through and the page collects nothing.
  const PERF = __PERF__;
  const report = PERF
    ? (event, data) => { internals.invoke("diag_log", { event, data }).catch(() => {}); }
    : null;
  const ipc = new Map();
  const invoke = (cmd, args) => {
    if (!PERF) { return internals.invoke(cmd, args); }
    const started = performance.now();
    return internals.invoke(cmd, args).then(
      (result) => {
        const ms = performance.now() - started;
        const entry = ipc.get(cmd) || { n: 0, total: 0, max: 0 };
        entry.n += 1;
        entry.total += ms;
        entry.max = Math.max(entry.max, ms);
        ipc.set(cmd, entry);
        // 16 ms is one frame: a round-trip this slow is a visible stall.
        if (ms >= 16) { report("ipc-slow", { cmd, ms: Math.round(ms) }); }
        return result;
      },
      (err) => {
        report("ipc-error", { cmd, message: String(err) });
        throw err;
      },
    );
  };
  if (PERF) {
    // Bounds accumulate instead of one line per call: bounds and state reads
    // fire dozens of times a second during a resize.
    setInterval(() => {
      if (ipc.size === 0) { return; }
      const summary = {};
      ipc.forEach((entry, cmd) => {
        summary[cmd] = {
          n: entry.n,
          avg: Math.round(entry.total / entry.n),
          max: Math.round(entry.max),
        };
      });
      ipc.clear();
      report("ipc", summary);
    }, 10000);
  }

  // API reads go through the Rust side: the Worker's CORS allowlist does not
  // know the Tauri origin, so a page-origin fetch is rejected before any
  // content arrives.
  const API_HINT = "workers.dev";
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url || url.indexOf(API_HINT) === -1) { return nativeFetch(input, init); }
    const headers = {};
    try {
      const source = (init && init.headers) || (input && input.headers) || undefined;
      new Headers(source).forEach((value, key) => {
        const lower = key.toLowerCase();
        if (lower !== "origin" && lower !== "referer") { headers[key] = value; }
      });
    } catch (e) { /* header-less request */ }
    const request = {
      url: url,
      method: ((init && init.method) || (input && input.method) || "GET").toUpperCase(),
      headers: headers,
      body: init && typeof init.body === "string" ? init.body : null,
    };
    return invoke("api_fetch", request).then(function (result) {
      const empty = !result.body || result.status === 204 || result.status === 304;
      const bytes = empty
        ? null
        : Uint8Array.from(atob(result.body), (c) => c.charCodeAt(0));
      const responseHeaders = {};
      if (result.content_type) { responseHeaders["Content-Type"] = result.content_type; }
      return new Response(bytes, { status: result.status, headers: responseHeaders });
    });
  };

  const channels = new Map();
  window.__filmsnapsEmit = function (channel, payload) {
    const set = channels.get(channel);
    if (set) { set.forEach((cb) => { try { cb(payload); } catch (e) { console.error(e); } }); }
  };
  function on(channel, cb) {
    if (!channels.has(channel)) { channels.set(channel, new Set()); }
    channels.get(channel).add(cb);
    return () => { channels.get(channel).delete(cb); };
  }

  let updateUnsub = null;
  const isMaximizedListeners = new Set();
  const navListeners = new Set();
  const loadingListeners = new Set();

  window.electronAPI = {
    isDesktop: true,
    platform: "win32",
    appVersion: "__APP_VERSION__",
    // No R0-R8 cascade or session trust exists here, so the page must mount the
    // embed directly instead of waiting for a session install.
    sessionTrust: false,

    minimize: () => invoke("window_control", { action: "minimize" }),
    startDragging: () => invoke("window_control", { action: "start_dragging" }),
    maximize: () => invoke("window_control", { action: "maximize" }),
    close: () => invoke("window_control", { action: "close" }),
    isMaximized: () => invoke("window_control", { action: "is_maximized" }),
    onMaximizeChange: (cb) => { isMaximizedListeners.add(cb); return () => isMaximizedListeners.delete(cb); },

    reload: () => { window.location.reload(); },
    devtools: () => invoke("open_devtools"),
__DIAG_HANDLE__
    goBack: () => { window.history.back(); },
    goForward: () => { window.history.forward(); },
    canGoBack: () => Promise.resolve(window.history.length > 1),
    canGoForward: () => Promise.resolve(false),
    onNavigationStateChange: (cb) => {
      navListeners.add(cb);
      window.addEventListener("popstate", () =>
        cb({ canGoBack: window.history.length > 1, canGoForward: false }));
      return () => navListeners.delete(cb);
    },
    onLoadingChange: (cb) => {
      loadingListeners.add(cb);
      window.addEventListener("beforeunload", () => cb(true));
      return () => loadingListeners.delete(cb);
    },

    getLegalAccepted: () => invoke("legal_state"),
    setLegalAccepted: () => invoke("legal_accept"),

    onUpdateStatus: (cb) => {
      if (updateUnsub) updateUnsub();
      updateUnsub = on("update:status", cb);
    },
    removeUpdateStatusListener: () => {
      if (updateUnsub) updateUnsub();
      updateUnsub = null;
    },
    checkForUpdates: () => invoke("update_check"),
    quitAndInstall: () => invoke("update_install"),

    onEscapeBlocked: () => () => {},
    onPlayerSourceMissing: () => () => {},

    onPlayerProgress: (cb) => {
      let last = -1;
      return on("mpv://event", (ev) => {
        if (!ev || ev.event !== "property-change" || ev.name !== "time-pos") { return; }
        const t = typeof ev.data === "number" ? ev.data : null;
        if (t === null || Math.abs(t - last) < 1) { return; }
        last = t;
        cb({
          currentTime: t,
          duration: window.__filmsnapsDuration || 0,
          paused: false,
          qualified: true,
          readyState: 4,
          srcHost: "mpv",
          recentUserSeek: false,
        });
      });
    },

    player: {
      open: (embedUrl, rect) => invoke("provider_open", {
        url: embedUrl,
        rect: rect || { x: 0, y: 0, width: 1, height: 1 },
      }),
      close: () => invoke("provider_close"),
      setBounds: (rect) => invoke("provider_set_bounds", { rect }),
      setVisible: (visible) => invoke("provider_set_visible", { visible }),
      setFullscreen: (fullscreen) => invoke("window_control", {
        action: fullscreen ? "fullscreen_on" : "fullscreen_off",
      }),
      reload: () => invoke("provider_reload"),
      getWebContentsId: () => Promise.resolve(-1),
      seek: (seconds) => invoke("player_control", { action: "seek", value: seconds }),
      onState: (cb) => on("provider://state", cb),
    },

    download: {
      start: (meta) => invoke("download_start", { meta }),
      pause: (id) => invoke("download_pause", { id }),
      resume: (id) => invoke("download_resume", { id }),
      cancel: (id) => invoke("download_cancel", { id }),
      getAll: () => invoke("download_get_all"),
      open: (id) => invoke("download_open", { id }),
      clear: (id, deleteFile) => invoke("download_clear", { id, deleteFile: !!deleteFile }),
      setSpeedLimit: (level) => invoke("download_speed_limit", { level: String(level) }),
      setSaveDir: (dir) => invoke("download_set_folder", { dir: String(dir) }),
      onProgress: (cb) => on("download:progress", cb),
    },

    mpv: {
      start: () => invoke("player_start"),
      destroy: () => invoke("player_stop"),
      play: (url, headers, startAt) =>
        invoke("player_open", {
          url,
          headers: headers ? Object.entries(headers) : null,
          start: typeof startAt === "number" ? startAt : null,
        }).then(() => ({ success: true })),
      pause: () => invoke("player_control", { action: "pause" }),
      resume: () => invoke("player_control", { action: "play" }),
      stop: () => invoke("player_control", { action: "stop" }),
      seek: (seconds) => invoke("player_control", { action: "seek", value: seconds }),
      setVolume: (volume) => invoke("player_control", { action: "volume", value: volume }),
      setMuted: (muted) => invoke("player_control", { action: muted ? "mute" : "unmute" }),
      setSpeed: (rate) => invoke("player_control", { action: "speed", value: rate }),
      setFullscreen: (fullscreen) => invoke("window_control", {
        action: fullscreen ? "fullscreen_on" : "fullscreen_off",
      }),
      toggleFullscreen: () => invoke("window_control", { action: "fullscreen_toggle" }),
      setProperty: (name, value) => invoke("player_set_property", { name, value: String(value) }),
      getState: () => invoke("player_state"),
      getAudioTracks: () => invoke("player_state").then((s) =>
        (s.trackList || []).filter((t) => t.type === "audio")),
      getSubtitleTracks: () => invoke("player_state").then((s) =>
        (s.trackList || []).filter((t) => t.type === "sub")),
      setAudioTrack: (id) => invoke("player_set_property", { name: "aid", value: String(id) }),
      setSubtitleTrack: (id) => invoke("player_set_property", { name: "sid", value: String(id) }),
      subAdd: (url, title) => invoke("player_sub_add", {
        url: String(url),
        title: title == null ? null : String(title),
      }),
      setVideoBounds: (rect) => invoke("player_bounds", { rect }),
      hideVideo: () => invoke("player_visible", { visible: false }),
      showVideo: () => invoke("player_visible", { visible: true }),
      setOscSource: (label) => invoke("player_osc_source", { label: String(label) }),
      setOscStatus: (status, detail) => invoke("player_osc_status", {
        status: String(status),
        detail: detail == null ? null : String(detail),
      }),
      setOscPanel: (open) => invoke("player_osc_panel", { open: !!open }),
      onEvent: (cb) => on("mpv://event", cb),
    },

    falix: {
      getDetail: (tmdbId) => invoke("falix_detail", { id: String(tmdbId) }),
    },

    app: {
      clearCache: () => invoke("clear_cache"),
      openExternal: (url) => invoke("open_external", { url }),
      getDownloadFolder: () => invoke("download_folder"),
      setDownloadFolder: (dir) => invoke("download_set_folder", { dir: String(dir) })
        .then(() => ({ success: true })),
      pickDownloadFolder: () => invoke("download_pick_folder"),
    },
  };

  window.__filmsnapsNotifyMaximized = (value) => {
    isMaximizedListeners.forEach((cb) => { try { cb(value); } catch (e) { console.error(e); } });
  };
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_has_no_unreplaced_placeholders() {
        let script = bridge_script();
        for placeholder in ["__APP_VERSION__", "__PERF__", "__DIAG_HANDLE__"] {
            assert!(
                !script.contains(placeholder),
                "{placeholder} survived into the injected script"
            );
        }
    }

    #[test]
    fn only_a_perf_build_exposes_the_diag_handle() {
        assert_eq!(
            bridge_script().contains("diag: (event, data)"),
            cfg!(feature = "perf"),
            "the page must have no timing handle in a shipping build"
        );
    }
}
