# E-Mail-Konten und Kalenderimport

Unter **Einstellungen → E-Mail-Konten → Konto hinzufügen** einen Anbieter wählen. Unterstützt werden mehrere Konten gleichzeitig:

| Verbindung | Anmeldung |
| --- | --- |
| Google / Gmail API | Browseranmeldung mit OAuth und PKCE |
| Outlook / Microsoft 365 / Exchange Online | Microsoft Graph, Browseranmeldung mit OAuth und PKCE |
| IMAP | Passwort oder App-Passwort, SSL/TLS oder STARTTLS, frei wählbarer Ordner |
| POP3 | Passwort oder App-Passwort, SSL/TLS oder STARTTLS |
| Proton Mail | Lokale Proton Mail Bridge, bezahlter Proton-Tarif erforderlich |

Voreinstellungen gibt es außerdem für iCloud, GMX und WEB.DE. Für weitere Anbieter können Server, Port und Benutzername manuell angegeben werden. Serverabhängige Freischaltungen und Tarifvoraussetzungen gelten weiterhin. Exchange-Server vor Ort benötigen einen IMAP-/POP3-Zugang; Exchange ActiveSync und EWS sind nicht implementiert. Die App liest ausschließlich den Posteingang; ein SMTP-Zugang zum Senden ist nicht erforderlich.

## Browseranmeldung vorbereiten

Google und Microsoft benötigen eine App-Registrierung. Dieser Build enthält keine vorgegebenen OAuth-Client-IDs. Sie können pro Konto unter **Anmeldung konfigurieren** eingegeben werden. Ohne Registrierung ist eine Browseranmeldung nicht möglich. Für eine veröffentlichte Version sollten freigegebene Client-IDs des App-Herausgebers hinterlegt werden.

**Google:** Gmail API im Cloud-Projekt aktivieren, OAuth-Zugriff konfigurieren und einen Client vom Typ **Desktop-App** erstellen. Client-ID und gegebenenfalls das zugehörige Client-Secret eintragen. Verwendet wird `https://www.googleapis.com/auth/gmail.readonly`. Bei externen Apps im Testbetrieb das eigene Konto als Testnutzer hinzufügen; Refresh-Tokens können dann nach sieben Tagen ablaufen. Für eine Veröffentlichung die Google-Anforderungen an eingeschränkte Gmail-Berechtigungen prüfen.

**Microsoft:** App in Microsoft Entra registrieren, die gewünschten privaten und/oder Organisationskonten zulassen, als Desktop-App die Redirect-URI **`http://localhost:42813/`** konfigurieren. Delegierte Berechtigungen: `User.Read`, `Mail.Read`, `offline_access`. Kein Client-Secret anlegen: Journal ist ein öffentlicher Client und verwendet PKCE. Als Mandant dient standardmäßig `common`; möglich sind außerdem `consumers`, `organizations` oder die Verzeichnis-UUID. Organisationsrichtlinien können eine Administratorfreigabe verlangen.

Die Anmeldung öffnet den Systembrowser. Ein kurzzeitig gestarteter Listener auf `127.0.0.1:42813` nimmt ausschließlich die lokale OAuth-Antwort mit passendem Zustand entgegen. Der Port muss frei sein. Abbrechen ist über die Schaltfläche oder durch Schließen der Einstellungen möglich.

## Abruf und Terminerkennung

Nach dem Verbinden wird sofort abgerufen, danach alle fünf Minuten bei laufender App, auch im Tray. Nach vollständigem Beenden läuft kein Abruf; der nächste Start holt innerhalb des eingestellten Zeitraums nach. Der Zeitraum liegt standardmäßig bei 14 Tagen und kann zwischen 1 und 90 Tagen eingestellt werden. Pro Abruf werden höchstens 50 neue Nachrichten verarbeitet. POP3 besitzt keine Datumssuche: dort werden die letzten 500 Nachrichten-IDs betrachtet. Weitere neue Nachrichten folgen beim nächsten Abruf oder über **Abrufen**.

Absenderfilter akzeptieren vollständige Adressen oder Domains mit `@`, durch Komma getrennt. Optional lässt sich zusätzlich nach einem Teil des Betreffs filtern. Diese Filter begrenzen die Auswertung in Journal, nicht die vom Mailanbieter erteilte Kontoberechtigung.

Die Auswertung ist lokal. ICS-Anhänge und JSON-LD-Maildaten vom Typ `ParcelDelivery` und `Event` werden direkt gelesen. Freie Mailtexte verwenden ein spezialisiertes, vortrainiertes ML-Modell für kontextbezogene Extraktion und Klassifikation:

- Unter **Einstellungen → E-Mail-Konten → Kontextbezogene Mailauswertung** einmalig **Modell herunterladen und aktivieren** wählen. Modell und Laufzeit benötigen ca. 1,3 GB Download; beim Laden entsteht zusätzlicher Arbeitsspeicherbedarf.
- Alternativ **Vorhandenen Modellordner verwenden** wählen. Für diesen Entwicklungsstand liegt ein bereits heruntergeladener Ordner unter `src-tauri/target/mail-ml-assets`. Der ausgewählte Ordner muss `fp32_25` und `microsoft.ml.onnxruntime.1.23.2.nupkg` enthalten. Die App überprüft die festgelegten Prüfsummen und kopiert die Dateien in ihren eigenen Datenordner.
- Das Modell erkennt Textstellen für Ereignisse, Datum, Uhrzeit und Ort sowie Hinweise auf Absagen oder Rückblicke. Es benötigt keine festgelegten Termin-Schlüsselwörter und kann Angaben über mehrere Zeilen verbinden.
- Die Normalisierung verbindet ausdrücklich geschriebene Zeitspannen wie „20:00 Uhr bis 20:15“ oder „20 bis 21:20“. Dafür wird ein Modelltreffer für eine Uhrzeit oder ein unmittelbar benachbarter, vom Modell erkannter Ereignis-/Datumskontext benötigt. Anfang und Ende werden gemeinsam als ein Vorschlag übernommen.
- Erst anschließend normalisiert `chrono-node` die vom Modell ausgewählten Angaben. „Morgen“ bezieht sich auf das Datum der Mail in der lokalen Zeitzone. Eine am 31.10.2026 eingegangene Mail „Treffen morgen 17 Uhr“ ergibt einen Vorschlag für **01.11.2026, 17:00**. Uhrzeiten und Datumswerte müssen konkret umrechenbar sein; „irgendwann nächste Woche“ legt keinen erfundenen Tag fest.
- Zitierte Antwortverläufe werden vor der Modellanalyse soweit erkennbar entfernt, damit alte relative Angaben nicht das Datum der neuen Mail erhalten.

Verwendet wird **GLiNER2.5 multilingual** als ONNX-Modell, ausschließlich für Mailtexte in einem eigenen lokalen CPU-Prozess. Journal, Daily Notes, Planung und normale Kalenderfunktionen verwenden dieses Modell nicht. Nach der Einrichtung benötigt die Analyse keine Internetverbindung und sendet keine Mailtexte an einen Analysedienst. Der Abruf beim jeweiligen Mailanbieter benötigt weiterhin eine Verbindung. Das Modell wird erst bei einer Mailanalyse geladen und nach einigen Minuten Inaktivität entladen. Deaktivieren pausiert freie Textanalysen und erhält die Nachrichten zur späteren Auswertung; ICS und strukturierte Termine funktionieren weiterhin.

Das Modell ist vortrainiert; es wurde nicht eigens mit privaten Mails trainiert und lernt nicht automatisch aus Übernahmen oder Korrekturen. Modellversion, Export und Laufzeit sind festgelegt und mit Prüfsummen versehen. Beim ersten Aktivieren dieser Erkennung können zuvor ergebnislose Nachrichten im Abrufzeitraum erneut geprüft werden. Bereits übernommene oder ignorierte Vorschläge bleiben erledigt.

Freier Text kann mehrdeutig sein. Das Modell kann Zusammenhänge übersehen, falsche Textstellen auswählen oder Absagen falsch einstufen. Seine Scores sind keine kalibrierten Wahrscheinlichkeiten. Eine vollständige Erkennung beliebiger Formulierungen ist nicht garantiert. PDF-Anhänge und Bilder/OCR werden nicht ausgewertet. Erkannte Absagen erscheinen als Hinweis und löschen keine Termine automatisch. Zu große oder nicht lesbare Nachrichten erscheinen in den Auswertungshinweisen. Die maximale Mailgröße beträgt 8 MB.

**Automatische Übernahme** gilt immer für alle erkannten Termine: ICS, strukturierte Angaben und freie Texttreffer des lokalen Modells. Eine Mail mit derselben Kalenderkennung aktualisiert den vorhandenen Eintrag, gegebenenfalls auf einen anderen Tag. Die Einträge erscheinen zunächst **nur im Kalender** und lassen sich dort bearbeiten oder entfernen. Nach erfolgreicher Speicherung zeigt ein Popup unten Titel, Datum und Uhrzeit an; es lässt sich schließen und verschwindet nach zwölf Sekunden. Es erscheint im Journal und in geöffneten Kalenderfenstern.

