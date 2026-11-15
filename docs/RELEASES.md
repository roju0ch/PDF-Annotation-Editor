# Installierbare Testversionen vollständig aus GitHub

Eine lokale Entwicklungsumgebung beim Projektinhaber ist nicht erforderlich. GitHub Actions installiert die Compiler, baut die App und stellt herunterladbare Installationsdateien bereit. Der Browser-/Pages-Workflow bleibt erhalten.

## Pakete und Bedienung ohne Compiler

| Plattform | Paket | Installation / Voraussetzung |
| --- | --- | --- |
| Windows x64 | `.exe` (NSIS) | Installer starten. Enthält den WebView2-Offline-Installer; deshalb wesentlich größer als zuvor. Unterstütztes Windows mit aktuellem WebView2; kein Download der PDF-Bibliothek beim Start. |
| macOS Intel | `.dmg` | DMG öffnen, PDF Viewer nach Programme ziehen. Separater x86_64-Build. |
| macOS Apple Silicon | `.dmg` | DMG öffnen, App nach Programme ziehen. Nativer ARM64-Build. |
| Linux x64 | `.AppImage` | Datei ausführbar machen und starten. Auf Ubuntu 22.04 gebaut; benötigt kompatibles Linux/glibc, Grafikstack und gegebenenfalls FUSE 2 bzw. AppImage-Extraktion. |
| Debian/Ubuntu x64 | `.deb` | Über die Paketverwaltung installieren. Fehlende Systemabhängigkeiten, insbesondere WebKitGTK 4.1, müssen dort installiert werden; deren Erstinstallation kann Internet benötigen. |
| Android ARM64 | `.apk` | Testinstallation aus erlaubter Quelle. Android API 24+ mit aktuellem System-WebView; keine Play-Store-Veröffentlichung. |

Nach einem PR-Build: **Actions → Test release pipeline → Lauf → Artifacts → installer-…**. Das heruntergeladene ZIP entpacken und den enthaltenen Installer verwenden. Die Plattform-Manifeste enthalten Version, Commit, Dateigröße, SHA-256 und Signierungsmodus. Artefakte bleiben 14 Tage erhalten. Die aktuellen tatsächlichen Build-Ergebnisse und Einschränkungen stehen im PR; ein vorgesehener Pakettyp allein ist kein Nachweis eines erfolgreichen Builds.

Nach dem Merge kann **Actions → Test release pipeline → Run workflow** alle Pakete erneut erzeugen, ohne etwas zu veröffentlichen. `signed` bleibt zunächst ausgeschaltet. Die eigenständigen Workflows für Desktop und Android sind ebenfalls manuell ausführbar. Der Projektinhaber braucht weder Node noch Rust, Xcode oder Android Studio.

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

Tauri 2 verwendet den gemeinsamen Rust-Library-Einstieg mit `mobile_entry_point`. Der Android-Gradle-Unterbau wird mit der im Lockfile fixierten Tauri-CLI in CI neu erzeugt; `src-tauri/gen/` und Build-Verzeichnisse bleiben aus Git ausgeschlossen. SDK/Build Tools 35, NDK 28 und Java 17 werden im Runner installiert. Zunächst wird nur `aarch64` gebaut; kein x86-Emulator- oder 32-Bit-APK.

Jede installierbare APK braucht eine Signatur. Ohne eigene Secrets erzeugt CI einen **neuen 30 Tage gültigen Testschlüssel pro Lauf**, signiert die Release-APK, prüft `apksigner verify` und 16-KB-Zip-Ausrichtung und verwirft den privaten Schlüssel. Diese APKs sind ausschließlich Testversionen. **Updates zwischen verschiedenen Testläufen benötigen eine Deinstallation**, weil der Schlüssel wechselt; dabei können lokale App-Daten verloren gehen. Nicht als dauerhaft verteilte Android-Version verwenden.

