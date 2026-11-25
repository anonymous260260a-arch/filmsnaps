//! Minimal, runtime-loaded binding to the mpv client API.
//!
//! `libmpv2` links `mpv.lib` at build time, which makes an otherwise hermetic
//! Rust build depend on prebuilt import libraries. We instead resolve the
//! handful of client-API symbols from `libmpv-2.dll` at startup, so the build
//! works everywhere and a missing runtime fails with an actionable message.

use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::slice;
use std::sync::Arc;

use libloading::Library;

pub type MpvHandle = *mut c_void;

pub const FORMAT_FLAG: c_int = 3;
pub const FORMAT_INT64: c_int = 4;
pub const FORMAT_DOUBLE: c_int = 5;

pub const EVENT_NONE: c_int = 0;
pub const EVENT_SHUTDOWN: c_int = 1;
pub const EVENT_END_FILE: c_int = 7;
pub const EVENT_FILE_LOADED: c_int = 8;
pub const EVENT_CLIENT_MESSAGE: c_int = 16;
pub const EVENT_PLAYBACK_RESTART: c_int = 21;
pub const EVENT_PROPERTY_CHANGE: c_int = 22;

#[repr(C)]
struct RawEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct RawEventEndFile {
    reason: c_int,
    error: c_int,
    playlist_entry_id: i64,
    playlist_insert_id: i64,
    playlist_insert_num_entries: c_int,
}

#[repr(C)]
struct RawEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct RawEventClientMessage {
    num_args: c_int,
    args: *mut *mut c_char,
}

#[derive(Debug, thiserror::Error)]
pub enum MpvError {
    #[error("libmpv-2.dll was not found. Install the MPV runtime or place it in resources/mpv/. Searched: {0}")]
    LibraryMissing(String),
    #[error("libmpv-2.dll is missing the symbol {0}")]
    SymbolMissing(String),
    #[error("mpv call '{call}' failed: {detail}")]
    Call { call: String, detail: String },
}

pub struct MpvApi {
    _lib: Library,
    create: unsafe extern "C" fn() -> MpvHandle,
    initialize: unsafe extern "C" fn(MpvHandle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(MpvHandle),
    set_option_string: unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char,
    command: unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int,
    observe_property: unsafe extern "C" fn(MpvHandle, u64, *const c_char, c_int) -> c_int,
    wait_event: unsafe extern "C" fn(MpvHandle, c_double) -> *mut RawEvent,
    free: unsafe extern "C" fn(*mut c_void),
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
}

impl MpvApi {
    pub fn load(search_dirs: &[PathBuf]) -> Result<Arc<Self>, MpvError> {
        let (lib, path) = open_library(search_dirs)?;
        unsafe { Self::bind(lib) }.map(Arc::new).map_err(|err| match err {
            MpvError::SymbolMissing(_) => MpvError::SymbolMissing(format!(
                "{} (in {})",
                symbol_name(&err),
                path.display()
            )),
            other => other,
        })
    }

    unsafe fn bind(lib: Library) -> Result<Self, MpvError> {
        macro_rules! sym {
            ($name:literal, $ty:ty) => {{
                let s: libloading::Symbol<$ty> = lib.get($name).map_err(|_| {
                    MpvError::SymbolMissing(
                        std::str::from_utf8($name)
                            .unwrap_or("<invalid name>")
                            .trim_end_matches('\0')
                            .to_string(),
                    )
                })?;
                *s
            }};
        }
        let api = Self {
            create: sym!(b"mpv_create\0", unsafe extern "C" fn() -> MpvHandle),
            initialize: sym!(b"mpv_initialize\0", unsafe extern "C" fn(MpvHandle) -> c_int),
            terminate_destroy: sym!(b"mpv_terminate_destroy\0", unsafe extern "C" fn(MpvHandle)),
            set_option_string: sym!(
                b"mpv_set_option_string\0",
                unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int
            ),
            set_property_string: sym!(
                b"mpv_set_property_string\0",
                unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int
            ),
            get_property_string: sym!(
                b"mpv_get_property_string\0",
                unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char
            ),
            command: sym!(
                b"mpv_command\0",
                unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int
            ),
            observe_property: sym!(
                b"mpv_observe_property\0",
                unsafe extern "C" fn(MpvHandle, u64, *const c_char, c_int) -> c_int
            ),
            wait_event: sym!(
                b"mpv_wait_event\0",
                unsafe extern "C" fn(MpvHandle, c_double) -> *mut RawEvent
            ),
            free: sym!(b"mpv_free\0", unsafe extern "C" fn(*mut c_void)),
            error_string: sym!(
                b"mpv_error_string\0",
                unsafe extern "C" fn(c_int) -> *const c_char
            ),
            _lib: lib,
        };
        Ok(api)
    }

