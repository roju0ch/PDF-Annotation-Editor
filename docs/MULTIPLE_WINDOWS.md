# Mehrere PDF-Fenster auf dem Desktop

Unter Windows, macOS und Linux öffnet die laufende App mehrere unabhängige PDF-Fenster. Windows und Linux leiten Dateimanager-Aufrufe per Single-Instance-Plugin weiter. Auf Linux setzt die Weiterleitung einen D-Bus-Sitzungsdienst voraus. Android, iOS und die Browser-Vorschau verwenden weiterhin ihre jeweilige Einzelfenster-Bedienung.

## Bedienung

- **Weitere PDF aus dem Dateimanager:** Eine andere PDF doppelklicken, wenn PDF Viewer als Standard-App gewählt ist, oder über **Öffnen mit → PDF Viewer** öffnen. Eine bereits geöffnete PDF bleibt mit ihren Änderungen im bisherigen Fenster. Für die neue Datei wird ein eigenes Fenster geöffnet; ein noch unbenutztes leeres Fenster kann übernommen werden.
- **Leeres Fenster:** **Neues Fenster** im Ansichtsmenü wählen. Auf macOS steht zusätzlich **Datei → Neues Fenster / ⌘N** zur Verfügung. Anschließend **PDF öffnen** wählen oder eine Datei ablegen.
- **Zwischen Fenstern wechseln:** Die Dokumentnamen stehen in den Fenstertiteln. Zum Wechseln die Fensterübersicht des Betriebssystems oder auf macOS das Fenstermenü verwenden.
- **PDF im selben Fenster austauschen:** Der vorhandene Knopf **PDF öffnen** beziehungsweise Ablegen einer Datei ersetzt weiterhin das Dokument dieses Fensters. Bei ungesicherten Änderungen erscheint die Bestätigung. Das ist vom Öffnen einer weiteren Datei aus dem Dateimanager zu unterscheiden.
- **Speichern:** **Strg+S**, auf dem Mac **⌘S**, oder **PDF speichern unter …** exportiert nur das Dokument des jeweiligen Fensters. Dateidialog, Datenblöcke, Erfolgsmeldung und ungesicherter Zustand gehören zu diesem Fenster. Abbrechen in einem Fenster speichert keine andere PDF.
- **Fenster schließen:** Die Schließtaste schließt das jeweilige Fenster. Auf macOS steht auch **⌘W** zur Verfügung. Ungesicherte Änderungen benötigen **Verwerfen und schließen**; **Abbrechen** und Escape lassen das Dokument offen. Während einer laufenden Dateioperation erst deren Ende abwarten.
- **App auf macOS beenden:** **⌘Q** fragt die betroffenen Fenster über denselben geschützten Schließablauf ab. Ein abgebrochener Schließvorgang lässt die noch offenen Dokumente in der App.

## Getrennte Dokumente

Jedes Fenster hat einen eigenen MuPDF-Worker, Seitenzustand, Zoom/Pan, Auswahl, Änderungen und Undo/Redo. Auch native Dateiübergaben und Speichertransaktionen werden anhand des tatsächlichen aufrufenden Fensters getrennt. Ein fremdes Fenster kann mit einem anderen Transaktionstoken weder dessen PDF lesen noch dessen Export fortsetzen oder abschließen.

Die bisherige interne Zwischenablage für kopierte PDF-Annotationen ist vorerst **fensterlokal**. Kopieren und Einfügen zwischen nacheinander im selben Fenster geöffneten PDFs funktionieren wie bisher; die Übertragung dieser internen Annotationskopien zwischen zwei Fenstern ist kein neuer Bestandteil dieses Schritts. Allgemeine App-Einstellungen können gemeinsam gespeichert sein, ohne Dokumentinhalte zu teilen.

Kurz wiederholte identische Betriebssystemereignisse werden zusammengefasst und aktivieren das zugeordnete Fenster. Ein späteres bewusstes erneutes Öffnen bleibt möglich. Die Zahl der Fenster ist begrenzt; bei Erreichen der Grenze erscheint ein Hinweis. Das verhindert, dass ein Dateibündel unkontrolliert neue Fenster erzeugt.