Für dauerhaft aktualisierbare APKs einmal einen eigenen Schlüssel erzeugen (z. B. in einem vertrauenswürdigen Cloud-Terminal mit `keytool -genkeypair -keystore release.jks -alias pdf-editor -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS`; Passwörter interaktiv eingeben). Den Schlüssel sicher herunterladen/sichern, aus dem Cloud-Arbeitsverzeichnis entfernen und über GitHub als Secrets hinterlegen. Niemals als Workflow-Artefakt veröffentlichen. Die Erzeugung und Sicherung eines langfristigen privaten Schlüssels erfolgt durch den Verantwortlichen; der Infrastruktur-PR erzeugt keinen solchen Schlüssel.

- `ANDROID_KEYSTORE_BASE64`: JKS/P12 als einzeiliges Base64.
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- Variable `SIGN_ANDROID=true`.

`sign-android.sh` benutzt dann ausschließlich diesen Schlüssel; fehlende Secrets führen zum Fehler, nicht zum stillen Wechsel auf einen Testschlüssel. Der öffentliche Zertifikat-Fingerprint steht im Prüflog; vor dauerhafter Verteilung gegen die eigene gesicherte Identität prüfen. Für Updates Paket-ID und Schlüssel beibehalten und Versionsnummer/versionCode erhöhen. Tauri leitet den versionCode aus Major/Minor/Patch ab; Tags werden nicht wiederverwendet. Für Play Store sind AAB, Play App Signing und weitere Geräte-/Policy-Prüfungen gesondert einzurichten; hier ist nur APK/Sideload vorgesehen.

### Signierung vor einer Tag-Freigabe prüfen

Nach Hinterlegen der Secrets und passenden `SIGN_*`-Variablen den Release-Workflow manuell mit `signed=true` ausführen. Das ist weiterhin ein reiner Artefakt-Build ohne Veröffentlichung. Erst nach Prüfung von Identität, Signaturen/Notarisierung und Installation das Versions-Tag freigeben. Im Infrastruktur-PR stehen keine privaten Zertifikate zur Verfügung; deren erfolgreiche Verwendung darf daher nicht behauptet werden.

## Offline-Nutzung und Grenzen

`frontendDist=../dist`, relative Vite-Pfade und lokal eingebundene MuPDF-WASM-/Worker-Dateien machen die installierte App unabhängig von GitHub Pages oder einem laufenden Entwicklungsserver. PDF-Dateien bleiben auf dem Gerät. Keine CDN-Laufzeitbibliotheken, keine Anmeldung, Telemetrie oder Online-Konvertierung. Internet wird für den CI-Build und den einmaligen Paketdownload benötigt, danach nicht zum Öffnen, Kommentieren und Exportieren von PDFs. Optionale Quellcode-Links sind selbstverständlich offline nicht erreichbar.

`tests/e2e/offline.spec.ts` startet einen frischen Browserkontext mit abgeschaltetem Netzwerk, stellt ausschließlich die tatsächlichen `dist`-Dateien wie ein lokaler App-Asset-Server bereit, lädt Worker/WASM kalt und prüft PDF-Anzeige, native Annotation und Export. Der Test ersetzt weder eine Betriebssysteminstallation noch eine Geräteprüfung. Windows enthält den WebView2-Offline-Installer; macOS nutzt das System-WebKit, Android den System-WebView. Linux-DEB-Pakete haben Systemabhängigkeiten; AppImage bündelt mehr Bibliotheken, ist aber kein vollständiges Betriebssystem. Kein pauschales Versprechen für beliebige alte WebViews, Distributionen oder CPUs.

Die Android-Dateiauswahl, Blob-Download-/Exportübergabe, Zwischenablage und Gesten müssen auf einem realen Gerät geprüft und gegebenenfalls über native Tauri-Plugins ergänzt werden. Ein erfolgreich signiertes APK beweist noch keine vollständige Android-Bedienung. Desktop-Installationen und Betriebssystem-Sicherheitsdialoge sind ebenfalls separat zu prüfen. Das Browser-Pages-Angebot bleibt zunächst ohne Offline-PWA; die Offline-Zusage in diesem Schritt bezieht sich auf installierte Pakete und deren eingebettete Dateien.
