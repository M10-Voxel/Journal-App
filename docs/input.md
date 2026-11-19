# Eintragen und Nachsehen

Links oben die **Suchleiste**, darunter (wenn offen) das **Eintragsformular**; rechts der **Kalender**, der zugleich die Vorschau ist: Was im Formular steht, erscheint dort sofort, ohne dass man etwas bestätigen muss. Deutsch und Englisch funktionieren unabhängig von der Oberflächensprache.

```
 Journal durchsuchen · / für Befehle
 ─────────────────────────────────────────────
  ▢ Kalender  [▢ Ereignis]  ☑ Aufgabe  ▤ Notiz        Alt+1–4
 T  Titel         Zahnarzt▏
 ◷  Wann          Do 19.11.2026 · morgen   14:30 – 15:45
 ⟳  Wiederholung  Wöchentlich am Mo, Do
 ⌂  Tag           ● Gesundheit
 …  Mehr          ··· Mehr: Beschreibung, Wichtig, Erinnerung, Symbol
```

## Die Grundregel

- **Tab** geht immer ins nächste Feld, **Shift+Tab** ins vorige. **↑/↓** wechseln die Zeile.
- **Enter** öffnet die **Optionen** des Felds: beim Datum den Kalender, bei Start und Ende die Uhr, bei Wiederholung, Tag, Erinnerung und Symbol ihre Auswahl unter der Zeile. In den Optionen bewegen **alle Pfeile**. **Enter** übernimmt und geht ins nächste Feld, **Esc** bricht ab und bleibt im Feld (der Wert von vorher kommt zurück).
- Felder ohne Optionen (Titel, Beschreibung, Typ, Wichtig): Enter geht ins nächste Feld. „Mehr“: Enter klappt auf und geht hinein.
- Tippen geht in jedem Textfeld direkt, ohne Optionen.
- **Shift+Enter** erstellt den Eintrag und lässt das Formular offen, **Strg+Enter** erstellt und schließt, auch aus den Optionen heraus. **Enter allein erstellt nie.**

## Der kurze Weg

1. `/Entry` in der Suchleiste (oder im Kalender rechts klicken bzw. ziehen) öffnet das Formular, der Cursor steht im Titel.
2. Titel schreiben, mit Tab durch die Felder, Strg+Enter.

## Die vier Typen

Wie in der App: **Kalender** (Termin nur im Kalender), **Ereignis** (Termin, auch im Journal), **Aufgabe**, **Notiz**. Alt+1 bis Alt+4 aus jedem Feld, ←/→ in der Typ-Zeile, oder ein Klick. Ohne Wahl ist ein geschriebener Eintrag eine Aufgabe; mit Uhrzeit ohne Typwort oder im Kalender angelegt ein Kalendereintrag.

## Schnell in einem Zug

Im Titel dürfen Datum, Uhrzeit, Typ, Tag und Wiederholung mitgeschrieben werden: `Zahnarzt Do 14 \Gesundheit`, `task "Bericht schreiben" morgen`, `Sport jeden Mo bis 7.12.`. Beim Verlassen des Titels wandern die erkannten Wörter in ihre Felder. Anführungszeichen schützen Wörter (`"Montag um 14 besprechen"`).

## Wann: Datum │ Start – Ende

- **Datum tippen:** `morgen`, `Mi`, `19.11.`. Ein **Bereich** (`23.11.–27.11.`, `Mo–Fr`, `von Mo bis Fr`) ist **immer ein Eintrag über alle Tage** (mehrtägig); Wiederholungen gehören in die Wiederholung. **Mit Komma** getrennte Tage (`19.11., 26.11.`) sind **einzelne Einträge**. Leer heißt heute.
- **Start:** `14`, `1430`, `14:30`, `2pm`, auch die Spanne `14-15:30`. Leer heißt ganztägig.
- **Ende:** `15:30` oder eine Länge `+45`, `+1,5h`. **Leer heißt Zeitpunkt.** Liegt das Ende an einem späteren Tag, steht „(+1 Tag)“ dabei.

