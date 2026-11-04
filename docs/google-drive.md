# Google Drive

Unter **Einstellungen → Google Drive** lassen sich Journaltage, Einträge, Kalender, Tags, Wiederholungsserien, Aktivitäten, Checklisten, Bewertungen, Pinnwandkarten mit referenzierten Bildern, Mailkonten und allgemeine Darstellungseinstellungen manuell zwischen Windows-Geräten abgleichen. Übernommene Mailtermine enthalten auch ihre gespeicherten Mailinhalte. Zugangsdaten, der lokale Mailabruf und gerätespezifische Einstellungen gehören nicht zum Sync-Stand. Einzelheiten stehen unter [Erweiterter Drive-Abgleich](sync-format-12.md).

Mailkonten erscheinen nach dem Abgleich auf dem anderen Gerät. Passwörter und Anmeldetokens bleiben auf dem ursprünglichen Gerät: Das übernommene Konto dort unter **E-Mail-Konten → Bearbeiten** anmelden beziehungsweise das Passwort eingeben und speichern. Danach ruft das Gerät das Postfach selbst ab. Änderungen und Löschungen von Konten werden beim manuellen Abgleich übernommen. Beide Geräte benötigen eine App-Version mit Sync-Format 13.

## Einmalige Einrichtung

1. In der Google Cloud Console ein Projekt wählen, die **Google Drive API** aktivieren und den OAuth-Zustimmungsbildschirm einrichten.
2. Einen OAuth-Client vom Typ **Desktop-App** erstellen. Solange das Google-Projekt im Testbetrieb ist, das eigene Google-Konto als Testnutzer hinzufügen. Google kann im Testbetrieb eine erneute Anmeldung verlangen.
3. Client-ID und gegebenenfalls das zu diesem Desktop-Client gehörende Client-Secret in Journal eingeben. **Mit Google Drive verbinden** öffnet den Browser. Die App benötigt nur `drive.appdata`, also ihren eigenen versteckten App-Bereich. Sie benötigt keine Mail-Berechtigung und keinen Zugriff auf alle Drive-Dateien.
4. Auf dem ersten Gerät einen neuen Geräteschlüssel erzeugen, kopieren und sicher aufbewahren. Auf weiteren Geräten **denselben Schlüssel, dieselbe Client-ID und dasselbe Google-Konto** verwenden. Dort keinen neuen Schlüssel erzeugen.
5. Auf dem ersten Gerät **Jetzt synchronisieren** wählen. Später auf dem anderen Gerät ebenfalls synchronisieren. Die Geräte müssen nicht gleichzeitig laufen. Derzeit gibt es keinen automatischen Hintergrundabgleich.

Der Schlüssel wird nicht dauerhaft in Journal gespeichert und muss nach einem Neustart erneut eingegeben werden. Ohne ihn sind die Cloud-Daten nicht entschlüsselbar. OAuth-Zugangsdaten liegen dagegen lokal mit Windows-DPAPI geschützt vor. Die Browseranmeldung verwendet PKCE und einen geprüften Loopback-Callback.

Der Geräteschlüssel ist kein frei gewähltes Passwort und kein Google-Passwort. Er wird von Journal erzeugt und hat normalerweise 44 Zeichen im Base64-Format. Den vollständigen ursprünglichen Schlüssel auf jedem Gerät einfügen. Mitkopierte Leerzeichen und Zeilenumbrüche werden entfernt; Base64-URL-Schreibweise und fehlende abschließende Paddingzeichen werden akzeptiert, ohne den zugrunde liegenden Schlüssel oder die Tresor-ID zu verändern. Ungültige Eingaben werden direkt am Feld erklärt und vor dem Drive-Zugriff abgewiesen. Für bereits verschlüsselte Cloud-Daten keinen Ersatzschlüssel erzeugen: Ein anderer Schlüssel öffnet einen anderen Tresor.

## HTTP 403 beim ersten Abgleich

