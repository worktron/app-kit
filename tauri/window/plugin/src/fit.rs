//! The window kept inside the screen it opens on, on the Mac and Windows.
//!
//! An app asks for its window's size once, on every desktop, and the window-state plugin puts back the size the person
//! last left it at. Either can be larger than the screen the window opens on: 1100 by 860 on a 1024 by 768 screen put
//! the window's bottom under the Windows taskbar, and a size saved on a large screen outgrows a laptop's. So just before
//! the window shows, it is made to fit the work area of its screen, which is the screen less the taskbar, or the menu
//! bar and the Dock, and moved inside it, never below the app's own minimum size. A window that already fits is left
//! exactly where it is, and a maximized or full-screen one, which the system already fits, is left alone.
//!
//! Every size and place is the whole window's, frame included, in the screen's pixels, as Tauri reports them.

// Off the Mac and Windows this is built only for its tests.
#![cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]

/// A place and size on the screens, from the top-left corner, in pixels.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Where the window goes so that it lies inside `work_area`, or `None` when it already does. Each side larger than the
/// work area is cut to it, never below `minimum`, which a window already smaller than keeps its own size. The window
/// then moves the least it can to lie inside; one still larger than the work area, at its minimum, goes to the work
/// area's top or left edge, so its title bar and its close button stay on the screen.
pub(crate) fn fitted(window: Rect, work_area: Rect, minimum: (u32, u32)) -> Option<Rect> {
    let width = fit_side(window.width, work_area.width, minimum.0);
    let height = fit_side(window.height, work_area.height, minimum.1);
    let fitted = Rect {
        x: place_side(window.x, width, work_area.x, work_area.width),
        y: place_side(window.y, height, work_area.y, work_area.height),
        width,
        height,
    };
    (fitted != window).then_some(fitted)
}

fn fit_side(length: u32, room: u32, minimum: u32) -> u32 {
    length.min(room).max(minimum.min(length))
}

fn place_side(start: i32, length: u32, room_start: i32, room: u32) -> i32 {
    let last_start = i64::from(room_start) + i64::from(room) - i64::from(length);
    if last_start < i64::from(room_start) {
        return room_start;
    }
    // The result lies between two starts on the screens, so it is a place on them.
    i64::from(start).clamp(i64::from(room_start), last_start) as i32
}

/// Fits the window to the work area of its screen before it shows (`show_once_placed`), on the main thread.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn fit_to_screen<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use tauri::{PhysicalPosition, PhysicalSize};
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let (Ok(position), Ok(outer), Ok(inner)) = (window.outer_position(), window.outer_size(), window.inner_size()) else {
        log::warn!("could not read the window's place and size, so it shows as it is, which may be larger than the screen");
        return;
    };
    let Some(monitor) = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten()) else {
        log::warn!("could not read which screen the window is on, so it shows as it is, which may be larger than the screen");
        return;
    };
    let area = monitor.work_area();
    let shown = Rect { x: position.x, y: position.y, width: outer.width, height: outer.height };
    let work_area = Rect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height };
    let Some(fitted) = fitted(shown, work_area, minimum(window)) else { return };
    // Tauri sets the size inside the frame and the place of the whole window.
    let frame = (outer.width.saturating_sub(inner.width), outer.height.saturating_sub(inner.height));
    let _ = window.set_size(PhysicalSize::new(fitted.width.saturating_sub(frame.0), fitted.height.saturating_sub(frame.1)));
    let _ = window.set_position(PhysicalPosition::new(fitted.x, fitted.y));
    log::info!("{}", fitted_line(shown, work_area, fitted));
}

/// The line the window logs when it was made to fit, which a check of an installed app on a small screen reads.
fn fitted_line(shown: Rect, work_area: Rect, fitted: Rect) -> String {
    format!(
        "the window, {}, did not fit inside its screen's work area, {}, so it shows at {}",
        described(shown),
        described(work_area),
        described(fitted)
    )
}

fn described(rect: Rect) -> String {
    format!("{} by {} at {},{}", rect.width, rect.height, rect.x, rect.y)
}

/// The app's minimum size for the window, frame included, in the screen's pixels: Tauri sets it on the window and has
/// no way to read it back. On the Mac it is the window's own minimum frame size, in points.
#[cfg(target_os = "macos")]
fn minimum<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> (u32, u32) {
    let (Ok(pointer), Ok(scale)) = (window.ns_window(), window.scale_factor()) else { return (0, 0) };
    // Tauri hands over the window's NSWindow, and this runs on the main thread, where AppKit is read.
    let ns_window: &objc2_app_kit::NSWindow = unsafe { &*pointer.cast() };
    let size = ns_window.minSize();
    ((size.width * scale).round() as u32, (size.height * scale).round() as u32)
}

