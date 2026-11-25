//! Offline downloads: direct-URL transfers with pause, resume and cancel.
//!
//! Each task owns one worker thread that streams the response straight to disk.
//! Pausing only flips a flag the worker checks between chunks, so a paused
//! download keeps its socket and resumes without re-requesting from zero
//! (resumption after a restart is not offered: a task that was running when the
//! app closed is marked canceled, like the Electron build).

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};

const MANIFEST_FILE: &str = "downloads.json";
const DEFAULT_FOLDER: &str = "FilmSnaps";
const BUFFER_BYTES: usize = 64 * 1024;
const BROADCAST_MS: u64 = 250;
const PERSIST_EVERY: Duration = Duration::from_secs(1);
const CANCELED: &str = "canceled";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmdb_id: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode: Option<u32>,
    pub file_name: String,
    pub file_path: String,
    pub total_bytes: u64,
    pub received_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub url: String,
    #[serde(default)]
    pub tmdb_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub season: Option<u32>,
    #[serde(default)]
    pub episode: Option<u32>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    #[serde(default)]
    save_dir: Option<String>,
    #[serde(default)]
    tasks: Vec<Task>,
}

struct Store {
    tasks: Vec<Task>,
    save_dir: PathBuf,
    manifest: PathBuf,
}

struct Control {
    paused: AtomicBool,
    canceled: AtomicBool,
    received: AtomicU64,
}

pub struct Downloads {
    app: AppHandle,
    client: reqwest::blocking::Client,
    store: Mutex<Store>,
    controls: Mutex<HashMap<String, Arc<Control>>>,
    /// Share of the link speed the transfer loop is allowed to use, in percent.
    pacing: AtomicU32,
    /// Something changed since the last broadcast.
    dirty: AtomicBool,
    /// The stored list differs from the manifest on disk.
    unsaved: AtomicBool,
    persist_now: AtomicBool,
    last_persist: Mutex<Instant>,
}

impl Downloads {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let manifest = app
            .path()
            .app_config_dir()
            .map(|dir| dir.join(MANIFEST_FILE))
            .unwrap_or_else(|_| PathBuf::from(MANIFEST_FILE));
        let default_dir = app
            .path()
            .download_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join(DEFAULT_FOLDER);

        let mut store = Store {
            tasks: Vec::new(),
            save_dir: default_dir,
            manifest,
        };
        if let Ok(text) = fs::read_to_string(&store.manifest) {
            match serde_json::from_str::<Manifest>(&text) {
                Ok(saved) => {
                    if let Some(dir) = saved.save_dir.filter(|dir| !dir.trim().is_empty()) {
                        store.save_dir = PathBuf::from(dir);
                    }
                    store.tasks = saved
                        .tasks
                        .into_iter()
                        .map(|mut task| {
                            if task.state == "active" || task.state == "paused" {
                                task.state = "canceled".to_string();
                                task.speed_bytes_per_sec = 0;
                            }
                            task
                        })
                        .collect();
                }
                Err(err) => log(&format!("downloads manifest unreadable: {err}")),
            }
        }
        let _ = fs::create_dir_all(&store.save_dir);

        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .user_agent(concat!("FilmSnaps/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_else(|err| {
                log(&format!("http client setup failed: {err}"));
                reqwest::blocking::Client::new()
            });

