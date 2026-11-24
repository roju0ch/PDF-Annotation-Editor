# PDFs speichern

## Installierte Apps: Android, Windows, macOS und Linux

Das Downloadsymbol heißt in installierten Apps **PDF speichern unter …**. Auch Strg/Cmd+S öffnet diesen Ablauf. Zunächst wird eine neue, native PDF mit den aktuellen Annotationen erzeugt. Anschließend erscheint der Dateidialog des Betriebssystems; dort werden Ordner und Dateiname gewählt. Der Dialog schlägt den Namen der geöffneten PDF vor, zum Beispiel `Baugesuch.pdf`. Nach bestätigtem „Speichern unter“ zeigt das Fenster den gewählten Namen an und schlägt ihn beim nächsten Speichern vor.

**PDF gespeichert: …** erscheint erst nach abgeschlossener, überprüfter Dateischreibung. Bis dahin bleibt die App beschäftigt und bestätigt den Export nicht. Abbrechen und Fehler lassen Änderungen als ungesichert stehen und erlauben einen neuen Versuch. Scheitert nach bestätigtem Schreiben nur die Aktualisierung des internen Bearbeitungsstatus, bleibt die Meldung über die geschriebene Datei erhalten; ein zusätzlicher Hinweis erklärt die ausstehende Statusaktualisierung.

Android nutzt das Storage Access Framework (`ACTION_CREATE_DOCUMENT`) und den vom Nutzer gewählten Dokumentanbieter. Die App schreibt über den `ContentResolver`, schließt den Datenstrom und liest die Datei zur Prüfung erneut: Länge und SHA-256 müssen stimmen. Dafür sind keine allgemeinen Speicher-/Foto-Berechtigungen nötig. Ab Android 8 übergibt die App ein noch lesbares SAF-Dokument als Startpunkt an den Systemdialog. Der Dokumentanbieter bestimmt, ob er den zugehörigen Ordner öffnen kann. Ohne passenden Zugriff wählt man den Ordner im Dialog. Bei gleichem Namen kann Android eine nummerierte Kopie anlegen. Die App bietet kein direktes Überschreiben über die ursprüngliche Lesefreigabe an. Es wird keine dauerhafte URI-Freigabe angefordert. Ein Anbieter, der kein erneutes Lesen erlaubt, kann nicht als erfolgreich bestätigt werden. Bei Schreibfehlern kann im gewählten Ziel eine unvollständige Datei liegen; die App meldet dann keinen Erfolg. Für vollständig lokale Nutzung einen lokalen Ordner wählen; externe Dokumentanbieter werden nur durch die ausdrückliche Auswahl im Systemdialog angesprochen.

Auf Windows, macOS und Linux erfassen **Öffnen** und **Öffnen mit** den Herkunftsordner im nativen Fenster. Beispielsweise startet der Speicherdialog für `Projekt/Baugesuch.pdf` nach Möglichkeit im Ordner `Projekt` mit dem Vorschlag `Baugesuch.pdf`. Für eine Kopie den Namen ändern. Zum Ersetzen das vorhandene Ziel wählen und die Überschreibabfrage des Betriebssystems bestätigen. Fehlt ein zugänglicher Herkunftsordner, etwa beim Ablegen einer Datei ohne Pfadinformation, verwendet der Dialog seinen Standardordner.

Erst nach der Zielwahl schreibt und prüft die App eine temporäre Datei neben dem Ziel, ersetzt die Zieldatei atomar und prüft sie erneut. Jedes Desktop-Fenster verwaltet seinen eigenen Ordner und seine eigenen Speichertransaktionen. Die Weboberfläche erhält nur den Dateinamen und eine undurchsichtige Kennung. Nach erfolgreichem Speichern dient der gewählte Zielordner als nächster Vorschlag. [Mehrfenster-Bedienung](MULTIPLE_WINDOWS.md).

## iOS-Simulatorprototyp

Der neue iOS-Build dient zunächst dem Öffnen externer PDFs und der Simulatorprüfung. Ein nativer iOS-Speicherweg ist noch nicht vorhanden. Der Speicherknopf ist dort ausdrücklich deaktiviert; auch das Tastaturkürzel behauptet keinen Export. Die Android-, Desktop- und Browser-Speicherwege bleiben erhalten. Dieser Prototyp eignet sich noch nicht zur produktiven Bearbeitung mit anschließender Speicherung auf iPhone/iPad. [Dateizuordnung und Signierungsgrenzen](FILE_ASSOCIATIONS.md).

## Browser

Im normalen Browser bleibt **PDF herunterladen** verfügbar. Die neue PDF wird dem Downloadmanager des Browsers übergeben; der vorgeschlagene Downloadname entspricht der geöffneten PDF. Speicherort und Behandlung gleichnamiger Downloads richten sich nach den Browsereinstellungen. **PDF-Download gestartet** bestätigt diesen Start und ist keine Bestätigung des dauerhaften Dateischreibens. Bis zum erneuten Öffnen der heruntergeladenen Kopie behandelt der Editor vorhandene Änderungen weiter als ungesichert, weil er einen abgebrochenen Download nicht erkennen kann. Der Browser kann der App keinen verlässlichen endgültigen Speicherpfad nennen.

Installierte Apps verwenden diesen Browser-Download nicht als Ersatz bei einem nativen Fehler. Dadurch führt ein fehlender oder fehlgeschlagener Speicherweg nicht mehr stillschweigend zu einer scheinbaren Android-/Desktop-Speicherung.

## Große Dateien, Datenschutz und Lebensdauer

Das Exportlimit bleibt 150 MiB. Die Übergabe an native Apps erfolgt in Blöcken bis 256 KiB; Dateigröße, Transaktionstoken und fortlaufende Offsets werden geprüft. Es wird kein riesiger Base64-Datenblock über die WebView-Schnittstelle geschickt. Native Zwischendateien liegen nur im privaten App-Cache und werden nach Erfolg, Abbruch oder Fehler bereinigt; nach einem Prozessabbruch verbliebene Dateien werden beim nächsten Start entfernt. Das ist kein Recovery-Journal. Beim Beenden der alten App nicht gespeicherte Inhalte werden nicht automatisch wiederhergestellt oder in eine neue Installation übertragen.

Die PDF-Engine, Annotationen und Dateien bleiben lokal; es gibt keinen App-Upload und keine Online-Konvertierung. URI-, Pfad- oder PDF-Inhalte werden nicht als Diagnosemeldung protokolliert. Android-/Desktop-Dateidialoge und echte Geräte müssen zusätzlich zur Cloud-Prüfung manuell abgenommen werden. Die tatsächlichen Testergebnisse und Installationspakete stehen im zugehörigen Pull Request.
