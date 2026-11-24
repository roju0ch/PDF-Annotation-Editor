# Installierbare Testversionen vollständig aus GitHub

Eine lokale Entwicklungsumgebung beim Projektinhaber ist nicht erforderlich. GitHub Actions installiert die Compiler, baut die App und stellt herunterladbare Installationsdateien bereit. Der Browser-/Pages-Workflow bleibt erhalten.

## Pakete und Bedienung ohne Compiler

| Plattform           | Paket         | Installation / Voraussetzung                                                                                                                                                               |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows x64         | `.exe` (NSIS) | Installer starten. Enthält den WebView2-Offline-Installer; deshalb wesentlich größer als zuvor. Unterstütztes Windows mit aktuellem WebView2; kein Download der PDF-Bibliothek beim Start. |
| macOS Intel         | `.dmg`        | DMG öffnen, PDF Viewer nach Programme ziehen. Separater x86_64-Build.                                                                                                                      |
| macOS Apple Silicon | `.dmg`        | DMG öffnen, App nach Programme ziehen. Nativer ARM64-Build.                                                                                                                                |
| Linux x64           | `.AppImage`   | Datei ausführbar machen und starten. Auf Ubuntu 22.04 gebaut; benötigt kompatibles Linux/glibc, Grafikstack und gegebenenfalls FUSE 2 bzw. AppImage-Extraktion.                            |
| Debian/Ubuntu x64   | `.deb`        | Über die Paketverwaltung installieren. Fehlende Systemabhängigkeiten, insbesondere WebKitGTK 4.1, müssen dort installiert werden; deren Erstinstallation kann Internet benötigen.          |
| Android ARM64       | `.apk`        | Testinstallation aus erlaubter Quelle. Android API 24+ mit aktuellem System-WebView; keine Play-Store-Veröffentlichung.                                                                    |
| iOS ARM64 Simulator | `.app` im ZIP | Nur für den iOS-Simulator auf einem Mac; kein auf iPhone/iPad installierbares IPA. Native PDF-Registrierung und sicherer Import werden erstmals in CI geprüft.                             |

Nach einem PR-Build: **Actions → Test release pipeline → Lauf → Artifacts → installer-…**. Das heruntergeladene ZIP entpacken und den enthaltenen Installer verwenden. Die Plattform-Manifeste enthalten Version, Commit, Dateigröße, SHA-256 und Signierungsmodus. Artefakte bleiben 14 Tage erhalten. Die aktuellen tatsächlichen Build-Ergebnisse und Einschränkungen stehen im PR; ein vorgesehener Pakettyp allein ist kein Nachweis eines erfolgreichen Builds.

**Mehrere Desktop-Fenster:** Der Desktop-Workflow prüft zwei synthetische PDFs in sichtbaren Fenstern desselben Prozesses. macOS nutzt Launch Services. Windows und Linux prüfen die native Argumentweiterleitung, Linux in einer eigenen D-Bus- und Xvfb-Sitzung. `native-window-tests` wird für die separate Diagnose-App aktiviert. Die herunterladbaren Installer werden vorher regulär gebaut. Signierte Windows- und macOS-Probeläufe überspringen die Diagnose-App. [Bedienung und ergänzende Geräteprüfung](MULTIPLE_WINDOWS.md).

Nach dem Merge kann **Actions → Test release pipeline → Run workflow** alle Pakete erneut erzeugen, ohne etwas zu veröffentlichen. `signed` bleibt zunächst ausgeschaltet. Die eigenständigen Workflows für Desktop und Android sind ebenfalls manuell ausführbar. Der Projektinhaber braucht weder Node noch Rust, Xcode oder Android Studio.

