//! Performance diagnostics.
//!
//! Everything here exists only with the `perf` feature: a shipping build
//! compiles `mark!` down to an empty call and the bridge stops exposing `diag`,
//! so there is no log file, no timers and no page-side collection. Profile a
//! build with `pnpm --filter @filmsnaps/desktop-tauri dev:perf` (or
//! `bundle:perf`).

#[cfg(feature = "perf")]
mod perf;

#[cfg(feature = "perf")]
pub use perf::{
    attach_window, init, span, span_cpu, start_timer, watch_cpu, watch_startup,
};

/// `mark!("scope", "text {}", value)`. The message is built lazily, so the
/// arguments cost nothing when diagnostics are compiled out.
macro_rules! mark {
    ($scope:expr, $($arg:tt)*) => {
        $crate::diag::emit(($scope, format_args!($($arg)*)))
    };
}

pub(crate) use mark;

#[cfg(feature = "perf")]
pub fn emit((scope, message): (&str, std::fmt::Arguments<'_>)) {
    perf::write(scope, &message.to_string());
}

#[cfg(not(feature = "perf"))]
#[inline(always)]
pub fn emit(_: (&str, std::fmt::Arguments<'_>)) {}

#[cfg(not(feature = "perf"))]
pub fn start_timer() {}

#[cfg(not(feature = "perf"))]
pub fn init(_app: &tauri::AppHandle) {}

#[cfg(not(feature = "perf"))]
pub fn attach_window(_app: &tauri::AppHandle) {}

#[cfg(not(feature = "perf"))]
pub fn watch_startup(_app: &tauri::AppHandle) {}

#[cfg(not(feature = "perf"))]
pub fn watch_cpu() {}

/// Runs `work` and records how long it took.
#[cfg(not(feature = "perf"))]
#[inline(always)]
pub fn span<T>(_label: &str, work: impl FnOnce() -> T) -> T {
    work()
}

/// Like `span`, plus the CPU time the calling thread spent on it.
#[cfg(not(feature = "perf"))]
#[inline(always)]
pub fn span_cpu<T>(_label: &str, work: impl FnOnce() -> T) -> T {
    work()
}

/// The page's marks. Registered in every build because the invoke handler list
/// is not conditionally built; without `perf` the bridge hides `diag`, so
/// nothing ever calls it.
#[cfg(not(feature = "perf"))]
#[tauri::command]
pub fn diag_log(_event: String, _data: Option<serde_json::Value>) {}

#[cfg(feature = "perf")]
#[tauri::command]
pub fn diag_log(event: String, data: Option<serde_json::Value>) {
    match data {
        Some(data) => perf::write("web", &format!("{event} {data}")),
        None => perf::write("web", &event),
    }
}
