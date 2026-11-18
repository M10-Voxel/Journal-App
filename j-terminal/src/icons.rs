//! The entry icons: the Lucide set the Journal app uses (ISC licence, `assets/LICENSE-lucide.txt`), as path data on
//! the 24 × 24 grid (`assets/lucide-icons.txt`, made from the app's `node_modules/lucide`). They are drawn here into
//! alpha masks with round strokes like Lucide's, and the window tints them.
//! Repeated SVG arcs in the asset are explicit for zeno 0.3; see `scripts/normalize_icon_arcs.py`.
use std::sync::OnceLock;
use zeno::{Cap, Join, Mask, Stroke, Transform};

const DATA: &str = include_str!("../assets/lucide-icons.txt");
static ICONS: OnceLock<Vec<(&'static str, &'static str)>> = OnceLock::new();

/// Every icon: its name and its path data, sorted by name.
pub fn all() -> &'static [(&'static str, &'static str)] {
    ICONS.get_or_init(|| {
        let mut icons: Vec<(&str, &str)> = DATA.lines().filter_map(|line| line.split_once('\t')).collect();
        icons.sort_by(|a, b| a.0.cmp(b.0));
        icons
    })
}

pub fn exists(name: &str) -> bool { all().binary_search_by(|(known, _)| known.cmp(&name)).is_ok() }

/// Icons whose name has every word of `query` in it; names starting with the query first, then shorter ones.
pub fn search(query: &str, limit: usize) -> Vec<&'static str> {
    let words: Vec<String> = query.to_lowercase().split(|c: char| c.is_whitespace() || c == '-').filter(|w| !w.is_empty()).map(str::to_string).collect();
    let mut found: Vec<(bool, usize, &'static str)> = all().iter()
        .filter(|(name, _)| words.iter().all(|word| name.contains(word.as_str())))
        .map(|(name, _)| (!words.first().is_some_and(|first| name.starts_with(first.as_str())), name.len(), *name)).collect();
    found.sort();
    found.into_iter().take(limit).map(|(_, _, name)| name).collect()
}

/// A drawn icon: `size` × `size` pixels, one coverage byte each.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Drawn { pub size: u32, pub alpha: Vec<u8> }

