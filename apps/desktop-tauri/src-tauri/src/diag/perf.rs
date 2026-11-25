//! `perf`-feature implementation: one append-only timeline per run.
//!
//! An installed release build has no console attached, so every timing mark and
//! lifecycle event goes to `filmsnaps.log` in the per-user log directory
//! instead. Marks are relative to process start, which is the only clock that
//! can cover startup from the first instruction to the first painted frame.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::Manager;

static START: OnceLock<Instant> = OnceLock::new();
static SINK: OnceLock<Mutex<Option<File>>> = OnceLock::new();

/// One previous log is kept, so a long-lived session cannot grow unbounded.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Must be the first statement of `run()`, before anything is built.
pub fn start_timer() {
    let _ = START.set(Instant::now());
}

fn elapsed() -> String {
    match START.get() {
        Some(start) => format!("{:>8.1}ms", start.elapsed().as_secs_f64() * 1000.0),
        None => "         ?ms".to_string(),
    }
}

pub fn init(app: &tauri::AppHandle) {
    let dir = app
        .path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir());
    let Ok(dir) = dir else {
        eprintln!("[diag] no log directory; file logging disabled");
        return;
    };
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("filmsnaps.log");
    rotate(&path);
    let file = OpenOptions::new().create(true).append(true).open(&path).ok();
    if file.is_none() {
        eprintln!("[diag] could not open {}", path.display());
    }
    let _ = SINK.set(Mutex::new(file));
    write(
        "app",
        &format!(
            "run v{} host={} log={}",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            path.display()
        ),
    );
}

fn rotate(path: &Path) {
    if fs::metadata(path)
        .map(|meta| meta.len() > MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
}

/// Appends one line. Never blocks the caller on anything but the log file, and
/// never fails it: diagnostics must not be able to break playback.
pub fn write(scope: &str, message: &str) {
    let line = format!("[{}] {:<7} {}", elapsed(), scope, message);
    if let Some(sink) = SINK.get() {
        if let Ok(mut guard) = sink.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = writeln!(file, "{line}");
                let _ = file.flush();
            }
        }
    }
    // Dev builds also keep stderr, so `tauri dev` shows the same timeline.
    #[cfg(debug_assertions)]
    eprintln!("{line}");
}

/// Times a startup stage. Everything between process start and the first
/// painted frame is measured this way, so the slowest stage is a single line.
pub fn span<T>(label: &str, work: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let value = work();
    write(
        "stage",
        &format!("{label} in {} ms", started.elapsed().as_millis()),
    );
    value
}

/// Splits the window-build wait, which the builder reports as one opaque span.
/// Running before the window exists, this records when a *new* browser process
/// appears (before or after the handover to WebView2), where WebView2 keeps its
/// profile (its size is the other documented cold-start cost), and — through
/// `span_cpu` — whether the main thread was busy or waiting.
pub fn watch_startup(app: &tauri::AppHandle) {
    let data_dir = app.path().app_local_data_dir().ok();
    std::thread::spawn(move || log_storage(data_dir.as_deref()));
    std::thread::spawn(watch_startup_probes);
}

/// Wall time plus the calling thread's own CPU time. A stage that burns as much
/// CPU as wall time is the app's own work; one that burns almost none was spent
/// waiting on WebView2.
pub fn span_cpu<T>(label: &str, work: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let before = thread_cpu();
    let value = work();
    let after = thread_cpu();
    match (before, after) {
        (Some((user0, kernel0)), Some((user1, kernel1))) => write(
            "stage",
            &format!(
                "{label} in {} ms (main thread cpu {} user + {} kernel ms)",
                started.elapsed().as_millis(),
                user1.saturating_sub(user0),
                kernel1.saturating_sub(kernel0)
            ),
        ),
        _ => write(
            "stage",
            &format!("{label} in {} ms", started.elapsed().as_millis()),
        ),
    }
    value
}

#[cfg(windows)]
fn thread_cpu() -> Option<(u128, u128)> {
    use windows::Win32::System::Threading::GetCurrentThread;

    let (user, kernel) = thread_times(unsafe { GetCurrentThread() })?;
    Some((filetime_ms(user), filetime_ms(kernel)))
}

#[cfg(windows)]
fn filetime_ms(time: windows::Win32::Foundation::FILETIME) -> u128 {
    let ticks = ((time.dwHighDateTime as u64) << 32) | time.dwLowDateTime as u64;
    ticks as u128 / 10_000
}

