//! The words of making tags and folders and of the tag editor: German first, then English.
use super::Language;

fn l(language: Language) -> usize { usize::from(language == Language::En) }

/// The line in a tag picker that makes the tag typed.
pub fn make_tag(name: &str, language: Language) -> String {
    if language == Language::En { format!("Create tag “{name}”") } else { format!("Tag „{name}“ anlegen") }
}

/// The line in a folder picker that makes the folder typed.
pub fn make_folder(name: &str, language: Language) -> String {
    if language == Language::En { format!("Create folder “{name}”") } else { format!("Ordner „{name}“ anlegen") }
}

pub fn heading(language: Language) -> &'static str { ["Tag bearbeiten", "Edit tag"][l(language)] }
pub fn name(language: Language) -> &'static str { ["Name", "Name"][l(language)] }
pub fn color(language: Language) -> &'static str { ["Farbe", "Colour"][l(language)] }
pub fn icon(language: Language) -> &'static str { ["Symbol", "Icon"][l(language)] }
pub fn no_icon(language: Language) -> &'static str { ["Kein Symbol", "No icon"][l(language)] }
pub fn icon_search(language: Language) -> &'static str { ["Symbol suchen", "Search icons"][l(language)] }
pub fn bad_name(language: Language) -> &'static str { ["Name fehlt, ist länger als 40 Zeichen oder schon vergeben", "The name is missing, longer than 40 characters or taken"][l(language)] }