# Popup-Stile

Unter **Einstellungen → Darstellung → Popups** stehen zwei Varianten je Optik zur Wahl, bei der Journal-Optik vier (`popupVariants` in `src/designs.ts`; eine gespeicherte Variante, die die Optik nicht hat, fällt auf A zurück). Die zusätzliche Pixel-Option wirkt auf Normal und Journal. Inhalte und Funktionen bleiben gleich; verbundene Fenster übernehmen den Stilwechsel.

| Optik | Variante A | Variante B | Variante C | Variante D |
| --- | --- | --- | --- | --- |
| Normal | Karte | Glas mit durchscheinender Fläche und Unschärfe | – | – |
| Journal | Karteikarte mit Papier-/Tintenregeln | Sticker: ausgeschnitten, weißer Rand, Tintenlinie; Aktionen als Gitter kleiner Icon-Sticker | Sticker-Bogen: Papierbogen mit Körnung, jede Aktion ein eigener leicht gedrehter Sticker („Wort klein-Zusatz“), Gruppen durch Schnittlinien getrennt | Papierschnipsel: gerissene Kante, Washi-Tape, handgeschriebene Liste mit Tintenkringel als Auswahl |
| Nebula | Terminal mit Prompt-Leiste | Holo-Papier mit violettem Titelbalken | – | – |

Der frühere Notizblock (Journal · B) ist durch den Sticker ersetzt.

Der Stil gilt für Planen/Uhr/Wiederholung, neue und bearbeitete Kalendereinträge sowie Auswahlkarten, Tags, Farben und Kontextmenüs. Mail-Detailkarten verwenden denselben Rahmen, behalten aber die originale Darstellung innerhalb der [Mailvorschau](mail-display-and-delivery.md).

## Schließen und Eingaben

- Escape beziehungsweise × schließt die aktive Ebene. Ein Klick innerhalb des Popups aktiviert nicht den Kalendereintrag dahinter.
- Ein Klick außerhalb schließt zunächst nur die oberste Popup-Ebene; derselbe Klick öffnet keinen darunterliegenden Kalendertag und startet keine weitere Aktion.
- Verschachtelte Auswahlfenster bleiben eigene Ebenen, etwa ein Tagpicker im Editor. Nach ihrem Schließen bleibt der übergeordnete Editor erhalten.
- Die Eingabe in Wiederholungsfeldern ist dauerhaft dezent erkennbar. Beim Schreiben treten darunterliegende Inhalte zurück; Vorschläge können mit Pfeilen gewählt und mit Tab/Enter übernommen werden.

Auf dem Desktop werden Orbit und eingebettete Eintragsaktionen angeboten. `swipe` ist als Implementierung für Touch-/Android-Kontexte vorhanden, aber im normalen Desktop-Menü ausgeblendet. Daraus folgt noch keine fertig gebaute Android-App.

Implementierung: `src/popup-styles.css` (Rahmen), `src/popup-chrome.css` und `src/components/PopupChrome.tsx` (Kopf, Reiter, Knöpfe), `src/popup-fields.css` (Felder), `src/popup-sheets.css` und `src/components/ActionSheet.tsx` (Eintragsaktionen), `src/components/ContextMenu.tsx` und `contextMenu.css`, `src/popupLook.ts`, Vorschaubilder in `src/settings.css`, `src/components/Popover.tsx`, `src/components/useDismissLayer.ts`. Browserbereiche: `popups`, `looks`, `popup-dismissal`, `context-menus`, `journal-sticker`, `mail-header-themes`; siehe [Entwicklung](development.md).