### Datum im Kalender wählen (Enter auf dem Datum, oder F6)

Der Kalender rechts bekommt die Tastatur (blauer Rahmen, Cursor). Was gewählt ist, steht sofort im Formular.

| Taste | Ganze Tage (Seitenspalte) | Stunden (24-h-Spalte) |
|---|---|---|
| Tab | zu den Stunden | zu den ganzen Tagen |
| ↑ / ↓ | Tag davor / danach | Tag davor / danach (Uhrzeit bleibt) |
| ← / → | Woche zurück / vor | Stunde früher / später (Strg: Viertelstunde) |
| Shift + Pfeile | Bereich ab da, wo Shift gedrückt wurde: **mehrtägiger Eintrag** | Zeitraum ab da, wo Shift gedrückt wurde, **auch über mehrere Tage**, so wie er im Kalender steht |
| PgUp / PgDn · Pos1/H | Monat · heute | Monat · heute |
| Enter | übernehmen: ohne Bereich **der Tag** | übernehmen: ohne Bereich **der Zeitpunkt** |
| Esc | erst den Bereich weg, dann zurück zum Datum ohne Änderung | ebenso |

Nach Enter geht es links ins nächste Feld.

### Uhrzeit visuell (Enter auf Start oder Ende)

Große Stunden : Minuten. **←/→** wählt Stunden oder Minuten, **↑/↓** ändert um 1, mit **Strg** die Stunden um 4 und die Minuten um 15. Ziffern tippen die Zeit (`1430`). Entf leert (beim Ende: Zeitpunkt). Beim Ende steht die Dauer dabei. Wird der Start verschoben, wandert das Ende mit.

## Die Wiederholung (Enter auf Wiederholung)

```
 ⟳ Rhythmus   [Einmalig] [Täglich] [Werktags] [Wöchentlich]
              [Zweiwöchentlich] [Monatlich] [Jährlich]
 ▦ Einheit    [Tag] [Woche] [Monat] [Jahr]
 #  Alle      [1] Woche
 ▦ Am         (Mo) (Di) (Mi) (Do) (Fr) (Sa) (So)
 ▦ Ab         [Do 19.11.2026]
 ⚑ Bis        [nie] [10] mal [19.12.2026]
 ‖ Pause      (aus)
 ▦ Nur in     (Jan) … (Jun)
              (Jul) … (Dez)
```

- **↑/↓** gehen zwischen den Zeilen, **←/→** innerhalb einer Zeile.
- In Zeilen mit **einer Wahl aus mehreren** (Rhythmus, Einheit, Muster, Bis) wird gewählt, worauf man sich bewegt.
- Wochentage, Monate und die Pause schaltet die **Leertaste** (Wochentage auch **1–7**).
- **Zahlen** (Abstand, Anzahl, Pause) werden getippt, **Shift+↑/↓** zählt.
- **Daten** (Ab, Bis-Datum): **Shift+←/→** einen Tag, **Shift+↑/↓** eine Woche.
- **Entf** setzt die Zeile zurück (im Rhythmus: einmalig).
- Pause und „Nur in“ erscheinen nur, wo sie zur Einheit passen.
- Jede Änderung erscheint sofort im Kalender.
- **Enter** übernimmt und geht weiter, **Esc** stellt die Regel von vorher wieder her.
- Man kann die Wiederholung auch weiterhin ins Feld schreiben (`alle 2 Wochen am Mo, Do bis 4.12.`).

## Tag, Erinnerung, Symbol (Enter öffnet die Auswahl)

