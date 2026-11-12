# Pflichtenheft – PDF Annotation Editor

**Status:** Version 0.2, verbindliche Produktziele; technische Detailwahl unter Vorbehalt des Prototyps.  
**Sprache der Oberfläche:** Deutsch (später erweiterbar).  
**Lizenz:** AGPL-3.0 (bereits im Repository); Abhängigkeiten vor dem Vertrieb prüfen.

## 1. Ziel
Ein schneller, einfacher, vollständig lokal nutzbarer PDF-Viewer und Annotationseditor mit besonderer Eignung für technische Zeichnungen und A0-/A1-Baupläne. Kein vollwertiger Acrobat-Ersatz mit Text-/Seiteninhaltsbearbeitung. Keine Cloud, Registrierung, Telemetrie oder Uploads.

## 2. Plattformen / Entwicklung
- Phase 1: Browser-Vorschau sowie Windows, macOS und Linux.
- Phase 2: Android, iOS und iPadOS mit Touch-Bedienung.
- Ein gemeinsamer React-/TypeScript-Codekern; native Integration mit Tauri 2 als Kandidat.
- Entwicklung vollständig in Codex Cloud und GitHub; automatisierte Builds und Tests über GitHub Actions.
- Besitzer benötigt weder Entwicklungsumgebung noch Compiler oder Terminal.
- Browser-Vorschau via GitHub Pages, wenn sie für den Entwicklungsstand sicher und technisch praktikabel ist. GitHub Pages muss ggf. einmalig manuell aktiviert werden.

## 3. Ansichten / Navigation
- Einzelblattansicht als Standard, alternativ fortlaufende Seitenansicht.
- Seitenwechsel, aktuelle Seitenzahl, Gesamtseitenzahl, Zoomfaktor, Fit Page und Fit Width.
- Direktes Zoomen mit Mausrad, zunächst ohne Modifier. Pointer-Anker bleibt unter dem Mauszeiger.
- Mittlere Maustaste: Pan zu jeder Zeit, unabhängig vom Werkzeug.
- Leertaste + linke Maustaste: temporärer Pan.
- Trackpad: Zwei-Finger-Scrollen bzw. Pan und Pinch zum Zoomen, nach Plattform/Browsereignissen differenziert. Konflikte von Mausrad/Trackpad über konfigurierbare Eingabeprofile lösen.
- Touch: Zwei-Finger-Pan und Pinch; Ein-Finger-Aktion nach aktivem Werkzeug.
- Während Zoom und Pan sofortige visuelle Reaktion, hochauflösendes Nachrendern im Hintergrund; Render-Caching und effiziente Speicherfreigabe.
- Orientierung, Rotation, CropBox, verschiedene Seitengrössen und hochauflösende Seiten korrekt behandeln.
- Keine Verschiebung der Annotationen gegenüber dem PDF bei Zoom, Pan oder Rotation.

## 4. Oberfläche
- Horizontale, reduzierte Werkzeugleiste oben.
- Maximale PDF-Arbeitsfläche in der Mitte.
- Schmale Statusleiste unten.
- Optionale Seitenminiaturen, Kommentarübersicht und kontextbezogene Eigenschaften.
- Responsive, touchgeeignete Oberfläche; Hell-/Dunkelmodus optional.

## 5. Werkzeuge / Annotationen
Neue Annotationsobjekte werden als **native, standardkonforme PDF-Annotationen** gespeichert, nicht bloss als Bild oder flach aufgerenderte PDF-Seite:
- Freihand (Ink)
- Linie und Pfeil (Line, mit Linienendpunkten)
- Rechteck (Square)
- Kreis / Ellipse (Circle)
- Textmarker auf selektiertem PDF-Text (Highlight)
- Haftnotiz / Popup-Kommentar (Text)
- Sichtbares Textfeld (FreeText)
- Auswahl, Verschieben, Skalieren, Eigenschaften ändern, Löschen
- Ganzen Annotationsgegenstand entfernen (Objektradierer)
- Teilbereiche von Freihand-Ink-Annotationen geometrisch entfernen (Teilradierer); verbleibende Segmente werden als native Ink-Annotationen gespeichert

Eigenschaften: Farbe, Strichbreite, Transparenz, ggf. Füllung, Schriftgrösse, Rahmenfarbe. Einstellungen des jeweiligen Werkzeugs werden lokal beibehalten. Undo/Redo muss auch Lösch- und Teilradieraktionen abdecken.

