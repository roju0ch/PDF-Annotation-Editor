# Scharfe Details bei großen Plänen

Die bisherige Darstellung rasterte die gesamte Seite auf höchstens vier Megapixel beziehungsweise 4096 Pixel je Seite. Dadurch blieb die Detailauflösung bei großen PDF-Seiten auch nach dem Zoomen unverändert. CSS vergrößerte nur dieses begrenzte Bild.

Die Darstellung kombiniert jetzt eine kleine Ganzseitenvorschau mit unabhängig gerenderten Detailkacheln. Mausrad, Pinch und Pan verändern die vorhandene Darstellung sofort. Nach 100 ms ohne Änderung des benötigten Kachelplans werden die sichtbaren Ausschnitte im PDF-Worker in der passenden Zoom-/Bildschirmauflösung nachgerendert. Vorhandene Details bleiben währenddessen sichtbar; neue Kacheln erscheinen von der Bildschirmmitte aus. Die PDF-Inhalte und die nativen Annotationen werden dabei getrennt dargestellt; Änderungen werden weiterhin als echte PDF-Objekte gespeichert.

Beim Touch-Nachlauf starten die kleinen Übersichten für neu sichtbare Seiten sofort. Die Detailkacheln warten weiterhin auf einen stabilen Kachelplan.


## Zeichnen und Kommentieren ohne Hintergrund-Neuaufbau

Der Hintergrund enthält ausschließlich die eigentlichen PDF-Seiteninhalte. Er bleibt bei Freihand, Notizen, Bildannotation, Verschieben, Radieren, Löschen sowie Rückgängig/Wiederholen erhalten: weder seine Canvas-Elemente noch deren Pixel werden neu aufgebaut. Neue Hintergrundkacheln werden beim Öffnen, Seitenwechsel, Zoom/Pan oder bei echten Änderungen der Seitenstruktur benötigt.

Die nativen Annotationsdarstellungen und Formular-Widgets liegen separat darüber. Für Änderungen liest die App nur die benötigten Rechtecke aus den sauberen Hintergrundpixeln und lässt MuPDF ausschließlich Annotationen und Widgets darüber zeichnen. Anschließend werden diese kleinen Bereiche ersetzt. Dadurch bleiben auch native Erscheinungsbilder und Blend-Modi wie Multiply bei Textmarkern korrekt; der PDF-Hintergrund wird dafür nicht erneut interpretiert. Alte Positionen verschwinden beim Löschen/Verschieben, sobald der neue native Stand bereit ist.

Freihandstriche bleiben als temporäre SVG-Zeichenrückmeldung sichtbar, bis ihre tatsächlich gespeicherte native Darstellung sichtbar ist. Der Editor wartet nach erfolgreicher nativer Schreiboperation nicht auf die Bildaktualisierung; weitere Striche sind währenddessen möglich. Die SVG-Rückmeldung ersetzt keine PDF-Speicherung und wird nach Bestätigung entfernt.

## Ressourcen und Grenzen

