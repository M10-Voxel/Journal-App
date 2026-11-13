# Design-Achsen: Aufbau, Optik, Popups, Pixel

Das Aussehen der App setzt sich aus vier unabhängigen Achsen zusammen. Jede steht als Attribut auf `<html>` (`applyTheme` in `src/settings.ts`), die Ids und Hilfen stehen in `src/designs.ts`.

| Achse | Attribut | Was sie bestimmt | Werte |
| --- | --- | --- | --- |
| **Aufbau** (layout) | `data-layout` | Was wo steht: die Struktur des Fensters. Ein Aufbau ist ein eigener Komponentenbaum (`main.tsx`) mit eigenem CSS. | `classic` (Seitenleiste und Fläche), `book` (Buch mit Seiten, Register, Leseband, Kalenderblatt), `desk` (Nebula-Desktop mit Poster und Fenstern) |
| **Optik** (look) | `data-look` | Schrift, Farben, Formen, Schatten, Papier – für alle gewöhnlichen Teile der App (Einträge, Kalender, Auswahlen, Pinnwandkarten, Notizblock …), in jedem Aufbau. | `classic`, `journal`, `nebula` |
| **Popups** | `data-popups` | Die Variante der Popups (Planer, Eintragseditor, Auswahlen), je Optik zwei: `a`, `b`. | `a`, `b` |
| **Pixel** | `data-pixel` | Pixelschrift und eckige Stufen über Optiken, die sie nehmen (`takesPixel`: nicht Nebula). | an / aus |

Die drei bisherigen Designs sind **Vorlagen** (`presets`): Normal = Aufbau `classic` + Optik `classic`, Journal = `book` + `journal`, Nebula = `desk` + `nebula`. In den Einstellungen (Darstellung) setzt eine Vorlage beide Achsen, darunter wählen „Aufbau“ und „Optik“ sie einzeln. Eine Mischung ist keine Vorlage (keine der drei Karten ist dann gewählt).

## Gespeichert

`journal.settings` enthält `layout` und `look`. Zusätzlich schreibt `saveSettings` weiter ein `theme` (`legacyTheme`: die Vorlage des Aufbaus), damit ältere App-Stände, die die Einstellungen über Drive teilen, weiter laufen. `storedDesign` liest beides: Ein `theme`, das nicht zu dem gespeicherten Aufbau passt, wurde von einem älteren Stand gesetzt und gewinnt; ohne `layout`/`look` (alte Einstellungen) wird aus `theme` abgeleitet; ein früheres `theme: 'pixel'` ist Normal mit Pixel-Look.

Die **Palette** hängt an der Optik: Die Journal-Optik bringt beim Wechsel ihre Papierpalette (`withLook`, Wiederherstellung der vorigen beim Verlassen), die Nebula-Optik hat eine feste Palette (`hasFixedPalette`, mit `!important` in `nebula-theme.css`; die Farbeinstellungen sind dort gesperrt).

## Wohin gehört eine CSS-Regel?

- **Auf Aufbau-Klassen** (`.book-*`, `.calendar-drawer`, `.calendar-tab`, `.is-book`, `.notebook-tab`; `.nebula-*`, `.is-nebula`): unter `:root[data-layout='book']` bzw. `'desk'`. Das ist Struktur und das, was der Aufbau für sich selbst als Aussehen mitbringt.
- **Auf alles andere** (Einträge, Kalender, Pinnwand, Notizblock, Auswahlen, Widgets, Tags, Symbole …): unter `:root[data-look='…']`. Diese Regeln gelten in jedem Aufbau.
- **Variablen:** Was ein Aufbau braucht, egal welche Optik gewählt ist (`--leather`, `--book-paper`, `--spine-ink` des Buchs; `--nb-*`, `--holo` des Desks), steht unter `:root[data-look='x'], :root[data-layout='y']`. Schrift, Farbpalette und Popup-Maße der Optik stehen nur unter der Optik.
- Die Zuordnung der bestehenden Regeln ist mit einem Skript geschehen (Regeln mit Aufbau-Klasse → Aufbau, Rest → Optik); Dateien: `journal-theme.css` (Buch + Journal-Optik), `nebula-*.css` (Desk + Nebula-Optik), alle Komponenten-CSS mit Optik-Blöcken.

## Einen Aufbau, eine Optik oder eine Popup-Variante ergänzen

