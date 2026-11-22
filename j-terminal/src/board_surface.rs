//! Geometry shared by pointer hit testing, keyboard navigation and the Slint preview.
//! A gesture only changes the transient Slint properties until its release.
use super::*;
use slint::Model;

fn group_box(ui: &BoardUi, members: &slint::ModelRc<i32>, pad: f32) -> BoardBox {
    let mut left = f32::INFINITY;
    let mut top = f32::INFINITY;
    let mut right = f32::NEG_INFINITY;
    let mut bottom = f32::NEG_INFINITY;
    for index in members.iter() {
        let b = ui.invoke_box_at(index);
        left = left.min(b.x);
        top = top.min(b.y);
        right = right.max(b.x + b.w);
        bottom = bottom.max(b.y + b.h);
    }
    if !left.is_finite() {
        return BoardBox::default();
    }
    BoardBox {
        x: left - pad,
        y: top - pad,
        w: right - left + 2. * pad,
        h: bottom - top + 2. * pad,
    }
}

fn contains(r: &BoardBox, x: f32, y: f32, inset: f32) -> bool {
    x >= r.x + inset && x <= r.x + r.w - inset && y >= r.y + inset && y <= r.y + r.h - inset
}

// Hit the same quadratic curve Slint draws, including nearly vertical and coincident pins.
fn near_thread(a: BoardBox, b: BoardBox, x: f32, y: f32, radius: f32) -> bool {
    let (sx, sy) = (a.x + a.w / 2., a.y);
    let (dx, dy) = (b.x + b.w / 2. - sx, b.y - sy);
    let sag = (12. + dx.hypot(dy) * 0.16).min(90.);
    if x < sx.min(sx + dx) - radius
        || x > sx.max(sx + dx) + radius
        || y < sy.min(sy + dy) - radius
        || y > sy.max(sy + dy) + sag + radius
    {
        return false;
    }
    let (mut px, mut py) = (sx, sy);
    for step in 1..=24 {
        let t = step as f32 / 24.;
        let (nx, ny) = (sx + dx * t, sy + dy * t + 4. * sag * t * (1. - t));
        let (vx, vy) = (nx - px, ny - py);
        let u = (((x - px) * vx + (y - py) * vy) / (vx * vx + vy * vy).max(f32::EPSILON)).clamp(0., 1.);
        if (x - px - u * vx).hypot(y - py - u * vy) <= radius {
            return true;
        }
        (px, py) = (nx, ny);
    }
    false
}
fn hit(ui: &BoardUi, theme: &Theme, x: f32, y: f32) -> BoardHit {
    let target = |op: &str, i: i32, j: i32| BoardHit {
        operation: op.into(),
        index: i,
        other: j,
    };
    let grip = theme.get_board_pin_size();
    for i in (0..ui.get_tiles().row_count() as i32).rev() {
        let b = ui.invoke_box_at(i);
        if (x - b.x - b.w / 2.).hypot(y - b.y) < grip * 0.7 {
            return target("tie", i, -1);
        }
        if contains(&b, x, y, 0.) {
            let resize = x > b.x + b.w - grip && y > b.y + b.h - grip;
            return target(if resize { "resize" } else { "move" }, i, -1);
        }
    }
    for edge in ui.get_threads().iter().filter(|e| !e.preview) {
        if near_thread(
            ui.invoke_box_at(edge.first),
            ui.invoke_box_at(edge.second),
            x,
            y,
            theme.get_accessory_gap(),
        ) {
            return target("edge", edge.first, edge.second);
        }
    }
    for group in ui.get_groups().iter() {
        let frame = ui.invoke_group_box(group.members.clone());
        if contains(&frame, x, y, -4.) && !contains(&frame, x, y, 4.) {
            return target("group", group.members.row_data(0).unwrap_or(-1), -1);
        }
    }
    target("pan", -1, -1)
}
fn reveal(origin: f32, span: f32, start: f32, size: f32, pad: f32) -> f32 {
    if size + pad * 2. >= span || start - pad < origin {
        start - pad
    } else if start + size + pad > origin + span {
        start + size + pad - span
    } else {
        origin
    }
}
pub(super) fn grid_image(pitch: f32, color: slint::Color, scale: f32, diameter: Option<f32>) -> slint::Image {
    let side = (pitch * scale * 16.).round().clamp(1., 512.) as u32;
    let step = side as f32 / 16.;
    let mut buf = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(side, side);
    let radius = diameter.map_or(step / 16., |d| step / pitch * d / 2.);
    let pixels = buf.make_mut_slice();
    for row in 0..16 {
        for col in 0..16 {
            let cx = (col as f32 + 0.5) * step;
            let cy = (row as f32 + 0.5) * step;
            for y in ((cy - radius - 1.).max(0.) as u32)..((cy + radius + 1.).ceil() as u32).min(side) {
                for x in ((cx - radius - 1.).max(0.) as u32)..((cx + radius + 1.).ceil() as u32).min(side) {
                    let opacity = (radius + 0.5 - (x as f32 + 0.5 - cx).hypot(y as f32 + 0.5 - cy)).clamp(0., 1.);
                    pixels[(y * side + x) as usize] = slint::Rgba8Pixel {
                        r: color.red(),
                        g: color.green(),
                        b: color.blue(),
                        a: (opacity * 255.) as u8,
                    };
                }
            }
        }
    }
    slint::Image::from_rgba8(buf)
}

