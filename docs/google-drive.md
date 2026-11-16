# Google Drive

Unter **Einstellungen → Google Drive** werden Inhalte manuell zwischen Geräten abgeglichen. Geräte müssen nicht gleichzeitig laufen. Es gibt keinen automatischen Hintergrundabgleich und keine gemeinsam bearbeitete SQLite-Datei im Drive-Ordner.

Übertragen werden Journal und Kalender, Tags und Serien, Aktivitäten/Checklisten/Bewertungen, erfasste Zeit und Zeitraum-Notizen, Notizblock/Pinnwand samt Ordnern und referenzierten AVIF-Bildern, gespeicherte Mailtermine, Kontometadaten sowie allgemeine Darstellungseinstellungen. Zugangsdaten, laufende Timer und Fensterlayouts bleiben lokal. Die genaue Aufteilung steht im [Drive-Datenformat](sync-format-12.md).

## Einrichten

1. In der Google Cloud Console ein Projekt wählen und die **Google Drive API** aktivieren. OAuth-Zustimmungsbildschirm einrichten und bei externen Apps im Testbetrieb das verwendete Google-Konto als Testnutzer eintragen.
2. Einen OAuth-Client vom Typ **Desktop-App** erstellen. Dessen Client-ID und gegebenenfalls Client-Secret in Journal eingeben. Die Browseranmeldung verwendet PKCE und einen geprüften lokalen Callback.
3. **Mit Google Drive verbinden** wählen. Benötigt wird nur `drive.appdata`, also der versteckte eigene App-Bereich, keine Mail-Berechtigung und kein allgemeiner Zugriff auf alle Drive-Dateien.
4. Auf dem ersten Gerät einen **Geräteschlüssel erzeugen**, kopieren und sicher aufbewahren. Auf allen weiteren Geräten **denselben Schlüssel, dieselbe Client-ID und dasselbe Google-Konto** verwenden. Verschiedene Google-Konten teilen ihre App-Daten nicht automatisch.
5. Zuerst auf dem Gerät mit den gewünschten Daten **Jetzt synchronisieren**, später auf dem anderen Gerät ebenfalls synchronisieren. Bei bereits abweichenden Inhalten die Konfliktauswahl beachten.

Der Geräteschlüssel ist ein von Journal erzeugter 256-Bit-Schlüssel, normalerweise 44 Base64-Zeichen, kein Google-Passwort. Leerraum wird entfernt; Base64-URL-Schreibweise und fehlendes Padding werden akzeptiert. Ein anderer Schlüssel bezeichnet einen anderen verschlüsselten Tresor und öffnet die bisherigen Daten nicht.

Mit **„Auf diesem Gerät merken“** (Standard) wird der Schlüssel beim nächsten Abgleich gerätelokal gespeichert – mit Windows-DPAPI geschützt wie die OAuth-Anmeldung (`drive.key` im App-Datenordner, nie im Vault, in der Cloud oder im localStorage). Ohne Häkchen wird er nur für diesen Abgleich gehalten und ist danach wieder einzugeben. Für die automatische Synchronisierung muss er gemerkt sein; „Schlüssel auf diesem Gerät vergessen“ löscht ihn. Ohne den ursprünglichen Geräteschlüssel gibt es keine Wiederherstellung der Cloud-Inhalte.

## Automatisch synchronisieren

Unter **Wann synchronisieren** (gerätelokal, `journal.driveSync`; Logik in `src/sync/driveSchedule.ts` und `src/sync/driveSync.ts`, läuft nur im Journal-Fenster):

| Wahl | Wann |
| --- | --- |
| Nach jeder Speicherung | Nach dem Speichern einer Änderung (Einträge, Tags, Aktivitäten/Tageswerte, Pinnwand/Notizen, geteilte Einstellungen, Desk-Layouts, Tag-Arten-Reihenfolge), gesammelt: 20 s nach der letzten Änderung, spätestens 2 min nach der ersten, nie zwei Abgleiche in weniger als 30 s. Änderungen anderer Geräte werden alle 5 min und beim Zurückkehren ins Fenster (höchstens alle 2 min) abgeholt. |
| Regelmäßig | Alle *n* Minuten (2–1440). |
| Beim Schließen des Fensters (×) | Nach dem Schließen (Journal läuft im Hintergrund weiter) und beim Beenden. |
| Beim Beenden der App | Beim Beenden über das Infobereich-Symbol; auch wenn Windows herunterfährt, neu startet oder abmeldet. |
| Nur manuell | Nur mit „Jetzt synchronisieren“. |

