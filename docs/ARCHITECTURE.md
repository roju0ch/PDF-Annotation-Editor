# Architekturkonzept v0.2

## Leitgedanken
Eine schlanke, offlinefähige PDF-Anwendung: gemeinsamer TypeScript-Codekern für Browser und Tauri 2, ohne Server. Die PDF-Engine wird über einen Adapter integriert, damit sich die Implementierung nach dem Machbarkeitstest austauschen lässt. **MuPDF.js ist ein Kandidat, noch keine bestätigte Produktentscheidung.**

## Modulgrenzen
- `app/`: App-Shell, Toolbar, Seitenanzeige, Statusleiste, responsive Layouts.
- `core/document/`: Öffnen/Schliessen, Dokumentlebenszyklus, Seitenmetadaten, Fehlerbehandlung.
- `core/render/`: Renderplaner, Bitmap-/Tile-Caching, Renderauflösung, Priorisierung.
- `core/viewport/`: Transformationsmatrizen, Zoom-Anker, Pan, Fit-Page/Fit-Width, Rotation.
- `core/input/`: Pointer-, Maus-, Trackpad-, Touch- und Tastaturbefehle; Konfiguration.
- `core/annotations/`: Annotationsmodell, Interaktionszustand, Auswahl, Schreiboperationen, Undo/Redo, native Annotationen.
- `core/eraser/`: Geometrische Teilradierung von Ink-Punktlisten, Toleranzen, Segmentbildung.
- `core/storage/`: Öffnen, Speichern, Export, atomarer Austausch wo verfügbar, Recovery-Journal, Konflikterkennung.
- `adapters/pdf/`: PDF-Engine-Abstraktion und MuPDF.js-Implementierung (unter Vorbehalt von Test/Lizenz).
- `adapters/platform/`: Browser-Dateisystem/Download und Tauri-Dateidialoge/-Speicherung.

## PDF-Rendering
Die Darstellung von Dokumentseiten und temporären Bearbeitungslayern muss unabhängig von der PDF-Persistenz sein. Rendered Canvas/WebGL/Bitmap und eventuelle SVG/HTML-Overlays sind ausschliesslich UI-Darstellungen. Beim Speichern werden echte PDF-Annotationsobjekte geschrieben, keine UI-Overlays flach eingebrannt. Eine eigene Annotations-Overlay-Darstellung darf nicht zur doppelten Darstellung gegenüber den nativen PDF-Appearance-Streams führen.

## Koordinaten und Interaktion
Eine kanonische PDF-Seitenkoordinate pro Annotation; explizite Konvertierung zwischen PDF-Seite, CSS-Pixeln, Device-Pixeln und Viewport. CropBox, Rotationen, Zoom und HiDPI berücksichtigen. Der Cursor-Zoom muss die PDF-Position unter dem Pointer vor und nach dem Skalieren innerhalb einer kleinen Toleranz unverändert lassen. Panning per mittlerer Maustaste darf das ausgewählte Zeichenwerkzeug nicht ändern. Trackpad-Gesten sind geräte-/browserabhängig; Profilwahl und Tests auf echten Geräten vorsehen.

## Native Annotationen
Adaptervertrag u.a.: listAnnotations(page), createAnnotation(page,type,geometry,style), updateAnnotation(id,patch), deleteAnnotation(id), save(document), reload(document). Dokumentierte Abbildung auf echte PDF-Annotationsdictionarys sowie Appearance Streams. Fremdannotationstypen müssen intakt bleiben, auch wenn die UI sie nicht bearbeiten kann. Signaturen/Formulare/verschlüsselte PDFs sind separat zu behandeln.

## Eraser
Der Teilradierer wirkt nur auf Ink-Annotationen, nicht auf unveränderliche Seiteninhalte. Geometrie auf PDF-Seitenkoordinaten normieren, für Radiererbreite und Ink-Strichbreite segmentweise schneiden, neue Teilpfade erzeugen; originale Attribute übernehmen. Ganze Operation als Undo/Redo-Transaktion implementieren. Präzision/Interoperabilität im POC prüfen.

## Dateispeicherung
- Browser: File API zum Öffnen; Save-As als Download und – nur wenn unterstützt und autorisiert – direkte Dateisystemschreiboperationen. UI benennt Unterschiede deutlich.
- Desktop: Tauri-Plugins mit minimalen Rechten; sichere Speicherung und externe Änderungsprüfung.
- Recovery: lokales, dokumentbezogenes Journal mit Versions-/Hash-Bezug, getrennt vom Original; erfolgreich gespeicherte Operationen atomar als abgeschlossen markieren.
- Keine Fernverarbeitung von Dokumentinhalten.

## Cloud-/CI-Architektur
- Pull-Request-CI: Install mit Lockfile, Typecheck, Lint, Unit-Tests, Build.
- Browser-Preview auf GitHub Pages nach gesonderter Freischaltung der Pages-Einstellung; veröffentlichte App enthält niemals Test-PDFs mit vertraulichen Inhalten.
- Desktop-Build-Matrix: Windows/macOS/Linux über GitHub Actions, vorerst unsignierte Testartefakte. Build-Fehler nicht verschweigen; Plattformen einzeln dokumentieren.
- Cache und Artifacts möglichst sparsam, restriktive Token-Permissions und keine ungesicherten Secret-Ausgaben.
- Mac-Signierung/Notarisierung, iOS-Distribution und Android-Store-Publishing sind getrennte spätere Prozesse, die Konten/Zertifikate erfordern können.

## Architekturentscheidungen / Risiken
1. **MuPDF.js AGPL-3.0:** Versionsverfügbarkeit und Lizenzbedingungen inkl. Einbindung/Redistribution prüfen. Keine kommerziellen Lizenzen kaufen ohne Freigabe.
2. **Browser-Unterstützung:** WebAssembly-Artefakte korrekt bundlen; GitHub-Pages-Unterpfad `/PDF-Annotation-Editor/` beachten.
3. **Performance:** Test mit grossen A0-Plänen und mehrseitigen PDFs; unnötige Full-Document-Renderzyklen vermeiden.
4. **Signaturfreie Builds:** macOS Gatekeeper und Windows SmartScreen können Warnungen anzeigen; keine stillschweigende Kompatibilitätszusage.
5. **Annotationen:** Interoperabilität und natives Speichern im M1-Prototyp belegen, nicht nur API-Dokumentation zitieren.