- **Tag:** Liste aller Tags mit ihren Farben; ↑/↓ wählen, Tippen filtert, Klick wählt. Im Formular steht der Tag mit Farbpunkt.
- **Erinnerung:** Raster mit Vorlagen (Keine, Zur Uhrzeit, 5/10/15/30 Min., 1/2 Std., 1/2 Tage, 1 Woche), Pfeile in alle Richtungen. **Eigene Werte werden getippt:** `45`, `2 h`, `1h30`, `3 Tage`, höchstens 30 Tage.
- **Symbol:** Raster mit dem Lucide-Satz der App, Pfeile in alle Richtungen, Tippen sucht nach Namen (`bell`, `grad cap`), der Name des gewählten steht darunter.
- **Mehr** (Beschreibung, Wichtig, Erinnerung, Symbol) klappt mit Enter auf und bleibt offen, sobald eines davon gefüllt ist.

Ein Fehler steht rot direkt am betroffenen Feld, darunter in einer Zeile erklärt. Ein fehlender Titel wird erst nach dem Versuch zu erstellen genannt.

## Weitere Tasten

| Taste | Wirkung |
|---|---|
| Alt+1 … 4 | Typ Kalender / Ereignis / Aufgabe / Notiz |
| Strg+Z / Strg+Y | letzten Eintrag zurücknehmen / wiederherstellen |
| Strg+Q | J-TerminaL beenden |
| Esc (ohne Optionen) | Feld zurücksetzen; dann Formular schließen (Entwurf verworfen); in der Suchleiste leeren, dann Fenster verstecken |

**F1** (Standard) oder das Zahnrad neben der Suche öffnet die Tastenkürzel-Übersicht. Tippen durchsucht alle Bereiche. Ohne Suchbegriff wechseln **↑/↓** den Bereich, **Bild↑/Bild↓** blättert, **Esc** schließt die Einstellungen.

Klicke zum Ändern auf ein bearbeitbares Kürzel. Per Tastatur wechselst du mit **Tab** zu den Kürzeln, wählst mit **↑/↓** eine Aktion und drückst **Enter**. Drücke die neue Kombination oder verwirf die Aufnahme mit **Esc**. Der Rücksetzpfeil oder **Entf** auf dem ausgewählten Kürzel stellt die Standardbelegung wieder her.

Änderungen gelten sofort und werden lokal für J-TerminaL gespeichert. Das gilt auch für das globale Kürzel zum Ein- und Ausblenden. Eine Kombination kann in verschiedenen Bereichen unterschiedliche Aktionen auslösen. Grundtasten für Navigation und Texteingabe bleiben fest belegt.

## Die Suchleiste (links oben)

Beim Öffnen hat die **Suchleiste** die Tastatur; darunter steht die **Tagesansicht** (siehe unten). Mit `/` beginnen Befehle, sie erscheinen beim Tippen darunter (↑/↓ wählen, Tab vervollständigt, Enter führt aus):

| Befehl | Wirkung |
|---|---|
| `/Entry` (auch `/Eintrag`) | öffnet das Eintragsformular unter der Leiste, Cursor im Titel |

Esc leert die Leiste, ein weiteres Esc versteckt das Fenster. Im Formular nimmt Esc erst die Änderung der Zeile zurück, dann schließt es das Formular (der Entwurf wird verworfen) und die Suchleiste hat wieder die Tastatur. Wird im Kalender etwas markiert, öffnet sich das Formular von selbst. Die Suche im Journal folgt (siehe `docs/roadmap.md`).

## Die Tagesansicht (links, solange kein Formular offen ist)

Unter der Suchleiste steht der gewählte Tag, standardmäßig **heute**. Man kann darin arbeiten wie auf der Tagesseite der App:

```
 Mittwoch, 18. November 2026                    ⊞ ⊞ ▤  ( Heute )
 Gib deinem Tag einen Namen …
 ▢ Termine 1
 ▢ Sport                                      ( 18:00–19:00 )
 ☑ Aufgaben 2 offen · 1 erledigt
 ☐ Brot kaufen                                  ( → Do 19.11. )
 ☑ Post
 ☐ Recherche                                              ▣
 ◔ Werte
   (7)   (3)
   Bewertung  Stress
 ∿ Aktivitäten 1 / 2
 ○ Laufen                                                  ▷
 ✓ Lesen                                  45 Min.  00:12:04  ‖ ■
```

