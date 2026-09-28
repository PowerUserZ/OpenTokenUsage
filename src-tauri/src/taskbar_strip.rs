//! Experimental taskbar strip: provider logos with session/weekly numbers inside the Windows 11
//! taskbar, left of the notification area (what macOS shows as menu bar text).
//!
//! Windows has no API for this (deskbands are gone in Windows 11), so like TrafficMonitor the
//! strip is a layered window made a child of the taskbar (`Shell_TrayWnd`). As a child it moves,
//! hides (auto-hide, full-screen apps) and stacks with the taskbar for free. It runs on its own
//! thread and never blocks: a cross-process child shares Explorer's input queue. Layered child
//! windows need Windows 8+ compatibility in the app manifest (`app.manifest`).
//! The frontend draws the image (`src/lib/taskbar-strip.ts`); this module only places it.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StripImage {
    /// RGBA with straight alpha, base64.
    rgba: String,
    width: u32,
    height: u32,
}

/// Premultiplied BGRA, what `UpdateLayeredWindow` wants.
#[derive(Clone)]
struct Pixels {
    bgra: Vec<u8>,
    width: i32,
    height: i32,
}

#[derive(Default)]
struct Shared {
    pixels: Option<Pixels>,
    /// The strip window (as isize so the state is Send); 0 while there is none.
    hwnd: isize,
    thread_running: bool,
}

fn shared() -> &'static Mutex<Shared> {
    static SHARED: OnceLock<Mutex<Shared>> = OnceLock::new();
    SHARED.get_or_init(|| Mutex::new(Shared::default()))
}

static APP: OnceLock<AppHandle> = OnceLock::new();

fn to_pixels(image: StripImage) -> Result<Pixels, String> {
    let mut data = BASE64_STANDARD
        .decode(&image.rgba)
        .map_err(|e| e.to_string())?;
    if image.width == 0 || data.len() != (image.width * image.height * 4) as usize {
        return Err(format!(
            "strip image is not {}x{} RGBA",
            image.width, image.height
        ));
    }
    for px in data.chunks_exact_mut(4) {
        let alpha = px[3] as u32;
        let (r, g, b) = (px[0] as u32, px[1] as u32, px[2] as u32);
        px[0] = (b * alpha / 255) as u8;
        px[1] = (g * alpha / 255) as u8;
        px[2] = (r * alpha / 255) as u8;
    }
    Ok(Pixels {
        bgra: data,
        width: image.width as i32,
        height: image.height as i32,
    })
}

