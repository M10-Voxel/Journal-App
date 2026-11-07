# Popup-Stile

Unter **Einstellungen → Darstellung → Popups** stehen zwei Varianten je Basisdesign zur Wahl. Die zusätzliche Pixel-Option wirkt auf Normal und Journal. Inhalte und Funktionen bleiben gleich; verbundene Fenster übernehmen den Stilwechsel.

| Design | Variante A | Variante B |
| --- | --- | --- |
| Normal | Karte | Glas mit durchscheinender Fläche und Unschärfe |
| Journal | Karteikarte mit Papier-/Tintenregeln | Notizblock mit Bindung und Textmarker |
| Nebula | Terminal mit Prompt-Leiste | Holo-Papier mit violettem Titelbalken |

Der Stil gilt für Planen/Uhr/Wiederholung, neue und bearbeitete Kalendereinträge sowie Auswahlkarten, Tags, Farben und Kontextmenüs. Mail-Detailkarten verwenden denselben Rahmen, behalten aber die originale Darstellung innerhalb der [Mailvorschau](mail-display-and-delivery.md).

## Schließen und Eingaben

- Escape beziehungsweise × schließt die aktive Ebene. Ein Klick innerhalb des Popups aktiviert nicht den Kalendereintrag dahinter.
- Ein Klick außerhalb schließt zunächst nur die oberste Popup-Ebene; derselbe Klick öffnet keinen darunterliegenden Kalendertag und startet keine weitere Aktion.
- Verschachtelte Auswahlfenster bleiben eigene Ebenen, etwa ein Tagpicker im Editor. Nach ihrem Schließen bleibt der übergeordnete Editor erhalten.
- Die Eingabe in Wiederholungsfeldern ist dauerhaft dezent erkennbar. Beim Schreiben treten darunterliegende Inhalte zurück; Vorschläge können mit Pfeilen gewählt und mit Tab/Enter übernommen werden.

Auf dem Desktop werden Orbit und eingebettete Eintragsaktionen angeboten. `swipe` ist als Implementierung für Touch-/Android-Kontexte vorhanden, aber im normalen Desktop-Menü ausgeblendet. Daraus folgt noch keine fertig gebaute Android-App.

Implementierung: `src/popup-styles.css`, `src/popup-chrome.css`, `src/components/Popover.tsx`, `src/components/ContextMenu.tsx`, `src/components/useDismissLayer.ts`. Browserbereiche: `popups`, `popup-dismissal`, `context-menus`, `mail-header-themes`; siehe [Entwicklung](development.md).
