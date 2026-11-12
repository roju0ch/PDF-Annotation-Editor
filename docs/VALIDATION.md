# Auftrag 001 – Validierung

Stand: 12. November 2026. Alle hier ausgeführten Tests liefen in Codex Cloud. GitHub-Status und Vorschau werden nach dem Push ergänzt.

## Tatsächlich ausgeführt

- Node.js 24.22.1, npm 11.9.0, MuPDF.js 1.28.6.
- Strikter TypeScript-Build und ESLint: erfolgreich.
- Vitest: 8 erfolgreiche Prüfungen für wiederholten Zoom, Zoomgrenzen, affine Rücktransformationen, vier Seitenorientierungen, CropBox, Fit Page/Fit Width und Wheel-Einheiten.
- Playwright mit installiertem Chromium: 2 erfolgreiche Browser-Szenarien auf dem Produktionsbuild unter dem GitHub-Pages-Unterpfad. Geprüft: echte farbige PDF-Pixel, drei unterschiedlich große Seiten einschließlich A0, 90°-Rotation mit CropBox, Zoom-Anker, Mittelmaus- und Leertasten-Pan, fortlaufende Ansicht, Trackpad-Profil/Ctrl-Zoom, Dateiwechsel, Ablehnung ungültiger und verschlüsselter Dateien. Netzwerkbeobachtung bestätigt ausschließlich lokale GET-Anfragen im Viewer-Szenario.
- Separater MuPDF-POC: Ink, Text und FreeText erzeugen → speichern → erneut öffnen → Typ/Appearance prüfen → verändern → erneut speichern/öffnen. Alle Assertions bestanden. Vorhandene Notiz eines unabhängigen synthetischen PDF-Schreibers bearbeitet; nicht behandelte Link-Annotation und unveränderter Seiten-Content-Stream nachgewiesen. Ink als zwei native Teilpfade gespeichert.
- Poppler `pdfinfo` erkennt die gespeicherte PDF mit drei Seiten; `pdftoppm` rendert Seite 1 mit Notizen, getrennten Ink-Strichen und FreeText. Bild visuell geprüft. Fontconfig meldete ein nicht schreibbares Cacheverzeichnis, die Ausgabe wurde dennoch erzeugt. Dies ist ein unabhängiger Renderer-Nachweis, kein Acrobat-Test.

Der erste Browsertest deckte verlorene Anfragen während der asynchronen WASM-Initialisierung auf. Ein expliziter Worker-Handshake behebt das Problem; beide Szenarien wurden danach erfolgreich ausgeführt.

## Reproduzierbare Nachweise

`npm run poc` erzeugt in `artifacts/` ausschließlich synthetische Dateien: `fixture.pdf`, `encrypted.pdf`, `annotations-created.pdf`, `annotations-roundtrip.pdf` und `poc-results.json`. `npm run test:e2e` erzeugt den Browserbericht und `viewer.png`. Diese Dateien werden nicht ins Repository eingecheckt; CI stellt sie als Artefakt bereit.

Die Fixture wird ohne MuPDF geschrieben und enthält eine bestehende Text- und Link-Annotation. Sie ersetzt keine Prüfung einer von Acrobat oder Bluebeam erzeugten Datei. Der Ink-POC zeigt die native Speicherung bereits berechneter Teilpfade; ein allgemeiner geometrischer Teilradierer ist noch nicht implementiert.

## Noch offene Abnahme

- Adobe Acrobat sowie ein zweites interaktives Fremdprogramm: nicht ausgeführt. M1 ist daher noch nicht vollständig abgenommen.
- Physische Maus-/Trackpad-/Touch-Geräte, Safari/Firefox und mobile Plattformen: nicht geprüft.
- Reale große technische Pläne, Renderzeit-/Speicherbudgets, viele komplexe Vektoren: noch zu messen. Die A0-Fixture ist bewusst einfach und belegt keine allgemeine Performancezusage.
- Desktop: Tauri-Grundgerüst und getrennte Build-Matrix vorhanden. In dieser Cloud-Maschine fehlten zunächst Rust und WebKit-Entwicklungspakete; native Pakete und Laufzeit müssen separat validiert werden. Kein Signing und keine Notarisierung.
- Browser-Vorschau und tatsächliche GitHub-CI-Ergebnisse: siehe nachfolgende Aktualisierung, sobald verfügbar.

## GitHub Pages

Die Aktivierung über die GitHub-API wurde versucht und mit **HTTP 403 – Resource not accessible by integration** abgelehnt. Deshalb ist noch keine öffentliche Vorschau aktiv. Ein Repository-Administrator muss einmalig **Settings → Pages → Build and deployment → Source: GitHub Actions** auswählen. Der vorbereitete Workflow veröffentlicht nach Merge auf `main` oder manuellem Start; dies erfordert keinen lokalen Build. Es wurde nichts nach `main` gemergt.