/// Rasterize at eight times the physical display resolution, then area-average the coverage. Slint's software
/// renderer receives exactly the display-sized mask, so its texture scaling cannot undo the antialiasing.
/// Only the small final mask is cached; the high-resolution working buffer is dropped here.
pub fn draw(name: &str, size: u32) -> Option<Drawn> {
    let (_, path) = all().iter().find(|(known, _)| *known == name)?;
    const SAMPLES: u32 = 8;
    let size = size.max(1);
    let raster_size = size.checked_mul(SAMPLES)?;
    let scale = raster_size as f32 / 24.0;
    let (alpha, _) = Mask::new(*path)
        .style(Stroke::new(2.0).cap(Cap::Round).join(Join::Round))
        .transform(Some(Transform::scale(scale, scale)))
        .size(raster_size, raster_size)
        .render();
    let mut square = vec![0u8; (size * size) as usize];
    for y in 0..size {
        for x in 0..size {
            let mut coverage = 0u32;
            for sy in 0..SAMPLES {
                let row = ((y * SAMPLES + sy) * raster_size + x * SAMPLES) as usize;
                coverage += alpha[row..row + SAMPLES as usize].iter().map(|value| *value as u32).sum::<u32>();
            }
            square[(y * size + x) as usize] = ((coverage + SAMPLES * SAMPLES / 2) / (SAMPLES * SAMPLES)) as u8;
        }
    }
    Some(Drawn { size, alpha: square })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_icons_keep_smooth_coverage_at_common_display_scales() {
        for size in [12, 15, 16, 20, 24, 30, 40] {
            let icon = draw("circle", size).unwrap();
            assert_eq!(icon.alpha.len(), (size * size) as usize);
            assert!(icon.alpha.iter().any(|a| *a > 0 && *a < 255), "Antialiased edges at {size}px.");
            assert_eq!(icon.alpha[(size / 2 * size + size / 2) as usize], 0, "No blur into the hollow centre.");
            for y in 0..size { for x in 0..size {
                let a = icon.alpha[(y * size + x) as usize];
                let b = icon.alpha[(y * size + size - 1 - x) as usize];
                assert!(a.abs_diff(b) <= 4, "Symmetric curve coverage at {size}px ({x}, {y}): {a}/{b}");
            } }
        }
    }

    #[test]
    fn every_icon_path_is_parsed_completely() {
        use zeno::PathData;
        for (name, path) in all() {
            let mut commands = path.commands();
            let count = commands.by_ref().count();
            assert!(count > 0 && !commands.error && commands.done, "{name}: stopped at {} of {}", commands.pos, path.len());
        }
        capture_icons();
    }

    fn capture_icons() {
        if std::env::var_os("J_TERMINAL_UI_CAPTURE").is_none() { return; }
        let names = ["graduation-cap", "circle-letter-m", "moon", "guitar", "milestone", "truck", "wallet", "cake"];
        let size = 48;
        let mut bytes = format!("P6\n{} {}\n255\n", names.len() * size, size).into_bytes();
        let drawn: Vec<_> = names.iter().map(|name| draw(name, size as u32).unwrap()).collect();
        for y in 0..size { for icon in &drawn { for x in 0..size {
            let ink = icon.alpha[y * size + x];
            bytes.extend_from_slice(&[ink, ink, ink]);
        } } }
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ui-check");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("icon-regressions.ppm"), bytes).unwrap();
    }

    #[test]
    fn repeated_arcs_draw_the_guitar_body_as_well_as_its_neck() {
        let guitar = draw("guitar", 24).unwrap();
        let body: u32 = (12..24).flat_map(|y| (0..14).map(move |x| y * 24 + x))
            .map(|at| guitar.alpha[at] as u32).sum();
        assert!(body > 8000, "The body must be drawn, not only the short bridge line: {body}");
    }

    #[test]
    fn the_whole_set_is_there_and_can_be_searched() {
        assert!(all().len() > 1500);
        assert!(all().windows(2).all(|pair| pair[0].0 < pair[1].0), "Sorted, for looking up.");
        assert!(exists("stethoscope") && !exists("no-such-icon"));
        let found = search("bell", 50);
        assert_eq!(found[0], "bell", "The plain name first.");
        assert!(found.iter().all(|name| name.contains("bell")));
        assert!(search("grad cap", 5).contains(&"graduation-cap"), "Every word counts.");
    }

    #[test]
    fn an_icon_is_drawn_with_ink_inside_its_square() {
        let drawn = draw("circle", 24).unwrap();
        assert_eq!(drawn.alpha.len(), 24 * 24);
        let ink = |x: u32, y: u32| drawn.alpha[(y * 24 + x) as usize];
        assert!(ink(12, 2) > 100, "The ring at the top.");
        assert!(ink(12, 12) < 20, "Empty in the middle.");
        assert!(draw("no-such-icon", 24).is_none());
    }

    #[test]
    fn parts_that_start_with_a_relative_move_stay_where_lucide_puts_them() {
        // `square-check`: a square, then a tick written as `m16 9-5.5 5.5L8 12`. Joined to the square, a relative
        // start would put the tick outside; it must cross the middle of the square.
        let tick = draw("square-check", 24).unwrap();
        let ink = |x: u32, y: u32| tick.alpha[(y * 24 + x) as usize];
        assert!(ink(13, 12) > 100, "The tick crosses the middle.");
        assert!(ink(12, 6) < 20, "Nothing above it inside the square.");
        let check = draw("calendar-check", 24).unwrap();
        assert!(check.alpha[(16 * 24 + 11) as usize] > 100, "calendar-check has its tick, unlike calendar.");
        assert!(draw("calendar", 24).unwrap().alpha[(16 * 24 + 11) as usize] < 20);
    }
}
