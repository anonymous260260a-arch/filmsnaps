//! Window size, position and maximized state, persisted across launches.
//!
//! Mirrors the Electron app: the last non-maximized bounds are kept, so a
//! window restored maximized still knows where to return to when unmaximized.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow, WindowEvent};

pub const DEFAULT_WIDTH: f64 = 1280.0;
pub const DEFAULT_HEIGHT: f64 = 800.0;
pub const MIN_WIDTH: f64 = 960.0;
pub const MIN_HEIGHT: f64 = 600.0;

const STATE_FILE: &str = "window-state.json";
const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
/// Keeps this much of the window reachable when the saved position belongs to a
/// monitor that is no longer attached.
const MIN_VISIBLE: f64 = 200.0;

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    width: f64,
    height: f64,
    #[serde(default)]
    is_maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            is_maximized: false,
        }
    }
}

#[derive(Clone, Copy)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Applies the saved geometry to `window` (built hidden by the caller) and
/// starts persisting later changes.
pub fn attach(app: &AppHandle, window: &WebviewWindow) {
    let saved = load(app).unwrap_or_default();
    let restored = fit_to_monitor(&saved, monitor_bounds(window));

    if let Err(err) = window.set_size(LogicalSize::new(restored.width, restored.height)) {
        warn(&format!("could not restore size: {err}"));
    }
    if let (Some(x), Some(y)) = (restored.x, restored.y) {
        if let Err(err) = window.set_position(LogicalPosition::new(x, y)) {
            warn(&format!("could not restore position: {err}"));
        }
    }
    if saved.is_maximized {
        if let Err(err) = window.maximize() {
            warn(&format!("could not restore maximized state: {err}"));
        }
    }

    track(app, window, restored);
}

fn monitor_bounds(window: &WebviewWindow) -> Option<Bounds> {
    let monitor = window.primary_monitor().ok()??;
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    Some(Bounds {
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
    })
}

fn fit_to_monitor(saved: &WindowState, monitor: Option<Bounds>) -> WindowState {
    let Some(monitor) = monitor else {
        return *saved;
    };
    let right = monitor.x + monitor.width - MIN_VISIBLE;
    let bottom = monitor.y + monitor.height - MIN_VISIBLE;
    WindowState {
        x: saved.x.map(|x| clamp_axis(x, monitor.x, right)),
        y: saved.y.map(|y| clamp_axis(y, monitor.y, bottom)),
        width: clamp_axis(saved.width, MIN_WIDTH, monitor.width),
        height: clamp_axis(saved.height, MIN_HEIGHT, monitor.height),
        is_maximized: saved.is_maximized,
    }
}

/// Clamps without panicking when `max` is below `min` (a monitor smaller than
/// the minimum window size).
fn clamp_axis(value: f64, min: f64, max: f64) -> f64 {
    value.min(max.max(min)).max(min)
}

fn track(app: &AppHandle, window: &WebviewWindow, restored: WindowState) {
    let state = Arc::new(Mutex::new(restored));
    let dirty = Arc::new(AtomicBool::new(true));

    let event_app = app.clone();
    let event_window = window.clone();
    let event_state = Arc::clone(&state);
    let event_dirty = Arc::clone(&dirty);
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { .. } => save(&event_app, &event_window, &event_state),
        _ => {
            event_dirty.store(true, Ordering::Relaxed);
        }
    });

    let saver_app = app.clone();
    let saver_window = window.clone();
    let saver_state = Arc::clone(&state);
    thread::spawn(move || loop {
        thread::sleep(SAVE_DEBOUNCE);
        if dirty.swap(false, Ordering::Relaxed) {
            save(&saver_app, &saver_window, &saver_state);
        }
    });
}

fn save(app: &AppHandle, window: &WebviewWindow, state: &Mutex<WindowState>) {
    let maximized = window.is_maximized().unwrap_or(false);
    if !maximized {
        refresh(window, state);
    }
    let mut snapshot = match state.lock() {
        Ok(state) => *state,
        Err(_) => {
            warn("state lock poisoned; not saving");
            return;
        }
    };
    snapshot.is_maximized = maximized;
    write(app, &snapshot);
}

/// Maximized and fullscreen geometry is the screen, not the bounds to restore.
fn refresh(window: &WebviewWindow, state: &Mutex<WindowState>) {
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let position = position.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    match state.lock() {
        Ok(mut state) => {
            state.x = Some(position.x);
            state.y = Some(position.y);
            state.width = size.width;
            state.height = size.height;
        }
        Err(_) => warn("state lock poisoned; keeping previous bounds"),
    }
}

fn write(app: &AppHandle, state: &WindowState) {
    let Some(path) = state_path(app) else {
        warn("no config directory; window state not saved");
        return;
    };
    if let Some(parent) = path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            warn(&format!("could not create {}: {err}", parent.display()));
            return;
        }
    }
    let text = match serde_json::to_string_pretty(state) {
        Ok(text) => text,
        Err(err) => {
            warn(&format!("could not encode state: {err}"));
            return;
        }
    };
    if let Err(err) = fs::write(&path, text) {
        warn(&format!("could not write {}: {err}", path.display()));
    }
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(STATE_FILE))
}

fn load(app: &AppHandle) -> Option<WindowState> {
    let path = state_path(app)?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == ErrorKind::NotFound => return None,
        Err(err) => {
            warn(&format!("could not read {}: {err}", path.display()));
            return None;
        }
    };
    match serde_json::from_str(&raw) {
        Ok(state) => Some(state),
        Err(err) => {
            warn(&format!("ignoring unreadable {}: {err}", path.display()));
            None
        }
    }
}

fn warn(message: &str) {
    eprintln!("[window] {message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Option<Bounds> = Some(Bounds {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    });

    #[test]
    fn keeps_a_window_that_left_the_screen_visible() {
        let saved = WindowState {
            x: Some(5000.0),
            y: Some(-900.0),
            width: 4000.0,
            height: 3000.0,
            is_maximized: true,
        };

        let restored = fit_to_monitor(&saved, MONITOR);

        assert_eq!(restored.width, 1920.0);
        assert_eq!(restored.height, 1080.0);
        assert_eq!(restored.x, Some(1920.0 - MIN_VISIBLE));
        assert_eq!(restored.y, Some(0.0));
        assert!(restored.is_maximized, "a maximized window stays maximized");
    }

    #[test]
    fn leaves_a_window_inside_the_screen_alone() {
        let saved = WindowState {
            x: Some(100.0),
            y: Some(50.0),
            width: 1280.0,
            height: 800.0,
            is_maximized: false,
        };

        let restored = fit_to_monitor(&saved, MONITOR);

        assert_eq!(restored.x, Some(100.0));
        assert_eq!(restored.y, Some(50.0));
        assert_eq!(restored.width, 1280.0);
        assert_eq!(restored.height, 800.0);
    }

    #[test]
    fn a_display_smaller_than_the_minimum_window_does_not_panic() {
        let saved = WindowState {
            x: Some(10.0),
            y: Some(10.0),
            width: 1280.0,
            height: 800.0,
            is_maximized: false,
        };
        let tiny = Some(Bounds {
            x: 0.0,
            y: 0.0,
            width: 800.0,
            height: 500.0,
        });

        let restored = fit_to_monitor(&saved, tiny);

        assert_eq!(restored.width, MIN_WIDTH);
        assert_eq!(restored.height, MIN_HEIGHT);
    }
}