/// Shows (or with `None` removes) the strip.
#[tauri::command]
pub fn set_taskbar_strip(app_handle: AppHandle, image: Option<StripImage>) -> Result<(), String> {
    let _ = APP.set(app_handle);
    let pixels = image.map(to_pixels).transpose()?;
    let mut state = shared().lock().map_err(|e| e.to_string())?;
    let show = pixels.is_some();
    state.pixels = pixels;
    #[cfg(windows)]
    {
        if state.hwnd != 0 {
            let message = if show {
                win::WM_APP_REDRAW
            } else {
                win::WM_CLOSE
            };
            win::post(state.hwnd, message);
        } else if show && !state.thread_running {
            state.thread_running = true;
            std::thread::Builder::new()
                .name("taskbar-strip".into())
                .spawn(win::run)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(windows)]
mod win {
    use super::{shared, APP};
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{
        GetLastError, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM,
    };
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
        SelectObject, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        BLENDFUNCTION, DIB_RGB_COLORS,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    pub const WM_APP_REDRAW: u32 = WM_APP + 1;
    pub use windows_sys::Win32::UI::WindowsAndMessaging::WM_CLOSE;

    const CLASS_NAME: &str = "OpenTokenUsageTaskbarStrip";
    /// Space between the strip and the notification area, physical px.
    const GAP: i32 = 8;
    const REPLACE_TIMER: usize = 1;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    pub fn post(hwnd: isize, message: u32) {
        unsafe { PostMessageW(hwnd as HWND, message, 0, 0) };
    }

    /// Strip thread: keeps a window attached to the taskbar while there is an image to show.
    /// An Explorer restart destroys the taskbar and our child with it; then attach to the new one.
    pub fn run() {
        let class = wide(CLASS_NAME);
        unsafe {
            let instance = GetModuleHandleW(null());
            let wc = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                hCursor: LoadCursorW(null_mut(), IDC_ARROW),
                lpszClassName: class.as_ptr(),
                ..std::mem::zeroed()
            };
            RegisterClassW(&wc); // Fails harmlessly when a previous run registered it.

            loop {
                {
                    let Ok(mut state) = shared().lock() else {
                        return;
                    };
                    if state.pixels.is_none() {
                        state.thread_running = false;
                        return;
                    }
                }
                let taskbar = FindWindowW(wide("Shell_TrayWnd").as_ptr(), null());
                let hwnd = if taskbar.is_null() {
                    null_mut()
                } else {
                    CreateWindowExW(
                        WS_EX_LAYERED | WS_EX_NOACTIVATE,
                        class.as_ptr(),
                        null(),
                        WS_CHILD | WS_CLIPSIBLINGS,
                        0,
                        0,
                        1,
                        1,
                        taskbar,
                        null_mut(),
                        instance,
                        null(),
                    )
                };
                if hwnd.is_null() {
                    log::warn!(
                        "taskbar strip: no taskbar to attach to (error {})",
                        GetLastError()
                    );
                    std::thread::sleep(Duration::from_secs(3));
                    continue;
                }
                if let Ok(mut state) = shared().lock() {
                    state.hwnd = hwnd as isize;
                }
                place(hwnd);
                SetTimer(hwnd, REPLACE_TIMER, 2000, None);

                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                if let Ok(mut state) = shared().lock() {
                    state.hwnd = 0;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        unsafe {
            match msg {
                WM_APP_REDRAW | WM_TIMER => {
                    place(hwnd);
                    0
                }
                // Clicking the strip must not take focus from the panel or the taskbar.
                WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
                WM_LBUTTONUP => {
                    if let Some(app) = APP.get() {
                        crate::panel::toggle_panel(app);
                    }
                    0
                }
                WM_CLOSE => {
                    DestroyWindow(hwnd);
                    0
                }
                WM_DESTROY => {
                    PostQuitMessage(0);
                    0
                }
                _ => DefWindowProcW(hwnd, msg, wparam, lparam),
            }
        }
    }

    /// Puts the strip left of the notification area, vertically centered, and draws it.
    fn place(hwnd: HWND) {
        unsafe {
            // Copy out: the calls below talk to Explorer, never hold the lock across them.
            let pixels = match shared().lock() {
                Ok(state) => state.pixels.clone(),
                Err(_) => return,
            };
            let Some(pixels) = pixels else {
                ShowWindow(hwnd, SW_HIDE);
                return;
            };
            let taskbar = GetParent(hwnd);
            let mut bar: RECT = std::mem::zeroed();
            if taskbar.is_null() || GetWindowRect(taskbar, &mut bar) == 0 {
                return;
            }
            let notify = FindWindowExW(taskbar, null_mut(), wide("TrayNotifyWnd").as_ptr(), null());
            let mut tray: RECT = std::mem::zeroed();
            let right =
                if !notify.is_null() && GetWindowRect(notify, &mut tray) != 0 && tray.right > tray.left
                {
                    tray.left
                } else {
                    bar.right - 300 // ponytail: guess when Explorer stops exposing TrayNotifyWnd
                };
            let x = right - bar.left - pixels.width - GAP;
            let y = (bar.bottom - bar.top - pixels.height) / 2;
            SetWindowPos(
                hwnd,
                HWND_TOP,
                x,
                y,
                pixels.width,
                pixels.height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            draw(hwnd, &pixels);
        }
    }

    fn draw(hwnd: HWND, pixels: &super::Pixels) {
        unsafe {
            static WARNED: AtomicBool = AtomicBool::new(false);
            let screen = GetDC(null_mut());
            let memory = CreateCompatibleDC(screen);
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: pixels.width,
                biHeight: -pixels.height, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..std::mem::zeroed()
            };
            let mut bits: *mut core::ffi::c_void = null_mut();
            let bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
            if !bitmap.is_null() && !bits.is_null() {
                std::ptr::copy_nonoverlapping(pixels.bgra.as_ptr(), bits as *mut u8, pixels.bgra.len());
                let previous = SelectObject(memory, bitmap);
                let size = SIZE {
                    cx: pixels.width,
                    cy: pixels.height,
                };
                let source = POINT { x: 0, y: 0 };
                let blend = BLENDFUNCTION {
                    BlendOp: AC_SRC_OVER as u8,
                    BlendFlags: 0,
                    SourceConstantAlpha: 255,
                    AlphaFormat: AC_SRC_ALPHA as u8,
                };
                let ok = UpdateLayeredWindow(
                    hwnd,
                    screen,
                    null(),
                    &size,
                    memory,
                    &source,
                    0,
                    &blend,
                    ULW_ALPHA,
                );
                if ok == 0 && !WARNED.swap(true, Ordering::Relaxed) {
                    log::warn!(
                        "taskbar strip: UpdateLayeredWindow failed (error {})",
                        GetLastError()
                    );
                }
                SelectObject(memory, previous);
                DeleteObject(bitmap);
            }
            DeleteDC(memory);
            ReleaseDC(null_mut(), screen);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pixels_are_premultiplied_bgra() {
        let rgba = BASE64_STANDARD.encode([255u8, 128, 0, 128, 10, 20, 30, 255]);
        let pixels = to_pixels(StripImage {
            rgba,
            width: 2,
            height: 1,
        })
        .unwrap();
        assert_eq!(pixels.bgra, vec![0, 64, 128, 128, 30, 20, 10, 255]);
    }

    #[test]
    fn rejects_a_wrong_size() {
        let rgba = BASE64_STANDARD.encode([0u8; 12]);
        assert!(to_pixels(StripImage {
            rgba,
            width: 2,
            height: 2
        })
        .is_err());
    }
}
