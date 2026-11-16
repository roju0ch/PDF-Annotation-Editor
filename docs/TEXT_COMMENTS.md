# Werkzeugwechsel und native Textkommentare

## Bedienung

Escape beendet ein Zeichenwerkzeug und aktiviert die Auswahl. Ein noch nicht abgeschlossener Strich wird verworfen; es entsteht keine PDF-Annotation. Ist die Auswahl bereits aktiv, hebt Escape die Auswahl auf. Ein geöffnetes Menü beziehungsweise Kontextmenü wird zuerst geschlossen. Nicht übernommene Objekteigenschaften bleiben erhalten; Escape speichert keine Texteingabe.

Neue Zeichnungen, Notizen und Textfelder werden nicht automatisch ausgewählt. Das verwendete Werkzeug bleibt aktiv. Einfügen kopierter Objekte, Gruppenbewegung und explizite Objektauswahl behalten ihre eigenen Auswahlregeln.

Das Textfeldwerkzeug öffnet nach Klick oder Touch auf der aktiven Seite den Dialog **Textkommentar erstellen**. Vor Bestätigung wird kein natives Objekt angelegt. Der Dialog startet mit einem leeren, fokussierten mehrzeiligen Eingabefeld; Enter fügt einen Zeilenumbruch ein. Textfarbe, Hintergrundfarbe, Transparenz und Schriftgröße werden unabhängig vom Textinhalt als lokale Voreinstellungen behalten. PDF-Inhalte werden dafür nicht in Browser-Persistenz geschrieben.

**OK** erzeugt die FreeText-Annotation an der gespeicherten PDF-Position und lässt das Textfeldwerkzeug aktiv. Leerraum allein ist kein gültiger Kommentar. **Abbrechen** verwirft die Eingabe ohne PDF-Änderung oder Undo-Eintrag. Escape verwirft den Dialog ebenfalls und wechselt zusätzlich zur Auswahl. Bei einem Erstellungsfehler bleiben Eingabe und Dialog erhalten. Während der Erstellung wird ein zweiter Auftrag verhindert.

Mit synthetischer PDF im Chromium-Test aufgenommen: [Dialog bei 390 × 844](images/text-comment-dialog-mobile.png), [Dialog bei reduziertem Platz von 390 × 450](images/text-comment-dialog-keyboard.png). Der reduzierte Viewport prüft den verfügbaren Platz bei eingeblendeter Tastatur; eine echte Android-Bildschirmtastatur wird damit nicht emuliert. Tab und Shift+Tab bleiben bei den aktivierten Dialogfeldern.

## PDF-Geometrie und Speicherung

Die Schriftmetriken und die automatische Textfeldgröße werden im PDF-Adapter berechnet, unabhängig von CSS-Zoom und Pixeldichte. Explizite Leerzeilen sowie automatische Umbrüche werden bei Höhe und Breite berücksichtigt. Der Klickanker wird über die vorhandene Seitentransformation in kanonischen PDF-Koordinaten gespeichert; das Layout berücksichtigt gedrehte und beschnittene Seiten. Nahe Seitenrändern wird die Box innerhalb der nutzbaren Seite angeordnet.

Die Speicherung erfolgt weiterhin als natives `/Subtype /FreeText` mit Textinhalt und Appearance-Stream. Textfarbe und Schriftgröße gehören zur Default Appearance (`/DA`); die FreeText-Hintergrundfarbe nutzt `/C`, nicht die von MuPDF für FreeText nicht unterstützte InteriorColor-API. Transparenz des Hintergrunds bedeutet keine Füllfarbe, nicht Unsichtbarkeit des Textes. MuPDF erzeugt die umgebrochene native Textdarstellung; eine äußere PDF-Form ergänzt Hintergrund und Innenabstand anhand der gemessenen Ascender-/Descender-Ausdehnung. Der originale Inhalt einschließlich expliziter Leerzeilen bleibt in `/Contents` erhalten, ohne Umwandlung in ein Bild oder Einbrennen in den Seiteninhalt. Der private Marker lautet `/PDFAnnotationEditorAutoSize 1`.

Eigene automatisch dimensionierte Textfelder tragen einen dokumentinternen Marker, damit Text-/Schriftänderungen auch nach Export und erneutem Öffnen die Größe anpassen können. Fremde FreeText-Annotationen behalten ihre Abmessungen; RichText-/Callout-Annotationen bleiben wie bisher geschützt. Undo/Redo und Export verwenden die bestehenden atomaren PDF-Operationen. Die separate Annotationsdarstellung erhält den zwischengespeicherten Planhintergrund.

## Grenzen und Prüfung

Der Inhalt ist auf 10.000 Zeichen, die Schriftgröße auf 6–96 pt begrenzt. Ein Text muss bei der gewählten Größe auf die aktuelle Seite passen; andernfalls meldet der Dialog einen Fehler, statt Text still abzuschneiden. Die eingebauten MuPDF-Schriften unterstützen nicht jedes Zeichen; fehlende Glyphen, beispielsweise manche CJK-Zeichen oder Emoji, führen ebenfalls zu einer verständlichen Fehlermeldung und vollständig zurückgerollter PDF-Operation. Die Eingabe bleibt im Dialog erhalten. Weitere frei wählbare Schriftfamilien und eine vollständige Abnahme aller Schriftsysteme sind nicht enthalten.

Die automatisierten Prüfungen umfassen Werkzeug-Escape und Zeichnungsabbruch, wiederholte Striche ohne Auswahl, leeren Textdialog, mehrzeilige Eingabe, Farben, Transparenz, Abbrechen ohne PDF-/Historienänderung, wiederholtes Platzieren, native Speicherung und erneutes Öffnen sowie die bestehenden Gruppen-/Clipboard-/Export-/Zoom-/Pan-Regressionen. Die tatsächlichen Ergebnisse und Plattformpakete werden im zugehörigen Pull Request dokumentiert. Eine erfolgreiche Cloud-Prüfung ersetzt keine manuelle Prüfung der Android-Tastatur beziehungsweise der installierten Desktop-System-WebViews. Adobe Acrobat steht in der Cloud nicht zur Verfügung; eine entsprechende Interoperabilitätsabnahme wird nicht behauptet.
