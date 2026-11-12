# Codex-Auftrag 001 – Cloud-Projektgrundgerüst und PDF-Viewer

## An Codex Cloud
Repository: `roju0ch/PDF-Annotation-Editor`

Zuerst `AGENTS.md`, `docs/REQUIREMENTS.md` und `docs/ARCHITECTURE.md` lesen. Diese Dokumente sind maßgeblich. Sämtliche Entwicklung, Kompilierung und Tests in Codex Cloud bzw. GitHub Actions durchführen. Keine lokale Entwicklungsumgebung vom Projektinhaber verlangen.

## Ziel dieses Auftrags
Ein überprüfbarer erster Browser-Viewer mit echter PDF-Darstellung, funktionierendem pointerzentriertem Mausradzoom, Pan und einem automatisierten Cloud-Build. Native Annotationen sollen vorerst **als technischer Machbarkeitsnachweis** untersucht werden, nicht durch eine ungetestete Vollimplementierung.

## Umsetzung
1. React + TypeScript + Vite mit striktem Typecheck, Prettier/ESLint oder Vergleichbarem, Unit-Tests und möglichst Browser-End-to-End-Tests einrichten.
2. MuPDF.js in die Browser-App integrieren, sofern Lizenz, Paket, Browser-WASM-API und GitHub-Pages-Build technisch funktionieren. Bibliotheksversionen festhalten. Falls nicht, risikoarm auf einem Feature-Branch die konkrete Blockade dokumentieren und geeignete Alternative vorschlagen, ohne heimlichen Technologiewechsel.
3. Eine lokale PDF-Datei im Browser öffnen (File API), tatsächliche PDF-Seiten anzeigen; kein Upload. Mehrseitige PDFs und unterschiedliche Seitengrössen unterstützen.
4. Einzelblattansicht als Standard und fortlaufende Ansicht; Seitenwechsel, Zoomfaktor, Fit Page und Fit Width.
5. Mausradzoom auf Mausposition ohne Modifier; mittlere Maustaste jederzeit Pan, Leertaste + linke Maustaste für temporäres Pan. Touch-Pinch und Trackpad sinnvoll unterstützten bzw. klar als offene Punkte dokumentieren.
6. UI minimal halten: horizontale Toolbar, grosse Fläche, kleine Statusleiste. Deutschsprachige Bedienfelder; nicht implementierte Funktionen nicht als fertig darstellen.
7. Virtuelle PDF-Seitenkoordinaten unabhängig von CSS-/Device-Pixeln verwalten. Zoom-Anker und Koordinatentransformationen automatisiert testen.
8. GitHub-Action für Typecheck, Lint, Tests, Browser-Build. GitHub-Pages-Deployment mit korrektem Projekt-Unterpfad vorbereiten. Pages kann eine einmalige manuelle Aktivierung in den Repository-Einstellungen erfordern.
9. Tauri 2 vorbereiten, Desktop-Build-Matrix getrennt und möglichst nicht blockierend aufbauen; Windows/macOS/Linux-Artefakte als Ziel. Build- und Signing-Einschränkungen ehrlich dokumentieren.
10. Erstelle ein kurzes, reproduzierbares POC-Skript/Test über MuPDF.js für Ink, Text und FreeText: native Annotation erstellen, speichern, erneut öffnen, nach Typ lesen. Belege Resultate anhand einer ungefährlichen Test-PDF; kein Abhaken ohne erfolgreichen Durchlauf. Das ist ein Gate für den nächsten Entwicklungsauftrag. Wenn komplex, POC klar vom Viewer trennen und verbleibende Arbeit erfassen.

## Qualitätskriterien
- Keinerlei externe PDF-Übertragung, keine Telemetrie.
- Bei Datei- und PDF-Fehlern gut verständliche UI-Meldungen.
- Keine erfundenen Testresultate; CI-Status und nicht erfüllte Punkte offen ausweisen.
- Kein 'Speichern'-Button, solange keine echte, geprüfte native PDF-Speicherung implementiert ist.
- PDF-Inhalte niemals als reine Screenshot-Fiktion nachbauen.
- Unsignierte macOS-/Windows-Pakete als Testversion deklarieren.
- Tests: Maus-Zoom-Anker, Pan unabhängig vom Werkzeug, mehrfacher Zoom, Rotations-/Seitenkoordinaten, mehrseitige PDF.
- Ein Browser-Test mit einer selbst erzeugten, unkritischen PDF-Datei; kein PDF mit vertraulichen Inhalten einchecken.

## GitHub-Prozess
- Auf neuem Feature-Branch arbeiten und Pull Request gegen main erstellen.
- Keine direkte Code-Änderung an main; kein Auto-Merge.
- PR-Beschreibung: Umfang, tatsächliche Prüfungen, Testausgaben/CI, Preview-Link (falls aktiv), Einschränkungen und Screenshots falls möglich.
- README um verständliche Nutzung via Browser-Vorschau, Actions-Artefakte und den aktuellen Funktionsstand erweitern.
- Abnahme des ersten Meilensteins nur, wenn Viewer und Navigation tatsächlich funktionieren; nicht bloss wenn CI grün ist.

## Besonders wichtig
Die Architektur darf sich nicht in einer funktionsreichen Toolbar verlieren. Kernpriorität ist technisch sauberes Zoomen und Verschieben von grossen PDFs. Erst danach die komplexeren Annotationstools ausbauen.

**Starte jetzt mit dem umsetzbaren ersten Meilenstein und eröffne den PR.**
