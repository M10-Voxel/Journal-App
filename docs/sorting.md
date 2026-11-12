# Sortieren per Ziehen

Listen mit eigener Reihenfolge werden per Drag & Drop sortiert (`src/sortable.ts`, `src/components/SortHandle.tsx`). Die gehaltene Zeile folgt dem Mauszeiger und liegt über den anderen, die übrigen rücken weich zur Seite, am Rand der Liste wird gescrollt. Erst beim Loslassen gilt die neue Reihenfolge; die Zeilen bleiben so stehen, bis die Liste neu gezeichnet ist, damit beim Speichern nichts zurückspringt. Escape bricht ab.

| Ort | Ziehen | Pfeile |
| --- | --- | --- |
| Einträge (Journal und Tagesnotiz-Widget) | am Griff, nur innerhalb von Typ, Priorität und Tag-Gruppe; außerhalb ändert Loslassen nichts | bleiben (Aktionen „Nach oben/unten“, Alt ↑ / Alt ↓) |
| Einstellungen · Tags | Zeile oder Griff, innerhalb der Kategorie | ersetzt: ↑ ↓ am fokussierten Griff |
| Einstellungen · Tag-Kategorien | an der Überschrift | ersetzt: ↑ ↓ am Griff |
| Einstellungen · Aktivitäten | Zeile oder Griff | ersetzt: ↑ ↓ am Griff |
| Einstellungen · Tageswerte | Zeile oder Griff (Tagesbewertung bleibt oben) | ersetzt: ↑ ↓ am Griff |
| Einstellungen · Desktop-Widgets · Ebenen | Zeile oder Griff (oben = vorne) | ↑ ↓ am Griff |

Felder, Knöpfe und Farbwähler in einer Zeile behalten ihre eigene Bedienung; gezogen wird über die freie Fläche oder den Griff. Prüfung: `JOURNAL_UI_SCOPE=sorting node scripts/verify-ui.mjs`.