/// On Windows it is what the window answers when Windows asks its minimum tracking size, as Windows does before every
/// resize, which Tauri's window layer fills from the app's minimum.
#[cfg(target_os = "windows")]
fn minimum<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> (u32, u32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, MINMAXINFO, WM_GETMINMAXINFO};
    let Ok(hwnd) = window.hwnd() else { return (0, 0) };
    // Zeroed, the tracking size stays 0 by 0 when the app set no minimum.
    let mut info: MINMAXINFO = unsafe { std::mem::zeroed() };
    unsafe { SendMessageW(hwnd.0, WM_GETMINMAXINFO, 0, &mut info as *mut MINMAXINFO as isize) };
    (info.ptMinTrackSize.x.max(0) as u32, info.ptMinTrackSize.y.max(0) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect { x, y, width, height }
    }

    /// GitHub's Windows machine: a 1024 by 768 screen, with a 40 pixel taskbar along its bottom.
    const SMALL_WINDOWS_SCREEN: Rect = Rect { x: 0, y: 0, width: 1024, height: 728 };
    /// The Icarus Labs window's minimum, 420 by 560 inside the frame, with Windows' frame around it.
    const MINIMUM: (u32, u32) = (436, 599);

    // The Icarus Labs window asked for 1100 by 860, which Tauri centered on the whole screen, its top above the screen
    // and its bottom under the taskbar.
    #[test]
    fn a_first_window_larger_than_a_small_screen_is_cut_to_its_work_area() {
        let asked = rect(-46, -64, 1116, 899);
        assert_eq!(fitted(asked, SMALL_WINDOWS_SCREEN, MINIMUM), Some(rect(0, 0, 1024, 728)));
    }

    #[test]
    fn a_window_that_fits_is_left_where_it_is() {
        let mac_work_area = rect(0, 50, 2880, 1640);
        assert_eq!(fitted(rect(890, 220, 1100, 860), mac_work_area, (420, 560)), None);
        assert_eq!(fitted(SMALL_WINDOWS_SCREEN, SMALL_WINDOWS_SCREEN, MINIMUM), None);
    }

    // A size saved on a large screen, put back when the app opens on a 1366 by 768 laptop.
    #[test]
    fn a_restored_size_larger_than_the_screen_is_cut_on_the_side_that_does_not_fit() {
        let laptop = rect(0, 0, 1366, 728);
        assert_eq!(fitted(rect(100, 80, 1200, 1300), laptop, MINIMUM), Some(rect(100, 0, 1200, 728)));
    }

    #[test]
    fn a_window_that_fits_but_hangs_off_an_edge_moves_in_the_least_it_can() {
        assert_eq!(fitted(rect(700, 300, 600, 600), SMALL_WINDOWS_SCREEN, MINIMUM), Some(rect(424, 128, 600, 600)));
        assert_eq!(fitted(rect(-30, -10, 600, 600), SMALL_WINDOWS_SCREEN, MINIMUM), Some(rect(0, 0, 600, 600)));
    }

    #[test]
    fn the_window_never_goes_below_the_apps_minimum_and_keeps_its_title_bar_on_the_screen() {
        let tiny = rect(0, 0, 800, 500);
        assert_eq!(fitted(rect(-46, -64, 1116, 899), tiny, MINIMUM), Some(rect(0, 0, 800, 599)));
    }

    #[test]
    fn a_window_already_smaller_than_the_minimum_keeps_its_own_size() {
        assert_eq!(fitted(rect(10, 10, 300, 400), SMALL_WINDOWS_SCREEN, MINIMUM), None);
    }

    // A second screen to the left of the main one, and one with its menu bar's strip above its work area.
    #[test]
    fn the_work_area_can_start_anywhere_on_the_screens() {
        let left_screen = rect(-1920, 25, 1920, 1055);
        assert_eq!(fitted(rect(-1500, 0, 1100, 1200), left_screen, (420, 560)), Some(rect(-1500, 25, 1100, 1055)));
    }

    #[test]
    fn a_fitted_window_logs_its_size_and_place_before_and_after() {
        assert_eq!(
            fitted_line(rect(-46, -64, 1116, 899), SMALL_WINDOWS_SCREEN, rect(0, 0, 1024, 728)),
            "the window, 1116 by 899 at -46,-64, did not fit inside its screen's work area, 1024 by 728 at 0,0, so it shows at 1024 by 728 at 0,0"
        );
    }
}