**Dateizuordnung:** Die Pakete deklarieren `.pdf` und `application/pdf`. Windows-NSIS registriert **Öffnen mit** und **Standard-Apps**, ohne die vorhandene Auswahl zu überschreiben. DEB installiert eine Desktop-Datei mit Dateinamenübergabe; die AppImage benötigt zusätzlich eine ausdrückliche Desktop-Integration. macOS/iOS enthalten `CFBundleDocumentTypes`; Android enthält den von Tauri generierten `ACTION_VIEW`-Filter. CI prüft die tatsächlichen Paketinhalte und führt unter Windows sowie Linux zusätzlich Installations-/Deinstallationsprüfungen mit einer vorhandenen PDF-Standardzuordnung aus. Das ersetzt keinen echten Dateiöffnungs-/Gerätetest. [Standardprogramm auf jedem System auswählen](FILE_ASSOCIATIONS.md).

## Freigegebenes Tag und Veröffentlichung

1. Versionsänderung per PR freigeben. `package.json`, beide Versionsstellen in `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` und der eigene Eintrag in `src-tauri/Cargo.lock` müssen übereinstimmen.
2. Nach grünen Tests/Review mergen. Für den ersten Durchlauf ist `0.1.0` vorgesehen. Erlaubt sind ausschließlich `0.x.y` mit Minor/Patch bis 999. Eine spätere stabile 1.x-Veröffentlichung erfordert eine bewusste Änderung des Workflows.
3. Das Tag **v0.1.0** ausdrücklich freigeben und von Codex in der Cloud auf dem gewünschten freigegebenen `main`-Commit erstellen und pushen lassen. Dafür braucht der Eigentümer kein lokales Git. Noch kein Tag im Rahmen des Infrastruktur-PR erzeugen.
4. Der Tag-Push startet dieselben Browserprüfungen sowie alle Paket-Builds. Validierung lehnt unpassende Versionen und Commits außerhalb der `main`-Historie ab. Ein Tag allein umgeht keine fehlgeschlagenen Tests.
5. Erst wenn alle Jobs erfolgreich sind, erhält ausschließlich der Veröffentlichungsjob `contents: write`. Er lädt die Installer aus demselben Lauf, prüft Version/Commit/Inventar und SHA-256 jedes Pakets, erstellt zunächst einen Draft und veröffentlicht danach ausschließlich als **Prerelease**, **nicht Latest**. Die Quellcode-Archive gehören zum selben Git-Tag; die AGPL-Lizenz wird auch den Desktop-Paketen beigelegt.

Kein automatisches Merge und keine stabile Veröffentlichung. `v1.*` startet diesen Workflow nicht. PRs und manuelle Builds haben keinen Veröffentlichungspfad. Veröffentlichte Versionen werden nicht überschrieben. Nach einem Fehler im Upload kann ein unvollständiger Draft verbleiben: prüfen, diesen Draft löschen (nicht das Tag) und den fehlgeschlagenen Lauf erneut starten. Bestehende öffentliche Releases bleiben unangetastet.

Unter **Settings → Rules → Rulesets** empfiehlt sich eine Tag-Regel für `v*`, die Erstellung auf freigabeberechtigte Personen beschränkt und Änderung/Löschung verbietet. Branchschutz/Review für `main` verwenden. Diese Repository-Regeln werden durch den PR nicht automatisch verändert. Ein mit dem normalen Workflow-`GITHUB_TOKEN` gepushtes Tag löst keinen weiteren Workflow aus; Tags deshalb durch einen berechtigten Menschen/Codex-Zugang erstellen, nicht über einen solchen Bot-Token. Eine GitHub-Release-Seite vorab manuell zu veröffentlichen ist nicht Teil dieses Ablaufs.

## Signierung und Notarisierung

Anfangs sind Desktop-Artefakte **unsigniert bzw. auf Apple Silicon ad-hoc-signiert**. Gatekeeper/SmartScreen können sie blockieren oder warnen; eine Prüfsumme ersetzt kein Herausgeberzertifikat. Es gibt keinen Updater und keinen Tauri-Updater-Schlüssel.