Jede automatische Wahl gleicht zusätzlich **beim Start der App** ab, und beim Beenden bzw. Herunterfahren wird bei allen automatischen Wahlen noch Ungesichertes übertragen.

**Herunterfahren:** Das Journal-Fenster fängt `WM_QUERYENDSESSION` ab (`src-tauri/src/session.rs`), meldet über `ShutdownBlockReasonCreate` „Journal synchronisiert mit Google Drive …“, lässt die Seite speichern und abgleichen und gibt nach Abschluss oder spätestens 25 s frei. Windows kann das jederzeit abbrechen („Trotzdem herunterfahren“); ein unterbrochener Abgleich schreibt nichts halb – es bleibt beim letzten vollständigen Stand, der beim nächsten Start abgeglichen wird.

**Sparsam mit Anfragen (Google-Limits):** Ein automatischer Abgleich, bei dem sich lokal nichts geändert hat (Fingerabdruck von Datenbank, Mailkonten und geteilten Einstellungen) und die Cloud-Datei dieselbe Version hat (`drive_probe`, ein Metadaten-Abruf), lädt nichts herunter und hoch. Hochgeladen wird nur, wenn sich der Cloud-Stand ändern würde; Pinnwandbilder werden nur geladen, wenn die Cloud sie noch nicht hat. `drive_write` liefert die neue Dateiversion zurück, sodass kein zusätzlicher Abruf nötig ist. Das OAuth-Token wird bis zum Ablauf wiederverwendet. Bei Fehlern wartet der nächste Versuch 1, 2, 4 … bis 60 min, beim Google-Anfragelimit (HTTP 429/`rateLimitExceeded`) mindestens 5 min; nach drei Fehlschlägen in Folge erscheint ein Hinweis. „Google Drive arbeitet bereits“ oder lokale Änderungen während des Abgleichs gelten nicht als Fehler – es wird nach 15 s erneut versucht.

**Was sich auf diesem Gerät ändert:** Nur was von anderen Geräten kommt, wird übernommen (`drive_apply` meldet die geänderten Tage, Tags, Aktivitäten und die Pinnwand an alle Fenster, die sie neu laden; die Eingabe pausiert dafür kurz). Neu geladen wird die Seite nur, wenn geteilte Einstellungen oder Layouts angekommen sind – automatisch erst nach drei Sekunden ohne Tippen oder Klicken. **Konflikte** (dasselbe Feld auf zwei Geräten geändert) pausieren die automatische Synchronisierung mit einem Hinweis, bis sie in den Einstellungen aufgelöst sind.

Desktop-Widgets und ihre Einstellungen werden nie übertragen (siehe [Sync-Format](sync-format-12.md)).

## Zusammenführen und Konflikte

Vor dem Abgleich werden ausstehende Änderungen der offenen Fenster gespeichert. Die App vergleicht lokalen Stand, Cloud und den letzten erfolgreichen Vergleichsstand dieses Geräts. Unabhängige Änderungen werden zusammengeführt; widersprüchliche Felder und Löschen gegenüber Bearbeiten verlangen eine Auswahl. Die Schaltflächen übernehmen bei den Konflikten jeweils die lokalen oder die Cloud-Werte, während unabhängige Änderungen kombiniert bleiben.

Wiederholungsregeln und Planungslisten werden als ganze Werte behandelt. Ganze Zahlen aus JSON/SQLite werden nach ihrem Wert verglichen, damit `1.0` und `1` keinen falschen Änderungskonflikt auslösen. Tatsächliche Änderungen werden weiterhin geschützt.

Übernommene Mailkonten benötigen auf dem Zielgerät unter **E-Mail-Konten → Bearbeiten** eine eigene Anmeldung beziehungsweise ein Passwort. Ihr lokaler Abrufstand und Modellinstallationen werden nicht mitgebracht. Mailtermine mit gespeicherten Beschreibungen sind dagegen normale synchronisierte Kalendereinträge.

## Verschlüsselung und Versionsschutz

