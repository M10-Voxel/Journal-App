//! Text turned a quarter to the right, so that it reads from top to bottom down a lane of the calendar. Slint's
//! software renderer does not turn text, so it is drawn here into an alpha mask; the window tints it (`colorize`).
use std::sync::OnceLock;
use ab_glyph::{point, Font, FontRef, PxScale, ScaleFont};

static FONT: OnceLock<FontRef<'static>> = OnceLock::new();

/// The same IBM Plex Sans as the interface, borrowed from the embedded bytes without a font-file allocation.
fn font() -> &'static FontRef<'static> {
    FONT.get_or_init(|| FontRef::try_from_slice(include_bytes!("../assets/fonts/IBMPlexSans-600.ttf")).expect("bundled IBM Plex Sans"))
}

/// A turned mask: `width` × `height` pixels, one coverage byte each.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mask { pub width: u32, pub height: u32, pub alpha: Vec<u8> }

/// `text` `size` pixels high, at most `room` pixels long (cut with `…`), turned so it reads downwards. `None` if there
/// is no room for a single letter.
pub fn turned(text: &str, size: f32, room: f32) -> Option<Mask> {
    let font = font();
    let scaled = font.as_scaled(PxScale::from(size));
    let advance = |text: &str| -> f32 {
        let mut width = 0.0;
        let mut previous = None;
        for c in text.chars() {
            let id = scaled.glyph_id(c);
            if let Some(previous) = previous { width += scaled.kern(previous, id); }
            width += scaled.h_advance(id);
            previous = Some(id);
        }
        width
    };
    let mut shown: String = text.trim().to_string();
    if advance(&shown) > room {
        let mut letters: Vec<char> = shown.chars().collect();
        while !letters.is_empty() && advance(&format!("{}…", letters.iter().collect::<String>())) > room { letters.pop(); }
        if letters.is_empty() { return None; }
        shown = format!("{}…", letters.iter().collect::<String>().trim_end());
    }
    let (width, height) = (advance(&shown).ceil().max(1.0) as u32, (scaled.ascent() - scaled.descent()).ceil().max(1.0) as u32);
    let mut flat = vec![0u8; (width * height) as usize];
    let mut caret = 0.0;
    let mut previous = None;
    for c in shown.chars() {
        let id = scaled.glyph_id(c);
        if let Some(previous) = previous { caret += scaled.kern(previous, id); }
        let glyph = id.with_scale_and_position(PxScale::from(size), point(caret, scaled.ascent()));
        caret += scaled.h_advance(id);
        previous = Some(id);
        let Some(outline) = font.outline_glyph(glyph) else { continue };
        let bounds = outline.px_bounds();
        outline.draw(|x, y, coverage| {
            let (x, y) = (x as i32 + bounds.min.x as i32, y as i32 + bounds.min.y as i32);
            if x >= 0 && y >= 0 && (x as u32) < width && (y as u32) < height {
                let at = (y as u32 * width + x as u32) as usize;
                flat[at] = flat[at].max((coverage * 255.0) as u8);
            }
        });
    }
    // A quarter turn to the right: the start of the line goes to the top.
    let mut alpha = vec![0u8; (width * height) as usize];
    for y in 0..height {
        for x in 0..width {
            let (nx, ny) = (height - 1 - y, x);
            alpha[(ny * height + nx) as usize] = flat[(y * width + x) as usize];
        }
    }
    Some(Mask { width: height, height: width, alpha })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_reads_downwards_and_is_cut_to_its_room() {
        let long = turned("Projektphase", 11.0, 1000.0).unwrap();
        assert!(long.height > long.width, "Turned: taller than wide.");
        assert!(long.alpha.iter().any(|a| *a > 128));
        let short = turned("Projektphase", 11.0, 30.0).unwrap();
        assert!(short.height <= 31 && short.height < long.height);
        assert!(turned("Projektphase", 11.0, 1.0).is_none());
        // The first letter is at the top: the top part has ink, the line's start.
        let top: u32 = short.alpha[..(short.width * 6) as usize].iter().map(|a| *a as u32).sum();
        assert!(top > 0);
    }
}
