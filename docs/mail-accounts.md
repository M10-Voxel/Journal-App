# E-Mail-Konten und automatische Kalenderübernahme

Unter **Einstellungen → E-Mail-Konten → Konto hinzufügen** einen Anbieter wählen. Mehrere Konten können gleichzeitig verbunden sein. Journal liest Nachrichten und sendet keine Mails; SMTP ist nicht erforderlich.

| Verbindung | Anmeldung und Umfang |
| --- | --- |
| Gmail API | Google-Browseranmeldung mit OAuth/PKCE, Leserechte |
| Outlook / Microsoft 365 / Exchange Online | Microsoft Graph mit OAuth/PKCE, Leserechte |
| IMAP | Passwort oder App-Passwort, SSL/TLS oder STARTTLS; wählbarer Ordner |
| POP3 | Passwort oder App-Passwort, SSL/TLS oder STARTTLS |
| Proton Mail Bridge | Lokale Bridge-Zugangsdaten; dafür bezahlter Tarif mit Proton Mail erforderlich |

Voreinstellungen existieren auch für iCloud, GMX und WEB.DE. Andere Anbieter können über Server, Port und Benutzername eingerichtet werden. Bei lokalen Exchange-Servern ist ein verfügbarer IMAP-/POP3-Zugang nötig; ActiveSync und EWS sind nicht implementiert. Eine direkte Proton-Anbindung ohne Bridge ist nicht enthalten. Anbieterbedingungen, App-Passwörter und Organisationsfreigaben gelten zusätzlich.

## OAuth vorbereiten

Es werden keine vorgegebenen OAuth-Client-IDs mitgeliefert. Google und Microsoft benötigen deshalb eine eigene App-Registrierung; deren Werte lassen sich unter **Anmeldung konfigurieren** eintragen.