- **Titel des Tages**, **Termine**, **Aufgaben** und **Notizen** in der Reihenfolge des Tages (wie in der App: nach Typ, Tag und Wichtigkeit). Einträge „nur im Kalender“ stehen nur im Kalender. Mehrtägige Einträge stehen an jedem Tag, den sie abdecken; geändert werden sie an ihrem ersten Tag.
- Geplante Einträge bleiben als Spur stehen, ihr Chip nennt das Ziel („→ Do 19.11.“, „→ 3 Tage“).
- **Werte:** Tagesbewertung und aktive eigene Skalen als **runde Regler** mit Wert und Namen, jeweils mit ihrer Spanne.
- **Aktivitäten:** abgehakt oder mit Minuten in ihrer Farbe, dazu ihr **Timer**. Die Timer sind dieselben wie in der App (gemeinsam in der Datenbank). Timer anderer Tage stehen oben, solange sie existieren.
- Rechts neben dem Datum: drei kleine Symbole für neue Termine, Aufgaben und Notizen, und wie weit der Tag von heute entfernt ist.

**Tastatur**

| Taste | Wirkung |
|---|---|
| ↓ (oder Tab) in der Suchleiste | in den Tag; ↑ in der ersten Zeile zurück |
| ↑ / ↓ | Zeile wählen (jeder Regler ist eine eigene Zeile) |
| Enter | Titel oder Eintrag schreiben; beim Schreiben: übernehmen und nächster Eintrag gleicher Art (Strg+Enter ohne Tag) |
| Esc | Schreiben beenden (der Text bleibt), dann zurück zur Suchleiste |
| Backspace im leeren Eintrag | Eintrag löschen |
| Alt+A / Alt+E / Alt+N | neue Aufgabe / neues Ereignis / neue Notiz (hinter dem gewählten Eintrag) |
| Alt+D / Alt+X / Leertaste | erledigt / abgebrochen / erledigt umschalten |
| Alt+P | wichtig |
| Alt+M | auf morgen (Aufgaben) |
| Alt+T / Alt+Shift+T | planen auf einen Tag / auf mehrere Tage (Monat im Seitenfenster); auf einer Spur: zum Ziel |
| Alt+U / Alt+R / Alt+G / Alt+I / Alt+B | Uhrzeit / Erinnerung / Tag / Symbol / Beschreibung (im Seitenfenster) |
| Alt+Shift+E / A / N | als Ereignis / Aufgabe / Notiz |
| Alt+↑ / Alt+↓ | verschieben (innerhalb der Gruppe) |
| Entf oder Alt+Entf | löschen |
| Alt+Enter | Einstellungen des Eintrags im Seitenfenster |
| Regler: ←/→, Ziffern, Entf | einen Schritt, Wert tippen, Wert entfernen |
| Aktivität: Leertaste, Ziffern+Enter, Enter, Shift+Enter | abhaken, Minuten eintragen, Timer starten/pausieren, Timer stoppen (Zeit in den Kalender) |
| Alt+← / Alt+→ / Alt+H | anderer Tag / heute |

**Maus:** Ein Klick auf den Text schreibt darin, ein Klick auf das Symbol öffnet die Einstellungen. Regler stellt man per Klick oder Ziehen auf dem Ring (die Stelle bestimmt den Wert) oder mit dem Mausrad. Aktivitäten hakt man mit einem Klick auf den Kreis ab. ▷/‖ starten und pausieren den Timer, ■ stoppt ihn. Die drei Symbole neben dem Datum legen neue Einträge an, ein Klick auf das Datum führt zurück zu heute. Ein Mittelklick im Kalender zeigt den Tag.

### Das Seitenfenster (fährt links aus dem Fenster)

