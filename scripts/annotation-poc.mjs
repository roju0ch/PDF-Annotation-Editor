import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { fixture } from "./fixtures.mjs";
const doc = new mupdf.PDFDocument(fixture());
assert.equal(doc.wasRepaired(), false);
const page = doc.loadPage(0);
const beforeContents = page.getObject().get("Contents").readStream().asString();
const foreign = page
  .getAnnotations()
  .find((a) => a.getName() === "foreign-note");
assert.ok(foreign);
foreign.setContents("Independent fixture note — edited");
foreign.update();
for (const type of ["Ink", "Text", "FreeText"]) {
  const a = page.createAnnotation(type);
  a.setName(`poc-${type}`);
  a.setContents(`Native ${type}`);
  if (type === "Ink") {
    a.setInkList([
      [
        [30, 120],
        [70, 80],
        [120, 120],
      ],
    ]);
    a.setColor([1, 0, 0]);
    a.setBorderWidth(3);
  } else {
    a.setRect(type === "Text" ? [40, 40, 65, 65] : [40, 150, 250, 190]);
    if (type === "FreeText") a.setDefaultAppearance("Helv", 14, [0, 0, 1]);
  }
  a.update();
}
let data = doc.saveToBuffer("compress=no");
writeFileSync("artifacts/annotations-created.pdf", data.asUint8Array());
const reopened = new mupdf.PDFDocument(data.asUint8Array());
const rp = reopened.loadPage(0);
for (const type of ["Ink", "Text", "FreeText"]) {
  const a = rp.getAnnotations().find((a) => a.getName() === `poc-${type}`);
  assert.equal(a?.getType(), type);
  assert.equal(a.getObject().get("Subtype").asName(), type);
  assert.ok(
    a.getObject().get("AP", "N").isStream(),
    `${type}: native appearance stream`,
  );
  a.setContents(`Edited ${type}`);
  if (type === "Ink")
    a.setInkList([
      [
        [30, 120],
        [55, 95],
      ],
      [
        [85, 92],
        [120, 120],
      ],
    ]); // Stored as two native Ink paths, no flattening.
  a.update();
}
const saved = reopened.saveToBuffer("compress=no");
writeFileSync("artifacts/annotations-roundtrip.pdf", saved.asUint8Array());
const final = new mupdf.PDFDocument(saved.asUint8Array());
const fp = final.loadPage(0);
for (const type of ["Ink", "Text", "FreeText"]) {
  const a = fp.getAnnotations().find((a) => a.getName() === `poc-${type}`);
  assert.equal(a.getContents(), `Edited ${type}`);
  if (type === "Ink") assert.equal(a.getInkList().length, 2);
}
assert.equal(
  fp
    .getAnnotations()
    .find((a) => a.getName() === "foreign-note")
    .getContents(),
  "Independent fixture note — edited",
);
assert.equal(
  fp.getObject().get("Contents").readStream().asString(),
  beforeContents,
);
assert.equal(
  fp.getObject().get("Annots").get(1).get("A", "URI").asString(),
  "https://example.invalid/never-followed",
);
const rotated = final.loadPage(1);
assert.deepEqual(rotated.getBounds(), [0, 0, 400, 500]);
rotated.destroy();
const encrypted = doc.saveToBuffer(
  "encrypt=aes-256,user-password=secret,owner-password=owner",
);
writeFileSync("artifacts/encrypted.pdf", encrypted.asUint8Array());
encrypted.destroy();
writeFileSync(
  "artifacts/poc-results.json",
  JSON.stringify(
    {
      engine: "MuPDF.js 1.28.6",
      passed: [
        "Ink/Text/FreeText create-save-reopen-edit-save-reopen",
        "native subtype dictionaries and appearance streams",
        "independently generated existing Text annotation edited",
        "unhandled Link and original page content preserved",
        "Ink split stored as two editable native paths",
        "rotated CropBox dimensions",
      ],
      limitations: [
        "No general geometric eraser implementation",
        "Adobe Acrobat review not performed",
        "Fixture is independently generated, not an Acrobat-produced document",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "PASS: native Ink/Text/FreeText roundtrip, appearances, foreign note, Link/content preservation, split Ink, rotated CropBox",
);
fp.destroy();
final.destroy();
saved.destroy();
rp.destroy();
reopened.destroy();
data.destroy();
page.destroy();
doc.destroy();
