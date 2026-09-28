use std::sync::{Mutex, OnceLock};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_store::StoreExt;

use crate::log_path;
use crate::panel::show_panel;

const LOG_LEVEL_STORE_KEY: &str = "logLevel";

/// Handles to the translatable tray menu entries (log level names stay English).
struct TrayMenuItems {
    show_stats: MenuItem<tauri::Wry>,
    go_to_settings: MenuItem<tauri::Wry>,
    debug_level: Submenu<tauri::Wry>,
    copy_log_path: MenuItem<tauri::Wry>,
    about: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuLabels {
    show_stats: String,
    go_to_settings: String,
    debug_level: String,
    copy_log_path: String,
    about: String,
    quit: String,
}

/// The frontend sends the tray menu labels in the app language (startup and language switch).
#[tauri::command]
pub fn set_tray_menu_labels(app_handle: AppHandle, labels: TrayMenuLabels) -> Result<(), String> {
    let items = app_handle
        .try_state::<TrayMenuItems>()
        .ok_or("tray menu is not created yet")?;
    let result = items
        .show_stats
        .set_text(labels.show_stats)
        .and_then(|_| items.go_to_settings.set_text(labels.go_to_settings))
        .and_then(|_| items.debug_level.set_text(labels.debug_level))
        .and_then(|_| items.copy_log_path.set_text(labels.copy_log_path))
        .and_then(|_| items.about.set_text(labels.about))
        .and_then(|_| items.quit.set_text(labels.quit));
    result.map_err(|e| e.to_string())
}

fn get_stored_log_level(app_handle: &AppHandle) -> log::LevelFilter {
    let store = match app_handle.store("settings.json") {
        Ok(s) => s,
        Err(_) => return log::LevelFilter::Error,
    };
    let value = store.get(LOG_LEVEL_STORE_KEY);
    let level_str = value.and_then(|v| v.as_str().map(|s| s.to_string()));
    match level_str.as_deref() {
        Some("error") => log::LevelFilter::Error,
        Some("warn") => log::LevelFilter::Warn,
        Some("info") => log::LevelFilter::Info,
        Some("debug") => log::LevelFilter::Debug,
        Some("trace") => log::LevelFilter::Trace,
        _ => log::LevelFilter::Error, // Default: least verbose
    }
}

fn set_stored_log_level(app_handle: &AppHandle, level: log::LevelFilter) {
    let level_str = match level {
        log::LevelFilter::Error => "error",
        log::LevelFilter::Warn => "warn",
        log::LevelFilter::Info => "info",
        log::LevelFilter::Debug => "debug",
        log::LevelFilter::Trace => "trace",
        log::LevelFilter::Off => "off",
    };
    log::info!("Log level changing to {:?}", level);
    if let Ok(store) = app_handle.store("settings.json") {
        store.set(LOG_LEVEL_STORE_KEY, serde_json::json!(level_str));
        let _ = store.save();
    }
    log::set_max_level(level);
}

pub fn create(app_handle: &AppHandle) -> tauri::Result<()> {
    let tray_icon_path = app_handle
        .path()
        .resolve("icons/tray-icon.png", BaseDirectory::Resource)?;
    let icon = Image::from_path(tray_icon_path)?;

    // Load persisted log level
    let current_level = get_stored_log_level(app_handle);
    log::set_max_level(current_level);

    let show_stats = MenuItem::with_id(app_handle, "show_stats", "Show stats", true, None::<&str>)?;
    let go_to_settings = MenuItem::with_id(
        app_handle,
        "go_to_settings",
        "Settings",
        true,
        None::<&str>,
    )?;

    // Log level submenu - clone items for use in event handler
    let log_error = CheckMenuItem::with_id(
        app_handle,
        "log_error",
        "Error",
        true,
        current_level == log::LevelFilter::Error,
        None::<&str>,
    )?;
    let log_warn = CheckMenuItem::with_id(
        app_handle,
        "log_warn",
        "Warn",
        true,
        current_level == log::LevelFilter::Warn,
        None::<&str>,
    )?;
    let log_info = CheckMenuItem::with_id(
        app_handle,
        "log_info",
        "Info",
        true,
        current_level == log::LevelFilter::Info,
        None::<&str>,
    )?;
    let log_debug = CheckMenuItem::with_id(
        app_handle,
        "log_debug",
        "Debug",
        true,
        current_level == log::LevelFilter::Debug,
        None::<&str>,
    )?;
    let log_trace = CheckMenuItem::with_id(
        app_handle,
        "log_trace",
        "Trace",
        true,
        current_level == log::LevelFilter::Trace,
        None::<&str>,
    )?;
    let log_level_separator = PredefinedMenuItem::separator(app_handle)?;
    let copy_log_path = MenuItem::with_id(
        app_handle,
        "copy_log_path",
        "Copy log path",
        true,
        None::<&str>,
    )?;
    let log_level_submenu = Submenu::with_items(
        app_handle,
        "Log level",
        true,
        &[
            &log_error,
            &log_warn,
            &log_info,
            &log_debug,
            &log_trace,
            &log_level_separator,
            &copy_log_path,
        ],
    )?;

    // Clone for capture in event handler
    let log_items = [
        (log_error.clone(), log::LevelFilter::Error),
        (log_warn.clone(), log::LevelFilter::Warn),
        (log_info.clone(), log::LevelFilter::Info),
        (log_debug.clone(), log::LevelFilter::Debug),
        (log_trace.clone(), log::LevelFilter::Trace),
    ];

    let separator = PredefinedMenuItem::separator(app_handle)?;
    let about = MenuItem::with_id(
        app_handle,
        "about",
        "About OpenTokenUsage",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app_handle, "quit", "Quit", true, None::<&str>)?;

    app_handle.manage(TrayMenuItems {
        show_stats: show_stats.clone(),
        go_to_settings: go_to_settings.clone(),
        debug_level: log_level_submenu.clone(),
        copy_log_path: copy_log_path.clone(),
        about: about.clone(),
        quit: quit.clone(),
    });

    let menu = Menu::with_items(
        app_handle,
        &[
            &show_stats,
            &go_to_settings,
            &log_level_submenu,
            &separator,
            &about,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("tray")
        .icon(icon)
        .tooltip("OpenTokenUsage")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app_handle, event| {
            log::debug!("tray menu: {}", event.id.as_ref());
            match event.id.as_ref() {
                "show_stats" => {
                    show_panel(app_handle);
                    let _ = app_handle.emit("tray:navigate", "home");
                }
                "go_to_settings" => {
                    show_panel(app_handle);
                    let _ = app_handle.emit("tray:navigate", "settings");
                }
                "about" => {
                    show_panel(app_handle);
                    let _ = app_handle.emit("tray:show-about", ());
                }
                "quit" => {
                    log::info!("quit requested via tray");
                    app_handle.exit(0);
                }
                "log_error" | "log_warn" | "log_info" | "log_debug" | "log_trace" => {
                    let selected_level = match event.id.as_ref() {
                        "log_error" => log::LevelFilter::Error,
                        "log_warn" => log::LevelFilter::Warn,
                        "log_info" => log::LevelFilter::Info,
                        "log_debug" => log::LevelFilter::Debug,
                        "log_trace" => log::LevelFilter::Trace,
                        _ => unreachable!(),
                    };
                    set_stored_log_level(app_handle, selected_level);
                    // Update all checkmarks - only the selected level should be checked
                    for (item, level) in &log_items {
                        let _ = item.set_checked(*level == selected_level);
                    }
                }
                "copy_log_path" => match log_path::for_app(app_handle) {
                    Ok(path) => {
                        if let Err(error) = app_handle
                            .clipboard()
                            .write_text(path.to_string_lossy().to_string())
                        {
                            log::error!("failed to copy log path to clipboard: {}", error);
                        } else {
                            log::info!("copied log path to clipboard");
                        }
                    }
                    Err(error) => {
                        log::error!("failed to resolve log path: {}", error);
                    }
                },
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            let app_handle = tray.app_handle();

            if let TrayIconEvent::Click {
                button,
                button_state,
                rect,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        match window.is_visible() {
                            Ok(true) => {
                                log::debug!("tray click: hiding window");
                                let _ = window.hide();
                            }
                            _ => {
                                log::debug!("tray click: showing window");
                                let _ = window.show();
                                let _ = window.set_focus();
                                position_window_at_tray_icon(&window, rect.position, rect.size);
                            }
                        }
                    }
                }
            }
        })
        .build(app_handle)?;

    Ok(())
}

/// Position the window above the tray icon, centered horizontally.
/// The window's bottom edge sits just above the tray icon / taskbar.
fn last_anchor_bottom_slot() -> &'static Mutex<Option<i32>> {
    static SLOT: OnceLock<Mutex<Option<i32>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

pub fn last_anchor_bottom_physical_y() -> Option<i32> {
    last_anchor_bottom_slot().lock().ok().and_then(|slot| *slot)
}

fn set_last_anchor_bottom_physical_y(value: i32) {
    if let Ok(mut slot) = last_anchor_bottom_slot().lock() {
        *slot = Some(value);
    }
}

fn position_to_physical(position: &tauri::Position, scale: f64) -> (f64, f64) {
    match position {
        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
        tauri::Position::Logical(p) => (p.x * scale, p.y * scale),
    }
}

fn size_to_physical(size: &tauri::Size, scale: f64) -> (f64, f64) {
    match size {
        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
        tauri::Size::Logical(s) => (s.width * scale, s.height * scale),
    }
}

fn monitor_contains_physical_point(
    origin_x: f64,
    origin_y: f64,
    width: f64,
    height: f64,
    point_x: f64,
    point_y: f64,
) -> bool {
    point_x >= origin_x
        && point_x < origin_x + width
        && point_y >= origin_y
        && point_y < origin_y + height
}

/// Windows 11 flyouts float this far (logical px) above the taskbar.
const FLYOUT_MARGIN: f64 = 12.0;

/// Pure placement math (physical px): bottom edge on `anchor_bottom`, clamped into the work area.
fn flyout_origin(
    x: i32,
    anchor_bottom: i32,
    width: i32,
    height: i32,
    area: (i32, i32, i32, i32), // left, top, right, bottom
) -> (i32, i32) {
    let (left, top, right, _) = area;
    let x = x.min(right - width).max(left);
    let y = (anchor_bottom - height).max(top);
    (x, y)
}

fn work_area_of(monitor: &tauri::Monitor) -> (i32, i32, i32, i32) {
    let area = monitor.work_area();
    (
        area.position.x,
        area.position.y,
        area.position.x + area.size.width as i32,
        area.position.y + area.size.height as i32,
    )
}

/// Keep the panel's bottom edge just above the taskbar after it is shown or resized, so a short
/// view never leaves a gap under the panel. Uses the tray-click anchor when there is one;
/// otherwise (shortcut / menu) the panel goes to the bottom-right corner of the work area.
pub fn anchor_panel(window: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
    else {
        return;
    };
    let area = work_area_of(&monitor);
    let margin = (FLYOUT_MARGIN * window.scale_factor().unwrap_or(1.0)).round() as i32;
    let (x, anchor_bottom) = match last_anchor_bottom_physical_y() {
        Some(bottom) => (pos.x, bottom),
        None => {
            let bottom = area.3 - margin;
            set_last_anchor_bottom_physical_y(bottom);
            (area.2 - size.width as i32 - margin, bottom)
        }
    };
    let (x, y) = flyout_origin(x, anchor_bottom, size.width as i32, size.height as i32, area);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Position the window above the tray icon, centered horizontally on it.
fn position_window_at_tray_icon(
    window: &tauri::WebviewWindow,
    icon_position: tauri::Position,
    icon_size: tauri::Size,
) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (icon_x, icon_y) = position_to_physical(&icon_position, scale);
    let (icon_w, _icon_h) = size_to_physical(&icon_size, scale);
    let Ok(size) = window.outer_size() else {
        return;
    };
    let icon_center_x = icon_x + icon_w / 2.0;

    let monitor = window
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|monitor| {
                let origin = monitor.position();
                let monitor_size = monitor.size();
                monitor_contains_physical_point(
                    origin.x as f64,
                    origin.y as f64,
                    monitor_size.width as f64,
                    monitor_size.height as f64,
                    icon_center_x,
                    icon_y,
                )
            })
        })
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let area = work_area_of(&monitor);
    let margin = (FLYOUT_MARGIN * scale).round() as i32;

    // Bottom taskbar: the icon sits below the work area, so anchor on the work area's bottom.
    let anchor_bottom = (icon_y.round() as i32).min(area.3) - margin;
    set_last_anchor_bottom_physical_y(anchor_bottom);
    let x = (icon_center_x - size.width as f64 / 2.0).round() as i32;
    let (x, y) = flyout_origin(x, anchor_bottom, size.width as i32, size.height as i32, area);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

#[cfg(test)]
mod flyout_tests {
    use super::flyout_origin;

    const AREA: (i32, i32, i32, i32) = (0, 0, 2560, 1392); // 1440p screen, 48px taskbar

    #[test]
    fn short_panel_sits_on_the_anchor_not_at_the_old_top() {
        // Regression: a shorter view kept the old top edge and left a gap above the taskbar.
        assert_eq!(flyout_origin(2148, 1380, 400, 541, AREA), (2148, 839));
        assert_eq!(flyout_origin(2148, 1380, 400, 860, AREA), (2148, 520));
    }

    #[test]
    fn clamps_into_the_work_area() {
        assert_eq!(flyout_origin(2400, 1380, 400, 541, AREA), (2160, 839)); // off the right edge
        assert_eq!(flyout_origin(-50, 1380, 400, 2000, AREA), (0, 0)); // taller than the screen
    }
}