Secrets unter **Settings → Secrets and variables → Actions → Secrets** hinterlegen, Schalter unter **Variables**. Keine Schlüssel in Git, Issues, PR-Kommentaren, Logs oder normalen Artefakten. Base64 ist nur eine Transportdarstellung, keine Verschlüsselung. Schlüssel und Passwörter separat sicher sichern. Optional kann die Organisation zusätzlich geschützte GitHub-Environments vorsehen.

### Windows

- `WINDOWS_CERTIFICATE_BASE64`: PFX/P12 mit privatem Code-Signing-Schlüssel, einzeilig Base64.
- `WINDOWS_CERTIFICATE_PASSWORD`: PFX-Passwort.
- Variable `SIGN_WINDOWS=true` erst nach Einrichtung setzen.

Der Windows-Job importiert das Zertifikat in den kurzlebigen Benutzer-Zertifikatsspeicher, erzeugt eine temporäre Tauri-Konfiguration mit Thumbprint, SHA-256 und RFC-3161-Zeitstempel (`timestamp.digicert.com`) und prüft die fertige EXE mit `Get-AuthenticodeSignature`. Die PFX-Datei wird direkt nach dem Import gelöscht. Verlangt der Anbieter HSM/Token/Cloud-Signing statt eines exportierbaren PFX, muss dessen OIDC-/Signierintegration ergänzt werden; dieser PFX-Pfad ersetzt sie nicht. SmartScreen-Reputation ist auch mit gültiger Signatur nicht garantiert.

### macOS

Apple Developer Program, **Developer ID Application**-Zertifikat samt privatem Schlüssel und Berechtigung für Notarisierung erforderlich:

- `APPLE_CERTIFICATE`: P12, einzeilig Base64.
- `APPLE_CERTIFICATE_PASSWORD`: P12-Passwort.
- `APPLE_SIGNING_IDENTITY`: vollständiger Developer-ID-Name inklusive Team-ID.
- `APPLE_API_ISSUER`: Issuer-ID des App-Store-Connect-Teams.
- `APPLE_API_KEY`: Key-ID.
- `APPLE_API_KEY_BASE64`: Inhalt des zugehörigen privaten `.p8`-Schlüssels als Base64.
- Variable `SIGN_MACOS=true`.

Tauri übernimmt Code-Signing und Notarisierung für beide Architekturen. Der Job prüft das angeheftete Notarisierungsticket mit `xcrun stapler validate`. Der `.p8`-Schlüssel wird ausschließlich im temporären Runner-Verzeichnis abgelegt und auch bei Fehlern entfernt. `APPLE_API_KEY_PATH` wird daraus zur Laufzeit erzeugt. Kein persönliches Apple-ID-Passwort speichern.

### Android

Tauri 2 verwendet den gemeinsamen Rust-Library-Einstieg mit `mobile_entry_point`. Der Android-Gradle-Unterbau und die Launcher-Icons aus dem eingecheckten SVG werden mit der im Lockfile fixierten Tauri-CLI in CI neu erzeugt; `src-tauri/gen/` und Build-Verzeichnisse bleiben aus Git ausgeschlossen. Compile-SDK 36, Build Tools 35, NDK 28 und Java 17 werden im Runner installiert. Zunächst wird nur `aarch64` gebaut; kein x86-Emulator- oder 32-Bit-APK.

Jede installierbare APK braucht eine Signatur. Ohne eigene Secrets erzeugt CI einen **neuen 30 Tage gültigen Testschlüssel pro Lauf**, signiert die Release-APK, prüft `apksigner verify` und 16-KB-Zip-Ausrichtung und verwirft den privaten Schlüssel. Diese APKs heißen **PDF Viewer Test** und verwenden die Produktionskennung mit zusätzlichem `.test`. So können sie neben der bisherigen Haupt-App installiert werden. `android-config.mjs` liefert dieselbe Konfiguration an Init und Build; vor Artefaktfreigabe wird die tatsächliche Paketkennung aus `aapt dump badging` geprüft. Dauerhaft signierte Builds behalten die ursprüngliche Produktionskennung.

