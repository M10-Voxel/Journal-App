//! The round dials of the day view (docs/plan.md, 0c): a ring open at the bottom (270°, from the lower left clockwise to
//! the lower right), the track in a quiet colour and the value as an arc in the scale's colour, both with round ends.
//! Drawn into a small RGBA image like the icons (the software renderer has no arcs of its own).

/// The ring's sweep, in degrees, and where it starts (screen angles, clockwise from the right).
const SWEEP: f32 = 270.0;
const START: f32 = 135.0;
/// Samples per pixel side (antialiasing).
const SAMPLES: u32 = 4;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Drawn { pub size: u32, pub rgba: Vec<u8> }

/// A dial of `size` pixels, the ring `thickness` pixels wide, filled to `fill` (0–1; none: only the track).
pub fn draw(size: u32, thickness: f32, fill: Option<f32>, track: [u8; 4], color: [u8; 4]) -> Drawn {
    let size = size.max(4);
    let c = size as f32 / 2.0;
    let half = (thickness / 2.0).max(0.5);
    let radius = c - half - 0.5;
    let end = fill.map(|f| f.clamp(0.0, 1.0) * SWEEP);
    let point = |degrees: f32| { let a = (START + degrees).to_radians(); (c + radius * a.cos(), c + radius * a.sin()) };
    let caps = [point(0.0), point(SWEEP)];
    let value_caps = end.map(|end| [point(0.0), point(end)]);
    let near = |x: f32, y: f32, (px, py): (f32, f32)| (x - px).powi(2) + (y - py).powi(2) <= half * half;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    for py in 0..size {
        for px in 0..size {
            let (mut on_track, mut on_value) = (0u32, 0u32);
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let x = px as f32 + (sx as f32 + 0.5) / SAMPLES as f32;
                    let y = py as f32 + (sy as f32 + 0.5) / SAMPLES as f32;
                    let distance = ((x - c).powi(2) + (y - c).powi(2)).sqrt();
                    let along = ((y - c).atan2(x - c).to_degrees() - START).rem_euclid(360.0);
                    let in_ring = (distance - radius).abs() <= half;
                    let track_hit = in_ring && along <= SWEEP || caps.iter().any(|cap| near(x, y, *cap));
                    let value_hit = match (end, value_caps) {
                        (Some(end), Some(value_caps)) if end > 0.0 => in_ring && along <= end || value_caps.iter().any(|cap| near(x, y, *cap)),
                        // Zero: a round dot at the start, so that "0" differs from no value.
                        (Some(_), Some(value_caps)) => near(x, y, value_caps[0]),
                        _ => false,
                    };
                    if value_hit { on_value += 1; } else if track_hit { on_track += 1; }
                }
            }
            let total = (SAMPLES * SAMPLES) as f32;
            let (tv, vv) = (on_track as f32 / total, on_value as f32 / total);
            let alpha = tv * track[3] as f32 / 255.0 + vv * color[3] as f32 / 255.0;
            if alpha <= 0.0 { continue; }
            let at = ((py * size + px) * 4) as usize;
            for channel in 0..3 {
                let mixed = (tv * track[3] as f32 / 255.0 * track[channel] as f32 + vv * color[3] as f32 / 255.0 * color[channel] as f32) / alpha;
                rgba[at + channel] = mixed.round().clamp(0.0, 255.0) as u8;
            }
            rgba[at + 3] = (alpha * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    Drawn { size, rgba }
}

/// The value at a point of the dial (`dx`, `dy` from its centre): the share of the sweep, clamped to its ends.
pub fn fraction_at(dx: f32, dy: f32) -> f32 {
    let along = (dy.atan2(dx).to_degrees() - START).rem_euclid(360.0);
    if along <= SWEEP { along / SWEEP } else if along < SWEEP + (360.0 - SWEEP) / 2.0 { 1.0 } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRACK: [u8; 4] = [0x1f, 0x1f, 0x1f, 255];
    const BLUE: [u8; 4] = [0x56, 0x9e, 0xff, 255];

    fn pixel(d: &Drawn, x: u32, y: u32) -> [u8; 4] { let at = ((y * d.size + x) * 4) as usize; [d.rgba[at], d.rgba[at + 1], d.rgba[at + 2], d.rgba[at + 3]] }

    #[test]
    fn the_ring_is_open_at_the_bottom_and_the_value_runs_clockwise_from_the_lower_left() {
        let half = draw(40, 4.0, Some(0.5), TRACK, BLUE);
        assert_eq!(half.rgba.len(), 40 * 40 * 4);
        assert_eq!(pixel(&half, 20, 37)[3], 0, "Open at the bottom.");
        assert_eq!(pixel(&half, 20, 20)[3], 0, "Hollow inside.");
        assert_eq!(pixel(&half, 2, 20), BLUE, "Left: within the first half.");
        assert_eq!(pixel(&half, 20, 2), BLUE, "Top: exactly half way (270° · 0.5 = 135° from the start).");
        assert_eq!(pixel(&half, 37, 20), TRACK, "Right: still to come.");
        let none = draw(40, 4.0, None, TRACK, BLUE);
        assert_eq!(pixel(&none, 2, 20), TRACK, "Without a value only the track.");
        let zero = draw(40, 4.0, Some(0.0), TRACK, BLUE);
        assert!(zero.rgba.chunks(4).any(|p| p == BLUE), "Zero shows a dot.");
        assert!(half.rgba.chunks(4).any(|p| p[3] > 0 && p[3] < 255), "Antialiased edges.");
    }

    #[test]
    fn a_point_on_the_dial_gives_its_value() {
        assert!((fraction_at(-1.0, 0.0) - 45.0 / 270.0).abs() < 1e-4, "Left.");
        assert!((fraction_at(0.0, -1.0) - 0.5).abs() < 1e-4, "Top.");
        assert!((fraction_at(1.0, 0.0) - 225.0 / 270.0).abs() < 1e-4, "Right.");
        assert_eq!(fraction_at(0.1, 1.0), 1.0, "The gap's right half belongs to the end…");
        assert_eq!(fraction_at(-0.1, 1.0), 0.0, "…its left half to the start.");
    }
}
