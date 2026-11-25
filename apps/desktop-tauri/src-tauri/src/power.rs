//! System sleep handling.
//!
//! Playback is paused before the machine suspends and resumed after wake, so
//! the audio device and decoder state come back cleanly instead of stalling on
//! the first frame after resume. Only a pause this module made is undone.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;

/// Sleep/wake codes from the power notification callback. windows-rs exposes
/// the registration call but not these event values.
const PBT_APMSUSPEND: u32 = 0x0004;
const PBT_APMRESUMESUSPEND: u32 = 0x0007;
const PBT_APMRESUMEAUTOMATIC: u32 = 0x0012;

struct Subscriber {
    app: AppHandle,
    paused_for_sleep: AtomicBool,
}

/// Registers for sleep notifications. Best effort: if registration fails the
/// app keeps running exactly as before, with playback continuing through sleep.
pub fn attach(app: &AppHandle) {
    #[cfg(windows)]
    {
        use std::ffi::c_void;

        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::Power::{
            PowerRegisterSuspendResumeNotification, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS,
        };
        use windows::Win32::UI::WindowsAndMessaging::DEVICE_NOTIFY_CALLBACK;

        let subscriber = Box::into_raw(Box::new(Subscriber {
            app: app.clone(),
            paused_for_sleep: AtomicBool::new(false),
        }));
        // The registration holds this pointer for the life of the process, so
        // both allocations are deliberately leaked with it.
        let params = Box::into_raw(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(on_power_event),
            Context: subscriber.cast::<c_void>(),
        }));
        let mut registration = std::ptr::null_mut();
        let result = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                HANDLE(params.cast::<c_void>()),
                &mut registration,
            )
        };
        if result.is_err() {
            eprintln!("[power] sleep notifications unavailable: {result:?}");
            unsafe {
                drop(Box::from_raw(params));
                drop(Box::from_raw(subscriber));
            }
        }
    }

    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
unsafe extern "system" fn on_power_event(
    context: *const std::ffi::c_void,
    event: u32,
    _setting: *const std::ffi::c_void,
) -> u32 {
    if context.is_null() {
        return 0;
    }
    let subscriber = unsafe { &*context.cast::<Subscriber>() };
    match event {
        PBT_APMSUSPEND => {
            if is_playing(subscriber) {
                match set_pause(subscriber, "yes") {
                    Ok(()) => subscriber.paused_for_sleep.store(true, Ordering::SeqCst),
                    Err(err) => eprintln!("[power] could not pause for sleep: {err}"),
                }
            }
        }
        PBT_APMRESUMESUSPEND | PBT_APMRESUMEAUTOMATIC => {
            if subscriber.paused_for_sleep.swap(false, Ordering::SeqCst) {
                if let Err(err) = set_pause(subscriber, "no") {
                    eprintln!("[power] could not resume after sleep: {err}");
                }
            }
        }
        _ => {}
    }
    0
}

#[cfg(windows)]
fn is_playing(subscriber: &Subscriber) -> bool {
    use tauri::Manager;

    let state = subscriber.app.state::<std::sync::Arc<crate::AppState>>();
    let snapshot = state.player.snapshot();
    snapshot.duration > 0.0 && !snapshot.paused
}

#[cfg(windows)]
fn set_pause(subscriber: &Subscriber, value: &str) -> Result<(), String> {
    use tauri::Manager;

    let state = subscriber.app.state::<std::sync::Arc<crate::AppState>>();
    state.player.set_property("pause", value)
}