Kann eine Übernahme nicht gespeichert werden, bleibt sie unter **Ausstehende Übernahmen** erhalten und wird erneut versucht. Dort kann man sie auch bearbeiten, manuell übernehmen oder ignorieren. Entfernen eines Kontos löscht seine Zugangsdaten und ausstehenden Übernahmen; bereits gespeicherte Kalenderdaten bleiben erhalten. Beschreibungen aus ICS-Dateien werden getrennt vom Titel gespeichert und sind im Kalender bearbeitbar.

## Speicherung und Datenschutz

Kontometadaten, Nachrichtenkennungen und Vorschläge liegen in `mail.sqlite3` im gleichen lokalen Anwendungsdatenordner wie `journal.sqlite3`. Passwörter, Client-Secrets und OAuth-Tokens werden mit Windows-DPAPI für den angemeldeten Windows-Benutzer verschlüsselt gespeichert und nie über Lese-IPC an die Oberfläche zurückgegeben. Nach einer Übertragung auf einen anderen Windows-Benutzer oder Rechner ist eine erneute Anmeldung nötig.

Nur für die Auswertung ausgewählte Mailtexte werden vorübergehend lokal gespeichert. Nach der Erkennung wird der vollständige Mailinhalt entfernt; Vorschläge behalten Titel, Datumsangaben und einen begrenzten Belegausschnitt. HTML wird als Text behandelt und lädt keine externen Bilder oder Skripte. Ein Filter ist keine Absenderauthentifizierung: strukturierte Mailangaben sind weiterhin vom Absender gelieferte Daten.

IMAP verwendet `EXAMINE` und `BODY.PEEK[]`. POP3 verwendet keine Löschbefehle. Gmail und Microsoft benötigen nur Leserechte. Proton Bridge verwendet ein selbstsigniertes Zertifikat; diese Ausnahme ist ausschließlich für das Proton-Profil auf der Loopback-Adresse dieses Geräts zulässig.

## Prüfung

`npm test`: gespeicherte echte Modellvorhersagen, Datumsnormalisierung, strukturierte Terminerkennung, Quellenkennungen und Duplikate. `cargo test`: MIME-Auswertung, POP3-Zeichenkodierungen, Filter, Windows-DPAPI, Modellmanifest und erneute Prüfung früherer Nichttreffer sowie Kalender-/Speichertests. `node scripts/verify-ui.mjs`: Anbieterwahl, Formulare, Modellaktivierung/-pause, Vorschläge, Kalenderübernahme und Kontoentfernung mit synthetischen IPC-Mocks.

`node scripts/verify-mail-ml.mjs [App-EXE] [Modellordner]` startet den tatsächlichen isolierten Modellprozess, prüft zwanzig synthetische deutsche Beispiele und schreibt `src-tauri/target/mail-ml-live-report.json`. Standardmäßig werden Debug-EXE und der oben genannte Modellordner verwendet. Geprüft werden unter anderem „Treffen morgen 17 Uhr“, Angaben ohne Termin-Schlüsselwort, mehrere Zeilen, Lieferzeitfenster, Alternativen, zwei Ereignisse, Absage, Rückblick und zitierte Mailverläufe. Das ist ein begrenzter Funktionstest, keine repräsentative Qualitätsmessung mit echten Postfächern.

Diese Tests melden sich bei keinem echten Mailkonto an. Echte Anbieteranmeldungen, Anbieterrestriktionen und Organisationsfreigaben müssen mit einem eingerichteten Testkonto geprüft werden.

Modell und Herkunft: [GLiNER2.5](https://huggingface.co/fastino/gliner2.5-multi-v1), [festgelegter ONNX-Export](https://huggingface.co/jugaadsrl/gliner2.5-multi-v1-onnx/tree/3de2c11f55853b7919f985a59bfc8df27b5ec991), [Rust-Inferenz](https://github.com/dariofinardi/gliner25-rs), [ONNX Runtime](https://github.com/microsoft/onnxruntime), [Datumsnormalisierung](https://github.com/wanasit/chrono). Modell und Rust-Inferenz stehen unter Apache-2.0; ONNX Runtime und chrono-node unter MIT. Die Quellen enthalten die jeweiligen Lizenztexte und Hinweise.