/// `(user, kernel)` for a thread handle.
#[cfg(windows)]
fn thread_times(
    thread: windows::Win32::Foundation::HANDLE,
) -> Option<(
    windows::Win32::Foundation::FILETIME,
    windows::Win32::Foundation::FILETIME,
)> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetThreadTimes;

    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut creation, mut exit, mut kernel, mut user) = (zero, zero, zero, zero);
    unsafe {
        GetThreadTimes(thread, &mut creation, &mut exit, &mut kernel, &mut user).ok()?;
    }
    Some((user, kernel))
}

#[cfg(not(windows))]
fn thread_cpu() -> Option<(u128, u128)> {
    None
}

/// How long the sampler runs: startup, the home catalogue and a first playback
/// all fall inside it.
#[cfg(windows)]
const CPU_WATCH: Duration = Duration::from_secs(60);
#[cfg(windows)]
const CPU_TICK: Duration = Duration::from_millis(500);
/// Below this a sample is noise, not a stall.
#[cfg(windows)]
const CPU_BUSY_MS: u128 = 60;

/// Splits a stall the page cannot report. Busy UI-thread CPU means the work is
/// the shell's own; busy WebView2 processes next to an idle UI thread means the
/// runtime is working; both idle means the wait is outside both, and no change
/// to either side can shorten it.
pub fn watch_cpu() {
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::GetCurrentThreadId;

        // Read on the UI thread itself: the sampler follows this thread, not the
        // process, so it can tell our own work from WebView2's.
        let ui_thread = unsafe { GetCurrentThreadId() };
        std::thread::spawn(move || sample_cpu(ui_thread));
    }
}

#[cfg(not(windows))]
pub fn watch_cpu() {}

#[cfg(windows)]
fn sample_cpu(ui_thread: u32) {
    use windows::Win32::System::Threading::{OpenThread, THREAD_QUERY_LIMITED_INFORMATION};

    let thread = unsafe { OpenThread(THREAD_QUERY_LIMITED_INFORMATION, false, ui_thread) }.ok();
    let started = Instant::now();
    // Primed before the first tick: starting from zero would print the lifetime
    // CPU of every msedgewebview2 process on the machine (other apps included)
    // as if it were one 500 ms sample.
    let mut last_webview = webview_cpu().0;
    let mut last_ui = thread.map(thread_ms).unwrap_or(0);
    let mut ticks = 0u32;
    while started.elapsed() < CPU_WATCH {
        std::thread::sleep(CPU_TICK);
        ticks += 1;
        let (webview, processes) = webview_cpu();
        let ui = thread.map(thread_ms).unwrap_or(0);
        let ui_delta = ui.saturating_sub(last_ui);
        let webview_delta = webview.saturating_sub(last_webview);
        last_ui = ui;
        last_webview = webview;
        // Every fourth idle tick still gets a line: "nothing ran" rules both
        // suspects out for that window.
        if ui_delta + webview_delta >= CPU_BUSY_MS || ticks % 4 == 0 {
            write(
                "cpu",
                &format!(
                    "ui thread {ui_delta} ms, webview2 {webview_delta} ms over {processes} proc(s) at {:.1} s",
                    started.elapsed().as_secs_f64()
                ),
            );
        }
    }
}

#[cfg(windows)]
fn thread_ms(thread: windows::Win32::Foundation::HANDLE) -> u128 {
    let Some((user, kernel)) = thread_times(thread) else {
        return 0;
    };
    filetime_ms(user) + filetime_ms(kernel)
}

#[cfg(windows)]
fn webview_cpu() -> (u128, usize) {
    let processes = browser_processes();
    let total = processes.iter().map(|pid| process_ms(*pid)).sum::<u128>();
    (total, processes.len())
}

#[cfg(windows)]
fn process_ms(pid: u32) -> u128 {
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    // A browser process that exits mid-sample simply drops out of the sum.
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return 0;
    };
    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut creation, mut exit, mut kernel, mut user) = (zero, zero, zero, zero);
    let times = unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) };
    unsafe {
        let _ = CloseHandle(process);
    }
    if times.is_err() {
        return 0;
    }
    filetime_ms(user) + filetime_ms(kernel)
}

/// WebView2's default user data folder sits next to the executable; an explicit
/// `data_directory` would put it under the app's local data folder instead. One
/// line per directory under that folder follows, so a bloated profile is
/// visible in the same log as the timings.
fn log_storage(data_dir: Option<&Path>) {
    log_exe_profile();
    let Some(root) = data_dir else {
        return;
    };
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let (files, bytes) = dir_size(&entry.path());
        write(
            "probe",
            &format!(
                "data {} {:.1} MB in {files} file(s)",
                entry.file_name().to_string_lossy(),
                bytes as f64 / (1024.0 * 1024.0)
            ),
        );
    }
}

