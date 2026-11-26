import * as mupdf from "mupdf";

export const lines = ["Grüße & Öl", "Zweite Zeile!"];
// Courier at 20 pt advances 12 pt. Crop-local baselines start at (40, 80).
export function pdfTextFixture(rotation: 0 | 90 | 180 | 270 = 0, text = lines) {
  const doc = new mupdf.PDFDocument();
  const height = Math.max(400, text.length * 32 + 100);
  try {
    const font = doc.addObject({
      Type: "Font",
      Subtype: "Type1",
      BaseFont: "Courier",
      Encoding: "WinAnsiEncoding",
    });
    const content = text
      .map(
        (line, i) =>
          `BT /F1 20 Tf 60 ${30 + height - 80 - i * 32} Td <${Buffer.from(line, "latin1").toString("hex")}> Tj ET`,
      )
      .join("\n");
    const first = doc.addPage(
      [0, 0, 450, height + 50],
      rotation,
      { Font: { F1: font } },
      content + "\nBT /F1 8 Tf 425 100 Td (CROP) Tj ET",
    );
    first.put("CropBox", [20, 30, 420, height + 30]);
    doc.insertPage(-1, first);
    const p = doc.loadPage(0);
    try {
      const a = p.createAnnotation("FreeText");
      a.setRect([200, 200, 330, 240]);
      a.setContents("Nur Annotation");
      a.setDefaultAppearance("Helv", 12, [0, 0, 0]);
      a.update();
    } finally {
      p.destroy();
    }
    doc.insertPage(-1, doc.addPage([0, 0, 400, 400], 0, {}, "0 0 30 30 re f"));
    const bytes = doc.saveToBuffer("");
    try {
      return Buffer.from(bytes.asUint8Array());
    } finally {
      bytes.destroy();
    }
  } finally {
    doc.destroy();
  }
}
