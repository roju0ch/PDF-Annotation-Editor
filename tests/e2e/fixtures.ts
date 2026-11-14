import { readFile, writeFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { AnnotationEditor } from "../../src/adapters/pdf/annotations";
import { inverse, transform } from "../../src/core/viewport";
import { selectionRect } from "../../src/core/annotations/selection";
export async function writeSelectionFixture(path: string) {
  const bytes = new Uint8Array(await readFile("artifacts/fixture.pdf"));
  const doc = new mupdf.PDFDocument(bytes);
  try {
    const editor = new AnnotationEditor(doc, bytes);
    for (const index of [0, 1]) {
      const p = doc.loadPage(index),
        matrix = inverse(p.getTransform()),
        bounds = p.getBounds();
      const pdf = (x: number, y: number) =>
        transform({ x: x + bounds[0], y: y + bounds[1] }, matrix);
      p.destroy();
      for (const [name, x0, y0, x1, y1] of [
        ["A", 50, 140, 140, 140],
        ["B", 100, 200, 210, 200],
      ] as const) {
        editor.apply({
          action: "create",
          page: index,
          kind: "Ink",
          rect: [0, 0, 1, 1],
          ink: [[pdf(x0, y0), pdf(x1, y1)]],
          contents: name,
          color: "#ff0000",
          width: 3,
          fontSize: 14,
        });
      }
      editor.apply({
        action: "create",
        page: index,
        kind: "Text",
        rect: selectionRect(pdf(210, 175), pdf(234, 199)),
        contents: "C",
        color: "#ff0000",
        width: 3,
        fontSize: 14,
      });
      editor.apply({
        action: "create",
        page: index,
        kind: "FreeText",
        rect: selectionRect(pdf(60, 280), pdf(240, 320)),
        contents: "Unverändert",
        color: "#ff0000",
        width: 3,
        fontSize: 14,
      });
    }
    await writeFile(path, editor.export());
  } finally {
    doc.destroy();
  }
}
