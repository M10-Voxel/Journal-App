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

// The notepad's list: folders made, named and moved.
pub fn new_folder(language: Language) -> &'static str { ["Neuer Ordner", "New folder"][l(language)] }
pub fn subfolder(language: Language) -> &'static str { ["Unterordner anlegen", "New subfolder"][l(language)] }
pub fn new_note_here(language: Language) -> &'static str { ["Neuer Zettel hier", "New note here"][l(language)] }
pub fn rename(language: Language) -> &'static str { ["Umbenennen", "Rename"][l(language)] }
pub fn rename_folder(language: Language) -> &'static str { ["Neuer Name des Ordners", "New name of the folder"][l(language)] }
pub fn move_item(language: Language) -> &'static str { ["Verschieben nach …", "Move to …"][l(language)] }
pub fn folder_name_hint(language: Language) -> &'static str { ["Namen tippen, Enter legt ihn an (höchstens 120 Zeichen)", "Type a name, Enter makes it (120 characters at most)"][l(language)] }
pub fn new_subfolder(parent: &str, language: Language) -> String {
    if language == Language::En { format!("New folder in “{parent}”") } else { format!("Neuer Ordner in „{parent}“") }
}
pub fn move_to(name: &str, language: Language) -> String {
    if language == Language::En { format!("Move “{name}” to …") } else { format!("„{name}“ verschieben nach …") }
}

pub fn delete_note(language: Language) -> &'static str { ["Zettel löschen", "Delete note"][l(language)] }
pub fn delete_folder(language: Language) -> &'static str { ["Ordner löschen (Inhalt rückt nach oben)", "Delete folder (its contents move up)"][l(language)] }
pub fn delete_entry(language: Language) -> &'static str { ["Löschen", "Delete"][l(language)] }
pub fn cancel(language: Language) -> &'static str { ["Abbrechen", "Cancel"][l(language)] }
pub fn confirm_delete(name: &str, language: Language) -> String {
    if language == Language::En { format!("Delete “{name}” for good (also from the board)") } else { format!("„{name}“ endgültig löschen (auch von der Pinnwand)") }
}
pub fn delete_question(language: Language) -> &'static str { ["Zettel endgültig löschen?", "Delete the note for good?"][l(language)] }
pub fn deleted(language: Language) -> &'static str { ["Gelöscht – Strg+Z holt es zurück", "Deleted – Ctrl+Z brings it back"][l(language)] }
/// A way to delete as a line of the actions: "Nur diesen löschen", "Delete every Friday".
pub fn delete_scope(scope: &str, language: Language) -> String {
    if language == Language::En {
        let mut chars = scope.chars();
        let lower = chars.next().map(|c| c.to_lowercase().collect::<String>() + chars.as_str()).unwrap_or_default();
        format!("Delete {lower}")
    } else { format!("{scope} löschen") }
}
// A tag deleted from a tag list (Alt+Entf or Strg+K on it), after asking.
pub fn delete_tag_heading(language: Language) -> &'static str { ["Tag löschen?", "Delete the tag?"][l(language)] }
pub fn confirm_delete_tag(name: &str, language: Language) -> String {
    if language == Language::En { format!("Delete “{name}” (entries keep no tag)") } else { format!("„{name}“ löschen (Einträge verlieren den Tag)") }
}
pub fn tag_deleted(name: &str, language: Language) -> String {
    if language == Language::En { format!("Tag “{name}” deleted – Ctrl+Z brings it back") } else { format!("Tag „{name}“ gelöscht – Strg+Z holt ihn zurück") }
}