pub fn connect(bar: &Bar) {
    let ui = bar.global::<BoardUi>();
    let weak = bar.as_weak();
    ui.on_grid_image(move |pitch, color| grid_image(pitch, color, weak.unwrap().window().scale_factor(), None));
    let weak = bar.as_weak();
    ui.on_paper_dots(move |pitch, color, diameter| grid_image(pitch, color, weak.unwrap().window().scale_factor(), Some(diameter)));

    let weak = bar.as_weak();
    ui.on_hit(move |x, y| {
        let bar = weak.unwrap();
        hit(&bar.global::<BoardUi>(), &bar.global::<Theme>(), x, y)
    });
    let weak = bar.as_weak();
    ui.on_group_box(move |members| {
        let bar = weak.unwrap();
        group_box(
            &bar.global::<BoardUi>(),
            &members,
            bar.global::<Theme>().get_board_paper_inset(),
        )
    });
    let weak = bar.as_weak();
    ui.on_measured(move |i, h| {
        let bar = weak.unwrap();
        let heights = bar.global::<BoardUi>().get_heights();
        if heights.row_data(i as usize).is_some_and(|old| (old - h).abs() > 0.1) {
            heights.set_row_data(i as usize, h);
        }
    });
    let weak = bar.as_weak();
    ui.on_viewport(move |cmd| {
        let bar = weak.unwrap();
        let ui = bar.global::<BoardUi>();
        if !ui.get_opened() {
            return;
        }
        let (w, h) = (bar.get_board_viewport_w(), bar.get_board_viewport_h());
        if w <= 0. || h <= 0. {
            return;
        }
        let pad = bar.global::<Theme>().get_padding();
        let z = ui.get_zoom();
        match cmd.as_str() {
            "zoom-in" | "zoom-out" => {
                ui.invoke_zoom_at(if cmd == "zoom-in" { 1.25 } else { 0.8 }, w * 0.5, h * 0.5);
            }
            "reset-view" => {
                ui.set_zoom(1.);
                ui.set_left(-pad);
                ui.set_top(-pad);
            }
            _ if ui.get_selected() >= 0 && (ui.get_selected() as usize) < ui.get_tiles().row_count() => {
                let b = ui.invoke_box_at(ui.get_selected());
                ui.set_left(reveal(ui.get_left(), w / z, b.x, b.w, pad / z));
                ui.set_top(reveal(ui.get_top(), h / z, b.y, b.h, pad / z));
            }
            _ => {}
        }
    });
    ui.on_release(|index, op, x, y, w, h| {
        with_app(|a| {
            let bar = a.bar.clone_strong();
            let ui = bar.global::<BoardUi>();
            let Some(tile) = ui.get_tiles().row_data(index as usize) else {
                return;
            };
            let result = (|| {
                a.flush_board()?;
                let (Some(b), Some(j)) = (&mut a.board, &mut a.state.journal) else {
                    return Ok(());
                };
                if b.selected != tile.id.as_str() {
                    b.editor = 0;
                }
                b.selected = tile.id.to_string();
                match op.as_str() {
                    "tie" => {
                        for i in (0..ui.get_tiles().row_count() as i32).rev().filter(|i| *i != index) {
                            if contains(&ui.invoke_box_at(i), x, y, -2.) {
                                let other = ui.get_tiles().row_data(i as usize).unwrap();
                                return b.thread(&mut j.store, &tile.id, &other.id, "tie");
                            }
                        }
                        Ok(())
                    }
                    "group" | "move" => b.geometry(
                        &mut j.store,
                        board::Geometry::Move {
                            dx: x,
                            dy: y,
                            group: op == "group",
                        },
                    ),
                    "resize" => b.geometry(&mut j.store, board::Geometry::Resize(w + x, h + y)),
                    _ => Ok(()),
                }
            })();
            if let Err(e) = result {
                a.board_error(e);
            }
            a.draw_board();
        })
    });
}
