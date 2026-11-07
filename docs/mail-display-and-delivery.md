# Mailvorschau und Lieferzeiträume

## Gespeicherter Mailinhalt

Neue Mailimporte speichern in der Eintragsbeschreibung einen versionierten Umschlag mit HTML, Textalternative, Betreff, Absender und gegebenenfalls Hinweisen aus Kalenderanhängen (`journal-mail:v1`). HTML ist auf 180.000 und die Textalternative auf 100.000 Zeichen begrenzt. Dies ist eine Kalenderbeschreibung, kein vollständiges Mailarchiv.

Der Inhalt nimmt am normalen Drive-Abgleich und an der lokalen Inhaltshistorie teil. Alte Einträge mit ausschließlich gewöhnlichem Beschreibungstext können ihr ursprüngliches HTML nicht nachträglich rekonstruieren. Ein erneuter Mailimport kann eine Beschreibung mit gespeicherten Originaldaten liefern.

## Darstellung und externe Inhalte

Detailkarte und Kalendereditor zeigen HTML in einem `iframe` mit leerem Sandbox-Rechteumfang. Skripte, eingebettete Frames, aktive Elemente, Event-Handler, Formulare und Navigationslinks werden entfernt beziehungsweise blockiert. Externe Ressourcen sind standardmäßig gesperrt. Über **Externe Bilder und Styles laden** können HTTPS-Bilder, Stylesheets und Schriften für die geöffnete Vorschau zugelassen und wieder ausgeblendet werden. Das kontaktiert die externen Server.

Inline-CSS und eingebettete Styles bleiben erhalten; Nonce und CSP berücksichtigen die zusätzliche Tauri-Sicherheitsrichtlinie. Die Mailfläche behält das Layout und die Farben der Nachricht, der umgebende Kopf und die Aktionen folgen dem gewählten App-/Popupstil. Titel, Datum, Zeitspanne, Tag und Absender stehen gemeinsam im Kopf. Ein identischer Titel/Betreff erscheint nur einmal, ein abweichender Originalbetreff zusätzlich.

Reine Textmails werden als Text angezeigt. `cid:`-Bilder aus eingebetteten Mailanhängen werden derzeit nicht bereitgestellt. PDF-Auswertung und OCR sind nicht implementiert. Der ICS-Export verwendet die Textalternative. Der Schließen-Knopf beendet die Vorschau; ein Klick daneben schließt sie und aktiviert nicht zugleich den darunterliegenden Kalendertag.

## Lieferzeiträume in Werktagen

Ausdrücke wie `1 bis 2 Werktage`, `1–2 Werktagen` oder `1 to 2 business days` ergänzen die lokale ML-Erkennung durch Datumsarithmetik. Der eigene Satz muss eine Lieferung beschreiben; allgemeine Support-Bearbeitungszeiten und Rückgabe-/Erstattungskontexte genügen nicht.

Gezählt wird ab dem Tag nach dem Versanddatum der Mail in der lokalen Gerätezeitzone. Implementiert ist **Montag bis Freitag ohne regionale Feiertage**. Der früheste bis späteste Zustelltag wird als durchgehender mehrtägiger Bereich gespeichert; bei einem einzigen Zieltag bleibt es ein Eintrag ohne Uhrzeit. Strukturierte JSON-LD-Lieferangaben behalten ebenfalls eine Spanne über mehrere Daten.

Mehrtägige Mailtermine werden wie andere [Kalendereinträge](multiday-calendar.md) in Stunden-, Monats-, Jahres- und kompakten Monatsansichten dargestellt. Anzeigeprojektionen erzeugen keine zusätzlichen Datensätze; Bearbeiten oder Löschen einer Fortsetzung bezieht sich auf den Ursprungseintrag.

Implementierung: `src/mailContent.ts`, `src/components/MailContent.tsx`, `src/components/mailDetails.css`, `src/mail.ts`. Browserprüfungen: `mail-header-themes`, `mail-view-zoom`, `popup-dismissal`.