        let manager = Arc::new(Self {
            app,
            client,
            store: Mutex::new(store),
            controls: Mutex::new(HashMap::new()),
            pacing: AtomicU32::new(100),
            dirty: AtomicBool::new(false),
            unsaved: AtomicBool::new(false),
            persist_now: AtomicBool::new(false),
            last_persist: Mutex::new(Instant::now()),
        });
        manager.start_notifier();
        manager
    }

    pub fn tasks(&self) -> Vec<Task> {
        let Ok(store) = self.store.lock() else {
            return Vec::new();
        };
        let mut tasks = store.tasks.clone();
        tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        tasks
    }

    pub fn save_dir(&self) -> String {
        self.store
            .lock()
            .map(|store| store.save_dir.display().to_string())
            .unwrap_or_default()
    }

    pub fn set_save_dir(&self, dir: &str) -> Result<(), String> {
        let dir = dir.trim();
        if dir.is_empty() {
            return Err("the download folder cannot be empty".to_string());
        }
        let path = PathBuf::from(dir);
        fs::create_dir_all(&path).map_err(|err| format!("cannot use {dir}: {err}"))?;
        {
            let Ok(mut store) = self.store.lock() else {
                return Err("download state is unavailable".to_string());
            };
            store.save_dir = path;
        }
        log(&format!("downloads folder set to {dir}"));
        self.persist_now();
        Ok(())
    }

    /// `full` / `balanced` / `slower`, matching the settings tiers.
    pub fn set_speed_limit(&self, level: &str) {
        let percent = match level {
            "balanced" => 64,
            "slower" => 32,
            _ => 100,
        };
        self.pacing.store(percent, Ordering::Relaxed);
    }

    pub fn start(self: &Arc<Self>, meta: Meta) -> Result<(), String> {
        let url = meta.url.trim().to_string();
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("only http(s) links can be downloaded".to_string());
        }
        let (file_name, file_path) = {
            let store = self
                .store
                .lock()
                .map_err(|_| "download state is unavailable".to_string())?;
            let fallback = file_stem_from_url(&url);
            let name = sanitize(
                meta.title
                    .as_deref()
                    .filter(|title| !title.trim().is_empty())
                    .unwrap_or(fallback.as_str()),
            );
            let name = with_extension(&name, guess_extension(&url));
            let path = unique_path(&store.save_dir, &name);
            (file_name_of(&path), path)
        };
        let now = now_ms();
        let task = Task {
            id: new_id(now),
            url,
            tmdb_id: meta.tmdb_id,
            title: meta
                .title
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| file_name.clone()),
            media_type: meta.media_type,
            season: meta.season,
            episode: meta.episode,
            file_name,
            file_path: file_path.display().to_string(),
            total_bytes: 0,
            received_bytes: 0,
            speed_bytes_per_sec: 0,
            state: "active".to_string(),
            error: None,
            created_at: now,
            updated_at: now,
        };
        let id = task.id.clone();
        {
            let Ok(mut store) = self.store.lock() else {
                return Err("download state is unavailable".to_string());
            };
            store.tasks.push(task);
        }
        self.persist_now();

        let control = Arc::new(Control {
            paused: AtomicBool::new(false),
            canceled: AtomicBool::new(false),
            received: AtomicU64::new(0),
        });
        if let Ok(mut controls) = self.controls.lock() {
            controls.insert(id.clone(), Arc::clone(&control));
        }
        self.mark_dirty();
        spawn_worker(self, id, control);
        Ok(())
    }

    pub fn pause(&self, id: &str) {
        let Some(control) = self.control(id) else {
            return;
        };
        control.paused.store(true, Ordering::Relaxed);
        self.update(id, |task| {
            if task.state == "active" {
                task.state = "paused".to_string();
                task.speed_bytes_per_sec = 0;
            }
        });
        self.persist_now();
    }

    pub fn resume(&self, id: &str) {
        let Some(control) = self.control(id) else {
            return;
        };
        control.paused.store(false, Ordering::Relaxed);
        self.update(id, |task| {
            if task.state == "paused" {
                task.state = "active".to_string();
            }
        });
        self.persist_now();
    }

    pub fn cancel(&self, id: &str) {
        if let Some(control) = self.control(id) {
            control.canceled.store(true, Ordering::Relaxed);
            control.paused.store(false, Ordering::Relaxed);
            self.update(id, |task| {
                task.state = "canceled".to_string();
                task.speed_bytes_per_sec = 0;
            });
        }
        self.persist_now();
    }

    pub fn clear(&self, id: &str, delete_file: bool) {
        self.cancel(id);
        let path = {
            let Ok(mut store) = self.store.lock() else {
                return;
            };
            let path = store
                .tasks
                .iter()
                .position(|task| task.id == id)
                .map(|index| store.tasks.remove(index).file_path);
            path
        };
        if delete_file {
            if let Some(path) = path.as_deref() {
                let _ = fs::remove_file(path);
            }
        }
        if let Ok(mut controls) = self.controls.lock() {
            controls.remove(id);
        }
        self.persist_now();
    }

    pub fn reveal(&self, id: &str) {
        let Some(path) = self
            .store
            .lock()
            .ok()
            .and_then(|store| {
                store
                    .tasks
                    .iter()
                    .find(|task| task.id == id)
                    .map(|task| task.file_path.clone())
            })
        else {
            return;
        };
        reveal_in_explorer(Path::new(&path));
    }

    fn control(&self, id: &str) -> Option<Arc<Control>> {
        self.controls
            .lock()
            .ok()
            .and_then(|controls| controls.get(id).cloned())
    }

    fn update(&self, id: &str, apply: impl FnOnce(&mut Task)) {
        if let Ok(mut store) = self.store.lock() {
            if let Some(task) = store.tasks.iter_mut().find(|task| task.id == id) {
                apply(task);
                task.updated_at = now_ms();
            }
        }
        self.mark_dirty();
    }

    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Relaxed);
        self.unsaved.store(true, Ordering::Relaxed);
    }

    fn persist_now(&self) {
        self.persist_now.store(true, Ordering::Relaxed);
        self.mark_dirty();
    }

    fn persist(&self) {
        let text = {
            let Ok(store) = self.store.lock() else {
                return;
            };
            let manifest = Manifest {
                save_dir: Some(store.save_dir.display().to_string()),
                tasks: store.tasks.clone(),
            };
            match serde_json::to_string_pretty(&manifest) {
                Ok(text) => text,
                Err(err) => {
                    log(&format!("downloads manifest not written: {err}"));
                    return;
                }
            }
        };
        if let Ok(store) = self.store.lock() {
            if let Some(parent) = store.manifest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Err(err) = fs::write(&store.manifest, text) {
                log(&format!("downloads manifest not written: {err}"));
            }
        }
        self.unsaved.store(false, Ordering::Relaxed);
        if let Ok(mut last) = self.last_persist.lock() {
            *last = Instant::now();
        }
    }

    fn start_notifier(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(BROADCAST_MS));
            if manager.dirty.swap(false, Ordering::Relaxed) {
                crate::bridge::emit(&manager.app, "download:progress", json!(manager.tasks()));
            }
            if !manager.unsaved.load(Ordering::Relaxed) {
                continue;
            }
            let due = manager
                .last_persist
                .lock()
                .map(|last| last.elapsed() >= PERSIST_EVERY)
                .unwrap_or(true);
            if manager.persist_now.swap(false, Ordering::Relaxed) || due {
                manager.persist();
            }
        });
    }

    fn throttle(&self, copy_time: Duration) {
        let percent = self.pacing.load(Ordering::Relaxed);
        if percent >= 100 || copy_time.is_zero() {
            return;
        }
        let extra = copy_time
            .mul_f64(100.0 / percent as f64 - 1.0)
            .min(Duration::from_secs(2));
        thread::sleep(extra);
    }
}

