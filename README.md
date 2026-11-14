# PDF Annotation Editor

Ein lokaler PDF-Viewer und Annotationsprototyp mit React, TypeScript und MuPDF.js. PDFs werden ausschließlich auf Ihrem Gerät verarbeitet. Es gibt keinen Upload, kein Konto und keine Telemetrie.

## Im Browser ausprobieren

Die [Browser-Vorschau](https://roju0ch.github.io/PDF-Annotation-Editor/) zeigt den zuletzt freigegebenen Stand auf `main` und wird durch den Workflow **Browser preview** auf GitHub Pages bereitgestellt. Der Viewer-Grundstand ist in [docs/VALIDATION.md](docs/VALIDATION.md) dokumentiert; der Annotationsschritt in [docs/ANNOTATIONS.md](docs/ANNOTATIONS.md). Neue Funktionen eines offenen PR erscheinen erst nach dessen Merge. Die Webseite enthält nur App-Dateien, keine von Ihnen geöffneten PDFs. Zum ersten Laden wird Internet benötigt; eine installierbare Offline-PWA ist noch nicht enthalten.

1. Vorschau öffnen, **PDF öffnen** wählen oder eine Datei auf die Arbeitsfläche ziehen.
2. Mit dem Mausrad direkt zur Mausposition zoomen. Mittlere Maustaste gedrückt halten und ziehen, alternativ Leertaste + linke Maustaste.
3. Die Schaltfläche mit **Seitenzahl und Zoom** öffnet Ansicht und Navigation. Für Trackpads dort das Profil **Trackpad: Scrollen** wählen: Zwei-Finger-Scrollen bewegt die Seite, Pinch bzw. Ctrl+Rad zoomt. Das Profil wird lokal gespeichert. Automatische Geräteerkennung wäre unzuverlässig.
4. Im selben Menü Seiten über Pfeile oder Seitennummer wechseln. **Seite einpassen**, **Breite** und **Fortlaufend** stehen zur Verfügung.

5. Die **Werkzeugsymbole** wählen direkt Auswahl, Freihand, Notiz, Textfeld oder Ink-Teilradierer; das Bildsymbol öffnet die Bilddateiauswahl. Das aktive Werkzeug ist hervorgehoben. Hinweise erscheinen beim Darüberfahren und bei Tastaturfokus. Über das **Reglersymbol (Werkzeugeigenschaften)** Farbe, Strichbreite, Text oder Schriftgröße passend zum Zeichenwerkzeug einstellen, das Menü mit **×** schließen und auf der PDF arbeiten.
6. **Auswählen / Verschieben** verwenden: Auf freier Fläche eine Auswahlbox ziehen. Bereits berührte Markierungen werden ausgewählt; sie müssen nicht vollständig in der Box liegen. An einer ausgewählten Markierung ziehen, um die ganze Gruppe zu verschieben. **Rückgängig** nimmt die Gruppenbewegung in einem Schritt zurück. Ein Klick auf freie Fläche hebt die Auswahl auf. Alternativ über das **Listensymbol** die Annotationen öffnen und ein einzelnes Objekt auswählen. Inhalt/Eigenschaften ändern und **Übernehmen** wählen. Änderungen können rückgängig gemacht und wiederholt werden. Gesperrte oder nicht unterstützte Objekte bleiben erhalten.
7. **Ink-Teilradierer (Klick)** schneidet einen Kreis aus einem angeklickten Freihandobjekt. Er ist kein durchgehender Wischradierer. **Annotation löschen** entfernt das ausgewählte unterstützte Objekt vollständig.
8. Das **Downloadsymbol** (**PDF herunterladen**) oder Ctrl/Cmd+S erzeugt eine neue `…-annotiert.pdf`. Das Original wird nicht überschrieben. Nach dem Download die neue Datei prüfen; der Browser bestätigt dem Programm nicht, ob sie endgültig auf Datenträger gespeichert wurde.

**Seiten verwalten:** Über das **Seitensymbol** die Miniaturübersicht öffnen. Seiten per Drag-and-drop umordnen, auf Touch kurz halten und ziehen; **Vorher/Nachher** bietet eine Alternative. **PDF hinzufügen …** fügt eine weitere Datei am Ende oder nach der aktuellen Seite ein. Beides unterstützt Undo/Redo und wird mit **PDF herunterladen** gespeichert. Formulare und strukturierte/tagged PDFs sowie bestimmte komplexe Importquellen werden noch nicht unterstützt. [Bedienung, Erhalt nativer Objekte und Grenzen](docs/PAGE_ORGANIZER.md).

Die Oberfläche zeigt eine schmale Hauptleiste und eine Statuszeile. Am Computer stehen die Werkzeuge in einer Zeile; bis 720 Pixel Breite gibt es zwei kompakte Zeilen mit Dokumentfunktionen oben und Werkzeugsymbolen darunter. Ansicht, Werkzeugeigenschaften und Annotationsliste erscheinen bei Bedarf als überlagerte Menüs. Schließen mit **×**, Escape oder einem Klick außerhalb; dieser Klick zeichnet keine Annotation. Auch ausgeblendete, noch nicht übernommene Eigenschaften bleiben erhalten. Die Menüs benötigen einen aktuellen Browser mit Popover-Unterstützung. [Aktuelle Symbolleiste und Screenshots](docs/DIRECT_TOOLS.md); [frühere Layout-Prüfung](docs/COMPACT_LAYOUT.md).

Im Auswahlwerkzeug öffnet **Rechtsklick** oder **langes Drücken (ca. 0,6 Sekunden)** ein Kontextmenü: auf einer ausgewählten Markierung **Kopieren/Ausschneiden/Löschen**, auf freier Blattfläche **Einfügen/Alle Kommentare markieren**. Die Aktion betrifft die gesamte Auswahl. Löschen verändert die Zwischenablage nicht. Einfügen platziert die Gruppe an der gedrückten Stelle. Bewegung oder ein zweiter Finger verhindern das Langdruck-Menü.

| Kürzel | Aktion |
| --- | --- |
| Strg+A | Alle bearbeitbaren Kommentare der aktuellen Seite auswählen |
| Strg+C | Auswahl kopieren |
| Strg+X | Auswahl ausschneiden |
| Strg+V | An der letzten Mausposition auf dem Blatt einfügen; sonst in der Mitte des sichtbaren Bereichs |

Auf macOS ist auch Cmd statt Strg möglich. In Text-/Eigenschaftsfeldern bleiben die normalen Textkürzel erhalten. Die **App-Zwischenablage** bleibt beim PDF-Wechsel erhalten, endet aber beim Neuladen/Schließen des Tabs. Die PDF-Objekte werden nicht in die Systemzwischenablage übertragen oder dauerhaft gespeichert. Beim Kopieren wird dort, soweit der Browser es erlaubt, eine leere App-Markierung gesetzt, damit ein alter Screenshot beim nächsten Strg+V nicht die Annotationskopie verdrängt. Ausschneiden, Einfügen und Löschen sind jeweils als gesamte Gruppe rückgängig machbar. [Details und Testnachweise](docs/CONTEXT_CLIPBOARD.md).

**Screenshots als Bild-Kommentar:** Ein PNG-/JPEG-Bild kopieren und **Strg/Cmd+V** drücken. Auf freier Blattfläche bietet das Kontextmenü zusätzlich **Bild aus Zwischenablage** und **Bild einfügen …** (Dateien/Galerie); das **Bildsymbol** in der Hauptleiste öffnet dieselbe Dateiauswahl. Das Bild wird passend zur Seite eingesetzt. Ein ausgewähltes Bild über die vier Eckgriffe proportional skalieren, am Bild verschieben und im Annotationsmenü unter **Inhalt** kommentieren. Kopieren/Ausschneiden/Löschen und Undo/Redo funktionieren auch mit Bildern. PNG-Transparenz bleibt erhalten. Der direkte Bildzugriff hängt vom Browser und dessen Berechtigungen ab; die Dateiauswahl ist die Alternative. Maximal 20 MB, 20 Megapixel und 16.384 Pixel je Kante; keine stille Qualitätsreduzierung. [Bildannotation, Prüfungen und Grenzen](docs/IMAGE_ANNOTATIONS.md).

Touch unterstützt Auswahlbox und Gruppenbewegung mit einem Finger sowie Pan und Zoom mit zwei Fingern; ein zweiter Finger bricht eine laufende Auswahlbox, Verschiebung, einen Strich bzw. eine Platzierung ab. [Gruppenauswahl und tatsächliche Prüfung](docs/GROUP_SELECTION.md). Reale Geräte müssen weiter geprüft werden. Der Editor warnt beim Dateiwechsel und Schließen vor ungesicherten Änderungen. **Automatische Wiederherstellung ist noch nicht enthalten:** regelmäßig exportieren. Textfelder haben zunächst eine feste Ausgangsgröße; nachträgliche Größenänderung, weitere Formen, Textmarker und kontinuierliches Radieren folgen später.

## Cloud-Builds ohne lokale Werkzeuge

Unter [GitHub Actions](https://github.com/roju0ch/PDF-Annotation-Editor/actions) einen Lauf öffnen und unten das Artefakt herunterladen:

- **Browser checks**: `browser-preview-and-test-evidence` enthält den statischen Build, Playwright-Bericht, Screenshot und ausschließlich synthetische POC-PDFs.
- **Desktop test builds (unsigned)**: separate Linux-, Windows- und macOS-Jobs liefern `.deb`, NSIS-Installer bzw. ein ZIP der `.app`. Erfolgreiche Paketerstellung ist noch kein Test der Desktop-Bedienung. Die Pakete sind unsignierte Testversionen; Gatekeeper/SmartScreen können sie beanstanden.
- **Browser preview**: testet den Produktionsbuild und veröffentlicht ausschließlich `dist/`. Pages muss unter **Settings → Pages → GitHub Actions** aktiviert sein. Ein Fehler im separaten Desktop-Workflow blockiert den Browser-Workflow nicht.

CI verwendet `npm ci`, strikten Typecheck, ESLint, Vitest, den nativen Annotations-POC und Playwright/Chromium sowie zusätzliche Firefox-Tests für Layout, Gruppenauswahl und Zwischenablage. Aktionen sind auf Commit-SHAs festgelegt. PR-Workflows besitzen nur Leserechte; nur der Pages-Deploy-Job erhält Pages-Schreibrechte und ein OIDC-Token.

## Entwicklung in Codex Cloud

Node.js 24 verwenden; Abhängigkeiten und Versionen stehen in `package-lock.json`.

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run poc
npx playwright install --with-deps chromium firefox
npm run test:e2e
PLAYWRIGHT_BROWSER=firefox PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report-firefox npm run test:e2e -- tests/e2e/layout.spec.ts tests/e2e/selection.spec.ts tests/e2e/clipboard.spec.ts tests/e2e/images.spec.ts tests/e2e/pages.spec.ts
npm run build
```

In der bereitgestellten Cloud kann `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` den installierten Browser verwenden. Die E2E-Konfiguration startet den gebauten Viewer unter `/PDF-Annotation-Editor/` und prüft damit auch Worker-/WASM-Pfade für GitHub Pages. Falls das Standard-npm-Cacheverzeichnis schreibgeschützt ist, `npm --cache /workspace/.npm-cache ci` verwenden. Der POC erzeugt die Testdateien; ihn vor E2E ausführen.

Tauri 2 liegt in `src-tauri/`. Nach Installation der [offiziellen Plattformvoraussetzungen](https://v2.tauri.app/start/prerequisites/) startet `npm run tauri -- dev` die Desktop-Hülle. Sie nutzt dieselbe lokale File-API und hat keine eigenen Dateisystem-/Shell-Kommandos oder zusätzlichen Plugin-Berechtigungen. Windows/macOS werden auf ihren GitHub-Runnern gebaut.

## Architektur und Grenzen

- `src/core/viewport.ts`: testbare Koordinatenumrechnung und pointerverankerter Zoom.
- `src/adapters/pdf/`: MuPDF-WASM im Worker; expliziter Start-Handshake, 30-Sekunden-Zeitlimit und Freigabe nativer Objekte. PDF-JavaScript wird nicht aktiviert, Links werden nicht ausgeführt.
- `src/App.tsx`: sofortige CSS-Transformation beim Navigieren; nach 140 ms Ruhe hochauflösendes Nachrendern. Sichtbare Seiten werden priorisiert, maximal sechs Canvases und drei gecachte Raster gehalten.
- Limits: 100 MB pro Datei, 2000 Seiten, 20000 PDF-Punkte pro Seitenkante, 4 Megapixel / 4096 Pixel pro Raster. Hoher Zoom wird dadurch weich; Tile-Rendering und belastbare Messungen großer realer Baupläne sind Folgearbeit. Parser-Speicher ist durch diese Rasterlimits nicht vollständig begrenzt.
- Passwortgeschützte, reparaturbedürftige oder unbrauchbare PDFs zeigen eine Fehlermeldung. Dokumente mit Signaturfeldern/Zertifizierungsrechten oder Verschlüsselung werden nicht bearbeitet. Individuell gesperrte Annotationen sowie komplexe FreeText-RichText-/Callout-Objekte bleiben schreibgeschützt. Signaturvalidierung, Textauswahl/Suche, Recovery und direktes Überschreiben sind noch nicht enthalten.
- `src/adapters/pdf/annotations.ts`: native Annotationen und MuPDF-Undo-Journal; Export durch Replay aktiver Änderungen auf Originalbytes, dann einmaliges inkrementelles Schreiben und Wiederöffnungsprüfung. Das Exportlimit beträgt 150 MB.
- `src/core/annotations/`: Koordinatenmodell in unrotierten PDF-Punkten und geometrische Kreis-/Segment-Schnittberechnung. `src/app/`: Editorzustand, Werkzeugleiste, Eigenschaften und temporäre Auswahl-/Zeichenanzeige. Gespeicherte Annotationen werden genau einmal durch MuPDF gerendert.

[POC und tatsächliche Testergebnisse](docs/VALIDATION.md) · [Anforderungen](docs/REQUIREMENTS.md) · [Architektur](docs/ARCHITECTURE.md)

## Lizenz

Projekt: AGPL-3.0 (siehe [LICENSE](LICENSE)). MuPDF.js **1.28.6** wird laut npm-Paket als **AGPL-3.0-or-later** angeboten und im Browser als WASM eingebunden. Der öffentliche Quellcode ist in der Oberfläche verlinkt. React: MIT; Vite/TypeScript und weitere Entwicklungsabhängigkeiten gemäß ihren Paketlizenzen. Die Kombination wird als Open-Source-AGPL-Prototyp untersucht; eine kommerzielle Lizenz wurde nicht erworben. Vor Vertrieb sind die vollständigen Lizenz-/Hinweispflichten einschließlich nativer transitiver Abhängigkeiten zu prüfen.