## 6. Fremdannotation / Interoperabilität
- Vorhandene Annotationen lesen und als echte Objekte anzeigen.
- Unterstützte Fremdannotationstypen bearbeiten und wieder speichern; entsprechende Metadaten und Appearance Streams berücksichtigen.
- Nicht unterstützte Annotationstypen intakt belassen, nicht löschen und nicht unbeabsichtigt verändern.
- Die Ausgabedateien in mindestens zwei unabhängigen PDF-Programmen testen, darunter Adobe Acrobat.
- Fremdprogramme müssen kompatible Annotationsobjekte erkennen; deren Bearbeitungsumfang kann je Programm verschieden sein.
- Digitale Signaturen, Verschlüsselung, Schreibschutz und beschädigte Dateien besonders behandeln; nichts stillschweigend überschreiben.
- Spezielle Annotationstypen wie Stempel, Formulare, Signaturen und Redaktionen sind in V1 **keine** Bearbeitungszusage.

## 7. Speichern / Wiederherstellung
- Manuell speichern mit Ctrl/Cmd+S; 'Speichern unter' separat.
- Änderungen dürfen das Original vor manuellem Speichern nicht verändern.
- Automatisches lokales Recovery-Journal bei ungespeicherten Änderungen, Zielintervall 15–30 Sekunden und an relevanten Ereignissen.
- Wiederherstellungsdialog nach Absturz; Abbrechen/Verwerfen möglich.
- Warnung beim Schliessen mit ungespeicherten Änderungen.
- Sichere Speicherung über temporäre Datei, Prüfung und möglichst atomaren Austausch, wo das Dateisystem dies erlaubt. Browser: expliziter Export/Download oder unterstützte File System Access API, nicht als stillschweigendes In-Place-Speichern bewerben.
- Externe Dateiänderungen vor Überschreiben erkennen; Konfliktbehandlung.
- Recovery nach erfolgreichen Speicherungen bereinigen. Datensparsame Browser-Persistenz z.B. IndexedDB; Desktop isolierter App-Datenordner.

## 8. Sicherheit / Datenschutz
- Ausschliesslich lokale PDF-Verarbeitung.
- Keine Inhaltsübermittlung, Tracking, Analytics oder persönliche Zugangsdaten.
- PDF-Dateien als nicht vertrauenswürdige Eingaben verarbeiten; sichere Dateizugriffe und Ressourcengrenzen.
- Browser-Public-Hosting enthält nur statische App-Dateien, niemals vom Benutzer geöffnete PDF-Inhalte.

## 9. Abnahme – gestaffelt
### M0: Build- und Viewer-Prototyp
- GitHub-CI und nachvollziehbarer Cloud-Build vorhanden.
- Browser öffnet eine lokale, mehrseitige PDF und zeigt Seiten korrekt an.
- Einzelblatt und fortlaufend, Zoom zum Mauszeiger, Mittelmaus-Pan funktionieren.
- Koordinaten und Zoomverhalten durch automatisierte Tests abgesichert.
- Keine vorgetäuschte Annotationsspeicherung.

### M1: Native Annotations-Roundtrip-Prüfung
- Ink, Text und FreeText erzeugen, speichern, erneut öffnen, identifizieren und bearbeiten.
- Mindestens eine bestehende Fremdannotation korrekt einlesen und verändern.
- Native PDF-Objekte/Appearance-Streams nachweisen.
- Machbarkeit der geometrischen Ink-Teilradierung nachweisen.
- Öffnen im unabhängigen PDF-Programm dokumentieren.

### M2: Editor-Werkzeuge
- Weitere Werkzeuge, Auswahl, Undo/Redo, Objekt- und Teilradierer.
- Manuelles Speichern sowie Recovery.

### M3: Desktop-Distribution
- Erfolgreiche signaturfreie Test-Builds für Windows, Linux, macOS über GitHub Actions als Artefakte.
- Code-Signing/Notarisierung für einfache Installation später separat.
- Mobile Plattformen in späterem Meilenstein.

## 10. Offene technische Entscheidungen
- MuPDF.js vs. eine Alternative nach Proof of Concept und Lizenzprüfung.
- Konkreter Browser-/Desktop-Dateizugriff, notarisiertes macOS-Release.
- Präzise Performancebudgets nach Messung repräsentativer grosser Pläne.
- Reihenfolge der Werkzeugerweiterungen nach M1.

Dieses Dokument enthält verbindliche Ziele, jedoch keine Behauptung, dass alle Features bereits implementiert oder in jedem externen PDF-Programm bearbeitbar wären.