fn spawn_worker(manager: &Arc<Downloads>, id: String, control: Arc<Control>) {
    let manager = Arc::clone(manager);
    thread::spawn(move || manager.run(id, control));
}

impl Downloads {
    fn run(self: Arc<Self>, id: String, control: Arc<Control>) {
        let outcome = self.transfer(&id, &control);
        if let Ok(mut controls) = self.controls.lock() {
            controls.remove(&id);
        }
        match outcome {
            Ok(()) => {
                self.update(&id, |task| {
                    task.state = "completed".to_string();
                    task.speed_bytes_per_sec = 0;
                    task.error = None;
                });
            }
            Err(err) if err == CANCELED => {
                if let Some(path) = self.path_of(&id) {
                    let _ = fs::remove_file(path);
                }
                self.update(&id, |task| {
                    task.state = "canceled".to_string();
                    task.speed_bytes_per_sec = 0;
                });
            }
            Err(err) => {
                log(&format!("download {id} failed: {err}"));
                self.update(&id, |task| {
                    task.state = "failed".to_string();
                    task.speed_bytes_per_sec = 0;
                    task.error = Some(err);
                });
            }
        }
        self.persist_now();
    }

    fn path_of(&self, id: &str) -> Option<PathBuf> {
        let store = self.store.lock().ok()?;
        let task = store.tasks.iter().find(|task| task.id == id)?;
        Some(PathBuf::from(&task.file_path))
    }

