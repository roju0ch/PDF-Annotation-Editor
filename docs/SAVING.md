# PDFs speichern

## Installierte Apps: Android, Windows, macOS und Linux

Das Downloadsymbol heißt in installierten Apps **PDF speichern unter …**. Auch Strg/Cmd+S öffnet diesen Ablauf. Zunächst wird eine neue, native PDF mit den aktuellen Annotationen erzeugt. Anschließend erscheint der Dateidialog des Betriebssystems; dort werden Ordner und Dateiname gewählt. Der vorgeschlagene Name lautet `Originalname-annotiert.pdf`. Die App überschreibt die geöffnete Originaldatei nicht automatisch.

**PDF gespeichert: …** erscheint erst nach abgeschlossener, überprüfter Dateischreibung. Bis dahin bleibt die App beschäftigt und bestätigt den Export nicht. Abbrechen und Fehler lassen Änderungen als ungesichert stehen und erlauben einen neuen Versuch. Scheitert nach bestätigtem Schreiben nur die Aktualisierung des internen Bearbeitungsstatus, bleibt die Meldung über die geschriebene Datei erhalten; ein zusätzlicher Hinweis erklärt die ausstehende Statusaktualisierung.

Android nutzt das Storage Access Framework (`ACTION_CREATE_DOCUMENT`) und den vom Nutzer gewählten Dokumentanbieter. Die App schreibt über den `ContentResolver`, schließt den Datenstrom und liest die Datei zur Prüfung erneut: Länge und SHA-256 müssen stimmen. Dafür sind keine allgemeinen Speicher-/Foto-Berechtigungen nötig. Es wird keine dauerhafte URI-Freigabe angefordert. Ein Anbieter, der kein erneutes Lesen erlaubt, kann nicht als erfolgreich bestätigt werden. Bei Schreibfehlern kann im gewählten Ziel eine unvollständige Datei liegen; die App meldet dann keinen Erfolg. Für vollständig lokale Nutzung einen lokalen Ordner wählen; externe Dokumentanbieter werden nur durch die ausdrückliche Auswahl im Systemdialog angesprochen.

Die Desktop-Apps verwenden einen nativen Dateidialog und einen eigenen begrenzten Speicherpfad. Die Ausgabe wird zunächst in einer temporären Datei neben dem gewählten Ziel geschrieben und überprüft, bevor sie an dessen Stelle tritt. JavaScript erhält keine allgemeinen Dateisystemrechte. Ein bewusst gewähltes bestehendes Ziel ist vom automatischen Überschreiben der Quelldatei zu unterscheiden; die Auswahl und die Überschreibentscheidung gehören zum Systemdialog.

Die Mac-Mehrfensterfunktion verwendet getrennte native Speichertransaktionen je tatsächlichem Aufruffenster. Zwei Fenster können unterschiedliche PDFs vorbereiten; Token, Dateidialog und Bestätigung dürfen nicht zwischen ihnen vermischt werden. Das Schließen eines Fensters verwirft nur dessen temporäre Transaktion; eine verspätete Antwort darf keine andere PDF schreiben. [Mehrfenster-Bedienung](MULTIPLE_WINDOWS.md).

## iOS-Simulatorprototyp

Der neue iOS-Build dient zunächst dem Öffnen externer PDFs und der Simulatorprüfung. Ein nativer iOS-Speicherweg ist noch nicht vorhanden. Der Speicherknopf ist dort ausdrücklich deaktiviert; auch das Tastaturkürzel behauptet keinen Export. Die Android-, Desktop- und Browser-Speicherwege bleiben erhalten. Dieser Prototyp eignet sich noch nicht zur produktiven Bearbeitung mit anschließender Speicherung auf iPhone/iPad. [Dateizuordnung und Signierungsgrenzen](FILE_ASSOCIATIONS.md).

## Browser

Im normalen Browser bleibt **PDF herunterladen** verfügbar. Die neue PDF wird dem Downloadmanager des Browsers übergeben; Dateiname und Zielordner richten sich nach dessen Einstellungen. **PDF-Download gestartet** bestätigt diesen Start und ist keine Bestätigung des dauerhaften Dateischreibens. Die heruntergeladene Datei anschließend prüfen. Der Browser kann der App keinen verlässlichen endgültigen Speicherpfad nennen.

Installierte Apps verwenden diesen Browser-Download nicht als Ersatz bei einem nativen Fehler. Dadurch führt ein fehlender oder fehlgeschlagener Speicherweg nicht mehr stillschweigend zu einer scheinbaren Android-/Desktop-Speicherung.

## Große Dateien, Datenschutz und Lebensdauer

Das Exportlimit bleibt 150 MiB. Die Übergabe an native Apps erfolgt in Blöcken bis 256 KiB; Dateigröße, Transaktionstoken und fortlaufende Offsets werden geprüft. Es wird kein riesiger Base64-Datenblock über die WebView-Schnittstelle geschickt. Native Zwischendateien liegen nur im privaten App-Cache und werden nach Erfolg, Abbruch oder Fehler bereinigt; nach einem Prozessabbruch verbliebene Dateien werden beim nächsten Start entfernt. Das ist kein Recovery-Journal. Beim Beenden der alten App nicht gespeicherte Inhalte werden nicht automatisch wiederhergestellt oder in eine neue Installation übertragen.

Die PDF-Engine, Annotationen und Dateien bleiben lokal; es gibt keinen App-Upload und keine Online-Konvertierung. URI-, Pfad- oder PDF-Inhalte werden nicht als Diagnosemeldung protokolliert. Android-/Desktop-Dateidialoge und echte Geräte müssen zusätzlich zur Cloud-Prüfung manuell abgenommen werden. Die tatsächlichen Testergebnisse und Installationspakete stehen im zugehörigen Pull Request.
