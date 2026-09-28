use tauri::{AppHandle, Manager};

pub fn show_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        crate::tray::anchor_panel(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn toggle_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                log::debug!("toggle_panel: hiding window");
                let _ = window.hide();
            }
            _ => {
                log::debug!("toggle_panel: showing window");
                crate::tray::anchor_panel(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

pub fn hide_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
}
