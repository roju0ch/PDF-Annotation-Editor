# Mehrere PDF-Fenster auf macOS

Auf dem Mac kann dieselbe App mehrere unabhängige PDF-Fenster öffnen. Eine zweite App-Instanz ist dafür nicht nötig. Windows, Linux, Android, iOS und die Browser-Vorschau behalten in diesem Schritt ihr bisheriges Verhalten; die gemeinsame Fenster-/Speichertrennung ist für weitere Desktop-Plattformen vorbereitet.

## Bedienung

- **Weitere PDF aus dem Finder:** Eine andere PDF doppelklicken oder über **Öffnen mit → PDF Viewer** öffnen. Eine bereits geöffnete PDF bleibt mit ihren Änderungen im bisherigen Fenster. Für die neue Datei wird ein eigenes Fenster geöffnet; ein noch unbenutztes leeres Fenster kann übernommen werden.
- **Leeres Fenster:** In der macOS-Menüleiste **Datei → Neues Fenster** beziehungsweise **⌘N** verwenden. Zusätzlich bietet das vorhandene Ansichtsmenü der App **Neues Fenster**. Dort anschließend **PDF öffnen** wählen oder eine Datei ablegen.
- **Zwischen Fenstern wechseln:** Die Dokumentnamen in Fenstertitel und macOS-Fenstermenü helfen bei der Auswahl. Ein Klick auf das Dock-Symbol aktiviert die laufende App; er muss keine zweite Programminstanz starten.
- **PDF im selben Fenster austauschen:** Der vorhandene Knopf **PDF öffnen** beziehungsweise Ablegen einer Datei ersetzt weiterhin das Dokument dieses Fensters. Bei ungesicherten Änderungen erscheint die Bestätigung. Das ist vom Öffnen einer weiteren Datei aus dem Finder zu unterscheiden.
- **Speichern:** **⌘S / PDF speichern unter …** exportiert nur das Dokument des jeweiligen Fensters. Dateidialog, Datenblöcke, Erfolgsmeldung und ungesicherter Zustand gehören zu diesem Fenster. Abbrechen in einem Fenster speichert keine andere PDF.
- **Fenster schließen:** Rote Schließtaste beziehungsweise **⌘W** betreffen dieses Fenster. Ungesicherte Änderungen benötigen **Verwerfen und schließen**; **Abbrechen** und Escape lassen das Dokument offen. Während einer laufenden Dateioperation erst deren Ende abwarten.
- **App beenden:** **⌘Q** fragt die betroffenen Fenster über denselben geschützten Schließablauf ab. Ein abgebrochener Schließvorgang lässt die noch offenen Dokumente in der App.

## Getrennte Dokumente

Jedes Fenster hat einen eigenen MuPDF-Worker, Seitenzustand, Zoom/Pan, Auswahl, Änderungen und Undo/Redo. Auch native Dateiübergaben und Speichertransaktionen werden anhand des tatsächlichen aufrufenden Fensters getrennt. Ein fremdes Fenster kann mit einem anderen Transaktionstoken weder dessen PDF lesen noch dessen Export fortsetzen oder abschließen.

Die bisherige interne Zwischenablage für kopierte PDF-Annotationen ist vorerst **fensterlokal**. Kopieren und Einfügen zwischen nacheinander im selben Fenster geöffneten PDFs funktionieren wie bisher; die Übertragung dieser internen Annotationskopien zwischen zwei Fenstern ist kein neuer Bestandteil dieses Schritts. Allgemeine App-Einstellungen können gemeinsam gespeichert sein, ohne Dokumentinhalte zu teilen.

Kurz wiederholte identische Betriebssystemereignisse werden zusammengefasst und aktivieren das zugeordnete Fenster. Ein späteres bewusstes erneutes Öffnen bleibt möglich. Die Zahl der Fenster ist begrenzt; bei Erreichen der Grenze erscheint ein Hinweis. Das verhindert, dass ein Dateibündel unkontrolliert neue Fenster erzeugt.

## Speicher und Datenschutz

Mehrere große Pläne benötigen mehr Arbeitsspeicher: PDF-Engine und Rastercache existieren je Fenster. Die bisherigen Datei-/Rendergrenzen bleiben erhalten; sie sind keine Zusage eines festen Gesamtspeicherverbrauchs bei vielen gleichzeitig geöffneten PDFs. Ungenutzte Fenster schließen und wichtige Änderungen regelmäßig speichern. Ein Recovery-Journal ist weiterhin nicht enthalten.

PDF-Inhalte werden unverändert lokal verarbeitet. Es gibt keine neue Netzwerkverbindung, keine Dokumentübertragung zwischen Rechnern und keine allgemeine Dateisystemfreigabe für JavaScript. Neue Fenster laden ausschließlich die mitgelieferten App-Dateien. Beim Schließen werden nur die diesem Fenster zugeordneten temporären Importe und Exporte bereinigt.

## Cloud-Prüfung und Abnahme

Automatisierte Browser-Tests verwenden unabhängige Seiten mit echten PDF-Workern und kontrollierter nativer IPC. Sie prüfen verschiedene Dokumente, eigene Änderungen/Undo, unverwechselbare Exportbytes, Abbruch, Schließen und Verhalten ohne Mac-Fensterfähigkeit. Native Rust-Tests prüfen zusätzlich die tatsächlichen Dateitransaktionen, Fensterzuordnung und verspätete Antworten nach dem Schließen.

Die macOS-CI baut zunächst das reguläre DMG. Ein separat mit einer Testfunktion gebauter App-Bundle dient danach dem echten macOS-Fenstertest: Zwei synthetische PDFs werden über Launch Services geöffnet; dieselbe App muss zwei tatsächliche WebViews mit den richtigen, vom PDF-Worker gelesenen Dokumenten melden. Die ausschließlich dafür kompilierte lokale Diagnosefunktion gehört nicht zum ausgelieferten DMG. Signierte Release-Probeläufe verwenden diese Diagnose-App nicht. Tatsächliche Ergebnisse und Paket-Links stehen im Pull Request.

Auf einem echten Mac zusätzlich prüfen:

1. Zwei unterschiedliche PDFs aus dem Finder öffnen und beide gleichzeitig sehen.
2. In beiden Fenstern eine andere Markierung zeichnen. Zoomen/Seitenwechsel in A dürfen B nicht verändern.
3. Beide unter verschiedenen Namen speichern, in einem anderen Viewer öffnen und wieder laden. Abbrechen eines Dateidialogs darf das andere Dokument nicht beeinflussen.
4. **⌘N**, Fenstermenü, Dock-Aktivierung und **⌘W** prüfen. Bei ungesicherten Änderungen erst abbrechen, danach ausdrücklich verwerfen.
5. Einen offenen Textentwurf bei externem Dateiöffnen/Schließen abbrechen; Text und Fokus müssen erhalten bleiben. **⌘Q** mit mehreren ungesicherten Fenstern prüfen.
6. Mehrere große Pläne verwenden und den Ressourcenverbrauch beobachten. Synthetische oder freigegebene Dateien verwenden; private Pläne gehören nicht in das Repository oder die Testartefakte.

Die Umstellung von Windows/Linux auf dasselbe Mehrfenster-Verhalten ist ein weiterer Schritt. Mobile Plattformen benötigen eine eigene Bedienentscheidung, etwa Dokumentreiter oder unterstützte Betriebssystemfenster; Desktop-Fenster werden dort nicht ungeprüft aktiviert.