fn log_exe_profile() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    write("probe", &format!("exe {}", exe.display()));
    let Some(dir) = exe.parent() else {
        return;
    };
    let mut candidates = vec![dir.join("EBWebView")];
    if let Some(name) = exe.file_name() {
        candidates.push(dir.join(format!("{}.WebView2", name.to_string_lossy())));
    }
    for path in candidates {
        if !path.is_dir() {
            write("probe", &format!("profile {} absent", path.display()));
            continue;
        }
        let (files, bytes) = dir_size(&path);
        write(
            "probe",
            &format!(
                "profile {} {:.1} MB in {files} file(s)",
                path.display(),
                bytes as f64 / (1024.0 * 1024.0)
            ),
        );
    }
}

/// Two transitions bracket the webview-build span: when our own native window
/// exists, and when a browser process that did not exist at launch appears.
/// Window first means the seconds are WebView2's; browser process last means
/// the cost sits before the runtime hands over. Only *new* processes count:
/// other WebView2 hosts are always running, and matching any of them made the
/// previous version of this probe report 9 ms.
fn watch_startup_probes() {
    let started = Instant::now();
    let before = browser_processes();
    let mut window_seen = false;
    let mut browser_seen = false;
    loop {
        if !window_seen && own_window_exists() {
            window_seen = true;
            write(
                "probe",
                &format!(
                    "app window exists after {} ms",
                    started.elapsed().as_millis()
                ),
            );
        }
        if !browser_seen {
            let running = browser_processes();
            if running.difference(&before).next().is_some() {
                browser_seen = true;
                write(
                    "probe",
                    &format!(
                        "webview2 launched a browser process after {} ms ({} running at start, {} now)",
                        started.elapsed().as_millis(),
                        before.len(),
                        running.len()
                    ),
                );
            }
        }
        if window_seen && browser_seen {
            return;
        }
        if started.elapsed() > Duration::from_secs(20) {
            write(
                "probe",
                &format!(
                    "startup probes timed out after 20 s (window seen: {window_seen}, new browser process seen: {browser_seen}, {} running at start)",
                    before.len()
                ),
            );
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(windows)]
fn own_window_exists() -> bool {
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId};

    struct Search {
        pid: u32,
        found: bool,
    }

    unsafe extern "system" fn visit(hwnd: HWND, param: LPARAM) -> windows::core::BOOL {
        let search = unsafe { &mut *(param.0 as *mut Search) };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == search.pid {
            search.found = true;
            return windows::core::BOOL(0);
        }
        windows::core::BOOL(1)
    }

    let mut search = Search {
        pid: std::process::id(),
        found: false,
    };
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }
    search.found
}

#[cfg(not(windows))]
fn own_window_exists() -> bool {
    false
}

/// Bounded walk: a runaway cache must not turn the probe into its own stall.
fn dir_size(root: &Path) -> (usize, u64) {
    const MAX_FILES: usize = 50_000;
    let mut files = 0;
    let mut bytes = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(entry.path());
                continue;
            }
            files += 1;
            bytes += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            if files >= MAX_FILES {
                return (files, bytes);
            }
        }
    }
    (files, bytes)
}

#[cfg(windows)]
fn browser_processes() -> std::collections::HashSet<u32> {
    use std::collections::HashSet;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut running = HashSet::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return running;
    };
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    unsafe {
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let name = String::from_utf16_lossy(&entry.szExeFile);
                let name = name.split('\0').next().unwrap_or_default();
                if name.eq_ignore_ascii_case("msedgewebview2.exe") {
                    running.insert(entry.th32ProcessID);
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    running
}

#[cfg(not(windows))]
fn browser_processes() -> std::collections::HashSet<u32> {
    std::collections::HashSet::new()
}

/// Window lifecycle. Minimize is the trigger for the reported playback
/// restarts, so the marks record the size Windows reports at that moment.
pub fn attach_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    window.on_window_event(|event| match event {
        tauri::WindowEvent::Resized(size) => {
            // Transient sizes are the ones nobody chose: Windows reports a
            // near-zero window while minimizing.
            if size.width < 640 || size.height < 480 {
                mark_resize(size.width, size.height);
            }
        }
        tauri::WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
            write("window", &format!("scale factor -> {scale_factor}"));
        }
        tauri::WindowEvent::Focused(focused) => {
            write("window", if *focused { "focused" } else { "blurred" });
        }
        tauri::WindowEvent::CloseRequested { .. } => write("window", "close requested"),
        tauri::WindowEvent::Destroyed => write("window", "destroyed"),
        _ => {}
    });
}

fn mark_resize(width: u32, height: u32) {
    write("window", &format!("resized to {width}x{height} (transient)"));
}
