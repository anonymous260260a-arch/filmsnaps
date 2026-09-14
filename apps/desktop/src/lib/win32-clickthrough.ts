/**
 * win32-clickthrough — Makes mpv's child HWND click-through via WS_EX_TRANSPARENT.
 *
 * mpv renders into a child HWND inside the video BrowserWindow. Without
 * WS_EX_TRANSPARENT, Win32 hit-testing routes all mouse input to mpv's
 * child, preventing the main window beneath from receiving clicks.
 * Setting WS_EX_TRANSPARENT removes the child from hit-testing while
 * keeping its rendering intact — the main window receives all input.
 */

import koffi from "koffi";

const user32 = koffi.load("user32.dll");

const EnumChildProc = koffi.proto(
  "int __stdcall _EnumChildProc(intptr_t hwnd, intptr_t lparam)",
);
const EnumChildWindows = user32.func(
  "int __stdcall EnumChildWindows(intptr_t hwnd, _EnumChildProc* cb, intptr_t lparam)",
);
const GetWindowLongW = user32.func(
  "int32_t __stdcall GetWindowLongW(intptr_t hwnd, int32_t index)",
);
const SetWindowLongW = user32.func(
  "int32_t __stdcall SetWindowLongW(intptr_t hwnd, int32_t index, int32_t value)",
);

const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x00000020;

const readHwnd = (b: Buffer): number => Number(b.readBigUInt64LE(0));

/**
 * Marks every foreign child of `hwnd` WS_EX_TRANSPARENT so mouse input falls
 * through to the main window beneath. Modern Electron windows have no child
 * HWNDs of their own — in practice this is mpv's video child only.
 * Idempotent; safe to call on every file-loaded / playback-restart.
 */
export function makeChildWindowsClickThrough(hwndBuffer: Buffer): number {
  const hwnd = readHwnd(hwndBuffer);
  let count = 0;
  const cb = koffi.register((child: number) => {
    const ex = GetWindowLongW(child, GWL_EXSTYLE);
    if (!(ex & WS_EX_TRANSPARENT)) {
      SetWindowLongW(child, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT);
    }
    count += 1;
    return 1; // continue enumeration
  }, EnumChildProc);
  EnumChildWindows(hwnd, cb, 0);
  koffi.unregister(cb);
  return count;
}
