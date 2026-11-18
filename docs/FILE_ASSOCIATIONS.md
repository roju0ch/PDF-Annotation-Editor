# PDFs aus Dateimanager und anderen Apps öffnen

Installierte Versionen können sich als PDF-Programm anbieten. Die Dateizuordnung umfasst `.pdf`, `application/pdf` und unter Apple `com.adobe.pdf` mit der Rolle **Editor**. Die Installation soll eine vorhandene Standard-App beibehalten. Erst die bewusste Auswahl in den Betriebssystem-Einstellungen beziehungsweise im Dialog **Öffnen mit** macht PDF Viewer zur Standard-App.

Die Browser-/GitHub-Pages-Version registriert sich nicht als Betriebssystemprogramm. Die folgenden Schritte beziehen sich auf installierte native Apps. Passende Testpakete und tatsächliche Testergebnisse stehen im zugehörigen Pull Request; [Download und Signierung](RELEASES.md).

## Windows

1. Den NSIS-Installer (`.exe`) installieren.
2. Im Explorer eine PDF mit der rechten Maustaste anklicken → **Öffnen mit** → **Andere App auswählen** → **PDF Viewer**. Je nach Windows-Version **Immer** beziehungsweise **Immer diese App zum Öffnen von .pdf-Dateien verwenden** wählen.
3. Alternativ unter **Einstellungen → Apps → Standard-Apps** nach `.pdf` suchen und PDF Viewer auswählen.
4. Eine PDF doppelklicken. Bei bereits laufender App wird deren Fenster verwendet; bei ungesicherten Änderungen erscheint vor dem Wechsel eine Nachfrage.

Der Installer hinterlegt PDF Viewer als auswählbaren Handler. Vorhandene Zuordnungen und `UserChoice` werden nicht als Installationsnebenwirkung überschrieben. Windows verwaltet die geschützte Standardprogramm-Auswahl selbst.

## Linux: DEB

1. Das DEB-Paket über die Paketverwaltung installieren.
2. Im Dateimanager eine PDF mit der rechten Maustaste anklicken → **Eigenschaften** beziehungsweise **Öffnen mit** → **PDF Viewer** → als Standard festlegen. Die genaue Beschriftung hängt von GNOME, KDE oder dem verwendeten Desktop ab.
3. Eine PDF doppelklicken; eine bereits laufende Instanz erhält die Datei.

Die installierte Desktop-Datei enthält `MimeType=application/pdf;` und übergibt die ausgewählten Dateinamen als einzelne Argumente über `%F`. Sie setzt keine bestehende Standard-App über `xdg-mime default` oder `mimeapps.list` um.

## Linux: AppImage

Eine ausführbare AppImage allein ist **noch keine systemweite Registrierung**. Die interne Desktop-Datei beschreibt den Handler, wird durch den bloßen Download aber nicht im Benutzerprofil installiert.

Für die Standardprogramm-Auswahl ist eine gesonderte Desktop-Integration nötig, etwa durch eine auf der Distribution verfügbare AppImage-Integration oder eine eigene Desktop-Datei. Diese muss auf den tatsächlichen, dauerhaft beibehaltenen AppImage-Pfad zeigen. Im Zweifel das DEB-Paket verwenden. Ein verschobenes oder gelöschtes AppImage kann eine externe Desktop-Verknüpfung ungültig machen.

Eine manuell angelegte Desktop-Datei gehört nach `~/.local/share/applications/`. Beispiel für einen Pfad mit Leerzeichen; Pfad und Icon gegebenenfalls anpassen:

```ini
[Desktop Entry]
Type=Application
Name=PDF Viewer
Exec="/home/NAME/Programme/PDF Viewer.AppImage" %F
MimeType=application/pdf;
Terminal=false
Categories=Office;Viewer;
```

Anschließend muss der Desktop die neue Datei erkennen; gegebenenfalls ab- und anmelden. Danach wie beim DEB über **Öffnen mit** als Standard wählen. Die App installiert diese benutzerspezifische Datei nicht ungefragt.

## macOS

1. Das passende Intel- oder Apple-Silicon-DMG öffnen und PDF Viewer nach **Programme** kopieren.
2. Im Finder eine PDF auswählen → **Informationen** (`Cmd+I`) → **Öffnen mit** → **PDF Viewer**.
3. Für eine einzelne Datei reicht die Auswahl; für alle PDFs **Alle ändern …** bestätigen.

