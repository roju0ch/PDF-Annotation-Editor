# Android: Speichern, Systemleisten und kopierte Bilder

Die erste Android-Test-APK ließ die obere Werkzeugleiste unter die Statusleiste laufen. Außerdem verwendet der Android-WebView die Browser-Zwischenablage nicht zuverlässig für Bilder. Die App berücksichtigt deshalb die tatsächlichen Android-WindowInsets am nativen Content-Host und liest kopierte Bilder über den lokalen Plugin `tauri-plugin-android-bridge`.

## Am Gerät prüfen

Die neue APK aus dem zugehörigen PR-Lauf herunterladen: **Actions → Test release pipeline → Artifacts → installer-android-arm64-test**. ZIP entpacken und APK installieren. Temporär signierte Builds heißen jetzt **PDF Viewer Test** und verwenden die separate Kennung `io.github.roju0ch.pdfannotationeditor.test`. Die bisherige Haupt-App kann installiert bleiben. Bei weiteren Testläufen wechselt der Testschlüssel; vor einer nötigen Deinstallation ausschließlich der Test-App deren wichtige PDFs sichern. Die Test-App übernimmt keine ungesicherten Inhalte aus der Haupt-App. Für dauerhaft aktualisierbare APKs einen eigenen Signierungsschlüssel gemäß [Release-Anleitung](RELEASES.md) einrichten.

## Speichern unter

**PDF speichern unter …** öffnet nach dem PDF-Export die Android-Dateiauswahl. Dort Ordner und Namen wählen und bestätigen. Die App prüft anschließend die geschriebene Datei und zeigt erst dann **PDF gespeichert: …**. Der Speicherort ist der selbst gewählte Ordner, kein verstecktes App-Verzeichnis. Abbrechen, verweigerte Rechte, fehlender Platz und fehlerhafte Dokumentanbieter dürfen keine Bestätigung erzeugen; die Änderungen bleiben ungesichert. [Speicherwege, Browserunterschiede und Grenzen](SAVING.md).

Am Gerät eine synthetische PDF kommentieren, lokal in einen gewählten Ordner speichern, die Datei in einer anderen PDF-App öffnen und wieder in den Editor laden. Zusätzlich Abbrechen und einen nicht beschreibbaren Speicherort prüfen. Ein erfolgreicher Cloud-Build oder eine simulierte IPC-Antwort ersetzt diese Geräteprüfung nicht.

## Systemleisten und Zwischenablage prüfen

1. PDF öffnen. Die Werkzeugleiste muss unterhalb von Uhr/Akku beginnen; die untere Leiste darf nicht unter der Gesten-/Navigationsleiste liegen. Hoch- und Querformat testen, einschließlich Displayausschnitt.
2. Einen Screenshot oder ein PNG/JPEG aus einer anderen App tatsächlich **kopieren**. Ein gespeicherter Screenshot liegt je nach Android-App noch nicht automatisch in der Zwischenablage.
3. Im Auswahlwerkzeug lange auf die gewünschte Stelle des PDF drücken → **Bild aus Zwischenablage**. Das Bild muss als auswählbare Bildannotation erscheinen, sich verschieben/vergrößern lassen und nach PDF-Export/erneutem Öffnen erhalten bleiben.
4. Mit leerer Zwischenablage, kopiertem Text und erneut kopiertem Bild wiederholen. Nach einem Fehler darf kein altes oder zusätzliches Bild eingefügt werden.

Androids Tastatur-Zwischenablage kann einen Verlauf anzeigen; der Plugin liest ausschließlich den aktuellen primären System-Clip. Stellt die Quell-App nur Text, einen Weblink oder keine lesbare Bild-URI bereit, lässt sich daraus kein Bild lesen. Bei entzogener/abgelaufener Freigabe erneut kopieren oder **Bild einfügen …** zur Dateiauswahl verwenden. Es werden keine Weblinks abgerufen und keine allgemeinen Foto-/Speicherberechtigungen angefordert. Die bisherigen Browserfunktionen bleiben bestehen.

## Technische Prüfung

- Native Android-Systemleisten, Displayausschnitte und seitliche Navigation werden über `WindowInsetsCompat` berücksichtigt, auch bei Rotation und wiederholter WebView-Initialisierung. Zwei Robolectric-Regressionstests prüfen dabei Padding, Cutouts und die Weitergabe der Tastatur-Insets. Bereits behandelte Insets werden nicht ein zweites Mal an den WebView gegeben; Tastatur-Insets bleiben erhalten. Browser verwenden zusätzlich die CSS-Safe-Areas.
- Die Zwischenablage wird nur auf ausdrücklichen Einfügebefehl bei fokussierter App gelesen. Bilder und URIs werden weder geloggt noch an einen Server übertragen. Nur freigegebene lokale `content://`-URIs, PNG/JPEG, maximal 20 MiB, 20 Megapixel und 16.384 Pixel je Seite. Dimensionsprüfung vor Rasterallokation und erneute Bildprüfung im PDF-Importer.
- Kotlin/Robolectric-Tests verwenden einen echten Android-ContentResolver mit synthetischem Testprovider für PNG/JPEG, fehlende oder entzogene URI-Freigaben, Text/Web-/Datei-URIs, ungültige Daten und Größenlimits. CI führt `:tauri-plugin-android-bridge:testDebugUnitTest` nach dem APK-Build aus und sichert JUnit-Ergebnisse unter `android-native-test-evidence`.
- Vitest prüft die Plattformauswahl, Nutzdatenvalidierung und Fehlermeldungen. Playwright prüft Safe-Area-Grenzen in Hoch-/Querformat und den vollständigen Ablauf vom nativen IPC-Antwortformat über Bildannotation bis zum PDF-Export. Dabei wird die IPC-Antwort simuliert; das ersetzt weder den Kotlin-Test noch die reale Geräteprüfung.

Die Installation der ersten Test-APK wurde vom Projektinhaber bestätigt. Die korrigierte Statusleisten-Darstellung, OEM-Zwischenablagen und Datei-/Exportübergabe müssen weiterhin auf einem echten Gerät abgenommen werden; ein erfolgreicher Cloud-Build belegt diese Abläufe allein nicht.
