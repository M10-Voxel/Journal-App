//! The words of the templates (`/Vorlage`, `#Name`): German first, then English.
pub const COMMAND: [&str; 2] = ["/Vorlage", "/Template"];
/// The words `/…` is matched against (folded).
pub const COMMAND_WORDS: [&str; 2] = ["vorlage", "template"];
pub const HEADING: [&str; 2] = ["Vorlagen", "Templates"];
pub const COMMAND_DETAIL: [&str; 2] = ["Vorlage anlegen: Namen dahinter tippen, z. B. /Vorlage Geburtstag", "Make a template: type its name after it, e.g. /Template Birthday"];
pub const MAKE: [&str; 2] = ["Neue Vorlage anlegen", "Make a new template"];
pub const CHANGE: [&str; 2] = ["Vorlage bearbeiten", "Change the template"];
pub const OPEN: [&str; 2] = ["Eintrag aus Vorlage", "Entry from the template"];
pub const NONE: [&str; 2] = ["Keine Vorlage mit diesem Namen – /Vorlage Name legt sie an", "No template by that name – /Template Name makes one"];
pub const NONE_YET: [&str; 2] = ["Noch keine Vorlagen – /Vorlage Name legt eine an", "No templates yet – /Template Name makes one"];
/// Shown in the search bar while a template is being written; the name follows.
pub const EDITING: [&str; 2] = ["Vorlage", "Template"];
pub const EDITING_HINT: [&str; 2] = ["Strg+Enter speichert · ... im Titel ist eine Lücke", "Ctrl+Enter saves · ... in the title is a gap"];
pub const SAVE: [&str; 2] = ["Vorlage speichern", "Save the template"];
pub const DELETE: [&str; 2] = ["Vorlage löschen", "Delete the template"];
pub const SAVED: [&str; 2] = ["Vorlage gespeichert", "Template saved"];
pub const DELETED: [&str; 2] = ["Vorlage gelöscht", "Template deleted"];
pub const WRITE_FAILED: [&str; 2] = ["Vorlage nicht gespeichert:", "Template not saved:"];