Ein Klick auf das Symbol eines Eintrags (oder Alt+Enter) öffnet links ein schmales Fenster. Das Hauptfenster bleibt dabei an seiner Stelle, es wird nach links breiter. Darin stehen die Einstellungen des Eintrags, je eine Zeile:
- Status, Typ, Wichtig, Tag, Uhrzeit, Erinnerung, Symbol, Beschreibung
- auf morgen, Planen, Mehrere Tage, Löschen
- bei einer Spur: zum geplanten Tag

↑/↓ wählt, ←/→ ändert Status/Typ/Wichtig, Enter oder ein Klick öffnet bzw. führt aus. Die Auswahl öffnet sich im selben Bereich:
- **Planen:** ein Monat. Pfeile wählen den Tag, Bild↑/↓ den Monat, H springt zu heute. Enter oder ein zweiter Klick plant. Bei mehreren Tagen sammelt Leertaste oder Klick die Tage, Enter plant.
- **Uhrzeit:** große Uhr. ↑/↓ und das Mausrad ändern den Wert, ←/→ wechselt zwischen Stunden und Minuten, Ziffern tippen die Zeit, Entf entfernt sie. Die Dauer bleibt erhalten.
- **Tag, Erinnerung:** Listen (beim Tag direkt per Ziffer 0–9).
- **Symbol:** Raster mit Suche beim Tippen.
- **Beschreibung:** Textfeld, Esc speichert.

Esc geht eine Ebene zurück, auf den Einstellungen schließt es das Fenster.

Jede Änderung wird sofort über `journal-core` gespeichert und landet in der gemeinsamen Historie (Strg+Z). Ein geöffnetes Formular nutzt denselben Platz. Nach dem Schließen kommt die Tagesansicht mit dem zuletzt gewählten Tag zurück; ein neues Öffnen des Fensters zeigt wieder heute.

## Der Kalender (rechts, immer sichtbar)

Rechts steht der Kalender als **Zeitgewebe**. Er ist endlos: Man kann beliebig weit vor und zurück scrollen, die Einträge werden nachgeladen. **Der Eintrag, der gerade entsteht, erscheint live** an seinem Platz (mit heller Kontur).

- **Jeder Tag ist ein Band über die 24 Stunden** (Uhrzeiten oben in der Kopfzeile, Linien an jeder Marke). Einträge liegen als Zeitstücke an ihrer Uhrzeit, so lang wie sie dauern, in der Farbe ihres Tags. Ohne Ende zeigt eine dicke Linie den genauen Zeitpunkt; daneben steht ein schmaler Titel-/Symbolbalken. Gleichzeitige Einträge und überlappende Beschriftungen bekommen eigene Reihen.
- **Einträge ohne Uhrzeit** stehen nicht in den 24 Stunden, sondern in der Seitenspalte neben dem Datum: zugeklappt als Punkt in der Farbe ihres Tags, aufgeklappt als Zeile mit Titel unter dem Datum.
- **Zugeklappte Tage** zeigen den Titel, solange nur eine Reihe nötig ist, sonst schmale Striche. **Aufgeklappte Tage** zeigen bei jedem Eintrag Titel und Uhrzeit.
- **Mehrtägige Einträge** laufen links als farbige Spur durch alle ihre Tage, der Titel gedreht (von oben nach unten zu lesen). Mit Uhrzeit bekommt nur der erste Tag zusätzlich sein Zeitstück, der letzte nicht.
- **Im Stundenraster gezogene Spannen** bleiben dagegen in den Stundenbändern: Mi 14 Uhr bis Fr 16 Uhr ergibt Mi 14–24, Do 0–24 und Fr 0–16 Uhr. Diese Darstellung bleibt nach Speichern und erneutem Öffnen erhalten. Links oder durch Eingabe in die Felder angelegte mehrtägige Ereignisse behalten die seitliche Spur.
- **Wochen und Monate:** Zwischen Sonntag und Montag liegt eine farbige Wochenlinie, am Montag steht `KW 47`. Ein neuer Monat beginnt mit einer Kopfzeile; die Monate sind abwechselnd leicht getönt, der aktuelle Monat steht oben. Die rote Linie ist jetzt.