Der App-Bundle deklariert den PDF-Dokumenttyp mit `CFBundleDocumentTypes`, Rolle `Editor` und Rang `Alternate`. Finder beziehungsweise Launch Services übergeben Dokumente beim Kaltstart und an die laufende App. Ein App-Start allein ändert keinen Standard.

Auf macOS öffnet eine weitere Finder-PDF ein eigenes Fenster; bereits offene Dokumente bleiben erhalten. **Datei → Neues Fenster / ⌘N** erzeugt ein leeres Fenster. Ein Austausch über **PDF öffnen** innerhalb desselben Fensters fragt weiterhin nach ungesicherten Änderungen. [Mehrfenster-Bedienung und Abnahme](MULTIPLE_WINDOWS.md).

## Android

1. Die APK installieren. Temporär signierte Builds erscheinen als **PDF Viewer Test** und können neben der Haupt-App installiert bleiben.
2. In Samsung **Eigene Dateien**, **Downloads** oder einem anderen Dateimanager eine PDF öffnen → **PDF Viewer** beziehungsweise **PDF Viewer Test** wählen → **Immer** bestätigen, sofern der Dateimanager diese Wahl anbietet.
3. Öffnet sich bereits eine andere App ohne Nachfrage, deren bisherige Standardzuordnung über **Einstellungen → Apps → [bisherige PDF-App] → Als Standard festgelegt/Standardmäßig öffnen** löschen. Danach die PDF erneut öffnen und auswählen. Bezeichnungen unterscheiden sich nach Android-/One-UI-Version.

Die App registriert einen von Tauri generierten `ACTION_VIEW`-Filter für `application/pdf`. Android übergibt häufig eine freigegebene `content://`-URI statt eines normalen Pfads. Die App liest sie über den `ContentResolver`; allgemeine Speicherberechtigungen sind dafür nicht nötig. Verweigert ein Anbieter den Zugriff oder ist die Freigabe abgelaufen, die PDF aus der Quell-App erneut öffnen. Eine ausdrückliche App-Auswahl der Quell-App kann die Standardauswahl des Systems umgehen.

**Öffnen mit** und das Teilen eines Dokuments sind unterschiedliche Android-Aktionen. Die Registrierung verspricht keinen allgemeinen Share-Target für beliebige Dateien oder Weblinks. Andere Apps müssen eine lesbare PDF über die unterstützte Öffnungsaktion übergeben.

## iOS / iPadOS

Der neue iOS-Build setzt iOS/iPadOS 17 oder neuer voraus, damit die vorhandenen kompakten Popover-Menüs unterstützt werden. Die App registriert `com.adobe.pdf` in `CFBundleDocumentTypes`. In der **Dateien-App** beziehungsweise in einer anderen dokumentfähigen App die verfügbaren Dateiaktionen oder **Teilen/Öffnen in** aufrufen und **PDF Viewer** auswählen. Welche Aktion angezeigt wird und ob sich eine bevorzugte App festlegen lässt, hängt von iOS-Version und Quell-App ab. Das ist keine pauschale Zusage einer Windows-ähnlichen systemweiten Standardzuordnung; die App setzt keinen globalen Standard selbst.

Die App fordert mit `LSSupportsOpeningDocumentsInPlace=false` bewusst den offiziellen Importkopie-Modus an: UIKit übergibt eine Kopie in der eigenen Inbox. Es wird kein Zugriff auf eine externe Originaldatei über eine bloß rekonstruierte URL vorausgesetzt. Übergebene Dateien werden koordiniert gelesen; für Dateien außerhalb des App-Containers wird ein gegebenenfalls erforderlicher Security-Scope nur für das Lesen gehalten und anschließend freigegeben. Die PDF wird als private, begrenzte Arbeitskopie an die gemeinsame Importfunktion übergeben. Das Original wird beim Öffnen nicht verändert.

Ein iOS-Simulator-Build ist nicht auf einem iPhone oder iPad installierbar. Reale Geräte benötigen einen dafür signierten Build und eine passende Apple-Distribution, beispielsweise TestFlight. Simulator-/Cloud-Ergebnisse und offene Signierungs- oder Geräteprüfungen werden im PR getrennt ausgewiesen; ein erfolgreicher Simulator-Build behauptet keine fertige Geräteverteilung.

Der Prototyp besitzt außerdem noch keinen nativen iOS-Speicherweg. Die Speicherung ist dort ausdrücklich deaktiviert, einschließlich Tastaturkürzel. Android, Desktop und Browser behalten ihre bestehenden Speicherfunktionen. Der iOS-Build ist damit noch kein produktiver Ersatz für einen vollständigen PDF-Editor auf iPhone/iPad.

