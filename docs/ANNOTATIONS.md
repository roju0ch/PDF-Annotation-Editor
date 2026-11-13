# Native Annotationen – nächster Entwicklungsschritt

Dieser Schritt erweitert den geprüften Viewer um einen begrenzten, tatsächlich speichernden Editor. Er ist keine Abnahme aller M1-/M2-Anforderungen. Die Änderungen werden als eigener Feature-Branch/PR geprüft und erst nach Merge auf `main` öffentlich bereitgestellt.

## Bedienung und Umfang

- Freihand (`Ink`), Notiz (`Text`) und einfaches Textfeld (`FreeText`) per Maus, Stift oder Touch erzeugen.
- Unterstützte vorhandene Annotationen auf der aktuellen Seite auswählen, verschieben, Inhalt/Farbe sowie passende Strich- oder Schriftgröße verändern und löschen. Eigenschaften explizit übernehmen/verwerfen.
- MuPDF-Journal für Undo/Redo, auch bei Löschen und geometrischer Teilradierung. Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z bzw. Ctrl/Cmd+Y; normale Textfeld-Historie wird nicht abgefangen.
- Klick-Teilradierer: exakte Kreis-/Segment-Schnittpunkte, mehrere erhaltene native Ink-Pfade, Berücksichtigung der halben Strichbreite. Ein Klick betrifft ein Freihandobjekt. Kein kontinuierliches Radieren durch Ziehen und kein Ausradieren des PDF-Seiteninhalts.
- PDF-Download und Ctrl/Cmd+S exportieren eine neue Datei. Ein bestehendes Original wird nie überschrieben. Warnung beim Dateiwechsel/Schließen mit unexportierten Änderungen bzw. noch nicht übernommenen Eigenschaften.
- Zoom am Mauszeiger und Mittelmaus-/Leertasten-Pan bleiben unabhängig vom ausgewählten Werkzeug. Zwei-Finger-Pinch bricht eine noch nicht abgeschlossene Platzierung/Zeichenbewegung ab.

## Daten und Export

Annotationsgeometrie liegt in unrotierten PDF-Koordinaten. Die Engine-Grenze konvertiert über `PDFPage.getTransform()`; die Oberfläche berücksichtigt CropBox, Seitenrotation, Zoom und Seitenposition separat. Temporär werden nur der laufende Freihandstrich, die Auswahlkontur und der Radierkreis als SVG gezeichnet. Fertige Objekte und ihre Appearance-Streams rendert MuPDF genau einmal.

`AnnotationEditor` bearbeitet native PDF-Objekte in atomaren Journal-Operationen. Bei Fehlern wird die gesamte Operation abgebrochen. Unbekannte Typen und gesperrte Objekte werden nicht bearbeitet. Individuelle Flags, Signaturfelder, Zertifizierungsrechte und Verschlüsselung werden geprüft. Dokumente mit Signaturfeldern bleiben konservativ schreibgeschützt, auch wenn das Feld noch nicht unterzeichnet ist. RichText-/Callout-FreeText wird zunächst nur angezeigt, damit komplexe fremde Eigenschaften nicht stillschweigend ersetzt werden. Es gibt keine Signaturvalidierung.

Ein Test zeigte, dass wiederholtes `saveToBuffer(incremental=yes)` auf dem bearbeiteten MuPDF-Dokument nach Undo eine ungültige XRef-Kette erzeugen konnte: native Schreibvorgänge verändern `startxref`. Deshalb läuft jeder Export auf einer frischen Kopie der Originalbytes. Die aktiven, erfolgreichen Bearbeitungsoperationen werden dort wiederholt; IDs neu erzeugter Objekte werden zugeordnet. Danach wird genau einmal inkrementell geschrieben und die Ausgabe erneut geöffnet/geprüft. Die Originalbytes bleiben als Präfix erhalten, ebenso nicht angefasste Inhalte. Das offene Dokument und seine Undo-Historie werden durch den Export nicht verändert. Eine positive Download-Auslösung markiert den Stand als exportiert; ob der Nutzer den Download tatsächlich auf Datenträger übernimmt, kann der Browser nicht bestätigen.

