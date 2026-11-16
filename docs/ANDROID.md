# Android: Systemleisten und kopierte Bilder

Die erste Android-Test-APK ließ die obere Werkzeugleiste unter die Statusleiste laufen. Außerdem verwendet der Android-WebView die Browser-Zwischenablage nicht zuverlässig für Bilder. Die App berücksichtigt deshalb die tatsächlichen Android-WindowInsets am nativen Content-Host und liest kopierte Bilder über den lokalen Plugin `tauri-plugin-android-bridge`.

## Am Gerät prüfen

Die neue APK aus dem zugehörigen PR-Lauf herunterladen: **Actions → Test release pipeline → Artifacts → installer-android-arm64-test**. ZIP entpacken und APK installieren. Bei einem neuen temporären CI-Testschlüssel zuerst wichtige PDF-Änderungen exportieren und die alte Test-App deinstallieren; ein normales Update ist damit nicht möglich. Für dauerhaft aktualisierbare APKs einen eigenen Signierungsschlüssel gemäß [Release-Anleitung](RELEASES.md) einrichten.

1. PDF öffnen. Die Werkzeugleiste muss unterhalb von Uhr/Akku beginnen; die untere Leiste darf nicht unter der Gesten-/Navigationsleiste liegen. Hoch- und Querformat testen, einschließlich Displayausschnitt.
2. Einen Screenshot oder ein PNG/JPEG aus einer anderen App tatsächlich **kopieren**. Ein gespeicherter Screenshot liegt je nach Android-App noch nicht automatisch in der Zwischenablage.
3. Im Auswahlwerkzeug lange auf die gewünschte Stelle des PDF drücken → **Bild aus Zwischenablage**. Das Bild muss als auswählbare Bildannotation erscheinen, sich verschieben/vergrößern lassen und nach PDF-Export/erneutem Öffnen erhalten bleiben.
4. Mit leerer Zwischenablage, kopiertem Text und erneut kopiertem Bild wiederholen. Nach einem Fehler darf kein altes oder zusätzliches Bild eingefügt werden.

Androids Tastatur-Zwischenablage kann einen Verlauf anzeigen; der Plugin liest ausschließlich den aktuellen primären System-Clip. Stellt die Quell-App nur Text, einen Weblink oder keine lesbare Bild-URI bereit, lässt sich daraus kein Bild lesen. Bei entzogener/abgelaufener Freigabe erneut kopieren oder **Bild einfügen …** zur Dateiauswahl verwenden. Es werden keine Weblinks abgerufen und keine allgemeinen Foto-/Speicherberechtigungen angefordert. Die bisherigen Browserfunktionen bleiben bestehen.

## Technische Prüfung

- Native Android-Systemleisten, Displayausschnitte und seitliche Navigation werden über `WindowInsetsCompat` berücksichtigt, auch bei Rotation. Bereits behandelte Insets werden nicht ein zweites Mal an den WebView gegeben; Tastatur-Insets bleiben erhalten. Browser verwenden zusätzlich die CSS-Safe-Areas.
- Die Zwischenablage wird nur auf ausdrücklichen Einfügebefehl bei fokussierter App gelesen. Bilder und URIs werden weder geloggt noch an einen Server übertragen. Nur freigegebene lokale `content://`-URIs, PNG/JPEG, maximal 20 MiB, 20 Megapixel und 16.384 Pixel je Seite. Dimensionsprüfung vor Rasterallokation und erneute Bildprüfung im PDF-Importer.
- Kotlin/Robolectric-Tests verwenden einen echten Android-ContentResolver mit synthetischem Testprovider für PNG/JPEG, fehlende oder entzogene URI-Freigaben, Text/Web-/Datei-URIs, ungültige Daten und Größenlimits. CI führt `:tauri-plugin-android-bridge:testDebugUnitTest` nach dem APK-Build aus und sichert JUnit-Ergebnisse unter `android-native-test-evidence`.
- Vitest prüft die Plattformauswahl, Nutzdatenvalidierung und Fehlermeldungen. Playwright prüft Safe-Area-Grenzen in Hoch-/Querformat und den vollständigen Ablauf vom nativen IPC-Antwortformat über Bildannotation bis zum PDF-Export. Dabei wird die IPC-Antwort simuliert; das ersetzt weder den Kotlin-Test noch die reale Geräteprüfung.

Die Installation der ersten Test-APK wurde vom Projektinhaber bestätigt. Die korrigierte Statusleisten-Darstellung, OEM-Zwischenablagen und Datei-/Exportübergabe müssen weiterhin auf einem echten Gerät abgenommen werden; ein erfolgreicher Cloud-Build belegt diese Abläufe allein nicht.
