//! Unpromoted Windows pen packets retain pressure, eraser state and coalesced points.
use super::*;
use std::cell::Cell;
use windows_sys::Win32::{
    Foundation::{HWND, POINT},
    Graphics::Gdi::ScreenToClient,
    UI::{
        Input::Pointer::{
            GetPointerInfo, GetPointerPenInfo, GetPointerPenInfoHistory, POINTER_FLAG_CANCELED, POINTER_FLAG_INCONTACT,
            POINTER_INFO, POINTER_PEN_INFO,
        },
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};
thread_local! {
    static PEN: Cell<Option<u32>> = const { Cell::new(None) };
    static FINGERS: RefCell<Vec<(u32, [f32; 2])>> = const { RefCell::new(Vec::new()) };
}

fn clear_contacts() {
    PEN.set(None);
    FINGERS.with_borrow_mut(Vec::clear);
}

fn move_finger(contacts: &mut [(u32, [f32; 2])], id: u32, next: [f32; 2]) -> Option<(f32, [f32; 2], [f32; 2])> {
    let i = contacts.iter().position(|c| c.0 == id)?;
    let old = std::mem::replace(&mut contacts[i].1, next);
    if contacts.len() == 1 {
        return Some((1., old, next));
    }
    let other = contacts[1 - i].1;
    let distance = |a: [f32; 2]| (a[0] - other[0]).hypot(a[1] - other[1]);
    let center = |a: [f32; 2]| [(a[0] + other[0]) * 0.5, (a[1] + other[1]) * 0.5];
    let factor = if distance(old) >= 2. && distance(next) >= 2. {
        distance(next) / distance(old)
    } else {
        1.
    };
    Some((factor, center(old), center(next)))
}
thread_local! {static TOUCH_FLAGS: Cell<Option<u32>>=const {Cell::new(None)};}
thread_local! {
    static BOARD_WINDOW: RefCell<Option<slint::Weak<Bar>>> = const { RefCell::new(None) };
    static RELEASING_MOUSE: Cell<bool> = const { Cell::new(false) };
}
pub fn configure(bar: &Bar, enabled: bool) {
    use slint::winit_030::winit::raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::UI::Input::Touch::{IsTouchWindow, RegisterTouchWindow, UnregisterTouchWindow};
    BOARD_WINDOW.with(|slot| *slot.borrow_mut() = enabled.then(|| bar.as_weak()));
    bar.window().with_winit_window(|w| {
        if let Ok(handle) = w.window_handle() {
            if let RawWindowHandle::Win32(h) = handle.as_raw() {
                unsafe {
                    let hwnd = h.hwnd.get() as HWND;
                    if enabled {
                        let mut flags = 0;
                        // Temporarily switch winit's legacy WM_TOUCH registration to pointer input.
                        if SetWindowSubclass(hwnd, Some(pointer), 1, 0) != 0
                            && IsTouchWindow(hwnd, &mut flags) != 0
                            && UnregisterTouchWindow(hwnd) != 0
                        {
                            TOUCH_FLAGS.set(Some(flags));
                        }
                    } else {
                        RemoveWindowSubclass(hwnd, Some(pointer), 1);
                        if let Some(flags) = TOUCH_FLAGS.take() {
                            RegisterTouchWindow(hwnd, flags);
                        }
                        clear_contacts();
                    }
                }
            }
        }
    });
}
// SetWindowSubclass runs on Slint's UI thread. Other window messages, including mouse input,
// continue through winit. A pointer belongs to us only after contact inside the drawing area.
unsafe extern "system" fn pointer(hwnd: HWND, msg: u32, wp: usize, lp: isize, id: usize, _: usize) -> isize {
    if msg == WM_NCDESTROY {
        RemoveWindowSubclass(hwnd, Some(pointer), id);
        clear_contacts();
    }
    // Winit releases capture synchronously inside the ordinary button-up dispatch.
    // Let that release commit, and roll back when another window steals capture.
    if msg == WM_LBUTTONUP {
        let previous = RELEASING_MOUSE.replace(true);
        let result = DefSubclassProc(hwnd, msg, wp, lp);
        RELEASING_MOUSE.set(previous);
        return result;
    }
    if matches!(msg, WM_KILLFOCUS | WM_CANCELMODE)
        || (msg == WM_CAPTURECHANGED && !RELEASING_MOUSE.get())
        || (msg == WM_MOUSEMOVE && wp & 1 == 0)
    {
        BOARD_WINDOW.with(|slot| {
            if let Some(bar) = slot.borrow().as_ref().and_then(slint::Weak::upgrade) {
                let ui = bar.global::<BoardUi>();
                if !ui.get_operation().is_empty() {
                    ui.invoke_cancel_gesture();
                }
            }
        });
    }
    if msg == WM_MOUSEWHEEL && wp & 0x0008 != 0 {
        let handled = BOARD_WINDOW.with(|slot| {
            let Some(bar) = slot.borrow().as_ref().and_then(slint::Weak::upgrade) else {
                return false;
            };
            let ui = bar.global::<BoardUi>();
            if !ui.get_opened() || ui.get_menu_open() || !ui.get_prompt().is_empty() {
                return false;
            }
            let mut point = POINT {
                x: lp as i16 as i32,
                y: (lp >> 16) as i16 as i32,
            };
            if ScreenToClient(hwnd, &mut point) == 0 {
                return false;
            }
            let scale = bar.window().scale_factor();
            let (cx, cy) = (point.x as f32 / scale, point.y as f32 / scale);
            let notches = (wp >> 16) as i16 as f32 / 120.;
            let factor = 1.2_f32.powf(notches);
            let (x, y) = (cx - bar.get_board_canvas_x(), cy - bar.get_board_canvas_y());
            if ui.get_editor() == 2
                && (0. ..bar.get_board_canvas_w()).contains(&x)
                && (0. ..bar.get_board_canvas_h()).contains(&y)
            {
                ui.invoke_ink_camera(factor, x, y, x, y);
                return true;
            }
            if ui.get_maximized() {
                return false;
            }
            let (x, y) = (cx - bar.get_board_viewport_x(), cy - bar.get_board_viewport_y());
            if !(0. ..bar.get_board_viewport_w()).contains(&x) || !(0. ..bar.get_board_viewport_h()).contains(&y) {
                return false;
            }
            if ui.get_operation().is_empty() {
                ui.invoke_zoom_at(factor, x, y);
            }
            true
        });
        if handled {
            return 0;
        }
    }
    if !matches!(
        msg,
        WM_POINTERDOWN | WM_POINTERUPDATE | WM_POINTERUP | WM_POINTERCAPTURECHANGED
    ) {
        return DefSubclassProc(hwnd, msg, wp, lp);
    }
    let pointer_id = (wp & 0xffff) as u32;
    let active_pen = PEN.get() == Some(pointer_id);
    let tracked_finger = FINGERS.with_borrow(|v| v.iter().any(|c| c.0 == pointer_id));
    if msg != WM_POINTERDOWN && !active_pen && !tracked_finger {
        return DefSubclassProc(hwnd, msg, wp, lp);
    }
    let used = APP.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return false;
        };
        let Some(a) = slot.as_mut() else { return false };
        let cancel = |a: &mut App| {
            FINGERS.with_borrow_mut(|v| v.retain(|c| c.0 != pointer_id));
            if active_pen {
                PEN.set(None);
                a.board_point(3, 0., 0., 0., false);
            }
        };
        if msg == WM_POINTERCAPTURECHANGED {
            cancel(a);
            return true;
        }
        if !a
            .board
            .as_ref()
            .is_some_and(|b| b.editor == 2 && b.menu.is_empty() && b.prompt.is_none())
        {
            clear_contacts();
            return false;
        }
        let mut info = POINTER_INFO::default();
        if GetPointerInfo(pointer_id, &mut info) == 0 || !matches!(info.pointerType, PT_PEN | PT_TOUCH) {
            return false;
        }
        if info.pointerFlags & POINTER_FLAG_CANCELED != 0 {
            cancel(a);
            return true;
        }
        let scale = a.bar.window().scale_factor();
        let sheet_scale = a.bar.get_board_canvas_scale();
        let origin = (a.bar.get_board_canvas_x(), a.bar.get_board_canvas_y());
        let local = |mut p: POINT| {
            ScreenToClient(hwnd, &mut p);
            (p.x as f32 / scale - origin.0, p.y as f32 / scale - origin.1)
        };
        let (x, y) = local(info.ptPixelLocation);
        if msg == WM_POINTERDOWN
            && (x < 0. || y < 0. || x >= a.bar.get_board_canvas_w() || y >= a.bar.get_board_canvas_h())
        {
            return false;
        }
        if info.pointerType == PT_TOUCH {
            if PEN.get().is_some() {
                return true;
            }
            let gesture = FINGERS.with_borrow_mut(|v| match msg {
                WM_POINTERDOWN => {
                    if v.len() < 2 && !tracked_finger {
                        v.push((pointer_id, [x, y]));
                    }
                    None
                }
                WM_POINTERUP => {
                    v.retain(|c| c.0 != pointer_id);
                    None
                }
                _ => move_finger(v, pointer_id, [x, y]),
            });
            if let Some((factor, from, to)) = gesture {
                a.ink_camera(factor, from, to);
            }
        } else {
            if PEN.get().is_some() && !active_pen {
                return true;
            }
            let mut pen = POINTER_PEN_INFO::default();
            if GetPointerPenInfo(pointer_id, &mut pen) == 0 {
                return false;
            }
            if msg == WM_POINTERDOWN {
                FINGERS.with_borrow_mut(Vec::clear);
            }
            PEN.set((msg != WM_POINTERUP).then_some(pointer_id));
            let pressure = |p: &POINTER_PEN_INFO| {
                if p.penMask & PEN_MASK_PRESSURE != 0 {
                    p.pressure.min(1024) as f32 / 1024.
                } else {
                    0.5
                }
            };
            let erase = pen.penFlags & (PEN_FLAG_ERASER | PEN_FLAG_INVERTED) != 0;
            if msg != WM_POINTERDOWN && info.historyCount > 1 {
                let mut n = info.historyCount.min(4096);
                let mut history = vec![POINTER_PEN_INFO::default(); n as usize];
                if GetPointerPenInfoHistory(pointer_id, &mut n, history.as_mut_ptr()) != 0 {
                    if let Some(b) = &mut a.board {
                        for p in history
                            .iter()
                            .take(n as usize)
                            .skip(1)
                            .rev()
                            .filter(|p| p.pointerInfo.pointerFlags & POINTER_FLAG_INCONTACT != 0)
                        {
                            let (px, py) = local(p.pointerInfo.ptPixelLocation);
                            b.ink.sample([
                                px / sheet_scale + b.ink.pan[0],
                                py / sheet_scale + b.ink.pan[1],
                                pressure(p),
                            ]);
                        }
                    }
                }
            }
            // A pen-up position may already be in hover, away from the last mark.
            // Coalesced contact samples above still belong to the stroke.
            if msg == WM_POINTERUP {
                a.finish_board_stroke();
            } else if info.pointerFlags & POINTER_FLAG_INCONTACT != 0 {
                a.board_point(if msg == WM_POINTERDOWN { 0 } else { 1 }, x, y, pressure(&pen), erase);
            }
        }
        true
    });
    if used {
        0
    } else {
        DefSubclassProc(hwnd, msg, wp, lp)
    }
}

#[cfg(test)]
mod tests {
    use super::move_finger;

    #[test]
    fn touch_pan_and_pinch_follow_the_contact_midpoint() {
        let mut fingers = vec![(7, [10., 20.])];
        assert_eq!(
            move_finger(&mut fingers, 7, [20., 30.]),
            Some((1., [10., 20.], [20., 30.]))
        );
        fingers.push((8, [60., 30.]));
        assert_eq!(
            move_finger(&mut fingers, 8, [100., 30.]),
            Some((2., [40., 30.], [60., 30.]))
        );
        fingers.remove(0);
        assert_eq!(
            move_finger(&mut fingers, 8, [90., 40.]),
            Some((1., [100., 30.], [90., 40.]))
        );
    }
}