## Gemeinsamer Öffnungsablauf

- Betriebssystemereignisse werden nativ gepuffert, auch wenn React beim Kaltstart noch nicht bereit ist. Windows/Linux verwenden Startargumente und das offizielle Single-Instance-Plugin; macOS, Android und iOS nutzen Tauri `RunEvent::Opened`.
- Quellen werden nach dem OS-Ereignis bereits im Hintergrund gesichert, unabhängig davon, wann React bereit ist. Die Übergabe ans Frontend erfolgt sequenziell über eine auf 32 ausstehende Einträge und 200 MiB gesicherte Daten begrenzte Warteschlange und kleine Datenblöcke. Bei Überschreitung erscheint ein Hinweis zum erneuten einzelnen Öffnen. JavaScript erhält keinen beliebigen Pfad-/URI-Lesebefehl.
- Doppelte noch ausstehende Übergaben werden zusammengefasst. Ein späteres bewusstes erneutes Öffnen derselben Datei bleibt möglich.
- Die bestehende Funktion `open(file: File)` liest und prüft die PDF mit dem bisherigen MuPDF-Worker. Es gibt keine zweite PDF-Engine oder Importpipeline.
- Bei laufender Speicherung/Bearbeitung wartet die externe Öffnung. Ungesicherte Änderungen benötigen vor dem Dokumentwechsel die gemeinsame App-Bestätigung. Der Dialog funktioniert unabhängig von nativen JavaScript-Confirm-Panels; Abbrechen ist zunächst fokussiert und Escape bricht ab. Abbrechen erhält das bisherige Dokument.
- Ungültige, unlesbare oder beschädigte PDFs erhalten eine verständliche Fehlermeldung. Ein fehlgeschlagener Wechsel soll das bisherige Dokument und dessen Änderungen erhalten.
- Für den sicheren Wechsel bleibt der bisherige PDF-Worker bis zur erfolgreichen Prüfung des Kandidaten erhalten. Kurzzeitig existieren dadurch zwei Worker und zusätzlicher Speicherbedarf; nach Erfolg wird der alte Worker, nach einem Fehler der Kandidat freigegeben.
- Das Importlimit beträgt weiterhin **100 MiB**. Alle PDF-Verarbeitung bleibt lokal; HTTP-/Weblinks werden nicht als PDF heruntergeladen. Externe Dateianbieter werden nur durch die ausdrückliche Dateiöffnung des Betriebssystems angesprochen.

## Abnahme und Grenzen

Automatisierte Prüfungen müssen echte Paketinhalte und die gemeinsame PDF-Pipeline prüfen. Eine simulierte Frontend-IPC-Antwort ersetzt weder die native URI-Prüfung noch einen Betriebssystemtest. Im PR werden Anzahl und Ergebnis tatsächlich ausgeführter Tests sowie erzeugte Pakete dokumentiert.

Auf jedem echten Zielgerät zusätzlich prüfen:

1. Mit geschlossener App eine synthetische PDF aus dem Dateimanager öffnen.
2. Eine zweite PDF bei laufender App öffnen; Dateinamen mit Leerzeichen, Umlauten und Sonderzeichen verwenden.
3. Im ersten Dokument zeichnen und erneut extern öffnen: **Abbrechen** muss Dokument und Änderungen erhalten, Bestätigen muss wechseln.
4. Eine beschädigte PDF und eine nicht mehr lesbare Freigabe öffnen; kein Absturz und kein stiller Verlust des bisherigen Dokuments.
5. Kommentieren, speichern und die gespeicherte PDF in einem zweiten Viewer sowie erneut im Editor öffnen.
6. Vor und nach Installation beziehungsweise Deinstallation prüfen, dass eine zuvor gewählte andere Standard-App erhalten bleibt. Unter Android außerdem Samsung **Eigene Dateien** und mindestens einen weiteren Anbieter; unter iOS/iPadOS lokale Dateien und einen freigegebenen Dokumentanbieter prüfen.

Quellen: [Tauri-Konfiguration](https://v2.tauri.app/reference/config/), [Tauri Single Instance](https://v2.tauri.app/plugin/single-instance/), [Tauri RunEvent](https://docs.rs/tauri/latest/tauri/enum.RunEvent.html), [Android Intents](https://developer.android.com/guide/components/intents-filters), [Apple CFBundleDocumentTypes](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundledocumenttypes), [Desktop-Exec-Parameter](https://specifications.freedesktop.org/desktop-entry-spec/latest/exec-variables.html).