**Optik:** Id in `looks` (`designs.ts`), `Look`-Typ, Name in `lookNames` (`SettingsDialog.tsx`), Vorlagenkarte nur falls gewünscht (`presets`); CSS mit einem Block `:root[data-look='neu'] { Schrift, Palette, Popup-Maße }` und Regeln für die gewöhnlichen Teile (Vorbild: `entryIcons.css` für ein vollständiges Beispiel mit allen Optiken und Pixel); `popupStyles` (Varianten und Beispielbilder in `settings.css`); `takesPixel`/`hasFixedPalette` anpassen.

**Aufbau:** Id in `layouts`, Name in `layoutNames`, in `main.tsx` als weiterer Zweig neben `bookMode`/`nebulaMode` rendern (`settings.layout === 'neu'`), CSS unter `:root[data-layout='neu']`; was er an Variablen braucht, beidseitig definieren (siehe oben). Danach den Bereich `combos` in `scripts/verify-ui.mjs` um ihn erweitern (alle Paare werden geladen und geprüft).

**Popup-Variante:** `PopupStyle` und `popupStyles` je Optik, Regeln in `popup-styles.css`/`popup-chrome.css`/`popup-fields.css` unter `[data-look='…'][data-popups='…']`.

## Stufe 2: Was bei den Mischungen noch zu tun ist

Stufe 1 (erledigt) trennt die Achsen: Alle neun Paare laden, sind bedienbar und werden von `combos` geprüft. Die Vorlagen sehen unverändert aus. Offen ist das gestalterische Fertigstellen der sechs Mischungen:

1. **Aufbau-eigene Komponenten sind an ihre Vorlage gebunden.** Das Buch (Seiten, Register, Leseband, Kalenderblatt) und der Desk (Poster, Terminal-Fenster, Tickets, Fensterleiste) zeichnen ihre Farben, Rahmen und Schrift selbst; mit einer anderen Optik behalten sie ihr Vorlagen-Aussehen. Ziel: diese Teile lesen Optik-Variablen (Papier-/Fensterfläche, Rahmen, Schrift, Ecken, Schatten) statt feste Werte, und jede Optik liefert sie: Buch in Nebula-Optik (dunkle Seiten, Monoschrift, eckig, violette Akzente), Desk in Journal-Optik (Karteikarten statt Terminal-Fenster, Tinte, Papier), Desk in Normal-Optik (helle/graue Flächen, Plex Sans), Buch in Normal-Optik (schlichte Seiten).
2. **Palette je Kombination.** Nebula-Optik erzwingt ihre dunkle Palette in jedem Aufbau (auch im Buch: Einband `--cover` schwarz); Journal-Optik bringt Papier-Palette – prüfen, ob der Desk mit heller Palette lesbar ist (`--nb-*` sind feste dunkle Werte), und Einstellung der Farben für die Mischungen sinnvoll sperren oder öffnen.
3. **Suche und Texte hängen am Aufbau.** `SearchVariant` (`'classic' | 'journal' | 'nebula'`) und ihre Texte („grep …“, Register-Karteikarte) richten sich nach dem Aufbau, gehören aber zur Optik (Grep-Stil, Karteikarten-Stil). Entscheiden und trennen: Platz (Aufbau) und Stil (Optik).
4. **Popup-Varianten je Mischung prüfen** (`data-popups` bleibt je Optik): Planer, Eintragseditor und Auswahlen im Buch mit Nebula-Optik usw. – Screenshots mit `popups` und `combos`.
5. **Pixel-Look** nimmt Optik `classic` und `journal`; in Aufbau `desk` mit diesen Optiken prüfen (Pixel-Schrift in Fenstern), Größen in `pixel-sizes.css` und `scripts/pixel-sizes.mjs` (liest noch das alte `data-theme='pixel'`).
6. **Einstellungsdialog:** Vorlagenkarten zeigen nur die drei Vorlagen; für „Aufbau“ und „Optik“ eigene Vorschaubilder statt der Textschalter (`settings.css`, `theme-sample`); Hinweise, welche Einstellungen zu welchem Aufbau gehören (Buch-Ansicht nur im Buch).
7. **Desktop-Widgets** (eigene Fenster, glas-Optik `widgetGlass.css`) in allen drei Optiken prüfen (`desktopWidgets.css` ist Optik-CSS).
8. **Tests:** `combos` prüft Laden, Struktur und Einstellungen; ergänzen: je Mischung die Kernabläufe (Eintrag schreiben, Tag drehen, Popup öffnen) und Screenshot-Vergleich der Vorlagen gegen die Stände vor der Trennung.
9. **Reste:** Kommentare in den CSS-Dateien, die noch „Design“/„data-theme“ nennen; `index.html` und `scripts/nebula-holo.mjs` kennen die neuen Attribute (geändert), die Dokumente `journal-style.md`/`nebula-style.md` auf die Achsen verweisen.
