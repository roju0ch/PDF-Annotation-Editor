import { mkdirSync, writeFileSync } from "node:fs";
// Independent PDF writer: synthetic page content plus a pre-existing third-party-style note.
export function fixture() {
  const stream =
    "0.12 0.50 0.42 rg 40 40 140 100 re f\n0 0 0 RG 3 w 30 30 m 260 360 l S\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R 6 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 4 0 R /Annots [7 0 R 8 0 R] >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 450] /CropBox [20 30 520 430] /Rotate 90 /Resources << >> /Contents 4 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2384 3370] /Resources << >> /Contents 4 0 R >>",
    "<< /Type /Annot /Subtype /Text /Rect [200 300 225 325] /Contents (Independent fixture note) /NM (foreign-note) /Name /Comment >>",
    "<< /Type /Annot /Subtype /Link /Rect [30 30 70 45] /Border [0 0 0] /A << /S /URI /URI (https://example.invalid/never-followed) >> >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
export function writeFixture() {
  mkdirSync("artifacts", { recursive: true });
  writeFileSync("artifacts/fixture.pdf", fixture());
}
writeFixture();