- Benachbarte Detailkacheln überlappen um vier Rasterpixel, um helle Fugen bei CSS-Skalierung zu reduzieren. Eine Detailkachel hat höchstens 1024 × 1024 RGBA-Pixel, also vier MiB. Es wird dafür keine Ganzseiten-Pixmap in voller Zoomauflösung angelegt.
- Nur im Viewport liegende Kacheln werden angefordert. Ihre Auflösung hängt vom Zoom und der Pixeldichte ab, nicht von der Fläche des gesamten Plans. Auflösungsstufen folgen dem Faktor √2 und runden auf die nächste Stufe auf.
- Der Bitmap-LRU ist auf 32 MiB begrenzt. Die zusätzlich benötigten aktuellen Hintergrund-Detailkacheln sind auf 25.165.824 Pixel (96 MiB) begrenzt; für sehr große HiDPI-Viewports wird die Rasterdichte dafür stufenweise reduziert. Vorherige Auflösungsstufen bleiben während des Nachladens mit höchstens 16 MiB erhalten; anschließend werden sie entfernt. Hinzu kommen Übersichten und native Annotationsbereiche. Diese werden auf die betroffenen Rechtecke beschnitten; im Extremfall vieler großflächiger Annotationen können sie bis zur Fläche ihrer Hintergrundkacheln benötigen (aktuell zusätzlich bis 96 MiB, frühere Stufen bis 16 MiB). Diese Budgets sind keine Obergrenze für den gesamten WebView-/WASM-Speicher.
- Es steht höchstens eine Hintergrund-Rendering-Anfrage und eine Annotations-Anfrage dieser Ansicht im Worker aus. Neue Gesten verwerfen überholte Arbeit vor der nächsten Anfrage; eine bereits laufende MuPDF-Operation wird nicht mitten im Aufruf abgebrochen. Dokumentwechsel und Änderungen der Seitenstruktur invalidieren die Hintergrund-Caches; normale Annotationsänderungen betreffen nur Annotationsdaten und deren Darstellung.
- Je zwei MuPDF-DisplayLists bleiben für Seiteninhalte und vollständige Referenzdarstellung erhalten. Das öffentliche MuPDF.js-API unterstützt keinen zusätzlichen Scissor-Parameter beim Ausführen dieser Listen: Auch für einen kleinen Ausschnitt können komplexe Seiten eine merkliche Berechnungszeit benötigen. Größere Kacheln reduzieren wiederholte Listendurchläufe gegenüber vielen sehr kleinen Kacheln.
- DPR ist auf 4, der Renderer auf 128 Rasterpixel/PDF-Punkt und ein sichtbarer Plan auf 256 Kacheln begrenzt. Bei extremen Bildschirmgrößen werden zentrale Kacheln bevorzugt; die Ganzseitenvorschau bleibt darunter erhalten. Eine in der PDF eingebettete niedrig aufgelöste Rastergrafik gewinnt durch Zoomen keine ursprünglichen Bilddetails zurück.

## Tatsächliche Prüfung

`tests/e2e/annotation-rendering.spec.ts` zeichnet mehrere Striche auf einen synthetischen Großplan, hält die native Bildaktualisierung gezielt zurück und prüft, dass weitere echte Bearbeitungen möglich sind. Hintergrund-Canvas-Identitäten, Pixelprüfsummen und Anzahl der Hintergrundanfragen müssen bei Zeichnen, Notiz, Verschieben, Löschen und Undo/Redo identisch bleiben. Anschließend prüft der Test die sichtbare native Darstellung und den echten PDF-Export. `tests/annotation-composite.test.ts` prüft unter anderem native Multiply-Textmarker, Widgets und passende Hintergrundpixel.

`tests/raster.test.ts` prüft MuPDF-Ausschnittsrendering, CropBox/Rotation, native Annotationen nach Änderungen, begrenzte Puffer und tatsächlich getrennte feine Vektorlinien bei hohem Zoom. Kleine Kantenglättungsunterschiede zwischen begrenztem und ganzseitigem Raster werden berücksichtigt.

`tests/tiles.test.ts` prüft Zoom-/DPR-abhängige Auflösung, Pan-Koordinaten, Seitengrenzen, sichtbare Abdeckung und LRU-Verdrängung nach tatsächlichen Bytes. Der Browser-Test `tests/e2e/rendering.spec.ts` erzeugt einen synthetischen 6000 × 4000-Punkte-Plan und vergleicht den echten Pixelkontrast feiner Linien zwischen Vorschau und Detaildarstellung bei DPR 3. Er prüft außerdem Zoomanker, Pan-Nachladen ohne gleichzeitiges Linux-Primary-Paste, die aktive Rasterfläche und Helligkeitssprünge an Kachelgrenzen im tatsächlich zusammengesetzten Bildschirmbild. Browser-CI und Installationspakete verwenden denselben Frontend-/Worker-Code; flüssige Touch-Bedienung und Speicherverbrauch müssen zusätzlich auf einem echten Android-Gerät geprüft werden.

Private Referenzpläne werden ausschließlich im Cloud-Arbeitsverzeichnis lokal verarbeitet, weder eingecheckt noch als Screenshots, PDFs oder Testberichte veröffentlicht. Die tatsächlichen Testergebnisse und gegebenenfalls Build-Einschränkungen stehen im zugehörigen Pull Request.
