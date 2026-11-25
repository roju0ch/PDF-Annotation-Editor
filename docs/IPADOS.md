# PDF Viewer auf dem iPad

Die installierte Tauri-App läuft ab iPadOS 17. Oberfläche, PDF-Worker und MuPDF-WASM sind im App-Bundle enthalten. Öffnen, Bearbeiten und Speichern lokaler PDFs funktionieren ohne Anmeldung und Netzwerk. Ein Dokumentanbieter kann für seine eigenen entfernten Dateien eine Verbindung benötigen. Für einen Offline-Test eine PDF unter **Auf meinem iPad** ablegen.

## PDFs öffnen, bearbeiten und speichern

- In **Dateien** die PDF über **Teilen** oder **Öffnen in** an **PDF Viewer** übergeben. Der konkrete Eintrag hängt vom Dateianbieter ab. Alternativ im Editor **Öffnen** antippen und die PDF im Systemdialog auswählen.
- Die PDF wird als Arbeitskopie importiert. Bei ungesicherten Änderungen fragt die App vor dem Wechsel und vor **Ansicht → Dokument schließen** nach. Ein vom Betriebssystem erzwungenes Beenden kann keinen Dialog anzeigen. Ungesicherte Änderungen werden nach einem Prozessabbruch derzeit nicht automatisch wiederhergestellt.
- **PDF speichern … → Speichern unter …** öffnet den nativen Speicherdialog. Der Dateiname ist vorausgefüllt und lässt sich ändern. Die App schlägt den bekannten bisherigen Ordner vor, soweit der Dokumentdialog ihn nutzen kann. Bei gleicher Datei am Ziel gilt die Konfliktentscheidung der Dateien-App.
- **Original ersetzen …** öffnet den Systemdialog erneut. Wähle das Original mit dem bisherigen Namen und bestätige danach **Original ersetzen**. Die App prüft, ob die Datei seit der Öffnung oder dem letzten bestätigten Speichern verändert wurde. Bei einem ungeeigneten Anbieter bzw. fehlendem Zugriff **Speichern unter …** verwenden.
- Nach Rücklesen vergleicht die App Größe und SHA-256. Erst dann erscheint **PDF gespeichert**. Bei Abbruch, Fehler oder fehlender Rückprüfung bleibt der Status ungesichert. Prüfe bei einer fehlgeschlagenen Rückprüfung, ob der Anbieter bereits eine Kopie angelegt hat, bevor du erneut speicherst.
- Die bisherige Importgrenze liegt bei 100 MB. Für den Export sind bis zu 150 MB zulässig. Native Annotationen bleiben bei einem erneuten Import bearbeitbar, soweit der jeweilige Typ unterstützt wird.

## Apple Pencil und Finger

| Eingabe | Bedienung |
| --- | --- |
| Apple Pencil bei **Freihand** | Zeichnet native PDF-Ink-Striche mit der eingestellten Farbe und Strichbreite. |
| Ein Finger auf freier Fläche | Scrollt oder verschiebt die Ansicht, auch bei aktivem Freihandwerkzeug. |
| Zwei Finger | Verschieben und zoomen. Bei Fingerbearbeitung beendet ein zweiter Finger die laufende Vorschau. |
| Apple Pencil bei **Auswählen / Verschieben** | Wählt eine Annotation aus oder verschiebt sie. **Bereich auswählen** zieht ein Auswahlrechteck. |
| Finger ohne Pencil | Tippen und langes Drücken wählen oder öffnen das Kontextmenü. **Ansicht → Mit Finger zeichnen** aktiviert Freihand per Finger. |

Die App verwendet den von WKWebView gemeldeten Eingabetyp. Während einer aktiven Pencil-Geste ignoriert sie zusätzliche Fingerkontakte. Eine bewusst gestartete Fingergeste funktioniert nach dem Anheben wieder. Das tatsächliche Verhalten bei Handballenkontakt hängt von iPadOS, dem WebView und dem Gerät ab. Druck, Neigung und Pencil-Pro-Spezialfunktionen werden nicht ausgewertet. Maus und externe Tastatur verwenden die bestehenden Bedienwege.

