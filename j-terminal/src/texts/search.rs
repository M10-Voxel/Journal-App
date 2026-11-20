pub const FILTERS: &[(&str, [&str; 2], [&str; 2])] = &[
    ("task", ["Aufgabe", "Task"], ["Aufgaben der Tage", "Tasks of the days"]),
    ("event", ["Ereignis", "Event"], ["Ereignisse der Tage", "Events of the days"]),
    ("note", ["Notiz", "Note"], ["Notizen der Tage", "Notes of the days"]),
    ("calendar", ["Kalender", "Calendar"], ["Nur im Kalender", "Calendar only"]),
    ("title", ["Titel", "Title"], ["Titel der Tage", "Day titles"]),
    ("board", ["Pinnwand", "Board"], ["Alles auf der Pinnwand", "Everything on the board"]),
    ("board-note", ["Pinnwand/Zettel", "Board/Note"], ["Zettel der Pinnwand", "Notes on the board"]),
    ("board-image", ["Pinnwand/Bild", "Board/Image"], ["Bilder der Pinnwand", "Images on the board"]),
    ("board-link", ["Pinnwand/Link", "Board/Link"], ["Links der Pinnwand", "Links on the board"]),
    ("notebook", ["Notizblock", "Notebook"], ["Zettel im Notizblock", "Notes in the notebook"]),
];
pub const SECTIONS: [[&str; 2]; 5] = [["Einträge","Entries"],["Kalender","Calendar"],["Tage","Days"],["Pinnwand","Board"],["Notizblock","Notebook"]];
pub const TAG_GROUPS: [[&str; 2]; 3] = [["Eigene","Own"],["Checkliste","Checklist"],["E-Mail","Email"]];
pub const MAIL_IDS: [&str; 3] = ["f4c8191a-2d70-4b01-9d00-000000000001", "f4c8191a-2d70-4b01-9d00-000000000002", "f4c8191a-2d70-4b01-9d00-000000000003"];
pub const LIST_HINT: [&str; 2] = [r"↑ ↓  wählen     Enter  übernehmen     @  Typ     \  Tag", r"↑ ↓  select     Enter  accept     @  Type     \  Tag"];
