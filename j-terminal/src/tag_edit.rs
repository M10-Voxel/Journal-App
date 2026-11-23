//! New tags and their look, as in the Journal app (`TagSettings.tsx`, `ColorPicker.tsx`, `tags.ts`).
//!
//! Every tag picker offers „Name“ anlegen when what is typed names no tag. The tag is made at once (the next free colour
//! of the app's swatches, no icon) and given to the entry, card or note; then the tag editor opens on it: the name, the
//! colour (a saturation/brightness field, a hue bar, the swatches and the hex code) and the icon. Enter keeps what is
//! chosen, Esc leaves the tag as it was made.
use journal_core::storage::{Store, Tag};
use crate::icons;

/// The app's swatches (`tagSwatches`), in its order.
pub const SWATCHES: [&str; 10] = ["#569eff", "#76d982", "#e6a85c", "#c69bff", "#ff7a90", "#4fd1c5", "#e2d36b", "#ff9f5a", "#8fa3ff", "#a8a8a8"];
pub const MAX_NAME: usize = 40;
/// Icons per line of the editor's grid (as `side-icon-columns` in the theme).
pub const ICON_COLUMNS: usize = 7;
const ICON_ROOM: usize = 49;

/// The first swatch no tag has yet; when all are taken, by the number of tags (`nextTagColor`).
pub fn next_color(tags: &[Tag]) -> &'static str {
    SWATCHES.iter().copied().find(|swatch| !tags.iter().any(|t| t.color.eq_ignore_ascii_case(swatch))).unwrap_or(SWATCHES[tags.len() % SWATCHES.len()])
}

/// A tag of this name could be made from what is typed: not empty, at most 40 characters, no tag of that name yet.
pub fn creatable(tags: &[Tag], query: &str) -> Option<String> {
    let name = query.trim();
    let taken = tags.iter().any(|t| t.name.trim().to_lowercase() == name.to_lowercase());
    (!name.is_empty() && name.chars().count() <= MAX_NAME && !taken).then(|| name.to_string())
}

/// The tag is made after the others with the next free colour.
pub fn create(store: &mut Store, name: &str) -> Result<Tag, String> {
    let mut tags = store.tags().map_err(|e| e.to_string())?;
    let name = creatable(&tags, name).ok_or_else(|| "tag".to_string())?;
    let tag = Tag { id: uuid::Uuid::new_v4().to_string(), name, color: next_color(&tags).into(), icon: None };
    tags.push(tag.clone());
    store.save_tags(&tags).map_err(|e| e.to_string())?;
    Ok(tag)
}

/// The tag's name, colour and icon change; its place in the list stays.
pub fn update(store: &mut Store, id: &str, name: &str, color: &str, icon: Option<&str>) -> Result<(), String> {
    let mut tags = store.tags().map_err(|e| e.to_string())?;
    let tag = tags.iter_mut().find(|t| t.id == id).ok_or_else(|| "tag".to_string())?;
    tag.name = name.trim().to_string();
    tag.color = color.to_lowercase();
    tag.icon = icon.filter(|name| icons::exists(name)).map(str::to_string);
    store.save_tags(&tags).map(|_| ()).map_err(|e| e.to_string())
}

/// `#rrggbb` (also without `#`, or as `#rgb`) → `#rrggbb` in small letters.
pub fn parse_hex(text: &str) -> Option<String> {
    let digits = text.trim().trim_start_matches('#');
    if !digits.chars().all(|c| c.is_ascii_hexdigit()) { return None; }
    match digits.len() {
        6 => Some(format!("#{}", digits.to_lowercase())),
        3 => Some(format!("#{}", digits.chars().flat_map(|c| [c, c]).collect::<String>().to_lowercase())),
        _ => None,
    }
}