Alle Dateien und Operationen bleiben im Speicher des Geräts. Kein Upload, keine Telemetrie und keine Speicherung von PDF-Inhalten in Browser-Persistenz. Der Export ist auf 150 MB begrenzt; der Worker hat weiterhin ein 30-Sekunden-Zeitlimit. Sehr viele Änderungen vergrößern Journal und Replay-Aufwand; Belastungstests folgen.

## Tatsächlich geprüft

In Codex Cloud mit Node.js 24.22.1 und MuPDF.js 1.28.6:

- TypeScript strict, ESLint und Produktionsbuild erfolgreich.
- **22 Unit-/Integrationstests**: bisherige acht Viewporttests plus native Erstellung/Bearbeitung/Export für alle drei Typen, vorhandene Notiz, unabhängiger Stamp mit privatem Eintrag, unberührte Link-Annotation und Seiteninhalte, gesperrte Objekte, Signaturfelder, RichText-Schutz, atomarer Fehler-Rollback, Undo/Redo und verzweigte Historie, wiederholte Exporte, rotierte CropBox und geometrische Ink-Teilradierung. Rendering nach Undo/Redo wird ebenfalls geprüft.
- **8 Chromium-Browserszenarien**: vier bisherige Viewer-Prüfungen und vier Editor-Prüfungen. Tatsächliche rote Strichpixel und Textpixel mit transparentem Hintergrund, erzeugte PDF-Objekte/Appearance-Streams, Export/Wiederöffnen, Bewegung auf 90° gedrehter Seite, Teilradierung und Undo/Redo, Mittelmaus-Pan bei aktivem Zeichenwerkzeug, Warnungen vor dem Verwerfen sowie emuliertes Touch-Platzieren und Pinch-Abbruch. Die bearbeitende Browsersitzung führt ausschließlich lokale GET-Anfragen aus.
- Exportierte `browser-annotations.pdf` mit Poppler `pdfinfo` erkannt und Seite 2 mit `pdftoppm` unabhängig gerendert; das verschobene Textfeld ist im Bild sichtbar und lesbar. Fontconfig meldet in der Cloud ein nicht schreibbares Cacheverzeichnis, der Renderer erzeugt dennoch die Ausgabe.
- Der ursprüngliche `npm run poc` besteht weiterhin.

Nachweise im CI-Artefakt `browser-preview-and-test-evidence`: `browser-annotations.pdf`, `browser-ink-split.pdf`, `browser-ink-undo.pdf`, `annotation-editor.png`, `annotation-editor-mobile.png` und HTML-Testbericht. Nur synthetische, unkritische PDFs werden erzeugt; nichts davon wird als persönliche Testdatei eingecheckt. Aktuelle GitHub-Laufergebnisse und Desktop-Artefakte stehen im zugehörigen PR.

## Offene Grenzen

- Adobe Acrobat und echte Dateien aus Drittprogrammen sind noch manuell zu prüfen. Die bestehende Fremdnotiz stammt aus einem unabhängigen synthetischen PDF-Schreiber. Poppler ist ein unabhängiger Renderer, ersetzt aber keine Acrobat-Interoperabilitätsabnahme.
- Kein Recovery-Journal, keine automatische Wiederherstellung, kein direktes Dateisystem-Speichern. Browserwarnungen beim Schließen sind auf mobilen Geräten nicht in jedem Beendigungsfall garantiert.
- Textfelder starten mit fester Größe. Größenänderung, lange Texte/automatischer Umbruch, weitere Schriften/Schriftsysteme, Transparenz, Pfeile, Formen und Textmarker sind Folgearbeit. Neu erzeugte Textfelder verwenden Helv; die Appearance-Rotation folgt der Seite über MuPDFs unterstütztes `/Rotate`-Attribut.
- Neue Werkzeugparameter gelten für die Sitzung; persistente Werkzeugprofile sind noch offen.
- Bearbeitung nur auf der in der Seitenanzeige aktuellen Seite. In der fortlaufenden Ansicht kann weiterhin unabhängig navigiert werden; bei unübernommenen Eigenschaften bleibt die aktuelle Seite fest.
- Touch in Chromium wird emuliert geprüft. Reale Stifte/Tablets, Drucksensitivität, Safari/Firefox, native Desktop-Bedienung und komplexe A0-Pläne bleiben offen.