Der Snapshot wird lokal mit AES-GCM und einem neuen zufälligen Nonce pro Upload verschlüsselt. Auch der Vergleichsstand im WebView-Speicher ist verschlüsselt und enthält keine Bilddaten. Google sieht technische Metadaten und Dateigröße. Die Datei liegt im versteckten `appDataFolder` und ist keine gewöhnliche Datei in der Drive-Oberfläche.

Referenzierte Bilder werden bei jedem Abgleich erneut im Paket übertragen. Die Transportgrenze beträgt 250.000.000 Bytes verschlüsselte Daten; JSON/Base64 benötigen zusätzlich Platz. Es gibt keine inkrementelle Bildübertragung.

Vor einer Übernahme werden Journaldaten und Kontometadaten geprüft. Der Server-Dateistand wird vor und nach dem Download über seinen ETag verglichen. Ein bestehender Cloud-Stand wird mit `If-Match` aktualisiert. Die Implementierung verwendet dafür v2-Metadaten, für Auflisten, Download und Erstanlage v3. Fehlt der Versionsschutz, ist der ETag inzwischen anders oder existieren mehrere gleichnamige Tresordateien, wird abgebrochen statt ungeschützt überschrieben. Fehlt eine früher vorhandene Cloud-Datei, löscht der normale Abgleich keine lokalen Daten.

Journal und Mailkonten liegen in getrennten Datenbanken; eine gemeinsame Transaktion über beide ist nicht implementiert. Der lokale Sicherungsstand vor einer Journal-Übernahme ist ein einzelner Stand, kein unbegrenztes Versionsarchiv. **Letzten lokalen Stand vor dem Abgleich wiederherstellen** stellt Journaldaten einschließlich Pinnwand-/Periodendaten wieder her; separate Mailanmeldungen und Darstellungseinstellungen sind damit nicht vollständig rücksetzbar. Eine Auswahl alter Google-Dateiversionen bietet die App nicht an.

## Einen Stand bewusst ersetzen

Unter **Einen Stand komplett ersetzen** stehen nach Bestätigung zwei Aktionen bereit:

- **Cloud durch lokalen Stand ersetzen:** Der aktuelle lokale Snapshot ersetzt den Tresor dieses Kontos und Geräteschlüssels. Nur in der Cloud vorhandene Inhalte werden nicht zusammengeführt. Die lokale Inhaltsdatenbank bleibt unverändert.
- **Lokalen Stand durch Cloud ersetzen:** Auf dem Zielgerät wird der Cloud-Stand übernommen, ohne ihn hochzuladen. Der bisherige lokale Journalstand wird gesichert.

Danach auf den Geräten wieder normal synchronisieren. Andere Tresore mit anderen Geräteschlüsseln werden nicht entfernt. Der ETag-Schutz gilt auch beim Ersetzen der Cloud. Für zusätzliche Sicherungen den [Vault](vault-and-updates.md) sichern.

## Fehler und Prüfungen

- **403:** Im Projekt der verwendeten Client-ID prüfen, ob die Drive API aktiviert ist. `accessNotConfigured`/`SERVICE_DISABLED` deutet darauf hin; `insufficientPermissions`/`ACCESS_TOKEN_SCOPE_INSUFFICIENT` auf fehlende Rechte. Bei Berechtigungsproblemen trennen und neu anmelden; den Geräteschlüssel beibehalten.
- **Entschlüsselungsfehler:** Vollständigen ursprünglichen Geräteschlüssel und dasselbe Konto prüfen; keinen Ersatzschlüssel für bestehende Daten erzeugen.
- **Gleichzeitige Änderungen:** Offene Bearbeitungen abschließen, erneuten Abgleich starten und die angezeigten Konflikte prüfen. Kein ungeschütztes Überschreiben erzwingen.
- **Abgelaufene Anmeldung:** Im Google-Testbetrieb können Refresh-Tokens ablaufen; erneut anmelden, denselben Schlüssel beibehalten. Hintergrund: [Google OAuth](https://developers.google.com/identity/protocols/oauth2#expiration).

Browserbereich `drive` verwendet simulierten Transport. Native Tests prüfen Übernahme, Rollback, ETags und Zahlvergleiche. Das belegt keine aktuelle echte Google-Anmeldung oder einen Zwei-Geräte-Test. Implementierung: `src/components/DriveSettings.tsx`, `src/sync/`, `src-tauri/src/drive.rs`.