/// Hue (0–360), saturation and brightness (0–1) of `#rrggbb`.
pub fn hsv_of(hex: &str) -> (f32, f32, f32) {
    let [r, g, b] = crate::calendar::parse_color(hex).unwrap_or([0x56, 0x9e, 0xff]).map(|c| c as f32 / 255.0);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let delta = max - min;
    let hue = if delta == 0.0 { 0.0 } else if max == r { 60.0 * ((g - b) / delta).rem_euclid(6.0) } else if max == g { 60.0 * ((b - r) / delta + 2.0) } else { 60.0 * ((r - g) / delta + 4.0) };
    (hue, if max == 0.0 { 0.0 } else { delta / max }, max)
}

/// `#rrggbb` of hue (0–360), saturation and brightness (0–1).
pub fn hex_of(hue: f32, saturation: f32, value: f32) -> String {
    let (h, s, v) = (hue.rem_euclid(360.0) / 60.0, saturation.clamp(0.0, 1.0), value.clamp(0.0, 1.0));
    let c = v * s;
    let x = c * (1.0 - (h.rem_euclid(2.0) - 1.0).abs());
    let (r, g, b) = match h as u32 { 0 => (c, x, 0.0), 1 => (x, c, 0.0), 2 => (0.0, c, x), 3 => (0.0, x, c), 4 => (x, 0.0, c), _ => (c, 0.0, x) };
    let m = v - c;
    let byte = |part: f32| ((part + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    format!("#{:02x}{:02x}{:02x}", byte(r), byte(g), byte(b))
}

/// Where the editor's keyboard is.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Part { #[default] Name, Field, Swatches, Hex, Icons }
const PARTS: [Part; 5] = [Part::Name, Part::Field, Part::Swatches, Part::Hex, Part::Icons];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key { Tab, BackTab, Up, Down, Left, Right }

/// The tag being changed in the editor.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Editor {
    pub id: String,
    pub name: String,
    pub hue: f32,
    pub saturation: f32,
    pub value: f32,
    /// What the hex input shows (while typed it may not be a colour yet).
    pub hex: String,
    pub icon: Option<String>,
    pub query: String,
    /// The highlighted icon (0: no icon).
    pub pick: usize,
    pub part: Part,
    pub error: Option<String>,
}

impl Editor {
    pub fn new(tag: &Tag) -> Self {
        let (hue, saturation, value) = hsv_of(&tag.color);
        let mut editor = Editor { id: tag.id.clone(), name: tag.name.clone(), hue, saturation, value, hex: tag.color.to_lowercase(), icon: tag.icon.clone(), ..Editor::default() };
        editor.pick = editor.icon.as_deref().and_then(|icon| editor.icons().iter().position(|i| *i == Some(icon))).unwrap_or(0);
        editor
    }

    pub fn color(&self) -> String { hex_of(self.hue, self.saturation, self.value) }

    fn colored(&mut self) { self.hex = self.color(); }

    /// No icon, then the common ones (with the tag's own) or what the search finds.
    pub fn icons(&self) -> Vec<Option<&'static str>> {
        let found: Vec<&'static str> = if self.query.trim().is_empty() {
            let mut common: Vec<&'static str> = crate::form::COMMON_ICONS.iter().copied().filter(|name| icons::exists(name)).collect();
            if let Some((own, _)) = self.icon.as_deref().and_then(|icon| icons::all().iter().find(|(name, _)| *name == icon)) { if !common.contains(own) { common.insert(0, own); } }
            common
        } else { icons::search(&self.query, ICON_ROOM) };
        std::iter::once(None).chain(found.into_iter().map(Some)).collect()
    }

    /// The swatch of the colour now (if it is one).
    pub fn swatch(&self) -> Option<usize> { SWATCHES.iter().position(|s| *s == self.color()) }

    pub fn set_name(&mut self, name: &str) { self.name = name.to_string(); self.error = None; }

    /// A point of the field (saturation left to right, brightness bottom to top), from 0 to 1.
    pub fn set_field(&mut self, x: f32, y: f32) { self.saturation = x.clamp(0.0, 1.0); self.value = (1.0 - y).clamp(0.0, 1.0); self.part = Part::Field; self.colored(); }

    pub fn set_hue(&mut self, hue: f32) { self.hue = hue.clamp(0.0, 360.0); self.part = Part::Field; self.colored(); }

    pub fn set_swatch(&mut self, index: usize) {
        if let Some(swatch) = SWATCHES.get(index) { (self.hue, self.saturation, self.value) = hsv_of(swatch); self.hex = swatch.to_string(); self.part = Part::Swatches; }
    }

    /// The hex input changed: a whole colour is taken at once.
    pub fn set_hex(&mut self, text: &str) {
        self.hex = text.to_string();
        if let Some(color) = parse_hex(text) { (self.hue, self.saturation, self.value) = hsv_of(&color); }
    }

    pub fn set_query(&mut self, query: &str) { self.query = query.to_string(); self.pick = 0; }

    pub fn set_icon(&mut self, index: usize) {
        if let Some(icon) = self.icons().get(index) { self.icon = icon.map(str::to_string); self.pick = index; self.part = Part::Icons; }
    }

    pub fn focus(&mut self, part: Part) { self.part = part; }

    /// Tab goes through the parts; the arrows move in the one with the keyboard (Shift: the hue in the field).
    pub fn key(&mut self, key: Key, shift: bool) {
        let at = PARTS.iter().position(|p| *p == self.part).unwrap_or(0);
        match (key, self.part) {
            (Key::Tab, _) => self.part = PARTS[(at + 1) % PARTS.len()],
            (Key::BackTab, _) => self.part = PARTS[(at + PARTS.len() - 1) % PARTS.len()],
            (Key::Left | Key::Right, Part::Field) if shift => { let step = if key == Key::Left { -10.0 } else { 10.0 }; self.hue = (self.hue + step).rem_euclid(360.0); self.colored(); }
            (Key::Up | Key::Down, Part::Field) if shift => { let step = if key == Key::Up { -10.0 } else { 10.0 }; self.hue = (self.hue + step).rem_euclid(360.0); self.colored(); }
            (Key::Left | Key::Right, Part::Field) => { self.saturation = (self.saturation + if key == Key::Left { -0.05 } else { 0.05 }).clamp(0.0, 1.0); self.colored(); }
            (Key::Up | Key::Down, Part::Field) => { self.value = (self.value + if key == Key::Up { 0.05 } else { -0.05 }).clamp(0.0, 1.0); self.colored(); }
            (Key::Left | Key::Right | Key::Up | Key::Down, Part::Swatches) => {
                let by = if matches!(key, Key::Left | Key::Up) { SWATCHES.len() - 1 } else { 1 };
                let next = self.swatch().map_or(0, |at| (at + by) % SWATCHES.len());
                self.set_swatch(next);
            }
            (_, Part::Icons) => {
                let count = self.icons().len().max(1) as i32;
                let by: i32 = match key { Key::Left => -1, Key::Right => 1, Key::Up => -(ICON_COLUMNS as i32), _ => ICON_COLUMNS as i32 };
                let next = (self.pick as i32 + by).clamp(0, count - 1) as usize;
                self.set_icon(next);
            }
            _ => {}
        }
    }

    /// The name and the colour as they would be kept, or what is wrong with them.
    pub fn checked(&self, tags: &[Tag], none_name: &str) -> Result<(String, String), String> {
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > MAX_NAME { return Err(none_name.to_string()); }
        if tags.iter().any(|t| t.id != self.id && t.name.trim().to_lowercase() == name.to_lowercase()) { return Err(none_name.to_string()); }
        Ok((name.to_string(), parse_hex(&self.hex).unwrap_or_else(|| self.color())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(name: &str, color: &str) -> Tag { Tag { id: uuid::Uuid::new_v4().to_string(), name: name.into(), color: color.into(), icon: None } }

    #[test]
    fn the_next_colour_is_the_first_free_swatch() {
        assert_eq!(next_color(&[]), "#569eff");
        assert_eq!(next_color(&[tag("A", "#569EFF"), tag("B", "#e6a85c")]), "#76d982");
        let all: Vec<_> = SWATCHES.iter().map(|s| tag(s, s)).collect();
        assert_eq!(next_color(&all), SWATCHES[0]);
    }

    #[test]
    fn only_a_new_name_can_be_made() {
        let tags = [tag("Arbeit", "#569eff")];
        assert_eq!(creatable(&tags, " Sport "), Some("Sport".into()));
        assert_eq!(creatable(&tags, "arbeit"), None);
        assert_eq!(creatable(&tags, "  "), None);
        assert_eq!(creatable(&tags, &"x".repeat(41)), None);
    }

    #[test]
    fn colours_go_to_hsv_and_back() {
        for swatch in SWATCHES { let (h, s, v) = hsv_of(swatch); assert_eq!(hex_of(h, s, v), swatch); }
        assert_eq!(hex_of(0.0, 1.0, 1.0), "#ff0000");
        assert_eq!(hex_of(120.0, 1.0, 0.5), "#008000");
        assert_eq!(parse_hex("ABC"), Some("#aabbcc".into()));
        assert_eq!(parse_hex("#12345"), None);
        assert_eq!(parse_hex("#12345g"), None);
    }

    #[test]
    fn the_editor_moves_with_the_keys() {
        let mut editor = Editor::new(&tag("Sport", "#ff0000"));
        assert_eq!((editor.part, editor.pick), (Part::Name, 0));
        editor.key(Key::Tab, false);
        assert_eq!(editor.part, Part::Field);
        editor.key(Key::Down, false);
        assert_eq!(editor.color(), "#f20000", "Darker.");
        editor.key(Key::Right, true);
        assert_eq!(editor.hue, 10.0, "Shift: the hue.");
        editor.key(Key::Tab, false);
        editor.key(Key::Right, false);
        assert_eq!(editor.color(), SWATCHES[0], "Not a swatch yet: the first.");
        editor.key(Key::Right, false);
        assert_eq!((editor.color(), editor.hex.as_str()), (SWATCHES[1].to_string(), SWATCHES[1]));
        editor.key(Key::Tab, false);
        editor.set_hex("#12");
        assert_eq!(editor.color(), SWATCHES[1], "Half typed: the colour stays.");
        editor.set_hex("#123456");
        assert_eq!(editor.color(), "#123456");
        editor.key(Key::Tab, false);
        editor.set_query("guitar");
        editor.key(Key::Right, false);
        assert_eq!(editor.icon.as_deref(), Some("guitar"));
        editor.key(Key::BackTab, false);
        assert_eq!(editor.part, Part::Hex);
        editor.set_name("arbeit");
        assert!(editor.checked(&[tag("Arbeit", "#569eff")], "x").is_err(), "Another tag has the name.");
        editor.set_name("Gitarre");
        assert_eq!(editor.checked(&[], "x"), Ok(("Gitarre".into(), "#123456".into())));
    }

    #[test]
    fn made_and_changed_in_the_test_journal() {
        let path = std::env::temp_dir().join(format!("j-terminal-tags-{}.sqlite3", uuid::Uuid::new_v4()));
        let mut store = Store::open(&path).unwrap();
        store.save_tags(&[tag("Arbeit", "#569eff")]).unwrap();
        let made = create(&mut store, "Sport").unwrap();
        assert_eq!((made.name.as_str(), made.color.as_str(), made.icon.as_deref()), ("Sport", "#76d982", None));
        assert!(create(&mut store, "sport").is_err());
        update(&mut store, &made.id, "Laufen", "#FF0000", Some("dumbbell")).unwrap();
        let tags = store.tags().unwrap();
        assert_eq!(tags.iter().map(|t| (t.name.as_str(), t.color.as_str(), t.icon.as_deref())).collect::<Vec<_>>(),
            [("Arbeit", "#569eff", None), ("Laufen", "#ff0000", Some("dumbbell"))]);
        drop(store);
        for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", path.display())); }
    }
}
