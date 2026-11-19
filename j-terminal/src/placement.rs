//! Where the window appears: centred near the top of the screen the mouse is on (docs/plan.md, section 4).
//! Everything here is in physical pixels, as winit reports the screens.

/// A screen in physical pixels, with its scale (1.5 at 150 %).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Screen { pub left: i32, pub top: i32, pub width: i32, pub height: i32, pub scale: f64 }

impl Screen {
    fn contains(&self, (x, y): (i32, i32)) -> bool {
        x >= self.left && x < self.left + self.width && y >= self.top && y < self.top + self.height
    }
}

/// The share of the screen's height above the window.
const FROM_TOP: f64 = 0.2;

/// The screen under the mouse, else the first one.
pub fn pick(screens: &[Screen], mouse: Option<(i32, i32)>) -> Option<Screen> {
    mouse.and_then(|mouse| screens.iter().find(|screen| screen.contains(mouse))).or(screens.first()).copied()
}

/// The window's top-left corner on `screen` for a window `width` logical pixels wide.
pub fn top_center(screen: Screen, width: f32) -> (i32, i32) {
    let width = (width as f64 * screen.scale).round() as i32;
    let x = centered_left(screen, width);
    let y = screen.top + (screen.height as f64 * FROM_TOP).round() as i32;
    (x, y)
}

/// Horizontally centre a window whose outer width is already in physical pixels.
pub fn centered_left(screen: Screen, width: i32) -> i32 {
    screen.left + (screen.width - width).max(0) / 2
}

/// The usable monitor rectangle excludes the Windows taskbar and docked toolbars.
pub fn work_area(screen: Screen) -> Screen {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{Foundation::POINT, Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST}};
        let center = POINT { x: screen.left + screen.width / 2, y: screen.top + screen.height / 2 };
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if unsafe { GetMonitorInfoW(MonitorFromPoint(center, MONITOR_DEFAULTTONEAREST), &mut info) } != 0 {
            let rect = info.rcWork;
            return Screen { left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, ..screen };
        }
    }
    screen
}

/// Where the mouse is, in physical pixels.
#[cfg(windows)]
pub fn mouse() -> Option<(i32, i32)> {
    use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
    let mut point = POINT { x: 0, y: 0 };
    (unsafe { GetCursorPos(&mut point) } != 0).then_some((point.x, point.y))
}

#[cfg(not(windows))]
pub fn mouse() -> Option<(i32, i32)> { None }

#[cfg(test)]
mod tests {
    use super::*;

    const LEFT: Screen = Screen { left: -3840, top: 0, width: 2560, height: 1440, scale: 1.5 };
    const MAIN: Screen = Screen { left: 0, top: 0, width: 1920, height: 1080, scale: 1.0 };

    #[test]
    fn centred_near_the_top() {
        assert_eq!(top_center(MAIN, 640.0), (640, 216));
    }

    #[test]
    fn scaled_to_the_screen() {
        assert_eq!(top_center(LEFT, 640.0), (-3840 + (2560 - 960) / 2, 288));
    }

    #[test]
    fn never_left_of_a_narrow_screen() {
        let narrow = Screen { left: 100, top: 0, width: 500, height: 800, scale: 1.0 };
        assert_eq!(top_center(narrow, 640.0).0, 100);
    }

    #[test]
    fn centering_follows_the_actual_width_as_the_panel_opens_and_closes() {
        for (width, x) in [(1501, 209), (1672, 124), (1842, 39), (1672, 124), (1501, 209)] {
            assert_eq!(centered_left(MAIN, width), x);
        }
        assert_eq!(centered_left(LEFT, 2252), -3686);
        assert_eq!(centered_left(LEFT, 2560), LEFT.left);
    }

    #[test]
    fn on_the_screen_with_the_mouse() {
        let screens = [MAIN, LEFT];
        assert_eq!(pick(&screens, Some((-2000, 700))), Some(LEFT));
        assert_eq!(pick(&screens, Some((10, 10))), Some(MAIN));
        assert_eq!(pick(&screens, Some((-10, 10))), Some(MAIN), "Between screens: the first one.");
        assert_eq!(pick(&screens, None), Some(MAIN));
        assert_eq!(pick(&[], Some((0, 0))), None);
    }
}
