//! Native child window that mpv renders into (`wid`).
//!
//! WebView2 composites through DirectComposition, so a native surface cannot
//! sit *under* the page. This window is created after the webview and kept at
//! HWND_TOP, which is the placement that actually stays visible.
//!
//! Because it wins the z-order it also wins the mouse, which is what the OSC
//! needs: playback controls are drawn by mpv into this surface and are driven
//! by the pointer events the page can never receive here.

#[cfg(windows)]
pub use win::{set_bounds, set_osc_visible, set_visible, VideoSurface};

#[cfg(not(windows))]
pub use stub::{set_bounds, set_osc_visible, set_visible, VideoSurface};

#[cfg(windows)]
mod win {
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::Once;

    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::{GetStockObject, ScreenToClient, HBRUSH, BLACK_BRUSH};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, LoadCursorW, PostMessageW,
        RegisterClassW, SetCursor, SetWindowPos, ShowWindow, CS_HREDRAW, CS_VREDRAW,
        HWND_TOP, IDC_ARROW, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNA,
        WNDCLASSW, WM_APP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL,
        WM_SETCURSOR, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_NOACTIVATE,
        WS_VISIBLE,
    };

    pub struct VideoSurface {
        hwnd: HWND,
    }

    unsafe impl Send for VideoSurface {}

    static REGISTER: Once = Once::new();
    static OSC_VISIBLE: AtomicBool = AtomicBool::new(true);
    static SURFACE_HWND: AtomicIsize = AtomicIsize::new(0);
    const APPLY_CURSOR: u32 = WM_APP + 1;

    pub fn set_osc_visible(visible: bool) {
        OSC_VISIBLE.store(visible, Ordering::Relaxed);
        let hwnd = SURFACE_HWND.load(Ordering::Relaxed);
        if hwnd != 0 {
            unsafe {
                let _ = PostMessageW(
                    Some(HWND(hwnd as _)),
                    APPLY_CURSOR,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        }
    }

    impl VideoSurface {
        pub fn create(parent: isize) -> Result<Self, String> {
            unsafe {
                let parent = HWND(parent as *mut std::ffi::c_void);
                REGISTER.call_once(|| register_class());
                let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
                let brush = HBRUSH(GetStockObject(BLACK_BRUSH).0);
                let hwnd = CreateWindowExW(
                    // NOACTIVATE keeps the click from stealing focus from the page;
                    // the surface still receives it, which the OSC requires.
                    WS_EX_NOACTIVATE,
                    w!("FilmSnapsVideoSurface"),
                    PCWSTR::null(),
                    WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                    0,
                    0,
                    1,
                    1,
                    Some(parent),
                    None,
                    Some(instance.into()),
                    Some(Box::into_raw(Box::new(brush)) as *const _),
                )
                .map_err(|e| format!("could not create the video surface: {e}"))?;
                SURFACE_HWND.store(hwnd.0 as isize, Ordering::Relaxed);
                Ok(Self { hwnd })
            }
        }

        pub fn hwnd_value(&self) -> i64 {
            self.hwnd.0 as i64
        }

    }

    /// Bounds are physical pixels relative to the window's client area.
    ///
    /// Free functions on purpose: `SetWindowPos`/`ShowWindow` can block while
    /// the window is busy, so the caller must not hold the player lock (shared
    /// with every UI command) across them.
    pub fn set_bounds(hwnd: i64, x: i32, y: i32, width: i32, height: i32) {
        if hwnd == 0 {
            return;
        }
        unsafe {
            let _ = SetWindowPos(
                HWND(hwnd as _),
                Some(HWND_TOP),
                x,
                y,
                width.max(1),
                height.max(1),
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }

    pub fn set_visible(hwnd: i64, visible: bool) {
        if hwnd == 0 {
            return;
        }
        unsafe {
            let _ = ShowWindow(HWND(hwnd as _), if visible { SW_SHOWNA } else { SW_HIDE });
        }
    }

    impl Drop for VideoSurface {
        fn drop(&mut self) {
            SURFACE_HWND.store(0, Ordering::Relaxed);
            unsafe {
                let _ = DestroyWindow(self.hwnd);
            }
        }
    }

    unsafe fn register_class() {
        let Ok(instance) = GetModuleHandleW(None) else {
            return;
        };
        let class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance.into(),
            lpszClassName: w!("FilmSnapsVideoSurface"),
            ..Default::default()
        };
        RegisterClassW(&class);
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            APPLY_CURSOR => {
                apply_cursor();
                LRESULT(0)
            }
            WM_SETCURSOR => {
                if !OSC_VISIBLE.load(Ordering::Relaxed) {
                    SetCursor(None);
                    LRESULT(1)
                } else {
                    DefWindowProcW(hwnd, msg, wparam, lparam)
                }
            }
            WM_MOUSEMOVE => {
                forward_pointer("move", lparam);
                LRESULT(0)
            }
            WM_LBUTTONDOWN => {
                let _ = SetCapture(hwnd);
                forward_pointer("down", lparam);
                LRESULT(0)
            }
            WM_LBUTTONUP => {
                let _ = ReleaseCapture();
                forward_pointer("up", lparam);
                LRESULT(0)
            }
            WM_MOUSEWHEEL => {
                let delta = ((wparam.0 >> 16) & 0xFFFF) as i16;
                let mut point = POINT {
                    x: (lparam.0 & 0xFFFF) as u16 as i16 as i32,
                    y: ((lparam.0 >> 16) & 0xFFFF) as u16 as i16 as i32,
                };
                let _ = ScreenToClient(hwnd, &mut point);
                let x = point.x.to_string();
                let y = point.y.to_string();
                send_mouse(&x, &y);
                send_osc(&["fs-wheel", if delta > 0 { "up" } else { "down" }, &x, &y]);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    unsafe fn apply_cursor() {
        if OSC_VISIBLE.load(Ordering::Relaxed) {
            if let Ok(arrow) = LoadCursorW(None, IDC_ARROW) {
                SetCursor(Some(arrow));
            }
        } else {
            SetCursor(None);
        }
    }

    fn coords(lparam: LPARAM) -> (i16, i16) {
        (
            (lparam.0 & 0xFFFF) as u16 as i16,
            ((lparam.0 >> 16) & 0xFFFF) as u16 as i16,
        )
    }

    fn send_mouse(x: &str, y: &str) {
        if let Err(err) = crate::player::forward_input(&["mouse", x, y]) {
            crate::player::log(&format!("mouse {x},{y} rejected: {err}"));
        }
    }

    fn send_osc(args: &[&str]) {
        let mut command = vec!["script-message-to", crate::player::OSC_CLIENT];
        command.extend_from_slice(args);
        match crate::player::forward_input(&command) {
            Ok(()) => crate::player::note_osc_alive(),
            Err(err) => {
                crate::player::log(&format!("OSC message {args:?} rejected: {err}"));
                // A live script always accepts these; error -12 (dead target
                // client) means the OSC crashed. Revive it after a streak.
                if crate::player::note_osc_rejected() {
                    crate::player::revive_osc();
                }
            }
        }
    }

    fn forward_pointer(mode: &str, lparam: LPARAM) {
        let (x, y) = coords(lparam);
        let x = x.to_string();
        let y = y.to_string();
        send_mouse(&x, &y);
        send_osc(&["fs-pointer", mode, &x, &y]);
    }
}

#[cfg(not(windows))]
mod stub {
    pub struct VideoSurface;

    pub fn set_osc_visible(_visible: bool) {}

    impl VideoSurface {
        pub fn create(_parent: isize) -> Result<Self, String> {
            Err("the native video surface is implemented for Windows only".to_string())
        }
        pub fn hwnd_value(&self) -> i64 {
            0
        }
    }

    pub fn set_bounds(_hwnd: i64, _x: i32, _y: i32, _w: i32, _h: i32) {}
    pub fn set_visible(_hwnd: i64, _visible: bool) {}
}