## Auf einem iPad installieren

### Signierter ARM64-Gerätebuild

1. Im Apple Developer Program eine App-ID für `io.github.roju0ch.pdfannotationeditor` anlegen und die UDID des Test-iPads registrieren. Ein Apple-Distribution-Zertifikat einschließlich privatem Schlüssel als passwortgeschützte `.p12` und ein Ad-Hoc-Provisioning-Profil für genau diese App und das Zielgerät bereitstellen.
2. Einen privaten GitHub-Spiegel mit Schreibzugriff und Actions einrichten. Unter **Settings → Environments** die Umgebung `ios-device-signing` mit den gewünschten Freigaberegeln und vertrauenswürdigen Branches einrichten. Die Werte als Environment Secrets hinterlegen.

   | Name | Inhalt |
   | --- | --- |
   | `IOS_APPLE_TEAM_ID` | Apple Developer Team-ID |
   | `IOS_CERTIFICATE` | Base64 der passwortgeschützten `.p12` |
   | `IOS_CERTIFICATE_PASSWORD` | Passwort der `.p12` |
   | `IOS_MOBILE_PROVISION` | Base64 des Ad-Hoc-Profils |

3. **Actions → iPadOS builds and native PDF tests → Run workflow** auswählen, den geprüften Branch wählen und **sign_device** aktivieren. Nach Freigabe und erfolgreicher Signaturprüfung **ipados-arm64-ad-hoc** herunterladen und entpacken.
4. Das registrierte und entsperrte iPad per Kabel mit einem Mac verbinden, dem Mac auf dem iPad vertrauen und das IPA über **Apple Configurator → Hinzufügen → Apps** aus dem lokalen Ordner oder über **Xcode → Window → Devices and Simulators → Installed Apps** installieren. Danach **PDF Viewer** auf dem iPad starten.

Der öffentliche Build prüft die ARM64-Kompilierung ohne Apple-Schlüssel. Der Simulator-Bundle ist für einen ARM64-Mac mit Xcode. Lokale Entwicklungssignierung kann auf einem Mac in Xcode eingerichtet werden. Für TestFlight kann der Verantwortliche mit Zugriff auf App Store Connect ein App-Store-Connect-Archiv signieren, in Xcode Organizer hochladen und einer TestFlight-Gruppe zuweisen. Diese Schritte sind eigenständig und der Workflow löst keine Veröffentlichung aus.

## Abnahme auf einem echten iPad

1. Eine synthetische mehrseitige PDF in **Auf meinem iPad** ablegen. Im Flugmodus vom Editor und aus **Dateien** öffnen. Hoch- und Querformat prüfen.
2. Auf einer gedrehten Seite heranzoomen, mit dem Pencil zeichnen und den Handballen kurz auflegen. Strich auswählen, verschieben, löschen und Undo/Redo prüfen. Danach Scrollen mit einem Finger, Pinch und die Option zum Fingerzeichnen erproben.
3. Eine Kopie mit Leerzeichen und Umlaut im Namen speichern, Dialogabbruch und Rechteentzug erproben, dann die gespeicherte Datei erneut öffnen. Die native Ink-Annotation bearbeiten.
4. Zum Ersetzen eine synthetische Originaldatei erneut auswählen und den Bestätigungsdialog erst abbrechen, dann bestätigen. Zusätzlich eine zwischenzeitlich extern geänderte Datei und einen Dokumentanbieter prüfen, der Ersetzen verweigert.
5. Einen Export und einen Dokumentwechsel mit ungesicherten Änderungen abbrechen. Die Änderungen müssen im Editor erhalten bleiben.

Die Browsertests simulieren Pointer und native IPC. Die Swift-Tests prüfen lokale Dateien und die Simulatorprüfung installiert und startet das echte macOS-/iOS-SDK-Buildprodukt. Vorhandene GitHub-Läufe und die PR-Beschreibung weisen aus, welche Prüfungen tatsächlich gelaufen sind. Apple Pencil, Geräteinstallation und Freigaben einzelner Dateianbieter benötigen eine Abnahme am Gerät.