    fn describe(&self, code: c_int) -> String {
        if code >= 0 {
            return format!("ok ({code})");
        }
        unsafe {
            let ptr = (self.error_string)(code);
            if ptr.is_null() {
                format!("error {code}")
            } else {
                CStr::from_ptr(ptr).to_string_lossy().into_owned()
            }
        }
    }
}

fn symbol_name(err: &MpvError) -> String {
    match err {
        MpvError::SymbolMissing(name) => name.clone(),
        other => other.to_string(),
    }
}

fn open_library(search_dirs: &[PathBuf]) -> Result<(Library, PathBuf), MpvError> {
    let mut tried: Vec<String> = Vec::new();
    let mut candidates: Vec<PathBuf> = search_dirs.iter().map(|d| d.join(DLL_NAME)).collect();
    candidates.push(PathBuf::from(DLL_NAME));

    for candidate in candidates {
        tried.push(candidate.display().to_string());
        if candidate.is_file() || candidate.components().count() == 1 {
            if let Ok(lib) = unsafe { Library::new(&candidate) } {
                return Ok((lib, candidate));
            }
        }
    }
    Err(MpvError::LibraryMissing(tried.join(", ")))
}

#[cfg(windows)]
const DLL_NAME: &str = "libmpv-2.dll";
#[cfg(not(windows))]
const DLL_NAME: &str = "libmpv.so.2";

pub enum PropValue {
    Flag(bool),
    Int(i64),
    Double(f64),
}

pub enum MpvEvent {
    None,
    Shutdown,
    FileLoaded,
    EndFile { reason: i32, error: i32 },
    ClientMessage(Vec<String>),
    PlaybackRestart,
    Property { name: String, value: Option<PropValue> },
    Other,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub position: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: f64,
    pub speed: f64,
    pub muted: bool,
}

impl Default for PlayerSnapshot {
    fn default() -> Self {
        Self {
            position: 0.0,
            duration: 0.0,
            paused: true,
            volume: 100.0,
            speed: 1.0,
            muted: false,
        }
    }
}

/// Runs an input command (`mouse …`, `keydown …`, `keyup …`) on an
/// already-initialised handle. Embedded players never see window messages, so
/// the host has to feed pointer input to mpv for the OSC to react.
pub fn send_input(
    api: &MpvApi,
    handle: MpvHandle,
    args: &[&str],
) -> Result<(), MpvError> {
    let owned: Vec<CString> = args
        .iter()
        .map(|arg| CString::new(*arg).unwrap_or_default())
        .collect();
    let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
    ptrs.push(std::ptr::null());
    let code = unsafe { (api.command)(handle, ptrs.as_ptr()) };
    if code < 0 {
        return Err(MpvError::Call {
            call: "mpv_command".into(),
            detail: format!("error code {code}"),
        });
    }
    Ok(())
}

pub struct Mpv {
    api: Arc<MpvApi>,
    handle: MpvHandle,
}

// The mpv client API is safe to call from any single thread at a time; callers
// serialise access through a Mutex.
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

impl Mpv {
    pub fn new(api: Arc<MpvApi>) -> Result<Self, MpvError> {
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err(MpvError::Call {
                call: "mpv_create".into(),
                detail: "returned a null handle".into(),
            });
        }
        Ok(Self { api, handle })
    }

    pub fn handle(&self) -> MpvHandle {
        self.handle
    }

    pub fn initialize(&self) -> Result<(), MpvError> {
        self.check("mpv_initialize", unsafe { (self.api.initialize)(self.handle) })
    }

    pub fn set_option(&self, name: &str, value: &str) -> Result<(), MpvError> {
        let (name, value) = c_pair(name, value);
        self.check(
            "mpv_set_option_string",
            unsafe { (self.api.set_option_string)(self.handle, name.as_ptr(), value.as_ptr()) },
        )
    }

    pub fn set_property(&self, name: &str, value: &str) -> Result<(), MpvError> {
        let (name, value) = c_pair(name, value);
        self.check(
            "mpv_set_property_string",
            unsafe {
                (self.api.set_property_string)(self.handle, name.as_ptr(), value.as_ptr())
            },
        )
    }

    pub fn property(&self, name: &str) -> Option<String> {
        let name = CString::new(name).ok()?;
        unsafe {
            let ptr = (self.api.get_property_string)(self.handle, name.as_ptr());
            if ptr.is_null() {
                return None;
            }
            let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            (self.api.free)(ptr as *mut c_void);
            Some(value)
        }
    }