    fn transfer(&self, id: &str, control: &Control) -> Result<(), String> {
        let (url, path, resume_from) = {
            let store = self
                .store
                .lock()
                .map_err(|_| "download state is unavailable".to_string())?;
            let task = store
                .tasks
                .iter()
                .find(|task| task.id == id)
                .ok_or_else(|| CANCELED.to_string())?;
            (
                task.url.clone(),
                PathBuf::from(&task.file_path),
                task.received_bytes,
            )
        };

        let mut request = self.client.get(&url);
        if resume_from > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
        }
        let mut response = request.send().map_err(|err| describe(&err))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("server returned {status}"));
        }

        let resumed = resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
        let mut received = if resumed { resume_from } else { 0 };
        let total = match response.headers().get(reqwest::header::CONTENT_RANGE) {
            Some(value) if resumed => content_range_total(value.to_str().unwrap_or_default())
                .unwrap_or_else(|| received + response.content_length().unwrap_or(0)),
            _ => response.content_length().unwrap_or(0),
        };

        let mut file = open_target(&path, resumed)?;
        self.update(id, |task| {
            task.state = "active".to_string();
            task.received_bytes = received;
            task.total_bytes = total;
            task.error = None;
        });

        let mut buffer = vec![0u8; BUFFER_BYTES];
        let mut window_start = Instant::now();
        let mut window_bytes = 0u64;

        loop {
            if control.canceled.load(Ordering::Relaxed) {
                return Err(CANCELED.to_string());
            }
            while control.paused.load(Ordering::Relaxed) {
                if control.canceled.load(Ordering::Relaxed) {
                    return Err(CANCELED.to_string());
                }
                file.flush().map_err(|err| err.to_string())?;
                thread::sleep(Duration::from_millis(100));
            }

            let read = match response.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => read,
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(err) => return Err(describe(&err)),
            };
            let copy_started = Instant::now();
            file.write_all(&buffer[..read])
                .map_err(|err| format!("cannot write {}: {err}", path.display()))?;
            received += read as u64;
            window_bytes += read as u64;
            control.received.store(received, Ordering::Relaxed);

            let elapsed = window_start.elapsed();
            let speed = if elapsed >= Duration::from_millis(400) {
                let per_sec = (window_bytes as f64 / elapsed.as_secs_f64()) as u64;
                window_start = Instant::now();
                window_bytes = 0;
                per_sec
            } else {
                0
            };
            self.update(id, |task| {
                task.received_bytes = received;
                if total > 0 {
                    task.total_bytes = total;
                }
                if speed > 0 {
                    task.speed_bytes_per_sec = speed;
                }
            });
            self.throttle(copy_started.elapsed());
        }

        file.flush().map_err(|err| err.to_string())?;
        if total > 0 && received < total {
            return Err(format!(
                "transfer ended early ({received} of {total} bytes)"
            ));
        }
        Ok(())
    }
}