**Updates zwischen temporären Testläufen benötigen weiterhin eine Deinstallation der Test-App**, weil deren Schlüssel wechselt; vorher deren PDFs speichern. Die Haupt-App muss dafür nicht entfernt werden. Ungesicherte Inhalte einer alten App werden nicht automatisch übernommen; ein privater temporärer Export-Cache ist kein Recovery-Journal. Nicht als dauerhaft verteilte Android-Version verwenden.

Für dauerhaft aktualisierbare APKs einmal einen eigenen Schlüssel erzeugen (z. B. in einem vertrauenswürdigen Cloud-Terminal mit `keytool -genkeypair -keystore release.jks -alias pdf-editor -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS`; Passwörter interaktiv eingeben). Den Schlüssel sicher herunterladen/sichern, aus dem Cloud-Arbeitsverzeichnis entfernen und über GitHub als Secrets hinterlegen. Niemals als Workflow-Artefakt veröffentlichen. Die Erzeugung und Sicherung eines langfristigen privaten Schlüssels erfolgt durch den Verantwortlichen; der Infrastruktur-PR erzeugt keinen solchen Schlüssel.

- `ANDROID_KEYSTORE_BASE64`: JKS/P12 als einzeiliges Base64.
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- Variable `SIGN_ANDROID=true`.

`sign-android.sh` benutzt dann ausschließlich diesen Schlüssel; fehlende Secrets führen zum Fehler, nicht zum stillen Wechsel auf einen Testschlüssel. Der öffentliche Zertifikat-Fingerprint steht im Prüflog; vor dauerhafter Verteilung gegen die eigene gesicherte Identität prüfen. Für Updates Paket-ID und Schlüssel beibehalten und Versionsnummer/versionCode erhöhen. Tauri leitet den versionCode aus Major/Minor/Patch ab; Tags werden nicht wiederverwendet. Für Play Store sind AAB, Play App Signing und weitere Geräte-/Policy-Prüfungen gesondert einzurichten; hier ist nur APK/Sideload vorgesehen.

### iOS / iPadOS

Der Workflow **iOS simulator PDF handler** verwendet den fixierten Tauri-CLI, erzeugt das Xcode-Projekt in GitHub Actions und baut mit `--target aarch64-sim --no-sign`. Er führt Swift-Tests des begrenzten, Security-Scope-/`NSFileCoordinator`-gestützten PDF-Lesepfads aus und prüft die tatsächliche Simulator-App auf PDF-Dokumenttyp, Rolle `Editor`, Rang `Alternate` sowie den offiziellen Importkopie-Modus (`LSSupportsOpeningDocumentsInPlace=false`). UIKit kopiert übergebene Dokumente dabei regulär in die eigene Inbox, bevor die gemeinsame Pipeline sie verarbeitet; das Original wird nicht bearbeitet. Die App verwendet den von der geprüften Tauri-Version unterstützten Legacy-URL-Lifecycle; ein `UIApplicationSceneManifest` würde in der geprüften Tao-Version die initialen Datei-URLs verlieren und wird daher in CI ausgeschlossen.

`ios-simulator-app-and-test-evidence` ist ein Simulator-Artefakt, kein installierbares Gerätepaket. Es wird nicht als iPhone-Installer in ein GitHub Release aufgenommen. Der Simulator-Build benötigt keine im Repository hinterlegten Apple-Zugangsdaten. Reale Geräteverteilung benötigt eine Apple-Team-ID, ein passendes Signierungszertifikat und Provisioning-Profil sowie einen dafür eingerichteten Geräte-/TestFlight-Workflow. Diese Zugangsdaten gehören ausschließlich in geschützte GitHub-Secrets; eine private Schlüsseldatei darf weder eingecheckt noch als allgemeines Artefakt verteilt werden. Dieser PR richtet keine automatische App-Store-Veröffentlichung ein.

