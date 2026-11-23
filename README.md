# PDF Annotation Editor

Ein lokaler PDF-Viewer und Annotationsprototyp mit React, TypeScript und MuPDF.js. PDFs werden ausschließlich auf Ihrem Gerät verarbeitet. Es gibt keinen Upload, kein Konto und keine Telemetrie.

## Im Browser ausprobieren

Die [Browser-Vorschau](https://roju0ch.github.io/PDF-Annotation-Editor/) zeigt den zuletzt freigegebenen Stand auf `main` und wird durch den Workflow **Browser preview** auf GitHub Pages bereitgestellt. Der Viewer-Grundstand ist in [docs/VALIDATION.md](docs/VALIDATION.md) dokumentiert; der Annotationsschritt in [docs/ANNOTATIONS.md](docs/ANNOTATIONS.md). Neue Funktionen eines offenen PR erscheinen erst nach dessen Merge. Die Webseite enthält nur App-Dateien, keine von Ihnen geöffneten PDFs. Zum ersten Laden wird Internet benötigt; eine installierbare Offline-PWA ist noch nicht enthalten.

1. Vorschau öffnen, **PDF öffnen** wählen oder eine Datei auf die Arbeitsfläche ziehen.
2. Jedes neu geöffnete PDF startet in der Ansicht **Fortlaufend** mit eingepasster erster Seite. Die Schaltfläche mit **Seitenzahl und Zoom** öffnet das Ansichtsmenü. Dort auf **Einzelblatt** umschalten, Seiten über Pfeile oder Seitennummer wechseln und **Seite einpassen** oder **Breite** wählen.
3. Das Mausrad scrollt vertikal, horizontale Radbewegungen scrollen seitwärts. **Strg (Ctrl) + Mausrad** zoomt an der Mausposition. Auf dem Trackpad mit zwei Fingern scrollen oder per Pinch zoomen. Zum freien Verschieben die mittlere Maustaste gedrückt halten und ziehen oder **Leertaste + linke Maustaste** verwenden.
4. Die PDF-Arbeitsfläche anklicken oder mit **Tab** fokussieren. Die **Pfeiltasten** scrollen in kleinen Schritten, auch beim Gedrückthalten. **Bild ↑ / Bild ↓** (Page Up / Page Down) scrollen ungefähr eine Bildschirmhöhe und wechseln im Einzelblattmodus am Seitenrand zur benachbarten Seite. **Pos1 / Ende** (Home / End) springen an den Dokumentanfang oder ans Dokumentende. Auf kompakten Mac-Tastaturen entsprechen **Fn + ↑/↓** den Bildtasten und **Fn + ←/→** Pos1 und Ende.

5. Die **Werkzeugsymbole** wählen direkt Auswahl, Freihand, Notiz, Textfeld oder Ink-Teilradierer; das Bildsymbol öffnet die Bilddateiauswahl. Das aktive Werkzeug ist hervorgehoben. Hinweise erscheinen beim Darüberfahren und bei Tastaturfokus. Über das **Reglersymbol (Werkzeugeigenschaften)** Farbe, Strichbreite oder Notiztext einstellen. Neue Zeichnungen werden nicht automatisch ausgewählt; das Werkzeug bleibt aktiv. **Escape** bricht eine laufende Zeichnung ab und wechselt zum Auswahlwerkzeug. Ist die Auswahl bereits aktiv, hebt Escape die Auswahl auf. Ein geöffnetes Menü wird zuerst geschlossen; ausstehende Eigenschaftsänderungen bleiben erhalten.
6. **Auswählen / Verschieben** verwenden: Auf freier Fläche eine Auswahlbox ziehen. Bereits berührte Markierungen werden ausgewählt; sie müssen nicht vollständig in der Box liegen. An einer ausgewählten Markierung ziehen, um die ganze Gruppe zu verschieben. **Rückgängig** nimmt die Gruppenbewegung in einem Schritt zurück. Ein Klick auf freie Fläche hebt die Auswahl auf. Alternativ über das **Listensymbol** die Annotationen öffnen und ein einzelnes Objekt auswählen. Inhalt/Eigenschaften ändern und **Übernehmen** wählen. Änderungen können rückgängig gemacht und wiederholt werden. Gesperrte oder nicht unterstützte Objekte bleiben erhalten.
7. **Ink-Teilradierer (Klick)** schneidet einen Kreis aus einem angeklickten Freihandobjekt. Er ist kein durchgehender Wischradierer. **Annotation löschen** entfernt das ausgewählte unterstützte Objekt vollständig.
8. Das **Downloadsymbol** (**PDF herunterladen**) oder Ctrl/Cmd+S erzeugt eine neue `…-annotiert.pdf`. Das Original wird nicht überschrieben. Nach dem Download die neue Datei prüfen; der Browser bestätigt dem Programm nicht, ob sie endgültig auf Datenträger gespeichert wurde.

**Speichern in installierten Apps:** Unter Android, Windows, macOS und Linux bietet das Symbol **PDF speichern unter …** einen nativen Dateidialog für Ordner und Dateiname. Erst nach überprüftem Schreiben erscheint **PDF gespeichert: …**; bei Abbruch/Fehler bleiben Änderungen ungesichert. Im normalen Browser bleibt **PDF herunterladen** mit dem browsergesteuerten Downloadziel. [Speicherwege und Grenzen](docs/SAVING.md).

**Direkt aus dem Dateimanager öffnen:** Installierte Apps registrieren sich für `.pdf`, ohne einen vorhandenen Standard-Viewer zu ersetzen. Windows/Linux übergeben Startargumente an eine vorhandene Instanz; macOS, Android und iOS verwenden Tauri-Öffnungsereignisse. Auch beim Kaltstart werden Dateien gepuffert und durch dieselbe Importfunktion geöffnet. Ungesicherte Änderungen benötigen eine Bestätigung; ungültige PDFs erhalten das bisherige Dokument. [Standardprogramm auswählen, AppImage-Integration und Geräteprüfung](docs/FILE_ASSOCIATIONS.md). Für iOS gibt es zunächst einen Simulator-Build; Geräteverteilung benötigt Apple-Signierung, und die noch nicht vorhandene iOS-Speicherung ist ausdrücklich deaktiviert.

**Mehrere PDFs auf dem Desktop:** Unter Windows, macOS und Linux öffnen weitere PDFs aus dem Dateimanager in eigenen Fenstern. **Neues Fenster** im Ansichtsmenü erzeugt ein leeres Fenster. Auf dem Mac geht das auch über **Datei → Neues Fenster / ⌘N**. Dokument, Änderungen, Undo, Ansicht und Speicherziel gehören jeweils zum Fenster. **PDF öffnen** ersetzt das Dokument des aktuellen Fensters und fragt bei ungesicherten Änderungen nach. [Bedienung und Geräteprüfung](docs/MULTIPLE_WINDOWS.md).

**Textkommentare:** Das **Textfeldsymbol** wählen und auf die gewünschte Position klicken oder tippen. Im leeren Dialog mehrzeiligen Text eingeben, Schriftgröße, Textfarbe und Hintergrundfarbe beziehungsweise einen transparenten Hintergrund wählen. Erst **OK** erzeugt eine native FreeText-Annotation; **Abbrechen** oder Escape verwirft den Dialog ohne PDF-Änderung. Die Box passt sich dem Inhalt an und bleibt innerhalb der Seite. Für das nächste Textfeld bleiben die Darstellungseinstellungen erhalten, der Inhalt beginnt wieder leer. Vorhandene Textfelder lassen sich über die Auswahl und die Annotationsliste bearbeiten. Eigene automatisch dimensionierte Textfelder passen ihre Größe bei Text-/Schriftänderungen an; fremde Textfelder behalten ihre Abmessungen. [Ablauf, native Speicherung und Grenzen](docs/TEXT_COMMENTS.md).

**Vorhandene Texte direkt bearbeiten:** Im Auswahlwerkzeug auf ein Textfeld, eine unterstützte Haftnotiz oder deren Auswahlrahmen rechtsklicken beziehungsweise etwa 600 ms lang drücken und **Bearbeiten** wählen. Der vorausgefüllte Dialog öffnet sich direkt mit Fokus im Text. **Übernehmen** aktualisiert dasselbe native PDF-Objekt; **Abbrechen** oder Escape verwirft die Eingabe. Für Gruppen, Bilder, Freihand und geschützte Objekte erscheint diese Aktion nicht. Die übrigen Kontextmenüaktionen bleiben verfügbar.

**Seiten verwalten:** Über das **Seitensymbol** die Miniaturübersicht öffnen. Seiten per Drag-and-drop umordnen, auf Touch kurz halten und ziehen; **Vorher/Nachher** bietet eine Alternative. **↶ 90° links / ↷ 90° rechts** dreht die aktuelle Seite, inklusive Undo/Redo und Speicherung der Drehung im Export. **PDF hinzufügen …** fügt eine weitere Datei am Ende oder nach der aktuellen Seite ein. Beides unterstützt Undo/Redo und wird mit **PDF herunterladen** gespeichert. Formulare und strukturierte/tagged PDFs sowie bestimmte komplexe Importquellen werden noch nicht unterstützt. [Bedienung, Erhalt nativer Objekte und Grenzen](docs/PAGE_ORGANIZER.md).

Die Oberfläche zeigt eine schmale Hauptleiste und eine Statuszeile. Am Computer stehen die Werkzeuge in einer Zeile; bis 720 Pixel Breite gibt es zwei kompakte Zeilen mit Dokumentfunktionen oben und Werkzeugsymbolen darunter. Ansicht, Werkzeugeigenschaften und Annotationsliste erscheinen bei Bedarf als überlagerte Menüs. Schließen mit **×**, Escape oder einem Klick außerhalb; dieser Klick zeichnet keine Annotation. Auch ausgeblendete, noch nicht übernommene Eigenschaften bleiben erhalten. Die Menüs benötigen einen aktuellen Browser mit Popover-Unterstützung. [Aktuelle Symbolleiste und Screenshots](docs/DIRECT_TOOLS.md); [frühere Layout-Prüfung](docs/COMPACT_LAYOUT.md).

Im Auswahlwerkzeug öffnet **Rechtsklick** oder **langes Drücken (ca. 0,6 Sekunden)** ein Kontextmenü: innerhalb der **gesamten Auswahlbox** **Kopieren/Ausschneiden/Löschen** – auch neben dem Strich oder in Lücken zwischen mehreren ausgewählten Objekten. Ein gemeinsamer Rahmen zeigt die Gruppenfläche. Außerhalb der Auswahlbox bietet freie Blattfläche **Einfügen/Alle Kommentare markieren**. Die Aktion betrifft die gesamte Auswahl. Löschen verändert die Zwischenablage nicht. Einfügen platziert die Gruppe an der gedrückten Stelle. Bewegung oder ein zweiter Finger verhindern das Langdruck-Menü.

| Kürzel | Aktion                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------- |
| Strg+A | Alle bearbeitbaren Kommentare der aktuellen Seite auswählen                                    |
| Strg+C | Auswahl kopieren                                                                               |
| Strg+X | Auswahl ausschneiden                                                                           |
| Strg+V | An der letzten Mausposition auf dem Blatt einfügen; sonst in der Mitte des sichtbaren Bereichs |

Auf macOS ist auch Cmd statt Strg möglich. In Text-/Eigenschaftsfeldern bleiben die normalen Textkürzel erhalten. Die **App-Zwischenablage** bleibt beim PDF-Wechsel erhalten, endet aber beim Neuladen/Schließen des Tabs. Die PDF-Objekte werden nicht in die Systemzwischenablage übertragen oder dauerhaft gespeichert. Beim Kopieren wird dort, soweit der Browser es erlaubt, eine leere App-Markierung gesetzt, damit ein alter Screenshot beim nächsten Strg+V nicht die Annotationskopie verdrängt. Ausschneiden, Einfügen und Löschen sind jeweils als gesamte Gruppe rückgängig machbar. [Details und Testnachweise](docs/CONTEXT_CLIPBOARD.md).

**Screenshots als Bild-Kommentar:** Ein PNG-/JPEG-Bild kopieren und **Strg/Cmd+V** drücken. Auf freier Blattfläche bietet das Kontextmenü zusätzlich **Bild aus Zwischenablage** und **Bild einfügen …** (Dateien/Galerie); das **Bildsymbol** in der Hauptleiste öffnet dieselbe Dateiauswahl. Das Bild wird passend zur Seite eingesetzt. Ein ausgewähltes Bild über die vier Eckgriffe proportional skalieren, am Bild verschieben und im Annotationsmenü unter **Inhalt** kommentieren. Kopieren/Ausschneiden/Löschen und Undo/Redo funktionieren auch mit Bildern. PNG-Transparenz bleibt erhalten. Der direkte Bildzugriff hängt vom Browser und dessen Berechtigungen ab; die Dateiauswahl ist die Alternative. Maximal 20 MB, 20 Megapixel und 16.384 Pixel je Kante; keine stille Qualitätsreduzierung. [Bildannotation, Prüfungen und Grenzen](docs/IMAGE_ANNOTATIONS.md).

Touch unterstützt Auswahlbox und Gruppenbewegung mit einem Finger sowie Pan und Zoom mit zwei Fingern; ein zweiter Finger bricht eine laufende Auswahlbox, Verschiebung, einen Strich bzw. eine Platzierung ab. [Gruppenauswahl und tatsächliche Prüfung](docs/GROUP_SELECTION.md). Reale Geräte müssen weiter geprüft werden. Der Editor warnt beim Dateiwechsel und Schließen vor ungesicherten Änderungen. **Automatische Wiederherstellung ist noch nicht enthalten:** regelmäßig exportieren. Weitere Formen, Textmarker und kontinuierliches Radieren folgen später.

## Cloud-Builds ohne lokale Werkzeuge

Unter [GitHub Actions](https://github.com/roju0ch/PDF-Annotation-Editor/actions) einen Lauf öffnen und unten das Artefakt herunterladen:

- **Browser checks**: `browser-preview-and-test-evidence` enthält den statischen Build, Playwright-Bericht, Screenshot und ausschließlich synthetische POC-PDFs.
- **Test release pipeline**: erzeugt Windows-NSIS (`.exe` mit WebView2-Offline-Installer), separate Intel-/Apple-Silicon-`.dmg`, Linux-`.AppImage`/`.deb` und eine signierte Android-ARM64-Test-`.apk`. Die Artefakte heißen `installer-…`. Freigegebene `v0.x.y`-Tags veröffentlichen nach erfolgreichen Prüfungen eine **GitHub-Vorabversion**, niemals automatisch 1.0 oder Latest. PRs und manuelle Probeläufe veröffentlichen nichts. [Installation, Cloud-Ablauf, Signierung und Grenzen](docs/RELEASES.md). Ohne eigene Zertifikate sind Desktop-Pakete unsigniert/ad-hoc-signiert; Android-Tests verwenden einen kurzlebigen Testschlüssel und eine separate App-Kennung (`PDF Viewer Test`), sodass die Haupt-App installiert bleiben kann. Vor einem weiteren Testlauf gegebenenfalls die Test-App nach Sicherung ihrer PDFs deinstallieren. Erfolgreiche Paketerstellung ersetzt keine Geräteprüfung.
- **iOS simulator PDF handler**: baut ohne Signierungszugang einen ARM64-Simulator-App-Bundle und prüft den nativen Leseweg sowie die tatsächliche PDF-Registrierung. `ios-simulator-app-and-test-evidence` ist kein auf einem iPhone installierbares IPA und wird nicht als solches veröffentlicht.
- **Browser preview**: testet den Produktionsbuild und veröffentlicht ausschließlich `dist/`. Pages muss unter **Settings → Pages → GitHub Actions** aktiviert sein. Ein Fehler im separaten Desktop-Workflow blockiert den Browser-Workflow nicht.

CI verwendet `npm ci`, strikten Typecheck, ESLint, Vitest, den nativen Annotations-POC und Playwright/Chromium sowie zusätzliche Firefox-Tests, darunter Navigation, Layout, Gruppenauswahl und Zwischenablage. Aktionen sind auf Commit-SHAs festgelegt. PR-Workflows besitzen nur Leserechte; nur der Pages-Deploy-Job erhält Pages-Schreibrechte und ein OIDC-Token.

## Entwicklung in Codex Cloud

Node.js 24 verwenden; Abhängigkeiten und Versionen stehen in `package-lock.json`.

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm run test:release
npm test
npm run poc
npx playwright install --with-deps chromium firefox
npm run test:e2e
PLAYWRIGHT_BROWSER=firefox PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report-firefox npm run test:e2e -- tests/e2e/viewer.spec.ts tests/e2e/layout.spec.ts tests/e2e/selection.spec.ts tests/e2e/clipboard.spec.ts tests/e2e/images.spec.ts tests/e2e/pages.spec.ts tests/e2e/offline.spec.ts tests/e2e/rendering.spec.ts tests/e2e/annotation-rendering.spec.ts tests/e2e/tool-text-comments.spec.ts tests/e2e/context-edit.spec.ts tests/e2e/android-save.spec.ts tests/e2e/desktop-save.spec.ts tests/e2e/external-open.spec.ts tests/e2e/desktop-windows.spec.ts
npm run build
```

In der bereitgestellten Cloud kann `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` den installierten Browser verwenden. Die E2E-Konfiguration startet den gebauten Viewer unter `/PDF-Annotation-Editor/` und prüft damit auch Worker-/WASM-Pfade für GitHub Pages. Falls das Standard-npm-Cacheverzeichnis schreibgeschützt ist, `npm --cache /workspace/.npm-cache ci` verwenden. Der POC erzeugt die Testdateien; ihn vor E2E ausführen.

Die installierten Pakete enthalten Frontend, PDF-Worker und MuPDF-WASM lokal; kein Entwicklungsserver und keine Verbindung zu GitHub Pages sind für die PDF-Bearbeitung nötig. Der neue Offline-Test prüft Kaltstart und nativen Export mit abgeschaltetem Netzwerk. System-WebViews und Linux-Systemabhängigkeiten bleiben Voraussetzungen. Android berücksichtigt Systemleisten nativ und liest kopierte PNG-/JPEG-Bilder über einen lokalen Clipboard-Plugin. [Android-Geräteprüfung und Grenzen](docs/ANDROID.md); Dateiauswahl und Export sind weiterhin auf echten Geräten zu prüfen.

Tauri 2 liegt in `src-tauri/`. Nach Installation der [offiziellen Plattformvoraussetzungen](https://v2.tauri.app/start/prerequisites/) startet `npm run tauri -- dev` die Desktop-Hülle. File-API und externe Betriebssystemübergaben verwenden dieselbe PDF-Importfunktion. Native Speicher- und Öffnungs-Plugins sind auf ausdrücklich ausgewählte PDF-Dateien begrenzt; die Oberfläche erhält keinen allgemeinen Dateisystem- oder Shell-Zugriff. Windows/macOS/iOS werden auf ihren GitHub-Runnern gebaut.

Große Pläne werden mit einer Ganzseitenvorschau und scharf nachgeladenen, sichtbaren Detailkacheln dargestellt. Beim Zeichnen und Kommentieren bleibt der Hintergrund erhalten; nur die betroffenen nativen Annotationsbereiche werden aktualisiert. [Rendering, Speicherbudgets und Tests](docs/RENDERING.md).

## Architektur und Grenzen

- `src/core/viewport.ts`: testbare Koordinatenumrechnung und pointerverankerter Zoom.
- `src/adapters/pdf/`: MuPDF-WASM im Worker; expliziter Start-Handshake, 30-Sekunden-Zeitlimit und Freigabe nativer Objekte. PDF-JavaScript wird nicht aktiviert, Links werden nicht ausgeführt.
- `src/App.tsx` und `src/app/usePdfRaster.ts`: sofortige CSS-Transformation beim Navigieren; nach 100 ms Ruhe werden sichtbare Detailkacheln nachgeladen. Annotationsänderungen aktualisieren ausschließlich die native Annotationsdarstellung über dem erhaltenen Hintergrund.
- Limits: 100 MB pro Datei, 2000 Seiten, 20000 PDF-Punkte pro Seitenkante. Detailkacheln sind auf 1024 × 1024 Pixel begrenzt; Zoom erhöht ihre Auflösung. [Separate Raster- und Cachebudgets](docs/RENDERING.md) begrenzen den Parser-/WebView-Gesamtspeicher nicht vollständig.
- Passwortgeschützte, reparaturbedürftige oder unbrauchbare PDFs zeigen eine Fehlermeldung. Dokumente mit Signaturfeldern/Zertifizierungsrechten oder Verschlüsselung werden nicht bearbeitet. Individuell gesperrte Annotationen sowie komplexe FreeText-RichText-/Callout-Objekte bleiben schreibgeschützt. Signaturvalidierung, Textauswahl/Suche, Recovery und direktes Überschreiben sind noch nicht enthalten.
- `src/adapters/pdf/annotations.ts`: native Annotationen und MuPDF-Undo-Journal; Export durch Replay aktiver Änderungen auf Originalbytes, dann einmaliges inkrementelles Schreiben und Wiederöffnungsprüfung. Das Exportlimit beträgt 150 MB.
- `src/core/annotations/`: Koordinatenmodell in unrotierten PDF-Punkten und geometrische Kreis-/Segment-Schnittberechnung. `src/app/`: Editorzustand, Werkzeugleiste, Eigenschaften und temporäre Auswahl-/Zeichenanzeige. Gespeicherte Annotationen werden genau einmal durch MuPDF gerendert.

[POC und tatsächliche Testergebnisse](docs/VALIDATION.md) · [Anforderungen](docs/REQUIREMENTS.md) · [Architektur](docs/ARCHITECTURE.md)

## Lizenz

Projekt: AGPL-3.0 (siehe [LICENSE](LICENSE)). MuPDF.js **1.28.6** wird laut npm-Paket als **AGPL-3.0-or-later** angeboten und im Browser als WASM eingebunden. Der öffentliche Quellcode ist in der Oberfläche verlinkt. React: MIT; Vite/TypeScript und weitere Entwicklungsabhängigkeiten gemäß ihren Paketlizenzen. Die Kombination wird als Open-Source-AGPL-Prototyp untersucht; eine kommerzielle Lizenz wurde nicht erworben. Vor Vertrieb sind die vollständigen Lizenz-/Hinweispflichten einschließlich nativer transitiver Abhängigkeiten zu prüfen.
