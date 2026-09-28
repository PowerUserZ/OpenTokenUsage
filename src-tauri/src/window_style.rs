//! Windows 11 look for the main window: Mica backdrop, rounded corners,
//! and the system accent color for the frontend.

use std::sync::OnceLock;

use tauri::WebviewWindow;

/// First Windows 11 build. Older builds (Windows 10) get no backdrop: their
/// only acrylic path (SetWindowCompositionAttribute) lags on drag/resize.
const WIN11_FIRST_BUILD: u32 = 22000;

static APPLIED_BACKDROP: OnceLock<&'static str> = OnceLock::new();

/// Apply Mica (Acrylic if Mica fails) and rounded corners. Windows 10: nothing.
/// Uses window-vibrancy directly because tauri's `set_effects` drops the result,
/// and `get_window_backdrop` must report what actually got applied.
pub fn apply(window: &WebviewWindow) {
    let is_win11 = windows_version::OsVersion::current().build >= WIN11_FIRST_BUILD;
    let backdrop = if is_win11 {
        apply_backdrop(window)
    } else {
        "none"
    };
    if is_win11 {
        round_corners(window);
    }
    log::info!("window backdrop: {}", backdrop);
    let _ = APPLIED_BACKDROP.set(backdrop);
}

fn apply_backdrop(window: &WebviewWindow) -> &'static str {
    match window_vibrancy::apply_mica(window, None) {
        Ok(()) => return "mica",
        Err(e) => log::warn!("Mica backdrop failed, trying Acrylic: {}", e),
    }
    match window_vibrancy::apply_acrylic(window, None) {
        Ok(()) => "acrylic",
        Err(e) => {
            log::warn!("Acrylic backdrop failed: {}", e);
            "none"
        }
    }
}

fn round_corners(window: &WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd,
        Err(e) => {
            log::warn!("rounded corners skipped, no window handle: {}", e);
            return;
        }
    };
    let preference = DWMWCP_ROUND;
    let hr = unsafe {
        DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &preference as *const _ as *const _,
            std::mem::size_of_val(&preference) as u32,
        )
    };
    if hr < 0 {
        log::warn!("rounded corners failed: HRESULT {:#x}", hr);
    }
}

/// What `apply` put on the main window: "mica" | "acrylic" | "none".
#[tauri::command]
pub fn get_window_backdrop() -> String {
    APPLIED_BACKDROP
        .get()
        .copied()
        .unwrap_or("none")
        .to_string()
}

/// Windows accent color as "#RRGGBB", or None if it can't be read.
#[tauri::command]
pub fn get_accent_color() -> Option<String> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let value: std::io::Result<u32> = hkcu
        .open_subkey(r"Software\Microsoft\Windows\DWM")
        .and_then(|key| key.get_value("AccentColor"));
    match value {
        Ok(dword) => Some(accent_dword_to_hex(dword)),
        Err(e) => {
            log::warn!("failed to read Windows accent color: {}", e);
            None
        }
    }
}

/// DWM stores the accent as 0xAABBGGRR.
fn accent_dword_to_hex(dword: u32) -> String {
    let [r, g, b, _a] = dword.to_le_bytes();
    format!("#{:02X}{:02X}{:02X}", r, g, b)
}

#[cfg(test)]
mod tests {
    use super::accent_dword_to_hex;

    #[test]
    fn accent_dword_is_aabbggrr() {
        // Windows default blue #0078D7.
        assert_eq!(accent_dword_to_hex(0xFFD7_7800), "#0078D7");
        assert_eq!(accent_dword_to_hex(0x0033_2211), "#112233");
    }
}