Der erstmals bereitgestellte iOS-Importprototyp besitzt noch keinen nativen Speicherweg. Die Speichersteuerung ist dort klar deaktiviert, statt einen WebView-Download als Speichern auszugeben. Die übrigen Plattformen behalten ihre bestehenden Speicherfunktionen. Für produktive iPhone-/iPad-Bearbeitung sind Speicherung, signierter Gerätebuild und die echte Dateien-App-/Dokumentanbieter-Abnahme noch erforderlich.

### Signierung vor einer Tag-Freigabe prüfen

Nach Hinterlegen der Secrets und passenden `SIGN_*`-Variablen den Release-Workflow manuell mit `signed=true` ausführen. Das ist weiterhin ein reiner Artefakt-Build ohne Veröffentlichung. Erst nach Prüfung von Identität, Signaturen/Notarisierung und Installation das Versions-Tag freigeben. Im Infrastruktur-PR stehen keine privaten Zertifikate zur Verfügung; deren erfolgreiche Verwendung darf daher nicht behauptet werden.

## Offline-Nutzung und Grenzen

`frontendDist=../dist`, relative Vite-Pfade und lokal eingebundene MuPDF-WASM-/Worker-Dateien machen die installierte App unabhängig von GitHub Pages oder einem laufenden Entwicklungsserver. PDF-Dateien bleiben auf dem Gerät. Keine CDN-Laufzeitbibliotheken, keine Anmeldung, Telemetrie oder Online-Konvertierung. Internet wird für den CI-Build und den einmaligen Paketdownload benötigt, danach nicht zum Öffnen, Kommentieren und Exportieren von PDFs. Optionale Quellcode-Links sind selbstverständlich offline nicht erreichbar.

`tests/e2e/offline.spec.ts` startet einen frischen Browserkontext, stellt ausschließlich die tatsächlichen `dist`-Dateien wie ein lokaler App-Asset-Server bereit, lädt Worker/WASM kalt und prüft PDF-Anzeige, native Annotation und Export. Jeder andere Zugriff wird abgewiesen; die Test-Origin ist absichtlich nicht auflösbar. Chromium verwendet zusätzlich den Browser-Offline-Schalter. Firefox verweigert damit bereits die Navigation vor der lokalen Bereitstellung und verwendet deshalb ausschließlich die vollständige Request-Abfangung ohne diesen Schalter. Der Test ersetzt weder eine Betriebssysteminstallation noch eine Geräteprüfung. Windows enthält den WebView2-Offline-Installer; macOS nutzt das System-WebKit, Android den System-WebView. Linux-DEB-Pakete haben Systemabhängigkeiten; AppImage bündelt mehr Bibliotheken, ist aber kein vollständiges Betriebssystem. Kein pauschales Versprechen für beliebige alte WebViews, Distributionen oder CPUs.

Die Android-App berücksichtigt Status-/Navigationsleisten und Displayausschnitte über native WindowInsets. „Bild aus Zwischenablage“ liest PNG/JPEG über einen lokalen Android-Plugin aus freigegebenen content://-URIs; es verlangt keine Browser-Clipboard-Freigabe und keine allgemeinen Speicherrechte. Der Zugriff erfolgt ausschließlich nach dem Einfügebefehl bei fokussierter App. Abgelaufene URI-Freigaben benötigen erneutes Kopieren oder den Bild-Dateidialog. Die Android-Dateiauswahl, Blob-Download-/Exportübergabe, Zwischenablage und Gesten müssen weiterhin auf einem realen Gerät geprüft werden. [Android-Prüfung und Fehlergrenzen](ANDROID.md). Ein erfolgreich signiertes APK beweist noch keine vollständige Android-Bedienung. Desktop-Installationen und Betriebssystem-Sicherheitsdialoge sind ebenfalls separat zu prüfen. Das Browser-Pages-Angebot bleibt zunächst ohne Offline-PWA; die Offline-Zusage in diesem Schritt bezieht sich auf installierte Pakete und deren eingebettete Dateien.