Im Google-Cloud-Projekt, aus dem die eingetragene Client-ID stammt, unter **APIs & Dienste → Bibliothek → Google Drive API** prüfen, ob die API aktiviert ist. Falls nicht, aktivieren, kurz warten und erneut synchronisieren. Die OAuth-Anmeldung allein aktiviert die Drive API nicht. Die App zeigt den von Google gelieferten Fehlercode an: `accessNotConfigured` oder `SERVICE_DISABLED` bezeichnet eine deaktivierte API; `insufficientPermissions` oder `ACCESS_TOKEN_SCOPE_INSUFFICIENT` fehlende Berechtigungen. Bei fehlender Berechtigung die Verbindung in Journal trennen und erneut anmelden. Der Geräteschlüssel muss dabei gleich bleiben. Bei anderen Ursachen den angezeigten Google-Fehlergrund beachten.

## Verhalten beim Abgleich

Die App speichert zuerst lokale Änderungen, lädt den Cloud-Stand und vergleicht ihn mit dem letzten erfolgreichen Abgleich dieses Geräts. Unabhängige Änderungen werden zusammengeführt, widersprüchliche Änderungen zur Auswahl angeboten. Löschen gegenüber Bearbeiten gilt ebenfalls als Konflikt. Bei Konflikten wird zunächst nichts hochgeladen oder übernommen. Wiederholungsregeln und Planungslisten werden als ganze Werte behandelt.

Der Inhalt wird mit einem zufällig erzeugten 256-Bit-Schlüssel und AES-GCM verschlüsselt; für jeden Upload entsteht ein neuer zufälliger Nonce. Auch der Vergleichsstand auf dem Gerät ist verschlüsselt. Google sieht die Dateigröße und technische Metadaten. Die Cloud-Datei liegt im versteckten `appDataFolder` und erscheint nicht als gewöhnliche Datei in der Drive-Oberfläche.

Vor dem Upload prüft die App den geplanten Import innerhalb einer zurückgerollten Datenbanktransaktion. Vor der eigentlichen Übernahme prüft sie erneut, ob lokale Daten inzwischen geändert wurden. Der Dateidownload muss keinen ETag-Header liefern: Die App liest den expliziten ETag aus den Dateimetadaten vor und nach dem Download. Stimmen diese Versionen nicht überein, wird abgebrochen. Für diese Metadaten und den bedingten Upload mit `If-Match` verwendet die App Drive v2; Auflisten, Herunterladen und erstmaliges Anlegen bleiben bei v3. Der [ETag gehört zur v2-Dateiressource](https://developers.google.com/workspace/drive/api/reference/rest/v2/files). Fehlt auch dort eine gültige Version, wird nicht ohne Versionsschutz weitergemacht. Mehrere gleichnamige Tresordateien werden ebenfalls nicht automatisch überschrieben. Fehlende Cloud-Dateien nach einem früheren erfolgreichen Abgleich führen zum Abbruch, nicht zur Löschung lokaler Daten.

Die letzte lokale Fassung vor einem Import bleibt als Sicherungsstand in der lokalen Datenbank erhalten und kann über den Wiederherstellungsbutton zurückgeholt werden. Das ist ein einzelner lokaler Sicherungsstand, kein unbegrenztes Versionsarchiv. Google Drive kann eigene Dateiversionen vorhalten; eine Oberfläche für deren Auswahl ist hier nicht enthalten. Ein verschlüsselter Cloud-Stand ist auf 250 MB begrenzt.

## Prüfung

`JOURNAL_UI_SCOPE=drive` prüft Einrichtung und verschlüsselte Übertragung in Klassisch und Pixel mit simuliertem Drive. Rust-Tests prüfen transaktionale Übernahme, Rollback, Fremdschlüssel und veraltete lokale Stände. Die Tests ersetzen keine Anmeldung an einem echten Google-Konto: OAuth, tatsächliche Drive-Antwortheader und die Übertragung zwischen zwei echten Geräten müssen nach Einrichtung der Client-ID geprüft werden.