    pub fn command(&self, args: &[&str]) -> Result<(), MpvError> {
        let owned: Vec<CString> = args
            .iter()
            .map(|a| CString::new(*a).unwrap_or_default())
            .collect();
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        self.check("mpv_command", unsafe {
            (self.api.command)(self.handle, ptrs.as_ptr())
        })
    }

    pub fn observe(&self, id: u64, name: &str, format: c_int) -> Result<(), MpvError> {
        let name = CString::new(name).unwrap_or_default();
        self.check("mpv_observe_property", unsafe {
            (self.api.observe_property)(self.handle, id, name.as_ptr(), format)
        })
    }

    pub fn wait_event(&self, timeout: f64) -> MpvEvent {
        unsafe {
            let event = (self.api.wait_event)(self.handle, timeout);
            if event.is_null() {
                return MpvEvent::None;
            }
            let raw = &*event;
            match raw.event_id {
                EVENT_NONE => MpvEvent::None,
                EVENT_SHUTDOWN => MpvEvent::Shutdown,
                EVENT_FILE_LOADED => MpvEvent::FileLoaded,
                EVENT_CLIENT_MESSAGE => {
                    if raw.data.is_null() {
                        MpvEvent::ClientMessage(Vec::new())
                    } else {
                        let message = &*(raw.data as *const RawEventClientMessage);
                        let args = if message.num_args > 0 && !message.args.is_null() {
                            slice::from_raw_parts(
                                message.args as *const *const c_char,
                                message.num_args as usize,
                            )
                            .iter()
                            .filter(|arg| !arg.is_null())
                            .map(|arg| CStr::from_ptr(*arg).to_string_lossy().into_owned())
                            .collect()
                        } else {
                            Vec::new()
                        };
                        MpvEvent::ClientMessage(args)
                    }
                }
                EVENT_END_FILE => {
                    if raw.data.is_null() {
                        MpvEvent::EndFile { reason: -1, error: 0 }
                    } else {
                        let end = &*(raw.data as *const RawEventEndFile);
                        MpvEvent::EndFile {
                            reason: end.reason,
                            error: end.error,
                        }
                    }
                }
                EVENT_PLAYBACK_RESTART => MpvEvent::PlaybackRestart,
                EVENT_PROPERTY_CHANGE => {
                    if raw.data.is_null() {
                        return MpvEvent::Property {
                            name: String::new(),
                            value: None,
                        };
                    }
                    let prop = &*(raw.data as *const RawEventProperty);
                    let name = if prop.name.is_null() {
                        String::new()
                    } else {
                        CStr::from_ptr(prop.name).to_string_lossy().into_owned()
                    };
                    MpvEvent::Property {
                        name,
                        value: read_value(prop.format, prop.data),
                    }
                }
                _ => MpvEvent::Other,
            }
        }
    }

    fn check(&self, call: &str, code: c_int) -> Result<(), MpvError> {
        if code >= 0 {
            Ok(())
        } else {
            Err(MpvError::Call {
                call: call.to_string(),
                detail: self.api.describe(code),
            })
        }
    }
}

impl Drop for Mpv {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe { (self.api.terminate_destroy)(self.handle) };
            self.handle = std::ptr::null_mut();
        }
    }
}

unsafe fn read_value(format: c_int, data: *mut c_void) -> Option<PropValue> {
    if data.is_null() {
        return None;
    }
    match format {
        // String properties are read on demand through `Mpv::property`.
        1 => None,
        FORMAT_FLAG => Some(PropValue::Flag(*(data as *const c_int) != 0)),
        FORMAT_INT64 => Some(PropValue::Int(*(data as *const i64))),
        FORMAT_DOUBLE => Some(PropValue::Double(*(data as *const f64))),
        _ => None,
    }
}

fn c_pair(name: &str, value: &str) -> (CString, CString) {
    (
        CString::new(name).unwrap_or_default(),
        CString::new(value).unwrap_or_default(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_library_reports_where_it_looked() {
        let err = open_library(&[PathBuf::from("definitely/not/here")]).unwrap_err();
        let message = err.to_string();
        assert!(message.contains("definitely/not/here"), "{message}");
        assert!(message.contains("libmpv"), "{message}");
    }

    #[test]
    fn snapshot_defaults_to_idle_state() {
        let snapshot = PlayerSnapshot::default();
        assert!(snapshot.paused);
        assert_eq!(snapshot.volume, 100.0);
    }
}