fn open_target(path: &Path, append: bool) -> Result<File, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("cannot create {}: {err}", parent.display()))?;
    }
    let mut options = OpenOptions::new();
    options.write(true).create(true);
    if append {
        options.append(true);
    } else {
        options.truncate(true);
    }
    options
        .open(path)
        .map_err(|err| format!("cannot write {}: {err}", path.display()))
}

fn describe(err: &dyn std::error::Error) -> String {
    let mut message = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !text.is_empty() && !message.contains(&text) {
            message = format!("{message}: {text}");
        }
        source = cause.source();
    }
    message
}

fn content_range_total(value: &str) -> Option<u64> {
    value.rsplit('/').next()?.trim().parse().ok()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or(0)
}

fn new_id(now: u64) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!("dl-{now:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| if "\\/:*?\"<>|".contains(ch) { '_' } else { ch })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        "download".to_string()
    } else {
        cleaned.chars().take(180).collect()
    }
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".to_string())
}

fn file_stem_from_url(url: &str) -> String {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    let last = without_query.rsplit('/').next().unwrap_or("");
    if last.is_empty() {
        "download".to_string()
    } else {
        last.to_string()
    }
}

fn guess_extension(url: &str) -> Option<&'static str> {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
    let known = [
        ("mp4", "mp4"),
        ("mkv", "mkv"),
        ("webm", "webm"),
        ("m4v", "m4v"),
        ("avi", "avi"),
        ("mov", "mov"),
        ("m4a", "m4a"),
        ("mp3", "mp3"),
        ("aac", "aac"),
        ("flac", "flac"),
        ("srt", "srt"),
        ("vtt", "vtt"),
        ("ass", "ass"),
        ("zip", "zip"),
    ];
    known
        .iter()
        .find(|(ext, _)| path.ends_with(&format!(".{ext}")))
        .map(|(_, ext)| *ext)
}

fn with_extension(name: &str, extension: Option<&str>) -> String {
    let Some(extension) = extension else {
        return name.to_string();
    };
    if name.to_lowercase().ends_with(&format!(".{extension}")) {
        return name.to_string();
    }
    // A title like "The Odyssey (2026)" becomes "The Odyssey (2026).mp4".
    format!("{name}.{extension}")
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), Some(extension.to_string())),
        _ => (name.to_string(), None),
    };
    for index in 1..1000 {
        let file = match &extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = dir.join(file);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(name)
}

#[cfg(windows)]
fn reveal_in_explorer(path: &Path) {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide = |text: &str| -> Vec<u16> {
        std::ffi::OsStr::new(text)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let verb = wide("open");
    let program = wide("explorer.exe");
    let target = if path.exists() {
        let quoted = format!("/select,\"{}\"", path.display());
        wide(&quoted)
    } else {
        let folder = path.parent().unwrap_or(path);
        wide(&folder.display().to_string())
    };
    unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(program.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

#[cfg(not(windows))]
fn reveal_in_explorer(_path: &Path) {}

fn log(message: &str) {
    eprintln!("[downloads] {message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_windows_unsafe_characters() {
        assert_eq!(sanitize("A:B/C*D?.mkv"), "A_B_C_D_.mkv");
        assert_eq!(sanitize("   "), "download");
    }

    #[test]
    fn reads_total_from_content_range() {
        assert_eq!(content_range_total("bytes 0-99/1234"), Some(1234));
        assert_eq!(content_range_total("bytes 0-99/*"), None);
    }

    #[test]
    fn infers_extension_from_url() {
        assert_eq!(guess_extension("https://host/a/b.MKV?x=1"), Some("mkv"));
        assert_eq!(guess_extension("https://host/file/hiXDFxVe?download="), None);
        assert_eq!(with_extension("Title", Some("mp4")), "Title.mp4");
        assert_eq!(with_extension("Title.mp4", Some("mp4")), "Title.mp4");
    }
}