## Speicher und Datenschutz

Mehrere große Pläne benötigen mehr Arbeitsspeicher: PDF-Engine und Rastercache existieren je Fenster. Die bisherigen Datei-/Rendergrenzen bleiben erhalten; sie sind keine Zusage eines festen Gesamtspeicherverbrauchs bei vielen gleichzeitig geöffneten PDFs. Ungenutzte Fenster schließen und wichtige Änderungen regelmäßig speichern. Ein Recovery-Journal ist weiterhin nicht enthalten.

PDF-Inhalte werden unverändert lokal verarbeitet. Es gibt keine neue Netzwerkverbindung, keine Dokumentübertragung zwischen Rechnern und keine allgemeine Dateisystemfreigabe für JavaScript. Neue Fenster laden ausschließlich die mitgelieferten App-Dateien. Beim Schließen werden nur die diesem Fenster zugeordneten temporären Importe und Exporte bereinigt.

## Cloud-Prüfung und Abnahme

Automatisierte Browser-Tests verwenden unabhängige Seiten mit echten PDF-Workern und kontrollierter nativer IPC. Sie prüfen verschiedene Dokumente, eigene Änderungen/Undo, unverwechselbare Exportbytes, Abbruch, Schließen und Verhalten ohne Mac-Fensterfähigkeit. Native Rust-Tests prüfen zusätzlich die tatsächlichen Dateitransaktionen, Fensterzuordnung und verspätete Antworten nach dem Schließen.

Die Desktop-CI baut zuerst die regulären Installer. Eine separate Diagnose-App öffnet danach zwei synthetische PDFs und prüft die sichtbaren Fenster, ihre Titel, die Seitenzahlen und die gemeinsame Prozess-ID. macOS verwendet dafür Launch Services. Windows und Linux starten die App mit denselben Dateipfad-Argumenten wie die Dateizuordnung und prüfen die Weiterleitung an den ersten Prozess. Linux läuft dafür in einer eigenen Xvfb- und D-Bus-Sitzung. Die Testergebnisse und Installer-Artefakte stehen im Pull Request.

Intel wird auf macOS 15, Apple Silicon auf macOS 26 geprüft. Der ARM-Runner wurde nach kapazitätsbedingten Abbrüchen im älteren GitHub-Pool aktualisiert; auch der bestehende iOS-Simulator-Build verwendet das aktuelle ARM-Image. Das ändert nicht die konfigurierte Mindestversion der installierten App. Die Diagnose liest native Fenstertitel nach deren asynchroner Cocoa-Aktualisierung erneut; sie setzt keine Titel selbst und schwächt die externen Prüfkriterien nicht ab.

Auf echten Desktop-Systemen zusätzlich prüfen:

1. Zwei unterschiedliche PDFs aus dem Dateimanager öffnen und beide gleichzeitig sehen.
2. In beiden Fenstern eine andere Markierung zeichnen. Zoomen/Seitenwechsel in A dürfen B nicht verändern.
3. Beide unter verschiedenen Namen speichern, in einem anderen Viewer öffnen und wieder laden. Abbrechen eines Dateidialogs darf das andere Dokument nicht beeinflussen.
4. **Neues Fenster** und die Schließtaste prüfen. Auf macOS auch **⌘N**, Fenstermenü, Dock-Aktivierung und **⌘W** prüfen. Bei ungesicherten Änderungen erst abbrechen, danach ausdrücklich verwerfen.
5. Einen offenen Textentwurf bei externem Dateiöffnen/Schließen abbrechen; Text und Fokus müssen erhalten bleiben. **⌘Q** mit mehreren ungesicherten Fenstern prüfen.
6. Mehrere große Pläne verwenden und den Ressourcenverbrauch beobachten. Synthetische oder freigegebene Dateien verwenden; private Pläne gehören nicht in das Repository oder die Testartefakte.