**Maus** (wie im Kalender der App, nur dass statt eines Popups das Formular gefüllt wird):

| Aktion | Wirkung |
|---|---|
| Linksklick auf einen Tag oder einen Eintrag darin | Tag aufklappen, nochmal: zuklappen (Details eines Eintrags folgen) |
| Mittelklick auf einen Tag | diesen Tag links in der Tagesansicht zeigen |
| Shift+Linksklick | alle Tage bis zum zuletzt geklickten aufklappen |
| Rechtsklick in der Seitenspalte eines Tags | ganztägiger Eintrag an diesem Tag |
| Rechts ziehen in der Seitenspalte über mehrere Tage | mehrtägiger Eintrag (durchgehend) |
| Rechts ziehen in den 24 h | Tag und Uhrzeit, in Viertelstunden; auch über Mitternacht und mehrere Tage |
| Mausrad | Tage scrollen |
| Strg+Mausrad | Tage höher oder flacher (ganzer Kalender) |
| Strg+Shift+Mausrad | in die 24 Stunden hinein- oder herauszoomen (um die Stelle unter der Maus) |
| Shift+Mausrad | die gezoomten Stunden nach links oder rechts verschieben |

Nach dem Loslassen stehen Datum und Zeit im Formular, der Cursor springt in den Titel, falls er noch leer ist. Ohne bewusst gewählten Typ wird der Eintrag wie in der App ein Termin „nur im Kalender“.

**Tastatur:** siehe „Datum im Kalender wählen“ oben (Enter auf dem Datum oder `F6`).

## Noch nicht im Formular

Bestehende Einträge suchen und bearbeiten (auch per Linksklick im Kalender) sowie Wiederholung im Seitenfenster folgen als eigene Stufen (siehe `docs/roadmap.md`).

## Notizblock

**Strg+Umschalt+N** in J-TerminaL, **/Notizblock** (englisch **/Notepad**) und das Journal-Symbol neben der Suchleiste öffnen die Zettelliste. **Alt+←/→** oder die Auswahl über der Liste wechselt zwischen allen Zetteln und dem gewählten Tag. **↑/↓** und **Enter** öffnen einen Zettel in der Leseansicht.

- **Neue Notiz** oder **Strg+N** legt einen Entwurf für den gewählten Tag an. **Bearbeiten** oder **F2** öffnet bei einem bestehenden Zettel den Editor. **Speichern** oder **Strg+Enter** speichert und zeigt den formatierten Zettel an. Neue Zettel erscheinen im Notizen-Tab der Haupt-App und auf der Tagespinnwand.
- **Enter** setzt Aufzählungen und nummerierte Listen fort. Ein neues Checklistenelement beginnt leer und unabgehakt. **Enter** auf einem leeren Listenpunkt beendet die Liste auf dieser Ebene. **Tab** und **Umschalt+Tab** rücken Zeilen ein und aus. **Strg+Tab** wechselt zwischen Titel und Text.
- **Strg+T** öffnet beim Bearbeiten die Tag-Auswahl, **Strg+M** die Markdown-Vorschau. In Leseansicht und Vorschau wählen **↑/↓** eine Zeile und **←/→** einen Link aus. **Enter** oder ein Klick schaltet Checklisten um, folgt Links oder kopiert Code. In der Leseansicht werden geänderte Checklisten sofort gespeichert.
- **Strg+L** zeigt die Anhänge. Beim Bearbeiten kannst du einen Link eingeben und mit **Enter** hinzufügen oder mit **Strg+I** ein Bild anhängen (PNG, JPEG oder WebP). Bilder erscheinen unter dem formatierten Text. Klick oder **Enter** auf ein ausgewähltes Bild öffnet es groß im Notizblock.
- **Zurück** oder **Esc** kehrt zur vorherigen Ansicht zurück. Bei einem geänderten Entwurf bestätigt ein zweites Zurück oder Esc das Verwerfen. **Esc** in der Zettelliste schließt den Notizblock.