- **Google:** Gmail API aktivieren, OAuth-Zugriff einrichten und einen Desktop-App-Client erstellen. Client-ID und gegebenenfalls zugehöriges Client-Secret eingeben. Scope: `https://www.googleapis.com/auth/gmail.readonly`. Im Testbetrieb das Konto als Testnutzer zulassen. Externe Test-Apps mit diesen Berechtigungen können nach sieben Tagen eine erneute Anmeldung benötigen; siehe [Google OAuth](https://developers.google.com/identity/protocols/oauth2#expiration).
- **Microsoft:** App in Entra registrieren, passende private/Organisationskonten erlauben und als Desktop-Redirect `http://localhost:42813/` hinterlegen. Delegierte Berechtigungen: `User.Read`, `Mail.Read`, `offline_access`. Journal verwendet PKCE ohne Microsoft-Client-Secret. Standardmandant ist `common`; unterstützt sind auch `consumers`, `organizations` und die Verzeichnis-ID.

Die Anmeldung öffnet den Systembrowser. Ein temporärer Listener auf `127.0.0.1:42813` akzeptiert den geprüften lokalen OAuth-Rückruf. Der Port muss frei sein. Anmeldung kann in den Einstellungen abgebrochen werden. Gmail- und Drive-Zugriff sind getrennte Verbindungen mit unterschiedlichen Berechtigungen.

## Abruf

Nach dem Verbinden wird abgerufen; bei laufender App folgt ein Abruf etwa alle fünf Minuten, auch im Tray. Der Hintergrunddienst beginnt nach dem App-Start mit kurzer Verzögerung. Nach vollständigem Beenden läuft kein Abruf. Der Zeitraum ist standardmäßig 14 Tage und zwischen 1 und 90 Tagen wählbar.

Pro Abruf werden höchstens 50 neue Nachrichten verarbeitet. POP3 besitzt keine Datumssuche und betrachtet die letzten 500 Nachrichtenkennungen. Weitere Nachrichten können beim nächsten Abruf oder mit **Abrufen** folgen. Absender-/Domainfilter und ein optionaler Betreffteil begrenzen die Auswertung, nicht die beim Anbieter gewährte Berechtigung. IMAP liest den eingestellten Ordner.

IMAP verwendet `EXAMINE` und `BODY.PEEK[]`, POP3 keine Löschbefehle. Eine Ausnahme für das selbstsignierte Bridge-Zertifikat ist ausschließlich im Proton-Profil auf der lokalen Loopback-Adresse vorgesehen. Eine Mail ist auf 8 MB begrenzt.

## Erkennung und Übernahme

ICS-Kalenderanhänge sowie strukturierte JSON-LD-Daten vom Typ `ParcelDelivery`/`Event` werden direkt gelesen. Freier Mailtext benötigt die **kontextbezogene Mailauswertung**:

1. Unter **Kontextbezogene Mailauswertung** das Modell herunterladen und aktivieren. Modell und Laufzeit erfordern einmalig ungefähr 1,3 GB Download und zusätzlichen RAM beim Laden.
2. Alternativ einen vorhandenen Modellordner übernehmen. Er muss die festgelegten `fp32_25`-Artefakte und das Runtime-Paket `microsoft.ml.onnxruntime.1.23.2.nupkg` enthalten. Herkunft und Prüfsummen werden geprüft.
3. GLiNER erkennt Textstellen; ein zusätzlicher trainierter Satzklassifikator beurteilt den konkreten Kontext. Erst dann werden Datum und Uhrzeit normalisiert. Allgemeine Supportzeiten sollen keine Termine ergeben, ein persönlich vereinbarter Rückruf schon.

Beispiele sind „Treffen morgen 17 Uhr“, „Heute zwischen 10 und 12 Uhr“, „20:00 Uhr bis 20:15“ und „20 bis 21:20“. Relative Angaben beziehen sich auf das Versanddatum der Mail in der Gerätezeitzone. Deutsch und Englisch funktionieren unabhängig von der Anzeigesprache. Erkennbare zitierte Verläufe werden vor der Auswertung reduziert; mehrdeutige Angaben können dennoch falsch oder gar nicht übernommen werden. Absagen liefern Hinweise und löschen keine vorhandenen Termine automatisch.

Beide Modelle laufen lokal. Der neuronale Encoder bleibt vortrainiert; der zusätzliche Satzklassifikator wurde mit synthetischen Beispielen trainiert. Private Mails werden nicht zum Training oder an einen Analysedienst übertragen. Die Analyse lernt nicht automatisch aus Korrekturen. Der eigene CPU-Prozess lädt das große Modell bei Bedarf und entlädt es nach 60 Sekunden Inaktivität; die Kontrolle läuft alle 15 Sekunden. Nach der Einrichtung arbeitet die Analyse offline, der Mailabruf selbst benötigt weiterhin Internet.

**Erkannte Termine werden automatisch übernommen**, unabhängig davon, ob sie aus ICS, strukturierten Daten oder ML stammen. Eine passende Kalenderkennung aktualisiert den vorhandenen Eintrag, bei Bedarf auf einen anderen Tag. Neue Termine erscheinen zunächst nur im Kalender. Ein Popup bestätigt nach erfolgreicher Speicherung Datum/Titel/Zeit und verschwindet nach zwölf Sekunden.

Fehlgeschlagene Übernahmen bleiben unter **Ausstehende Übernahmen** zur erneuten Verarbeitung, Bearbeitung, manuellen Übernahme oder zum Ignorieren erhalten. Deaktiviertes ML hält noch nicht analysierte freie Texte zurück; ICS und strukturierte Angaben funktionieren weiterhin. Nach Erkennungsupdates können zuvor ergebnislose Nachrichten einmal erneut geprüft werden; übernommene/ignorierte Vorschläge werden nicht zurückgesetzt.

Lieferfenster in Werktagen und die HTML-Ansicht erklärt [Mailvorschau und Lieferzeiträume](mail-display-and-delivery.md). Training, Live-Prüfungen und Einschränkungen stehen in [Kontextbezogene Mail-Erkennung](mail-context-ml.md). PDF-Auswertung und OCR sind nicht implementiert; vollständige Erkennung beliebiger Mails ist nicht zugesichert.

## Daten und Datenschutz

Kontometadaten, Nachrichtenkennungen und Vorschläge liegen in `mail.sqlite3` im aktiven Vault. Passwörter, Client-Secrets und OAuth-Tokens sind für den Windows-Benutzer mit DPAPI geschützt; Lese-IPC gibt sie nicht an die Oberfläche zurück. Andere Windows-Benutzer/Geräte benötigen eine neue Anmeldung.

Nach der Auswertung wird der Abruf-Body aus der Nachrichtenwarteschlange entfernt. **Vorschläge und übernommene Kalendereinträge behalten aber den gespeicherten Mailumschlag** mit begrenztem HTML/Text, Betreff und Absender. Die lokale Journal-Datenbank ist kein verschlüsseltes Mailarchiv. Diese Eintragsbeschreibungen gehören auch zum verschlüsselten Drive-Paket. Die Sandbox der Vorschau blockiert externe Inhalte standardmäßig; bewusstes Nachladen kontaktiert externe Server.

Beim Kontolöschen verschwinden dessen Zugangsdaten und ausstehende Übernahmen; gespeicherte Kalenderdaten werden nicht gelöscht. Drive synchronisiert Kontometadaten ohne Zugangsdaten. Ein auf einem anderen Gerät übernommenes Konto muss dort separat angemeldet werden.

## Prüfung und Quellen

`npm.cmd test` prüft gespeicherte Modellvorhersagen und Normalisierung; native Tests unter anderem MIME, Kodierungen, Filter, DPAPI und Modellverwaltung. Browserbereiche `mail`, `mail-header-themes` und `popup-dismissal` verwenden synthetische Daten. Sie melden sich bei keinem echten Postfach an.

Live-Prüfungen starten ausschließlich den isolierten Mail-Worker; Befehle und Messgrenzen stehen im [ML-Dokument](mail-context-ml.md). Echte Anbieteranmeldungen und Organisationsfreigaben benötigen separate Kontotests.

Implementierung: `src/mail.ts`, `src/mailMl.ts`, `src/mailContext.ts`, `src-tauri/src/mail/`. Quellen: [GLiNER2.5](https://huggingface.co/fastino/gliner2.5-multi-v1), [festgelegter ONNX-Export](https://huggingface.co/jugaadsrl/gliner2.5-multi-v1-onnx/tree/3de2c11f55853b7919f985a59bfc8df27b5ec991), [Rust-Inferenz](https://github.com/dariofinardi/gliner25-rs), [ONNX Runtime](https://github.com/microsoft/onnxruntime), [chrono-node](https://github.com/wanasit/chrono), [Proton Bridge](https://proton.me/mail/bridge).
